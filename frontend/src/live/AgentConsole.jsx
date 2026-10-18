// Agents tab: scenario buttons, a live map of messages between agents, a chat with each agent's LLM
// and a status board per agent. Talking to agents goes through the dev server (agent-console-plugin.js).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Loader2, MessageSquare, Play, Send } from 'lucide-react';
import { askAgent } from './console';
import {
  AGENT_ORDER, AGENT_ROLE, SCENARIOS, SUGGESTIONS, agentName, ownedDeviceChips, recentDoings, timeOf, toFlowCard,
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
      <div className="panel-heading compact"><div><h2>Agent Map</h2></div><span className="console-hint">메시지가 오가면 선 위로 점이 지나가요</span></div>
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

function Chat({ selected, onSelect, chats, pending, onSend, statuses }) {
  const [input, setInput] = useState('');
  const listRef = useRef(null);
  const history = chats[selected] || [];
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [history.length, pending[selected]]);
  const submit = (text) => {
    const message = text.trim();
    if (!message || pending[selected]) return;
    onSend(selected, message);
    setInput('');
  };
  return (
    <section className="console-chat panel">
      <div className="panel-heading compact"><div><h2>에이전트와 대화</h2></div><span className="console-hint">에이전트의 LLM이 답해요 · 한 번에 몇 초</span></div>
      <div className="console-chat-tabs" role="tablist">
        {AGENT_ORDER.map((id) => (
          <button type="button" role="tab" key={id} aria-selected={selected === id} className={`${selected === id ? 'active' : ''} ${statuses[id]?.online === false ? 'offline' : ''}`} onClick={() => onSelect(id)}>
            {shortName(id)}{pending[id] && <Loader2 size={11} className="spin" />}
          </button>
        ))}
      </div>
      <div className="console-chat-log" ref={listRef}>
        {history.length ? history.map((m, index) => (
          <div key={index} className={`console-bubble ${m.role}`}>
            <p>{m.text}</p>{m.meta && <small>{m.meta}</small>}
          </div>
        )) : <div className="console-chat-empty"><MessageSquare size={16} /><span>{agentName(selected)}에게 말을 걸어 보세요. {AGENT_ROLE[selected]}.</span></div>}
        {pending[selected] && <div className="console-bubble agent pending"><p><Loader2 size={12} className="spin" /> {agentName(selected)}가 생각하는 중…</p></div>}
      </div>
      <div className="console-suggestions">
        {SUGGESTIONS[selected].map((text) => <button type="button" key={text} disabled={pending[selected]} onClick={() => submit(text)}>{text}</button>)}
      </div>
      <form className="console-input" onSubmit={(event) => { event.preventDefault(); submit(input); }}>
        <input value={input} maxLength={500} placeholder={`${agentName(selected)}에게 보낼 말`} onChange={(event) => setInput(event.target.value)} disabled={pending[selected]} />
        <button type="submit" disabled={!input.trim() || pending[selected]} aria-label="보내기"><Send size={14} /></button>
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
              {chips.length ? chips.map((chip) => <span key={chip.entity} className={chip.on ? 'on' : ''}>{chip.name} <b>{chip.text}</b></span>) : <span className="none">맡은 기기 없음 (외부 기기)</span>}
            </div>
            <ol className="console-doings">
              {doings.length ? doings.map((d) => <li key={d.key} className={d.ok ? '' : 'no'}><time>{d.time.slice(0, 5)}</time>{d.text}</li>) : <li className="none">최근 활동 없음</li>}
            </ol>
            <small>{status?.last_event_at ? `마지막 활동 ${timeOf(status.last_event_at)}` : '활동 기록 없음'}</small>
          </article>
        );
      })}
    </section>
  );
}

export default function AgentConsole({ live, liveData, events }) {
  const [selected, setSelected] = useState('desktop');
  const [chats, setChats] = useState({});
  const [pending, setPending] = useState({});
  const devices = liveData.gateway.devices;
  const statuses = useMemo(() => Object.fromEntries(liveData.agents.map((s) => [s.id, s])), [liveData.agents]);
  const latestFlow = liveData.flows[0] ? toFlowCard(liveData.flows[0], devices) : null;

  const append = (agent, message) => setChats((current) => ({ ...current, [agent]: [...(current[agent] || []), message] }));
  const send = async (agent, message) => {
    append(agent, { role: 'user', text: message });
    setPending((current) => ({ ...current, [agent]: true }));
    try {
      const { reply, durationMs, costUsd } = await askAgent(agent, message);
      const meta = [`${(durationMs / 1000).toFixed(1)}초`, costUsd != null ? `$${costUsd.toFixed(3)}` : null].filter(Boolean).join(' · ');
      append(agent, { role: 'agent', text: reply || '(빈 답)', meta });
    } catch (error) {
      append(agent, { role: 'error', text: `보내지 못했어요: ${error.message}` });
    } finally {
      setPending((current) => ({ ...current, [agent]: false }));
    }
  };
  const runScenario = (scenario) => {
    setSelected(scenario.agent);
    if (!pending[scenario.agent]) send(scenario.agent, scenario.message);
  };

  if (!live) {
    return <div className="console-tab"><p className="live-banner">Agents 탭은 LIVE 모드에서 쓸 수 있어요. 오른쪽 위에서 LIVE를 켜 주세요.</p></div>;
  }
  return (
    <div className="console-tab">
      <section className="console-scenarios panel">
        <div><h2>시나리오</h2><span className="console-hint">누르면 해당 에이전트에게 말을 걸어요. 결과는 아래 지도·대화창·현황판에 바로 나타나요.</span></div>
        <div className="console-scenario-buttons">
          {SCENARIOS.map((s) => (
            <button type="button" key={s.id} disabled={pending[s.agent]} onClick={() => runScenario(s)} title={`${agentName(s.agent)}에게: "${s.message}"`}>
              {pending[s.agent] ? <Loader2 size={13} className="spin" /> : <Play size={13} />}<b>{s.label}</b><small>→ {shortName(s.agent)}</small>
            </button>
          ))}
        </div>
      </section>
      <div className="console-grid">
        <AgentMap events={events} statuses={statuses} latestFlow={latestFlow} />
        <Chat selected={selected} onSelect={setSelected} chats={chats} pending={pending} onSend={send} statuses={statuses} />
      </div>
      <AgentBoard statuses={statuses} events={events} devices={devices} />
    </div>
  );
}
