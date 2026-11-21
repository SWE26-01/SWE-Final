"use client";

// Agent Hub home: the agents in this home floating around a search card. Each node opens the agent's
// sheet; searching opens the catalog.
import { useEffect, useMemo, useState } from "react";
import { agentNote } from "../../lib/labels.js";
import { AgentAvatar, Icon, Notice } from "./ui.js";

// Places around the centre card (percent of the area), filled in order; more agents go on an ellipse.
const SLOTS = [[17, 24], [15, 74], [84, 22], [87, 52], [80, 80], [9, 49], [62, 10], [36, 90], [36, 10], [64, 90], [94, 86], [6, 90]];
const QUICK = ["회의", "수면", "내 방", "외출", "절전"];

function place(index, total) {
  if (index < SLOTS.length) return SLOTS[index];
  const angle = (index / Math.max(total, 1)) * Math.PI * 2;
  return [50 + Math.cos(angle) * 42, 50 + Math.sin(angle) * 40];
}

export function layout(agents) {
  return agents.map((agent, i) => {
    const [x, y] = place(i, agents.length);
    return { ...agent, x, y };
  });
}

export default function HubNetwork({ agents, error, query, onQuery, onSearch, onSelect, online, stats }) {
  const [t, setT] = useState(0);
  const placed = useMemo(() => layout(agents ?? []), [agents]);
  const q = query.trim().toLowerCase();
  const hit = (a) => !q || `${a.id} ${a.name} ${a.description} ${agentNote(a)}`.toLowerCase().includes(q);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    let frame;
    let last = 0;
    const start = performance.now();
    const tick = (now) => {
      if (now - last >= 40) {
        setT((now - start) / 1000);
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const moving = placed.map((a, i) => ({ ...a, mx: a.x + Math.sin(t * 0.5 + i * 1.4) * 0.8, my: a.y + Math.cos(t * 0.43 + i * 1.4) * 0.7 }));

  return (
    <main className="hub-home" aria-label="Agent network">
      <svg className="hub-lines" viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
        {moving.map((a) => <line key={a.id} x1={a.mx} y1={a.my} x2="50" y2="50" className={`${a.connected ? "is-on" : ""} ${hit(a) ? "" : "is-muted"}`} />)}
      </svg>

      <section className="hub-card">
        <span className="hub-mark"><Icon name="hub" size={26} /></span>
        <span className="eyebrow">FIND YOUR PERFECT AGENT</span>
        <h1>Agent Hub</h1>
        <p>우리 집 기기와 함께 일할 에이전트를 찾고, 만들고, 연결하세요.</p>
        <form className="search-bar" role="search" onSubmit={(e) => { e.preventDefault(); onSearch(query); }}>
          <Icon name="search" size={20} />
          <label className="sr-only" htmlFor="agent-search">에이전트 검색</label>
          <input id="agent-search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder="어떤 에이전트를 찾으세요?" />
          <button type="submit" className="primary-button small">검색</button>
        </form>
        <div className="chips chips-center">
          {QUICK.map((w) => <button type="button" key={w} className="chip chip-button" onClick={() => onSearch(w)}>{w}</button>)}
          <button type="button" className="chip chip-button is-on" onClick={() => onSearch("")}>전체 카탈로그 →</button>
        </div>
        {stats && (
          <dl className="hub-stats">
            <div><dt>연결된 에이전트</dt><dd>{stats.connected}</dd></div>
            <div><dt>공유된 에이전트</dt><dd>{stats.shared}</dd></div>
            <div><dt>집의 기기</dt><dd>{stats.devices}</dd></div>
          </dl>
        )}
        <Notice error={error} />
      </section>

      {moving.map((a) => (
        <button
          key={a.id}
          type="button"
          className={`hub-node ${a.x < 50 ? "is-left" : "is-right"} ${a.connected ? "" : "is-idle"} ${hit(a) ? "" : "is-muted"}`}
          style={{ left: `${a.mx}%`, top: `${a.my}%` }}
          onClick={() => onSelect(a)}
        >
          <AgentAvatar agent={a} size="sm" />
          <span className="hub-node-text">
            <strong>{a.name}</strong>
            <small>{agentNote(a) || "에이전트"}</small>
          </span>
          {a.connected && <i className={`dot ${online?.[a.id] === false ? "is-off" : ""}`} aria-label={online?.[a.id] === false ? "Offline" : "Online"} />}
        </button>
      ))}
    </main>
  );
}
