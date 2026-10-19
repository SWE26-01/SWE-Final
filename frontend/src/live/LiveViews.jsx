// Panels for live data, built from the same class names as the mock panels so they look alike.
import React, { useState } from 'react';
import { Bot, BrainCircuit, Check, ChevronRight, LoaderCircle, Minus, Play, Radio, Send, User, Wifi, WifiOff, X } from 'lucide-react';
import { AGENTS, agentColor, agentName, socketLabel, stepText } from './mapping';
import Markdown from './Markdown';
import './live.css';

export function DataModeToggle({ mode, available, onChange }) {
  return (
    <div className="data-mode-toggle" role="group" aria-label="데이터 모드">
      <button type="button" className={mode === 'live' ? 'active' : ''} disabled={!available} title={available ? '실제 시스템 데이터' : 'frontend/.env.local에 VITE_DASHBOARD_TOKEN을 넣으면 켤 수 있어요'} onClick={() => onChange('live')}>
        <Radio size={11} /> LIVE
      </button>
      <button type="button" className={mode === 'mock' ? 'active' : ''} onClick={() => onChange('mock')}>MOCK</button>
    </div>
  );
}

export function SocketState({ status, label }) {
  const ok = status === 'open';
  return <div className={`socket-state ${ok ? '' : 'live-socket-down'}`}>{ok ? <Wifi size={13} /> : <WifiOff size={13} />} {label ? `${label} ` : ''}{socketLabel(status)}</div>;
}

export function LiveDecisionCard({ cards }) {
  return (
    <section className="decision-card dark-card live-decision-card">
      <div className="card-title-row">
        <div className="mint-icon"><BrainCircuit size={22} /></div>
        <div><h2>Agent Decision</h2></div>
        <span className="confidence">{cards.length} REQUESTS</span>
      </div>
      {cards.length ? (
        <ol className="live-flow-list">
          {cards.slice(0, 4).map((card) => (
            <li key={card.key}>
              <time>{card.time}</time>
              <div>
                <b>{card.title}</b>
                <small>{card.path.join(' → ')}</small>
              </div>
              <em className={card.accepted ? 'ok' : 'no'}>{card.result}</em>
            </li>
          ))}
        </ol>
      ) : <p className="live-flow-empty">아직 요청이 없어요.</p>}
    </section>
  );
}

export function LiveTimeline({ items, empty = '아직 실행 기록이 없어요.' }) {
  if (!items.length) return <div className="live-empty-state compact"><Wifi size={14} /><span>{empty}</span></div>;
  return items.map((item) => (
    <div className="timeline-item" key={item.key}>
      <span className="time">{item.time.slice(0, 5)}</span><i className={`timeline-dot ${item.tone}`} />
      <p><b>{item.title}</b><small>{item.detail}</small></p><span className={`event-tag ${item.tone}`}>{item.tag}</span>
    </div>
  ));
}

export function LiveLogRows({ rows, limit }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  if (!shown.length) return <div className="live-empty-state compact"><Wifi size={14} /><span>Agent 메시지를 기다리는 중입니다.</span></div>;
  return shown.map((row) => (
    <div className="log-row" key={row.key}>
      <span className="log-time">{row.time}</span>
      <span className={`agent-pill ${row.color}`}>{row.from.replace(' Agent', '')}</span>
      <ChevronRight size={12} />
      <span className={`log-text ${row.accepted === false ? 'live-rejected' : ''}`}><b>{row.to.replace(' Agent', '')}</b> · {row.text}</span>
    </div>
  ));
}

export function LiveAgentCards({ agents }) {
  if (!agents.length) return <div className="live-empty-state compact"><Wifi size={14} /><span>에이전트 상태를 확인하는 중입니다.</span></div>;
  return agents.map((agent) => (
    <div className={`expanded-agent ${agent.online ? '' : 'live-agent-offline'}`} key={agent.id}>
      <Bot size={20} /><b>{agent.name}</b>
      <span>{!agent.checked ? 'CHECKING' : agent.online ? 'ONLINE' : 'OFFLINE'}</span>
      <small>{agent.detail}</small>
    </div>
  ));
}

// --- Live Simulation (services/runner) ------------------------------------------------------------

// `hint` says why running is off (no simulator token on the dev server, or the Runner is not connected).
export function LiveScenarioButtons({ scenarios, current, busy, canRun, hint, onStart }) {
  if (!scenarios.length) return <span className="live-run-note">시나리오를 불러오는 중…</span>;
  return scenarios.map((scenario) => {
    const active = current?.scenario === scenario.id;
    const running = active && current.status === 'running';
    return (
      <button
        type="button"
        key={scenario.id}
        className={active ? 'active' : ''}
        disabled={!canRun || busy}
        title={canRun ? scenario.description : hint}
        aria-label={`${scenario.title} 실행`}
        onClick={() => onStart({ scenario: scenario.id })}
      >
        {running ? <LoaderCircle size={15} className="live-spin" /> : <Play size={15} />}
        {scenario.title}
      </button>
    );
  });
}

