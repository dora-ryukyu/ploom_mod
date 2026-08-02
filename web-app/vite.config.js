/**
 * Optional. The app runs without Vite:
 *   npx serve web-app
 *   python -m http.server -d web-app
 *
 * Vite is only a convenience (HMR / build). Imports are plain relative paths.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
});
