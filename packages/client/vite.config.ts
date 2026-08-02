import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two builds from one codebase: the player UI (index.html) and the TV
// receiver UI (receiver.html).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@vntypl8s/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        player: resolve(__dirname, 'index.html'),
        receiver: resolve(__dirname, 'receiver.html'),
      },
    },
  },
  server: {
    port: 5173,
    // Bind 0.0.0.0: a Chromecast is a separate LAN device and cannot resolve
    // this machine's `localhost` (Chromecast guide §6).
    host: true,
    proxy: {
      '/socket': { target: 'http://localhost:3001', ws: true },
      '/api': { target: 'http://localhost:3001' },
    },
  },
});
