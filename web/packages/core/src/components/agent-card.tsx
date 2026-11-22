"use client"

// An agent in a grid: what it is, who made it, how it is doing, and a star.
import { ArrowRight } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent, CardFooter, CardHeader } from "@workspace/ui/components/card"

import { agentNote, countText, dateText, displayName, makerText } from "../labels.ts"
import type { Agent } from "../types.ts"
import { AgentAvatar, StarButton } from "./bits.tsx"

export function AgentCard({ agent, onOpen, onChanged }: { agent: Agent; onOpen: (a: Agent) => void; onChanged?: () => void }) {
  const open = () => onOpen(agent)
  return (
    <Card
      role="link"
      tabIndex={0}
      aria-label={`${displayName(agent)} 열기`}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
      className="group cursor-pointer gap-3 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <CardHeader className="flex flex-row items-center gap-3">
        <AgentAvatar agent={agent} />
        <div className="grid min-w-0 flex-1">
          <h3 className="truncate font-semibold">{displayName(agent)}</h3>
          <p className="truncate text-xs text-muted-foreground">{makerText(agent)}</p>
        </div>
        <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
      </CardHeader>
      <CardContent className="grid flex-1 gap-3">
        <p className="line-clamp-3 text-sm text-foreground/75">{agent.description || agentNote(agent) || "설명이 없어요."}</p>
        <div className="flex flex-wrap gap-1.5">
          {agent.connected && <Badge>우리 집에 연결됨</Badge>}
          {agent.mine && <Badge variant="secondary">{agent.shared ? "공유 중" : "나만 보기"}</Badge>}
          {agentNote(agent) && <Badge variant="outline">{agentNote(agent)}</Badge>}
        </div>
      </CardContent>
      <CardFooter className="justify-between border-t text-xs text-muted-foreground">
        <span>{dateText(agent.created_at)}</span>
        <span className="flex items-center gap-3">
          <span>설치 {countText(agent.installs)}</span>
          <StarButton agent={agent} onChanged={onChanged} />
        </span>
      </CardFooter>
    </Card>
  )
}
