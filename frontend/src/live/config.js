// Where the live data comes from (docs/frontend-integration.md).
// Default: the Vite dev-server proxy (/gateway, /collector, /runner -> services/). Set VITE_GATEWAY_URL and
// VITE_COLLECTOR_URL to http://127.0.0.1:8100 / :8200 to connect directly (needs AMBIENT_CORS_ORIGINS).
// Starting a Live Simulation run is a POST, so it only works through the proxy.

export const TOKEN = import.meta.env.VITE_DASHBOARD_TOKEN || '';
export const LIVE_AVAILABLE = Boolean(TOKEN);
// Lets the Live Simulation ask the Runner to talk to agents (services/runner). Without it the tab only watches.
export const SIMULATOR_TOKEN = import.meta.env.VITE_SIMULATOR_TOKEN || '';
export const RUN_AVAILABLE = Boolean(SIMULATOR_TOKEN);

const GATEWAY = (import.meta.env.VITE_GATEWAY_URL || '/gateway').replace(/\/+$/, '');
const COLLECTOR = (import.meta.env.VITE_COLLECTOR_URL || '/collector').replace(/\/+$/, '');
const RUNNER = (import.meta.env.VITE_RUNNER_URL || '/runner').replace(/\/+$/, '');

const wsUrl = (base, path) => {
  const origin = base.startsWith('http') ? base : `${window.location.origin}${base}`;
  return `${origin.replace(/^http/, 'ws')}${path}?token=${encodeURIComponent(TOKEN)}`;
};

export const gatewayWsUrl = () => wsUrl(GATEWAY, '/ws');
export const collectorWsUrl = () => wsUrl(COLLECTOR, '/ws');
export const runnerWsUrl = () => wsUrl(RUNNER, '/ws');

export async function getCollector(path) {
  const response = await fetch(`${COLLECTOR}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!response.ok) throw new Error(`collector ${path}: HTTP ${response.status}`);
  return response.json();
}

export async function getRunner(path) {
  const response = await fetch(`${RUNNER}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!response.ok) throw new Error(`runner ${path}: HTTP ${response.status}`);
  return response.json();
}

const RUN_ERRORS = {
  401: '시뮬레이터 토큰이 맞지 않아요 (VITE_SIMULATOR_TOKEN).',
  403: '이 토큰으로는 실행할 수 없어요. 시뮬레이터 토큰이 필요해요.',
  409: '다른 실행이 아직 진행 중이에요. 끝난 뒤에 다시 눌러 주세요.',
};

/** Ask the Runner for a run: {scenario} or {agent, say}. Resolves with the run; rejects with a message for the screen. */
export async function startRun(body) {
  let response;
  try {
    response = await fetch(`${RUNNER}/runs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SIMULATOR_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Runner에 연결할 수 없어요 (services/runner, 포트 8300).');
  }
  if (response.ok) return response.json();
  if (RUN_ERRORS[response.status]) throw new Error(RUN_ERRORS[response.status]);
  const detail = await response.json().then((data) => data.detail).catch(() => '');
  throw new Error(`실행을 시작하지 못했어요 (HTTP ${response.status}${typeof detail === 'string' && detail ? `: ${detail}` : ''}).`);
}
