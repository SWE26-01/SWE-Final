// npm test: what the screen's server-side proxy lets through.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SERVICES, allowed } from "./proxy.js";

test("the calls the screen makes pass", () => {
  for (const [service, method, path] of [
    ["hub", "GET", "agents"],
    ["hub", "GET", "agents/my-room-meeting-mode-ab12/activity"],
    ["hub", "POST", "connections"],
    ["hub", "DELETE", "connections/0123abcd"],
    ["hub", "POST", "agents/discover"],
    ["hub", "POST", "agents/my-room-meeting-mode-ab12/share"],
    ["hub", "POST", "agents/room1/star"],
    ["hub", "POST", "agents/assistant-ab12/chat"],
    ["hub", "POST", "agents/routine-ab12/run"],
    ["collector", "GET", "flows/3f2a9c1e-77aa-4c1d-9b1e-0a1b2c3d4e5f"],
    ["studio", "POST", "drafts"],
    ["studio", "POST", "drafts/a1b2c3d4/approve"],
    ["collector", "GET", "agents"],
    ["collector", "GET", "flows"],
    ["gateway", "GET", "devices"],
  ]) assert.ok(allowed(service, method, path), `${method} ${service}/${path}`);
});

test("service-only, device and unknown calls are refused", () => {
  for (const [service, method, path] of [
    ["hub", "POST", "tokens/verify"], // agents and services only
    ["hub", "POST", "agents"], // Studio registers, not the screen
    ["hub", "GET", "runtime/peers"],
    ["hub", "POST", "auth/login"], // only through app/api/auth, which keeps the token in a cookie
    ["hub", "GET", "auth/me"],
    ["hub", "GET", "agents/../tokens"],
    ["hub", "GET", "agents/x/../../audit"],
    ["gateway", "POST", "api/services/input_boolean/turn_on"], // the screen commands no device
    ["collector", "POST", "events"],
    ["studio", "DELETE", "drafts/a1b2"],
    ["openclaw", "GET", "agents"],
  ]) assert.equal(allowed(service, method, path), false, `${method} ${service}/${path}`);
});

test("people use their session; only reads of the Collector and Gateway use a service token", () => {
  process.env.HOME_USER_TOKEN = "u";
  process.env.DASHBOARD_TOKEN = "d";
  assert.equal(SERVICES.hub.session, true);
  assert.equal(SERVICES.studio.session, true);
  assert.equal(SERVICES.hub.token, undefined); // the home user's token is not used by the screen
  assert.equal(SERVICES.collector.token(), "d");
  assert.equal(SERVICES.gateway.token(), "d");
});
