import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the built app works from any path, including a
  // subdirectory on a static host.
  base: './',
  resolve: {
    alias: {
      // Point at core's source, not its build output, so `npm run dev` needs no
      // separate build step and edits to the engine hot-reload.
      '@pitchside/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      workbox: {
        // The whole app is precached, so a game can be run with no signal at all.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Without this, the service worker treats any navigation inside its
        // scope it doesn't recognize as an SPA route and serves the app's
        // own cached shell for it — including /dashboard/, a completely
        // separate site nested one level below wherever this app is
        // deployed. A coach who'd ever opened the app, then tapped a
        // dashboard share link, got the app's shell (wrong JS, wrong
        // relative asset paths, a blank page) instead of the dashboard.
        navigateFallbackDenylist: [/\/dashboard\//],
      },
      manifest: {
        name: 'Pitchside',
        short_name: 'Pitchside',
        description: 'Playing time, substitutions, and stats for youth soccer.',
        theme_color: '#0f1720',
        background_color: '#0f1720',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
