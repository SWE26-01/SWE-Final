// Chat with the agents' LLMs, shared by the Home and Agents tabs: a scenario started on Home shows
// up in the Agents tab's chat too.
import { useState } from 'react';
import { askAgent } from './console';

export function useAgentChat() {
  const [selected, setSelected] = useState('desktop');
  const [chats, setChats] = useState({});
  const [pending, setPending] = useState({});
  const [lastRun, setLastRun] = useState(null); // latest message from either tab and, once in, its answer

  const append = (agent, message) => setChats((current) => ({ ...current, [agent]: [...(current[agent] || []), message] }));
  const send = async (agent, message) => {
    const run = { id: `${Date.now()}-${agent}`, agent, message, startedAt: Date.now() };
    setLastRun(run);
    append(agent, { role: 'user', text: message });
    setPending((current) => ({ ...current, [agent]: true }));
    let answer;
    try {
      const { reply, durationMs, costUsd } = await askAgent(agent, message);
      const meta = [`${(durationMs / 1000).toFixed(1)}초`, costUsd != null ? `$${costUsd.toFixed(3)}` : null].filter(Boolean).join(' · ');
      answer = { role: 'agent', text: reply || '(빈 답)', meta };
    } catch (error) {
      answer = { role: 'error', text: `보내지 못했어요: ${error.message}` };
    }
    append(agent, answer);
    setLastRun((current) => (current?.id === run.id ? { ...current, answer } : current));
    setPending((current) => ({ ...current, [agent]: false }));
  };
  const runScenario = (scenario) => {
    setSelected(scenario.agent);
    if (!pending[scenario.agent]) send(scenario.agent, scenario.message);
  };

  return { selected, setSelected, chats, pending, lastRun, send, runScenario };
}
