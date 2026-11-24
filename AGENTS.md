# CloudGuard AI Agent Operating Instructions 🤖

> [!IMPORTANT]
> This file establishes mandatory operating rules for all AI coding assistants, models, and autonomous agents (Antigravity, Cursor, Claude Code, GitHub Copilot, Codex, etc.) working inside this repository.

---

## 1. Mandatory Pre-Execution & Documentation Rules

1. **Read Context First:** Before planning or implementing any code changes, read `PROJECT_CONTEXT.md` and `DESIGN.md` to understand existing architecture, design tokens, and pipeline constraints.
2. **Mandatory Documentation Updates on EVERY Prompt:**
   - **Whenever code, features, UI rules, or API endpoints change, you MUST update `PROJECT_CONTEXT.md` and `DESIGN.md` in the exact same turn before committing.**
   - Add newly introduced milestones or architectural shifts to the Changelog in `DESIGN.md`.
   - Never complete a task leaving documentation out of sync with your changes.
3. **DO NOT Overwrite Public `README.md`:**
   - **NEVER modify, overwrite, or alter the public `README.md` unless explicitly requested by the user.**
   - `README.md` is reserved as the public GitHub repository showcase. All internal system context, engineering rules, and technical documentation belong in `PROJECT_CONTEXT.md` and `DESIGN.md`.

---

## 2. Strict Boundary & File Discipline

1. **Observe File Allowlists:** Strictly adhere to the file allowlist provided in each user prompt.
2. **Frontend vs. Backend Isolation:**
   - **DO NOT TOUCH `server/**`** when tasked with frontend-only features, UI/UX changes, or client performance optimizations.
   - The backend runs on a resource-constrained AWS EC2 instance. All media decoding, rendering, thumbnails, and preview generation must execute client-side.
3. **Preserve Mission-Critical Components:**
   - Do not alter `UploadContext.jsx`, `TrialBanner.jsx`, `SubscriptionAlertBanner.jsx`, or `AdminMonitor.jsx` unless explicitly instructed.

---

## 3. Core Architectural Guardrails

1. **Zero-EC2-Load & Zero-Egress Storage Rule:**
   - Never introduce backend image conversion, thumbnail resizing, or video transcoding endpoints on the EC2 server.
   - Direct browser presigned `PUT`/multipart uploads stream to private Backblaze B2 (`cloudguard-vault-b2`, `eu-central-003`).
   - Downstream file downloads, media streaming, and thumbnails route through the Cloudflare Worker (`cloudguard-b2-egress` on `files.cloudguard.site`) for `$0/GB` egress.
   - Heavy decoding (e.g. HEIC/HEIF) belongs in `client/src/workers/heicWorker.js` via WebAssembly.
   - Document previews (e.g. `.docx`) must execute client-side via `jszip` inside `DocxPreviewModal`.
2. **Single Global Outer Scrollbar Standard:**
   - **Never add `overflow-y-auto`, `overflow-y-scroll`, or inner height caps (`max-h-`, `h-[calc(...)]`) to file or folder list containers.**
   - The outer page scrollbar (`html { overflow-y: auto }`) handles all vertical scrolling.
   - Use `overflow-visible md:overflow-x-auto` on list containers so mobile touch scrolling is never trapped inside nested scroll boundaries.
   - Modal containers (such as `DocxPreviewModal`) must maintain a single scrollable body container without nested inner document sheet scrollbars.
3. **Unified Green (`emerald-500`) Selection:**
   - All selection rings, borders, background highlights, and checkboxes across **Photos**, **My Files**, **Recents**, and **Bin** must use `emerald-500`. Do not use blue selection styling.
4. **Always-Visible Action Menus (`⋮`):**
   - Three-dots action buttons must remain visible (`opacity-100`) on both desktop and mobile across all file types.
   - Active open menus must receive `relative z-50` to prevent z-index clipping by adjacent cards.
5. **Memory & Concurrency Bounds:**
   - Cap decoded HEIC canvas dimensions at `2048px` max edge.
   - Maintain LRU caching with automatic `URL.revokeObjectURL()` cleanup.
   - Teardown video streams immediately on slide change (`src = ''`, `load()`).
6. **CDN Edge Authentication & Session Security (`cg_vault_session`):**
   - Media access on `files.cloudguard.site` requires an `HttpOnly; Secure; SameSite=None; Domain=.cloudguard.site` HMAC-SHA256 signed session cookie (`cg_vault_session`) issued by `server/utils/edgeAuth.js`.
   - The Cloudflare Worker edge enforces tenant path isolation (`/uploads/<userId>/`, `/thumbnails/<userId>/`) and Referer validation.
   - All client `<img>` and `<video>` tags rendering `files.cloudguard.site` assets must specify `crossOrigin="use-credentials"`.
   - S3 presigned GET URLs are short-lived: 300 seconds for previews/thumbnails and 60 seconds for downloads.
