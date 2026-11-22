"use client"

// Log in or sign up (a demo: no terms or e-mail check). The Hub makes the session; the screen's
// server keeps it in an httpOnly cookie (app/api/auth/[action]). Both apps share the cookie.
import { Network } from "lucide-react"
import { useEffect, useState } from "react"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { reasonText } from "../labels.ts"

function safeNext() {
  const next = new URLSearchParams(window.location.search).get("next") || "/"
  return next.startsWith("/") && !next.startsWith("//") ? next : "/"
}

export function LoginForm({ product = "Agent Cloud" }: { product?: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login")
  const [form, setForm] = useState({ username: "", name: "", password: "", confirm: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signup = mode === "signup"
  const mismatch = signup && form.confirm !== "" && form.password !== form.confirm

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.ok && window.location.replace(safeNext())).catch(() => null)
  }, [])

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: key === "username" ? e.target.value.toLowerCase() : e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mismatch) return
    setBusy(true)
    setError(null)
    const body = signup
      ? { username: form.username.trim(), name: form.name.trim(), password: form.password }
      : { username: form.username.trim(), password: form.password }
    try {
      const res = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      if (res.ok) return window.location.replace(safeNext())
      const data = await res.json().catch(() => ({}))
      setError(Array.isArray(data.detail) ? "아이디는 영문 소문자·숫자·_ 3~20자, 비밀번호는 6자 이상이에요" : reasonText(data.detail))
    } catch {
      setError(reasonText({ reason_code: "SERVICE_DOWN" }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent)] p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <span className="mb-2 grid size-11 place-items-center rounded-xl bg-gradient-to-br from-blue-400 to-primary text-white shadow-lg shadow-primary/30"><Network className="size-5" /></span>
          <CardTitle className="text-2xl">{signup ? `Join ${product}` : "Welcome back"}</CardTitle>
          <CardDescription>
            {signup ? "계정을 만들면 에이전트를 만들고, 공유하고, 다른 사람의 에이전트를 설치할 수 있어요." : "에이전트를 찾고, 만들고, 우리 집에 연결해요."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Tabs value={mode} onValueChange={(v) => { setMode(v as "login" | "signup"); setError(null) }}>
            <TabsList className="w-full">
              <TabsTrigger value="login">로그인</TabsTrigger>
              <TabsTrigger value="signup">회원가입</TabsTrigger>
            </TabsList>
          </Tabs>
          <form onSubmit={submit} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="username">아이디</Label>
              <Input id="username" value={form.username} onChange={set("username")} autoComplete="username" placeholder="영문 소문자·숫자·_ 3~20자" pattern={signup ? "[a-z0-9_]{3,20}" : undefined} required autoFocus />
            </div>
            {signup && (
              <div className="grid gap-1.5">
                <Label htmlFor="name">이름</Label>
                <Input id="name" value={form.name} onChange={set("name")} autoComplete="name" placeholder="카탈로그에 보일 이름" maxLength={40} required />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="password">비밀번호</Label>
              <Input id="password" type="password" value={form.password} onChange={set("password")} autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 6 : undefined} placeholder={signup ? "6자 이상" : ""} required />
            </div>
            {signup && (
              <div className="grid gap-1.5">
                <Label htmlFor="confirm">비밀번호 확인</Label>
                <Input id="confirm" type="password" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" required aria-invalid={mismatch} />
                {mismatch && <small className="text-xs font-medium text-destructive">비밀번호가 서로 달라요</small>}
              </div>
            )}
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" size="lg" className="mt-1 h-10" disabled={busy || mismatch}>{busy ? "잠시만요…" : signup ? "가입하고 시작하기" : "로그인"}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
