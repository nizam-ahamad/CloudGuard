# CloudGuard Project Context & Onboarding Guide 🛡️

> [!IMPORTANT]
> ### 🚨 MANDATORY AI AGENT & DEVELOPER RULE
> **Any AI model or developer executing a prompt or modifying code in this repository MUST automatically update `PROJECT_CONTEXT.md` and `DESIGN.md` before committing whenever features, architecture, routes, or UI/UX rules change.**  
> **NEVER alter or overwrite the public `README.md` unless explicitly requested by the user.** The public `README.md` is reserved for public GitHub visitors and portfolio presentation.

---

## 📖 Project Overview & Core Philosophy

CloudGuard is an enterprise-grade, privacy-first secure cloud vault and digital asset management platform. It combines static AI malware detection, direct cloud object storage, and high-performance client-side media pipelines to deliver lightning-fast previews with **near-zero EC2 server load**.

### 🔐 Security & Encryption Architecture: Zero-Trust vs. E2EE
CloudGuard intentionally implements **server-side AES-256 encryption at rest** and **TLS 1.3 in transit** combined with **Zero-Trust per-request access control**, rather than blind client-side zero-knowledge end-to-end encryption (E2EE):
1. **Server-Side AES-256 Encryption at Rest:** Backblaze B2 encrypts stored assets at rest with AES-256.
2. **Zero-Trust Ephemeral Access:** Every file download, thumbnail, and stream request requires short-lived, HMAC-SHA256 presigned tokens (`/api/files/:id/access` and `/api/photos`) generated on demand following strict tenant authentication and quota validation.
3. **Intentional Non-Zero-Knowledge Rationale:** Client-side zero-knowledge encryption prevents servers from inspecting file headers, rendering automated malware scanning, static PE heuristic classification, and account password recovery impossible. CloudGuard balances enterprise-grade encryption with automated malware prevention and threat detection.

### 🔑 Two-Factor Authentication (TOTP 2FA) Architecture
CloudGuard implements RFC 6238 Time-Based One-Time Password (TOTP) two-factor authentication with single-use recovery backup codes:
1. **Zero Client Compute Overhead:** 2FA cryptographic secret generation and QR code rasterization execute entirely on the backend (`otplib` and `qrcode`). No heavy crypto packages are shipped in the client bundle.
2. **AES-256-GCM Encrypted Secret Storage:** TOTP secrets are encrypted at rest using AES-256-GCM with a dynamic initialization vector (IV) and authentication tag before saving to MongoDB, preventing database exposure from compromising plaintext secrets. Secrets and backup codes have `select: false` by default in Mongoose.
3. **Single-Use Recovery Codes:** Enabling 2FA generates 8 cryptographically secure 8-character recovery codes (`XXXX-XXXX`) hashed with bcrypt in MongoDB. Using a backup code during a 2FA challenge atomically purges it from the user's array.
4. **Two-Stage Authentication Flow:** When a user with 2FA enabled submits valid credentials via `/api/auth/login` or Google OAuth (`/api/auth/google`), the backend issues an ephemeral 5-minute JWT (`purpose: '2fa_pending'`). The user must verify a 6-digit TOTP code or recovery code via `/api/auth/2fa/verify-login` (protected by `otpLimiter`) to receive a full 7-day session token.

### 🍪 HttpOnly Session Authentication & Origin CSRF Guard
To eliminate XSS-based session hijacking risks:
1. **HttpOnly Cookie Storage (`cg_auth_token`):** Primary API session JWTs are stored in an `HttpOnly; Secure; SameSite=None; Domain=.cloudguard.site` cookie issued with a 7-day lifetime (`SameSite=Lax` in local development). JavaScript cannot access the session JWT.
2. **Origin CSRF Protection:** All state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) that rely on the cookie session without an explicit `Authorization: Bearer` header must pass strict Origin/Referer matching against `ALLOWED_ORIGINS`. Machine-to-machine endpoints (like `/api/payments/webhook`) are exempted.
3. **Dual Authentication Support:** `server/middleware/auth.js` checks `req.cookies?.cg_auth_token` first, retaining backward-compatible fallback to `Authorization: Bearer` headers and query token strings.
4. **Instant Invalidation via `tokenVersion`:** Session revocation (logout, password change, account deletion) increments `tokenVersion` in MongoDB and clears both `cg_auth_token` and `cg_vault_session` cookies, instantly invalidating active sessions.

