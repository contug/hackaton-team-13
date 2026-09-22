// Side-effect import, and it must stay first — see the file for why.
import './install-fake-browser';
import ReactDOM from 'react-dom/client';
import App from '@/entrypoints/overlay.content/App';
import './harness.css';

/**
 * Harness entry. Two deliberate differences from the real content script:
 *
 * 1. The UI mounts in the LIGHT DOM, not a shadow root. Vite dev injects CSS
 *    into `document.head`, so a shadow-rooted panel would render unstyled.
 *    Shadow DOM is covered by `e2e/extension.spec.ts` against a real build.
 * 2. `globalThis.browser` is WXT's fake, installed by `./install-fake-browser`
 *    before any other import, because `lib/settings.ts` calls
 *    `storage.defineItem` at module scope and would otherwise throw here.
 *
 * Variants, for the cases that only a real browser can exercise:
 *   ?transform=1  puts a transform on <body>, which breaks `position: fixed`
 *                 and is what `fixedFrameCorrection` exists to detect
 *   ?contain=1    the same thing via `contain: paint`
 *
 * SPA behaviour is exposed as `window.harness` rather than run off timers:
 * driving it from the test means no race with how long a tool call takes, and
 * neither mutation fires a scroll or a resize, so the heartbeat re-measure is
 * the only thing that can notice them.
 */
const params = new URLSearchParams(location.search);

if (params.has('transform')) {
  document.body.style.transform = 'translate(24px, 40px) scale(0.9)';
  document.body.style.transformOrigin = 'top left';
}
if (params.has('contain')) {
  document.body.style.contain = 'paint';
}
function findButton(text: string): HTMLElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.textContent === text);
}

Object.assign(window, {
  harness: {
    /** An SPA re-render dropping the element the spotlight is pointing at. */
    removeCancel: () => document.getElementById('cancel')?.remove(),
    /** A target that collapses to nothing without leaving the DOM. */
    collapseCancel: () => {
      const el = document.getElementById('cancel');
      if (el) el.style.display = 'none';
    },
    /** Something growing above the target, moving it with no scroll event. */
    growAboveCancel: () => {
      const section = document.getElementById('cancel')?.closest('section');
      section?.insertAdjacentHTML('beforebegin', '<div style="height: 300px"></div>');
    },
    findButton,
  },
});

const host = document.getElementById('page-guide-root')!;
ReactDOM.createRoot(host).render(<App />);
