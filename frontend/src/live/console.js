// Talk to an agent's LLM through the dev server (agent-console-plugin.js). Takes a few seconds.
export async function askAgent(agent, message) {
  const response = await fetch('/console/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent, message }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body; // { reply, durationMs, costUsd }
}
