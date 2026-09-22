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

## 2026-09-22 13:54 — Answers can now say which element matters and why
**What:** Added `target_reason` to the answer contract: a required `string` on `ANSWER_SCHEMA` and on `interface Answer`, a bullet in `ASK_SYSTEM` asking for one short sentence about the FIRST ref, and clamping in `clampAnswer` (whitespace squashed, capped at 140 chars, forced to `''` when `refs` is empty). The raw-text fallback returns `''`, so the three-step degradation chain gains no new branch.
**Why:** The on-page spotlight needs a per-element explanation, and `refs` alone carries no "why". An empty-string sentinel rather than a nullable object because OpenAI-family strict mode requires every property to appear in `required`.
**Files:** lib/openrouter.ts, lib/prompts.ts, tests/openrouter.test.ts, tests/prompts.test.ts, tests/cards.test.tsx
**Verify:** `npm test -- tests/openrouter.test.ts tests/prompts.test.ts` — six new cases under "target_reason — the \"why this element\" sentence" (schema-required, squashed/trimmed, empty default, capped, dropped when refs is empty, empty on raw-text fallback) plus "asks for one short sentence explaining the first ref". Full suite 125 passed (was 118).

## 2026-09-22 14:00 — Spotlight geometry, as pure functions
**What:** New `lib/spotlight.ts`: `scrimRects` (viewport minus a hole, as up to four non-overlapping bands), `tooltipPlacement` (prefer below, flip above, clamp inside the viewport, dodge our own panel, and report `overlapsAvoid` rather than hide behind it), `isSpotlightable` (rejects 0x0 and anything over 60% of the viewport, so a model citing `<main>` cannot ring the whole page), `needsScroll`, `pickSpotlightRef` (the first ref that actually exists in the outline — the first validation anywhere that a returned ref id is real), and `fixedFrameCorrection`/`applyCorrection`.
**Why:** jsdom implements no layout, so anything that measured for itself would be untestable. Keeping every number in pure functions over plain rects is what makes the feature testable at all; the component measures and passes rects in. `fixedFrameCorrection` is a runtime sentinel probe rather than a CSS sniff because `position: fixed` breaks under a `transform`/`filter`/`contain` ancestor and the list of such properties is always one spec behind.
**Files:** lib/spotlight.ts, tests/spotlight.test.ts
**Verify:** `npm test -- tests/spotlight.test.ts` — 30 cases. The load-bearing one is "tiles the viewport around the hole with no gaps and no overlap", asserted as an area/intersection property rather than coordinates.

## 2026-09-22 14:00 — The spotlight itself: ring, scrim and an anchored tooltip
**What:** New `components/Spotlight.tsx` and `components/useSpotlightRect.ts`. The hook holds the ref *id* and re-resolves through `resolveRef` on every measure, so an SPA re-render is handled without a MutationObserver; it re-measures on capture-phase `scroll` and on `resize`, coalesced through one rAF, plus a bounded 36-frame settle loop after the highlight appears. The component draws the scrim bands, the ring and a tooltip carrying the element's name, `target_reason`, and a "Hide highlight" button.
**Why:** The user asked where to go and still had to find it themselves. Also: no permanent rAF loop (battery), no `ResizeObserver` (jsdom has none — a no-op stub could never fail a test, so asserting against it would be theater), and no host-page mutation at all — the ring is our own box at the target's rect.
**Files:** components/Spotlight.tsx, components/useSpotlightRect.ts, tests/Spotlight.test.tsx, tests/setup.ts
**Verify:** `npm test -- tests/Spotlight.test.tsx` — 13 cases, notably "renders nothing when fixed positioning cannot be trusted", "never intercepts pointer events except on the tooltip itself", "scrolls an off-screen target into view exactly once, centred", and "reports the target as lost once it leaves the DOM". `tests/setup.ts` grew one honest extension: an element that pins its own size with inline px reports that size, which the frame sentinel needs. No `scrollIntoView` stub was added — jsdom leaves it undefined, the component calls it optionally, and each test assigns its own spy.

## 2026-09-22 14:06 — The panel now points at the page
**What:** `App.tsx` gained one `spotlight` slot and renders `<Spotlight>` as a sibling of the panel, which required turning the `if (!open) return <FAB/>` early return into a fragment — otherwise the highlight could not outlive the panel. Set at the end of `ask()` from `pickSpotlightRef(refs, snapshot.outline)`; cleared at the top of `ask()` and `runSummary()`, on entering settings, on `onSaved`, on `onLost`, from the tooltip's ✕, and by Escape. The Escape effect is now registered when `open || spotlight` and clears the highlight and closes the panel in one press. `AnswerCard`'s inert `refLabels: string[]` became `targets: RefTarget[]` + `onPick`, so the ref ids are threaded through instead of dying at that boundary, and clicking an entry moves the highlight; a new `role="status"` block names what is ringed and why.
**Why:** This is the read side of the `lib/refs` seam finally being used. The highlight survives collapsing the panel because the user closes the panel precisely to go and touch the thing. The `role="status"` block, not the on-page tooltip, is the announced copy: `role="tooltip"` would be meaningless here, since it only counts when a focusable element points at it with `aria-describedby` and IDREFs do not cross shadow boundaries.
**Files:** entrypoints/overlay.content/App.tsx, components/AnswerCard.tsx, entrypoints/overlay.content/style.css, tests/App.test.tsx, tests/cards.test.tsx
**Verify:** `npm test -- tests/App.test.tsx tests/cards.test.tsx`. The load-bearing cases are "replaces the highlight when the next question is asked" (exactly one ring, ever), "keeps the highlight when the panel is collapsed to the button", "leaves nothing behind in the page after Hide on this page" (the anti-portal regression), and "does not swallow Escape when there is nothing to dismiss". Full suite 186 passed; `npx wxt build` succeeds (overlay.js 298.31 kB, total 342.17 kB).

