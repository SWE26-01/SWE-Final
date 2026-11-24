"use client"

// The smart home app: spaces, devices and the agents that run them, live from the same services as
// Agent Cloud. Devices are read only here: only a device's owning agent commands it (the Gateway
// checks), so the app shows the state and decides who the owner is, by connecting agents.
import { Bell, ChevronLeft, ChevronRight, Home, LayoutGrid, Lock, LogOut, Moon, Plus, Search, Sparkles, Sun, User, X } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useMemo, useState } from "react"

import { logout, useApi } from "@workspace/core/api"
import { AgentSheet, type AgentTab } from "@workspace/core/components/agent-sheet"
import { AgentAvatar, Status } from "@workspace/core/components/bits"
import { useIsMobile } from "@workspace/core/hooks/use-mobile"
import { SPACE_ICONS, agentIcon, kindIcon } from "@workspace/core/icons"
import { HOME_NAMES, actionLine, agentNote, codeText, countText, nameOf, spaceName, stateOf, timeAgo } from "@workspace/core/labels"
import type { Agent, AgentStatus, Device, Flow, Me, Space } from "@workspace/core/types"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card } from "@workspace/ui/components/card"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@workspace/ui/components/drawer"
import { Input } from "@workspace/ui/components/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

const POLL = 4000
const CLOUD = process.env.NEXT_PUBLIC_CLOUD_URL || "http://127.0.0.1:3000"
const SEEN_KEY = "smarthome.seen-flow"

type Dev = { entity: string; kind: string | null; owner: string | null; space: string; name: string; state?: string; last_changed?: string }
type Home = { agents: Agent[]; devices: Device[] | null; online: Record<string, boolean>; spaces: { id: string; devices: Dev[] }[] }
type Open = (to: { agent?: string; tab?: AgentTab; device?: string; space?: string }) => void

function readSeen() {
  try {
    return window.localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}

function writeSeen(v: string) {
  try {
    window.localStorage.setItem(SEEN_KEY, v)
  } catch {
    // private window: the dot just shows again
  }
}

/** A drawer on phones, a side sheet on wide screens. */
function Panel({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: React.ReactNode }) {
  const mobile = useIsMobile()
  if (mobile) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()}>
        <DrawerContent className="max-h-[90svh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription className={cn(!description && "sr-only")}>{description ?? title}</DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-4 overflow-y-auto px-4 pb-6">{children}</div>
        </DrawerContent>
      </Drawer>
    )
  }
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className={cn(!description && "sr-only")}>{description ?? title}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 overflow-y-auto px-4 pb-6">{children}</div>
      </SheetContent>
    </Sheet>
  )
}

function Row({ icon: Icon, title, sub, right, onClick, iconOn }: { icon: React.ComponentType<{ className?: string }>; title: string; sub?: string; right?: React.ReactNode; onClick?: () => void; iconOn?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-accent/60">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", iconOn ? "bg-gradient-to-br from-blue-400 to-primary text-white shadow-md shadow-primary/25" : "bg-muted text-muted-foreground")}>
        <Icon className="size-5" />
      </span>
      <span className="grid min-w-0 flex-1">
        <strong className="truncate text-[15px]">{title}</strong>
        {sub && <small className="truncate text-xs text-muted-foreground">{sub}</small>}
      </span>
      {right}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
    </button>
  )
}

function AgentRow({ agent, online, onClick, sub }: { agent: Agent; online?: boolean; onClick: () => void; sub?: string }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-accent/60">
      <AgentAvatar agent={agent} size="md" />
      <span className="grid min-w-0 flex-1">
        <strong className="truncate text-[15px]">{nameOf(agent.id, [agent])}</strong>
        <small className="truncate text-xs text-muted-foreground">{sub ?? (agentNote(agent) || agent.origin)}</small>
      </span>
      {agent.connected ? <Status online={online} /> : <Badge variant="secondary">미연결</Badge>}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
    </button>
  )
}

