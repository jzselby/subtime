import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works from any path, including a
  // subdirectory on a static host — same reasoning as app/vite.config.ts.
  base: './',
  resolve: {
    alias: {
      // Point at core's source, not its build output, so `npm run dev` needs
      // no separate build step — same as app/vite.config.ts.
      '@pitchside/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  plugins: [react()],
});
