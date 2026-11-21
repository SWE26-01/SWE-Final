"use client";

// The Hub catalog: agents people shared, the home's own and the caller's, as a grid of cards
// (Hub GET /agents?q=&shared=&mine=&sort=). Stars on the card; details and installing in the sheet.
// Signing up an agent by its Agent Card URL stays, in a modal, for developers.
import { useState } from "react";
import { api, useApi } from "../../lib/api.js";
import { agentNote, countText, dateText, makerText } from "../../lib/labels.js";
import { AgentAvatar, Icon, Modal, Notice, Segmented, useToast } from "./ui.js";

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
      <label htmlFor="card-url">Agent Card URL</label>
      <div>
        <input id="card-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… /.well-known/agent-card.json" required />
        <button type="submit" className="primary-button small" disabled={busy || !url.trim()}>{busy ? "읽는 중…" : "등록"}</button>
      </div>
      <small>A2A 1.0 Agent Card를 읽어 등록해요. 처음엔 나만 보이고, 상세에서 공유하거나 연결할 수 있어요.</small>
      <Notice error={error} />
    </form>
  );
}

export function StarButton({ agent, onChanged, className = "" }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const toggle = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      onChanged?.(await api(`hub/agents/${agent.id}/star`, { method: "POST", body: { starred: !agent.starred } }));
      if (!agent.starred) toast(`${agent.name}에 별을 줬어요`);
    } catch (err) {
      toast(err.message, "error");
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

export function CatalogCard({ agent, onSelect, onChanged }) {
  const open = () => onSelect(agent);
  return (
    <article className="catalog-card" tabIndex={0} role="link" aria-label={`${agent.name} 열기`} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()}>
      <header>
        <AgentAvatar agent={agent} />
        <span className="catalog-title">
          <h2>{agent.name}</h2>
          <small>{makerText(agent)}</small>
        </span>
        <Icon name="arrow" size={18} className="catalog-arrow" />
      </header>
      <p className="catalog-desc">{agent.description || agentNote(agent) || "설명이 없어요."}</p>
      <div className="chips">
        {agent.connected && <span className="chip is-on">우리 집에 연결됨</span>}
        {agent.mine && <span className="chip">{agent.shared ? "공유 중" : "나만 보기"}</span>}
        {agentNote(agent) && <span className="chip">{agentNote(agent)}</span>}
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

export default function SearchResults({ query, onQuery, onSelect }) {
  const [draft, setDraft] = useState(query);
  const [scope, setScope] = useState("all");
  const [sort, setSort] = useState("stars");
  const [shown, setShown] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const params = new URLSearchParams({ sort });
  if (query.trim()) params.set("q", query.trim());
  if (scope === "shared") params.set("shared", "true");
  if (scope === "mine") params.set("mine", "true");
  const { data, error, loading, reload } = useApi(`hub/agents?${params}`);
  const results = data ?? [];

  return (
    <main className="page catalog">
      <section className="page-hero">
        <span className="eyebrow">AGENT CATALOG</span>
        <h1>{query.trim() ? `“${query.trim()}” 검색 결과` : "에이전트 둘러보기"}</h1>
        <p>사람들이 만들어 공유한 에이전트를 찾아 우리 집에 설치하세요.</p>
        <form className="search-bar" role="search" onSubmit={(e) => { e.preventDefault(); onQuery(draft); }}>
          <Icon name="search" size={20} />
          <label className="sr-only" htmlFor="catalog-search">에이전트 검색</label>
          <input id="catalog-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="이름, 설명, 만든 사람으로 찾기" />
          {draft && <button type="button" className="icon-button" onClick={() => { setDraft(""); onQuery(""); }} aria-label="지우기"><Icon name="close" size={16} /></button>}
          <button type="submit" className="primary-button small">검색</button>
        </form>
      </section>

      <div className="toolbar">
        <Segmented items={SCOPES} value={scope} onChange={(v) => { setScope(v); setShown(PAGE); }} label="범위" />
        <span className="toolbar-count">{loading && !data ? "찾는 중…" : `${results.length}개`}</span>
        <Segmented items={SORTS} value={sort} onChange={setSort} label="정렬" size="sm" />
      </div>

      <Notice error={error} />
      {data && results.length === 0 && (
        <div className="empty">
          <Icon name="search" size={28} />
          <p>{scope === "mine" ? "아직 만든 에이전트가 없어요." : "맞는 에이전트가 없어요."}</p>
          <a className="primary-button small" href="/?tab=agent-studio">Agent Studio에서 만들기</a>
        </div>
      )}

      <section className="catalog-grid" aria-label="Agents">
        {results.slice(0, shown).map((agent) => <CatalogCard key={agent.id} agent={agent} onSelect={onSelect} onChanged={reload} />)}
      </section>
      {results.length > shown && (
        <button type="button" className="more-button" onClick={() => setShown((n) => n + PAGE)}>더 많은 에이전트 보기 <Icon name="arrow" size={18} /></button>
      )}

      <p className="dev-add">
        개발자이신가요? <button type="button" className="text-button" onClick={() => setAdding(true)}>Agent Card URL로 직접 등록</button>
      </p>
      {adding && (
        <Modal title="외부 에이전트 등록" onClose={() => setAdding(false)}>
          <AddByCard onAdded={(agent) => { setAdding(false); reload(); onSelect(agent); }} />
        </Modal>
      )}
    </main>
  );
}