### 🛡️ DPDP-Compliant Deletion Audit & Abuse Prevention
To prevent repeat free-trial farming and refund cycling after account deletion without retaining plaintext PII:
1. **One-Way Salted HMAC-SHA256 Email Logging (`DeletedAccountLog`):** When a user triggers account erasure (`DELETE /api/auth/account`), their personal details, files, and database records are permanently erased. Simultaneously, a salted HMAC-SHA256 digest (`hashDeletedEmail(email)`) is upserted into `DeletedAccountLog` with `hadTrial: true`, `claimedRefund: boolean`, and `deletedAt: Date`.
2. **Free-Trial Consumption on Re-Signup:** If a previously deleted email re-registers via local registration or Google OAuth, the system permits account creation but immediately marks the trial as consumed (`trialAlreadyUsed: true`, `plan: 'free'`, `trialExpiresAt = new Date()`, `storageLimit = 0`, `subscription.status = 'expired'`). The user cannot upload assets until subscribing to a paid plan.
3. **Persistent Refund Abuse Mitigation:** Prior refund history (`claimedRefund: true`) persists across account cycles, permanently preventing repeat 7-day annual refunds (`server/routes/payments.js`).

### 🤖 Env-Gated Cloudflare Turnstile Bot Protection
To eliminate automated credential stuffing, bot-driven trial farming, and OTP flooding:
1. **Protected Endpoints:** Email/password registration (`/api/auth/register`), login (`/api/auth/login`), and password-reset OTP dispatch (`/api/auth/forgot-password`) enforce single-use Turnstile token validation.
2. **Safe Rollout Guard:** Verification is strictly env-gated (`TURNSTILE_SECRET_KEY`). If unconfigured, the verification helper safely skips validation (`{ success: true, skipped: true }`), ensuring local development and staging environments function seamlessly.
3. **Bounded Verification Latency:** Backend verification to Cloudflare's `siteverify` API is bound to a 4000ms timeout (`AbortSignal.timeout(4000)`).
4. **OAuth & Secondary Auth Exemption:** Google OAuth (`/api/auth/google`), 2FA challenges (`/api/auth/2fa/verify-login`), and logout (`/api/auth/logout`) remain completely unencumbered by Turnstile.
5. **Adaptive Client Widget:** The client active auth view (`AuthPage.jsx` mounted at `/login` in `App.jsx`, alongside `Auth.jsx`) renders a dark-theme Turnstile challenge (`theme: 'dark'`) only when `VITE_TURNSTILE_SITE_KEY` is present, with automatic token refresh on errors and mode switches.

### ⚡ Zero-EC2-Load & Zero-Egress Storage Architecture

Traditional cloud storage platforms process and transcode files on expensive backend application servers, driving up compute bills and introducing severe I/O bottlenecks. CloudGuard operates on a radically different architectural model:

