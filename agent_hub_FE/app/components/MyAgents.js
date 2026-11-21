"use client";

// The agents running the home now (connected in the Hub; Online from the Collector's card checks),
// and the agents this account made or added.
import { FIELDS, agentNote, deviceName, stateText } from "../../lib/labels.js";
import { CatalogCard } from "./SearchResults.js";
import { AgentAvatar, Icon, Notice, Status } from "./ui.js";

export default function MyAgents({ agents, error, online, devices, me, onSelect, onChanged }) {
  const running = (agents ?? []).filter((a) => a.connected);
  const made = (agents ?? []).filter((a) => a.mine);
  return (
    <main className="page" aria-label="My agents">
      <section className="page-hero">
        <span className="eyebrow">MY AGENTS</span>
        <h1>{me ? `${me.name}님의 에이전트` : "내 에이전트"}</h1>
        <p>지금 집에서 동작 중인 에이전트와 내가 만든 에이전트예요.</p>
      </section>
      <Notice error={error} />

      <section className="section">
        <header className="section-head">
          <h2>집에서 동작 중</h2>
          <span className="count">{running.length}</span>
        </header>
        {agents && running.length === 0 && <div className="empty"><p>연결된 에이전트가 없어요.</p></div>}
        <div className="running-grid">
          {running.map((agent) => (
            <button key={agent.id} type="button" className="running-card" onClick={() => onSelect(agent)}>
              <span className="running-top">
                <AgentAvatar agent={agent} />
                <span className="list-text"><strong>{agent.name}</strong><small>{agentNote(agent) || agent.origin}</small></span>
                <Status online={online[agent.id]} />
              </span>
              <ul className="running-things">
                {agent.owned_devices.slice(0, 4).map((d) => {
                  const dev = devices?.find((x) => x.entity === d);
                  return <li key={d}><span>{deviceName(d, devices)}</span><em className={dev?.state === "on" ? "is-on" : ""}>{stateText(dev) || "—"}</em></li>;
                })}
                {agent.provided_fields.map((f) => <li key={f}><span>공유: {FIELDS[f] ?? f}</span><em>상태</em></li>)}
              </ul>
              <span className="running-foot">권한 {agent.permissions.length}개 <Icon name="arrow" size={16} /></span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <header className="section-head">
          <h2>내가 만든 에이전트</h2>
          <span className="count">{made.length}</span>
          <a className="primary-button small" href="/?tab=agent-studio"><Icon name="wand" size={16} /> 새로 만들기</a>
        </header>
        {agents && made.length === 0 && (
          <div className="empty">
            <Icon name="wand" size={28} />
            <p>아직 없어요. Agent Studio에서 평범한 말로 첫 에이전트를 만들어 보세요.</p>
          </div>
        )}
        <div className="catalog-grid">
          {made.map((agent) => <CatalogCard key={agent.id} agent={agent} onSelect={onSelect} onChanged={onChanged} />)}
        </div>
      </section>
    </main>
  );
}
