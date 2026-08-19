import os
import random
import pefile
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

class ScanRequest(BaseModel):
    file_path: str

@app.post("/scan")
async def scan_file(request: ScanRequest):
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail="File not found")

    # Placeholder logic to read PE headers
    try:
        pe = pefile.PE(request.file_path)
        print(f"Successfully parsed PE file: {request.file_path}")
        print(f"Machine type: {hex(pe.FILE_HEADER.Machine)}")
    except Exception as e:
        print(f"Not a valid PE file or couldn't parse headers: {e}")

    # Dummy ML prediction (80% safe, 20% malware)
    is_safe = random.random() < 0.8
    status = "safe" if is_safe else "malware"
    
    return {"status": status}
