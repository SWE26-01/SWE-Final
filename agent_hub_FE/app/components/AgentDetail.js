"use client";

// One agent: what it owns and may read, connect (approve permissions) or disconnect it, and what it
// has done (Hub record + request flows from the Event Collector).
import { useEffect, useMemo, useState } from "react";
import { api, useApi } from "../../lib/api.js";
import {
  FIELDS, ORIGINS, ROLES, SKILLS, actionLine, actionText, agentName, codeText, countText, dateText, deviceName, makerText, permission,
  spaceName, stateText, timeAgo,
} from "../../lib/labels.js";
import { StarButton } from "./SearchResults.js";
import { Modal, Notice, Status, agentSymbol } from "./ui.js";

/** Its maker lists it in the Hub catalog for everyone, or takes it back. */
export function ShareToggle({ agent, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!agent.mine || agent.origin === "platform") return null;
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api(`hub/agents/${agent.id}/share`, { method: "POST", body: { shared: !agent.shared } }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="share-row">
      <p>{agent.shared ? "Hub 카탈로그에 공유 중이에요. 누구나 찾아서 설치할 수 있어요." : "나만 보이는 에이전트예요. 공유하면 다른 사람도 찾아 설치할 수 있어요."}</p>
      <button type="button" className={agent.shared ? "ghost-button" : "primary-button small"} disabled={busy} onClick={toggle}>
        {agent.shared ? "공유 중지" : "Hub에 공유"}
      </button>
      <Notice error={error} />
    </div>
  );
}

/** Nodes around the agent: its devices (with their state now) and the context it reads or shares. */
function nodesOf(agent, devices) {
  const items = [
    ...agent.owned_devices.map((d) => {
      const dev = devices?.find((x) => x.entity === d);
      return { key: d, label: deviceName(d, devices), sub: stateText(dev), kind: "device" };
    }),
    ...agent.permissions.filter((p) => p.startsWith("context:")).map((p) => {
      const perm = permission(p, devices);
      return { key: p, label: perm.label, sub: perm.detail, kind: "context" };
    }),
    ...agent.provided_fields.map((f) => ({ key: `field:${f}`, label: FIELDS[f] ?? f, sub: "공유하는 상태", kind: "context" })),
  ];
  return items.map((item, i) => {
    const angle = -Math.PI / 2 + (i + 0.5) * ((Math.PI * 2) / Math.max(items.length, 1));
    return { ...item, x: 50 + Math.cos(angle) * 34, y: 42 + Math.sin(angle) * 34 };
  });
}

function TokenModal({ result, agent, onClose }) {
  const studio = agent.origin === "studio";
  return (
    <Modal title="연결됐어요" onClose={onClose}>
      {result.token ? (
        <>
          <p>이 에이전트의 토큰이에요. <strong>지금 한 번만</strong> 보여 드려요. Hub에는 해시만 남습니다.</p>
          <code className="token-box">{result.token}</code>
          {studio ? (
            <p className="modal-note">
              {result.launch === "started"
                ? "Studio 에이전트는 이 토큰으로 바로 실행됐어요. 따로 할 일은 없어요."
                : `실행기에 전달하지 못했어요 (${result.launch ?? "실행기 없음"}). 연결은 유지됩니다.`}
            </p>
          ) : (
            <p className="modal-note">외부 에이전트 운영자에게 전달하세요. 이 토큰으로 Gateway와 다른 에이전트에 요청합니다.</p>
          )}
        </>
      ) : (
        <p>기본 에이전트는 .env에 있는 자기 토큰({result.token_env})을 그대로 씁니다.</p>
      )}
      <button type="button" className="primary-button small" onClick={onClose}>확인</button>
    </Modal>
  );
}

