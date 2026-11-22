// What the services return, as the screens use it (services/agenthub/main.py AgentOut, ...).

export type Agent = {
  id: string
  name: string
  description: string
  origin: "platform" | "studio" | "external"
  role: "home" | "room" | "external" | null
  space: string | null
  url: string | null
  skills: string[]
  owned_devices: string[]
  provided_fields: string[]
  permissions: string[]
  removed: boolean
  connected: boolean
  connection_id: string | null
  created_at: string
  created_by: string | null
  creator_name: string | null
  shared: boolean
  mine: boolean
  stars: number
  starred: boolean
  installs: number
}

export type Device = {
  entity: string
  space: string
  owner: string
  state: string
  attributes: { friendly_name?: string }
  last_changed?: string
}

export type Space = { id: string; devices: { entity: string; kind: string | null; owner: string | null }[] }

export type Me = { id: string; name: string; role: string; member: boolean }

export type AgentStatus = { id: string; online: boolean }

export type FlowEvent = {
  ts: string
  agent: string
  dir: "in" | "out" | "out-result" | "out-error" | "exec" | "rule"
  to?: string
  from?: string
  type?: string
  request_id?: string
  action?: { device?: string | null; command?: string | null; value?: unknown; macro?: string | null }
  accepted?: boolean
  reason_code?: string
  message?: string
}

export type Flow = {
  flow: string
  requester: string | null
  entry: string | null
  action: FlowEvent["action"] | null
  accepted: boolean | null
  reason_code: string | null
  ended_at: string
  agents: string[]
}
