"use client";

// Agent Hub screen: one page, views picked by the URL (?tab=, ?agent=, ?view=search&q=, ?draft=).
// All data is live, through the server-side proxy (app/api/[service]/[...path]).
import { useEffect, useMemo, useState } from "react";
import { logout, useApi } from "../lib/api.js";
import AgentDetail from "./components/AgentDetail.js";
import HubNetwork from "./components/HubNetwork.js";
import MyAgents from "./components/MyAgents.js";
import SearchResults from "./components/SearchResults.js";
import Studio from "./components/Studio.js";

const tabs = ["Agent Hub", "My Agent", "Agent Studio"];
const tabRouteNames = { "My Agent": "my-agent", "Agent Studio": "agent-studio" };

function readRoute() {
  const params = new URLSearchParams(window.location.search);
  const tab = Object.entries(tabRouteNames).find(([, route]) => route === params.get("tab"))?.[0] ?? "Agent Hub";
  return {
    tab,
    agentId: params.get("agent"),
    search: params.get("view") === "search" ? params.get("q") ?? "" : null,
    draftId: params.get("draft"),
  };
}

function urlOf(route) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (route.tab && tabRouteNames[route.tab]) url.searchParams.set("tab", tabRouteNames[route.tab]);
  if (route.search !== null && route.search !== undefined) {
    url.searchParams.set("view", "search");
    if (route.search) url.searchParams.set("q", route.search);
  }
  if (route.agentId) url.searchParams.set("agent", route.agentId);
  if (route.draftId) url.searchParams.set("draft", route.draftId);
  return url;
}

export default function Home() {
  const [route, setRoute] = useState({ tab: "Agent Hub", agentId: null, search: null, draftId: null });
  const [query, setQuery] = useState("");
  const me = useApi("auth/me"); // also sends a logged-out visitor to /login
  const agents = useApi("hub/agents", { interval: 5000 });
  const devices = useApi("gateway/devices", { interval: 5000 });
  const statuses = useApi("collector/agents", { interval: 5000 });
  const online = useMemo(() => Object.fromEntries((statuses.data ?? []).map((s) => [s.id, s.online])), [statuses.data]);

  const navigate = (next, { replace = false } = {}) => {
    window.history[replace ? "replaceState" : "pushState"]({}, "", urlOf(next));
    setRoute(readRoute());
  };

  useEffect(() => {
    const sync = () => setRoute(readRoute());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const selected = route.agentId ? agents.data?.find((a) => a.id === route.agentId) : null;
  const openAgent = (agent) => navigate({ agentId: typeof agent === "string" ? agent : agent.id });

  let view;
  if (route.tab === "Agent Studio") {
    view = (
      <Studio
        draftId={route.draftId}
        devices={devices.data}
        onDraftId={(id) => navigate({ tab: "Agent Studio", draftId: id }, { replace: Boolean(route.draftId) && Boolean(id) })}
        onOpenAgent={(id) => {
          agents.reload();
          openAgent(id);
        }}
      />
    );
  } else if (route.tab === "My Agent") {
    view = <MyAgents agents={agents.data} error={agents.error} online={online} devices={devices.data} me={me.data} onSelect={openAgent} />;
  } else if (route.agentId) {
    view = (
      <AgentDetail
        key={route.agentId}
        agentId={route.agentId}
        agents={agents.data}
        devices={devices.data}
        online={online[route.agentId]}
        onBack={() => navigate({})}
        onChanged={agents.reload}
      />
    );
  } else if (route.search !== null) {
    view = (
      <SearchResults
        key={route.search}
        query={route.search}
        onQuery={(q) => navigate({ search: q }, { replace: true })}
        onBack={() => navigate({})}
        onSelect={(agent) => {
          agents.reload();
          openAgent(agent);
        }}
      />
    );
  } else {
    view = (
      <HubNetwork
        agents={agents.data}
        error={agents.error}
        query={query}
        onQuery={setQuery}
        onSearch={() => navigate({ search: query })}
        onSelect={openAgent}
      />
    );
  }

  return (
    <div className="site-shell">
      <header className="header">
        <nav aria-label="Main navigation">
          {tabs.map((tab) => (
            <button key={tab} className={route.tab === tab ? "active" : ""} onClick={() => navigate(tab === "Agent Hub" ? {} : { tab })}>
              {tab === "Agent Hub" && route.agentId ? (
                <span className="tab-breadcrumb"><span>Agent Hub</span><span aria-hidden="true">&gt;</span><span>{selected?.name ?? route.agentId}</span></span>
              ) : (
                tab
              )}
            </button>
          ))}
        </nav>
        <div className="user-menu">
          {me.data && <><strong>{me.data.name}</strong><small>@{me.data.id}</small></>}
          <button type="button" onClick={logout}>로그아웃</button>
        </div>
      </header>
      {view}
      <footer><span>AGENT HUB / 2026</span><a className="footer-link" href="/home">SMART HOME APP →</a><span>Human needs, intelligent connections.</span></footer>
    </div>
  );
}