## 2026-09-22 14:22 — Dev harness, and the two bugs it caught immediately
**What:** New `npm run harness`: a Vite-served billing page (sticky header, nested scroll container, a target far below the fold, a fixed bottom-right target under the panel) that mounts the **real** `App` with `@/lib/messaging` aliased to `dev/fake-background.ts`. Variants via query string (`?transform=1`, `?contain=1`) and explicit `window.harness` controls for SPA mutations. Driven with Playwright MCP.
**Why:** jsdom has no layout, so the suite can only prove arithmetic. This is the only way to see whether the box lands on the element. It earned its keep on the first run — it caught two real bugs:
  1. **The scrim and tooltip were never frame-corrected.** `applyCorrection` was being applied to the geometry *inputs*, so under a transformed `<body>` the ring was right while `scrimRects` computed bands for a viewport that no longer started at the origin — dimming nothing at all. Fixed by keeping every rect in viewport coordinates and applying the correction only when writing inline styles.
  2. **`App.tsx` relied on WXT's auto-import for `SummaryCard`** while importing every other component explicitly. That only works inside a WXT build, so the panel crashed in the harness. Now imported explicitly.
  Also added a 500ms heartbeat re-measure: scroll and resize miss an accordion opening, a font swapping, or an SPA dropping the target, and a ring pointing at nothing is worse than no ring. Unlike `ResizeObserver`, which jsdom lacks, a timer is something a test can drive.
**Files:** dev/index.html, dev/plain.html, dev/main.tsx, dev/harness.css, dev/fake-background.ts, dev/install-fake-browser.ts, dev/vite.config.ts, components/Spotlight.tsx, components/useSpotlightRect.ts, entrypoints/overlay.content/App.tsx, package.json
**Verify:** `npm run harness`, then in a real browser at 1280x820, measured via `getBoundingClientRect`: the ring is the target's rect padded by exactly 6px on all four sides (offsets 0,0,0,0); `elementFromPoint` at the target's centre still returns the target, so clicks pass through; four scrim bands tile viewport-minus-hole with seams under 0.01px and identical `oklab(…/0.4)`; `scrollIntoView({block:'center'})` centres the target to within 4px; for the page's fixed bottom-right button the tooltip flips **above** *and* slides clear left of the panel; under `transform: translate(24px,40px) scale(0.9)` on `<body>` the sentinel reads 90px at (24,-1911) and the correction still lands the ring within 2px with the scrim starting at the true origin; growing 300px above the target moves it with no scroll event and the ring follows within 1px; removing the target clears ring, scrim and tooltip while the panel keeps the answer. Screenshots: `.playwright-mcp/spotlight-harness.png`, `.playwright-mcp/spotlight-transformed-body.png`.

## 2026-09-22 14:30 — Extension injection is verified at last, in a real browser
**What:** New `e2e/extension.spec.ts` + `playwright.config.ts` (`@playwright/test`, `@types/node`). It runs `chromium.launchPersistentContext` with `channel: 'chromium'` and `--load-extension` against `.output/chrome-mv3`, serving `dev/plain.html` over http because the content script matches `http(s)` only.
**Why:** This closes the gap recorded at 12:37 and restated at 13:06 — "the panel actually renders on a real page" had never been confirmed by anything repeatable. The root cause of the earlier failure was almost certainly the browser channel: Chrome and Edge removed the flags for side-loading an unpacked extension, so only Playwright's bundled Chromium can do it.
**Files:** e2e/extension.spec.ts, playwright.config.ts, dev/plain.html, package.json, .gitignore, CLAUDE.md
**Verify:** `npx wxt build && npm run test:e2e` — **3 of 4 pass**: the MV3 service worker starts at a `chrome-extension://` URL; the `page-guide-ui` shadow host injects into an ordinary page and the floating button is a visible 48x48; the panel opens inside the shadow root and shows the key setup without any network call. The fourth test (the spotlight inside the real shadow root) gets as far as asserting the ring is the target's rect padded by exactly 6px on every side and that the tooltip carries `target_reason` — all of which pass — but **still fails** its last assertion, `elementFromPoint` at the target's centre returning `null` because `dev/plain.html` ends immediately after the button, so centring is clamped and the point falls outside the viewport. The fixture needs trailing content, the same way `dev/index.html` does; that edit is not in this commit.
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

## 2026-09-22 14:34 — Merged the spotlight and the enlarge-panel button into main
**What:** `main` fast-forwarded to `feat/spotlight` (which carried `tests/vitest-suite` with it), then merged `feat/ui-resize`. One conflict, in `entrypoints/overlay.content/App.tsx`: both branches added declarations immediately after `type View`. Resolved by keeping both — `type Highlight` and then `PANEL_BASE`/`PANEL_SIZE`. Everything else merged cleanly, including the header, where the spotlight only altered the Settings button's `onClick` and the resize branch inserted a new button after it.
**Why:** Both branches were built on the same `tests/vitest-suite` base, so the histories are linear up to the fork and the only real overlap was the panel's own markup.
**Files:** entrypoints/overlay.content/App.tsx (conflict), claude-changelog.md and tests/App.test.tsx (auto-merged)
**Verify:** `npm run check` on the merge result — `tsc --noEmit` clean, **189 tests passed across 11 files** (187 from the spotlight branch plus the 2 enlarge-panel cases). `npx wxt build` succeeds, total 343.69 kB. Not asserted anywhere: that enlarging the panel shifts the rect the spotlight tooltip dodges. It does follow, because the `avoid` rect is re-read from `panelRef` on every measure and the 500ms heartbeat guarantees one, but no test pins it.
