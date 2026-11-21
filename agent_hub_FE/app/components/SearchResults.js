"use client";

// The Hub catalog: agents people shared, the home's own and the caller's, as a grid of cards
// (Hub GET /agents?q=&shared=&mine=&sort=). Starring happens on the card; installing on the detail.
// Signing up an agent by its Agent Card URL stays, folded away, for developers.
import { useState } from "react";
import { api, useApi } from "../../lib/api.js";
import { agentNote, countText, dateText, makerText } from "../../lib/labels.js";
import { Notice, SearchIcon } from "./ui.js";

const PAGE = 9;
const SCOPES = [
  ["all", "전체"],
  ["shared", "공유된 에이전트"],
  ["mine", "내가 만든"],
];
const SORTS = [
  ["stars", "인기순"],
  ["installs", "설치순"],
  ["new", "최신순"],
];

export function AddByCard({ onAdded }) {
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
      <small>등록한 에이전트는 나만 보여요. 상세 화면에서 Hub에 공유하거나 연결할 수 있어요.</small>
      <Notice error={error} />
    </form>
  );
}

export function StarButton({ agent, onChanged, className = "" }) {
  const [busy, setBusy] = useState(false);
  const toggle = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      onChanged?.(await api(`hub/agents/${agent.id}/star`, { method: "POST", body: { starred: !agent.starred } }));
    } catch {
      // ACCOUNT_ONLY and the like: the count simply stays
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={`star-button ${agent.starred ? "is-on" : ""} ${className}`} onClick={toggle} disabled={busy} aria-pressed={agent.starred} aria-label={agent.starred ? "별 취소" : "별 주기"}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8L12 3.8Z" /></svg>
      {countText(agent.stars)}
    </button>
  );
}

function CatalogCard({ agent, onSelect, onChanged }) {
  const open = () => onSelect(agent);
  return (
    <article className="catalog-card" tabIndex={0} role="link" aria-label={`${agent.name} 열기`} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()}>
      <header>
        <h2>{agent.name}</h2>
        <span className="catalog-arrow" aria-hidden="true">→</span>
      </header>
      <p className="catalog-maker">
        <span aria-hidden="true">{agent.origin === "platform" ? "✦" : agent.origin === "studio" ? "✧" : "◇"}</span>
        {makerText(agent)}
      </p>
      <p className="catalog-desc">{agent.description || agentNote(agent) || "설명이 없어요."}</p>
      <div className="catalog-tags">
        {agent.connected && <span className="is-on">우리 집에 연결됨</span>}
        {agent.mine && <span>{agent.shared ? "공유 중" : "나만 보기"}</span>}
        {agentNote(agent) && <span>{agentNote(agent)}</span>}
      </div>
      <div className="catalog-foot">
        <span>{dateText(agent.created_at)}</span>
        <span className="catalog-stats">
          <small>설치 {countText(agent.installs)}</small>
          <StarButton agent={agent} onChanged={onChanged} />
        </span>
      </div>
    </article>
  );
}

export default function SearchResults({ query, onQuery, onBack, onSelect }) {
  const [draft, setDraft] = useState(query);
  const [scope, setScope] = useState("all");
  const [sort, setSort] = useState("stars");
  const [shown, setShown] = useState(PAGE);
  const params = new URLSearchParams({ sort });
  if (query.trim()) params.set("q", query.trim());
  if (scope === "shared") params.set("shared", "true");
  if (scope === "mine") params.set("mine", "true");
  const { data, error, loading, reload } = useApi(`hub/agents?${params}`);
  const results = data ?? [];

  return (
    <main className="search-results catalog">
      <div className="results-toolbar">
        <button className="results-back" type="button" onClick={onBack} aria-label="Back to Agent Hub">←</button>
        <form className="results-search" onSubmit={(e) => { e.preventDefault(); onQuery(draft); }}>
          <label className="sr-only" htmlFor="results-agent-search">Search agents</label>
          <input id="results-agent-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="이름, 설명, 만든 사람으로 찾기" />
          <button type="submit" aria-label="Search"><SearchIcon /></button>
        </form>
      </div>

      <div className="results-heading">
        <span className="eyebrow">AGENT CATALOG</span>
        <h1>{query.trim() ? `Agents for “${query.trim()}”` : "Explore agents"}</h1>
        <p className="results-count">
          {loading && !data ? "찾는 중…" : `${results.length}개 · 사람들이 만들어 공유한 에이전트를 찾아 우리 집에 설치하세요`}
        </p>
      </div>

      <div className="catalog-filters">
        <div role="group" aria-label="범위">
          {SCOPES.map(([id, label]) => (
            <button type="button" key={id} className={scope === id ? "active" : ""} onClick={() => { setScope(id); setShown(PAGE); }}>{label}</button>
          ))}
        </div>
        <div role="group" aria-label="정렬">
          {SORTS.map(([id, label]) => (
            <button type="button" key={id} className={sort === id ? "active" : ""} onClick={() => setSort(id)}>{label}</button>
          ))}
        </div>
      </div>

      <Notice error={error} />
      {data && results.length === 0 && (
        <p className="empty-note">{scope === "mine" ? "아직 만든 에이전트가 없어요. Agent Studio에서 만들어 보세요." : "맞는 에이전트가 없어요. Agent Studio에서 직접 만들 수 있어요."}</p>
      )}

      <section className="catalog-grid" aria-label="Agents">
        {results.slice(0, shown).map((agent) => <CatalogCard key={agent.id} agent={agent} onSelect={onSelect} onChanged={reload} />)}
      </section>
      {results.length > shown && (
        <button type="button" className="catalog-more" onClick={() => setShown((n) => n + PAGE)}>더 많은 에이전트 보기 <span>→</span></button>
      )}

      <details className="dev-add">
        <summary>개발자용: Agent Card URL로 직접 등록</summary>
        <AddByCard onAdded={onSelect} />
      </details>
    </main>
  );
}
