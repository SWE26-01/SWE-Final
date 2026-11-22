"use client"

// Agent Studio: a sentence -> Studio fills its form (LLM), builds a room, routine or assistant agent,
// checks the capability lock -> the person reads the summary and approves -> registered, private
// to them until they share it. /studio?draft=<id> shows a draft; /studio?prompt=... fills the box.
import { ArrowRight, Check, FileLock2, Loader2, Plus, Share2, Wand2 } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"
import { toast } from "sonner"

import { api, useApi } from "@workspace/core/api"
import { useConfirm } from "@workspace/core/components/confirm"
import { kindIcon } from "@workspace/core/icons"
import { kindOf, permission, spaceName, timeAgo } from "@workspace/core/labels"
import type { Space } from "@workspace/core/types"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"

import { useData } from "@/components/data"
import { PageHead } from "@/components/page-head"

type Draft = {
  id: string
  request: string
  status: string
  question: string | null
  reason: string | null
  findings: { code: string; message: string; excerpt: string }[]
  errors: string[]
  warnings: string[]
  summary: string[]
  permissions: string[]
  agent_id: string | null
  files: Record<string, string>
  updated_at: string
}

const STATUS: Record<string, [string, "default" | "secondary" | "destructive" | "outline"]> = {
  new: ["만드는 중", "secondary"],
  blocked: ["안전 검사에서 막힘", "destructive"],
  failed: ["만들지 못함", "destructive"],
  clarify: ["질문이 있어요", "outline"],
  unsupported: ["지원하지 않는 요청", "destructive"],
  invalid: ["규칙을 만들지 못함", "destructive"],
  ready: ["승인 대기", "default"],
  registered: ["Agent Cloud에 등록됨", "default"],
}
const EXAMPLES = [
  "매일 아침 7시 반에 커피 내려 줘",
  "회의할 때 내 방 조명을 회의 모드로 바꿔 줘",
  "논문을 근거로 홈 트레이닝을 도와주는 코치 만들어 줘",
  "아기 재울 때 보호 방 수면 모드 켜 줘",
]
const STEPS = ["입력 안전 검사", "LLM이 양식 채우기", "규칙·지침 만들기", "도구 잠금 검사"]

function Working() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1800)
    return () => window.clearInterval(t)
  }, [])
  return (
    <ol className="grid gap-2 rounded-xl bg-primary/5 p-4" aria-live="polite">
      {STEPS.map((s, i) => (
        <li key={s} className={cn("flex items-center gap-2.5 text-sm font-medium text-muted-foreground", i === step && "text-primary", i < step && "text-foreground")}>
          <span className={cn("grid size-6 place-items-center rounded-full bg-background text-xs", i < step && "bg-primary text-primary-foreground")}>
            {i < step ? <Check className="size-3.5" /> : i === step ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
          </span>
          {s}
        </li>
      ))}
    </ol>
  )
}

