import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages serves under /<repo>/; the deploy workflow sets BASE. Local dev and root hosting use '/'.
  base: process.env.BASE ?? '/',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Chunky Comic Reader',
        short_name: 'Comics',
        display: 'standalone',
        background_color: '#111111',
        theme_color: '#111111',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      // .mjs is the pdf.js worker; without it PDFs would not open offline.
      workbox: { globPatterns: ['**/*.{js,mjs,css,html,png,svg,woff2}'], maximumFileSizeToCacheInBytes: 3 * 1024 * 1024 },
    }),
  ],
});
