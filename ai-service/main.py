import os
import math
import pefile
import joblib
import pandas as pd
import requests
import hashlib
from fastapi import FastAPI, HTTPException
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

class ScanRequest(BaseModel):
    file_path: str

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

@app.post("/scan")
async def scan_file(request: ScanRequest):
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail="File not found")

    ext = os.path.splitext(request.file_path)[1].lower()
    is_executable = ext in ['.exe', '.dll']

    if is_executable:
        if rf_model is None:
            raise HTTPException(status_code=500, detail="ML model is not loaded")

        features = {}
        try:
            pe = pefile.PE(request.file_path)
            features['SizeOfOptionalHeader'] = pe.FILE_HEADER.SizeOfOptionalHeader
            features['Characteristics'] = pe.FILE_HEADER.Characteristics
            features['MajorLinkerVersion'] = pe.OPTIONAL_HEADER.MajorLinkerVersion
            features['SizeOfInitializedData'] = pe.OPTIONAL_HEADER.SizeOfInitializedData
            pe.close()
            
            with open(request.file_path, 'rb') as f:
                data = f.read()
            features['Entropy'] = calculate_entropy(data)
                
        except Exception as e:
            # Fallback for non-PE files ending in .exe or .dll
            with open(request.file_path, 'rb') as f:
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
        
        status = "malware" if prediction == 1 else "safe"
        
        return {"status": status}
        
    else:
        with open(request.file_path, 'rb') as f:
            file_bytes = f.read()
        file_hash = get_file_hash(file_bytes)
        return scan_with_virustotal(file_hash)