7. **Instant Frame-1 Video Streaming:**
   - Video players (`PreviewVideo` in `FilePreviewModal.jsx`) must begin playback immediately on the first decoded frame using `preload="metadata"` and `onLoadedData` playback triggers.
   - Never add the `autoPlay` attribute to `<video>` as Chromium will block playback until dozens of megabytes are buffered (`HAVE_ENOUGH_DATA`).
   - Always supply `posterUrl` thumbnails and non-blocking centered buffering spinners.
8. **API Session Security & HttpOnly Auth Cookie (`cg_auth_token`):**
   - API session JWTs are issued in an `HttpOnly; Secure; SameSite=None; Domain=.cloudguard.site` cookie (`cg_auth_token`) via `server/utils/edgeAuth.js` (`attachAuthCookie`) with a 7-day TTL (or `SameSite=Lax` in local development).
   - Server authentication (`server/middleware/auth.js`) prioritizes `req.cookies?.cg_auth_token` with fallback to raw cookie parsing (`req.headers.cookie`), Bearer token header, and query parameter token. Invalid literal placeholders (`Bearer null`, `Bearer undefined`, `Bearer cookie-session`) are explicitly ignored. Session `tokenVersion` comparison is normalized numerically (`Number(decoded.tokenVersion ?? 0) === Number(dbUser.tokenVersion ?? 0)`) across all authentication flows (including 2FA verification `/api/auth/2fa/verify-login`), with structured `[Auth 401]` diagnostic logging on any rejection.
   - Origin CSRF verification middleware (`server/server.js`) guards all state-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`) for cookie-authenticated requests lacking an explicit Bearer header, validating incoming `Origin`/`Referer` against `ALLOWED_ORIGINS`. Machine-to-machine webhooks (`/api/payments/webhook`) are exempted.
   - Client persists `localStorage.setItem('cg_session_active', '1')` without storing sensitive raw JWTs in storage, verifying session freshness on initial mount via `GET /api/auth/me`. Axios defaults, request interceptors, and a global `window.fetch` wrapper guarantee `withCredentials = true` and `credentials: 'include'` on all cross-subdomain requests (`https://cloudguard.site` -> `https://api.cloudguard.site`), while systematically stripping invalid Authorization headers (`Bearer null`, `Bearer cookie-session`). Production cookie issuance in `server/utils/edgeAuth.js` reliably enforces `domain: '.cloudguard.site'`, `sameSite: 'none'`, and `secure: true` by evaluating `reqHost`, `reqOrigin`, `forwardedHost`, `reqReferer`, `CLIENT_URL`, `API_URL`, and `NODE_ENV`.
   - Redirect loop & bounce prevention: on 401 response or arrival at `/login?expired=true`, `cg_session_active`, `token`, and `user` are immediately removed from storage, preventing `/dashboard` <-> `/login?expired=true` infinite loops. 2FA verification (`handleVerify2FA` in `AuthPage.jsx`) enforces hard navigation (`window.location.href = dest`) to ensure a clean remount with newly issued HttpOnly session cookies. Vault storage stats are queried through modular, cookie-authenticated endpoints (`/api/files/storage-stats` and `/api/auth/storage-stats`), exempting telemetry syncs from global 401 redirect destruction while logging `[Auth Redirect Trigger]` with source, status, and URL on genuine authorization failures. Session termination (logout or account deletion) clears both `cg_auth_token` and `cg_vault_session` cookies and increments `tokenVersion` to invalidate any existing tokens.
9. **DPDP-Compliant Deletion Audit & Abuse Prevention (`DeletedAccountLog`):**
   - Upon permanent account deletion (`DELETE /api/auth/account`), all personal data, files, and folders are purged immediately. To prevent repeat free-trial farming and refund cycling without retaining plaintext PII, a one-way HMAC-SHA256 salted hash (`emailHash = hashDeletedEmail(email)`) is upserted into `DeletedAccountLog` alongside `hadTrial: true`, `claimedRefund: boolean`, and `deletedAt`.
   - On re-registration or Google auth provisioning with a previously deleted email, account creation is permitted, but the free trial is marked consumed (`trialAlreadyUsed: true`, `plan: 'free'`, `trialExpiresAt = new Date()`, `storageLimit = 0`, `subscription.status = 'expired'`).
   - Prior refund claims (`claimedRefund: true`) permanently transfer to prevent repeat 7-day annual refunds (`hasPriorRefund = true` in `server/routes/payments.js`).
