"use client";

// Search results (Hub GET /agents?q=) and signing up an external agent by its Agent Card URL.
import { useState } from "react";
import { api, useApi } from "../../lib/api.js";
import { FIELDS, ORIGINS, SKILLS, agentNote, deviceName } from "../../lib/labels.js";
import { Notice, SearchIcon, agentSymbol } from "./ui.js";

const VISIBLE = 5;

function features(agent, devices) {
  return [
    ...agent.owned_devices.map((d) => deviceName(d, devices)),
    ...agent.provided_fields.map((f) => `공유: ${FIELDS[f] ?? f}`),
    ...agent.skills.filter((s) => !s.includes(".")).map((s) => `스킬: ${SKILLS[s] ?? s}`),
  ].slice(0, 6);
}

function AddByCard({ onAdded }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const agent = await api("hub/agents/discover", { method: "POST", body: { card_url: url.trim() } });
      setUrl("");
      onAdded(agent);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card-url-form" onSubmit={submit}>
      <label htmlFor="card-url">Agent Card URL로 외부 에이전트 등록</label>
      <div>
        <input id="card-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… /.well-known/agent-card.json" required />
        <button type="submit" disabled={busy || !url.trim()}>{busy ? "읽는 중…" : "등록"}</button>
      </div>
      <small>등록만으로는 아무 권한도 없어요. 상세 화면에서 권한을 확인하고 연결해야 동작합니다.</small>
      <Notice error={error} />
    </form>
  );
}

export default function SearchResults({ query, devices, onQuery, onBack, onSelect }) {
  const [draft, setDraft] = useState(query);
  const [step, setStep] = useState(0);
  const [sliding, setSliding] = useState(false);
  const { data, error, loading } = useApi(`hub/agents${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`);
  const results = data ?? [];
  const carousel = results.length > VISIBLE;
  const visible = carousel ? Array.from({ length: VISIBLE + 1 }, (_, i) => results[(step + i) % results.length]) : results;

  const finishSlide = (e) => {
    if (e.target !== e.currentTarget || !sliding) return;
    setStep((s) => s + 1);
    setSliding(false);
  };

  return (
    <main className="search-results">
      <div className="results-toolbar">
        <button className="results-back" type="button" onClick={onBack} aria-label="Back to Agent Hub">←</button>
        <form className="results-search" onSubmit={(e) => { e.preventDefault(); onQuery(draft); }}>
          <label className="sr-only" htmlFor="results-agent-search">Search agents</label>
          <input id="results-agent-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="이름, 공간, 설명으로 찾기" />
          <button type="submit" aria-label="Search"><SearchIcon /></button>
        </form>
      </div>

      <div className="results-heading">
        <span className="eyebrow">SEARCH RESULTS</span>
        <h1>{query.trim() ? `Agents for “${query.trim()}”` : "All agents"}</h1>
        <p className="results-count">{loading && !data ? "찾는 중…" : `${results.length}개`}</p>
      </div>
      <Notice error={error} />
      {data && results.length === 0 && <p className="empty-note">맞는 에이전트가 없어요. Agent Studio에서 직접 만들 수 있어요.</p>}

      {results.length > 0 && (
        <section className={`result-carousel ${carousel ? "" : "is-static"}`} aria-label="Agent search results">
          <div className={`carousel-track ${sliding ? "is-sliding" : ""}`} onTransitionEnd={finishSlide}>
            {visible.map((agent, i) => (
              <div key={`${step}-${i}-${agent.id}`} className="carousel-card" aria-hidden={carousel && i === VISIBLE}>
                <button type="button" className="result-card" onClick={() => onSelect(agent)}>
                  <span className="result-top">
                    <span className="result-symbol" aria-hidden="true">{agentSymbol(agent)}</span>
                    <span className={`result-badge ${agent.connected ? "is-on" : ""}`}>{agent.connected ? "연결됨" : "미연결"}</span>
                  </span>
                  <h2>{agent.name}</h2>
                  <p>{agent.description || agentNote(agent) || ORIGINS[agent.origin]}</p>
                  <ul>{features(agent, devices).map((f) => <li key={f}>{f}</li>)}</ul>
                  <small className="result-origin">{ORIGINS[agent.origin]}{agentNote(agent) ? ` · ${agentNote(agent)}` : ""}</small>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {carousel && <button className="results-next" type="button" onClick={() => setSliding(true)} disabled={sliding} aria-label="Show next agent cards">→</button>}

      <AddByCard onAdded={onSelect} />
    </main>
  );
}
