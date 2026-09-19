import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  build: {
    outDir: '../example-dist',
    emptyOutDir: true,
    rollupOptions: { input: {
      robot: fileURLToPath(new URL('./index.html', import.meta.url)),
      cube: fileURLToPath(new URL('./cube/index.html', import.meta.url)),
    } },
  },
});
