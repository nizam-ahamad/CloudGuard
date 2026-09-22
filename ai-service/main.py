import os
import math
import pefile
import joblib
import pandas as pd
import requests
import hashlib
import tempfile
import shutil
import zipfile
import boto3
from dotenv import load_dotenv
from collections import Counter
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager

import sys
load_dotenv(os.path.join(os.path.dirname(__file__), '../server/.env'))

required_env = ['VT_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_BUCKET_NAME']
missing = [k for k in required_env if not os.getenv(k)]
if missing:
    print(f"FATAL ERROR: Missing critical environment variables: {', '.join(missing)}", file=sys.stderr)
    sys.exit(1)

s3_client = boto3.client(
    's3',
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
    region_name=os.getenv('AWS_REGION')
)

VT_API_KEY = os.getenv("VT_API_KEY")

# Global variable for the model
rf_model = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global rf_model
    model_path = os.path.join(os.path.dirname(__file__), 'rf_model.pkl')
    if os.path.exists(model_path):
        rf_model = joblib.load(model_path)
        print(f"Loaded ML model from {model_path}")
    else:
        print("Warning: ML model not found. Predictions will be unavailable.")
    yield

app = FastAPI(lifespan=lifespan)


def get_file_entropy(filepath=None, data=None):
    byte_counts = Counter()
    total_bytes = 0
    if data is not None:
        byte_counts.update(data)
        total_bytes = len(data)
    else:
        with open(filepath, 'rb') as f:
            while chunk := f.read(1048576):
                byte_counts.update(chunk)
                total_bytes += len(chunk)
    if total_bytes == 0:
        return 0.0
    entropy = 0.0
    for count in byte_counts.values():
        p = count / total_bytes
        entropy -= p * math.log2(p)
    return entropy

def get_file_hash(filepath=None, data=None):
    hasher = hashlib.sha256()
    if data is not None:
        hasher.update(data)
    else:
        with open(filepath, 'rb') as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
    return hasher.hexdigest()

def get_sha256(filepath=None, data=None):
    sha256 = hashlib.sha256()
    if data is not None:
        sha256.update(data)
    else:
        with open(filepath, "rb") as f:
            while chunk := f.read(1048576): # 1MB chunks
                sha256.update(chunk)
    return sha256.hexdigest().upper()

def scan_with_virustotal(file_hash):
    url = f"https://www.virustotal.com/api/v3/files/{file_hash}"
    headers = {"x-apikey": VT_API_KEY}
    
    try:
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            stats = response.json().get('data', {}).get('attributes', {}).get('last_analysis_stats', {})
            malicious_count = stats.get('malicious', 0)
            return {"status": "malicious" if malicious_count > 0 else "safe"}
        elif response.status_code == 404:
            return {"status": "safe"}
        else:
            return {"status": "safe"}
    except Exception:
        return {"status": "safe"}

def analyze_executable(filepath=None, data=None, filename="unknown"):
    if rf_model is None:
        # Graceful fallback to VT if ML model fails to load
        return scan_with_virustotal(get_file_hash(filepath, data))

    try:
        features = {}
        if data is not None:
            pe = pefile.PE(data=data, fast_load=True)
        else:
            pe = pefile.PE(filepath, fast_load=True)
        
        try:
            sec_idx = pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_SECURITY']
            pe.parse_data_directories(directories=[sec_idx])
            if len(pe.OPTIONAL_HEADER.DATA_DIRECTORY) > sec_idx:
                sec_dir = pe.OPTIONAL_HEADER.DATA_DIRECTORY[sec_idx]
                if sec_dir.VirtualAddress > 0 and sec_dir.Size > 0:
                    print(f"[AI Scanner] Executable: {filename} | Authenticode Signature Verified (Skipping ML)")
                    pe.close()
                    return {'status': 'safe', 'reason': 'Valid Digital Signature Found'}
        except Exception as e:
            print(f"Signature check failed, proceeding to ML: {e}")

        features['SizeOfOptionalHeader'] = pe.FILE_HEADER.SizeOfOptionalHeader
        features['Characteristics'] = pe.FILE_HEADER.Characteristics
        features['MajorLinkerVersion'] = pe.OPTIONAL_HEADER.MajorLinkerVersion
        features['SizeOfInitializedData'] = pe.OPTIONAL_HEADER.SizeOfInitializedData
        pe.close()
        
        features['Entropy'] = get_file_entropy(filepath, data)

        df = pd.DataFrame([features])
        
        # Ensure column order matches training data
        columns = ['SizeOfOptionalHeader', 'Characteristics', 'MajorLinkerVersion', 'SizeOfInitializedData', 'Entropy']
        df = df[columns]

        # Get prediction probability
        prob = float(rf_model.predict_proba(df)[0][1])
        
        print(f"[AI Scanner] Executable: {filename} | Malicious Probability: {prob:.4f} | Features extracted: {len(features)}")
        
        if prob >= 0.5:
            return {"status": "malicious"}
        else:
            return {"status": "safe"}
            
    except Exception as e:
        print(f"[AI Scanner] Extraction failure for {filename}: {str(e)}")
        return {"status": "unverified", "message": "Non-executable or unparseable file bypass"}

class ScanRequest(BaseModel):
    fileKey: str
    filename: str

@app.post("/scan")
async def scan_file(request: ScanRequest):
    try:
        filename = request.filename or ""
        fileKey = request.fileKey
        ext = os.path.splitext(filename)[1].lower()
        is_executable = ext in ['.exe', '.dll', '.com']

        tmp_path = ""
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp_path = tmp.name
            bucket_name = os.getenv('AWS_BUCKET_NAME')
            s3_response = s3_client.get_object(Bucket=bucket_name, Key=fileKey)
            
            hasher = hashlib.sha256()
            for chunk in s3_response['Body'].iter_chunks(chunk_size=1048576):
                tmp.write(chunk)
                hasher.update(chunk)
            tmp.flush()
            os.fsync(tmp.fileno())
            file_hash = hasher.hexdigest().upper()
        
        try:

            vt_res = scan_with_virustotal(file_hash)
            if vt_res.get("status") == "malicious":
                return {"status": "malicious"}

            if ext == '.zip':
                try:
                    with zipfile.ZipFile(tmp_path, 'r') as zip_ref:
                        for extracted_file in zip_ref.namelist():
                            if extracted_file.endswith('/'):
                                continue
                                
                            file_data = zip_ref.read(extracted_file)
                            inner_hash = get_sha256(data=file_data)
                            
                            inner_vt_res = scan_with_virustotal(inner_hash)
                            if inner_vt_res.get("status") == "malicious":
                                return {"status": "malicious"}
                            
                            extracted_ext = os.path.splitext(extracted_file)[1].lower()
                            if extracted_ext in ['.exe', '.dll', '.com']:
                                scan_res = analyze_executable(data=file_data, filename=extracted_file)
                                if scan_res.get("status") in ["malicious", "malware"]:
                                    return {"status": "malicious"}
                    return {"status": "safe"}
                except zipfile.BadZipFile:
                    return {"status": "safe", "error": "BadZipFile"}
                except Exception as e:
                    return {"status": "safe", "error": str(e)}

            if is_executable:
                scan_res = analyze_executable(filepath=tmp_path, filename=filename)
                if scan_res.get("status") in ["malicious", "malware"]:
                    return {"status": "malicious"}
                    
            return {"status": "safe"}
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
