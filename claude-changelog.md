# Claude Changelog

Append-only log of every step taken in this repository, across all sessions and worktrees.
Newest entries at the bottom. See `CLAUDE.md` for the entry format and the rules.

---

## 2026-09-22 12:17 — Bootstrap CLAUDE.md and this changelog
**What:** Created `CLAUDE.md` (goal, product constraints, stack, commands, architecture) and seeded this changelog. Added `.gitattributes` marking `claude-changelog.md` as `merge=union`.
**Why:** The changelog rule has to exist before any code so that every subsequent step is recorded. `merge=union` is what makes "regardless of session or worktree" actually hold — parallel worktrees append without conflicting.
**Files:** CLAUDE.md, claude-changelog.md, .gitattributes
**Verify:** `cat CLAUDE.md`; `git check-attr merge claude-changelog.md` reports `merge: union`.

## 2026-09-22 12:37 — Scaffold the WXT + React + Tailwind extension
**What:** Added `package.json` (pinned to the versions already in `node_modules`), `wxt.config.ts`, `tsconfig.json`, `.gitignore`, and placeholder icons in `public/icon/`. Manifest declares only `storage` permission plus `https://openrouter.ai/*` host permission.
**Why:** `node_modules` was pre-seeded with no manifest of intent; pinning exact installed versions keeps `npm install` a no-op. No `tabs` permission because per-tab isolation means a content script only ever needs its own tab.
**Files:** package.json, wxt.config.ts, tsconfig.json, .gitignore, public/icon/*.png
**Verify:** `npx wxt prepare && npx tsc --noEmit && npx wxt build` — all clean.

## 2026-09-22 12:37 — Page snapshot: Readability content plus navigation outline
**What:** `lib/snapshot.ts` builds a `PageSnapshot` — Readability main text (on a cloned document) plus an outline of headings, landmarks, links, buttons and form fields with accessible names, visibility filtering, dedupe, a 200-entry cap and middle-truncation of body text. `lib/refs.ts` mints stable `e1`/`e2` ids via `WeakMap` + `WeakRef`.
**Why:** Summaries need prose, but "where do I click" needs structure — the outline is what makes navigation questions answerable. Truncating the *middle* rather than the tail keeps the bottom-of-page controls that dense pages hide there. The ref registry is the seam for future page interaction.
**Files:** lib/snapshot.ts, lib/refs.ts
**Verify:** Bundled with esbuild and run in Playwright against a synthetic article page and a synthetic billing dashboard. Article: Readability extracted title/byline/1295 chars, 12 outline entries, `display:none` and `visibility:hidden` elements correctly excluded. Dashboard: 19 entries including `field: Card number (text, required)` and the aria-labelled `button: Cancel your subscription`.

## 2026-09-22 12:37 — OpenRouter client in the background service worker
**What:** `lib/openrouter.ts` (chat calls, JSON-schema contract, three-step fallback, error mapping, key validation, model listing), `lib/prompts.ts`, `lib/settings.ts`, `lib/messaging.ts`, and `entrypoints/background.ts`.
**Why:** All network I/O sits in the service worker for two reasons — host-page CSP would block a content-script fetch on exactly the dense pages we target, and the API key must never enter the content script. Schemas deliberately omit `maxItems`: OpenAI-family models reject it under `strict: true`, and "any model" is a requirement, so limits are stated in the prompt and clamped client-side instead.
**Files:** lib/openrouter.ts, lib/prompts.ts, lib/settings.ts, lib/messaging.ts, entrypoints/background.ts
**Verify:** `npx tsc --noEmit`. Probed OpenRouter directly: `GET /api/v1/key` returns 401 unauthenticated, confirming it as the key-validation endpoint.

## 2026-09-22 12:37 — Panel UI in a shadow root
**What:** `entrypoints/overlay.content/` (content script, `App.tsx` state machine, `style.css`) plus `components/` — ApiKeySetup, AskBox, SummaryCard, AnswerCard, SuggestionChips, Skeleton.
**Why:** One result on screen at a time, replaced rather than appended — no scrollback. That is the structural defense against overload, not a styling choice. Shadow DOM isolates the panel from arbitrary host CSS; `:host { font-size: 16px }` is needed because `rem` otherwise resolves against the host page's root font size.
**Files:** entrypoints/overlay.content/*, components/*
**Verify:** `npx wxt build` produces a 329 kB chrome-mv3 bundle with the expected manifest. Browser-level verification of the injected panel is still outstanding — see the next entry.

## 2026-09-22 12:37 — Known gap: in-browser verification incomplete
**What:** Loading `.output/chrome-mv3` into headless Chrome via `--load-extension` and probing over CDP found no injected shadow host. Root cause not yet established — the extension may not have loaded at all in that headless profile rather than the content script having failed.
**Why:** Recording this rather than leaving it implied. The snapshot layer is verified against real DOMs and the build/typecheck are clean, but "the panel actually renders on a page" is NOT yet confirmed.
**Files:** none
**Verify:** Next step is `npm run dev`, which launches a real Chrome profile with the extension installed, and confirming the floating button appears on a normal page.
