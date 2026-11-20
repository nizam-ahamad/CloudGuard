# CloudGuard Project Context & Onboarding Guide 🛡️

> [!IMPORTANT]
> ### 🚨 MANDATORY AI AGENT & DEVELOPER RULE
> **Any AI model or developer executing a prompt or modifying code in this repository MUST automatically update `PROJECT_CONTEXT.md` and `DESIGN.md` before committing whenever features, architecture, routes, or UI/UX rules change.**  
> **NEVER alter or overwrite the public `README.md` unless explicitly requested by the user.** The public `README.md` is reserved for public GitHub visitors and portfolio presentation.

---

## 📖 Project Overview & Core Philosophy

CloudGuard is an enterprise-grade, privacy-first secure cloud vault and digital asset management platform. It combines static AI malware detection, direct cloud object storage, and high-performance client-side media pipelines to deliver lightning-fast previews with **near-zero EC2 server load**.

### ⚡ Zero-EC2-Load Architecture

Traditional cloud storage platforms process and transcode files on expensive backend application servers, driving up compute bills and introducing severe I/O bottlenecks. CloudGuard operates on a radically different architectural model:

1. **Direct Object Storage Transfer:** All bulk file payloads stream directly to and from Backblaze B2 (S3-compatible API) via short-lived or 24-hour presigned URLs. The Node.js EC2 backend never proxies heavy file streams.
2. **Client-Side Thumbnail Ingestion:** WebP/JPEG thumbnails (320px, <40 KB) are extracted in the user's browser during upload (`thumbnailHelper.js`), converting HEIC/HEIF via WebAssembly, and pushed directly to `thumbnails/{userId}/` in B2 upon upload finalization.
3. **Off-Thread Browser Previews:** High-resolution HEIC/HEIF decoding runs off the main UI thread via a dedicated Web Worker (`heicWorker.js`) using WebAssembly `libheif-js`.
4. **Zero-Server Card Previews:** Grid card visual previews for PDFs (first-page canvas rendering via `pdfjs-dist`), text/code files (first 2 KB HTTP Range requests), and video frame snapshots execute 100% inside the browser (`cardPreviewGenerator.js`).

---

## 🛠️ Tech Stack & Infrastructure

| Layer | Technologies & Services | Hosting & Deployment |
| :--- | :--- | :--- |
| **Frontend** | React 19, Vite 8, Tailwind CSS v4, Lucide Icons, PDF.js (`pdfjs-dist`), `libheif-js` (WASM), Framer Motion, Plyr, Axios | **Cloudflare Pages / Vercel** (Continuous deployment from `main`) |
| **Backend Gateway** | Node.js (>=18), Express 4, Mongoose 8, Multer (memoryStorage), AWS SDK v3 (`@aws-sdk/client-s3`), Helmet, Rate Limiter, Resend API | **AWS EC2** (Ubuntu Linux, Nginx reverse proxy, PM2) |
| **Cloud Storage** | Backblaze B2 (S3-Compatible Object Storage) | `uploads/` (original files) & `thumbnails/` (WebP previews) |
| **Database** | MongoDB (Atlas / Self-Hosted) | High-speed compound indexes (`userId`, `folderId`, `isTrash`) |
| **Payment Gateway** | Cashfree Payments (REST API & Webhooks) | Essential (50GB), Pro (100GB), Ultra (200GB) subscription tiers |
| **AI Malware Service** | Python 3, FastAPI, Scikit-learn (Random Forest), Pefile, Boto3 | Isolated microservice performing static structural analysis on PEs |
| **Admin & Telemetry** | Founder Monitor (`AdminMonitor.jsx` & `admin.js`) | Real-time system vitals, telemetry, user quotas, and refund controls |

---

## 📁 Repository Map

