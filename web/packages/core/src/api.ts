"use client"

// The screens' calls, all through their server-side proxy (app/api/[service]/[...path]).
import { useCallback, useEffect, useRef, useState } from "react"

import { reasonText } from "./labels.ts"

export class ApiError extends Error {
  status: number
  reasonCode?: string
  detail: any
  constructor(status: number, detail: any) {
    const d = typeof detail === "object" && detail !== null && !Array.isArray(detail) ? detail : { message: detail }
    super(reasonText(d))
    this.status = status
    this.reasonCode = d.reason_code
    this.detail = d
  }
}

/** Send the person to the login page, back here afterwards. */
export function toLogin() {
  if (typeof window === "undefined" || window.location.pathname === "/login") return
  const next = window.location.pathname + window.location.search
  window.location.replace(`/login?next=${encodeURIComponent(next)}`)
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => null)
  window.location.replace("/login")
}

export async function api<T = any>(path: string, { method = "GET", body }: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  })
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { detail: text }
  }
  if (!res.ok) {
    const detail = data?.detail ?? data
    if (res.status === 401 && detail?.reason_code === "LOGIN_REQUIRED") toLogin()
    // FastAPI validation errors: [{loc, msg}, ...]
    throw new ApiError(res.status, Array.isArray(detail) ? detail.map((d: any) => d.msg).join("; ") : detail)
  }
  return data as T
}

/** GET `path` (null: skip), optionally every `interval` ms. */
export function useApi<T = any>(path: string | null, { interval }: { interval?: number } = {}) {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: Boolean(path) })
  const current = useRef(path)
  current.current = path

  const reload = useCallback(async () => {
    if (!path) return
    try {
      const data = await api<T>(path)
      if (current.current === path) setState({ data, error: null, loading: false })
    } catch (error) {
      if (current.current === path) setState((s) => ({ data: s.data, error: error as ApiError, loading: false }))
    }
  }, [path])

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false })
      return undefined
    }
    setState((s) => ({ ...s, loading: true }))
    void reload()
    if (!interval) return undefined
    const timer = window.setInterval(reload, interval)
    return () => window.clearInterval(timer)
  }, [path, interval, reload])

  return { ...state, reload }
}