1. **Direct Object Storage Transfer & Zero-Egress CDN:** All bulk file payloads stream directly to private Backblaze B2 (`cloudguard-vault-b2`, `eu-central-003`) via browser-direct presigned `PUT`/multipart uploads. Downstream file downloads, media streaming, and thumbnails are proxied through a specialized Cloudflare Worker (`cloudguard-b2-egress` on `files.cloudguard.site`) enabling $0/GB egress via the Cloudflare Bandwidth Alliance. The Node.js EC2 backend never proxies heavy file streams.
2. **Client-Side Thumbnail Ingestion:** WebP/JPEG thumbnails (320px, <40 KB) are extracted in the user's browser during upload (`thumbnailHelper.js`), converting HEIC/HEIF via WebAssembly, and pushed directly to `thumbnails/{userId}/` in B2 upon upload finalization.
3. **Off-Thread Browser Previews:** High-resolution HEIC/HEIF decoding runs off the main UI thread via a dedicated Web Worker (`heicWorker.js`) using WebAssembly `libheif-js`.
4. **Zero-Server Card Previews:** Grid card visual previews for PDFs (first-page canvas rendering via `pdfjs-dist`), text/code files (first 2 KB HTTP Range requests), and video frame snapshots execute 100% inside the browser (`cardPreviewGenerator.js`).
5. **Instant Frame-1 Video Streaming & Document Previews:** Videos stream via HTML5 players configured with `preload="metadata"` and programmatic `onLoadedData` playback triggers (avoiding Chromium `autoPlay` buffering stalls) alongside thumbnail posters. Microsoft Word (`.docx`) previews render 100% in-browser via `DocxPreviewModal` using `jszip` with a single outer scrollbar.
6. **CDN Edge Authentication (`cg_vault_session`):** Downstream media access on `files.cloudguard.site` is guarded at the Cloudflare Worker edge by an `HttpOnly; Secure; SameSite=None; Domain=.cloudguard.site` HMAC-SHA256 signed session cookie (`server/utils/edgeAuth.js`). The edge worker enforces tenant path isolation (`/uploads/<userId>/`, `/thumbnails/<userId>/`), Referer validation, and cross-origin authentication (`crossOrigin="use-credentials"` on client `<img>`/`<video>` elements). Presigned GET URLs are short-lived (300s for previews/thumbnails, 60s for downloads).

---

## 🛠️ Tech Stack & Infrastructure

| Layer | Technologies & Services | Hosting & Deployment |
| :--- | :--- | :--- |
| **Frontend** | React 19, Vite 8, Tailwind CSS v4, Lucide Icons, PDF.js (`pdfjs-dist`), `libheif-js` (WASM), JSZip, Framer Motion, Axios | **Cloudflare Pages / Vercel** (Continuous deployment from `main`) |
| **Backend Gateway** | Node.js (>=18), Express 4, Mongoose 8, Multer (memoryStorage), AWS SDK v3 (`@aws-sdk/client-s3`), Helmet, Rate Limiter, Resend API | **AWS EC2** (Ubuntu Linux, Nginx reverse proxy, PM2) |
| **Cloud Storage & CDN** | Private Backblaze B2 (`cloudguard-vault-b2`, `eu-central-003`) & Cloudflare Worker (`cloudguard-b2-egress` on `files.cloudguard.site`) | Direct browser presigned PUT/multipart uploads & $0/GB egress CDN caching |
| **Database** | MongoDB (Atlas / Self-Hosted) | High-speed compound indexes (`userId`, `folderId`, `isTrash`) |
| **Payment Gateway** | Cashfree Payments (REST API & Webhooks) | Essential (50GB), Pro (100GB), Ultra (200GB) subscription tiers |
| **AI Malware Service** | Python 3, FastAPI, Scikit-learn (Random Forest), Pefile, Boto3 | Isolated microservice performing static structural analysis on PEs (≤ 512 MB) |
| **Admin & Telemetry** | Founder Monitor (`AdminMonitor.jsx` & `admin.js`) | Real-time system vitals, telemetry, user quotas, and refund controls |

---

## 📁 Repository Map

