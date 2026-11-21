"use client";

// The screen's calls, all through the server-side proxy (app/api/[service]/[...path]).
import { useCallback, useEffect, useRef, useState } from "react";
import { reasonText } from "./labels.js";

export class ApiError extends Error {
  constructor(status, detail) {
    const d = typeof detail === "object" && detail !== null && !Array.isArray(detail) ? detail : { message: detail };
    super(reasonText(d));
    this.status = status;
    this.reasonCode = d.reason_code;
    this.detail = d;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const detail = data?.detail ?? data;
    // FastAPI validation errors: [{loc, msg}, ...]
    throw new ApiError(res.status, Array.isArray(detail) ? detail.map((d) => d.msg).join("; ") : detail);
  }
  return data;
}

/** GET `path` (null: skip), optionally every `interval` ms. Returns {data, error, loading, reload}. */
export function useApi(path, { interval } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const current = useRef(path);
  current.current = path;

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const data = await api(path);
      if (current.current === path) setState({ data, error: null, loading: false });
    } catch (error) {
      if (current.current === path) setState((s) => ({ data: s.data, error, loading: false }));
    }
  }, [path]);

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true }));
    reload();
    if (!interval) return undefined;
    const timer = window.setInterval(reload, interval);
    return () => window.clearInterval(timer);
  }, [path, interval, reload]);

  return { ...state, reload };
}
