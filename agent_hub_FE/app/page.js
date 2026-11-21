"use client";

// Agent Hub screen: one page; the view comes from the URL (?tab=, ?view=search&q=, ?draft=) and an
// agent opens in a sheet on top of it (?agent=). All data is live, through the server-side proxy.
import { useEffect, useMemo, useRef, useState } from "react";
import { logout, useApi } from "../lib/api.js";
import AgentSheet from "./components/AgentDetail.js";
import HubNetwork from "./components/HubNetwork.js";
import MyAgents from "./components/MyAgents.js";
import SearchResults from "./components/SearchResults.js";
import Studio from "./components/Studio.js";
import { Icon, ToastProvider } from "./components/ui.js";

const TABS = [
  ["hub", "Agent Hub"],
  ["my-agent", "내 에이전트"],
  ["agent-studio", "Studio"],
];

function readRoute() {
  const params = new URLSearchParams(window.location.search);
  const tab = TABS.some(([id]) => id === params.get("tab")) ? params.get("tab") : "hub";
  return {
    tab,
    agentId: params.get("agent"),
    agentTab: params.get("panel"),
    search: tab === "hub" && params.get("view") === "search" ? params.get("q") ?? "" : null,
    draftId: params.get("draft"),
  };
}

function urlOf(route) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (route.tab && route.tab !== "hub") url.searchParams.set("tab", route.tab);
  if (route.search !== null && route.search !== undefined) {
    url.searchParams.set("view", "search");
    if (route.search) url.searchParams.set("q", route.search);
  }
  if (route.draftId) url.searchParams.set("draft", route.draftId);
  if (route.agentId) url.searchParams.set("agent", route.agentId);
  if (route.agentId && route.agentTab) url.searchParams.set("panel", route.agentTab);
  return url;
}

function UserMenu({ me }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => !box.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const initial = (me?.name ?? "?").slice(0, 1);
  return (
    <div className="user-menu" ref={box}>
      <button type="button" className="avatar-button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label="내 계정">
        <span className="user-initial">{initial}</span>
      </button>
      {open && (
        <div className="popover" role="menu">
          <div className="popover-head">
            <span className="user-initial lg">{initial}</span>
            <span><strong>{me?.name}</strong><small>@{me?.id}</small></span>
          </div>
          <a role="menuitem" href="/?tab=my-agent"><Icon name="user" size={18} /> 내 에이전트</a>
          <a role="menuitem" href="/home"><Icon name="phoneApp" size={18} /> 스마트홈 앱</a>
          <button type="button" role="menuitem" onClick={logout}><Icon name="logout" size={18} /> 로그아웃</button>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [route, setRoute] = useState({ tab: "hub", agentId: null, agentTab: null, search: null, draftId: null });
  const [query, setQuery] = useState("");
  const me = useApi("auth/me"); // also sends a logged-out visitor to /login
  const agents = useApi("hub/agents", { interval: 5000 });
  const shared = useApi("hub/agents?shared=true", { interval: 30000 });
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

  const openAgent = (agent, agentTab = null) => navigate({ ...route, agentId: typeof agent === "string" ? agent : agent.id, agentTab });
  const closeAgent = () => navigate({ ...route, agentId: null, agentTab: null });
  const reload = () => {
    agents.reload();
    shared.reload();
  };

  let view;
  if (route.tab === "agent-studio") {
    view = (
      <Studio
        draftId={route.draftId}
        devices={devices.data}
        onDraftId={(id) => navigate({ tab: "agent-studio", draftId: id }, { replace: Boolean(route.draftId) && Boolean(id) })}
        onOpenAgent={(id, tab) => {
          reload();
          openAgent(id, tab);
        }}
      />
    );
  } else if (route.tab === "my-agent") {
    view = <MyAgents agents={agents.data} error={agents.error} online={online} devices={devices.data} me={me.data} onSelect={openAgent} onChanged={reload} />;
  } else if (route.search !== null) {
    view = <SearchResults key={route.search} query={route.search} onQuery={(q) => navigate({ tab: "hub", search: q }, { replace: true })} onSelect={openAgent} />;
  } else {
    view = (
      <HubNetwork
        agents={agents.data?.filter((a) => a.connected || a.mine)}
        error={agents.error}
        query={query}
        onQuery={setQuery}
        onSearch={(q) => navigate({ tab: "hub", search: q })}
        onSelect={openAgent}
        online={online}
        stats={agents.data && {
          connected: agents.data.filter((a) => a.connected).length,
          shared: shared.data?.length ?? 0,
          devices: devices.data?.length ?? 0,
        }}
      />
    );
  }

  return (
    <ToastProvider>
      <div className="app-shell">
        <header className="topbar">
          <a className="brand" href="/" onClick={(e) => { e.preventDefault(); navigate({ tab: "hub" }); }}>
            <span className="brand-mark"><Icon name="hub" size={20} /></span>
            <span>Agent Hub</span>
          </a>
          <nav className="tabs" aria-label="Main navigation">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className={route.tab === id ? "active" : ""} aria-current={route.tab === id ? "page" : undefined} onClick={() => navigate({ tab: id })}>
                {label}
              </button>
            ))}
          </nav>
          <div className="topbar-end">
            <a className="icon-button" href="/home" aria-label="스마트홈 앱" title="스마트홈 앱"><Icon name="phoneApp" size={20} /></a>
            <UserMenu me={me.data} />
          </div>
        </header>
        {view}
        {route.agentId && (
          <AgentSheet
            key={route.agentId}
            agentId={route.agentId}
            agents={agents.data}
            devices={devices.data}
            online={online[route.agentId]}
            initialTab={route.agentTab ?? "overview"}
            onClose={closeAgent}
            onChanged={reload}
          />
        )}
      </div>
    </ToastProvider>
  );
}
