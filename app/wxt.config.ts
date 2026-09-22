import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Page Guide',
    description:
      'A quiet assistant that summarizes the page you are on and answers one question at a time.',
    // `storage` for the API key and model choice. No `tabs` permission: a content
    // script already knows its own tab, and per-tab isolation is a requirement.
    permissions: ['storage'],
    host_permissions: ['https://openrouter.ai/*'],
  },
});
