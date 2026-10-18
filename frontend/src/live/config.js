// Where the live data comes from (docs/frontend-integration.md).
// Default: the Vite dev-server proxy (/gateway, /collector -> services/). Set VITE_GATEWAY_URL and
// VITE_COLLECTOR_URL to http://127.0.0.1:8100 / :8200 to connect directly (needs AMBIENT_CORS_ORIGINS).

export const TOKEN = import.meta.env.VITE_DASHBOARD_TOKEN || '';
export const LIVE_AVAILABLE = Boolean(TOKEN);

const GATEWAY = (import.meta.env.VITE_GATEWAY_URL || '/gateway').replace(/\/+$/, '');
const COLLECTOR = (import.meta.env.VITE_COLLECTOR_URL || '/collector').replace(/\/+$/, '');

const wsUrl = (base, path) => {
  const origin = base.startsWith('http') ? base : `${window.location.origin}${base}`;
  return `${origin.replace(/^http/, 'ws')}${path}?token=${encodeURIComponent(TOKEN)}`;
};

export const gatewayWsUrl = () => wsUrl(GATEWAY, '/ws');
export const collectorWsUrl = () => wsUrl(COLLECTOR, '/ws');

export async function getCollector(path) {
  const response = await fetch(`${COLLECTOR}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!response.ok) throw new Error(`collector ${path}: HTTP ${response.status}`);
  return response.json();
}
