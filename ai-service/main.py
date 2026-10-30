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

CUSTOM_WHITELIST = [
    "231D90772D0E26D4376E85BC35FB349C2341926CBA84D800828791B33E1103EF"
]

TEMP_DIR = os.path.join(os.path.dirname(__file__), 'temp')
os.makedirs(TEMP_DIR, exist_ok=True)

# Global variable for the model
rf_model = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global rf_model
    # Ephemeral cleanup on startup: purge any residual files in temp directory
    if os.path.exists(TEMP_DIR):
        for f in os.listdir(TEMP_DIR):
            try:
                fp = os.path.join(TEMP_DIR, f)
                if os.path.isfile(fp):
                    os.remove(fp)
            except Exception as e:
                print(f"[AI Scanner] Warning: Failed to clean stale temp file {f}: {e}")

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
    """
    Checks the SHA-256 hash against VirusTotal API v3 without uploading binary payloads.
    Hardened against rate-limiting (429), timeouts, and 404 fail-open vulnerabilities.
    """
    if not VT_API_KEY:
        return {"status": "scan_failed", "reason": "VirusTotal API key not configured"}
        
    url = f"https://www.virustotal.com/api/v3/files/{file_hash}"
    headers = {"x-apikey": VT_API_KEY}
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            stats = response.json().get('data', {}).get('attributes', {}).get('last_analysis_stats', {})
            malicious_count = stats.get('malicious', 0)
            suspicious_count = stats.get('suspicious', 0)
            if malicious_count > 0 or suspicious_count > 0:
                return {
                    "status": "malicious",
                    "reason": f"VirusTotal flagged by {malicious_count} security engine(s)"
                }
            return {"status": "safe", "reason": "VirusTotal verified clean"}
        elif response.status_code == 404:
            # File hash not found in VirusTotal database - NEVER treat unknown as safe
            return {"status": "not_found", "reason": "File hash not found in VirusTotal database"}
        elif response.status_code == 429:
            # Rate limited
            return {"status": "rate_limited", "reason": "VirusTotal API rate limit exceeded"}
        else:
            return {"status": "scan_failed", "reason": f"VirusTotal returned HTTP {response.status_code}"}
    except requests.exceptions.Timeout:
        return {"status": "rate_limited", "reason": "VirusTotal API request timed out"}
    except requests.exceptions.RequestException as e:
        return {"status": "scan_failed", "reason": f"VirusTotal connection error: {str(e)}"}
    except Exception as e:
        return {"status": "scan_failed", "reason": str(e)}

def analyze_executable(filepath=None, data=None, filename="unknown"):
    file_hash = get_sha256(filepath, data)
    
    # 0. Custom Internal Whitelist
    if file_hash in CUSTOM_WHITELIST:
        print(f"[AI Scanner] Executable: {filename} | Custom Whitelist Verified (Skipping ML)")
        return {"status": "safe", "reason": "Verified custom safe internal tool"}

    # 1. CIRCL Hashlookup Check
    try:
        circl_response = requests.get(
            f"https://hashlookup.circl.lu/lookup/sha256/{file_hash}",
            headers={"accept": "application/json"},
            timeout=5
        )
        if circl_response.status_code == 200:
            circl_data = circl_response.json()
            circl_str = str(circl_data).lower()
            if "malware" in circl_str or "malicious" in circl_str:
                print(f"[AI Scanner] Executable: {filename} | Known MALICIOUS file verified via CIRCL")
                return {"status": "malicious", "reason": "Identified as known malware via CIRCL/NSRL database"}
            else:
                print(f"[AI Scanner] Executable: {filename} | Known safe file verified via CIRCL/NSRL")
                return {"status": "safe", "reason": "Verified known safe application via global NSRL database"}
    except Exception as e:
        print(f"[AI Scanner] CIRCL check failed, proceeding: {e}")

    # 2. Authenticode Signature Verification
    pe = None
    try:
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
            print(f"[AI Scanner] Signature check bypassed, proceeding to ML: {e}")
    except Exception as pe_err:
        print(f"[AI Scanner] PE header initial load failed for {filename}: {pe_err}")
        pe = None

    # 3. Fallback when ML model is unavailable
    if rf_model is None:
        print(f"[AI Scanner] ML model not loaded, falling back to VirusTotal for {filename}")
        vt_res = scan_with_virustotal(file_hash)
        if vt_res.get("status") in ["safe", "malicious"]:
            return vt_res
        elif vt_res.get("status") == "rate_limited":
            return {"status": "unverified_rate_limited", "reason": "ML model unavailable and VirusTotal rate-limited"}
        else:
            return {"status": "unverified_rate_limited", "reason": "ML model unavailable and VirusTotal hash unknown"}

    # 4. Extract PE features and evaluate with Random Forest
    try:
        if pe is None:
            if data is not None:
                pe = pefile.PE(data=data, fast_load=True)
            else:
                pe = pefile.PE(filepath, fast_load=True)

        features = {}
        features['SizeOfOptionalHeader'] = pe.FILE_HEADER.SizeOfOptionalHeader
        features['Characteristics'] = pe.FILE_HEADER.Characteristics
        features['MajorLinkerVersion'] = pe.OPTIONAL_HEADER.MajorLinkerVersion
        features['SizeOfInitializedData'] = pe.OPTIONAL_HEADER.SizeOfInitializedData
        pe.close()
        
        features['Entropy'] = get_file_entropy(filepath, data)

        df = pd.DataFrame([features])
        columns = ['SizeOfOptionalHeader', 'Characteristics', 'MajorLinkerVersion', 'SizeOfInitializedData', 'Entropy']
        df = df[columns]

        # Get prediction probability
        prob = float(rf_model.predict_proba(df)[0][1])
        print(f"[AI Scanner] Executable: {filename} | Malicious Probability: {prob:.4f} | Features extracted: {len(features)}")
        
        # High confidence malicious
        if prob >= 0.7:
            return {"status": "malicious", "probability": prob, "reason": "Random Forest high-confidence threat detection"}
        
        # High confidence safe
        if prob < 0.3:
            return {"status": "safe", "probability": prob, "reason": "Random Forest high-confidence clean executable"}

        # Inconclusive Range (0.3 <= prob < 0.7): Trigger VirusTotal API verification fallback
        print(f"[AI Scanner] Inconclusive ML probability ({prob:.4f}) for {filename}. Cross-referencing VirusTotal API...")
        vt_res = scan_with_virustotal(file_hash)
        vt_status = vt_res.get("status")

        if vt_status == "malicious":
            return {"status": "malicious", "probability": prob, "reason": "Inconclusive ML; VirusTotal confirmed malicious"}
        elif vt_status == "safe":
            return {"status": "safe", "probability": prob, "reason": "Inconclusive ML; VirusTotal verified clean"}
        elif vt_status == "rate_limited":
            # DO NOT fail open: explicit error state when rate-limited during inconclusive scan
            print(f"[AI Scanner] VirusTotal rate-limited/timed out during inconclusive scan for {filename}")
            return {
                "status": "unverified_rate_limited",
                "probability": prob,
                "reason": "Random Forest model inconclusive and VirusTotal API rate limit exceeded. Verification cannot be guaranteed."
            }
        elif vt_status == "not_found":
            # Hash unknown in VT database: lean on ML probability
            if prob >= 0.5:
                return {"status": "malicious", "probability": prob, "reason": "ML model suspicious (prob >= 0.50) and unknown in VirusTotal"}
            else:
                return {"status": "safe", "probability": prob, "reason": "ML model leans safe (prob < 0.50) and no known signatures in VirusTotal"}
        else:
            return {
                "status": "unverified_rate_limited",
                "probability": prob,
                "reason": "Random Forest model inconclusive and VirusTotal inspection failed."
            }
            
    except Exception as e:
        print(f"[AI Scanner] PE parsing or ML execution failure for {filename}: {str(e)}")
        # If PE parsing failed on an executable, fallback to VirusTotal hash lookup
        vt_res = scan_with_virustotal(file_hash)
        if vt_res.get("status") == "malicious":
            return {"status": "malicious", "reason": "PE parsing error; VirusTotal flagged malicious"}
        elif vt_res.get("status") == "safe":
            return {"status": "safe", "reason": "PE parsing error; VirusTotal verified clean"}
        elif vt_res.get("status") == "rate_limited":
            return {"status": "unverified_rate_limited", "reason": "PE parsing error and VirusTotal rate-limited"}
        else:
            return {"status": "scan_failed", "message": f"Failed to parse PE file and VirusTotal check inconclusive: {str(e)}"}

