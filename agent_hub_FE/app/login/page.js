"use client";

// Log in or sign up (a demo: no terms or e-mail check). The Hub makes the session; the screen's
// server keeps it in an httpOnly cookie (app/api/auth/[action]).
import { useEffect, useState } from "react";
import { reasonText } from "../../lib/labels.js";

function safeNext() {
  const next = new URLSearchParams(window.location.search).get("next") || "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default function Login() {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ username: "", name: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const signup = mode === "signup";

  useEffect(() => {
    // Already logged in: go on.
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.ok && window.location.replace(safeNext())).catch(() => null);
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: key === "username" ? e.target.value.toLowerCase() : e.target.value }));
  const mismatch = signup && form.confirm && form.password !== form.confirm;

  const submit = async (e) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    const body = signup
      ? { username: form.username.trim(), name: form.name.trim(), password: form.password }
      : { username: form.username.trim(), password: form.password };
    try {
      const res = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        window.location.replace(safeNext());
        return;
      }
      const data = await res.json().catch(() => ({}));
      const detail = data.detail;
      setError(Array.isArray(detail) ? "아이디는 영문 소문자·숫자·_ 3~20자, 비밀번호는 6자 이상이에요" : reasonText(detail));
    } catch {
      setError(reasonText({ reason_code: "SERVICE_DOWN" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-card" aria-label={signup ? "회원가입" : "로그인"}>
        <span className="eyebrow">AGENT HUB</span>
        <h1>{signup ? "Join the Hub" : "Welcome back"}</h1>
        <p className="login-lead">{signup ? "계정을 만들면 에이전트를 만들고, 공유하고, 다른 사람의 에이전트를 설치할 수 있어요." : "에이전트를 찾고, 만들고, 우리 집에 연결해요."}</p>
        <div className="login-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={!signup} className={signup ? "" : "active"} onClick={() => { setMode("login"); setError(null); }}>로그인</button>
          <button type="button" role="tab" aria-selected={signup} className={signup ? "active" : ""} onClick={() => { setMode("signup"); setError(null); }}>회원가입</button>
        </div>
        <form onSubmit={submit} className="login-form">
          <label>
            <span>아이디</span>
            <input value={form.username} onChange={set("username")} autoComplete="username" placeholder="영문 소문자·숫자·_ 3~20자" pattern={signup ? "[a-z0-9_]{3,20}" : undefined} required autoFocus />
          </label>
          {signup && (
            <label>
              <span>이름</span>
              <input value={form.name} onChange={set("name")} autoComplete="name" placeholder="Hub에 보일 이름" maxLength={40} required />
            </label>
          )}
          <label>
            <span>비밀번호</span>
            <input type="password" value={form.password} onChange={set("password")} autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 6 : undefined} placeholder={signup ? "6자 이상" : ""} required />
          </label>
          {signup && (
            <label>
              <span>비밀번호 확인</span>
              <input type="password" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" required aria-invalid={Boolean(mismatch)} />
              {mismatch && <small className="field-error">비밀번호가 서로 달라요</small>}
            </label>
          )}
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <button type="submit" className="primary-button" disabled={busy || mismatch}>
            {busy ? "잠시만요…" : signup ? "가입하고 시작하기" : "로그인"} <span>→</span>
          </button>
        </form>
      </section>
    </main>
  );
}