function DraftView({ draft, onDraft, onNew }: { draft: Draft; onDraft: (d: Draft) => void; onNew: () => void }) {
  const { devices, openAgent, reload } = useData()
  const [answer, setAnswer] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [dialog, ask] = useConfirm()
  const act = async (path: string, body?: unknown) => {
    setBusy(true)
    setError(null)
    try {
      const next = await api<Draft>(path, { method: "POST", body })
      onDraft(next)
      setAnswer("")
      return next
    } catch (err) {
      setError(err as Error)
      return null
    } finally {
      setBusy(false)
    }
  }
  const approve = async () => {
    const ok = await ask({
      title: "이 에이전트를 Agent Cloud에 등록할까요?",
      body: (
        <>
          <p>권한 {draft.permissions.length}개를 요청하는 에이전트예요. 등록하면 나만 보이고, 연결해야 동작해요.</p>
          <ul className="list-disc pl-5">{draft.summary.slice(0, 4).map((l) => <li key={l}>{l}</li>)}</ul>
        </>
      ),
      confirm: "승인하고 등록",
    })
    if (ok && (await act(`studio/drafts/${draft.id}/approve`))) {
      toast.success("Agent Cloud에 등록했어요")
      reload()
    }
  }
  const [label, variant] = STATUS[draft.status] ?? [draft.status, "secondary"]

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <Badge variant={variant}>{label}</Badge>
        <Button variant="ghost" size="sm" onClick={onNew}><Plus />새로 만들기</Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        <blockquote className="rounded-xl border-l-4 border-primary bg-muted/50 px-4 py-3 font-semibold whitespace-pre-line">{draft.request}</blockquote>

        {draft.status === "blocked" && (
          <Alert variant="destructive">
            <AlertTitle>요청에 위험한 내용이 있어 LLM에 보내지 않았어요</AlertTitle>
            <AlertDescription><ul className="list-disc pl-5">{draft.findings.map((f) => <li key={f.code + f.excerpt}><strong>{f.message}</strong> <code>{f.excerpt}</code></li>)}</ul></AlertDescription>
          </Alert>
        )}

        {draft.status === "clarify" && (
          <Alert>
            <AlertTitle>{draft.question}</AlertTitle>
            <AlertDescription>
              <form className="mt-2 flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); void act(`studio/drafts/${draft.id}/answer`, { answer }) }}>
                <Input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="예: 내 방" maxLength={200} required />
                <Button type="submit" disabled={busy || !answer.trim()}>{busy ? "다시 만드는 중…" : "답하기"}</Button>
              </form>
            </AlertDescription>
          </Alert>
        )}

        {["unsupported", "invalid", "failed"].includes(draft.status) && (
          <Alert variant="destructive">
            <AlertTitle>{draft.reason || "이 요청으로는 에이전트를 만들 수 없어요"}</AlertTitle>
            <AlertDescription>
              {draft.errors.length > 0 && <ul className="list-disc pl-5">{draft.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
              명령 실행, 파일, 결제·구매, 다른 집 제어처럼 에이전트에게 허용되지 않는 일이 들어 있는지 확인하고 다시 적어 보세요.
            </AlertDescription>
          </Alert>
        )}

        {(draft.status === "ready" || draft.status === "registered") && (
          <>
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">만들어질 에이전트</h3>
              <ul className="grid list-disc gap-1 pl-5 text-sm">{draft.summary.map((line) => <li key={line}>{line}</li>)}</ul>
            </section>
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">연결할 때 요청할 권한</h3>
              {draft.permissions.length === 0 && <p className="text-sm text-muted-foreground">요청하는 권한이 없어요. 기기를 맡지 않는 대화형 에이전트예요.</p>}
              <ul className="divide-y rounded-xl border">
                {draft.permissions.map((p) => {
                  const perm = permission(p, devices)
                  const Icon = perm.kind === "context" ? Share2 : kindIcon(kindOf(perm.id))
                  return (
                    <li key={p} className="flex items-center gap-3 p-3">
                      <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span>
                      <span className="grid text-sm"><strong>{perm.label}</strong><small className="text-muted-foreground">{perm.detail}</small></span>
                    </li>
                  )
                })}
              </ul>
            </section>
            {draft.warnings.length > 0 && (
              <Alert>
                <AlertTitle>알아 둘 점</AlertTitle>
                <AlertDescription><ul className="list-disc pl-5">{draft.warnings.map((w) => <li key={w}>{w}</li>)}</ul></AlertDescription>
              </Alert>
            )}
            <Collapsible>
              <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="text-muted-foreground"><FileLock2 />생성된 파일 보기 (안전 검사 통과)</Button></CollapsibleTrigger>
              <CollapsibleContent className="grid gap-3 pt-2">
                {Object.entries(draft.files).map(([name, text]) => (
                  <div key={name} className="grid gap-1">
                    <strong className="text-sm">{name}</strong>
                    <pre className="max-h-64 overflow-auto rounded-lg bg-zinc-900 p-3 text-[11px] text-zinc-100">{text}</pre>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          </>
        )}

        {error && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
        <div className="flex flex-wrap items-center gap-3">
          {draft.status === "ready" && <Button size="lg" className="h-10" disabled={busy} onClick={approve}>{busy ? "등록하는 중…" : "승인하고 Agent Cloud에 등록"} <ArrowRight /></Button>}
          {draft.status === "registered" && draft.agent_id && (
            <>
              <Button size="lg" className="h-10" onClick={() => openAgent(draft.agent_id!, "connect")}>우리 집에 연결하기 <ArrowRight /></Button>
              <span className="text-sm text-muted-foreground">지금은 나만 보여요. 에이전트 화면에서 카탈로그에 공유할 수 있어요.</span>
            </>
          )}
        </div>
      </CardContent>
      {dialog}
    </Card>
  )
}

function Recent({ current, onPick }: { current: string | null; onPick: (d: Draft) => void }) {
  const { data } = useApi<Draft[]>("studio/drafts?limit=8", { interval: 15000 })
  return (
    <Card className="gap-2">
      <CardHeader><CardTitle className="text-sm text-muted-foreground">최근 초안</CardTitle></CardHeader>
      <CardContent className="grid gap-1">
        {!data?.length && <p className="text-sm text-muted-foreground">아직 만든 초안이 없어요.</p>}
        {(data ?? []).map((d) => (
          <button key={d.id} type="button" onClick={() => onPick(d)} className={cn("grid gap-0.5 rounded-lg px-3 py-2 text-left transition hover:bg-muted", current === d.id && "bg-primary/10")}>
            <span className="truncate text-sm font-medium">{d.request.split("\n")[0]}</span>
            <small className="text-xs text-muted-foreground">{STATUS[d.status]?.[0] ?? d.status} · {timeAgo(d.updated_at)}</small>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}

function StudioPage() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const draftId = params.get("draft")
  const [prompt, setPrompt] = useState(params.get("prompt") ?? "")
  const [space, setSpace] = useState("auto")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [fresh, setFresh] = useState<Draft | null>(null)
  const loaded = useApi<Draft>(draftId && fresh?.id !== draftId ? `studio/drafts/${draftId}` : null)
  const { data: spaces } = useApi<Space[]>("hub/spaces")
  const draft = draftId ? (fresh?.id === draftId ? fresh : loaded.data) : null

  const show = (d: Draft) => {
    setFresh(d)
    router.push(`${pathname}?draft=${d.id}`, { scroll: false })
  }
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      show(await api<Draft>("studio/drafts", { method: "POST", body: { request: prompt.trim(), ...(space !== "auto" ? { space } : {}) } }))
      setPrompt("")
    } catch (err) {
      setError(err as Error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead eyebrow="AGENT STUDIO" title="말로 만드는 에이전트">
        원하는 것을 평범한 말로 적으세요. 집 기기 자동화는 기본 스킬로, 정해진 시각의 일은 루틴 에이전트로, 그 밖의 도움은 대화형 에이전트로 만들어요.
      </PageHead>
      <div className="grid items-start gap-5 lg:grid-cols-[1fr_300px]">
        {draft ? (
          <DraftView draft={draft} onDraft={setFresh} onNew={() => { setFresh(null); router.push(pathname) }} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-primary"><Wand2 className="size-4" />어떤 에이전트를 만들까요?</CardTitle>
              <CardDescription>예: “매일 아침 7시 반에 커피 내려 줘”, “운동을 도와주는 코치”</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) void create() }}
                placeholder="원하는 것을 평범한 말로 적어 주세요"
                maxLength={500}
                rows={4}
                disabled={busy}
                className="min-h-28 text-base"
                aria-label="만들 에이전트"
              />
              <div className="grid gap-2 sm:grid-cols-[3rem_1fr] sm:items-center">
                <span className="text-xs font-semibold text-muted-foreground">공간</span>
                <ToggleGroup type="single" variant="outline" size="sm" value={space} onValueChange={(v) => v && setSpace(v)} className="flex-wrap justify-start">
                  <ToggleGroupItem value="auto">자동</ToggleGroupItem>
                  {(spaces ?? []).map((s) => <ToggleGroupItem key={s.id} value={s.id}>{spaceName(s.id)}</ToggleGroupItem>)}
                </ToggleGroup>
              </div>
              {busy ? (
                <Working />
              ) : (
                <div className="grid gap-2 sm:grid-cols-[3rem_1fr] sm:items-start">
                  <span className="pt-1 text-xs font-semibold text-muted-foreground">예시</span>
                  <div className="flex flex-wrap gap-2">
                    {EXAMPLES.map((ex) => <Button key={ex} variant="outline" size="sm" className="rounded-full" onClick={() => setPrompt(ex)}>{ex}</Button>)}
                  </div>
                </div>
              )}
              {(error ?? loaded.error) && <Alert variant="destructive"><AlertDescription>{(error ?? loaded.error)!.message}</AlertDescription></Alert>}
              <div className="flex items-center gap-3">
                <Button size="lg" className="h-10" disabled={busy || !prompt.trim()} onClick={() => void create()}>
                  {busy ? <><Loader2 className="animate-spin" />만드는 중…</> : <>에이전트 만들기 <ArrowRight /></>}
                </Button>
                <span className="text-xs text-muted-foreground">{prompt.length}/500 · ⌘/Ctrl + Enter</span>
              </div>
            </CardContent>
          </Card>
        )}
        <Recent current={draftId} onPick={show} />
      </div>
    </>
  )
}

export default function Studio() {
  return (
    <Suspense>
      <StudioPage />
    </Suspense>
  )
}
