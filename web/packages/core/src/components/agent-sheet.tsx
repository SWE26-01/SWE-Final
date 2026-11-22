"use client"

// One agent, in a sheet over whatever the person was looking at (a bottom drawer on phones):
// overview (devices, shared state, who made it, routine), chat, connection (approve permissions,
// connect, hand devices over, disconnect) and activity (Hub record + Collector request flows).
// Both apps use it: Agent Cloud and the smart home app.
import { Clock, Lock, Share2, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@workspace/ui/components/drawer"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

import { ApiError, api, useApi } from "../api.ts"
import { useIsMobile } from "../hooks/use-mobile.ts"
import { kindIcon } from "../icons.tsx"
import {
  FIELDS, ORIGINS, ROLES, SKILLS, actionLine, actionText, agentNote, codeText, countText, dateText, deviceName, displayName, isRoutine,
  kindOf, makerText, nameOf, permission, spaceName, stateText, timeAgo,
} from "../labels.ts"
import type { Agent, Device, Flow } from "../types.ts"
import { AgentAvatar, Status, StarButton } from "./bits.tsx"
import { useConfirm } from "./confirm.tsx"
import { Markdown } from "./markdown.tsx"

function TokenDialog({ result, agent, onClose }: { result: any; agent: Agent; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{displayName(agent)} 연결됨</DialogTitle>
          <DialogDescription>
            {result.token ? "이 에이전트의 토큰은 지금 한 번만 보여 드려요. Agent Cloud에는 해시만 남아요." : `기본 에이전트는 .env에 있는 자기 토큰(${result.token_env})을 그대로 써요.`}
          </DialogDescription>
        </DialogHeader>
        {result.token && (
          <>
            <code className="block rounded-lg border border-dashed border-primary/40 bg-muted/50 p-3 font-mono text-xs break-all select-all">{result.token}</code>
            <p className="text-sm text-muted-foreground">
              {agent.origin === "studio"
                ? result.launch === "started"
                  ? "Studio 에이전트는 이 토큰으로 바로 실행됐어요. 따로 할 일은 없어요."
                  : `실행기에 전달하지 못했어요 (${result.launch ?? "실행기 없음"}). 연결은 유지돼요.`
                : "외부 에이전트 운영자에게 전달하세요. 이 토큰으로 Gateway와 다른 에이전트에 요청해요."}
            </p>
          </>
        )}
        <DialogFooter>
          <Button onClick={onClose}>확인</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Approve permissions and connect (install), or disconnect. */
export function ConnectPanel({ agent, devices, agents, onChanged }: { agent: Agent; devices?: Device[] | null; agents?: Agent[] | null; onChanged: () => void }) {
  const [picked, setPicked] = useState(() => new Set(agent.permissions))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [result, setResult] = useState<any>(null)
  const [dialog, ask] = useConfirm()
  const permsKey = agent.permissions.join("|")
  useEffect(() => {
    setPicked(new Set(agent.permissions))
  }, [agent.id, permsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const step = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err as Error)
    } finally {
      setBusy(false)
      onChanged()
    }
  }
  const connectNow = () => api("hub/connections", { method: "POST", body: { agent_id: agent.id, permissions: [...picked] } })
  const connected = (r: any) => {
    setResult(r)
    toast.success(`${displayName(agent)}을(를) 우리 집에 연결했어요`)
  }

  const connect = () =>
    step(async () => {
      try {
        connected(await connectNow())
      } catch (err) {
        const e = err as ApiError
        if (e.reasonCode !== "OWNERSHIP_CONFLICT" || !e.detail?.owners) throw err
        // Each device has one owner: offer to release the current owners first.
        const owners = e.detail.owners as Record<string, string>
        const holders = [...new Set(Object.values(owners))]
        const names = holders.map((id) => nameOf(id, agents)).join(", ")
        const owned = Object.keys(owners).map((d) => deviceName(d, devices)).join(", ")
        const ok = await ask({
          title: "이미 주인이 있는 기기예요",
          body: (
            <p>
              <strong>{owned}</strong>의 주인은 지금 <strong>{names}</strong>예요. 기기마다 주인은 하나라서, {names} 연결을 해제해야 {displayName(agent)}을(를) 연결할 수 있어요.
            </p>
          ),
          confirm: `${names} 해제하고 연결`,
        })
        if (!ok) return
        for (const holder of holders) {
          const [conn] = await api<any[]>(`hub/connections?agent_id=${encodeURIComponent(holder)}&active=true`)
          if (conn) await api(`hub/connections/${conn.id}`, { method: "DELETE" })
        }
        connected(await connectNow())
      }
    })

  const disconnect = () =>
    step(async () => {
      const ok = await ask({
        title: `${displayName(agent)} 연결을 해제할까요?`,
        body: "허용한 권한과 기기 주인이 바로 풀리고, Studio 에이전트는 멈춰요. 언제든 다시 연결할 수 있어요.",
        confirm: "연결 해제",
        danger: true,
      })
      if (!ok) return
      await api(`hub/connections/${agent.connection_id}`, { method: "DELETE" })
      toast("연결을 해제했어요")
    })

  const remove = () =>
    step(async () => {
      const ok = await ask({ title: `${displayName(agent)}을(를) 삭제할까요?`, body: "Agent Cloud와 카탈로그에서 사라지고, 연결도 함께 끊겨요. 되돌릴 수 없어요.", confirm: "삭제", danger: true })
      if (!ok) return
      await api(`hub/agents/${agent.id}`, { method: "DELETE" })
      toast("삭제했어요")
    })

  const refresh = () =>
    step(async () => {
      await api(`hub/agents/${agent.id}/refresh`, { method: "POST" })
      toast("Agent Card를 새로 읽었어요")
    })

  const toggle = (p: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })

  return (
    <section className="grid gap-3" aria-label="Connection">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">{agent.connected ? "허용한 권한" : "연결하면 허용할 권한"}</h3>
        <Badge variant="secondary">{agent.permissions.length}개</Badge>
      </div>
      {agent.permissions.length === 0 && <p className="text-sm text-muted-foreground">요청한 권한이 없어요.</p>}
      <ul className="grid gap-2">
        {agent.permissions.map((p) => {
          const perm = permission(p, devices)
          const Icon = perm.kind === "context" ? Share2 : kindIcon(kindOf(perm.id))
          return (
            <li key={p}>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-3 has-disabled:cursor-default">
                <Checkbox checked={agent.connected || picked.has(p)} disabled={agent.connected || busy} onCheckedChange={() => toggle(p)} />
                <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span>
                <span className="grid">
                  <strong className="text-sm">{perm.label}</strong>
                  <small className="text-xs text-muted-foreground">{perm.detail}</small>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {agent.connected ? (
          <Button variant="outline" disabled={busy} onClick={disconnect}>연결 해제</Button>
        ) : (
          <Button disabled={busy} onClick={connect}>{busy ? "처리 중…" : "우리 집에 연결"}</Button>
        )}
        {agent.url && <Button variant="ghost" disabled={busy} onClick={refresh}>카드 새로 읽기</Button>}
        {agent.origin !== "platform" && agent.mine && (
          <Button variant="ghost" className="text-destructive" disabled={busy} onClick={remove}><Trash2 />삭제</Button>
        )}
      </div>
      {dialog}
      {result && <TokenDialog result={result} agent={agent} onClose={() => setResult(null)} />}
    </section>
  )
}

/** Its maker lists it in the catalog for everyone, or takes it back. */
export function ShareToggle({ agent, onChanged }: { agent: Agent; onChanged: (a?: Agent) => void }) {
  const [busy, setBusy] = useState(false)
  if (!agent.mine || agent.origin === "platform") return null
  const flip = async () => {
    setBusy(true)
    try {
      onChanged(await api<Agent>(`hub/agents/${agent.id}/share`, { method: "POST", body: { shared: !agent.shared } }))
      toast.success(agent.shared ? "공유를 멈췄어요" : "카탈로그에 공유했어요")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border p-3", agent.shared && "border-primary/30 bg-primary/5")}>
      <span className={cn("grid size-9 place-items-center rounded-lg", agent.shared ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}><Share2 className="size-4" /></span>
      <p className="grid min-w-40 flex-1 text-sm">
        <strong>{agent.shared ? "카탈로그에 공유 중" : "나만 보이는 에이전트"}</strong>
        <small className="text-muted-foreground">{agent.shared ? "누구나 찾아서 설치할 수 있어요." : "공유하면 다른 사람도 찾아 설치할 수 있어요."}</small>
      </p>
      <Button size="sm" variant={agent.shared ? "outline" : "default"} disabled={busy} onClick={flip}>{agent.shared ? "공유 중지" : "공유하기"}</Button>
    </div>
  )
}

/** A routine agent (asks the Root Agent at a time of day): run it now. */
export function RoutineRun({ agent, onChanged }: { agent: Agent; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  if (!isRoutine(agent)) return null
  const run = async () => {
    setBusy(true)
    try {
      const { results } = await api<{ results: any[] }>(`hub/agents/${agent.id}/run`, { method: "POST" })
      const r = results[0] ?? {}
      if (r.accepted) toast.success(`실행했어요${r.delegated_to ? ` · ${nameOf(r.delegated_to)}에게 위임됨` : ""}`)
      else toast.error(`거절됐어요: ${r.message || codeText(r.reason_code)}`)
      onChanged()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
      <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Clock className="size-4" /></span>
      <p className="grid min-w-40 flex-1 text-sm">
        <strong>정해진 시각에 Root Agent에게 부탁해요</strong>
        <small className="text-muted-foreground">{agent.connected ? agent.description : "연결해야 실행할 수 있어요."}</small>
      </p>
      <Button size="sm" disabled={busy || !agent.connected} onClick={run}>{busy ? "실행 중…" : "지금 실행"}</Button>
    </div>
  )
}

function Overview({ agent, devices, onChanged }: { agent: Agent; devices?: Device[] | null; onChanged: () => void }) {
  const reads = agent.permissions.filter((p) => p.startsWith("context:")).map((p) => permission(p, devices))
  return (
    <div className="grid gap-4">
      {agent.description && <p className="text-sm leading-relaxed text-foreground/80">{agent.description}</p>}
      <RoutineRun agent={agent} onChanged={onChanged} />
      <ShareToggle agent={agent} onChanged={onChanged} />
      {agent.owned_devices.length > 0 && (
        <section className="grid gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground">맡는 기기</h3>
          <ul className="divide-y rounded-xl border bg-card">
            {agent.owned_devices.map((id) => {
              const dev = devices?.find((d) => d.entity === id)
              const Icon = kindIcon(kindOf(id))
              const on = dev?.state === "on"
              return (
                <li key={id} className="flex items-center gap-3 p-3">
                  <span className={cn("grid size-9 place-items-center rounded-lg", on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}><Icon className="size-4" /></span>
                  <span className="grid flex-1 text-sm">
                    <strong>{deviceName(id, devices)}</strong>
                    <small className="text-muted-foreground">{spaceName(dev?.space)}</small>
                  </span>
                  <Badge variant={on ? "default" : "secondary"}>{stateText(dev ? { ...dev } : null) || "—"}</Badge>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {(agent.provided_fields.length > 0 || reads.length > 0) && (
        <section className="grid gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground">주고받는 상태</h3>
          <div className="flex flex-wrap gap-1.5">
            {agent.provided_fields.map((f) => <Badge key={f} variant="outline">공유: {FIELDS[f] ?? f}</Badge>)}
            {reads.map((r) => <Badge key={r.id} variant="outline">읽기: {r.label}</Badge>)}
          </div>
        </section>
      )}
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">정보</h3>
        <dl className="divide-y rounded-xl border bg-card px-3 text-sm">
          {[
            ["종류", ORIGINS[agent.origin]],
            ["역할", agent.role && (ROLES[agent.role] ?? agent.role)],
            ["공간", agent.space && spaceName(agent.space)],
            ["스킬", agent.skills.length > 0 && agent.skills.map((s) => SKILLS[s] ?? s).join(", ")],
            ["만든 사람", makerText(agent)],
            ["등록일", `${dateText(agent.created_at)} · 설치 ${countText(agent.installs)}`],
            ["Agent Card", agent.url],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k as string} className="flex justify-between gap-4 py-2.5">
                <dt className="shrink-0 text-muted-foreground">{k}</dt>
                <dd className={cn("text-right font-medium break-all", k === "Agent Card" && "font-mono text-xs")}>{v}</dd>
              </div>
            ))}
        </dl>
      </section>
    </div>
  )
}

const KEEP = 40 // messages kept per agent in this browser

function loadChat(id: string): { from: "me" | "agent"; text: string }[] {
  try {
    return JSON.parse(window.localStorage.getItem(`chat:${id}`) || "[]")
  } catch {
    return []
  }
}

function saveChat(id: string, messages: unknown[]) {
  try {
    window.localStorage.setItem(`chat:${id}`, JSON.stringify(messages.slice(-KEEP)))
  } catch {
    // private window: the conversation just isn't kept
  }
}

/** Talk with a connected agent (Hub POST /agents/{id}/chat). Kept only in this browser. */
function Chat({ agent }: { agent: Agent }) {
  const [messages, setMessages] = useState<{ from: "me" | "agent"; text: string }[]>([])
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setMessages(loadChat(agent.id))
  }, [agent.id])
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" })
  }, [messages, busy])

  const update = (next: typeof messages) => {
    setMessages(next)
    saveChat(agent.id, next)
  }
  const send = async () => {
    const message = text.trim()
    if (!message || busy) return
    const mine = [...messages, { from: "me" as const, text: message }]
    update(mine)
    setText("")
    setBusy(true)
    setError(null)
    try {
      const { reply } = await api<{ reply: string }>(`hub/agents/${agent.id}/chat`, { method: "POST", body: { message } })
      update([...mine, { from: "agent", text: reply || "(빈 답)" }])
    } catch (err) {
      setError(err as Error)
    } finally {
      setBusy(false)
    }
  }

  if (!agent.connected) {
    return (
      <div className="grid place-items-center gap-2 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        <Lock className="size-5" />
        우리 집에 연결하면 대화할 수 있어요. 연결 탭에서 연결하세요.
      </div>
    )
  }
  return (
    <section className="grid gap-3" aria-label={`${displayName(agent)}와 대화`}>
      <div className="grid max-h-[52svh] min-h-56 content-start gap-2 overflow-y-auto rounded-xl border bg-card p-3">
        {messages.length === 0 && <p className="m-auto py-10 text-center text-sm text-muted-foreground">{displayName(agent)}에게 무엇이든 물어보세요. 대화는 이 브라우저에만 남아요.</p>}
        {messages.map((m, i) =>
          m.from === "me" ? (
            <div key={i} className="max-w-[86%] justify-self-end rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">{m.text}</div>
          ) : (
            <div key={i} className="max-w-[92%] rounded-2xl rounded-bl-md border bg-muted/40 px-3 py-2"><Markdown text={m.text} /></div>
          ),
        )}
        {busy && (
          <div className="flex w-fit gap-1 rounded-2xl border bg-muted/40 px-3 py-3" aria-label="답을 쓰는 중">
            {[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${i * 120}ms` }} />)}
          </div>
        )}
        <div ref={end} />
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send() }}>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
          placeholder="메시지 보내기 (Enter 전송, Shift+Enter 줄바꿈)"
          rows={2}
          maxLength={2000}
          className="min-h-14 resize-none"
        />
        <Button type="submit" disabled={busy || !text.trim()}>보내기</Button>
      </form>
      {messages.length > 0 && <Button variant="link" size="sm" className="justify-self-end" onClick={() => update([])}>대화 지우기</Button>}
    </section>
  )
}

function Activity({ agentId, agents, devices }: { agentId: string; agents?: Agent[] | null; devices?: Device[] | null }) {
  const { data, error } = useApi<{ hub: any[]; flows: Flow[]; collector: string }>(`hub/agents/${agentId}/activity?limit=12`, { interval: 5000 })
  return (
    <div className="grid gap-4">
      {error && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
      {data?.collector && data.collector !== "ok" && <p className="text-sm text-muted-foreground">요청 기록을 가져올 수 없어요 ({data.collector}).</p>}
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">최근 요청</h3>
        {data?.flows?.length === 0 && <p className="text-sm text-muted-foreground">아직 처리한 요청이 없어요.</p>}
        <ol className="divide-y rounded-xl border bg-card">
          {(data?.flows ?? []).map((f) => (
            <li key={f.flow} className="flex items-start gap-3 p-3">
              <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", f.accepted === false ? "bg-muted-foreground/40" : "bg-primary shadow-[0_0_0_4px] shadow-primary/15")} />
              <span className="grid flex-1 text-sm">
                <strong>{actionLine(f.action, devices)}</strong>
                <small className="text-muted-foreground">
                  {f.requester && f.requester === f.entry ? `${nameOf(f.entry, agents)} 자동화 규칙` : `${nameOf(f.requester, agents)} → ${nameOf(f.entry, agents)}`} · {timeAgo(f.ended_at)}
                </small>
              </span>
              {f.accepted !== null && <Badge variant={f.accepted ? "default" : "secondary"}>{codeText(f.reason_code) || (f.accepted ? "허용" : "거절")}</Badge>}
            </li>
          ))}
        </ol>
      </section>
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">Agent Cloud 기록</h3>
        <ol className="divide-y text-sm">
          {(data?.hub ?? []).map((a, i) => (
            <li key={`${a.ts}-${i}`} className="flex justify-between gap-3 py-2">
              <span className="font-medium">{actionText(a.action)}</span>
              <small className="text-muted-foreground">@{a.actor} · {timeAgo(a.ts)}</small>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

export type AgentTab = "overview" | "chat" | "connect" | "activity"

/** Open with an agent id; close with onClose. */
export function AgentSheet({
  agentId, agents, devices, online, initialTab = "overview", onClose, onChanged,
}: {
  agentId: string
  agents?: Agent[] | null
  devices?: Device[] | null
  online?: boolean
  initialTab?: AgentTab
  onClose: () => void
  onChanged: () => void
}) {
  const mobile = useIsMobile()
  const { data: agent, error, reload } = useApi<Agent>(`hub/agents/${agentId}`, { interval: 5000 })
  const [tab, setTab] = useState<AgentTab>(initialTab)
  const changed = () => {
    void reload()
    onChanged()
  }
  const title = agent ? displayName(agent) : error ? "에이전트" : "불러오는 중…"
  const head = (
    <div className="flex items-center gap-3 text-left">
      {agent && <AgentAvatar agent={agent} size="lg" />}
      <div className="grid min-w-0">
        <span className="truncate text-lg font-bold">{title}</span>
        {agent && <span className="truncate text-sm text-muted-foreground">{makerText(agent)}</span>}
      </div>
    </div>
  )
  const body = (
    <div className="grid gap-4 overflow-y-auto px-4 pb-6">
      {error && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
      {agent && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={agent.connected ? "default" : "secondary"}>{agent.removed ? "삭제됨" : agent.connected ? "우리 집에 연결됨" : "미연결"}</Badge>
            {agent.connected && <Status online={online} />}
            {agentNote(agent) && <Badge variant="outline">{agentNote(agent)}</Badge>}
            <span className="flex-1" />
            <StarButton agent={agent} onChanged={changed} />
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as AgentTab)}>
            <TabsList className="w-full">
              <TabsTrigger value="overview">개요</TabsTrigger>
              {agent.origin !== "external" && <TabsTrigger value="chat">대화</TabsTrigger>}
              <TabsTrigger value="connect">연결</TabsTrigger>
              <TabsTrigger value="activity">활동</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="pt-3"><Overview agent={agent} devices={devices} onChanged={changed} /></TabsContent>
            <TabsContent value="chat" className="pt-3"><Chat agent={agent} /></TabsContent>
            <TabsContent value="connect" className="pt-3">
              {agent.removed ? <p className="text-sm text-muted-foreground">삭제된 에이전트예요.</p> : <ConnectPanel agent={agent} devices={devices} agents={agents} onChanged={changed} />}
            </TabsContent>
            <TabsContent value="activity" className="pt-3"><Activity agentId={agent.id} agents={agents} devices={devices} /></TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )

  if (mobile) {
    return (
      <Drawer open onOpenChange={(open) => !open && onClose()}>
        <DrawerContent className="max-h-[92svh]">
          <DrawerHeader>
            <DrawerTitle asChild>{head}</DrawerTitle>
            <DrawerDescription className="sr-only">{title} 정보와 연결</DrawerDescription>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    )
  }
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        <SheetHeader className="pr-12">
          <SheetTitle asChild>{head}</SheetTitle>
          <SheetDescription className="sr-only">{title} 정보와 연결</SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  )
}
