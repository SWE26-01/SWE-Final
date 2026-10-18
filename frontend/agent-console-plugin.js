// Dev-server only: lets the UI talk to the agents' LLMs on this machine.
// POST /console/ask {agent, message} runs `scripts/oc.sh <agent> agent --message ... --json` (the
// OpenClaw CLI) and returns the agent's reply. The CLI reads the root .env itself, so no agent or
// OpenClaw token ever reaches the browser. One message per agent at a time.
import { spawn } from 'node:child_process';
import path from 'node:path';

const AGENTS = new Set(['desktop', 'smartphone', 'orchestrator', 'room1', 'room2']);
const MAX_MESSAGE = 500;
const TIMEOUT_MS = 180_000;
// Added to every message from the UI so replies read like a person talking, not a log.
const STYLE = [
  '(답변 방식: 집에 사는 사람에게 말하듯 자연스럽고 친근하게, 짧게 답해 줘.',
  '기기 ID(input_boolean.… 같은 것), 필드 이름(meeting_app_active 같은 것), 사유 코드, 코드 표기는 쓰지 말고',
  '"거실 TV 음소거", "회의 중"처럼 쉬운 말로 풀어서 말해 줘. 필요하면 굵게나 목록 같은 마크다운을 써도 돼.',
  '지금 상태를 말할 때는 기억으로 추측하지 말고 ambient_status 같은 도구로 먼저 확인한 내용만 말해 줘.',
  '묻기만 한 질문에는 답만 하고, 부탁받지 않은 상태 공유·요청·기기 조작은 하지 마.)',
].join(' ');

function runAgent(root, agent, message) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn('bash', [path.join(root, 'scripts/oc.sh'), agent, 'agent', '--agent', 'main', '--message', `${message}\n\n${STYLE}`, '--json'], {
      cwd: root,
      // npm run dev leaves npm_config_* in the environment, which nvm (used by oc.sh) refuses.
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('npm_'))), AMBIENT_SKIP_SYNC: '1' },
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => {
      clearTimeout(timer);
      const start = out.indexOf('{');
      try {
        const result = JSON.parse(out.slice(start)).result || {};
        const reply = (result.payloads || []).map((p) => p.text).filter(Boolean).join('\n')
          || result.meta?.finalAssistantVisibleText || '';
        resolve({ reply, durationMs: Date.now() - started, costUsd: result.meta?.agentMeta?.costUsd ?? null });
      } catch {
        reject(new Error(`agent ${agent} failed (exit ${code}): ${(err || out).trim().slice(-300)}`));
      }
    });
  });
}

export default function agentConsole() {
  const queues = new Map(); // agent -> promise of the last queued message
  return {
    name: 'agent-console',
    configureServer(server) {
      const root = path.resolve(server.config.root, '..');
      server.middlewares.use('/console/ask', (req, res) => {
        const send = (status, body) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return send(405, { error: 'POST only' });
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; if (raw.length > 4096) req.destroy(); });
        req.on('end', () => {
          let body;
          try { body = JSON.parse(raw); } catch { return send(400, { error: 'body must be JSON' }); }
          const { agent, message } = body || {};
          if (!AGENTS.has(agent)) return send(400, { error: `unknown agent ${agent}` });
          if (typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE) {
            return send(400, { error: `message must be 1-${MAX_MESSAGE} characters` });
          }
          const previous = queues.get(agent) || Promise.resolve();
          const turn = previous.catch(() => {}).then(() => runAgent(root, agent, message.trim()));
          queues.set(agent, turn);
          turn.then((result) => send(200, result), (error) => send(502, { error: error.message }));
        });
      });
    },
  };
}