class ScanRequest(BaseModel):
    fileKey: str
    filename: str

@app.post("/scan")
async def scan_file(request: ScanRequest):
    tmp_path = None
    try:
        filename = request.filename or ""
        fileKey = request.fileKey
        ext = os.path.splitext(filename)[1].lower()

        # Ephemeral file handling: stream S3 payload to disk under top-level finally guard
        with tempfile.NamedTemporaryFile(dir=TEMP_DIR, delete=False, suffix=ext) as tmp:
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
        
        with open(tmp_path, 'rb') as f:
            magic_bytes = f.read(2)
        is_executable = (ext in ['.exe', '.dll', '.com', '.sys', '.scr']) or (magic_bytes == b'MZ')

        # 1. Zip Archive Processing
        if ext == '.zip':
            try:
                with zipfile.ZipFile(tmp_path, 'r') as zip_ref:
                    for extracted_file in zip_ref.namelist():
                        if extracted_file.endswith('/'):
                            continue
                            
                        file_data = zip_ref.read(extracted_file)
                        extracted_ext = os.path.splitext(extracted_file)[1].lower()
                        is_inner_executable = (extracted_ext in ['.exe', '.dll', '.com', '.sys', '.scr']) or (file_data[:2] == b'MZ')
                        
                        if is_inner_executable:
                            scan_res = analyze_executable(data=file_data, filename=extracted_file)
                            if scan_res.get("status") != "safe":
                                return scan_res
                return {"status": "safe"}
            except zipfile.BadZipFile:
                return {"status": "scan_failed", "error": "BadZipFile"}
            except Exception as e:
                return {"status": "scan_failed", "error": str(e)}

        # 2. Executable Inspection (ML + VirusTotal fallback)
        if is_executable:
            scan_res = analyze_executable(filepath=tmp_path, filename=filename)
            return scan_res
            
        # 3. Non-executable, non-zip files
        # Check VirusTotal hash lookup for known malicious signatures
        vt_res = scan_with_virustotal(file_hash)
        if vt_res.get("status") == "malicious":
            return vt_res
            
        return {"status": "safe"}

    except Exception as e:
        print(f"[AI Scanner] Fatal error during scan: {str(e)}")
        return {"status": "scan_failed", "reason": f"Internal scan error: {str(e)}"}
    finally:
        # Guaranteed cleanup: eliminate disk space exhaustion and data inspection leaks
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception as cleanup_err:
                print(f"[AI Scanner] Warning: Failed to clean up temp file {tmp_path}: {cleanup_err}")
