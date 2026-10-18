import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import agentConsole from './agent-console-plugin.js';

// Live data comes from services/ through this proxy (docs/frontend-integration.md).
const strip = (prefix) => (path) => path.replace(new RegExp(`^${prefix}`), '');

export default defineConfig({
  plugins: [react(), agentConsole()], // agentConsole: dev-only relay to the agents (Agents tab)
  server: {
    fs: { allow: ['..'] }, // lets the dev server load ../services/contracts/examples/*.json
    proxy: {
      '/gateway': { target: 'http://127.0.0.1:8100', ws: true, rewrite: strip('/gateway') },
      '/collector': { target: 'http://127.0.0.1:8200', ws: true, rewrite: strip('/collector') },
    },
  },
});
