"use client"

// The plan's morning-coffee scenario, run for real and shown as one moving picture:
// Coffee Agent (made in Studio, owns nothing) --A2A device.control--> Root Agent --delegates
// (on_behalf_of)--> Kitchen Agent (owns the machine; its policy decides) --Device Gateway--> LG DUOBO.
// "지금 7:30으로 실행" starts the alarm and the request packet at once; the run itself (Hub
// POST /agents/{id}/run) answers in a moment, and the rest of the path follows what really happened,
// timed from the lines the agents reported to the Event Collector (GET /flows/{request_id}).
import { Check, Clock, Coffee, CookingPot, Network, Play, Wand2, X, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { api } from "@workspace/core/api"
import { codeText, displayName, makerText, stateText } from "@workspace/core/labels"
import type { FlowEvent } from "@workspace/core/types"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

import { useData } from "@/components/data"
import { PageHead } from "@/components/page-head"

const MACHINE = "input_boolean.kitchen_coffee_machine"
const BEANS = "input_boolean.kitchen_beans_low"
const KITCHEN_SAYS = ["원두 부족으로 표시해 줘", "원두 채웠어. 부족 표시 꺼 줘", "커피머신 꺼 줘"]

type PhaseName = "alarm" | "toRoot" | "rootCheck" | "toKitchen" | "kitchenCheck" | "toMachine" | "brew" | "backKitchen" | "backRoot" | "done"
// Each phase: how long it shows, which node is busy, which edge carries a packet (and which way).
const PHASES: Record<PhaseName, { ms: number; node?: number; edge?: number; dir?: "fwd" | "back" }> = {
  alarm: { ms: 700, node: 0 },
  toRoot: { ms: 1000, edge: 0, dir: "fwd" },
  rootCheck: { ms: 800, node: 1 },
  toKitchen: { ms: 1000, edge: 1, dir: "fwd" },
  kitchenCheck: { ms: 800, node: 2 },
  toMachine: { ms: 1000, edge: 2, dir: "fwd" },
  brew: { ms: 1400, node: 3 },
  backKitchen: { ms: 900, edge: 1, dir: "back" },
  backRoot: { ms: 900, edge: 0, dir: "back" },
  done: { ms: 0 },
}
// Shown at once; the Root Agent keeps "working" (pulsing) until the real run has answered.
const START: PhaseName[] = ["alarm", "toRoot", "rootCheck"]

type Outcome = {
  rootOk: boolean
  kitchenOk: boolean
  final: { accepted?: boolean; reason_code?: string; message?: string; delegated_to?: string }
  at: Partial<Record<PhaseName, string>>
  kitchenWhy: string
  rootWhy: string
}

function pathFor(o: Outcome): PhaseName[] {
  if (!o.rootOk) return [...START, "backRoot", "done"]
  if (!o.kitchenOk) return [...START, "toKitchen", "kitchenCheck", "backKitchen", "backRoot", "done"]
  return [...START, "toKitchen", "kitchenCheck", "toMachine", "brew", "backKitchen", "backRoot", "done"]
}

/** What really happened, from the Collector lines of this request. */
function outcomeOf(events: FlowEvent[], coffeeId: string, results: any[]): Outcome {
  const find = (agent: string, dir: string, peer?: string) => events.find((e) => e.agent === agent && e.dir === dir && (!peer || e.to === peer || e.from === peer))
  const rootIn = find("root", "in", coffeeId)
  const kitchenExec = find("kitchen", "exec")
  const last = results?.[0] ?? {}
  const t0 = events.length ? Date.parse(events[0]!.ts) : 0
  const at = (e?: FlowEvent) => (e ? `+${Math.max(0, Date.parse(e.ts) - t0)}ms` : "")
  return {
    // Root passed it on (to the owner): its own checks were fine, whatever the owner decided.
    rootOk: Boolean(find("root", "out", "kitchen") || last.delegated_to),
    kitchenOk: kitchenExec ? kitchenExec.accepted !== false : Boolean(last.accepted),
    final: last,
    // "in" lines are written when the answer is ready, so they carry no arrival time here.
    at: {
      toRoot: at(find(coffeeId, "out")),
      toKitchen: at(find("root", "out", "kitchen")),
      toMachine: at(kitchenExec),
      brew: at(kitchenExec),
      backKitchen: at(find("root", "out-result", "kitchen")),
      backRoot: at(find(coffeeId, "out-result")),
    },
    kitchenWhy: kitchenExec?.message || codeText(kitchenExec?.reason_code),
    rootWhy: rootIn?.message || codeText(rootIn?.reason_code),
  }
}

function describe(phase: PhaseName, o: Outcome | null): { text: string; bad?: boolean } | null {
  switch (phase) {
    case "alarm": return { text: "07:30 — Coffee Agent의 루틴 시간이 됐어요" }
    case "toRoot": return { text: "Coffee Agent → Root Agent: “커피머신 켜 줘” (A2A device.control)" }
    case "rootCheck":
      if (!o) return { text: "Root Agent가 요청 권한을 확인하고 커피머신의 주인을 찾고 있어요…" }
      return o.rootOk ? { text: "Root Agent: 사용자가 승인한 요청 권한이 있어요. 커피머신의 주인을 찾아요" } : { text: `Root Agent가 거절: ${o.rootWhy}`, bad: true }
    case "toKitchen": return { text: "Root Agent → Kitchen Agent: 주인에게 위임 (Coffee Agent 대신)" }
    case "kitchenCheck": return o?.kitchenOk ? { text: "Kitchen Agent: 주방 정책 확인, 원두 충분" } : { text: `Kitchen Agent가 거절: ${o?.kitchenWhy || "주방 정책"}`, bad: true }
    case "toMachine": return { text: "Kitchen Agent → Device Gateway: LG DUOBO 켜기 (자기 토큰으로)" }
    case "brew": return { text: "LG DUOBO가 커피를 내려요 ☕" }
    case "backKitchen": return { text: `Kitchen → Root: ${o?.kitchenOk ? "허용" : "거절"}`, bad: !o?.kitchenOk }
    case "backRoot": return { text: `Root → Coffee Agent: ${codeText(o?.final.reason_code) || (o?.final.accepted ? "허용" : "거절")}`, bad: !o?.final.accepted }
    default: return null
  }
}

const BUBBLES: Partial<Record<PhaseName, string>> = { toRoot: "커피머신 켜 줘", toKitchen: "위임", toMachine: "TURN_ON" }

function Node({ icon: Icon, title, sub, badge, active, done, tone, brewing }: {
  icon: LucideIcon; title: string; sub: string; badge?: string; active?: boolean; done?: boolean; tone?: "good" | "bad" | "warn"; brewing?: boolean
}) {
  return (
    <div
      className={cn(
        "relative grid justify-items-center gap-1.5 rounded-2xl border-2 bg-muted/40 px-3 pt-5 pb-4 text-center transition duration-300",
        done && "border-primary/30 bg-card",
        active && "sc-pulse -translate-y-1.5 scale-[1.03] border-primary bg-card",
        tone === "bad" && "sc-shake border-destructive",
      )}
    >
      <span
        className={cn(
          "relative grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary transition",
          (active || tone === "good") && "bg-gradient-to-br from-blue-400 to-primary text-white",
          tone === "bad" && "bg-destructive/10 text-destructive",
        )}
      >
        <Icon className="size-6" />
        {brewing && (
          <span className="absolute -top-4 left-1/2 flex -translate-x-1/2 gap-1" aria-hidden="true">
            {[0, 1, 2].map((i) => <i key={i} className="sc-steam h-3.5 w-1 rounded-full bg-primary/40" style={{ animationDelay: `${i * 0.2}s` }} />)}
          </span>
        )}
      </span>
      <strong className="text-sm">{title}</strong>
      <small className="text-xs leading-snug text-muted-foreground">{sub}</small>
      {badge && <Badge variant={tone === "warn" ? "outline" : "secondary"} className={cn(tone === "warn" && "border-amber-500/40 text-amber-600")}>{badge}</Badge>}
    </div>
  )
}

function Edge({ label, state, packet }: { label: string; state: { done: boolean; live: boolean; bad: boolean }; packet: { key: string; dir: "fwd" | "back"; ms: number; label: string; bad: boolean } | null }) {
  return (
    <div className="flex flex-col items-center gap-2.5 text-muted-foreground max-lg:h-16 max-lg:flex-row max-lg:justify-center" aria-hidden="true">
      <span className="sc-line relative h-[3px] w-full rounded-full max-lg:h-full max-lg:w-[3px]">
        <i className={cn("sc-fill absolute inset-0 rounded-full bg-primary", state.done && "is-on", state.bad && "bg-destructive")} />
        {packet && (
          <span
            key={packet.key}
            className={cn("sc-packet", packet.dir === "back" ? "is-back bg-emerald-500" : "bg-primary", packet.bad && "bg-destructive")}
            style={{ animationDuration: `${packet.ms}ms` }}
          >
            <b className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-background max-lg:bottom-auto max-lg:left-6 max-lg:top-1/2 max-lg:-translate-y-1/2 max-lg:translate-x-0">
              {packet.label}
            </b>
          </span>
        )}
      </span>
      <small className={cn("text-[11px] font-bold whitespace-nowrap transition", (state.done || state.live) && "text-primary")}>{label}</small>
    </div>
  )
}

export default function Scenario() {
  const { agents, devices, openAgent, reload } = useData()
  const coffee = useMemo(() => {
    const askers = (agents ?? []).filter((a) => a.permissions.includes(`request:${MACHINE}`))
    return askers.find((a) => a.connected) ?? askers[0]
  }, [agents])
  const kitchen = (agents ?? []).find((a) => a.id === "kitchen")
  const machine = devices?.find((d) => d.entity === MACHINE)
  const beansLow = devices?.find((d) => d.entity === BEANS)?.state === "on"

  const [path, setPath] = useState<PhaseName[]>([])
  const [index, setIndex] = useState(-1)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [saying, setSaying] = useState<string | null>(null)
  const run = useRef(0)
  const phase = path[index]
  const playing = index >= 0 && phase !== "done"

  // Advance through the path; wait at the Root Agent until the real outcome is known.
  useEffect(() => {
    if (!phase || phase === "done") return undefined
    if (!outcome && index >= START.length - 1) return undefined
    const t = window.setTimeout(() => setIndex((i) => i + 1), PHASES[phase].ms)
    return () => window.clearTimeout(t)
  }, [phase, index, outcome])

  useEffect(() => {
    if (phase === "done") reload()
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (!coffee) return
    const me = (run.current += 1)
    setError(null)
    setOutcome(null)
    setPath(START)
    setIndex(0)
    try {
      const { request_id: rid, results } = await api<{ request_id: string; results: any[] }>(`hub/agents/${coffee.id}/run`, { method: "POST" })
      let events: FlowEvent[] = []
      for (let i = 0; i < 8; i += 1) {
        const flow = await api<{ events: FlowEvent[] }>(`collector/flows/${rid}`).catch(() => null)
        events = flow?.events ?? []
        if (events.some((e) => e.agent === coffee.id && e.dir !== "out")) break
        await new Promise((r) => setTimeout(r, 300))
      }
      if (run.current !== me) return
      const o = outcomeOf(events, coffee.id, results)
      setOutcome(o)
      setPath(pathFor(o))
    } catch (err) {
      if (run.current !== me) return
      setError(err as Error)
      setPath([])
      setIndex(-1)
    }
  }

  const tellKitchen = async (message: string) => {
    setSaying(message)
    try {
      const { reply } = await api<{ reply: string }>("hub/agents/kitchen/chat", { method: "POST", body: { message } })
      toast(reply.replace(/[*#|`]/g, "").slice(0, 100) || "주방 에이전트가 답했어요")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaying(null)
    }
  }

  const passed = path.slice(0, Math.max(index, 0))
  const seen = (name: PhaseName) => passed.includes(name) || phase === name
  const bad = (name: PhaseName) => Boolean(outcome && describe(name, outcome)?.bad && seen(name))
  const nodeActive = (i: number) => phase !== undefined && PHASES[phase].node === i
  const nodeDone = (i: number) => passed.some((p) => PHASES[p].node === i || (PHASES[p].edge === i - 1 && PHASES[p].dir === "fwd"))
  const edgeState = (i: number) => {
    const used = passed.filter((p) => PHASES[p].edge === i)
    const failed = used.some((p) => PHASES[p].dir === "back") && Boolean(outcome) && ((i === 0 && !outcome!.final.accepted) || (i === 1 && !outcome!.kitchenOk))
    return { done: used.length > 0, live: phase !== undefined && PHASES[phase].edge === i, bad: failed }
  }
  const packet = (i: number) => {
    const p = phase ? PHASES[phase] : undefined
    if (!p || p.edge !== i || !phase) return null
    const back = p.dir === "back"
    const label = back ? (i === 1 ? (outcome?.kitchenOk ? "OK" : "거절") : codeText(outcome?.final.reason_code) || "결과") : BUBBLES[phase] ?? ""
    return { key: `${run.current}-${index}`, dir: p.dir!, ms: p.ms, label, bad: back && ((i === 1 && !outcome?.kitchenOk) || (i === 0 && !outcome?.final.accepted)) }
  }
  const lines = path
    .slice(0, index + 1)
    .map((p) => ({ p, ...(describe(p, outcome) ?? { text: "" }) }))
    .filter((l) => l.text)
  const brewing = phase === "brew" || Boolean(outcome?.kitchenOk && passed.includes("brew"))
  const final = phase === "done" ? outcome : null

  return (
    <>
      <PageHead eyebrow="SCENARIO · MORNING COFFEE" title="아침 7:30, 커피 한 잔">
        Coffee Agent는 기기를 갖지 않아요. Root Agent에게 부탁하면, Root가 커피머신의 주인인 Kitchen Agent에게 넘기고, Kitchen이 자기 정책을 확인한 뒤 LG DUOBO를 켜요.
      </PageHead>

      {!coffee && (
        <Card>
          <CardHeader><CardTitle>먼저 Coffee Agent를 만들어 주세요</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <ol className="grid list-decimal gap-1 pl-5 text-sm">
              <li>Studio에서 <strong>“매일 아침 7시 반에 커피 내려 줘”</strong>로 만들고 승인해요.</li>
              <li>에이전트 화면에서 <strong>우리 집에 연결</strong>해요. 승인하는 권한은 “커피머신: 주인 에이전트에게 제어 요청” 하나예요.</li>
            </ol>
            <Button asChild className="w-fit"><Link href={`/studio?prompt=${encodeURIComponent("매일 아침 7시 반에 커피 내려 줘")}`}><Wand2 />Studio에서 만들기</Link></Button>
          </CardContent>
        </Card>
      )}

      {coffee && (
        <div className="grid gap-4">
          <Card>
            <CardContent className="grid gap-6 pt-2">
              <div className="grid items-center gap-1 lg:grid-cols-[1fr_minmax(70px,.7fr)_1fr_minmax(70px,.7fr)_1fr_minmax(70px,.7fr)_1fr]">
                <Node icon={Clock} title={displayName(coffee)} sub={`Agent Cloud · ${makerText(coffee)}`} badge={phase === "alarm" ? "⏰ 07:30" : "매일 07:30"}
                  active={nodeActive(0)} done={nodeDone(0)} tone={final ? (final.final.accepted ? "good" : "bad") : undefined} />
                <Edge label="A2A 요청" state={edgeState(0)} packet={packet(0)} />
                <Node icon={Network} title="Root Agent" sub="거실 · 요청을 주인에게 전달" active={nodeActive(1)} done={nodeDone(1)} tone={bad("rootCheck") ? "bad" : undefined} />
                <Edge label="위임" state={edgeState(1)} packet={packet(1)} />
                <Node icon={CookingPot} title="Kitchen Agent" sub="주방 · 커피머신의 주인" badge={beansLow ? "원두 부족" : "원두 충분"}
                  active={nodeActive(2)} done={nodeDone(2)} tone={bad("kitchenCheck") ? "bad" : beansLow ? "warn" : undefined} />
                <Edge label="Gateway 명령" state={edgeState(2)} packet={packet(2)} />
                <Node icon={Coffee} title="LG DUOBO" sub="커피머신 (가상 기기)" badge={brewing ? "추출 중" : stateText(machine) || "—"}
                  active={nodeActive(3)} done={nodeDone(3)} tone={brewing || machine?.state === "on" ? "good" : undefined} brewing={brewing} />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" className="h-10" onClick={() => void start()} disabled={playing || !coffee.connected}>
                  <Play />{playing ? "진행 중…" : index >= 0 ? "다시 실행" : "지금 7:30으로 실행"}
                </Button>
                {!coffee.connected && <Button variant="outline" onClick={() => openAgent(coffee.id, "connect")}>먼저 연결하기</Button>}
                <span className="text-sm text-muted-foreground">실제로 실행하고, 에이전트들이 남긴 기록 그대로 보여 줘요.</span>
              </div>
              {error && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
              {final && (
                <div className={cn("sc-rise flex items-center gap-2.5 rounded-xl px-4 py-3 font-semibold", final.final.accepted ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>
                  {final.final.accepted ? <Check className="size-5" /> : <X className="size-5" />}
                  {final.final.accepted ? "LG DUOBO가 커피를 내리고 있어요." : `커피를 내리지 못했어요${beansLow || !final.kitchenOk ? ": 원두가 부족해요. 원두를 다시 주문해야 해요." : "."}`}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader><CardTitle className="text-sm text-muted-foreground">무슨 일이 있었나</CardTitle></CardHeader>
              <CardContent>
                {lines.length === 0 && <p className="text-sm text-muted-foreground">“지금 7:30으로 실행”을 누르면 요청이 지나가는 길이 여기에 이어서 쌓여요.</p>}
                <ol className="divide-y">
                  {lines.map((l, i) => (
                    <li key={`${l.p}-${i}`} className="sc-rise flex items-start gap-3 py-2.5">
                      <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", l.bad ? "bg-muted-foreground/40" : "bg-primary", i === lines.length - 1 && playing && "sc-pulse")} />
                      <span className="flex-1 text-sm font-medium">{l.text}</span>
                      {outcome?.at[l.p] && <Badge variant="secondary">{outcome.at[l.p]}</Badge>}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm text-muted-foreground">주방 에이전트에게 말하기</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-sm text-muted-foreground">주방 기기는 주인인 Kitchen Agent만 움직여요. 원두가 부족하면 누가 부탁해도 커피머신을 켜지 않아요.</p>
                <div className="flex flex-wrap gap-2">
                  {KITCHEN_SAYS.map((m) => (
                    <Button key={m} variant="outline" size="sm" className="rounded-full" disabled={Boolean(saying) || !kitchen?.connected} onClick={() => void tellKitchen(m)}>
                      {saying === m ? "답을 기다리는 중…" : m}
                    </Button>
                  ))}
                </div>
                <Button variant="link" className="w-fit p-0" onClick={() => openAgent(coffee.id)}>Coffee Agent 열기</Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
