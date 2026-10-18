import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // Share the repo-root .env with the server. Only VITE_-prefixed vars reach the browser.
  envDir: '..',
  build: {
    rollupOptions: {
      // The dashboard, and the lightweight offline-first crisis report form at /report/.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        report: fileURLToPath(new URL('./report/index.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
