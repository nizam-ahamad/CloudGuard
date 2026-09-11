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


def calculate_entropy(data):
    if not data:
        return 0.0
    entropy = 0
    for x in range(256):
        p_x = float(data.count(x)) / len(data)
        if p_x > 0:
            entropy += - p_x * math.log(p_x, 2)
    return entropy

def get_file_hash(file_bytes):
    return hashlib.sha256(file_bytes).hexdigest()

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

def analyze_executable(file_path):
    if rf_model is None:
        # Graceful fallback to VT if ML model fails to load
        with open(file_path, 'rb') as f:
            return scan_with_virustotal(get_file_hash(f.read()))

    features = {}
    try:
        pe = pefile.PE(file_path)
        features['SizeOfOptionalHeader'] = pe.FILE_HEADER.SizeOfOptionalHeader
        features['Characteristics'] = pe.FILE_HEADER.Characteristics
        features['MajorLinkerVersion'] = pe.OPTIONAL_HEADER.MajorLinkerVersion
        features['SizeOfInitializedData'] = pe.OPTIONAL_HEADER.SizeOfInitializedData
        pe.close()
        
        with open(file_path, 'rb') as f:
            data = f.read()
        features['Entropy'] = calculate_entropy(data)
            
    except Exception as e:
        # Fallback for non-PE files ending in .exe or .dll
        with open(file_path, 'rb') as f:
            data = f.read()
        
        features['SizeOfOptionalHeader'] = 0
        features['Characteristics'] = 0
        features['MajorLinkerVersion'] = 0
        features['SizeOfInitializedData'] = len(data)
        features['Entropy'] = calculate_entropy(data)

    df = pd.DataFrame([features])
    
    # Ensure column order matches training data
    columns = ['SizeOfOptionalHeader', 'Characteristics', 'MajorLinkerVersion', 'SizeOfInitializedData', 'Entropy']
    df = df[columns]

    # Make prediction
    prediction = rf_model.predict(df)[0]
    return {"status": "malware" if prediction == 1 else "safe"}

class ScanRequest(BaseModel):
    file_url: str

@app.post("/scan")
async def scan_file(request: ScanRequest):
    file_url = request.file_url
    if not file_url:
        raise HTTPException(status_code=400, detail="No file URL provided")

    try:
        response = requests.get(file_url, stream=True)
        response.raise_for_status()
        
        ext = os.path.splitext(file_url.split('?')[0])[1].lower()
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    tmp.write(chunk)
            tmp_path = tmp.name
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not download file from S3")
        
    try:
        is_executable = ext in ['.exe', '.dll']

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
                            scan_res = analyze_executable(file_path)
                        else:
                            with open(file_path, 'rb') as f:
                                file_hash = get_file_hash(f.read())
                            scan_res = scan_with_virustotal(file_hash)
                            
                        if scan_res.get("status") in ["malware", "malicious"]:
                            return {"status": "malware"}
                return {"status": "safe"}
            except zipfile.BadZipFile:
                return {"status": "safe"}
            except Exception as e:
                return {"status": "safe"}
            finally:
                shutil.rmtree(extract_dir, ignore_errors=True)

        if is_executable:
            return analyze_executable(tmp_path)
            
        else:
            with open(tmp_path, 'rb') as f:
                file_bytes = f.read()
            file_hash = get_file_hash(file_bytes)
            return scan_with_virustotal(file_hash)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
