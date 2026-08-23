import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 8180, strictPort: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 }
});
