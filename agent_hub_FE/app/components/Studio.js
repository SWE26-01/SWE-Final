"use client";

// Agent Studio: a sentence -> Studio fills its form (LLM), compiles rules from the built-in skills and
// checks the capability lock -> the user reads the summary and approves -> registered in the Hub.
import { useState } from "react";
import { api, useApi } from "../../lib/api.js";
import { permission, spaceName, timeAgo } from "../../lib/labels.js";
import { Notice, SearchIcon } from "./ui.js";

const STATUS = {
  new: "만드는 중",
  blocked: "안전 검사에서 막힘",
  failed: "만들지 못함",
  clarify: "질문이 있어요",
  unsupported: "지원하지 않는 요청",
  invalid: "규칙을 만들지 못함",
  ready: "승인 대기",
  registered: "Hub에 등록됨",
};

const EXAMPLES = ["회의할 때 내 방 조명을 회의 모드로 바꿔 줘", "외출하면 내 방 조명이랑 에어컨 꺼 줘", "아기 재울 때 보호 방 수면 모드 켜 줘"];

function DraftView({ draft, devices, onDraft, onOpenAgent, onNew }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const act = async (path, body) => {
    setBusy(true);
    setError(null);
    try {
      onDraft(await api(path, { method: "POST", body }));
      setAnswer("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="studio-draft" aria-label="Draft">
      <header className="studio-draft-head">
        <span className={`draft-status status-${draft.status}`}>{STATUS[draft.status] ?? draft.status}</span>
        <button type="button" className="text-button" onClick={onNew}>새로 만들기</button>
      </header>
      <blockquote className="draft-request">{draft.request}</blockquote>

      {draft.status === "blocked" && (
        <div className="draft-block">
          <h3>요청에 위험한 내용이 있어 LLM에 보내지 않았어요</h3>
          <ul>{draft.findings.map((f) => <li key={f.code + f.excerpt}><strong>{f.message}</strong> <code>{f.excerpt}</code></li>)}</ul>
        </div>
      )}

      {draft.status === "clarify" && (
        <form className="draft-block" onSubmit={(e) => { e.preventDefault(); act(`studio/drafts/${draft.id}/answer`, { answer }); }}>
          <h3>{draft.question}</h3>
          <div className="inline-form">
            <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="예: 내 방" maxLength={200} required />
            <button type="submit" className="primary-button small" disabled={busy || !answer.trim()}>{busy ? "다시 만드는 중…" : "답하기"}</button>
          </div>
        </form>
      )}

      {["unsupported", "invalid", "failed"].includes(draft.status) && (
        <div className="draft-block">
          <h3>{draft.reason || "이 요청으로는 에이전트를 만들 수 없어요"}</h3>
          {draft.errors.length > 0 && <ul>{draft.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          <p className="panel-note">기본 스킬(회의 모드, 수면 모드, 절전, 외출·귀가)과 집에 있는 기기로 표현해 보세요.</p>
        </div>
      )}

      {(draft.status === "ready" || draft.status === "registered") && (
        <>
          <div className="draft-block">
            <h3>만들어질 에이전트</h3>
            <ul className="summary-list">{draft.summary.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
          <div className="draft-block">
            <h3>연결할 때 요청할 권한</h3>
            <ul className="permission-list readonly">
              {draft.permissions.map((p) => {
                const perm = permission(p, devices);
                return <li key={p}><span><strong>{perm.label}</strong><small>{perm.detail}</small></span></li>;
              })}
            </ul>
          </div>
          {draft.warnings.length > 0 && (
            <div className="draft-block warning">
              <h3>알아 둘 점</h3>
              <ul>{draft.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          <details className="draft-files">
            <summary>생성된 파일 보기 (안전 검사 통과)</summary>
            {Object.entries(draft.files).map(([name, text]) => (
              <div key={name}><strong>{name}</strong><pre>{text}</pre></div>
            ))}
          </details>
        </>
      )}

      <Notice error={error} />
      <div className="panel-actions">
        {draft.status === "ready" && (
          <button type="button" className="primary-button" disabled={busy} onClick={() => act(`studio/drafts/${draft.id}/approve`)}>
            {busy ? "등록하는 중…" : "승인하고 Hub에 등록"} <span>→</span>
          </button>
        )}
        {draft.status === "registered" && (
          <button type="button" className="primary-button" onClick={() => onOpenAgent(draft.agent_id)}>
            Hub에서 연결하기 <span>→</span>
          </button>
        )}
      </div>
    </section>
  );
}

function RecentDrafts({ onPick }) {
  const { data } = useApi("studio/drafts?limit=6");
  if (!data?.length) return null;
  return (
    <section className="recent-drafts" aria-label="Recent drafts">
      <span className="eyebrow">RECENT</span>
      <ul>
        {data.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => onPick(d)}>
              <span>{d.request.split("\n")[0]}</span>
              <small>{STATUS[d.status] ?? d.status} · {timeAgo(d.updated_at)}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Studio({ draftId, devices, onDraftId, onOpenAgent }) {
  const [prompt, setPrompt] = useState("");
  const [space, setSpace] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fresh, setFresh] = useState(null); // the draft just returned, before a reload
  const loaded = useApi(draftId && fresh?.id !== draftId ? `studio/drafts/${draftId}` : null);
  const { data: spaces } = useApi("hub/spaces");
  const draft = fresh?.id === draftId ? fresh : loaded.data;

  const showDraft = (d) => {
    setFresh(d);
    onDraftId(d.id);
  };

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      showDraft(await api("studio/drafts", { method: "POST", body: { request: prompt.trim(), ...(space ? { space } : {}) } }));
      setPrompt("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (draftId && draft) {
    return (
      <main className="studio-page has-draft" aria-label="Agent Studio">
        <DraftView draft={draft} devices={devices} onDraft={showDraft} onOpenAgent={onOpenAgent} onNew={() => { setFresh(null); onDraftId(null); }} />
      </main>
    );
  }

  return (
    <main className="network studio-network" aria-label="Agent Studio">
      <div className="hub-core studio-core">
        <span className="eyebrow">DESIGN YOUR PERFECT AGENT</span>
        <h1>Agent Studio</h1>
        <form className="search" onSubmit={create}>
          <label className="sr-only" htmlFor="studio-prompt">Describe the agent you want to create</label>
          <input id="studio-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="어떤 에이전트를 만들까요? 평범한 말로 적어 주세요" maxLength={500} disabled={busy} />
          <button type="submit" aria-label="Start creating" disabled={busy || !prompt.trim()}>{busy ? <span className="spinner" /> : <SearchIcon />}</button>
        </form>
        <div className="space-chips" role="group" aria-label="공간 (선택)">
          <button type="button" className={space === null ? "active" : ""} onClick={() => setSpace(null)}>공간 자동</button>
          {(spaces ?? []).map((s) => (
            <button type="button" key={s.id} className={space === s.id ? "active" : ""} onClick={() => setSpace(s.id)}>{spaceName(s.id)}</button>
          ))}
        </div>
        <p>{busy ? "Studio가 요청을 읽고 규칙을 만드는 중이에요…" : "Create an agent built around your ideas."}</p>
        <Notice error={error ?? loaded.error} />
        {!busy && !prompt && (
          <div className="example-chips">
            {EXAMPLES.map((ex) => <button type="button" key={ex} onClick={() => setPrompt(ex)}>{ex}</button>)}
          </div>
        )}
      </div>
      <RecentDrafts onPick={showDraft} />
    </main>
  );
}
