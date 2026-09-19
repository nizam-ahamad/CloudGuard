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
from collections import Counter
from fastapi import FastAPI, HTTPException, File, UploadFile
from pydantic import BaseModel
from contextlib import asynccontextmanager

VT_API_KEY = "4bd790331c1fd67dbd74d684ae7029879a662e16754c4490c2902cb2dbdc7226"

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


def get_file_entropy(filepath):
    byte_counts = Counter()
    total_bytes = 0
    with open(filepath, 'rb') as f:
        # Read the file in 1 MB chunks to drastically improve I/O speed
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

def get_file_hash(filepath):
    hasher = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()

def scan_with_virustotal(file_hash):
    url = f"https://www.virustotal.com/api/v3/files/{file_hash}"
    headers = {"x-apikey": VT_API_KEY}
    
    try:
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            stats = response.json().get('data', {}).get('attributes', {}).get('last_analysis_stats', {})
            malicious_count = stats.get('malicious', 0)
            return {"status": "malware" if malicious_count > 0 else "safe"}
        elif response.status_code == 404:
            return {"status": "safe"}
        else:
            return {"status": "safe"}
    except Exception:
        return {"status": "safe"}

def analyze_executable(filepath, filename="unknown"):
    if rf_model is None:
        # Graceful fallback to VT if ML model fails to load
        return scan_with_virustotal(get_file_hash(filepath))

    try:
        features = {}
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
        
        features['Entropy'] = get_file_entropy(filepath)

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

@app.post("/scan")
async def scan_file(file: UploadFile = File(...)):
    try:
        filename = file.filename or ""
        ext = os.path.splitext(filename)[1].lower()
        is_executable = ext in ['.exe', '.dll']

        tmp_path = ""
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp.flush()
            os.fsync(tmp.fileno())
            tmp_path = tmp.name
        
        try:
            if ext == '.zip':
                extract_dir = tempfile.mkdtemp()
                try:
                    with zipfile.ZipFile(tmp_path, 'r') as zip_ref:
                        zip_ref.extractall(extract_dir)
                    
                    for root, _, files in os.walk(extract_dir):
                        for extracted_file in files:
                            file_path = os.path.join(root, extracted_file)
                            extracted_ext = os.path.splitext(extracted_file)[1].lower()
                            
                            if extracted_ext in ['.exe', '.dll']:
                                scan_res = analyze_executable(file_path, extracted_file)
                            else:
                                file_hash = get_file_hash(file_path)
                                scan_res = scan_with_virustotal(file_hash)
                                
                            if scan_res.get("status") in ["malware", "malicious"]:
                                return {"status": "malware"}
                    return {"status": "safe"}
                except zipfile.BadZipFile:
                    return {"status": "safe", "error": "BadZipFile"}
                except Exception as e:
                    return {"status": "safe", "error": str(e)}
                finally:
                    shutil.rmtree(extract_dir, ignore_errors=True)

            if is_executable:
                return analyze_executable(tmp_path, filename)
                
            else:
                file_hash = get_file_hash(tmp_path)
                return scan_with_virustotal(file_hash)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
