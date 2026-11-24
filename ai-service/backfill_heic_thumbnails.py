#!/usr/bin/env python3
"""
CloudGuard - One-Time HEIC/HEIF Thumbnail Backfill Engine

Finds active .heic / .heif files in MongoDB with missing or null thumbnailKey,
downloads the raw object from Backblaze B2, decodes with pillow_heif + PIL,
resizes to max 512px WebP (quality=78), uploads the thumbnail to B2 at:
  thumbnails/{userId}/{timestamp_ms}-{fileId}.webp
and updates file.thumbnailKey in MongoDB.
"""

import os
import sys
import time
import io
import argparse
from pathlib import Path
from dotenv import load_dotenv

# Optional imports handled gracefully
try:
    import boto3
except ImportError:
    boto3 = None

try:
    from pymongo import MongoClient
    from bson import ObjectId
except ImportError:
    MongoClient = None
    ObjectId = None

try:
    import pillow_heif
    from PIL import Image
    pillow_heif.register_heif_opener()
except ImportError:
    pillow_heif = None
    Image = None

# Load environment configuration from server/.env and ai-service/.env
current_dir = Path(__file__).resolve().parent
server_env = current_dir.parent / "server" / ".env"
ai_env = current_dir / ".env"

if server_env.exists():
    load_dotenv(server_env)
if ai_env.exists():
    load_dotenv(ai_env)

MONGO_URI = os.getenv("MONGO_URI") or os.getenv("MONGODB_URI")
AWS_BUCKET_NAME = (
    os.getenv("AWS_S3_BUCKET")
    or os.getenv("AWS_BUCKET_NAME")
    or os.getenv("AWS_S3_BUCKET_NAME")
)
AWS_ENDPOINT = os.getenv("AWS_ENDPOINT") or os.getenv("AWS_ENDPOINT_URL") or None
AWS_REGION = os.getenv("AWS_REGION", "eu-central-003")
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")


def check_dependencies():
    """Verify runtime dependencies before execution."""
    missing = []
    if boto3 is None:
        missing.append("boto3")
    if MongoClient is None:
        missing.append("pymongo")
    if pillow_heif is None:
        missing.append("pillow-heif")
    if Image is None:
        missing.append("pillow")
    if missing:
        print(f"[Backfill Error] Missing required dependencies: {', '.join(missing)}")
        print("Please install via: pip install " + " ".join(missing))
        sys.exit(1)


def decode_and_resize_heic(heic_bytes: bytes, max_dim: int = 512, quality: int = 78) -> bytes:
    """
    Decodes HEIC/HEIF bytes, resizes maintaining aspect ratio to max 512px,
    and returns WebP encoded bytes.
    """
    try:
        image = Image.open(io.BytesIO(heic_bytes))
    except Exception:
        heif_file = pillow_heif.read_heif(heic_bytes)
        image = Image.frombytes(
            heif_file.mode,
            heif_file.size,
            heif_file.data,
            "raw",
        )

    # Convert non-standard modes to RGB/RGBA for clean WebP encoding
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGB")

    # Resize preserving aspect ratio (max 512px edge)
    width, height = image.size
    if width > max_dim or height > max_dim:
        resample_filter = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.BICUBIC)
        image.thumbnail((max_dim, max_dim), resample_filter)

    out_buffer = io.BytesIO()
    image.save(out_buffer, format="WEBP", quality=quality, method=6)
    return out_buffer.getvalue()