function DeviceRow({ device, home, onClick }: { device: Dev; home: Home; onClick: () => void }) {
  const s = stateOf(device.kind, device.state)
  const owner = device.owner ? nameOf(device.owner, home.agents) : null
  return (
    <Row
      icon={kindIcon(device.kind)}
      iconOn={s.on}
      title={device.name}
      sub={owner ? `관리: ${owner}` : "관리하는 에이전트 없음"}
      right={<Badge variant={s.on ? "default" : "secondary"}>{s.text}</Badge>}
      onClick={onClick}
    />
  )
}

const List = ({ children }: { children: React.ReactNode }) => <Card className="gap-0 divide-y overflow-hidden py-0">{children}</Card>
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="grid gap-2">
    <h2 className="px-1 text-sm font-semibold text-muted-foreground">{title}</h2>
    {children}
  </section>
)

function SpacesTab({ home, open, onSearch }: { home: Home; open: Open; onSearch: (q: string) => void }) {
  const [q, setQ] = useState("")
  const external = home.agents.filter((a) => a.role === "external" && a.origin !== "studio")
  return (
    <div className="grid gap-4">
      <List>
        {home.spaces.map((space) => {
          const on = space.devices.filter((d) => stateOf(d.kind, d.state).on).length
          return <Row key={space.id} icon={SPACE_ICONS[space.id] ?? Home} title={spaceName(space.id)} sub={`${space.devices.length}개 기기${on ? ` · ${on}개 켜짐` : ""}`} onClick={() => open({ space: space.id })} />
        })}
      </List>
      <Card className="gap-3 px-4 py-4">
        <button type="button" onClick={() => onSearch("")} className="flex items-center gap-2 text-left">
          <Sparkles className="size-5 text-primary" />
          <strong className="flex-1">외부 기기 연결</strong>
          <ChevronRight className="size-4 text-muted-foreground/60" />
        </button>
        <form className="relative" onSubmit={(e) => { e.preventDefault(); if (q.trim()) onSearch(q) }}>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="기기 또는 서비스 검색" className="h-10 rounded-full pl-9 text-base" aria-label="기기 또는 서비스 검색" />
        </form>
        <div className="grid grid-cols-4 gap-2">
          {external.map((a) => {
            const Icon = agentIcon(a)
            return (
              <button key={a.id} type="button" onClick={() => open({ agent: a.id })} className="grid justify-items-center gap-1.5">
                <span className="relative grid size-12 place-items-center rounded-full border bg-card shadow-sm">
                  <Icon className="size-5" />
                  {a.connected && <i className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-card bg-emerald-500" />}
                </span>
                <small className="max-w-full truncate text-xs font-medium">{nameOf(a.id, [a])}</small>
              </button>
            )
          })}
          <a href={`${CLOUD}/explore`} className="grid justify-items-center gap-1.5">
            <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary"><Plus className="size-5" /></span>
            <small className="text-xs font-medium">더보기</small>
          </a>
        </div>
      </Card>
    </div>
  )
}

function DevicesTab({ home, open }: { home: Home; open: Open }) {
  return (
    <div className="grid gap-4">
      {home.spaces.map((space) => (
        <Section key={space.id} title={spaceName(space.id)}>
          <List>{space.devices.map((d) => <DeviceRow key={d.entity} device={d} home={home} onClick={() => open({ device: d.entity })} />)}</List>
        </Section>
      ))}
    </div>
  )
}

/** The Hub's search (id, name, description), plus the home agents' Korean names. */
function SearchResults({ home, query, open }: { home: Home; query: string; open: Open }) {
  const [term, setTerm] = useState(query.trim())
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(query.trim()), 250)
    return () => window.clearTimeout(t)
  }, [query])
  const { data, error } = useApi<Agent[]>(term ? `hub/agents?q=${encodeURIComponent(term)}` : null)
  const lower = term.toLowerCase()
  const results = [...(data ?? []), ...home.agents.filter((a) => HOME_NAMES[a.id]?.toLowerCase().includes(lower) && !data?.some((d) => d.id === a.id))]
  return (
    <Section title={!data && !error ? "찾는 중…" : `“${term}” 검색 결과 · ${results.length}`}>
      <List>
        {data && results.length === 0 && <p className="p-4 text-sm text-muted-foreground">맞는 에이전트가 없어요. Agent Studio에서 직접 만들 수 있어요.</p>}
        {results.map((a) => <AgentRow key={a.id} agent={a} online={home.online[a.id]} sub={a.description || agentNote(a)} onClick={() => open({ agent: a.id })} />)}
      </List>
    </Section>
  )
}

