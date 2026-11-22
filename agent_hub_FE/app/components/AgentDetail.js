"use client";

// One agent, in a sheet over whatever the person was looking at: overview (devices, shared state,
// who made it), connection (approve permissions, connect, hand devices over, disconnect) and
// activity (Hub record + request flows from the Event Collector).
import { useEffect, useRef, useState } from "react";
import { api, useApi } from "../../lib/api.js";
import {
  FIELDS, ORIGINS, ROLES, SKILLS, actionLine, actionText, agentName, agentNote, codeText, countText, dateText, deviceName, kindOf, makerText,
  permission, spaceName, stateText, timeAgo,
} from "../../lib/labels.js";
import Markdown from "./Markdown.js";
import { StarButton } from "./SearchResults.js";
import { AgentAvatar, Icon, Modal, Notice, Segmented, Sheet, Status, useConfirm, useToast } from "./ui.js";

function TokenModal({ result, agent, onClose }) {
  const studio = agent.origin === "studio";
  return (
    <Modal title={`${agent.name} 연결됨`} onClose={onClose} actions={<button type="button" className="primary-button" onClick={onClose}>확인</button>}>
      {result.token ? (
        <>
          <p>이 에이전트의 토큰이에요. <strong>지금 한 번만</strong> 보여 드려요. Cloud에는 해시만 남아요.</p>
          <code className="token-box">{result.token}</code>
          <p className="muted">
            {studio
              ? result.launch === "started"
                ? "Studio 에이전트는 이 토큰으로 바로 실행됐어요. 따로 할 일은 없어요."
                : `실행기에 전달하지 못했어요 (${result.launch ?? "실행기 없음"}). 연결은 유지돼요.`
              : "외부 에이전트 운영자에게 전달하세요. 이 토큰으로 Gateway와 다른 에이전트에 요청해요."}
          </p>
        </>
      ) : (
        <p>기본 에이전트는 .env에 있는 자기 토큰({result.token_env})을 그대로 써요.</p>
      )}
    </Modal>
  );
}

