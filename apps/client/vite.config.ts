import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@xarita/geo': fileURLToPath(new URL('../../packages/geo/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    // 3D Tiles + three katta — chunk ogohlantirishini realistik chegaraga qo'yamiz.
    chunkSizeWarningLimit: 1500,
  },
});