```
CloudGuard/
├── client/                               # Frontend Single-Page Application (React 19 + Vite + Tailwind v4)
│   ├── src/
│   │   ├── App.jsx                       # Core dashboard controller, DocxPreviewModal (single scrollbar), folder navigation
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
│   │   │   ├── TrialBanner.jsx           # 14-day evaluation countdown banner
│   │   │   └── ProfileSettings.jsx       # Profile, password, 2FA management & account controls
│   │   ├── pages/
│   │   │   ├── PhotosView.jsx            # High-performance media gallery & photo lightbox
│   │   │   ├── AdminMonitor.jsx          # Founder telemetry, storage consumption, and account controls
│   │   │   ├── AuthPage.jsx              # Sign-up, Sign-in, 2FA challenge, and OAuth flows
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
│   │   ├── sanitize.js                   # Defense-in-depth NoSQL, control-byte, and input validators
│   │   ├── requireAdmin.js               # Admin/Founder role verification
│   │   ├── ownership.js                  # Multi-tenant resource ownership validator
│   │   └── rateLimiter.js                # Distributed IP rate limiting
│   ├── utils/
│   │   ├── tenantQuery.js                # Multi-tenant MongoDB query builder
│   │   ├── s3Delete.js                   # Backblaze B2 S3 key and version purging
│   │   ├── emailService.js               # Resend transactional email integration
│   │   └── edgeAuth.js                   # HMAC-SHA256 signing for cg_vault_session edge cookie and CDN download URLs
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
2. **Single Global Outer Scrollbar:** Never introduce nested `overflow-y-auto`, `overflow-y-scroll`, or artificial height caps (`max-h-`, `h-[calc(...)]`) on file/folder lists. The document body (`html { overflow-y: auto }`) handles all vertical scrolling. Only modals, slide-out drawers, and table horizontal overflows (`md:overflow-x-auto`) may manage local scrolling. Outer layout wrappers enforce `overflow-x: clip` rather than `overflow-x: hidden` to avoid creating scroll containers that break `position: sticky`.
3. **Consistent Green (`emerald-500`) Selection:** All item selection borders, checkboxes, and highlight tints across **Photos**, **My Files**, **Recents**, and **Bin** must use the unified `emerald-500` color scheme.
4. **Mandatory Build Verification:** Always run `npm --prefix client run build` after editing client files to ensure zero compilation or bundling regressions before committing.
5. **Route-Aware Canonical & Robots SEO Rule:** Public marketing and legal routes (`/`, `/pricing`, `/privacy`, `/terms`, `/refund`, `/contact`) dynamically update `<link rel="canonical">` to `https://cloudguard.site{pathname}` and `<meta name="robots">` to `index, follow`. Private, authenticated, and utility routes (`/dashboard`, `/login`, `/monitor`, `/reset-password/*`, etc.) dynamically set `<meta name="robots">` to `noindex, nofollow` and fallback canonical to `https://cloudguard.site/` to prevent private vault views or transient auth screens from leaking into search indexes.
6. **Scrollbar-Free Sticky Legal TOC Navigation:** In legal documentation pages (Privacy Policy, Terms of Service), the "On This Page" TOC sidebar uses `lg:sticky lg:top-20 lg:self-start` with `items-start` on the grid parent, staying pinned through the entire document without any inner scrollbars (`overflow-y-auto` and `max-h-*` strictly prohibited on the sidebar). Compact vertical spacing (`p-4` card padding, `space-y-0.5` on links, `space-y-3` on aside) ensures all section items and navigation action buttons display completely without clipping across standard viewport heights (~600px). Target sections use `scroll-mt-24` for clean offset below the sticky header.
7. **TOTP Two-Factor Authentication (2FA) Security Standards:** All 2FA verification endpoints are rate-limited (`otpLimiter`). TOTP secrets are encrypted with AES-256-GCM at rest and never exposed to the client. Recovery backup codes are hashed using bcrypt and enforced as strictly single-use. The client UI provides both QR scan and manual copy keys during setup, alongside `.txt` download and copy utilities for emergency recovery codes.
8. **Defense-in-Depth Input Sanitization & Character Policy:**
   - **Global NoSQL & Control-Byte Sanitizer:** `globalSanitizeMiddleware` (`server/middleware/sanitize.js`) recursively scans `req.body`, `req.query`, and `req.params`, immediately stripping keys starting with `$` or containing `.` to prevent MongoDB query selector injection.
   - **Control-Character Stripping:** Removes null bytes (`\0`) and non-printable ASCII control bytes (`[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]`) from all incoming strings, while strictly exempting sensitive credential keys (`['password', 'currentPassword', 'newPassword', 'credential', 'tempToken', 'token']`) so bcrypt passwords and cryptographic tokens are never altered.
   - **Display Name Policy:** Names are capped at 2..60 characters and must not contain `< > { } [ ] ;` or script tags. Both client Display Name inputs (`ProfileSettings.jsx`, `Auth.jsx`, `AuthPage.jsx`) enforce `maxLength={60}` and reactive character stripping on change.
   - **Vault Item Constraints & Colon Normalization:** Files and folders are validated via `validateVaultItemName` (1..120 chars), forbidding `.` / `..`, control characters, and filesystem-breaking characters `[<>:"/\\|?*]`. For uploaded filenames (e.g. macOS screenshot timestamps), colons (`:`) are automatically normalized to hyphens (`-`) during upload initialization (`/presigned-url` and `/multipart/init`) before vault character validation.
   - **Freeform Content & Search Query Bounds:** Freeform contact/support text undergoes `sanitizePlainText` to strip HTML tags, script blocks, inline handlers, and residual `<`/`>` (name ≤ 60, subject ≤ 120, message ≤ 2000). All search queries (`req.query.search`) are capped at 100 characters before regex escaping to mitigate ReDoS.
   - **Email Domain Verification & Disposable Blocklist:** Replaced static consumer-only domain allowlists with a disposable domain blocklist (`DISPOSABLE_EMAIL_ROOTS`) and real-time DNS MX record resolution (`dns.promises.resolveMx`) with a 2500ms timeout that fails open on transient network errors, welcoming legitimate corporate, university, and custom domains while repelling burner/spam addresses.
   - **Grief-Resistant Account Lockout:** In `POST /api/auth/login`, 7 consecutive incorrect password attempts lock the account for 15 minutes (`lockUntil`), returning HTTP 429. The lockout and failure counter are automatically cleared upon successful password authentication or password reset. Google OAuth logins are never blocked by password lockout.
