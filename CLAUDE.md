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
- **No cross-tab context.** Every tab gets its own independent instance. Conversation state lives in the content script's React state and dies with the page. Nothing conversational is stored in the background worker.
- **The API key is requested on first load** and never enters the content script.

### Out of scope for now (seam is in place)

Acting on the page — clicking, filling, scrolling-to, highlighting. The snapshot already assigns stable `ref` ids to elements and the LLM response schema already carries `refs: string[]`, so this lands later as a content-script action handler plus a confirmation gate, with **no change** to the snapshot format or prompt contract. Keep that seam intact.

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
```

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
  App.test.tsx             # the product rules, incl. "one answer at a time"
  AskBox / SuggestionChips / cards .test.tsx
```

`lib/handlers.ts` holds the background message router precisely so it can be called directly from `handlers.test.ts`; `entrypoints/background.ts` keeps only the listener wiring. Keep it that way.

### What the suite does not cover, and the jsdom caveats

- **Extension injection.** No jsdom test can load an MV3 extension. Whether the content script actually injects into a real page is still unverified — see `claude-changelog.md`.
- **Real layout.** jsdom's `getBoundingClientRect()` returns all zeros, which would make `isRendered()` in `lib/snapshot.ts` reject *every* element and leave the outline tests vacuous. `tests/setup.ts` stubs the rect: a visible default, or `data-test-rect="top,height"` when an element carries it. So "hidden because it has zero size" is simulated, not tested. `display`/`visibility`/`opacity` filtering is real — but jsdom does not cascade `display` to descendants, only `visibility`.
- **`innerText`.** Not implemented by jsdom; `tests/setup.ts` maps it to `textContent`, which is not rendering-aware.
- **Shadow DOM and Tailwind.** Components are mounted directly by Testing Library, not inside a shadow root, so nothing here checks the panel against hostile host-page CSS.

## Architecture

```
entrypoints/
  background.ts            # service-worker entry: onMessage wiring only
  overlay.content/
    index.tsx              # defineContentScript + createShadowRootUi
    App.tsx                # FAB + panel state machine
    style.css
components/                # ApiKeySetup, AskBox, AnswerCard, SummaryCard, SuggestionChips
lib/
  handlers.ts              # the message router: sole reader of the API key, all network I/O
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

### The `refs` seam

`lib/snapshot.ts` assigns short ids (`e1`, `e2`, …) to structural and interactive elements, tracked in `lib/refs.ts` via `WeakMap<Element, string>` + `Map<string, WeakRef<Element>>` inside the content script. `refs` already round-trips through the prompt and response schema. Preserve it even while the UI renders refs inertly.

### Shadow DOM and Tailwind 4

The panel mounts in a shadow root (`cssInjectionMode: 'ui'`) so arbitrary host-page CSS cannot wreck it. Set an explicit `font-size` and `color-scheme` on the root container: `rem` resolves against the *host page's* root font size, so sites using `html { font-size: 62.5% }` will otherwise render the panel at the wrong scale.

### Structured output and its fallback

Requests use `response_format: { type: 'json_schema', ... }`. Because the user may pick **any** model and not all support it, `lib/openrouter.ts` must keep its three-step degradation: schema → prompt-inlined JSON retry → raw text as the answer with empty suggestions. Never hang, never throw an unhandled parse error.