function ConnectTab({ home, open, query, onQuery }: { home: Home; open: Open; query: string; onQuery: (q: string) => void }) {
  const used = home.agents.filter((a) => a.connected)
  const rest = home.agents.filter((a) => !a.connected)
  return (
    <div className="grid gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="기기 또는 서비스 검색" className="h-10 rounded-full pr-9 pl-9 text-base" aria-label="에이전트 검색" />
        {query && <button type="button" onClick={() => onQuery("")} aria-label="지우기" className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"><X className="size-4" /></button>}
      </div>
      {query.trim() ? (
        <SearchResults home={home} query={query} open={open} />
      ) : (
        <>
          <Section title={`사용 중 · ${used.length}`}>
            <List>{used.map((a) => <AgentRow key={a.id} agent={a} online={home.online[a.id]} onClick={() => open({ agent: a.id })} />)}</List>
          </Section>
          {rest.length > 0 && (
            <Section title="추가할 수 있어요">
              <List>{rest.map((a) => <AgentRow key={a.id} agent={a} online={home.online[a.id]} onClick={() => open({ agent: a.id })} />)}</List>
            </Section>
          )}
        </>
      )}
      <div className="grid gap-2">
        <Button size="lg" className="h-11 rounded-xl" asChild><a href={`${CLOUD}/studio`}><Sparkles />Agent Studio에서 새로 만들기</a></Button>
        <Button size="lg" variant="outline" className="h-11 rounded-xl" asChild><a href={`${CLOUD}/explore`}><LayoutGrid />Agent Cloud 카탈로그 둘러보기</a></Button>
      </div>
    </div>
  )
}

function SpaceView({ home, spaceId, open, onBack }: { home: Home; spaceId: string; open: Open; onBack: () => void }) {
  const space = home.spaces.find((s) => s.id === spaceId)
  if (!space) return null
  const on = space.devices.filter((d) => stateOf(d.kind, d.state).on).length
  const agents = home.agents.filter((a) => a.space === spaceId)
  const Icon = SPACE_ICONS[spaceId] ?? Home
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center">
        <Button variant="secondary" size="icon" className="rounded-full" onClick={onBack} aria-label="뒤로"><ChevronLeft /></Button>
        <h1 className="text-center text-xl font-bold">{spaceName(spaceId)}</h1>
      </div>
      <Card className="flex-row items-center gap-4 px-4 py-4">
        <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon className="size-7" /></span>
        <div className="grid">
          <strong>기기 {space.devices.length}개 · {on}개 켜짐</strong>
          <small className="text-xs text-muted-foreground">기기는 주인 에이전트만 움직일 수 있어요.</small>
        </div>
      </Card>
      <Section title="기기"><List>{space.devices.map((d) => <DeviceRow key={d.entity} device={d} home={home} onClick={() => open({ device: d.entity })} />)}</List></Section>
      <Section title="이 공간의 에이전트">
        <List>
          {agents.length === 0 && <p className="p-4 text-sm text-muted-foreground">이 공간에서 일하는 에이전트가 없어요.</p>}
          {agents.map((a) => <AgentRow key={a.id} agent={a} online={home.online[a.id]} onClick={() => open({ agent: a.id })} />)}
        </List>
      </Section>
    </div>
  )
}

