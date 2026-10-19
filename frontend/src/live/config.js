// Where the live data comes from (docs/frontend-integration.md).
// Default: the Vite dev-server proxy (/gateway, /collector, /runner -> services/). Set VITE_GATEWAY_URL and
// VITE_COLLECTOR_URL to http://127.0.0.1:8100 / :8200 to connect directly (needs AMBIENT_CORS_ORIGINS).

export const TOKEN = import.meta.env.VITE_DASHBOARD_TOKEN || '';
export const LIVE_AVAILABLE = Boolean(TOKEN);

const GATEWAY = (import.meta.env.VITE_GATEWAY_URL || '/gateway').replace(/\/+$/, '');
const COLLECTOR = (import.meta.env.VITE_COLLECTOR_URL || '/collector').replace(/\/+$/, '');
const RUNNER = (import.meta.env.VITE_RUNNER_URL || '/runner').replace(/\/+$/, '');

// Starting a Live Simulation run needs the simulator token, which only the dev-server proxy holds
// (vite.config.js reads SIMULATOR_TOKEN from the root .env). The browser never sees it.
// eslint-disable-next-line no-undef -- replaced at build time by vite.config.js `define`
export const RUN_AVAILABLE = __RUN_AVAILABLE__ && !import.meta.env.VITE_RUNNER_URL;

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
  401: 'Runner가 시뮬레이터 토큰을 받지 못했어요. 루트 .env의 SIMULATOR_TOKEN을 확인하고 npm run dev를 다시 실행해 주세요.',
  403: '이 토큰으로는 실행할 수 없어요. 루트 .env의 SIMULATOR_TOKEN이 필요해요.',
  409: '다른 실행이 아직 진행 중이에요. 끝난 뒤에 다시 눌러 주세요.',
};

/** Ask the Runner for a run: {scenario} or {agent, say}. Resolves with the run; rejects with a message for the screen. */
export async function startRun(body) {
  let response;
  try {
    // No Authorization header: the dev-server proxy adds the simulator token.
    response = await fetch(`${RUNNER}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
