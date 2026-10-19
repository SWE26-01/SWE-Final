// Agents tab: the Runner's scenarios, a live map of messages between agents, a chat with each agent's
// LLM and a status board per agent. Talking to agents goes through the Runner (services/runner,
// useLiveRun): one run at a time, and the chat shows what was said to an agent in recent runs.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Loader2, MessageSquare, Send } from 'lucide-react';
import Markdown from './Markdown';
import { LiveScenarioButtons } from './LiveViews';
import {
  AGENT_ORDER, AGENT_ROLE, SUGGESTIONS, agentName, ownedDeviceChips, recentDoings, toFlowCard,
} from './mapping';
import './console.css';

const POS = {
  desktop: [96, 70], smartphone: [96, 214], orchestrator: [320, 142], room1: [544, 70], room2: [544, 214],
};
const EDGES = [['desktop', 'orchestrator'], ['smartphone', 'orchestrator'], ['orchestrator', 'room1'], ['orchestrator', 'room2'], ['desktop', 'room1'], ['smartphone', 'room1']];
const PULSE_MS = 1400;
const shortName = (id) => agentName(id).replace(' Agent', '');

function useAnimations(events) {
  const lastId = useRef(null);
  const [pulses, setPulses] = useState([]);
  const [busy, setBusy] = useState({});
  useEffect(() => {
    const maxId = events.reduce((max, e) => Math.max(max, e.id), 0);
    if (!events.length) return; // snapshot not in yet
    if (lastId.current === null) { lastId.current = maxId; return; } // don't replay history
    const fresh = events.filter((e) => e.id > lastId.current);
    lastId.current = Math.max(lastId.current, maxId);
    if (!fresh.length) return;
    const now = Date.now();
    const newPulses = fresh
      .filter((e) => e.dir === 'out' && POS[e.agent] && POS[e.to])
      .map((e) => ({ key: `${e.id}`, from: e.agent, to: e.to, kind: e.type, at: now }));
    if (newPulses.length) setPulses((current) => [...current, ...newPulses]);
    const acting = fresh.filter((e) => e.dir === 'exec' || e.dir === 'rule').map((e) => e.agent);
    if (acting.length) setBusy((current) => ({ ...current, ...Object.fromEntries(acting.map((id) => [id, now])) }));
  }, [events]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setPulses((current) => (current.some((p) => now - p.at > PULSE_MS) ? current.filter((p) => now - p.at <= PULSE_MS) : current));
      setBusy((current) => (Object.values(current).some((at) => now - at > 1800) ? Object.fromEntries(Object.entries(current).filter(([, at]) => now - at <= 1800)) : current));
    }, 300);
    return () => window.clearInterval(timer);
  }, []);
  return { pulses, busy };
}

function AgentMap({ events, statuses, latestFlow }) {
  const { pulses, busy } = useAnimations(events);
  const online = (id) => statuses[id]?.online !== false;
  return (
    <section className="console-map panel">
      <div className="panel-heading compact"><div><h2>Agent Map</h2></div></div>
      <svg viewBox="0 0 640 284" className="console-map-svg" role="img" aria-label="에이전트 사이 메시지 흐름">
        {EDGES.map(([a, b]) => {
          const active = pulses.some((p) => (p.from === a && p.to === b) || (p.from === b && p.to === a));
          return <line key={`${a}-${b}`} x1={POS[a][0]} y1={POS[a][1]} x2={POS[b][0]} y2={POS[b][1]} className={`console-edge ${active ? 'active' : ''}`} />;
        })}
        {pulses.map((p) => (
          <circle key={p.key} r="6" className={`console-pulse ${p.kind === 'device.control' ? 'control' : 'context'}`}>
            <animateMotion dur={`${PULSE_MS / 1000}s`} fill="freeze" path={`M ${POS[p.from][0]} ${POS[p.from][1]} L ${POS[p.to][0]} ${POS[p.to][1]}`} />
          </circle>
        ))}
        {AGENT_ORDER.map((id) => (
          <g key={id} transform={`translate(${POS[id][0]} ${POS[id][1]})`} className={`console-node ${online(id) ? '' : 'offline'} ${busy[id] ? 'busy' : ''}`}>
            <circle r="31" />
            <text y="-3" textAnchor="middle" className="console-node-name">{shortName(id)}</text>
            <text y="13" textAnchor="middle" className="console-node-state">{online(id) ? (busy[id] ? '실행 중' : 'ONLINE') : 'OFFLINE'}</text>
          </g>
        ))}
      </svg>
      <div className="console-latest">
        {latestFlow ? (<><b>방금 처리한 요청</b><span>{latestFlow.time} · {latestFlow.path.join(' → ')}</span><span>{latestFlow.title}</span><em className={latestFlow.accepted ? 'ok' : 'no'}>{latestFlow.result}</em></>) : <span>아직 처리한 요청이 없어요.</span>}
      </div>
    </section>
  );
}

/** What was said to one agent in the Runner's recent runs and what it answered, oldest first. */
function chatOf(runs, agent) {
  const messages = [];
  [...runs].reverse().forEach((run) => run.steps.forEach((step, index) => {
    if (step.agent !== agent) return;
    const key = `${run.id}-${index}`;
    messages.push({ key: `${key}-q`, role: 'user', text: step.say });
    if (step.reply) messages.push({ key: `${key}-a`, role: 'agent', text: step.reply });
    else if (step.error) messages.push({ key: `${key}-a`, role: 'error', text: step.error });
    else if (step.status === 'skipped') messages.push({ key: `${key}-a`, role: 'error', text: '앞 단계가 실패해서 건너뛰었어요.' });
  }));
  return messages;
}

