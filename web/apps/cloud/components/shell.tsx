"use client"

// Agent Cloud's frame: the top bar (sections, the smart home app, theme, account) and the agent
// sheet, opened over any page by ?agent=<id>&panel=<tab>.
import { LogOut, Monitor, Moon, Network, Smartphone, Sun, User } from "lucide-react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useTheme } from "next-themes"
import type { ReactNode } from "react"

import { logout } from "@workspace/core/api"
import { AgentSheet, type AgentTab } from "@workspace/core/components/agent-sheet"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { useData } from "./data"

const SECTIONS = [
  { href: "/", label: "홈" },
  { href: "/explore", label: "둘러보기" },
  { href: "/my", label: "내 에이전트" },
  { href: "/studio", label: "Studio" },
  { href: "/scenario", label: "시나리오" },
]

export const HOME_APP_URL = process.env.NEXT_PUBLIC_HOME_APP_URL || "http://127.0.0.1:3001"

function UserMenu() {
  const { me } = useData()
  const { theme, setTheme } = useTheme()
  const initial = (me?.name ?? "?").slice(0, 1)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="내 계정">
          <Avatar className="size-8"><AvatarFallback className="bg-gradient-to-br from-blue-400 to-primary font-bold text-white">{initial}</AvatarFallback></Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="grid">
          <span>{me?.name ?? "…"}</span>
          <span className="text-xs font-normal text-muted-foreground">@{me?.id}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/my"><User />내 에이전트</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><a href={HOME_APP_URL}><Smartphone />스마트홈 앱</a></DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger><Sun />테마</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light"><Sun />라이트</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark"><Moon />다크</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system"><Monitor />시스템</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void logout()}><LogOut />로그아웃</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SheetHost() {
  const params = useSearchParams()
  const { agents, devices, online, reload, closeAgent } = useData()
  const id = params.get("agent")
  if (!id) return null
  return (
    <AgentSheet
      key={id}
      agentId={id}
      agents={agents}
      devices={devices}
      online={online[id]}
      initialTab={(params.get("panel") as AgentTab) || "overview"}
      onClose={closeAgent}
      onChanged={reload}
    />
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <div className="flex min-h-svh flex-col bg-[radial-gradient(70%_40%_at_10%_0%,color-mix(in_oklch,var(--primary)_9%,transparent),transparent)]">
      <header className="sticky top-0 z-30 border-b bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-4">
          <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight">
            <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-blue-400 to-primary text-white shadow-md shadow-primary/30"><Network className="size-4" /></span>
            <span className="hidden sm:inline">Agent Cloud</span>
          </Link>
          <nav aria-label="Main navigation" className="flex min-w-0 flex-1 justify-start sm:justify-center">
            <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-muted p-1 [scrollbar-width:none]">
              {SECTIONS.map((s) => {
                const active = s.href === "/" ? pathname === "/" : pathname.startsWith(s.href)
                return (
                  <Link
                    key={s.href}
                    href={s.href}
                    aria-current={active ? "page" : undefined}
                    className={cn("rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition hover:text-foreground", active && "bg-background text-foreground shadow-sm")}
                  >
                    {s.label}
                  </Link>
                )
              })}
            </div>
          </nav>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" asChild><a href={HOME_APP_URL} aria-label="스마트홈 앱"><Smartphone /></a></Button>
            </TooltipTrigger>
            <TooltipContent>스마트홈 앱</TooltipContent>
          </Tooltip>
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-20">{children}</main>
      <SheetHost />
    </div>
  )
}