export function ConnectPanel({ agent, devices, agents, onChanged }) {
  const [picked, setPicked] = useState(() => new Set(agent.permissions));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  useEffect(() => setPicked(new Set(agent.permissions)), [agent.id, agent.permissions]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const connect = () => run(async () => setResult(await api("hub/connections", { method: "POST", body: { agent_id: agent.id, permissions: [...picked] } })));
  const disconnect = () => run(() => api(`hub/connections/${agent.connection_id}`, { method: "DELETE" }));
  const remove = () => window.confirm(`${agent.name}을(를) Hub에서 삭제할까요? 연결도 함께 끊깁니다.`) && run(() => api(`hub/agents/${agent.id}`, { method: "DELETE" }));
  const refresh = () => run(() => api(`hub/agents/${agent.id}/refresh`, { method: "POST" }));
  /** The user asked for it: release the devices other agents hold, then connect. */
  const takeOver = (owners) => run(async () => {
    for (const holder of new Set(Object.values(owners))) {
      const [conn] = await api(`hub/connections?agent_id=${encodeURIComponent(holder)}&active=true`);
      if (conn) await api(`hub/connections/${conn.id}`, { method: "DELETE" });
    }
    setResult(await api("hub/connections", { method: "POST", body: { agent_id: agent.id, permissions: [...picked] } }));
  });

  const conflict = error?.reasonCode === "OWNERSHIP_CONFLICT" ? error.detail.owners : null;
  const toggle = (p) => setPicked((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  return (
    <section className="agent-panel" aria-label="Connection">
      <h3>{agent.connected ? "부여된 권한" : "연결하면 허용할 권한"}</h3>
      {agent.permissions.length === 0 && <p className="panel-note">요청한 권한이 없어요.</p>}
      <ul className="permission-list">
        {agent.permissions.map((p) => {
          const perm = permission(p, devices);
          return (
            <li key={p}>
              <label>
                <input type="checkbox" checked={agent.connected || picked.has(p)} disabled={agent.connected || busy} onChange={() => toggle(p)} />
                <span><strong>{perm.label}</strong><small>{perm.detail}</small></span>
              </label>
            </li>
          );
        })}
      </ul>
      <Notice error={error} />
      {conflict && (
        <button type="button" className="ghost-button" disabled={busy} onClick={() => takeOver(conflict)}>
          {[...new Set(Object.values(conflict))].map((id) => agentName(id, agents)).join(", ")} 연결 해제하고 연결하기
        </button>
      )}
      <div className="panel-actions">
        {agent.connected
          ? <button type="button" className="ghost-button" disabled={busy} onClick={disconnect}>연결 해제</button>
          : <button type="button" className="primary-button small" disabled={busy} onClick={connect}>{busy ? "처리 중…" : "연결하기"}</button>}
        {agent.url && <button type="button" className="text-button" disabled={busy} onClick={refresh}>카드 새로 읽기</button>}
        {agent.origin !== "platform" && agent.mine && <button type="button" className="text-button danger" disabled={busy} onClick={remove}>삭제</button>}
      </div>
      {result && <TokenModal result={result} agent={agent} onClose={() => setResult(null)} />}
    </section>
  );
}

function Activity({ agentId, agents, devices }) {
  const { data, error } = useApi(`hub/agents/${agentId}/activity?limit=12`, { interval: 5000 });
  return (
    <section className="agent-panel activity-panel" aria-label="Activity">
      <h3>최근 요청</h3>
      <Notice error={error} />
      {data?.collector && data.collector !== "ok" && <p className="panel-note">요청 기록을 가져올 수 없어요 ({data.collector}).</p>}
      {data?.flows?.length === 0 && <p className="panel-note">아직 처리한 요청이 없어요.</p>}
      <ol className="flow-list">
        {(data?.flows ?? []).map((f) => (
          <li key={f.flow} className={f.accepted === false ? "is-rejected" : ""}>
            <span className="flow-line">
              {f.requester && f.requester === f.entry
                ? <><strong>{agentName(f.entry, agents)}</strong> 자동화 규칙</>
                : <><strong>{agentName(f.requester, agents) ?? "?"}</strong> → {agentName(f.entry, agents) ?? "?"}</>}
              <em>{f.accepted === null ? "" : codeText(f.reason_code) || (f.accepted ? "허용" : "거절")}</em>
            </span>
            <small>{actionLine(f.action, devices)} · {timeAgo(f.ended_at)}</small>
          </li>
        ))}
      </ol>
      <h3>Hub 기록</h3>
      <ol className="audit-list">
        {(data?.hub ?? []).map((a, i) => (
          <li key={`${a.ts}-${i}`}><span>{actionText(a.action)}</span><small>{a.actor} · {timeAgo(a.ts)}</small></li>
        ))}
      </ol>
    </section>
  );
}

export default function AgentDetail({ agentId, agents, devices, online, onBack, onChanged }) {
  const { data: agent, error, reload } = useApi(`hub/agents/${agentId}`);
  const nodes = useMemo(() => (agent ? nodesOf(agent, devices) : []), [agent, devices]);
  const changed = () => {
    reload();
    onChanged();
  };

  if (!agent) {
    return (
      <main className="agent-detail">
        <div className="detail-bar"><button className="detail-back" onClick={onBack}><span>←</span> Agent Hub</button></div>
        <Notice error={error}>{error ? null : "불러오는 중…"}</Notice>
      </main>
    );
  }

  return (
    <main className="agent-detail">
      <div className="detail-bar">
        <button className="detail-back" onClick={onBack}><span>←</span> Agent Hub</button>
        <span className="detail-title">{agent.removed ? "삭제된 에이전트" : ""}</span>
        <span className="detail-state">
          <Status online={online} />
          <span className={`result-badge ${agent.connected ? "is-on" : ""}`}>{agent.connected ? "연결됨" : "미연결"}</span>
        </span>
      </div>

      <div className="detail-body">
        <aside className="detail-side">
          <section className="agent-panel">
            <h3>정보</h3>
            <dl className="info-list">
              <div><dt>종류</dt><dd>{ORIGINS[agent.origin]}</dd></div>
              {agent.role && <div><dt>역할</dt><dd>{ROLES[agent.role] ?? agent.role}</dd></div>}
              {agent.space && <div><dt>공간</dt><dd>{spaceName(agent.space)}</dd></div>}
              {agent.skills.length > 0 && <div><dt>스킬</dt><dd>{agent.skills.map((s) => SKILLS[s] ?? s).join(", ")}</dd></div>}
              <div><dt>만든 사람</dt><dd>{makerText(agent)}</dd></div>
              <div><dt>등록일</dt><dd>{dateText(agent.created_at)} · 설치 {countText(agent.installs)}</dd></div>
              {agent.url && <div><dt>Agent Card</dt><dd className="mono">{agent.url}</dd></div>}
            </dl>
            {agent.description && <p className="panel-note">{agent.description}</p>}
            <div className="share-row">
              <p>{agent.starred ? "별을 줬어요." : "마음에 들면 별을 주세요."}</p>
              <StarButton agent={agent} onChanged={changed} />
            </div>
            <ShareToggle agent={agent} onChanged={changed} />
          </section>
          {!agent.removed && <ConnectPanel agent={agent} devices={devices} agents={agents} onChanged={changed} />}
        </aside>

        <div className="detail-network" aria-label={`${agent.name} devices and context`}>
          <svg className="detail-connections" viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
            {nodes.map((n) => <line key={n.key} x1="50" y1="42" x2={n.x} y2={n.y} className={agent.connected ? "" : "is-idle"} />)}
          </svg>
          <div className="detail-center">
            <span className="detail-star">{agentSymbol(agent)}</span>
            <strong>{agent.name}</strong>
            <small>{agent.space ? spaceName(agent.space) : ORIGINS[agent.origin]}</small>
          </div>
          {nodes.map((n) => (
            <div key={n.key} className={`detail-node ${n.x > 50 ? "detail-node-left" : "detail-node-right"} ${n.kind === "context" ? "is-context" : ""}`} style={{ left: `${n.x}%`, top: `${n.y}%` }}>
              <span className="detail-dot" />
              <strong>{n.label}{n.sub && <small>{n.sub}</small>}</strong>
            </div>
          ))}
          {nodes.length === 0 && <p className="detail-empty">이 에이전트는 기기나 공유 상태가 없어요.</p>}
        </div>

        <aside className="detail-side"><Activity agentId={agent.id} agents={agents} devices={devices} /></aside>
      </div>
    </main>
  );
}