10. **Env-Gated Cloudflare Turnstile Bot Defense (`VITE_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`):**
    - Email/password registration (`POST /api/auth/register`), login (`POST /api/auth/login`), and password-reset OTP requests (`POST /api/auth/forgot-password`) enforce Turnstile token verification via `verifyTurnstileToken(token, remoteIp)`.
    - **Safe Fallback Guard:** If `TURNSTILE_SECRET_KEY` is undefined, verification is safely skipped (`{ success: true, skipped: true }`), preventing lockout in local development and environments without configured keys.
    - When `TURNSTILE_SECRET_KEY` is present, verification executes against `https://challenges.cloudflare.com/turnstile/v0/siteverify` using a 4000ms `AbortSignal.timeout(4000)` deadline.
    - Google OAuth (`/api/auth/google`), session logout (`/api/auth/logout`), and 2FA verification (`/api/auth/2fa/verify-login`) remain completely unencumbered by Turnstile.
    - Client renders Turnstile dynamically inside active auth components (`AuthPage.jsx` and `Auth.jsx`) in dark mode (`theme: 'dark'`) only when `VITE_TURNSTILE_SITE_KEY` is populated, automatically resetting the widget on failure or view switch.
11. **Mobile Preview Modal Header Resilience, 25-Min Signed-URL Prefetch Cache & Video Poster Wiring:**
    - Preview modal overlays use `fixed inset-0 z-50 w-screen max-w-full overflow-x-hidden` and inner containers use `w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col`.
    - Preview modal headers (`DocxPreviewModal` and `UnifiedFilePreviewModal` in `client/src/App.jsx`, and media Lightbox in `client/src/pages/PhotosView.jsx`) maintain responsive geometry across mobile viewports (`360px`–`393px`): header row uses `flex items-center justify-between gap-2 sm:gap-3 w-full max-w-full px-3 sm:px-4 py-3 border-b border-white/10 shrink-0`, left title wrapper uses `flex items-center gap-2 min-w-0 flex-1 overflow-hidden`, title element uses `block min-w-0 flex-1 truncate text-sm sm:text-base font-medium text-white` with `title={originalName || name}`, and right action cluster enforces `<div className="flex items-center gap-2 shrink-0">` with BOTH Download and Close (`X`) buttons (`shrink-0`).
    - Video previews across My Files and Photos display instant blurred preview thumbnails (`filter blur-sm opacity-60 object-contain`) behind a single centered loading spinner while streaming URLs resolve or video buffers, with `poster={thumbnailUrl}` on `<video>`.
    - At most ONE centered loader (`Loader2 animate-spin`) is displayed during loading/buffering; duplicate bottom-right/secondary spinners are prohibited. The loader clears immediately on media ready (`onLoadedData`, `onCanPlay`, `onPlaying`, `onLoad`).
    - Presigned `thumbnailUrl` (rewritten via `process.env.CDN_DOWNLOAD_URL` if configured) is attached to all files in `GET /api/files` (`thumbnailKey` selected) and `GET /api/files/:id/access`, unifying WebP poster availability across My Files, Recents, and Photos.
    - Module-level `accessUrlCache` (Map with 25-minute TTL matching S3 signed URL validity) caches direct signed URLs across tab switches and user actions in both `App.jsx` and `PhotosView.jsx`.
    - Non-blocking hover/touch prefetch (`prefetchFileAccessUrl` triggered on `onMouseEnter` / `onTouchStart` across grid cards, table rows, and action menus) retrieves signed access URLs in advance via lightweight JSON API calls without transferring heavy media bytes.
12. **Admin Monitor Route Targeting & Cloaked Authorization (`requireAdmin`):**
    - The Founder Monitor view (`client/src/pages/AdminMonitor.jsx`) defines `API_BASE_URL` dynamically (`(import.meta.env.VITE_API_URL || (window.location.hostname.endsWith('cloudguard.site') ? 'https://api.cloudguard.site' : 'http://localhost:5000')).replace(/\/$/, '')`), ensuring all requests (`GET /api/admin/overview`, `POST /api/admin/users/:userId/reset-refund`) route to the backend domain with `withCredentials: true` and stripped invalid Bearer placeholders (`Bearer null`, `Bearer cookie-session`).
    - Admin authorization middleware (`server/middleware/requireAdmin.js`) safely resolves `userId` via `req.user?.id || req.user?._id || req.user?.userId` (with fallback to `cg_auth_token` HttpOnly cookie, raw `Cookie` header, Bearer token, and query param token). If `req.user?.email` is present and matches `ADMIN_EMAILS`, it allows access immediately; otherwise it queries MongoDB for the user email and checks `ADMIN_EMAILS`, returning cloaked `404 Not Found` for any unauthenticated or unauthorized access.
