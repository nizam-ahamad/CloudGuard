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
   - Server authentication (`server/middleware/auth.js`) prioritizes `req.cookies?.cg_auth_token` with fallback to `Authorization: Bearer <token>` and query parameter token.
   - Origin CSRF verification middleware (`server/server.js`) guards all state-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`) for cookie-authenticated requests lacking an explicit Bearer header, validating incoming `Origin`/`Referer` against `ALLOWED_ORIGINS`. Machine-to-machine webhooks (`/api/payments/webhook`) are exempted.
   - Client persists `localStorage.setItem('cg_session_active', '1')` without storing sensitive raw JWTs in storage, verifying session freshness on initial mount via `GET /api/auth/me`. Session termination (logout or account deletion) clears both `cg_auth_token` and `cg_vault_session` cookies and increments `tokenVersion` to invalidate any existing tokens.
9. **DPDP-Compliant Deletion Audit & Abuse Prevention (`DeletedAccountLog`):**
   - Upon permanent account deletion (`DELETE /api/auth/account`), all personal data, files, and folders are purged immediately. To prevent repeat free-trial farming and refund cycling without retaining plaintext PII, a one-way HMAC-SHA256 salted hash (`emailHash = hashDeletedEmail(email)`) is upserted into `DeletedAccountLog` alongside `hadTrial: true`, `claimedRefund: boolean`, and `deletedAt`.
   - On re-registration or Google auth provisioning with a previously deleted email, account creation is permitted, but the free trial is marked consumed (`trialAlreadyUsed: true`, `plan: 'free'`, `trialExpiresAt = new Date()`, `storageLimit = 0`, `subscription.status = 'expired'`).
   - Prior refund claims (`claimedRefund: true`) permanently transfer to prevent repeat 7-day annual refunds (`hasPriorRefund = true` in `server/routes/payments.js`).
10. **Env-Gated Cloudflare Turnstile Bot Defense (`VITE_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`):**
    - Email/password registration (`POST /api/auth/register`), login (`POST /api/auth/login`), and password-reset OTP requests (`POST /api/auth/forgot-password`) enforce Turnstile token verification via `verifyTurnstileToken(token, remoteIp)`.
    - **Safe Fallback Guard:** If `TURNSTILE_SECRET_KEY` is undefined, verification is safely skipped (`{ success: true, skipped: true }`), preventing lockout in local development and environments without configured keys.
    - When `TURNSTILE_SECRET_KEY` is present, verification executes against `https://challenges.cloudflare.com/turnstile/v0/siteverify` using a 4000ms `AbortSignal.timeout(4000)` deadline.
    - Google OAuth (`/api/auth/google`), session logout (`/api/auth/logout`), and 2FA verification (`/api/auth/2fa/verify-login`) remain completely unencumbered by Turnstile.
    - Client renders Turnstile dynamically inside `Auth.jsx` in dark mode (`theme: 'dark'`) only when `VITE_TURNSTILE_SITE_KEY` is populated, automatically resetting the widget on failure or view switch.

---

## 4. Verification & Pre-Commit Safety Protocol

Before pushing or completing any prompt:
1. **Verify Client Build:** Run `npm --prefix client run build` to ensure the bundle compiles with exit code 0 and no TypeScript/JSX syntax errors.
2. **Verify File Scope:** Run `git --no-pager diff --name-only` and `git status --short` to verify that **strictly allowlisted files** were modified.
3. **Commit Cleanly:** Commit with a descriptive conventional commit message and push to `origin/main`.
