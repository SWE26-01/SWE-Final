import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Live data comes from services/ through this proxy (docs/frontend-integration.md).
const strip = (prefix) => (path) => path.replace(new RegExp(`^${prefix}`), '');

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: ['..'] }, // lets the dev server load ../services/contracts/examples/*.json
    proxy: {
      '/gateway': { target: 'http://127.0.0.1:8100', ws: true, rewrite: strip('/gateway') },
      '/collector': { target: 'http://127.0.0.1:8200', ws: true, rewrite: strip('/collector') },
      '/runner': { target: 'http://127.0.0.1:8300', ws: true, rewrite: strip('/runner') },
    },
  },
});