/** Approve permissions and connect (install), or disconnect. Used by the Hub sheet and /home. */
export function ConnectPanel({ agent, devices, agents, onChanged }) {
  const [picked, setPicked] = useState(() => new Set(agent.permissions));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [dialog, ask] = useConfirm();
  const toast = useToast();
  const permsKey = agent.permissions.join("|");
  useEffect(() => {
    setPicked(new Set(agent.permissions));
  }, [agent.id, permsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = async (fn) => {
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
  const connectNow = () => api("hub/connections", { method: "POST", body: { agent_id: agent.id, permissions: [...picked] } });
  const connected = (r) => {
    setResult(r);
    toast(`${agent.name}을(를) 집에 연결했어요`);
  };

  const connect = () => step(async () => {
    try {
      connected(await connectNow());
    } catch (err) {
      if (err?.reasonCode !== "OWNERSHIP_CONFLICT" || !err.detail?.owners) throw err;
      // Each device has one owner: offer to release the current owners first.
      const holders = [...new Set(Object.values(err.detail.owners))];
      const names = holders.map((id) => agentName(id, agents)).join(", ");
      const owned = Object.keys(err.detail.owners).map((d) => deviceName(d, devices)).join(", ");
      const ok = await ask({
        title: "이미 주인이 있는 기기예요",
        body: (
          <p>
            <strong>{owned}</strong>의 주인은 지금 <strong>{names}</strong>예요. 기기마다 주인은 하나라서, {names} 연결을 해제해야{" "}
            {agent.name}을(를) 연결할 수 있어요.
          </p>
        ),
        confirm: `${names} 해제하고 연결`,
      });
      if (!ok) return;
      for (const holder of holders) {
        const [conn] = await api(`hub/connections?agent_id=${encodeURIComponent(holder)}&active=true`);
        if (conn) await api(`hub/connections/${conn.id}`, { method: "DELETE" });
      }
      connected(await connectNow());
    }
  });

  const disconnect = () => step(async () => {
    const ok = await ask({
      title: `${agent.name} 연결을 해제할까요?`,
      body: "허용한 권한과 기기 주인이 바로 풀리고, Studio 에이전트는 멈춰요. 언제든 다시 연결할 수 있어요.",
      confirm: "연결 해제",
      danger: true,
    });
    if (!ok) return;
    await api(`hub/connections/${agent.connection_id}`, { method: "DELETE" });
    toast("연결을 해제했어요");
  });

  const remove = () => step(async () => {
    const ok = await ask({
      title: `${agent.name}을(를) 삭제할까요?`,
      body: "Agent Cloud와 카탈로그에서 사라지고, 연결도 함께 끊겨요. 되돌릴 수 없어요.",
      confirm: "삭제",
      danger: true,
    });
    if (!ok) return;
    await api(`hub/agents/${agent.id}`, { method: "DELETE" });
    toast("삭제했어요");
  });

  const refresh = () => step(async () => {
    await api(`hub/agents/${agent.id}/refresh`, { method: "POST" });
    toast("Agent Card를 새로 읽었어요");
  });

  const toggle = (p) => setPicked((s) => {
    const n = new Set(s);
    n.has(p) ? n.delete(p) : n.add(p);
    return n;
  });

  return (
    <section className="panel agent-panel" aria-label="Connection">
      <div className="panel-title">
        <h3>{agent.connected ? "허용한 권한" : "연결하면 허용할 권한"}</h3>
        <span className="count">{agent.permissions.length}개</span>
      </div>
      {agent.permissions.length === 0 && <p className="muted">요청한 권한이 없어요.</p>}
      <ul className="permission-list">
        {agent.permissions.map((p) => {
          const perm = permission(p, devices);
          return (
            <li key={p}>
              <label>
                <input type="checkbox" checked={agent.connected || picked.has(p)} disabled={agent.connected || busy} onChange={() => toggle(p)} />
                <span className="perm-icon"><Icon name={perm.kind === "context" ? "link" : kindOf(perm.id)} size={18} /></span>
                <span><strong>{perm.label}</strong><small>{perm.detail}</small></span>
              </label>
            </li>
          );
        })}
      </ul>
      <Notice error={error} />
      <div className="panel-actions">
        {agent.connected
          ? <button type="button" className="ghost-button" disabled={busy} onClick={disconnect}>연결 해제</button>
          : <button type="button" className="primary-button" disabled={busy} onClick={connect}>{busy ? "처리 중…" : "우리 집에 연결"}</button>}
        {agent.url && <button type="button" className="text-button" disabled={busy} onClick={refresh}>카드 새로 읽기</button>}
        {agent.origin !== "platform" && agent.mine && <button type="button" className="text-button danger" disabled={busy} onClick={remove}>삭제</button>}
      </div>
      {dialog}
      {result && <TokenModal result={result} agent={agent} onClose={() => setResult(null)} />}
    </section>
  );
}

/** Its maker lists it in the Hub catalog for everyone, or takes it back. */
export function ShareToggle({ agent, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();
  if (!agent.mine || agent.origin === "platform") return null;
  const flip = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api(`hub/agents/${agent.id}/share`, { method: "POST", body: { shared: !agent.shared } }));
      toast(agent.shared ? "공유를 멈췄어요" : "카탈로그에 공유했어요");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`share-row ${agent.shared ? "is-shared" : ""}`}>
      <span className="share-icon"><Icon name="share" size={18} /></span>
      <p>
        <strong>{agent.shared ? "카탈로그에 공유 중" : "나만 보이는 에이전트"}</strong>
        <small>{agent.shared ? "누구나 찾아서 설치할 수 있어요." : "공유하면 다른 사람도 찾아 설치할 수 있어요."}</small>
      </p>
      <button type="button" className={agent.shared ? "ghost-button small" : "primary-button small"} disabled={busy} onClick={flip}>
        {agent.shared ? "공유 중지" : "공유하기"}
      </button>
      <Notice error={error} />
    </div>
  );
}

/** A routine agent (asks the Root Agent at a time of day): run it now. */
function RoutineRun({ agent, onChanged }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!agent.permissions.some((p) => p.startsWith("request:"))) return null;
  const run = async () => {
    setBusy(true);
    try {
      const { results } = await api(`hub/agents/${agent.id}/run`, { method: "POST" });
      const r = results[0] ?? {};
      toast(r.accepted ? `실행했어요${r.delegated_to ? ` · ${r.delegated_to}에게 위임됨` : ""}` : `거절됐어요: ${r.message || codeText(r.reason_code)}`, r.accepted ? "info" : "error");
      onChanged();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="share-row">
      <span className="share-icon"><Icon name="clock" size={18} /></span>
      <p>
        <strong>정해진 시각에 Root Agent에게 부탁해요</strong>
        <small>{agent.description}</small>
      </p>
      <button type="button" className="primary-button small" disabled={busy || !agent.connected} onClick={run}>
        {busy ? "실행 중…" : "지금 실행"}
      </button>
      {!agent.connected && <small className="muted">연결해야 실행할 수 있어요.</small>}
    </div>
  );
}

function Overview({ agent, devices, onChanged }) {
  const owned = agent.owned_devices.map((d) => ({ id: d, dev: devices?.find((x) => x.entity === d) }));
  const reads = agent.permissions.filter((p) => p.startsWith("context:")).map((p) => permission(p, devices));
  return (
    <>
      {agent.description && <p className="sheet-lead">{agent.description}</p>}
      <RoutineRun agent={agent} onChanged={onChanged} />
      <ShareToggle agent={agent} onChanged={onChanged} />
      {owned.length > 0 && (
        <section className="sheet-section">
          <h3>맡는 기기</h3>
          <ul className="list-card">
            {owned.map(({ id, dev }) => (
              <li key={id} className={dev?.state === "on" ? "is-on" : ""}>
                <span className="list-icon"><Icon name={kindOf(id)} size={18} /></span>
                <span className="list-text"><strong>{deviceName(id, devices)}</strong><small>{spaceName(dev?.space)}</small></span>
                <span className="pill">{stateText(dev) || "—"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(agent.provided_fields.length > 0 || reads.length > 0) && (
        <section className="sheet-section">
          <h3>주고받는 상태</h3>
          <div className="chips">
            {agent.provided_fields.map((f) => <span key={f} className="chip">공유: {FIELDS[f] ?? f}</span>)}
            {reads.map((r) => <span key={r.id} className="chip">읽기: {r.label}</span>)}
          </div>
        </section>
      )}
      <section className="sheet-section">
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
      </section>
    </>
  );
}

function Activity({ agentId, agents, devices }) {
  const { data, error } = useApi(`hub/agents/${agentId}/activity?limit=12`, { interval: 5000 });
  return (
    <>
      <Notice error={error} />
      {data?.collector && data.collector !== "ok" && <p className="muted">요청 기록을 가져올 수 없어요 ({data.collector}).</p>}
      <section className="sheet-section">
        <h3>최근 요청</h3>
        {data?.flows?.length === 0 && <p className="muted">아직 처리한 요청이 없어요.</p>}
        <ol className="timeline">
          {(data?.flows ?? []).map((f) => (
            <li key={f.flow} className={f.accepted === false ? "is-rejected" : ""}>
              <span className="timeline-dot" />
              <span className="list-text">
                <strong>{actionLine(f.action, devices)}</strong>
                <small>
                  {f.requester && f.requester === f.entry ? `${agentName(f.entry, agents)} 자동화 규칙` : `${agentName(f.requester, agents) ?? "?"} → ${agentName(f.entry, agents) ?? "?"}`}
                  {" · "}{timeAgo(f.ended_at)}
                </small>
              </span>
              {f.accepted !== null && <span className={`pill ${f.accepted ? "" : "is-muted"}`}>{codeText(f.reason_code) || (f.accepted ? "허용" : "거절")}</span>}
            </li>
          ))}
        </ol>
      </section>
      <section className="sheet-section">
        <h3>Cloud 기록</h3>
        <ol className="audit-list">
          {(data?.hub ?? []).map((a, i) => (
            <li key={`${a.ts}-${i}`}><span>{actionText(a.action)}</span><small>@{a.actor} · {timeAgo(a.ts)}</small></li>
          ))}
        </ol>
      </section>
    </>
  );
}

const KEEP = 40; // messages kept per agent in this browser

function loadChat(agentId) {
  try {
    return JSON.parse(window.localStorage.getItem(`chat:${agentId}`) || "[]");
  } catch {
    return [];
  }
}

function saveChat(agentId, messages) {
  try {
    window.localStorage.setItem(`chat:${agentId}`, JSON.stringify(messages.slice(-KEEP)));
  } catch {
    // private window: the conversation just isn't kept
  }
}

/** Talk with a connected agent (Hub POST /agents/{id}/chat). Kept only in this browser. */
function Chat({ agent }) {
  const [messages, setMessages] = useState(() => loadChat(agent.id));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const end = useRef(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  const update = (next) => {
    setMessages(next);
    saveChat(agent.id, next);
  };
  const send = async (e) => {
    e?.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    const mine = [...messages, { from: "me", text: message }];
    update(mine);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const { reply } = await api(`hub/agents/${agent.id}/chat`, { method: "POST", body: { message } });
      update([...mine, { from: "agent", text: reply || "(빈 답)" }]);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!agent.connected) {
    return <div className="empty"><Icon name="lock" size={24} /><p>우리 집에 연결하면 대화할 수 있어요. 연결 탭에서 연결하세요.</p></div>;
  }
  return (
    <section className="chat" aria-label={`${agent.name}와 대화`}>
      <div className="chat-log">
        {messages.length === 0 && <p className="muted chat-hint">{agent.name}에게 무엇이든 물어보세요. 대화는 이 브라우저에만 남아요.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.from === "me" ? "is-me" : ""}`}>{m.from === "me" ? m.text : <Markdown text={m.text} />}</div>
        ))}
        {busy && <div className="bubble is-typing"><span /><span /><span /></div>}
        <div ref={end} />
      </div>
      <Notice error={error} />
      <form className="chat-input" onSubmit={send}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) send(e); }}
          placeholder="메시지 보내기 (Enter 전송, Shift+Enter 줄바꿈)"
          rows={2}
          maxLength={2000}
        />
        <button type="submit" className="primary-button small" disabled={busy || !text.trim()}>보내기</button>
      </form>
      {messages.length > 0 && <button type="button" className="text-button" onClick={() => update([])}>대화 지우기</button>}
    </section>
  );
}

const TABS = [
  ["overview", "개요"],
  ["chat", "대화"],
  ["connect", "연결"],
  ["activity", "활동"],
];

export default function AgentSheet({ agentId, agents, devices, online, initialTab = "overview", onClose, onChanged }) {
  const { data: agent, error, reload } = useApi(`hub/agents/${agentId}`, { interval: 5000 });
  const [tab, setTab] = useState(initialTab);
  const tabs = agent?.origin === "external" ? TABS.filter(([id]) => id !== "chat") : TABS;
  const changed = () => {
    reload();
    onChanged();
  };

  const header = agent ? (
    <div className="sheet-agent">
      <AgentAvatar agent={agent} size="lg" />
      <div>
        <strong>{agent.name}</strong>
        <small>{makerText(agent)}</small>
      </div>
    </div>
  ) : <strong>{error ? "에이전트" : "불러오는 중…"}</strong>;

  return (
    <Sheet header={header} label={agent?.name ?? agentId} onClose={onClose}>
      <Notice error={error} />
      {agent && (
        <>
          <div className="sheet-status">
            <span className={`badge ${agent.connected ? "is-on" : ""}`}>{agent.removed ? "삭제됨" : agent.connected ? "우리 집에 연결됨" : "미연결"}</span>
            {agent.connected && <Status online={online} />}
            {agentNote(agent) && <span className="badge">{agentNote(agent)}</span>}
            <span className="spacer" />
            <StarButton agent={agent} onChanged={changed} />
          </div>
          <Segmented items={tabs} value={tab} onChange={setTab} label="에이전트 정보" />
          <div className="sheet-tab">
            {tab === "overview" && <Overview agent={agent} devices={devices} onChanged={changed} />}
            {tab === "connect" && (agent.removed ? <p className="muted">삭제된 에이전트예요.</p> : <ConnectPanel agent={agent} devices={devices} agents={agents} onChanged={changed} />)}
            {tab === "activity" && <Activity agentId={agent.id} agents={agents} devices={devices} />}
            {tab === "chat" && <Chat agent={agent} />}
          </div>
        </>
      )}
    </Sheet>
  );
}