9. **Zero-Egress CDN & Edge Cookie Security Standards:**
   - Storage transfers utilize private Backblaze B2 bucket `cloudguard-vault-b2` (`eu-central-003`) with direct browser presigned `PUT`/multipart uploads.
   - All file downloads, streaming, and thumbnails route via Cloudflare Worker `cloudguard-b2-egress` on `files.cloudguard.site` for $0/GB egress.
   - Access to `files.cloudguard.site` is protected by `HttpOnly; Secure; SameSite=None; Domain=.cloudguard.site` cookie `cg_vault_session` issued by `edgeAuth.js`.
   - The edge worker validates tenant paths (`/uploads/<userId>/`, `/thumbnails/<userId>/`) against the token payload and validates the Referer header.
   - All client `<img>` and `<video>` tags rendering `files.cloudguard.site` URLs must specify `crossOrigin="use-credentials"`.
   - Presigned GET URLs are short-lived: 300 seconds for previews/thumbnails and 60 seconds for downloads.
10. **High-Performance Document & Media Previews:**
   - Word documents (`.docx`) use client-side in-memory XML parsing via `DocxPreviewModal` (`jszip`) with a single scrollable body container.
   - Video streaming begins immediately on frame 1 using `preload="metadata"` and `onLoadedData` playback triggers (omitting `autoPlay` to avoid Chromium buffer stalls), supported by `posterUrl` thumbnails and non-blocking centered buffering spinners.
   - AI malware inspection caps scans at 512 MB; files above this threshold are marked `unverified`.