export function LiveSayForm({ canRun, busy, hint, onSay }) {
  const [agent, setAgent] = useState('desktop');
  const [text, setText] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    if (!text.trim()) return;
    // Keep the text if the run did not start (e.g. another run is still going), so it can be resent.
    if (await onSay({ agent, say: text.trim() })) setText('');
  };
  return (
    <form className="live-say" onSubmit={submit} aria-label="에이전트에게 직접 말하기">
      <select value={agent} onChange={(event) => setAgent(event.target.value)} disabled={!canRun} aria-label="말할 에이전트">
        {Object.entries(AGENTS).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}
      </select>
      <input
        value={text}
        maxLength={500}
        onChange={(event) => setText(event.target.value)}
        disabled={!canRun}
        placeholder={canRun ? '예: 나 회의 시작할게' : hint}
        aria-label="할 말"
      />
      <button type="submit" disabled={!canRun || busy || !text.trim()} aria-label="보내기"><Send size={14} /></button>
    </form>
  );
}

const elapsedText = (run, now) => {
  const end = run.ended_at ? Date.parse(run.ended_at) : now;
  return `${Math.max(0, Math.round((end - Date.parse(run.started_at)) / 1000))}s`;
};

export function LiveRunSummary({ run, now }) {
  if (!run) return null;
  const done = run.steps.filter((step) => step.status !== 'pending' && step.status !== 'running').length;
  const steps = run.steps.length > 1 ? ` · ${done}/${run.steps.length}` : '';
  return (
    <div className="live-run-summary">
      <div><b>{run.scenario ? run.title : '직접 말하기'}</b><span>{elapsedText(run, now)}{steps}</span></div>
      <i><span style={{ width: `${(done / run.steps.length) * 100}%` }} /></i>
    </div>
  );
}

const EXPECT = {
  reached: { icon: Check, text: '이번 실행에서 바뀜' },
  already: { icon: Minus, text: '실행 전부터 이 상태 (이번 실행의 결과가 아님)' },
  pending: { icon: LoaderCircle, text: '아직 바뀌지 않음' },
  missed: { icon: X, text: '기대와 다름' },
};

export function LiveExpect({ rows }) {
  if (!rows.length) return null;
  return (
    <ul className="live-expect" aria-label="기대 결과">
      {rows.map((row) => {
        const { icon: Icon, text } = EXPECT[row.status];
        return (
          <li key={row.entity} className={row.status} title={`${text} · 기대: ${row.want} · 지금: ${row.got}`}>
            <Icon size={11} className={row.status === 'pending' ? 'live-spin' : undefined} /><span>{row.name}</span><b>{row.want}</b>
          </li>
        );
      })}
    </ul>
  );
}

export function LiveRunSteps({ run }) {
  if (!run) return <div className="live-empty-state"><Play size={16} /><span>시나리오를 누르거나 에이전트에게 직접 말해 보세요.</span></div>;
  return (
    <ol className="live-steps">
      {run.steps.map((step, index) => (
        <li key={index} className={`live-step step-${step.status}`}>
          <div className="live-step-head">
            <span className={`agent-pill ${agentColor(step.agent)}`}>{agentName(step.agent).replace(' Agent', '')}</span>
            {step.setup && <em className="live-step-setup">준비</em>}
            {step.status !== 'done' && <span className="live-step-status">{step.status === 'running' && <LoaderCircle size={11} className="live-spin" />}{stepText(step.status)}</span>}
          </div>
          <p className="live-said"><User size={11} />{step.say}</p>
          {step.reply && <div className="live-reply"><Bot size={11} /><Markdown text={step.reply} /></div>}
          {step.error && <p className="live-step-error">{step.error}</p>}
        </li>
      ))}
    </ol>
  );
}

/** The requests a run set off: who asked whom (path) and what came of it. */
export function LiveRequestFlows({ items, running }) {
  return (
    <div className="live-flows" aria-label="요청 흐름">
      <span>요청 흐름</span>
      {items.length ? (
        <ol>
          {items.map((item) => (
            <li key={item.key}>
              <div><b>{item.title}</b><small>{item.rule ? `${item.path[0]} · 자동 규칙` : item.path.join(' → ')}</small></div>
              <em className={item.accepted ? 'ok' : 'no'}>{item.result}</em>
            </li>
          ))}
        </ol>
      ) : <p>{running ? '에이전트 사이에 요청이 오가면 여기에 나타나요.' : '이번 실행에서 기기 요청은 없었어요.'}</p>}
    </div>
  );
}

export function LiveExpandedLog({ rows }) {
  if (!rows.length) return <div className="live-empty-state compact"><Wifi size={14} /><span>Agent 메시지를 기다리는 중입니다.</span></div>;
  return rows.map((row) => (
    <div className="expanded-log" key={row.key}>
      <time>{row.time}</time><div><b>{row.from}</b><ChevronRight size={12} /><b>{row.to}</b></div><p className={row.accepted === false ? 'live-rejected' : ''}>{row.text}</p>
    </div>
  ));
}
