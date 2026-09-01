import os
import math
import pefile
import joblib
import pandas as pd
import requests
import hashlib
import tempfile
import shutil
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

@app.post("/scan")
async def scan_file(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = os.path.splitext(file.filename)[1].lower()
    
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not save file")
        
    try:
        is_executable = ext in ['.exe', '.dll']

        if is_executable:
            if rf_model is None:
                raise HTTPException(status_code=500, detail="ML model is not loaded")

            features = {}
            try:
                pe = pefile.PE(tmp_path)
                features['SizeOfOptionalHeader'] = pe.FILE_HEADER.SizeOfOptionalHeader
                features['Characteristics'] = pe.FILE_HEADER.Characteristics
                features['MajorLinkerVersion'] = pe.OPTIONAL_HEADER.MajorLinkerVersion
                features['SizeOfInitializedData'] = pe.OPTIONAL_HEADER.SizeOfInitializedData
                pe.close()
                
                with open(tmp_path, 'rb') as f:
                    data = f.read()
                features['Entropy'] = calculate_entropy(data)
                    
            except Exception as e:
                # Fallback for non-PE files ending in .exe or .dll
                with open(tmp_path, 'rb') as f:
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
            with open(tmp_path, 'rb') as f:
                file_bytes = f.read()
            file_hash = get_file_hash(file_bytes)
            return scan_with_virustotal(file_hash)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
