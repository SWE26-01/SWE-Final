"use client";

// Agent Cloud home: search first, then the most-starred shared agents and the agents running this home.
// Each card opens the agent's sheet; searching opens the catalog.
import { agentNote } from "../../lib/labels.js";
import { CatalogCard } from "./SearchResults.js";
import { AgentAvatar, Icon, Notice, Status } from "./ui.js";

const QUICK = ["회의", "수면", "내 방", "외출", "절전"];
const POPULAR = 6;

export default function HubHome({ agents, popular, error, query, onQuery, onSearch, onSelect, online, stats, onChanged }) {
  const running = (agents ?? []).filter((a) => a.connected);
  return (
    <main className="page hub-home" aria-label="Agent Cloud">
      <section className="hub-hero">
        <span className="hub-mark"><Icon name="hub" size={26} /></span>
        <span className="eyebrow">FIND YOUR PERFECT AGENT</span>
        <h1>Agent Cloud</h1>
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

      <section className="section">
        <header className="section-head">
          <h2>인기 에이전트</h2>
          <button type="button" className="text-button" onClick={() => onSearch("")}>전체 보기 <Icon name="arrow" size={16} /></button>
        </header>
        {popular && popular.length === 0 && (
          <div className="empty">
            <Icon name="share" size={28} />
            <p>아직 공유된 에이전트가 없어요. Studio에서 만들고 카탈로그에 공유해 보세요.</p>
            <a className="primary-button small" href="/?tab=agent-studio">Agent Studio 열기</a>
          </div>
        )}
        <div className="catalog-grid">
          {(popular ?? []).slice(0, POPULAR).map((agent) => <CatalogCard key={agent.id} agent={agent} onSelect={onSelect} onChanged={onChanged} />)}
        </div>
      </section>

      <section className="section">
        <header className="section-head">
          <h2>우리 집 에이전트</h2>
          <span className="count">{running.length}</span>
        </header>
        <div className="home-agents">
          {running.map((a) => (
            <button key={a.id} type="button" className="home-agent" onClick={() => onSelect(a)}>
              <AgentAvatar agent={a} />
              <span className="list-text"><strong>{a.name}</strong><small>{agentNote(a) || "에이전트"}</small></span>
              <Status online={online?.[a.id]} />
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