function DevicePanel({ home, entity, open, onClose }: { home: Home; entity: string; open: Open; onClose: () => void }) {
  const device = home.spaces.flatMap((s) => s.devices).find((d) => d.entity === entity)
  if (!device) return null
  const s = stateOf(device.kind, device.state)
  const Icon = kindIcon(device.kind)
  const owner = home.agents.find((a) => a.id === device.owner)
  const others = home.agents.filter((a) => a.id !== device.owner && (a.permissions.includes(`device:${entity}`) || a.permissions.includes(`request:${entity}`) || a.owned_devices.includes(entity)))
  return (
    <Panel title={device.name} description={`${spaceName(device.space)}${device.last_changed ? ` · ${timeAgo(device.last_changed)} 바뀜` : ""}`} onClose={onClose}>
      <Card className="flex-row items-center gap-4 px-4 py-4">
        <span className={cn("grid size-14 place-items-center rounded-2xl", s.on ? "bg-gradient-to-br from-blue-400 to-primary text-white" : "bg-muted text-muted-foreground")}><Icon className="size-7" /></span>
        <strong className="text-lg">{s.text}</strong>
      </Card>
      <Section title="관리하는 에이전트">
        <List>
          {owner ? <AgentRow agent={owner} online={home.online[owner.id]} onClick={() => open({ agent: owner.id })} /> : <p className="p-4 text-sm text-destructive">지금은 아무 에이전트도 이 기기를 움직일 수 없어요. 아래 에이전트를 연결하세요.</p>}
        </List>
      </Section>
      {others.length > 0 && (
        <Section title="이 기기를 맡거나 부탁할 수 있는 에이전트">
          <List>{others.map((a) => <AgentRow key={a.id} agent={a} online={home.online[a.id]} onClick={() => open({ agent: a.id })} />)}</List>
        </Section>
      )}
      <p className="flex gap-2 text-xs text-muted-foreground"><Lock className="mt-0.5 size-3.5 shrink-0" />기기마다 주인 에이전트는 하나예요. 명령은 주인만 보낼 수 있고, Gateway가 매번 확인해요.</p>
    </Panel>
  )
}

function ActivityPanel({ home, flows, onClose }: { home: Home; flows: Flow[] | null; onClose: () => void }) {
  return (
    <Panel title="활동" description="에이전트가 기기와 서로에게 보낸 요청이에요. 거절된 요청도 그대로 남아요." onClose={onClose}>
      <List>
        {flows?.length === 0 && <p className="p-4 text-sm text-muted-foreground">아직 요청이 없어요.</p>}
        {(flows ?? []).map((f) => (
          <div key={f.flow} className="flex items-start gap-3 px-3 py-3">
            <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", f.accepted === false ? "bg-muted-foreground/40" : "bg-primary shadow-[0_0_0_4px] shadow-primary/15")} />
            <span className="grid flex-1 text-sm">
              <strong>{actionLine(f.action, home.devices)}</strong>
              <small className="text-xs text-muted-foreground">
                {f.requester && f.requester === f.entry ? `${nameOf(f.entry, home.agents)} 자동화` : `${nameOf(f.requester, home.agents)} → ${nameOf(f.entry, home.agents)}`} · {timeAgo(f.ended_at)}
              </small>
            </span>
            {f.accepted !== null && <Badge variant={f.accepted ? "default" : "secondary"}>{codeText(f.reason_code) || (f.accepted ? "허용" : "거절")}</Badge>}
          </div>
        ))}
      </List>
    </Panel>
  )
}

