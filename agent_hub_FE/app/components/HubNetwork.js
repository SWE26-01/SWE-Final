"use client";

// Agent Hub home: every agent registered in the Hub, around the search box.
import { useEffect, useMemo, useRef, useState } from "react";
import { agentNote } from "../../lib/labels.js";
import { Notice, SearchIcon, agentSymbol } from "./ui.js";

// Places around the centre circle (percent of the area), filled in order; more agents go on an ellipse.
const SLOTS = [[22, 22], [18, 76], [87, 18], [88, 54], [79, 82], [10, 49], [66, 9], [35, 91], [34, 8], [64, 92], [95, 85], [5, 92]];

function place(index, total) {
  if (index < SLOTS.length) return SLOTS[index];
  const angle = (index / Math.max(total, 1)) * Math.PI * 2;
  return [50 + Math.cos(angle) * 42, 52 + Math.sin(angle) * 40];
}

/** Small dots fanning out from an agent: one per device or shared field (at most 3). */
function satellites(x, y, count) {
  const away = Math.atan2(y - 52, x - 50);
  return Array.from({ length: Math.min(count, 3) }, (_, i) => {
    const angle = away + (i - (Math.min(count, 3) - 1) / 2) * 0.75;
    return [x + Math.cos(angle) * 11, y + Math.sin(angle) * 10];
  }).map(([px, py]) => [Math.min(97, Math.max(3, px)), Math.min(96, Math.max(4, py))]);
}

export function layout(agents) {
  return agents.map((agent, i) => {
    const [x, y] = place(i, agents.length);
    const things = agent.owned_devices.length + agent.provided_fields.length;
    return { ...agent, x, y, labelSide: x < 50 ? "right" : "left", points: satellites(x, y, Math.max(things, 1)) };
  });
}

export default function HubNetwork({ agents, error, query, onQuery, onSearch, onSelect }) {
  const [motionTime, setMotionTime] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchGeometry, setSearchGeometry] = useState(null);
  const searchFormRef = useRef(null);
  const searchTimer = useRef(null);
  const placed = useMemo(() => layout(agents ?? []), [agents]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? placed.filter((a) => `${a.id} ${a.name} ${a.description} ${agentNote(a)}`.toLowerCase().includes(q)) : placed;
  }, [placed, query]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    setIsMounted(true);
    let frame;
    let last = 0;
    const startedAt = performance.now();
    const animate = (now) => {
      if (now - last >= 33) {
        setMotionTime((now - startedAt) / 1000);
        last = now;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => searchTimer.current && window.clearTimeout(searchTimer.current), []);

  const startSearch = () => {
    if (isSearching) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onSearch();
    const rect = searchFormRef.current.getBoundingClientRect();
    const containing = searchFormRef.current.closest(".hub-core").getBoundingClientRect();
    const mobile = window.innerWidth <= 640;
    const pad = mobile ? 20 : window.innerWidth * 0.05;
    const toolbar = Math.min(680, window.innerWidth - pad * 2);
    const targetLeft = mobile ? pad + 50 : (window.innerWidth - toolbar) / 2 + 60;
    setSearchGeometry({
      "--search-start-top": `${rect.top - containing.top}px`,
      "--search-start-left": `${rect.left - containing.left}px`,
      "--search-start-width": `${rect.width}px`,
      "--search-start-height": `${rect.height}px`,
      "--search-target-top": `${(mobile ? 76 : 86) - containing.top}px`,
      "--search-target-left": `${targetLeft - containing.left}px`,
      "--search-target-width": `${mobile ? toolbar - 50 : toolbar - 120}px`,
      "--search-target-height": `${mobile ? 46 : 52}px`,
      "--search-target-button": `${mobile ? 36 : 40}px`,
    });
    setIsSearching(true);
    searchTimer.current = window.setTimeout(onSearch, 820);
  };

  const moving = placed.map((agent, i) => {
    if (!isMounted) return { ...agent, mx: agent.x, my: agent.y, mpoints: agent.points };
    const phase = motionTime * 0.55 + i * 1.37;
    return {
      ...agent,
      mx: agent.x + Math.sin(phase) * 0.9,
      my: agent.y + Math.cos(phase * 0.86) * 0.7,
      mpoints: agent.points.map(([x, y], p) => {
        const pp = motionTime * (0.62 + p * 0.09) + i * 1.61 + p * 0.83;
        return [x + Math.sin(pp) * 1.65, y + Math.cos(pp * 0.91) * 1.3];
      }),
    };
  });

  const found = query.trim() ? `${matches.length} agent${matches.length === 1 ? "" : "s"} found in the network` : null;

  return (
    <div className={`network ${isSearching ? "is-searching" : ""}`} aria-label="Agent network">
      <svg className="connections" viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
        {moving.map((a) => <line key={`${a.id}-hub`} className="hub-connection" x1={a.mx} y1={a.my} x2="50" y2="53" />)}
        {moving.flatMap((a) => a.mpoints.map(([x, y], p) => <line key={`${a.id}-${p}`} x1={a.mx} y1={a.my} x2={x} y2={y} />))}
      </svg>
      {moving.flatMap((a) => a.mpoints.map(([x, y], p) => (
        <span key={`${a.id}-dot-${p}`} className={`connection-dot ${p === 0 ? "connection-dot-large" : ""}`} style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true" />
      )))}

      <div className="hub-core">
        <span className="eyebrow">FIND YOUR PERFECT AGENT</span>
        <h1>Agent Hubs</h1>
        <form ref={searchFormRef} className="search" style={searchGeometry || undefined} onSubmit={(e) => { e.preventDefault(); startSearch(); }}>
          <label className="sr-only" htmlFor="agent-search">Search agents</label>
          <input id="agent-search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder="어떤 에이전트를 찾으세요? 예: 회의, 내 방" />
          <button type="submit" aria-label="Search" disabled={isSearching}><SearchIcon /></button>
        </form>
        <p>{found ?? (agents ? `${agents.length} agents in your home network.` : "Explore a network of agents built around your life.")}</p>
        <Notice error={error} />
      </div>

      {moving.map((a) => {
        const hidden = query.trim() && !matches.some((m) => m.id === a.id);
        return (
          <button key={a.id} className={`agent-node label-${a.labelSide} ${hidden ? "is-muted" : ""} ${a.connected ? "" : "is-idle"}`} style={{ left: `${a.mx}%`, top: `${a.my}%` }} onClick={() => onSelect(a)}>
            <span className="agent-symbol">{agentSymbol(a)}</span>
            <span className="agent-copy"><strong>{a.name}</strong><small>{agentNote(a) || a.origin}</small></span>
          </button>
        );
      })}
    </div>
  );
}
