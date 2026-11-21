"use client";

// The agents connected now (Hub GET /agents?connected=true), each with whether it is running
// (Collector GET /agents reads every agent's card), and the agents this account made or added.
import { FIELDS, agentNote, countText, deviceName } from "../../lib/labels.js";
import { Notice, Status, agentSymbol } from "./ui.js";

export default function MyAgents({ agents, error, online, devices, me, onSelect }) {
  const mine = (agents ?? []).filter((a) => a.connected);
  const made = (agents ?? []).filter((a) => a.mine);
  return (
    <main className="my-agents" aria-label="My agents">
      <header className="my-agents-heading">
        <span className="eyebrow">YOUR ACTIVE NETWORK</span>
        <h1>Agents in use</h1>
        <p>지금 집에 연결되어 동작 중인 에이전트예요. 연결을 해제하면 권한과 기기 소유가 함께 사라집니다.</p>
      </header>
      <Notice error={error} />
      {agents && mine.length === 0 && <p className="empty-note">연결된 에이전트가 없어요. Agent Hub에서 연결해 보세요.</p>}
      <div className="my-agents-grid">
        {mine.map((agent) => (
          <button key={agent.id} className="my-agent-card" onClick={() => onSelect(agent)}>
            <span className="my-agent-card-top">
              <span className="my-agent-symbol" aria-hidden="true">{agentSymbol(agent)}</span>
              <Status online={online[agent.id]} />
            </span>
            <span className="my-agent-name">{agent.name}</span>
            <span className="my-agent-note">{agentNote(agent) || agent.origin}</span>
            <span className="my-agent-devices">
              {[...agent.owned_devices.map((d) => deviceName(d, devices)), ...agent.provided_fields.map((f) => `공유: ${FIELDS[f] ?? f}`)].slice(0, 4).join(" · ")}
            </span>
            <span className="my-agent-meta">
              <span>권한 {agent.permissions.length}개</span>
              <span aria-hidden="true">↗</span>
            </span>
          </button>
        ))}
      </div>

      <header className="my-agents-heading made-heading">
        <span className="eyebrow">MADE BY {me ? `@${me.id}`.toUpperCase() : "YOU"}</span>
        <h2>내가 만든 에이전트</h2>
        <p>Studio에서 만들거나 직접 등록한 에이전트예요. 상세 화면에서 Hub에 공유하면 다른 사람도 설치할 수 있어요.</p>
      </header>
      {agents && made.length === 0 && <p className="empty-note">아직 없어요. Agent Studio에서 첫 에이전트를 만들어 보세요.</p>}
      <div className="my-agents-grid">
        {made.map((agent) => (
          <button key={agent.id} className="my-agent-card" onClick={() => onSelect(agent)}>
            <span className="my-agent-card-top">
              <span className="my-agent-symbol" aria-hidden="true">{agentSymbol(agent)}</span>
              <span className={`result-badge ${agent.shared ? "is-on" : ""}`}>{agent.shared ? "공유 중" : "나만 보기"}</span>
            </span>
            <span className="my-agent-name">{agent.name}</span>
            <span className="my-agent-note">{agentNote(agent) || agent.origin}</span>
            <span className="my-agent-meta">
              <span>★ {countText(agent.stars)} · 설치 {countText(agent.installs)}{agent.connected ? " · 연결됨" : ""}</span>
              <span aria-hidden="true">↗</span>
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}