13. **Automated Client-Side HEIC/HEIF WebP Thumbnail Engine & Backfill Script:**
    - Browser upload pipeline (`client/src/utils/thumbnailHelper.js`) identifies `.heic`/`.heif` files via MIME pattern (`/^image\/(heic|heif)(-sequence)?$/i`) and filename extension (`/\.(heic|heif)$/i`), including uploads with empty (`""`) or `application/octet-stream` MIME types.
    - Decodes HEIC/HEIF in-browser via lazy-imported `heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 })` (isolated to a dynamic chunk to prevent main bundle bloat and ensure zero impact on JPEG, PNG, WebP, GIF, or video upload speeds) before feeding into the `<canvas>` pipeline.
    - Resizes to max `512px` WebP (`quality: 0.78`) so `POST /api/files/finalize-upload` receives a `data:image/webp;base64,...` payload without server-side CPU load, storing to `thumbnails/{userId}/{timestamp_ms}-{fileId}.webp` in Backblaze B2 and linking `thumbnailKey` in MongoDB.
    - Legacy `.heic`/`.heif` assets missing `thumbnailKey` are processed via `ai-service/backfill_heic_thumbnails.py`, which downloads objects from B2, decodes with `pillow_heif` + `PIL.Image`, resizes to max `512px` WebP (`quality=78`), uploads to `thumbnails/{userId}/{timestamp_ms}-{fileId}.webp`, and updates MongoDB.
14. **Same-Origin `pdfjs-dist` Worker Bundling & Persistent Data URL Cache (`pdfThumbnailCache`):**
    - The PDF.js worker is bundled as a same-origin static asset using Vite's `?url` import (`import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`) and configured via `pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl`, ensuring matching versions with zero third-party CDN latency or CSP issues.
    - PDF page 1 thumbnail generation (`generatePdfThumbnail` in `client/src/utils/cardPreviewGenerator.js`) passes `{ url: accessUrl, withCredentials: false }` to prevent S3 CORS rejection on signed URLs, rasterizes onto an off-screen `<canvas>` at scale `~0.6–0.8` with a solid white background, converts to Base64 `image/webp` (with PNG fallback), and caches in a persistent module-level `Map` (`pdfThumbnailCache`) keyed by `file._id`.
    - `FileGridCard.jsx` reads `pdfThumbnailCache` on initial mount to instantly show PDF thumbnails across folder navigation and re-renders without re-fetching or re-parsing. The red `PDF` document sheet card serves strictly as a fallback if the file is encrypted, corrupt, or fails to render.
15. **Pricing Page HttpOnly Cookie Session Hydration & Cashfree Checkout Modal:**
    - The Pricing view (`client/src/pages/Pricing.jsx`) defines `API_BASE_URL` dynamically (`(import.meta.env.VITE_API_URL || (window.location.hostname.endsWith('cloudguard.site') ? 'https://api.cloudguard.site' : 'http://localhost:5000')).replace(/\/$/, '')`) and configures Axios with `withCredentials: true`, systematically stripping invalid Bearer headers (`Bearer null`, `Bearer cookie-session`).
    - Hydrates active user sessions on mount via `GET /api/auth/me` with `withCredentials: true`, setting `user` in state and local storage, triggering `refreshUser()` to sync active subscription status (`/api/payments/subscription-status`), and dispatching `cloudguard:auth-changed`, eliminating all reliance on raw JWTs in `localStorage`.
    - Plan selection (`handleSelectPlan`) and checkout (`executeCheckout`) trigger directly for authenticated users, opening the Order Summary modal and initiating Cashfree checkout (`cashfree.checkout({ paymentSessionId, redirectTarget: '_modal' })`) with dynamic SDK script loading from `https://sdk.cashfree.com/js/v3/cashfree.js`.
    - Scheduled and deferred downgrades display confirmation toast notifications and dismiss cleanly without redirecting to `/dashboard`.
    - In `client/src/App.jsx`, `AuthenticatedLoginRedirect` preserves internal redirect targets (`?redirect=/pricing...`) on `/login`, `/register`, and `/signup` routes for authenticated sessions, preventing unintended fallback bounces to `/dashboard`.

---

## 4. Verification & Pre-Commit Safety Protocol

Before pushing or completing any prompt:
1. **Verify Client Build:** Run `npm --prefix client run build` to ensure the bundle compiles with exit code 0 and no TypeScript/JSX syntax errors.
2. **Verify File Scope:** Run `git --no-pager diff --name-only` and `git status --short` to verify that **strictly allowlisted files** were modified.
3. **Commit Cleanly:** Commit with a descriptive conventional commit message and push to `origin/main`.
