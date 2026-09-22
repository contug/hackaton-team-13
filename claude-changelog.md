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

## 2026-09-22 13:06 — Background message router extracted to `lib/handlers.ts`
**What:** Moved `handle()` out of `entrypoints/background.ts` into `lib/handlers.ts` and exported it. `background.ts` now holds only `defineBackground` + the `onMessage` wiring. No behavior change.
**Why:** The router is the only place the API key is read and the only place network I/O is dispatched, so it is the thing most worth testing — and driving it through `fakeBrowser`'s listener plumbing is more fragile than calling it directly.
**Files:** lib/handlers.ts, entrypoints/background.ts, CLAUDE.md
**Verify:** `npm test -- tests/handlers.test.ts` (14 tests, incl. "never leaks the key — not the whole thing and not a fragment of it"); `npx wxt build` still emits a working `background.js`.

## 2026-09-22 13:06 — Vitest + jsdom test suite for `lib/` and the components
**What:** Added `vitest.config.ts` (jsdom + `WxtVitest()`), `tests/setup.ts`, `tests/helpers.ts`, `tests/fixtures.ts` and nine test files: openrouter, snapshot, refs, prompts, handlers, App, AskBox, SuggestionChips, cards. New scripts: `test`, `test:watch`, `check`. New devDeps: vitest 5, jsdom 30, `@testing-library/{react,dom,user-event,jest-dom}`.
**Why:** Nothing repeatable verified the two riskiest things in the codebase: the three-step OpenRouter degradation (schema → prompt-inlined retry → raw text), which cannot be eyeballed, and the "one answer on screen at a time" product rule, which nothing else stops eroding into a chat log. Both now fail loudly.
**Files:** vitest.config.ts, tests/*, package.json, package-lock.json, CLAUDE.md
**Verify:** `npm run check` → `tsc --noEmit` clean, 118 tests in 9 files pass. Proved the suite can go red: `clampSummary` returning 5 suggestions instead of 3 fails "clamping > cuts the lists to their documented limits"; making `App.tsx` keep the summary on screen alongside an answer fails "one answer on screen at a time > REPLACES the summary with the answer — there is no scrollback". Both reverted.

## 2026-09-22 13:06 — Tests run automatically after every edit
**What:** `scripts/test-on-change.sh` plus a committed `PostToolUse` hook in `.claude/settings.json` (matcher `Edit|Write|MultiEdit`, 120s timeout). The script reads `tool_input.file_path`, exits 0 for anything that is not a `.ts`/`.tsx` file under `lib/`, `components/`, `entrypoints/` or `tests/`, and otherwise runs `vitest related --run` on it — exiting 2 with the output on stderr so a failure lands back in the session. Added a "Testing" section to `CLAUDE.md`, and `.claude/settings.local.json` to `.gitignore`.
**Why:** `.claude/settings.json` is tracked, so the hook is present in every clone and every worktree without anyone remembering it. It is a safety net only: it runs *related* tests, so `npm run check` before reporting work as done is still the rule.
**Files:** scripts/test-on-change.sh, .claude/settings.json, .gitignore, CLAUDE.md
**Verify:** With `clampSummary` deliberately broken, piping `{"tool_input":{"file_path":"<repo>/lib/openrouter.ts"}}` into the script exits 2 and prints the failing `openrouter.test.ts` assertion; the same payload for `CLAUDE.md` exits 0 without running anything. Note: Claude Code loads hook config at session start, so a session that predates this file will not fire the hook until it is restarted.

## 2026-09-22 13:06 — Still open: extension injection is unverified
**What:** The test suite does not close the gap recorded at 12:37. No jsdom test can load an MV3 extension, components are mounted by Testing Library rather than inside a shadow root, and jsdom has no layout — `tests/setup.ts` stubs `getBoundingClientRect()` (and `innerText`), so "hidden because it has zero size" is simulated, not tested.
**Why:** Stating the boundary rather than letting 118 green tests imply coverage they do not have. "The panel actually renders on a real page" is still confirmed only by `npm run dev` and a human looking at it.
**Files:** none
**Verify:** Unchanged from the 12:37 entry — `npm run dev` and check the floating button appears.

## 2026-09-22 14:09 — feat/ui-resize fast-forwarded onto the vitest suite
**What:** `git merge --ff-only tests/vitest-suite` moved this branch from 0cb0f04 to d627860. The branch had no commits of its own, so this is a fast-forward, not a merge commit — the suite, the `PostToolUse` hook and the revised `CLAUDE.md` now apply here.
**Why:** UI-resize work needs the "one answer on screen at a time" and snapshot tests in place before it starts, so a regression in the panel's state machine fails loudly instead of being eyeballed. Taken from `tests/vitest-suite` rather than `feat/spotlight` — both point at the same commit, and this keeps the branch independent of spotlight.
**Files:** none authored here; 22 files arrived with d627860
**Verify:** `npm install` (229 new packages), then `npm run check` → `tsc --noEmit` clean, 118 tests in 9 files pass.

## 2026-09-22 14:18 — "Enlarge panel" button in the panel header
**What:** A third icon button in the panel top bar toggles the panel between 360×480 and 540×720 — half again as wide and half again as tall. The single hard-coded size string on the panel root was split into `PANEL_BASE` + a `PANEL_SIZE` map keyed by an `enlarged` boolean, and the enlarged variant carries `max-w-[calc(100vw_-_2.5rem)]` / `max-h-[min(720px,calc(100vh_-_2.5rem))]` viewport clamps. State is ephemeral React state, like `open` and `dismissed`.
**Why:** A long summary or a multi-line answer was cramped in 360×480 and the user had no way to give it room. Kept out of `storage` deliberately: a UI size flag needs neither the CSP protection nor the key containment that put the rest of the state in the background, and per-page size matches the per-tab isolation rule. The clamps are not decoration — the panel is anchored `bottom-5` and grows upward, so an unguarded 720px would push the header, and with it the restore and close buttons, off the top of a short viewport. Unlike Settings, the button is not gated on `view === 'assistant'`: the extra room helps on the setup form too.
**Files:** entrypoints/overlay.content/App.tsx, tests/App.test.tsx, claude-changelog.md
**Verify:** `npm test -- tests/App.test.tsx` — "panel size > enlarges the panel by half and restores it" and "panel size > offers the size control before the API key is set"; 120 tests pass overall and `tsc --noEmit` is clean via `npm run check`. Proved the first test can go red by pinning the class to `PANEL_SIZE['normal']` — it failed; reverted. `npx wxt build` emits all four arbitrary-value classes; Tailwind unwraps the nested `calc()` to `min(720px,100vh - 2.5rem)`, which Chrome accepts (checked in a real browser: at 500×600 the computed max-height is 560px and the panel renders 460px wide, so the clamps bite).
