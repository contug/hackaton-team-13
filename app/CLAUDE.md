# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## ⚠️ Mandatory: record every step in `claude-changelog.md`

**Every step you take must be recorded in `claude-changelog.md` at the repo root — in every session, and in every worktree, without being asked.**

- The file is **append-only**. Newest entries go at the **bottom**. Never rewrite, reorder, or delete existing entries.
- Write **one entry per landed change**, in the *same turn* the change lands, **before** reporting the work as done.
- Working in a git worktree does not exempt you. Write to that worktree's own `claude-changelog.md`. `.gitattributes` marks the file `merge=union`, so parallel worktrees merge cleanly instead of conflicting — do not "fix" that by rewriting history.
- Entry format:

```
## YYYY-MM-DD HH:MM — Short title
**What:** one or two sentences describing the change
**Why:** the reason, not the diff
**Files:** paths touched
**Verify:** the command or manual check that confirms it
```

- **Verify:** should name the test that covers the change (`npm test -- tests/openrouter.test.ts`, and the test's own name), not just "ran the build". If nothing covers it, say that explicitly.

---

## Goal

A Chrome extension that **reduces cognitive overload while navigating a web page**.

A floating button sits on the page. Clicking it opens a small panel that:
1. **Summarizes the current page** immediately on open.
2. Accepts **one short problem statement** from the user ("what are you trying to do here?").
3. Answers **concisely** and offers **a few clickable follow-up suggestions**.

### Product constraints — these are the design, not preferences

- **It is not a chat.** One answer is on screen at a time; a new answer *replaces* the previous one. There is no scrollback. This is the main structural defense against overload — do not let it drift into a message log.
- **Brevity is enforced twice:** `maxItems`/length limits in the JSON response schema, *and* explicit instruction in the system prompt.
- **A real webpage must be open in the tab.** Content scripts match `http(s)` only; `main()` bails out on documents with no body text and no interactive elements.
- **No cross-tab context, and no stored transcript.** Every tab gets its own independent instance. The conversation lives in the content script's React state and dies with the page; `history` travels up on every `ask` and is dropped again with the response. The one exception is the walkthrough: **the background stores one journey per tab id in session storage — the goal, the current steps and the progress — and never the transcript.** The tab id comes from the `sender` the browser attaches, so a content script cannot ask for another tab's journey, and `tests/handlers.test.ts` asserts that two tab ids never see each other's.
- **The API key is requested on first load** and never enters the content script.

### Out of scope for now (seam is in place)

Clicking on the user's behalf. Highlighting, scrolling-to and **filling** have landed; pressing a button for them has not, and the seam is the same one — `lib/refs.ts` resolves a ref to a live element and the step contract already names the target.

---

## Stack

Pre-installed in `node_modules`; `package.json` pins these exact versions so `npm install` does not re-resolve them.

| Package | Version |
|---|---|
| `wxt` | 0.21.4 |
| `@wxt-dev/module-react` | 1.2.2 |
| `@wxt-dev/storage` | installed |
| `react` / `react-dom` | 19.3.0 |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.3 |
| `typescript` | 5.9.3 |
| `vite` | 8.3.0 |
| `eslint` | 9.39.4 |
| `@mozilla/readability` | 0.6.0 |

The test stack is caret-ranged rather than pinned: `vitest` 5, `jsdom` 30, `@testing-library/react` 16 with `/dom`, `/user-event` and `/jest-dom`. Vitest 5 wants `vite: ^8`, which is the installed Vite. `wxt/testing/fake-browser` and `wxt/testing/vitest-plugin` ship inside `wxt` — do not add `@webext-core/fake-browser` separately. See [Testing](#testing).

**LLM provider is OpenRouter**, not the Anthropic API. The user supplies their own OpenRouter key and picks any model. The LLM layer is a thin `fetch` against OpenRouter's OpenAI-compatible `/api/v1/chat/completions` — there is no SDK dependency, and none should be added.

## Commands

```bash
npm install          # runs `wxt prepare` via postinstall
npm run dev          # Chrome, with HMR
npm run dev:firefox
npm run build
npm run zip
npm run compile      # tsc --noEmit
npx wxt prepare      # regenerate .wxt/ types — run this if imports look untyped
```

`wxt prepare` generates `.wxt/`, which supplies the types for the auto-imported `defineContentScript`, `defineBackground`, `createShadowRootUi`, `storage`, and `browser`. If TypeScript cannot find those, `.wxt/` is missing or stale — that is the fix, not adding imports.

## Testing

```bash
npm test             # vitest run — the whole suite, once
npm run test:watch   # vitest in watch mode
npm run check        # tsc --noEmit && vitest run
npm run harness      # the dev harness on :5199 — real layout, fake background
npm run test:e2e     # playwright, against the REAL built extension
```

`npm run test:e2e` needs `npx wxt build` first, and it loads `.output/chrome-mv3`
into the Chromium that ships with Playwright. It must be that Chromium: Chrome
and Edge removed the command-line flags for side-loading an unpacked extension,
which is the most likely reason the earlier hand-rolled attempt found nothing.

**Run the test suite after every change, in every session and every worktree.** `npm run check` (typecheck + full suite) before reporting any work as done. A `PostToolUse` hook in `.claude/settings.json` runs the related tests automatically after each edit, but that is a safety net, not a substitute — the hook only runs *related* tests, so the full suite is still yours to run.

New behavior in `lib/` or `components/` ships with a test in the same change. If you deliberately skip one, say so and say why in the `claude-changelog.md` entry.

```
vitest.config.ts           # jsdom + WxtVitest() — the plugin is what makes `@/`,
                           # WXT auto-imports and `browser` resolve in tests
tests/
  setup.ts                 # jest-dom matchers, fakeBrowser.reset(), jsdom stubs
  helpers.ts               # queued `fetch` mock (mockFetch / completion / jsonResponse)
  fixtures.ts              # snapshotFixture(), article HTML
  openrouter.test.ts       # the three-step fallback chain, clamping, error mapping
  snapshot.test.ts         # DOM -> PageSnapshot
  refs.test.ts             # the ref registry (uses vi.resetModules — module state)
  prompts.test.ts          # the rendered prompt contract
  handlers.test.ts         # lib/handlers.ts against fakeBrowser storage
  spotlight.test.ts        # the spotlight geometry — pure, no DOM at all
  Spotlight.test.tsx       # the overlay against the real refs registry
  App.test.tsx             # the product rules, incl. "one answer at a time"
  AskBox / SuggestionChips / cards .test.tsx
dev/                       # the harness: real App, real layout, fake background
e2e/extension.spec.ts      # the real build, loaded into a real browser
```

`lib/handlers.ts` holds the background message router precisely so it can be called directly from `handlers.test.ts`; `entrypoints/background.ts` keeps only the listener wiring. Keep it that way.

### What the suite does not cover, and the jsdom caveats

- **Extension injection is now covered** — by `e2e/extension.spec.ts`, not by the jsdom suite. No jsdom test can load an MV3 extension; that test loads the real build and asserts the `page-guide-ui` shadow host and the floating button appear on an ordinary `http://` page. It is not part of `npm run check`, because it needs a build and a real browser.
- **Real layout.** jsdom's `getBoundingClientRect()` returns all zeros, which would make `isRendered()` in `lib/snapshot.ts` reject *every* element and leave the outline tests vacuous. `tests/setup.ts` stubs the rect: a visible default, or `data-test-rect="top,height"` when an element carries it. So "hidden because it has zero size" is simulated, not tested. `display`/`visibility`/`opacity` filtering is real — but jsdom does not cascade `display` to descendants, only `visibility`.
- **`innerText`.** Not implemented by jsdom; `tests/setup.ts` maps it to `textContent`, which is not rendering-aware.
- **Shadow DOM and Tailwind.** Components are mounted directly by Testing Library, not inside a shadow root, so nothing in the jsdom suite checks the panel against hostile host-page CSS. `e2e/extension.spec.ts` does, inside the real shadow root.
- **Spotlight placement.** The rect stub reports `left: 0, width: 200` for every element unless it pins its own size inline, so horizontal centring, horizontal clamping and panel-avoidance are verified as arithmetic over rects a test invented — never against real layout. Tooltip height is 20 for everything, so real above/below flipping is browser-only. `npm run harness` plus `npm run test:e2e` are what cover those.

## Architecture

```
entrypoints/
  background.ts            # service-worker entry: onMessage wiring only
  overlay.content/
    index.tsx              # defineContentScript + createShadowRootUi
    App.tsx                # FAB + panel state machine
    style.css
components/                # ApiKeySetup, AskBox, AnswerCard, SummaryCard, SuggestionChips,
                           # Spotlight + useSpotlightRect (the on-page highlight)
lib/
  handlers.ts              # the message router: sole reader of the API key, all network I/O
  spotlight.ts             # pure geometry for the on-page highlight (no DOM)
  snapshot.ts              # DOM -> PageSnapshot (Readability + navigation outline)
  refs.ts                  # element <-> ref-id registry (the future-interaction seam)
  messaging.ts             # typed content <-> background protocol
  settings.ts              # storage.defineItem for key + model
  openrouter.ts            # fetch wrapper, JSON-schema contract, fallback chain
  prompts.ts
```

### Why all network I/O lives in the background service worker

Two hard reasons, not style:

1. **Host-page CSP.** A `fetch` from a content script is subject to the page's `connect-src`. Exactly the dense, stressful pages this extension targets (banks, dashboards, checkouts) will block `openrouter.ai`. The service worker is not subject to page CSP.
2. **Key containment.** The content script sends a snapshot and a question, and receives an answer. It never sees, stores, or transmits the key.

Do not move an OpenRouter call into the content script for convenience.

### Per-tab isolation

Each tab has its own content-script instance holding its own conversation in React state. The background is stateless apart from global settings (key, model). `history` is passed *up* from the content script on every `ask` and is never retained in the background — that is the mechanism that keeps tabs independent. Do not add a background-side conversation map.

### The `refs` seam, and the spotlight that reads it

`lib/snapshot.ts` assigns short ids (`e1`, `e2`, …) to structural and interactive elements, tracked in `lib/refs.ts` via `WeakMap<Element, string>` + `Map<string, WeakRef<Element>>` inside the content script. `refs` round-trips through the prompt and response schema.

The read side is now live. After an answer, `App.tsx` rings one element on the page and anchors a tooltip beside it saying why:

- `lib/spotlight.ts` holds **all** the arithmetic as pure functions over plain rects, and touches no `window`, `document` or `Element`. jsdom implements no layout, so anything that measured for itself would be untestable. Do not move geometry into the component.
- `components/useSpotlightRect.ts` measures: it holds the **ref id**, never an `Element`, and re-resolves through `resolveRef` on every measure, which is how an SPA re-render is handled without a MutationObserver. It re-measures on capture-phase `scroll` and `resize` (coalesced through one rAF), a bounded settle loop, and a 500ms heartbeat. No `ResizeObserver` — jsdom has none, so a no-op stub could never fail a test.
- `components/Spotlight.tsx` draws. It writes **nothing** to the host page — no class, no attribute, no style. The ring is our own box at the target's rect, and the scrim and ring are `pointer-events: none` so the target stays clickable.
- Load-bearing properties (`position`, geometry, `z-index`, `pointer-events`) are inline styles, not Tailwind classes: Tailwind is not compiled in the test environment, so a class assertion there would prove nothing.
- `position: fixed` inside the shadow root breaks when a host page puts `transform`/`filter`/`contain` on `<body>`. A hidden sentinel is rendered and measured, and `fixedFrameCorrection` divides the error back out — a runtime probe, not a CSS sniff, because the list of properties that create a containing block is always one spec behind. The correction is applied **only** when writing styles; applying it to the geometry inputs leaves the scrim computing bands for a viewport that no longer starts at the origin, which dims nothing.
- The **panel and the floating button are still not corrected**, so on a page with a transformed `<body>` they land off-screen. That predates the spotlight; it is recorded, not fixed.
- One highlight at a time, like one answer. It survives the panel being collapsed — the user closes the panel precisely to go and touch the thing — and is cleared by the next question, the tooltip's ✕, Escape, "Stop guiding me", `goal_reached`, or "Hide on this page".
- **The highlight is derived, not its own slot.** `App.tsx` holds a `Journey` and rings `currentStep(journey)?.ref`; advancing a step re-points `<Spotlight targetRef>`, and because `useSpotlightRect`'s effect keys on the target, the new element scrolls itself into view for free. A ref the user picks from "On this page" is the one exception — a separate `picked` slot that takes precedence, and the two are mutually exclusive by construction so the panel's `role="status"` always describes exactly one thing.
- **`target_reason` is retired.** A step's own `text` is the tooltip copy. Keeping both would be two sources of truth for the same sentence.

### The walkthrough, and the two things that watch for it

`lib/journey.ts` holds the walkthrough state as pure functions over plain JSON, for the same reason `lib/spotlight.ts` is pure: this is the part that must be provable in jsdom. It is also exactly what the background stores, so it has to survive `structuredClone`.

- `components/useStepWatcher.ts` registers **one** listener on `document`, capture phase, chosen by the kind of step: `input` for a step that suggests text, `click` otherwise. Registering both would advance a fill step the moment the user clicked into the field. Both are **strictly read-only** — no `preventDefault`, no `stopPropagation`, because it is the user's own click that does the thing. The Escape handler in `App.tsx` *does* call `stopPropagation()`; that is a deliberate, narrow exception for a key host pages routinely eat, not a pattern to copy.
- `components/useUrlWatcher.ts` **polls `location.href`** at 500ms. Not `wxt:locationchange`: WXT rewrites the event name to `` `${browser.runtime.id}:${ENTRYPOINT}:wxt:locationchange` ``, so a plain `window.addEventListener` never fires and it would mean plumbing the `ContentScriptContext` into a React component — and WXT's own watcher already polls at 1000ms whenever the Navigation API is missing. jsdom has no Navigation API and does implement `pushState`, so the poll is what makes the re-plan path drivable from a test.
- The heuristics will sometimes be wrong, so the tooltip carries **Next** and **Skip**. `skip` deliberately does not record the step in `done` — a skipped step there would build the next page's plan on a lie.

### The autofill gate

`lib/autofill.ts` is the only thing in this extension that writes to the host page, and it is acceptable only because it is **user-initiated**: it runs from a press on the tooltip's "Fill this in" button and nowhere else. Nothing fills automatically.

- It uses the **prototype's native `value` setter**, not `el.value = text`. React installs its own `value` property on the element instance, so a plain assignment is invisible to the site's state — the box looks filled and the app disagrees. Then `input` and `change`, bubbling, after `focus()`.
- **Blocked, never filled:** `type="password"`, `hidden`, `file`, `disabled`, `readOnly`, and any field whose `autocomplete` token is `cc-number`, `cc-csc`, `cc-exp` or `one-time-code`.
- **Unsupported:** anything that is not an `<input>`, `<textarea>` or `<select>`. Narrowed on `instanceof`, deliberately not on the snapshot's `kind` — `lib/snapshot.ts` calls `role="textbox"`/`role="combobox"` elements `kind: 'field'` too, and a `contenteditable` div has no `.value` at all.

### Shadow DOM and Tailwind 4

The panel mounts in a shadow root (`cssInjectionMode: 'ui'`) so arbitrary host-page CSS cannot wreck it. Set an explicit `font-size` and `color-scheme` on the root container: `rem` resolves against the *host page's* root font size, so sites using `html { font-size: 62.5% }` will otherwise render the panel at the wrong scale.

### Structured output and its fallback

Requests use `response_format: { type: 'json_schema', ... }`. Because the user may pick **any** model and not all support it, `lib/openrouter.ts` must keep its three-step degradation: schema → prompt-inlined JSON retry → raw text as the answer with empty suggestions. Never hang, never throw an unhandled parse error.
