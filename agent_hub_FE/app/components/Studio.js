"use client";

// Agent Studio: a sentence -> Studio fills its form (LLM), compiles rules from the built-in skills and
// checks the capability lock -> the person reads the summary and approves -> registered in the Hub,
// private to them until they share it.
import { useEffect, useState } from "react";
import { api, useApi } from "../../lib/api.js";
import { permission, spaceName, timeAgo } from "../../lib/labels.js";
import { Icon, Notice, Spinner, useConfirm, useToast } from "./ui.js";

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
const TONE = { ready: "is-blue", registered: "is-blue", clarify: "is-amber", blocked: "is-red", failed: "is-red", invalid: "is-red", unsupported: "is-red" };
const EXAMPLES = ["회의할 때 내 방 조명을 회의 모드로 바꿔 줘", "외출하면 내 방 조명이랑 에어컨 꺼 줘", "아기 재울 때 보호 방 수면 모드 켜 줘"];
const STEPS = ["입력 안전 검사", "LLM이 양식 채우기", "기본 스킬로 규칙 만들기", "도구 잠금 검사"];

function Working() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1800);
    return () => window.clearInterval(t);
  }, []);
  return (
    <ol className="steps" aria-live="polite">
      {STEPS.map((s, i) => (
        <li key={s} className={i < step ? "is-done" : i === step ? "is-now" : ""}>
          <span>{i < step ? <Icon name="check" size={14} /> : i === step ? <Spinner /> : i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

function DraftView({ draft, devices, onDraft, onOpenAgent, onNew }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dialog, ask] = useConfirm();
  const toast = useToast();
  const act = async (path, body) => {
    setBusy(true);
    setError(null);
    try {
      const next = await api(path, { method: "POST", body });
      onDraft(next);
      setAnswer("");
      return next;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    const ok = await ask({
      title: "이 에이전트를 Hub에 등록할까요?",
      body: (
        <>
          <p>권한 {draft.permissions.length}개를 요청하는 에이전트예요. 등록하면 나만 보이고, 연결해야 동작해요.</p>
          <ul className="bullets">{draft.summary.slice(0, 4).map((l) => <li key={l}>{l}</li>)}</ul>
        </>
      ),
      confirm: "승인하고 등록",
    });
    if (ok && (await act(`studio/drafts/${draft.id}/approve`))) toast("Hub에 등록했어요");
  };

  return (
    <section className="studio-draft panel" aria-label="Draft">
      <header className="draft-head">
        <span className={`badge ${TONE[draft.status] ?? ""}`}>{STATUS[draft.status] ?? draft.status}</span>
        <button type="button" className="text-button" onClick={onNew}><Icon name="plus" size={14} /> 새로 만들기</button>
      </header>
      <blockquote className="draft-request">{draft.request}</blockquote>

      {draft.status === "blocked" && (
        <div className="callout is-red">
          <h3>요청에 위험한 내용이 있어 LLM에 보내지 않았어요</h3>
          <ul className="bullets">{draft.findings.map((f) => <li key={f.code + f.excerpt}><strong>{f.message}</strong> <code>{f.excerpt}</code></li>)}</ul>
        </div>
      )}

      {draft.status === "clarify" && (
        <form className="callout is-amber" onSubmit={(e) => { e.preventDefault(); act(`studio/drafts/${draft.id}/answer`, { answer }); }}>
          <h3>{draft.question}</h3>
          <div className="inline-form">
            <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="예: 내 방" maxLength={200} required />
            <button type="submit" className="primary-button small" disabled={busy || !answer.trim()}>{busy ? "다시 만드는 중…" : "답하기"}</button>
          </div>
        </form>
      )}

      {["unsupported", "invalid", "failed"].includes(draft.status) && (
        <div className="callout is-red">
          <h3>{draft.reason || "이 요청으로는 에이전트를 만들 수 없어요"}</h3>
          {draft.errors.length > 0 && <ul className="bullets">{draft.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          <p className="muted">기본 스킬(회의 모드, 수면 모드, 절전, 외출·귀가)과 집에 있는 기기로 표현해 보세요.</p>
        </div>
      )}

      {(draft.status === "ready" || draft.status === "registered") && (
        <>
          <div className="draft-section">
            <h3>만들어질 에이전트</h3>
            <ul className="bullets">{draft.summary.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
          <div className="draft-section">
            <h3>연결할 때 요청할 권한</h3>
            <ul className="list-card">
              {draft.permissions.map((p) => {
                const perm = permission(p, devices);
                return (
                  <li key={p}>
                    <span className="list-icon"><Icon name={perm.kind === "device" ? "device" : "link"} size={18} /></span>
                    <span className="list-text"><strong>{perm.label}</strong><small>{perm.detail}</small></span>
                  </li>
                );
              })}
            </ul>
          </div>
          {draft.warnings.length > 0 && (
            <div className="callout is-amber">
              <h3>알아 둘 점</h3>
              <ul className="bullets">{draft.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          <details className="draft-files">
            <summary><Icon name="lock" size={14} /> 생성된 파일 보기 (안전 검사 통과)</summary>
            {Object.entries(draft.files).map(([name, text]) => (
              <div key={name}><strong>{name}</strong><pre>{text}</pre></div>
            ))}
          </details>
        </>
      )}

      <Notice error={error} />
      <div className="panel-actions">
        {draft.status === "ready" && (
          <button type="button" className="primary-button" disabled={busy} onClick={approve}>
            {busy ? "등록하는 중…" : "승인하고 Hub에 등록"} <Icon name="arrow" size={16} />
          </button>
        )}
        {draft.status === "registered" && (
          <>
            <button type="button" className="primary-button" onClick={() => onOpenAgent(draft.agent_id, "connect")}>
              우리 집에 연결하기 <Icon name="arrow" size={16} />
            </button>
            <span className="muted">지금은 나만 보여요. 에이전트 화면에서 카탈로그에 공유할 수 있어요.</span>
          </>
        )}
      </div>
      {dialog}
    </section>
  );
}

function RecentDrafts({ onPick, current }) {
  const { data } = useApi("studio/drafts?limit=8", { interval: 15000 });
  return (
    <aside className="panel recent" aria-label="Recent drafts">
      <div className="panel-title"><h3>최근 초안</h3></div>
      {!data?.length && <p className="muted">아직 만든 초안이 없어요.</p>}
      <ul>
        {(data ?? []).map((d) => (
          <li key={d.id}>
            <button type="button" className={current === d.id ? "is-current" : ""} onClick={() => onPick(d)}>
              <span>{d.request.split("\n")[0]}</span>
              <small><i className={`tone ${TONE[d.status] ?? ""}`} />{STATUS[d.status] ?? d.status} · {timeAgo(d.updated_at)}</small>
            </button>
          </li>
        ))}
      </ul>
    </aside>
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
  const draft = draftId ? (fresh?.id === draftId ? fresh : loaded.data) : null;

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

  return (
    <main className="page studio" aria-label="Agent Studio">
      <section className="page-hero">
        <span className="eyebrow">AGENT STUDIO</span>
        <h1>말로 만드는 에이전트</h1>
        <p>원하는 동작을 평범한 말로 적으면, Studio가 안전한 기본 스킬로 에이전트를 만들어요.</p>
      </section>
      <div className="studio-layout">
        <div className="studio-main">
          {draft ? (
            <DraftView draft={draft} devices={devices} onDraft={showDraft} onOpenAgent={onOpenAgent} onNew={() => { setFresh(null); onDraftId(null); }} />
          ) : (
            <form className="panel composer" onSubmit={create}>
              <label htmlFor="studio-prompt" className="composer-label"><Icon name="wand" size={18} /> 어떤 에이전트를 만들까요?</label>
              <textarea
                id="studio-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) create(e); }}
                placeholder="예: 회의할 때 내 방 조명을 회의 모드로 바꿔 줘"
                maxLength={500}
                rows={4}
                disabled={busy}
              />
              <div className="composer-row">
                <span className="composer-hint">공간</span>
                <div className="chips" role="group" aria-label="공간 (선택)">
                  <button type="button" className={`chip chip-button ${space === null ? "is-on" : ""}`} onClick={() => setSpace(null)}>자동</button>
                  {(spaces ?? []).map((s) => (
                    <button type="button" key={s.id} className={`chip chip-button ${space === s.id ? "is-on" : ""}`} onClick={() => setSpace(s.id)}>{spaceName(s.id)}</button>
                  ))}
                </div>
              </div>
              {busy ? <Working /> : (
                <div className="composer-row">
                  <span className="composer-hint">예시</span>
                  <div className="chips">
                    {EXAMPLES.map((ex) => <button type="button" key={ex} className="chip chip-button" onClick={() => setPrompt(ex)}>{ex}</button>)}
                  </div>
                </div>
              )}
              <Notice error={error ?? loaded.error} />
              <div className="panel-actions">
                <button type="submit" className="primary-button" disabled={busy || !prompt.trim()}>
                  {busy ? <><span className="spinner" /> 만드는 중…</> : <>에이전트 만들기 <Icon name="arrow" size={16} /></>}
                </button>
                <span className="muted">{prompt.length}/500 · ⌘/Ctrl + Enter</span>
              </div>
            </form>
          )}
          {draftId && !draft && <div className="panel"><Notice error={loaded.error}>{loaded.error ? null : "불러오는 중…"}</Notice></div>}
        </div>
        <RecentDrafts onPick={showDraft} current={draftId} />
      </div>
    </main>
  );
}
