import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Live data comes from services/ through this proxy (docs/frontend-integration.md).
const strip = (prefix) => (path) => path.replace(new RegExp(`^${prefix}`), '');

export default defineConfig(({ command, mode }) => {
  // The simulator token (Live Simulation runs) stays on the dev server: it is read from the root .env
  // and added by the /runner proxy, so it never reaches the browser bundle or frontend/.env.local.
  const simulatorToken = loadEnv(mode, '..', '').SIMULATOR_TOKEN || '';
  const runner = { target: 'http://127.0.0.1:8300', ws: true, rewrite: strip('/runner') };
  if (simulatorToken) runner.headers = { Authorization: `Bearer ${simulatorToken}` };

  return {
    plugins: [react()],
    define: {
      // Only the dev server can start runs (a build has no proxy to add the token).
      __RUN_AVAILABLE__: JSON.stringify(command === 'serve' && Boolean(simulatorToken)),
    },
    server: {
      fs: { allow: ['..'] }, // lets the dev server load ../services/contracts/examples/*.json
      proxy: {
        '/gateway': { target: 'http://127.0.0.1:8100', ws: true, rewrite: strip('/gateway') },
        '/collector': { target: 'http://127.0.0.1:8200', ws: true, rewrite: strip('/collector') },
        '/runner': runner,
      },
    },
  };
});
