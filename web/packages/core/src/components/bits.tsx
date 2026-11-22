"use client"

// Small pieces both apps use: an agent's avatar, its Online state, the star button.
import { Star } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { api } from "../api.ts"
import { agentIcon } from "../icons.tsx"
import { countText, displayName } from "../labels.ts"
import type { Agent } from "../types.ts"

export function AgentAvatar({ agent, size = "md", className }: { agent: Agent; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = agentIcon(agent)
  const box = { sm: "size-8 rounded-lg", md: "size-11 rounded-xl", lg: "size-14 rounded-2xl" }[size]
  const tone =
    agent.origin === "studio"
      ? "bg-gradient-to-br from-blue-400 to-primary text-white"
      : agent.origin === "external"
        ? "bg-muted text-foreground"
        : "bg-primary/10 text-primary"
  return (
    <span className={cn("grid shrink-0 place-items-center", box, tone, className)} aria-hidden="true">
      <Icon className={size === "lg" ? "size-7" : size === "sm" ? "size-4" : "size-5"} />
    </span>
  )
}

export function Status({ online }: { online?: boolean }) {
  if (online === undefined) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
      <i className={cn("size-2 rounded-full", online ? "bg-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/20" : "bg-muted-foreground/40")} />
      {online ? "Online" : "Offline"}
    </span>
  )
}

export function StarButton({ agent, onChanged, className }: { agent: Agent; onChanged?: (a: Agent) => void; className?: string }) {
  const [busy, setBusy] = useState(false)
  const flip = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setBusy(true)
    try {
      onChanged?.(await api<Agent>(`hub/agents/${agent.id}/star`, { method: "POST", body: { starred: !agent.starred } }))
      if (!agent.starred) toast.success(`${displayName(agent)}에 별을 줬어요`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button
      variant={agent.starred ? "secondary" : "outline"}
      size="sm"
      className={cn(agent.starred && "text-primary", className)}
      onClick={flip}
      disabled={busy}
      aria-pressed={agent.starred}
      aria-label={agent.starred ? "별 취소" : "별 주기"}
    >
      <Star className={cn(agent.starred && "fill-current")} />
      {countText(agent.stars)}
    </Button>
  )
}