function Chat({ selected, onSelect, history, thinking, onSend, statuses, canSend, note }) {
  const [input, setInput] = useState('');
  const listRef = useRef(null);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [history.length, thinking(selected)]);
  const submit = async (text) => {
    const message = text.trim();
    if (!message || !canSend) return;
    // Keep the text if the run did not start (another run is still going), so it can be sent again.
    if (await onSend(selected, message)) setInput('');
  };
  return (
    <section className="console-chat panel">
      <div className="panel-heading compact"><div><h2>에이전트와 대화</h2></div></div>
      <div className="console-chat-tabs" role="tablist">
        {AGENT_ORDER.map((id) => (
          <button type="button" role="tab" key={id} aria-selected={selected === id} className={`${selected === id ? 'active' : ''} ${statuses[id]?.online === false ? 'offline' : ''}`} onClick={() => onSelect(id)}>
            {agentName(id).replace(' Agent', '')}{thinking(id) && <Loader2 size={11} className="live-spin" />}
          </button>
        ))}
      </div>
      <div className="console-chat-log" ref={listRef}>
        {history.length ? history.map((m) => (
          <div key={m.key} className={`console-bubble ${m.role}`}>
            {m.role === 'agent' ? <Markdown text={m.text} /> : <p>{m.text}</p>}
          </div>
        )) : <div className="console-chat-empty"><MessageSquare size={16} /><span>{agentName(selected)}에게 말을 걸어 보세요. {AGENT_ROLE[selected]}.</span></div>}
        {thinking(selected) && <div className="console-bubble agent pending"><p><Loader2 size={12} className="live-spin" /> {agentName(selected)}가 생각하는 중…</p></div>}
      </div>
      <div className="console-suggestions">
        {SUGGESTIONS[selected].map((text) => <button type="button" key={text} disabled={!canSend} onClick={() => submit(text)}>{text}</button>)}
      </div>
      <form className="live-say" onSubmit={(event) => { event.preventDefault(); submit(input); }}>
        <input value={input} maxLength={500} placeholder={note || `${agentName(selected)}에게 보낼 말`} onChange={(event) => setInput(event.target.value)} aria-label="보낼 말" />
        <button type="submit" disabled={!input.trim() || !canSend} aria-label="보내기"><Send size={14} /></button>
      </form>
    </section>
  );
}

function AgentBoard({ statuses, events, devices }) {
  return (
    <section className="console-board">
      {AGENT_ORDER.map((id) => {
        const status = statuses[id];
        const chips = ownedDeviceChips(status, devices);
        const doings = recentDoings(id, events, devices);
        const online = status?.online !== false;
        return (
          <article className={`console-agent panel ${online ? '' : 'offline'}`} key={id}>
            <header><span className="console-agent-icon"><Bot size={16} /></span><b>{agentName(id)}</b><em>{status ? (online ? 'ONLINE' : 'OFFLINE') : '확인 중'}</em></header>
            <p className="console-agent-role">{AGENT_ROLE[id]}</p>
            <div className="console-chips">
              {chips.length ? chips.map((chip) => <span key={chip.entity} className={chip.on ? 'on' : ''}>{chip.name} <b>{chip.text}</b></span>) : <span className="none">맡은 기기 없음</span>}
            </div>
            <ol className="console-doings">
              {doings.length ? doings.map((d) => <li key={d.key} className={d.ok ? '' : 'no'}><time>{d.time.slice(0, 5)}</time>{d.text}</li>) : <li className="none">최근 활동 없음</li>}
            </ol>
          </article>
        );
      })}
    </section>
  );
}

export default function AgentConsole({ live, liveData, events, run }) {
  const [selected, setSelected] = useState('desktop');
  const devices = liveData.gateway.devices;
  const statuses = useMemo(() => Object.fromEntries(liveData.agents.map((s) => [s.id, s])), [liveData.agents]);
  const latestFlow = liveData.flows[0] ? toFlowCard(liveData.flows[0], devices) : null;
  const history = useMemo(() => chatOf(run.runs, selected), [run.runs, selected]);
  const thinking = (agent) => run.current?.status === 'running' && run.current.steps.some((step) => step.agent === agent && step.status === 'running');
  const hint = run.allowed ? 'Runner(services/runner)에 연결되면 말할 수 있어요' : '루트 .env에 SIMULATOR_TOKEN이 있어야 말할 수 있어요 (npm run dev 재시작)';
  const note = !run.canRun ? hint : run.busy ? '다른 실행이 끝나면 보낼 수 있어요' : '';

  if (!live) {
    return <div className="console-tab"><p className="live-banner">Agents 탭은 LIVE 모드에서 쓸 수 있어요. 오른쪽 위에서 LIVE를 켜 주세요.</p></div>;
  }
  return (
    <div className="console-tab">
      <section className="console-scenarios panel">
        <h2>시나리오</h2>
        <div className="live-mode-controls">
          <LiveScenarioButtons scenarios={run.scenarios} current={run.current} busy={run.busy} canRun={run.canRun} hint={hint} onStart={run.start} />
        </div>
      </section>
      <div className="console-grid">
        <AgentMap events={events} statuses={statuses} latestFlow={latestFlow} />
        <Chat selected={selected} onSelect={setSelected} history={history} thinking={thinking} onSend={(agent, say) => run.start({ agent, say })} statuses={statuses} canSend={run.canRun && !run.busy} note={note} />
      </div>
      <AgentBoard statuses={statuses} events={events} devices={devices} />
    </div>
  );
}
