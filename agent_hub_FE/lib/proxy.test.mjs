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
    ["studio", "POST", "drafts"],
    ["studio", "POST", "drafts/a1b2c3d4/approve"],
    ["collector", "GET", "agents"],
    ["gateway", "GET", "devices"],
  ]) assert.ok(allowed(service, method, path), `${method} ${service}/${path}`);
});

test("service-only, device and unknown calls are refused", () => {
  for (const [service, method, path] of [
    ["hub", "POST", "tokens/verify"], // agents and services only
    ["hub", "POST", "agents"], // Studio registers, not the screen
    ["hub", "GET", "runtime/peers"],
    ["hub", "GET", "agents/../tokens"],
    ["hub", "GET", "agents/x/../../audit"],
    ["gateway", "POST", "api/services/input_boolean/turn_on"], // the screen commands no device
    ["collector", "POST", "events"],
    ["studio", "DELETE", "drafts/a1b2"],
    ["openclaw", "GET", "agents"],
  ]) assert.equal(allowed(service, method, path), false, `${method} ${service}/${path}`);
});

test("tokens come from the server environment only", () => {
  process.env.HOME_USER_TOKEN = "u";
  process.env.DASHBOARD_TOKEN = "d";
  assert.equal(SERVICES.hub.token(), "u");
  assert.equal(SERVICES.studio.token(), "u");
  assert.equal(SERVICES.collector.token(), "d");
  assert.equal(SERVICES.gateway.token(), "d");
});
