import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Cloud preview hostnames are injected through
 * __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS (comma separated) so that no VM
 * hostname is ever written into tracked files.
 */
const extraHosts = (process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const apiTarget = process.env.ICONCRETE_API_URL ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: ['localhost', '127.0.0.1', ...extraHosts],
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
