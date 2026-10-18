// Panels for live data, built from the same class names as the mock panels so they look alike.
import React from 'react';
import { Bot, BrainCircuit, ChevronRight, Radio, Wifi, WifiOff } from 'lucide-react';
import { socketLabel } from './mapping';
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
        <span className="confidence">LIVE · {cards.length} REQUESTS</span>
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
      ) : <p className="live-flow-empty">아직 요청이 없어요. scripts/scenario.sh를 돌리거나 에이전트에게 말을 걸어 보세요.</p>}
      <div className="decision-footer"><span>요청 하나 = 에이전트를 넘나든 흐름 하나</span><span>Collector /flows <ChevronRight size={13} /></span></div>
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

export function LiveExpandedLog({ rows }) {
  if (!rows.length) return <div className="live-empty-state compact"><Wifi size={14} /><span>Agent 메시지를 기다리는 중입니다.</span></div>;
  return rows.map((row) => (
    <div className="expanded-log" key={row.key}>
      <time>{row.time}</time><div><b>{row.from}</b><ChevronRight size={12} /><b>{row.to}</b></div><p className={row.accepted === false ? 'live-rejected' : ''}>{row.text}</p>
    </div>
  ));
}