```
CloudGuard/
├── client/                               # Frontend Single-Page Application (React 19 + Vite + Tailwind v4)
│   ├── src/
│   │   ├── App.jsx                       # Core dashboard controller, folder navigation, My Files & Recents views
│   │   ├── main.jsx                      # React root mount
│   │   ├── index.css                     # Global styles, Tailwind base layer, and page-level scrollbar control
│   │   ├── config.js                     # Dynamic API base URL configuration
│   │   ├── components/
│   │   │   ├── FileGridCard.jsx          # Unified Google Drive-style file cards with live preview integration
│   │   │   ├── FilePreviewModal.jsx      # Universal media & document lightbox with 25-item LRU cache
│   │   │   ├── BinView.jsx               # Trash management, soft-delete restoration, and permanent purge
│   │   │   ├── Sidebar.jsx               # Navigation drawer, storage quota indicator, and view toggles
│   │   │   ├── MoveModal.jsx             # Recursive folder destination picker
│   │   │   ├── FileDetailsModal.jsx      # File metadata, MIME details, and audit history
│   │   │   ├── FolderDetailsModal.jsx    # Recursive folder statistics and size calculation
│   │   │   ├── StorageQuotaBanner.jsx    # Quota threshold warning banner
│   │   │   ├── SubscriptionAlertBanner.jsx # Billing and expiration alerts
│   │   │   └── TrialBanner.jsx           # 14-day evaluation countdown banner
│   │   ├── pages/
│   │   │   ├── PhotosView.jsx            # High-performance media gallery & photo lightbox
│   │   │   ├── AdminMonitor.jsx          # Founder telemetry, storage consumption, and account controls
│   │   │   ├── AuthPage.jsx              # Sign-up, Sign-in, and OAuth flows
│   │   │   ├── LandingPage.jsx           # Public landing and product showcase
│   │   │   ├── Pricing.jsx               # Cashfree subscription tiers and upgrade flows
│   │   │   └── Settings.jsx              # User preferences, security, and profile settings
│   │   ├── utils/
│   │   │   ├── accessUrlCache.js         # 25-min TTL presigned URL cache with in-flight deduplication
│   │   │   ├── cardPreviewGenerator.js   # Viewport-gated PDF.js, Range-text, and video frame generator
│   │   │   ├── heicDecoder.js            # HEIC decoding manager, priority queue, and watchdog
│   │   │   ├── thumbnailHelper.js        # Upload-time thumbnail extractor (EXIF-aware)
│   │   │   ├── folderUpload.js           # Recursive folder tree parsing on drag-and-drop
│   │   │   ├── formatters.js             # Byte size, date, and extension utilities
│   │   │   └── cashfree.js               # Cashfree client checkout integration
│   │   └── workers/
│   │       └── heicWorker.js             # Dedicated Web Worker running libheif-js WASM off the main thread
│   └── package.json
├── server/                               # Backend Gateway (Node.js + Express + MongoDB)
│   ├── server.js                         # Application entry point, global middleware, and route mounting
│   ├── routes/
│   │   ├── files.js                      # Uploads, multipart chunking, presigning, trash, and permanent purge
│   │   ├── folders.js                    # Hierarchical directory CRUD and single-query BFS subtree lookups
│   │   ├── photos.js                     # Media-specific presigned thumbnail and preview indexing
│   │   ├── auth.js                       # JWT authentication, Argon2/Bcrypt hashing, and OTP verification
│   │   ├── payments.js                   # Cashfree subscriptions, webhooks, and PDF invoice generation
│   │   └── admin.js                      # Founder analytics, user quotas, and storage reconciliation
│   ├── models/
│   │   ├── User.js                       # User schema, storage limits, and subscription state
│   │   ├── File.js                       # File metadata, s3Key, thumbnailKey, and securityStatus
│   │   ├── Folder.js                     # Recursive directory schema with unique sibling constraint
│   │   └── Payment.js                    # Payment transaction and subscription history
│   ├── middleware/
│   │   ├── auth.js                       # Bearer JWT verification
│   │   ├── requireAdmin.js               # Admin/Founder role verification
│   │   ├── ownership.js                  # Multi-tenant resource ownership validator
│   │   └── rateLimiter.js                # Distributed IP rate limiting
│   ├── utils/
│   │   ├── tenantQuery.js                # Multi-tenant MongoDB query builder
│   │   ├── s3Delete.js                   # Backblaze B2 S3 key and version purging
│   │   └── emailService.js               # Resend transactional email integration
│   └── package.json
├── ai-service/                           # Static PE Malware Detection Microservice
│   ├── main.py                           # FastAPI application and S3 header scanner
│   ├── train_model.py                    # Random Forest training script
│   └── rf_model.pkl                      # Serialized Scikit-learn classification model
├── README.md                             # Public GitHub portfolio front page (UNTOUCHED)
├── PROJECT_CONTEXT.md                    # Internal project context & AI onboarding guide (this file)
├── DESIGN.md                             # Living architectural specification & UI/UX design rules
└── AGENTS.md                             # Automated guidelines and guardrails for AI coding assistants
```

---

## 🔒 Strict Engineering Guardrails

1. **Frontend-Only vs. Backend Isolation:** Never modify files in `server/**` during frontend-only tasks. The backend runs on an EC2 instance with strict resource constraints; all media transformations, thumbnail extraction, and previews must remain on the client browser.
2. **Single Global Outer Scrollbar:** Never introduce nested `overflow-y-auto`, `overflow-y-scroll`, or artificial height caps (`max-h-`, `h-[calc(...)]`) on file/folder lists. The document body (`html { overflow-y: auto }`) handles all vertical scrolling. Only modals, slide-out drawers, and table horizontal overflows (`md:overflow-x-auto`) may manage local scrolling.
3. **Consistent Green (`emerald-500`) Selection:** All item selection borders, checkboxes, and highlight tints across **Photos**, **My Files**, **Recents**, and **Bin** must use the unified `emerald-500` color scheme.
4. **Mandatory Build Verification:** Always run `npm --prefix client run build` after editing client files to ensure zero compilation or bundling regressions before committing.
