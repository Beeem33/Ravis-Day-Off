import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'sim/sim.ts',
    outDir: 'sim/out',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'sim.js', format: 'es' } }
  },
  ssr: { noExternal: ['three'] }
});
