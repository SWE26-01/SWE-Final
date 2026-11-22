// Icons for spaces, device kinds and agents (lucide).
import {
  Armchair, Baby, Bean, Bot, Clock, Coffee, CookingPot, Laptop, Lamp, Lightbulb, Link2, Monitor, Moon, Network, PersonStanding,
  Smartphone, Snowflake, Sparkles, Tv, VolumeX, type LucideIcon,
} from "lucide-react"

import type { Agent } from "./types.ts"

export const SPACE_ICONS: Record<string, LucideIcon> = { living_room: Armchair, my_room: Laptop, protected_room: Baby, kitchen: CookingPot }

export const KIND_ICONS: Record<string, LucideIcon> = {
  light: Lamp,
  light_mode: Lightbulb,
  tv: Tv,
  tv_muted: VolumeX,
  ac: Snowflake,
  occupancy: PersonStanding,
  sleep_mode: Moon,
  coffee_machine: Coffee,
  beans_low: Bean,
}

export const kindIcon = (kind?: string | null): LucideIcon => (kind && KIND_ICONS[kind]) || Bot

/** An agent's icon, from what it is. */
export function agentIcon(a: Pick<Agent, "id" | "origin" | "role" | "space" | "permissions" | "provided_fields">): LucideIcon {
  if (a.origin === "studio" && a.permissions?.some((p) => p.startsWith("request:"))) return Clock
  if (a.origin === "studio" && a.role === "external") return Sparkles
  if (a.id === "root") return Network
  if (a.provided_fields?.includes("presence")) return Smartphone
  if (a.provided_fields?.includes("pc_state")) return Monitor
  if (a.origin === "external") return Link2
  return (a.space && SPACE_ICONS[a.space]) || Bot
}