def run_backfill(dry_run: bool = False, limit: int = 0):
    check_dependencies()

    if not MONGO_URI:
        print("[Backfill Error] MONGO_URI is missing in environment.")
        sys.exit(1)
    if not AWS_BUCKET_NAME:
        print("[Backfill Error] AWS_S3_BUCKET / AWS_BUCKET_NAME is missing in environment.")
        sys.exit(1)
    if not AWS_ACCESS_KEY_ID or not AWS_SECRET_ACCESS_KEY:
        print("[Backfill Error] AWS credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) missing.")
        sys.exit(1)

    print("=======================================================")
    print(" CloudGuard HEIC/HEIF Thumbnail Backfill Engine")
    print("=======================================================")
    print(f"Bucket:   {AWS_BUCKET_NAME}")
    print(f"Endpoint: {AWS_ENDPOINT or 'AWS Default'}")
    print(f"Region:   {AWS_REGION}")
    print(f"Dry Run:  {dry_run}")
    if limit > 0:
        print(f"Limit:    {limit}")
    print("-------------------------------------------------------")

    # Connect to MongoDB
    mongo_client = MongoClient(MONGO_URI)
    try:
        db = mongo_client.get_default_database()
        if db is None:
            db = mongo_client["cloudguard"]
    except Exception:
        db = mongo_client["cloudguard"]

    files_col = db["files"]

    # Connect to Backblaze B2 / S3
    s3_client = boto3.client(
        "s3",
        region_name=AWS_REGION,
        endpoint_url=AWS_ENDPOINT,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    )

    # Query active HEIC/HEIF files missing thumbnailKey
    query = {
        "isDeleted": {"$ne": True},
        "isTrash": {"$ne": True},
        "$or": [
            {"thumbnailKey": None},
            {"thumbnailKey": {"$exists": False}},
            {"thumbnailKey": ""},
        ],
        "$and": [
            {
                "$or": [
                    {"name": {"$regex": r"\.(heic|heif)$", "$options": "i"}},
                    {"originalName": {"$regex": r"\.(heic|heif)$", "$options": "i"}},
                    {"mimetype": {"$regex": r"^image/(heic|heif)", "$options": "i"}},
                    {"mimeType": {"$regex": r"^image/(heic|heif)", "$options": "i"}},
                ]
            }
        ],
    }

    cursor = files_col.find(query)
    if limit > 0:
        cursor = cursor.limit(limit)

    candidates = list(cursor)
    total_count = len(candidates)
    print(f"[Backfill] Found {total_count} candidate file(s) needing thumbnails.")

    if total_count == 0:
        print("[Backfill] All HEIC/HEIF files already have thumbnails. Nothing to do!")
        return

    success_count = 0
    fail_count = 0
    start_time = time.time()

    for idx, doc in enumerate(candidates, 1):
        file_id = str(doc["_id"])
        file_name = doc.get("originalName") or doc.get("name") or file_id
        user_id = str(doc.get("userId") or doc.get("user") or "unknown")
        s3_key = doc.get("s3Key")

        print(f"\n[{idx}/{total_count}] Processing '{file_name}' (ID: {file_id})...")

        if not s3_key:
            print(f"  [SKIP] File {file_id} has no s3Key.")
            fail_count += 1
            continue

        try:
            # 1. Download HEIC object from B2
            print(f"  Downloading s3Key: {s3_key}...")
            obj = s3_client.get_object(Bucket=AWS_BUCKET_NAME, Key=s3_key)
            raw_bytes = obj["Body"].read()

            if not raw_bytes:
                print(f"  [ERROR] File {file_id} is 0 bytes.")
                fail_count += 1
                continue

            # 2. Decode and resize to 512px WebP
            print(f"  Decoding HEIC & generating 512px WebP ({len(raw_bytes)} bytes)...")
            webp_bytes = decode_and_resize_heic(raw_bytes, max_dim=512, quality=78)

            timestamp_ms = int(time.time() * 1000)
            thumb_s3_key = f"thumbnails/{user_id}/{timestamp_ms}-{file_id}.webp"

            if dry_run:
                print(f"  [DRY RUN] Would upload {len(webp_bytes)} bytes to: {thumb_s3_key}")
                print(f"  [DRY RUN] Would update MongoDB doc {file_id} thumbnailKey.")
                success_count += 1
                continue

            # 3. Upload thumbnail to B2
            print(f"  Uploading thumbnail to {thumb_s3_key} ({len(webp_bytes)} bytes)...")
            s3_client.put_object(
                Bucket=AWS_BUCKET_NAME,
                Key=thumb_s3_key,
                Body=webp_bytes,
                ContentType="image/webp",
            )

            # 4. Update MongoDB record
            files_col.update_one(
                {"_id": doc["_id"]},
                {"$set": {"thumbnailKey": thumb_s3_key}},
            )
            print(f"  [SUCCESS] Thumbnail created and registered for {file_name}")
            success_count += 1

        except Exception as err:
            print(f"  [FAILED] Error processing {file_name}: {err}")
            fail_count += 1

    elapsed = round(time.time() - start_time, 2)
    print("\n=======================================================")
    print(" Backfill Summary")
    print("=======================================================")
    print(f"Total:      {total_count}")
    print(f"Succeeded:  {success_count}")
    print(f"Failed:     {fail_count}")
    print(f"Elapsed:    {elapsed}s")
    print("=======================================================")


def main():
    parser = argparse.ArgumentParser(description="Backfill WebP thumbnails for existing HEIC/HEIF files.")
    parser.add_argument("--dry-run", action="store_true", help="Inspect candidate files without writing thumbnails.")
    parser.add_argument("--limit", type=int, default=0, help="Maximum number of files to process (0 = all).")
    args = parser.parse_args()

    run_backfill(dry_run=args.dry_run, limit=args.limit)


if __name__ == "__main__":
    main()
