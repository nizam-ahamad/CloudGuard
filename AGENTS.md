# CloudGuard AI Agent Operating Instructions 🤖

> [!IMPORTANT]
> This file establishes mandatory operating rules for all AI coding assistants, models, and autonomous agents (Antigravity, Cursor, Claude Code, GitHub Copilot, Codex, etc.) working inside this repository.

---

## 1. Mandatory Pre-Execution & Documentation Rules

1. **Read Context First:** Before planning or implementing any code changes, read `README.md` and `DESIGN.md` to understand existing architecture, design tokens, and pipeline constraints.
2. **Mandatory Documentation Updates on EVERY Prompt:**
   - **Whenever code, features, UI rules, or API endpoints change, you MUST update `README.md` and `DESIGN.md` in the exact same turn before committing.**
   - Add newly introduced milestones or architectural shifts to the Changelog in `DESIGN.md`.
   - Never complete a task leaving documentation out of sync with your changes.

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

1. **Zero-EC2-Load Rule:**
   - Never introduce backend image conversion, thumbnail resizing, or video transcoding endpoints on the EC2 server.
   - Heavy decoding (e.g. HEIC/HEIF) belongs in `client/src/workers/heicWorker.js` via WebAssembly.
   - Presigned URLs (`/api/files/:id/access` and `/api/photos`) must be used for direct Backblaze B2 access.
2. **Single Global Outer Scrollbar Standard:**
   - **Never add `overflow-y-auto`, `overflow-y-scroll`, or inner height caps (`max-h-`, `h-[calc(...)]`) to file or folder list containers.**
   - The outer page scrollbar (`html { overflow-y: auto }`) handles all vertical scrolling.
   - Use `overflow-visible md:overflow-x-auto` on list containers so mobile touch scrolling is never trapped inside nested scroll boundaries.
3. **Unified Green (`emerald-500`) Selection:**
   - All selection rings, borders, background highlights, and checkboxes across **Photos**, **My Files**, **Recents**, and **Bin** must use `emerald-500`. Do not use blue selection styling.
4. **Always-Visible Action Menus (`⋮`):**
   - Three-dots action buttons must remain visible (`opacity-100`) on both desktop and mobile across all file types.
   - Active open menus must receive `relative z-50` to prevent z-index clipping by adjacent cards.
5. **Memory & Concurrency Bounds:**
   - Cap decoded HEIC canvas dimensions at `2048px` max edge.
   - Maintain LRU caching with automatic `URL.revokeObjectURL()` cleanup.
   - Teardown video streams immediately on slide change (`src = ''`, `load()`).

---

## 4. Verification & Pre-Commit Safety Protocol

Before pushing or completing any prompt:
1. **Verify Client Build:** Run `npm --prefix client run build` to ensure the bundle compiles with exit code 0 and no TypeScript/JSX syntax errors.
2. **Verify File Scope:** Run `git --no-pager diff --name-only` and `git status --short` to verify that **strictly allowlisted files** were modified.
3. **Commit Cleanly:** Commit with a descriptive conventional commit message and push to `origin/main`.
