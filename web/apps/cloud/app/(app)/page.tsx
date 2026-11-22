"use client"

// Agent Cloud home: search first, then the most-starred shared agents and the agents running this home.
import { ArrowRight, Network, Search, Share2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { AgentCard } from "@workspace/core/components/agent-card"
import { AgentAvatar, Status } from "@workspace/core/components/bits"
import { agentNote, displayName } from "@workspace/core/labels"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useData } from "@/components/data"

const QUICK = ["회의", "수면", "커피", "외출", "절전"]

export default function Home() {
  const { agents, popular, devices, online, openAgent, reload } = useData()
  const router = useRouter()
  const [q, setQ] = useState("")
  const running = (agents ?? []).filter((a) => a.connected)
  const search = (term: string) => router.push(term ? `/explore?q=${encodeURIComponent(term)}` : "/explore")

  return (
    <div className="grid gap-10">
      <Card className="overflow-hidden border-primary/10 bg-card/80 py-10 backdrop-blur">
        <CardContent className="grid justify-items-center gap-5 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-400 to-primary text-white shadow-xl shadow-primary/30"><Network className="size-7" /></span>
          <div className="grid gap-2">
            <span className="text-xs font-bold tracking-[0.25em] text-primary">FIND YOUR PERFECT AGENT</span>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Agent Cloud</h1>
            <p className="text-muted-foreground">우리 집 기기와 함께 일할 에이전트를 찾고, 만들고, 연결하세요.</p>
          </div>
          <form className="flex w-full max-w-xl gap-2" role="search" onSubmit={(e) => { e.preventDefault(); search(q.trim()) }}>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="어떤 에이전트를 찾으세요?" className="h-11 rounded-xl pl-10 text-base" aria-label="에이전트 검색" />
            </div>
            <Button type="submit" className="h-11 rounded-xl px-5">검색</Button>
          </form>
          <div className="flex flex-wrap justify-center gap-2">
            {QUICK.map((w) => <Button key={w} variant="outline" size="sm" className="rounded-full" onClick={() => search(w)}>{w}</Button>)}
            <Button variant="secondary" size="sm" className="rounded-full text-primary" onClick={() => search("")}>전체 카탈로그 <ArrowRight /></Button>
          </div>
          <dl className="grid w-full max-w-xl grid-cols-3 gap-2">
            {[
              ["연결된 에이전트", running.length],
              ["공유된 에이전트", popular?.length ?? 0],
              ["집의 기기", devices?.length ?? 0],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-xl bg-primary/5 p-3">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="text-2xl font-extrabold text-primary">{agents ? v : "–"}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <section className="grid gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">인기 에이전트</h2>
          <Button variant="ghost" size="sm" asChild><Link href="/explore">전체 보기 <ArrowRight /></Link></Button>
        </div>
        {popular && popular.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="grid justify-items-center gap-3 py-6 text-center text-sm text-muted-foreground">
              <Share2 className="size-6" />
              아직 공유된 에이전트가 없어요. Studio에서 만들고 카탈로그에 공유해 보세요.
              <Button asChild size="sm"><Link href="/studio">Agent Studio 열기</Link></Button>
            </CardContent>
          </Card>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {!popular && [0, 1, 2].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
          {(popular ?? []).slice(0, 6).map((a) => <AgentCard key={a.id} agent={a} onOpen={(x) => openAgent(x.id)} onChanged={reload} />)}
        </div>
      </section>

      <section className="grid gap-4">
        <h2 className="text-xl font-bold">우리 집 에이전트 <span className="ml-1 text-sm font-medium text-muted-foreground">{running.length}</span></h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {!agents && [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          {running.map((a) => (
            <button key={a.id} type="button" onClick={() => openAgent(a.id)} className="flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              <AgentAvatar agent={a} />
              <span className="grid min-w-0 flex-1">
                <strong className="truncate text-sm">{displayName(a)}</strong>
                <small className="truncate text-xs text-muted-foreground">{agentNote(a) || "에이전트"}</small>
              </span>
              <Status online={online[a.id]} />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