function ProfileView({ home, me, open }: { home: Home; me: Me | null; open: Open }) {
  const { resolvedTheme, setTheme } = useTheme()
  const made = home.agents.filter((a) => a.mine)
  const stars = made.reduce((n, a) => n + a.stars, 0)
  return (
    <div className="grid gap-4">
      <h1 className="text-center text-xl font-bold">내 정보</h1>
      <Card className="flex-row items-center gap-4 px-4 py-4">
        <Avatar className="size-14"><AvatarFallback className="bg-gradient-to-br from-blue-400 to-primary text-xl font-bold text-white">{(me?.name ?? "?").slice(0, 1)}</AvatarFallback></Avatar>
        <div className="grid">
          <strong className="text-lg">{me?.name ?? "…"}</strong>
          <small className="text-muted-foreground">@{me?.id}</small>
        </div>
      </Card>
      <div className="grid grid-cols-3 gap-2">
        {[["만든 에이전트", made.length], ["공유 중", made.filter((a) => a.shared).length], ["받은 별", countText(stars)]].map(([k, v]) => (
          <Card key={k as string} className="gap-0 py-3 text-center">
            <strong className="text-xl text-primary">{v}</strong>
            <small className="text-xs text-muted-foreground">{k}</small>
          </Card>
        ))}
      </div>
      <Section title="내가 만든 에이전트">
        <List>
          {made.length === 0 && <p className="p-4 text-sm text-muted-foreground">아직 없어요. Agent Studio에서 만들고 공유해 보세요.</p>}
          {made.map((a) => <AgentRow key={a.id} agent={a} online={home.online[a.id]} sub={a.shared ? `공유 중 · ★ ${a.stars} · 설치 ${a.installs}` : "나만 보기"} onClick={() => open({ agent: a.id })} />)}
        </List>
      </Section>
      <div className="grid gap-2">
        <Button size="lg" className="h-11 rounded-xl" asChild><a href={`${CLOUD}/studio`}><Sparkles />Agent Studio에서 만들기</a></Button>
        <Button size="lg" variant="outline" className="h-11 rounded-xl" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          {resolvedTheme === "dark" ? <Sun /> : <Moon />}{resolvedTheme === "dark" ? "라이트 모드" : "다크 모드"}
        </Button>
        <Button size="lg" variant="ghost" className="h-11 rounded-xl text-muted-foreground" onClick={() => void logout()}><LogOut />로그아웃</Button>
      </div>
    </div>
  )
}

