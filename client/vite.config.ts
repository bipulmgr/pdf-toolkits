import { defineConfig } from 'vite';

// `base: './'` makes the build work from any sub-path (GitHub Pages project
// sites live at https://<user>.github.io/<repo>/) and from the NestJS server.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  worker: { format: 'es' },
});
