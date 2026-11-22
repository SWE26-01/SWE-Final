"use client"

// Live data every page of Agent Cloud uses, polled once for all of them, and how to open an agent.
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { createContext, useContext, useMemo, type ReactNode } from "react"

import { useApi } from "@workspace/core/api"
import type { Agent, AgentStatus, Device, Me } from "@workspace/core/types"
import type { AgentTab } from "@workspace/core/components/agent-sheet"

type Data = {
  me: Me | null
  agents: Agent[] | null
  agentsError: Error | null
  popular: Agent[] | null
  devices: Device[] | null
  online: Record<string, boolean>
  reload: () => void
  openAgent: (id: string, tab?: AgentTab) => void
  closeAgent: () => void
}

const DataContext = createContext<Data | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const me = useApi<Me>("auth/me")
  const agents = useApi<Agent[]>("hub/agents", { interval: 5000 })
  const popular = useApi<Agent[]>("hub/agents?shared=true&sort=stars", { interval: 30000 })
  const devices = useApi<Device[]>("gateway/devices", { interval: 5000 })
  const statuses = useApi<AgentStatus[]>("collector/agents", { interval: 5000 })
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const value = useMemo<Data>(() => {
    const withAgent = (id: string | null, tab?: string) => {
      const next = new URLSearchParams(params.toString())
      next.delete("agent")
      next.delete("panel")
      if (id) next.set("agent", id)
      if (id && tab && tab !== "overview") next.set("panel", tab)
      const q = next.toString()
      return q ? `${pathname}?${q}` : pathname
    }
    return {
      me: me.data,
      agents: agents.data,
      agentsError: agents.error,
      popular: popular.data,
      devices: devices.data,
      online: Object.fromEntries((statuses.data ?? []).map((s) => [s.id, s.online])),
      reload: () => {
        void agents.reload()
        void popular.reload()
      },
      openAgent: (id, tab) => router.push(withAgent(id, tab), { scroll: false }),
      closeAgent: () => router.push(withAgent(null), { scroll: false }),
    }
  }, [me.data, agents, popular, devices.data, statuses.data, router, pathname, params])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const d = useContext(DataContext)
  if (!d) throw new Error("useData outside DataProvider")
  return d
}
