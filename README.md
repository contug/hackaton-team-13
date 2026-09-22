# Page Guide

A Chrome extension that reduces the cognitive load of using a dense web page.

A floating button sits on the page. Clicking it opens a small panel that
summarizes what you are looking at, takes one short problem statement — "what
are you trying to do here?" — and answers it as a **guided walkthrough**: an
ordered list of steps, with the current one ringed on the page and a tooltip
beside it saying what to do.

The walkthrough survives navigation. Do a step, let the page change, and the
new page is analyzed against your **original goal** with the steps you have
already done carried across. Steps that need text typed into a field offer a
button that fills it in for you.

**It is not a chat.** One answer is on screen at a time and a new one replaces
the previous one. There is no scrollback, and there must not be one — that is
the main structural defense against overload, not a missing feature.

## Layout

```
app/       the extension — see app/CLAUDE.md for the architecture and the rules
agents/    agent configuration (Claude Code settings)
```

## Getting started

```bash
cd app
npm install          # runs `wxt prepare` via postinstall
npm run dev          # Chrome, with hot reload
```

On first load the panel asks for an **OpenRouter** API key and lets you pick
any model. The key is stored in extension storage and read only by the
background service worker — it never enters the content script, and all network
I/O happens in the worker so a host page's `connect-src` cannot block it.

## Commands

Run these from `app/`.

| Command | What it does |
|---|---|
| `npm run dev` / `dev:firefox` | Load the extension with hot reload |
| `npm run build` / `zip` | Production build into `.output/` |
| `npm test` | The Vitest + jsdom suite, once |
| `npm run check` | `tsc --noEmit` and the full suite — run this before calling anything done |
| `npm run harness` | A dev page on `:5199` with real layout and a fake model |
| `npm run test:e2e` | Playwright, against the real built extension (needs `npx wxt build` first) |

## Stack

WXT + React 19 + Tailwind 4, TypeScript, Vitest with jsdom, Playwright for the
end-to-end checks. The LLM provider is OpenRouter, reached through a thin
`fetch` against its OpenAI-compatible endpoint — there is no SDK dependency.

`app/CLAUDE.md` is the authoritative document for how this is built and why.
`app/claude-changelog.md` records every change, newest last.
