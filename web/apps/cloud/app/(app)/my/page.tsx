"use client"

// The agents running the home now (Online from the Collector's card checks) and the agents this account made.
import { ArrowRight, Wand2 } from "lucide-react"
import Link from "next/link"

import { AgentCard } from "@workspace/core/components/agent-card"
import { AgentAvatar, Status } from "@workspace/core/components/bits"
import { FIELDS, agentNote, deviceName, displayName, stateText } from "@workspace/core/labels"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardFooter, CardHeader } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { useData } from "@/components/data"
import { PageHead } from "@/components/page-head"

export default function MyAgents() {
  const { me, agents, devices, online, openAgent, reload } = useData()
  const running = (agents ?? []).filter((a) => a.connected)
  const made = (agents ?? []).filter((a) => a.mine)
  return (
    <>
      <PageHead eyebrow="MY AGENTS" title={me ? `${me.name}님의 에이전트` : "내 에이전트"}>지금 집에서 동작 중인 에이전트와 내가 만든 에이전트예요.</PageHead>

      <section className="grid gap-4">
        <h2 className="text-xl font-bold">집에서 동작 중 <span className="ml-1 text-sm font-medium text-muted-foreground">{running.length}</span></h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {!agents && [0, 1, 2].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
          {running.map((a) => (
            <Card key={a.id} role="link" tabIndex={0} onClick={() => openAgent(a.id)} onKeyDown={(e) => e.key === "Enter" && openAgent(a.id)} className="cursor-pointer gap-3 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
              <CardHeader className="flex flex-row items-center gap-3">
                <AgentAvatar agent={a} />
                <div className="grid min-w-0 flex-1">
                  <h3 className="truncate font-semibold">{displayName(a)}</h3>
                  <p className="truncate text-xs text-muted-foreground">{agentNote(a) || a.origin}</p>
                </div>
                <Status online={online[a.id]} />
              </CardHeader>
              <CardContent className="grid gap-1.5">
                {a.owned_devices.slice(0, 4).map((d) => {
                  const dev = devices?.find((x) => x.entity === d)
                  return (
                    <div key={d} className="flex justify-between rounded-lg bg-muted/50 px-2.5 py-1.5 text-sm">
                      <span>{deviceName(d, devices)}</span>
                      <Badge variant={dev?.state === "on" ? "default" : "secondary"}>{stateText(dev) || "—"}</Badge>
                    </div>
                  )
                })}
                {a.provided_fields.map((f) => <div key={f} className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-sm">공유: {FIELDS[f] ?? f}</div>)}
              </CardContent>
              <CardFooter className="justify-between text-xs text-muted-foreground">권한 {a.permissions.length}개 <ArrowRight className="size-4" /></CardFooter>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-10 grid gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">내가 만든 에이전트 <span className="ml-1 text-sm font-medium text-muted-foreground">{made.length}</span></h2>
          <Button size="sm" className="ml-auto" asChild><Link href="/studio"><Wand2 />새로 만들기</Link></Button>
        </div>
        {agents && made.length === 0 && (
          <Card className="border-dashed"><CardContent className="py-8 text-center text-sm text-muted-foreground">아직 없어요. Agent Studio에서 평범한 말로 첫 에이전트를 만들어 보세요.</CardContent></Card>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {made.map((a) => <AgentCard key={a.id} agent={a} onOpen={(x) => openAgent(x.id)} onChanged={reload} />)}
        </div>
      </section>
    </>
  )
}
