import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Build stamp shown in the console's status bar: the commit the console was built from and the
 * build date. With it the operator can see at a glance whether the browser shows the current
 * build (and not an older node or a stale page).
 */
function buildStamp(): string {
  const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
  try {
    const commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return commit ? `${commit} · ${date}` : date;
  } catch {
    return date;
  }
}

const apiTarget = process.env['SPY_EYE_API'] ?? 'http://127.0.0.1:8787';

export default defineConfig({
  // Relative asset URLs: the built client works under any path prefix.
  base: './',
  plugins: [react()],
  define: {
    __DATUM_BUILD__: JSON.stringify(buildStamp()),
  },
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
