import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: {
    host: 'localhost',
    port: 5183,
    strictPort: true,
  },
  preview: {
    host: 'localhost',
    port: 4183,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        spatial: resolve(__dirname, 'index.html'),
      },
    },
  },
});
