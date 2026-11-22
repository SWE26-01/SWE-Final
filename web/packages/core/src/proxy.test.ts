// npm test (Node's runner, TypeScript stripped): what the screens' server-side proxy lets through.
import assert from "node:assert/strict"
import { test } from "node:test"
import { SERVICES, allowed } from "./proxy.ts"

test("the calls the screens make pass", () => {
  for (const [service, method, path] of [
    ["hub", "GET", "agents"],
    ["hub", "GET", "agents/routine-ab12/activity"],
    ["hub", "POST", "connections"],
    ["hub", "DELETE", "connections/0123abcd"],
    ["hub", "POST", "agents/discover"],
    ["hub", "POST", "agents/my-room-meeting-mode-ab12/share"],
    ["hub", "POST", "agents/root/star"],
    ["hub", "POST", "agents/assistant-ab12/chat"],
    ["hub", "POST", "agents/routine-ab12/run"],
    ["studio", "POST", "drafts"],
    ["studio", "POST", "drafts/a1b2c3d4/approve"],
    ["collector", "GET", "agents"],
    ["collector", "GET", "flows"],
    ["collector", "GET", "flows/3f2a9c1e-77aa-4c1d-9b1e-0a1b2c3d4e5f"],
    ["gateway", "GET", "devices"],
  ]) assert.ok(allowed(service!, method!, path!), `${method} ${service}/${path}`)
})

test("service-only, device and unknown calls are refused", () => {
  for (const [service, method, path] of [
    ["hub", "POST", "tokens/verify"], // agents and services only
    ["hub", "POST", "agents"], // Studio registers, not the screens
    ["hub", "GET", "runtime/peers"],
    ["hub", "POST", "auth/login"], // only through app/api/auth, which keeps the token in a cookie
    ["hub", "GET", "agents/../tokens"],
    ["gateway", "POST", "api/services/input_boolean/turn_on"], // the screens command no device
    ["collector", "POST", "events"],
    ["studio", "DELETE", "drafts/a1b2"],
    ["openclaw", "GET", "agents"],
  ]) assert.equal(allowed(service!, method!, path!), false, `${method} ${service}/${path}`)
})

test("people use their session; only reads of the Collector and Gateway use a service token", () => {
  process.env.DASHBOARD_TOKEN = "d"
  assert.equal(SERVICES.hub!.session, true)
  assert.equal(SERVICES.studio!.session, true)
  assert.equal(SERVICES.hub!.token, undefined)
  assert.equal(SERVICES.collector!.token!(), "d")
  assert.equal(SERVICES.gateway!.token!(), "d")
})