export function HomeApp() {
  const me = useApi<Me>("auth/me")
  const spaces = useApi<Space[]>("hub/spaces", { interval: POLL })
  const devices = useApi<Device[]>("gateway/devices", { interval: POLL })
  const agents = useApi<Agent[]>("hub/agents", { interval: POLL })
  const statuses = useApi<AgentStatus[]>("collector/agents", { interval: POLL })
  const flows = useApi<Flow[]>("collector/flows?limit=30", { interval: POLL })

  const [screen, setScreen] = useState<"home" | "profile">("home")
  const [tab, setTab] = useState("space")
  const [spaceId, setSpaceId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [agent, setAgent] = useState<{ id: string; tab?: AgentTab } | null>(null)
  const [device, setDevice] = useState<string | null>(null)
  const [activity, setActivity] = useState(false)
  const [seen, setSeen] = useState<string | null>(null)
  useEffect(() => setSeen(readSeen()), [])

  // Hub spaces (who owns each device now) joined with the Gateway's device states and names.
  const home = useMemo<Home>(() => {
    const byEntity = Object.fromEntries((devices.data ?? []).map((d) => [d.entity, d]))
    return {
      agents: agents.data ?? [],
      devices: devices.data,
      online: Object.fromEntries((statuses.data ?? []).map((s) => [s.id, s.online])),
      spaces: (spaces.data ?? []).map((s) => ({
        id: s.id,
        devices: s.devices.map((d) => ({
          ...d,
          space: s.id,
          name: byEntity[d.entity]?.attributes?.friendly_name ?? d.entity,
          state: byEntity[d.entity]?.state,
          last_changed: byEntity[d.entity]?.last_changed,
        })),
      })),
    }
  }, [agents.data, devices.data, spaces.data, statuses.data])

  const latest = flows.data?.[0]?.ended_at ?? null
  const unseen = Boolean(latest && latest !== seen)
  const all = home.spaces.flatMap((s) => s.devices)
  const onCount = all.filter((d) => stateOf(d.kind, d.state).on).length
  const connected = home.agents.filter((a) => a.connected).length
  const loading = !spaces.data && !spaces.error

  const open: Open = (to) => {
    if (to.space) {
      setScreen("home")
      setSpaceId(to.space)
    } else if (to.device) setDevice(to.device)
    else if (to.agent) {
      setDevice(null)
      setAgent({ id: to.agent, tab: to.tab })
    }
  }
  const openActivity = () => {
    setActivity(true)
    if (latest) {
      writeSeen(latest)
      setSeen(latest)
    }
  }
  const reload = () => {
    void agents.reload()
    void spaces.reload()
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-lg flex-col bg-[linear-gradient(180deg,color-mix(in_oklch,var(--primary)_55%,var(--background))_0,color-mix(in_oklch,var(--primary)_18%,var(--background))_220px,var(--background)_420px)] shadow-[0_0_0_1px_var(--border)]">
      <main className="flex-1 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28">
        {screen === "profile" ? (
          <ProfileView home={home} me={me.data} open={open} />
        ) : spaceId ? (
          <SpaceView home={home} spaceId={spaceId} open={open} onBack={() => setSpaceId(null)} />
        ) : (
          <div className="grid gap-4">
            <header className="flex items-center gap-2.5 pt-[27px] text-white">
              <Home className="size-7 drop-shadow" />
              <h1 className="flex-1 text-2xl font-bold drop-shadow">스마트홈</h1>
              <Button variant="ghost" size="icon" className="relative text-white hover:bg-white/15 hover:text-white" onClick={openActivity} aria-label={unseen ? "새 활동 있음" : "활동"}>
                <Bell className="size-6" />
                {unseen && <i className="absolute top-1.5 right-1.5 size-2 rounded-full bg-white ring-2 ring-primary" />}
              </Button>
            </header>
            <p className="-mt-2 text-sm font-medium text-white/90">에이전트 {connected}개 연결 · 기기 {all.length}개 중 {onCount}개 켜짐</p>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="h-11 w-full rounded-2xl bg-white/40 p-1 backdrop-blur dark:bg-white/10">
                <TabsTrigger value="space" className="rounded-xl">공간</TabsTrigger>
                <TabsTrigger value="device" className="rounded-xl">기기</TabsTrigger>
                <TabsTrigger value="ext" className="rounded-xl">외부 연결</TabsTrigger>
              </TabsList>
              {loading ? (
                <div className="grid gap-3 pt-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
              ) : (
                <>
                  <TabsContent value="space" className="pt-3"><SpacesTab home={home} open={open} onSearch={(q) => { setQuery(q); setTab("ext") }} /></TabsContent>
                  <TabsContent value="device" className="pt-3"><DevicesTab home={home} open={open} /></TabsContent>
                  <TabsContent value="ext" className="pt-3"><ConnectTab home={home} open={open} query={query} onQuery={setQuery} /></TabsContent>
                </>
              )}
            </Tabs>
          </div>
        )}
      </main>

      <nav aria-label="앱 메뉴" className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-lg -translate-x-1/2 justify-around border-t bg-background/90 px-8 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
        <Button variant="ghost" size="icon" className={cn("size-12", screen === "home" ? "text-primary" : "text-muted-foreground")} onClick={() => { setScreen("home"); setSpaceId(null) }} aria-label="홈"><Home className="size-6" /></Button>
        <Button variant="ghost" size="icon" className="size-12 text-muted-foreground" asChild><a href={`${CLOUD}/explore`} aria-label="Agent Cloud"><LayoutGrid className="size-6" /></a></Button>
        <Button variant="ghost" size="icon" className={cn("size-12", screen === "profile" ? "text-primary" : "text-muted-foreground")} onClick={() => { setScreen("profile"); setSpaceId(null) }} aria-label="내 정보"><User className="size-6" /></Button>
      </nav>

      {agent && (
        <AgentSheet
          key={agent.id}
          agentId={agent.id}
          agents={home.agents}
          devices={home.devices}
          online={home.online[agent.id]}
          initialTab={agent.tab}
          onClose={() => setAgent(null)}
          onChanged={reload}
        />
      )}
      {device && <DevicePanel home={home} entity={device} open={open} onClose={() => setDevice(null)} />}
      {activity && <ActivityPanel home={home} flows={flows.data} onClose={() => setActivity(false)} />}
    </div>
  )
}

