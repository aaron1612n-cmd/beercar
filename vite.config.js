import { defineConfig } from 'vite';

// base './' so the build runs from any sub-path (GitHub Pages serves it under /beercar/).
// The old in-project Edge profile holds locked files that crash Vite's watcher (EBUSY).
export default defineConfig({
  base: './',
  build: { target: 'esnext', chunkSizeWarningLimit: 5000 },   // main.js uses top-level await
  server: { watch: { ignored: ['**/.edge-profile/**'] } },
});
