import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env['SPY_EYE_API'] ?? 'http://127.0.0.1:8787';

export default defineConfig({
  // Relative asset URLs: the built client works under any path prefix.
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/media': { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
