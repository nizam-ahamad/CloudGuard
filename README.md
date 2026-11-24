# CloudGuard

Privacy-first cloud file vault with direct-to-object storage, zero-egress CDN delivery, and real-time AI malware defense.

**Live:** [https://cloudguard.site](https://cloudguard.site)

## Key Features
- **Direct Storage & $0 Egress CDN:** Browser uploads stream directly to Backblaze B2 via presigned URLs; downloads and media stream through a Cloudflare Worker edge proxy (`files.cloudguard.site`).
- **AI Malware Defense:** Uploads are verified via hash checks and a FastAPI Random Forest PE header classifier (`<= 512 MB`), automatically purging flagged threats before quota is committed.
- **Client-Side Previews:** Off-thread WASM `.HEIC` decoding (`libheif-js`), in-memory `.docx` rendering (`JSZip`), `ArrayBuffer` PDF thumbnails (`pdfjs-dist`), and instant frame-1 video playback.
- **Hardened Security:** `HttpOnly` session cookies (`cg_auth_token`), signed edge media cookies (`cg_vault_session`), Cloudflare Turnstile, Google OAuth 2.0, TOTP 2FA, and strict tenant isolation.
- **Billing & Invoicing:** Cashfree Payment Gateway integration with tiered storage plans (5 GB–200 GB), prorated upgrades, webhook fulfillment, and sequential invoices (`CG-INV-YYYY-XXXX`).

## Tech Stack
| Layer | Stack |
| :--- | :--- |
| **Frontend** | React 19, Vite 8, Tailwind CSS v4, PDF.js, `libheif-js` (WASM), JSZip (Cloudflare Pages) |
| **Backend** | Node.js, Express 4, Mongoose 8, AWS SDK v3, Helmet (AWS EC2, Nginx, PM2) |
| **AI Scanner** | Python 3, FastAPI, Scikit-learn, `pefile` (`127.0.0.1:8000`) |
| **Storage & Services** | Backblaze B2, Cloudflare Workers, MongoDB Atlas, Cashfree PG, Resend |

## Structure
```text
CloudGuard/
├── client/      # React 19 SPA, WASM media workers, document previewers, checkout UI
├── server/      # Express API, cookie/OAuth/2FA auth, S3 presigner, Cashfree webhooks
└── ai-service/  # FastAPI static PE malware classifier
```

## Quick Start
```bash
# Install dependencies
npm --prefix client install && npm --prefix server install && pip install -r ai-service/requirements.txt

# Configure server/.env and client/.env, then run:
uvicorn main:app --app-dir ai-service --host 127.0.0.1 --port 8000
npm --prefix server run dev
npm --prefix client run dev
```
