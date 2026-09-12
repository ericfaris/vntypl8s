import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two builds from one codebase: the player UI (index.html) and the TV
// receiver UI (receiver.html).
// Ports are overridable so the dev stack can dodge a busy 3001 / 5173:
//   PORT=4567 CLIENT_PORT=4568 npm run dev
// PORT is the server's (it reads the same var); the client proxies to it.
const API_PORT = process.env.PORT ?? '3001';
const CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 5173);

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
    port: CLIENT_PORT,
    // Bind 0.0.0.0: a Chromecast is a separate LAN device and cannot resolve
    // this machine's `localhost` (Chromecast guide §6).
    host: true,
    proxy: {
      '/socket': { target: `http://localhost:${API_PORT}`, ws: true },
      '/api': { target: `http://localhost:${API_PORT}` },
    },
  },
});
