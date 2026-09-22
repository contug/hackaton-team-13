import ReactDOM from 'react-dom/client';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { pageIsWorthHelpingWith } from '@/lib/snapshot';
import App from './App';
import './style.css';

export default defineContentScript({
  // http(s) only — this is what enforces "there must be a real webpage in the
  // tab". chrome://, extension pages and the new-tab page never match.
  matches: ['http://*/*', 'https://*/*'],
  cssInjectionMode: 'ui',
  runAt: 'document_idle',

  async main(ctx) {
    // A blank page or a bare redirect stub has nothing to be overwhelmed by.
    if (!pageIsWorthHelpingWith()) return;

    const ui = await createShadowRootUi(ctx, {
      name: 'page-guide-ui',
      position: 'inline',
      anchor: 'body',
      onMount: (container) => {
        // React warns when rooted directly on the container, so wrap it.
        const host = document.createElement('div');
        host.id = 'page-guide-root';
        container.append(host);

        const root = ReactDOM.createRoot(host);
        root.render(<App />);
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });

    ui.mount();
  },
});
