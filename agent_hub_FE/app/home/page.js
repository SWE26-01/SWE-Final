"use client";

// The home's own app: spaces, devices and the agents that run them, in one phone screen.
// Same live data as the Hub screen, through the same server-side proxy. Devices are read only here:
// only a device's owning agent commands it (the Gateway checks), so the app shows the state and
// decides who the owner is, by connecting agents in the Hub.
import { useEffect, useMemo, useState } from "react";
import { logout, useApi } from "../../lib/api.js";
import { FIELDS, ORIGINS, actionLine, agentName, agentNote, codeText, countText, makerText, spaceName, timeAgo } from "../../lib/labels.js";
import { ConnectPanel, ShareToggle } from "../components/AgentDetail.js";
import { StarButton } from "../components/SearchResults.js";
import { Notice, Status } from "../components/ui.js";
import { Icon, SPACE_ICONS, agentIcon } from "./icons.js";

const POLL = 4000;
const SEEN_KEY = "smarthome.seen-flow";

// The home's own agents by the names people use for them; other agents keep their card name.
const HOME_NAMES = { orchestrator: "집 에이전트", room1: "내 방 에이전트", room2: "보호 방 에이전트", desktop: "PC", smartphone: "스마트폰" };
const nameOf = (id, agents) => HOME_NAMES[id] ?? agentName(id, agents);

/** A device's state in words, by what it is. */
function stateOf(kind, state) {
  if (state === undefined || state === null) return { text: "알 수 없음", on: false };
  if (kind === "light_mode") return { text: { normal: "일반", meeting: "회의", eco: "절전" }[state] ?? state, on: state !== "normal" };
  const on = state === "on";
  const words = { occupancy: ["사람 있음", "비어 있음"], tv_muted: ["음소거", "소리 켬"] }[kind] ?? ["켜짐", "꺼짐"];
  return { text: on ? words[0] : words[1], on };
}

function readSeen() {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(value) {
  try {
    window.localStorage.setItem(SEEN_KEY, value);
  } catch {
    // private window: the badge just shows again
  }
}

function Clock() {
  const [now, setNow] = useState("9:41");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit", hour12: false }));
    tick();
    const t = window.setInterval(tick, 20000);
    return () => window.clearInterval(t);
  }, []);
  return <span>{now}</span>;
}

function StatusBar() {
  return (
    <div className="sh-statusbar" aria-hidden="true">
      <Clock />
      <span className="sh-island" />
      <span className="sh-signal">
        <svg viewBox="0 0 18 12" width="18" height="12"><path d="M1 11h2V8H1zM5 11h2V6H5zM9 11h2V4H9zM13 11h2V1h-2z" fill="currentColor" /></svg>
        <svg viewBox="0 0 16 12" width="16" height="12"><path d="M8 10.5 9.6 8.8a2.3 2.3 0 0 0-3.2 0L8 10.5ZM4.6 7a4.8 4.8 0 0 1 6.8 0l1.4-1.4a6.8 6.8 0 0 0-9.6 0L4.6 7ZM1.8 4.2a8.8 8.8 0 0 1 12.4 0l1.4-1.4a10.8 10.8 0 0 0-15.2 0l1.4 1.4Z" fill="currentColor" /></svg>
        <i className="sh-battery" />
      </span>
    </div>
  );
}

function Row({ icon, title, sub, right, onClick, tone }) {
  return (
    <button type="button" className={`sh-row ${tone ?? ""}`} onClick={onClick}>
      <span className="sh-row-icon"><Icon name={icon} /></span>
      <span className="sh-row-text"><strong>{title}</strong>{sub && <small>{sub}</small>}</span>
      {right}
      <Icon name="chevron" size={18} className="sh-chevron" />
    </button>
  );
}

function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="sh-sheet-backdrop" role="presentation" onClick={onClose}>
      <section className="sh-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className="sh-grabber" aria-hidden="true" />
        <header className="sh-sheet-head">
          <strong>{title}</strong>
          <button type="button" onClick={onClose} aria-label="닫기">×</button>
        </header>
        {children}
      </section>
    </div>
  );
}

function DeviceRow({ device, home, onClick }) {
  const s = stateOf(device.kind, device.state);
  const owner = device.owner ? nameOf(device.owner, home.agents) : null;
  return (
    <button type="button" className={`sh-device ${s.on ? "is-on" : ""}`} onClick={onClick}>
      <span className="sh-device-icon"><Icon name={device.kind} /></span>
      <span className="sh-row-text">
        <strong>{device.name}</strong>
        <small className={owner ? "" : "is-warn"}>{owner ? `관리: ${owner}` : "관리하는 에이전트 없음"}</small>
      </span>
      <span className="sh-pill">{s.text}</span>
    </button>
  );
}

function AgentRow({ agent, online, onClick, sub }) {
  return (
    <Row
      icon={agentIcon(agent)}
      title={nameOf(agent.id, [agent])}
      sub={sub ?? (agentNote(agent) || ORIGINS[agent.origin])}
      onClick={onClick}
      right={agent.connected ? <Status online={online} /> : <span className="sh-pill is-muted">미연결</span>}
    />
  );
}

// --- screens ---------------------------------------------------------------------------------

function SearchBox({ value, onChange, onSubmit, autoFocus }) {
  return (
    <form className="sh-search" role="search" onSubmit={(e) => { e.preventDefault(); onSubmit?.(value); }}>
      <Icon name="search" size={18} />
      <label className="sr-only" htmlFor="sh-search-input">기기 또는 서비스 검색</label>
      <input id="sh-search-input" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder="기기 또는 서비스 검색" autoFocus={autoFocus} enterKeyHint="search" />
      {value && <button type="button" className="sh-search-clear" onClick={() => onChange("")} aria-label="지우기">×</button>}
    </form>
  );
}

function SpacesTab({ home, open, onSearch }) {
  const [q, setQ] = useState("");
  const external = home.agents.filter((a) => a.role === "external" || a.origin === "external");
  return (
    <>
      <section className="sh-card" aria-label="공간">
        {home.spaces.map((space) => {
          const on = space.devices.filter((d) => stateOf(d.kind, d.state).on).length;
          return (
            <Row
              key={space.id}
              icon={SPACE_ICONS[space.id] ?? "home"}
              title={spaceName(space.id)}
              sub={`${space.devices.length}개 기기${on ? ` · ${on}개 켜짐` : ""}`}
              onClick={() => open({ space: space.id })}
            />
          );
        })}
      </section>

      <section className="sh-card sh-external" aria-label="외부 기기 연결">
        <button type="button" className="sh-card-title" onClick={() => open({ tab: "ext" })}>
          <Icon name="puzzle" /> <strong>외부 기기 연결</strong> <Icon name="chevron" size={18} className="sh-chevron" />
        </button>
        <SearchBox value={q} onChange={setQ} onSubmit={(v) => v.trim() && onSearch(v)} />
        <div className="sh-chips">
          {external.map((a) => (
            <button type="button" key={a.id} className="sh-chip" onClick={() => open({ agent: a.id })}>
              <span className={`sh-chip-icon ${a.connected ? "is-on" : ""}`}><Icon name={agentIcon(a)} /></span>
              <small>{nameOf(a.id, [a])}</small>
            </button>
          ))}
          <a className="sh-chip" href="/?view=search">
            <span className="sh-chip-icon is-add"><Icon name="plus" /></span>
            <small>더보기</small>
          </a>
        </div>
      </section>
    </>
  );
}

function DevicesTab({ home, open }) {
  return home.spaces.map((space) => (
    <section key={space.id} className="sh-group" aria-label={spaceName(space.id)}>
      <h2>{spaceName(space.id)}</h2>
      <div className="sh-card">
        {space.devices.map((d) => <DeviceRow key={d.entity} device={d} home={home} onClick={() => open({ device: d.entity })} />)}
      </div>
    </section>
  ));
}

/** The Hub's search (GET /agents?q=: id, name, description), plus the home agents' Korean names. */
function SearchResults({ home, query, open }) {
  const [term, setTerm] = useState(query.trim());
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);
  const { data, error } = useApi(term ? `hub/agents?q=${encodeURIComponent(term)}` : null);
  const lower = term.toLowerCase();
  const results = [
    ...(data ?? []),
    ...home.agents.filter((a) => HOME_NAMES[a.id]?.toLowerCase().includes(lower) && !data?.some((d) => d.id === a.id)),
  ];
  return (
    <section className="sh-group" aria-label="검색 결과">
      <h2>{!data && !error ? "Hub에서 찾는 중…" : `“${term}” 검색 결과 · ${results.length}`}</h2>
      <Notice error={error} />
      <div className="sh-card">
        {data && results.length === 0 && <p className="sh-empty">맞는 에이전트가 없어요. Agent Studio에서 직접 만들거나 Agent Card URL로 추가할 수 있어요.</p>}
        {results.map((a) => (
          <AgentRow key={a.id} agent={a} online={home.online[a.id]} sub={a.description || agentNote(a) || ORIGINS[a.origin]} onClick={() => open({ agent: a.id })} />
        ))}
      </div>
    </section>
  );
}

function ConnectTab({ home, open, query, onQuery }) {
  const used = home.agents.filter((a) => a.connected);
  const rest = home.agents.filter((a) => !a.connected);
  return (
    <>
      <SearchBox value={query} onChange={onQuery} />
      {query.trim() ? <SearchResults home={home} query={query} open={open} /> : (
      <>
      <section className="sh-group">
        <h2>사용 중 · {used.length}</h2>
        <div className="sh-card">
          {used.length === 0 && <p className="sh-empty">연결된 에이전트가 없어요.</p>}
          {used.map((a) => <AgentRow key={a.id} agent={a} online={home.online[a.id]} onClick={() => open({ agent: a.id })} />)}
        </div>
      </section>
      {rest.length > 0 && (
        <section className="sh-group">
          <h2>추가할 수 있어요</h2>
          <div className="sh-card">
            {rest.map((a) => <AgentRow key={a.id} agent={a} online={home.online[a.id]} onClick={() => open({ agent: a.id })} />)}
          </div>
        </section>
      )}
      </>
      )}
      <div className="sh-actions">
        <a className="sh-cta" href="/?tab=agent-studio"><Icon name="sparkle" /> Agent Studio에서 새로 만들기</a>
        <a className="sh-cta is-ghost" href="/?view=search"><Icon name="grid" /> Agent Hub 카탈로그 둘러보기</a>
      </div>
    </>
  );
}

function SpaceScreen({ home, spaceId, open, onBack }) {
  const space = home.spaces.find((s) => s.id === spaceId);
  if (!space) return null;
  const on = space.devices.filter((d) => stateOf(d.kind, d.state).on).length;
  const agents = home.agents.filter((a) => a.space === spaceId);
  return (
    <>
      <header className="sh-subhead">
        <button type="button" onClick={onBack} aria-label="뒤로"><Icon name="back" /></button>
        <h1>{spaceName(spaceId)}</h1>
        <span />
      </header>
      <section className="sh-hero">
        <span className="sh-hero-icon"><Icon name={SPACE_ICONS[spaceId] ?? "home"} size={30} /></span>
        <div>
          <strong>기기 {space.devices.length}개 · {on}개 켜짐</strong>
          <small>기기는 주인 에이전트만 움직일 수 있어요.</small>
        </div>
      </section>
      <section className="sh-group">
        <h2>기기</h2>
        <div className="sh-card">
          {space.devices.map((d) => <DeviceRow key={d.entity} device={d} home={home} onClick={() => open({ device: d.entity })} />)}
        </div>
      </section>
      <section className="sh-group">
        <h2>이 공간의 에이전트</h2>
        <div className="sh-card">
          {agents.length === 0 && <p className="sh-empty">이 공간에서 일하는 에이전트가 없어요.</p>}
          {agents.map((a) => <AgentRow key={a.id} agent={a} online={home.online[a.id]} onClick={() => open({ agent: a.id })} />)}
        </div>
      </section>
    </>
  );
}

function ActivityScreen({ home, flows, error }) {
  return (
    <>
      <header className="sh-subhead">
        <span />
        <h1>활동</h1>
        <span />
      </header>
      <p className="sh-lead">에이전트가 기기와 서로에게 보낸 요청이에요. 거절된 요청도 그대로 남아요.</p>
      <Notice error={error} />
      <div className="sh-card">
        {flows?.length === 0 && <p className="sh-empty">아직 요청이 없어요.</p>}
        {(flows ?? []).map((f) => (
          <div key={f.flow} className={`sh-flow ${f.accepted === false ? "is-rejected" : ""}`}>
            <span className="sh-flow-dot" />
            <span className="sh-row-text">
              <strong>{actionLine(f.action, home.devices)}</strong>
              <small>
                {f.requester && f.requester === f.entry ? `${nameOf(f.entry, home.agents)} 자동화` : `${nameOf(f.requester, home.agents) ?? "?"} → ${nameOf(f.entry, home.agents) ?? "?"}`}
                {" · "}{timeAgo(f.ended_at)}
              </small>
            </span>
            {f.accepted !== null && <span className={`sh-pill ${f.accepted ? "" : "is-muted"}`}>{codeText(f.reason_code) || (f.accepted ? "허용" : "거절")}</span>}
          </div>
        ))}
      </div>
    </>
  );
}

// --- sheets ----------------------------------------------------------------------------------

function DeviceSheet({ home, entity, open, onClose }) {
  const device = home.spaces.flatMap((s) => s.devices).find((d) => d.entity === entity);
  if (!device) return null;
  const s = stateOf(device.kind, device.state);
  const owner = home.agents.find((a) => a.id === device.owner);
  const others = home.agents.filter((a) => a.id !== device.owner && (a.permissions.includes(`device:${entity}`) || a.owned_devices.includes(entity)));
  return (
    <Sheet title={device.name} onClose={onClose}>
      <div className={`sh-device-hero ${s.on ? "is-on" : ""}`}>
        <span className="sh-device-icon"><Icon name={device.kind} size={30} /></span>
        <div>
          <strong>{s.text}</strong>
          <small>{spaceName(device.space)} · {device.last_changed ? `${timeAgo(device.last_changed)} 바뀜` : ""}</small>
        </div>
      </div>
      <h3 className="sh-sheet-label">관리하는 에이전트</h3>
      <div className="sh-card">
        {owner
          ? <AgentRow agent={owner} online={home.online[owner.id]} onClick={() => open({ agent: owner.id })} />
          : <p className="sh-empty is-warn">지금은 아무 에이전트도 이 기기를 움직일 수 없어요. 아래 에이전트를 연결하세요.</p>}
      </div>
      {others.length > 0 && (
        <>
          <h3 className="sh-sheet-label">이 기기를 맡을 수 있는 에이전트</h3>
          <div className="sh-card">
            {others.map((a) => <AgentRow key={a.id} agent={a} online={home.online[a.id]} onClick={() => open({ agent: a.id })} />)}
          </div>
        </>
      )}
      <p className="sh-note"><Icon name="lock" size={16} /> 기기마다 주인 에이전트는 하나예요. 명령은 주인만 보낼 수 있고, Gateway가 매번 확인해요.</p>
    </Sheet>
  );
}

function AgentSheet({ home, agentId, onChanged, onClose }) {
  const { data: agent, error, reload } = useApi(`hub/agents/${agentId}`, { interval: POLL });
  const name = nameOf(agentId, agent ? [agent] : home.agents);
  return (
    <Sheet title={name} onClose={onClose}>
      <Notice error={error} />
      {agent && (
        <>
          <div className="sh-agent-hero">
            <span className={`sh-chip-icon ${agent.connected ? "is-on" : ""}`}><Icon name={agentIcon(agent)} /></span>
            <div>
              <strong>{agentNote(agent) || ORIGINS[agent.origin]}</strong>
              <small>{ORIGINS[agent.origin]}{agent.connected ? " · 연결됨" : " · 미연결"}</small>
            </div>
            <Status online={agent.connected ? home.online[agent.id] : undefined} />
          </div>
          {agent.description && <p className="sh-lead">{agent.description}</p>}
          <div className="sh-maker">
            <span>{makerText(agent)}<small>설치 {countText(agent.installs)}</small></span>
            <StarButton agent={agent} onChanged={() => { reload(); onChanged(); }} />
          </div>
          {(agent.owned_devices.length > 0 || agent.provided_fields.length > 0) && (
            <div className="sh-tags">
              {agent.owned_devices.map((d) => <span key={d}>{home.devices?.find((x) => x.entity === d)?.attributes?.friendly_name ?? d}</span>)}
              {agent.provided_fields.map((f) => <span key={f}>공유: {FIELDS[f] ?? f}</span>)}
            </div>
          )}
          <div className="sh-connect"><ShareToggle agent={agent} onChanged={() => { reload(); onChanged(); }} /></div>
          {!agent.removed && (
            <div className="sh-connect">
              <ConnectPanel
                agent={agent}
                devices={home.devices}
                agents={home.agents}
                onChanged={() => {
                  reload();
                  onChanged();
                }}
              />
            </div>
          )}
          <a className="sh-link" href={`/?agent=${encodeURIComponent(agent.id)}`}>Agent Hub에서 자세히 보기 →</a>
        </>
      )}
    </Sheet>
  );
}

function ProfileScreen({ home, me, open }) {
  const made = home.agents.filter((a) => a.mine);
  const stars = made.reduce((n, a) => n + a.stars, 0);
  return (
    <>
      <header className="sh-subhead">
        <span />
        <h1>내 정보</h1>
        <span />
      </header>
      <section className="sh-profile">
        <span className="sh-avatar" aria-hidden="true">{(me?.name ?? "?").slice(0, 1)}</span>
        <div>
          <strong>{me?.name ?? "…"}</strong>
          <small>@{me?.id}</small>
        </div>
      </section>
      <div className="sh-stats">
        <div><strong>{made.length}</strong><small>만든 에이전트</small></div>
        <div><strong>{made.filter((a) => a.shared).length}</strong><small>공유 중</small></div>
        <div><strong>{countText(stars)}</strong><small>받은 별</small></div>
      </div>
      <section className="sh-group">
        <h2>내가 만든 에이전트</h2>
        <div className="sh-card">
          {made.length === 0 && <p className="sh-empty">아직 없어요. Agent Studio에서 만들고 Hub에 공유해 보세요.</p>}
          {made.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              online={home.online[a.id]}
              sub={a.shared ? `공유 중 · ★ ${a.stars} · 설치 ${a.installs}` : "나만 보기"}
              onClick={() => open({ agent: a.id })}
            />
          ))}
        </div>
      </section>
      <div className="sh-actions">
        <a className="sh-cta" href="/?tab=agent-studio"><Icon name="sparkle" /> Agent Studio에서 만들기</a>
        <a className="sh-cta is-ghost" href="/?view=search"><Icon name="grid" /> Agent Hub 카탈로그</a>
        <button type="button" className="sh-cta is-ghost is-quiet" onClick={logout}>로그아웃</button>
      </div>
    </>
  );
}

// --- app -------------------------------------------------------------------------------------

const TABS = [
  ["space", "공간"],
  ["device", "기기"],
  ["ext", "외부 연결"],
];

export default function SmartHome() {
  const spaces = useApi("hub/spaces", { interval: POLL });
  const devices = useApi("gateway/devices", { interval: POLL });
  const agents = useApi("hub/agents", { interval: POLL });
  const statuses = useApi("collector/agents", { interval: POLL });
  const flows = useApi("collector/flows?limit=30", { interval: POLL });
  const me = useApi("auth/me"); // also sends a logged-out visitor to /login

  const [screen, setScreen] = useState("home"); // home | activity | profile
  const [tab, setTab] = useState("space");
  const [spaceId, setSpaceId] = useState(null);
  const [query, setQuery] = useState(""); // search in 외부 연결
  const [sheet, setSheet] = useState(null); // {agent} | {device}
  const [seen, setSeen] = useState(null);
  useEffect(() => setSeen(readSeen()), []);

  // Hub spaces (who owns each device now) joined with the Gateway's device states and names.
  const home = useMemo(() => {
    const byEntity = Object.fromEntries((devices.data ?? []).map((d) => [d.entity, d]));
    return {
      agents: agents.data ?? [],
      devices: devices.data,
      online: Object.fromEntries((statuses.data ?? []).map((s) => [s.id, s.online])),
      spaces: (spaces.data ?? []).map((s) => ({
        id: s.id,
        devices: s.devices.map((d) => ({
          ...d,
          space: s.id,
          name: byEntity[d.entity]?.attributes?.friendly_name ?? d.entity,
          state: byEntity[d.entity]?.state,
          last_changed: byEntity[d.entity]?.last_changed,
        })),
      })),
    };
  }, [agents.data, devices.data, spaces.data, statuses.data]);

  const latest = flows.data?.[0]?.ended_at ?? null;
  const unseen = Boolean(latest && latest !== seen);
  const allDevices = home.spaces.flatMap((s) => s.devices);
  const onCount = allDevices.filter((d) => stateOf(d.kind, d.state).on).length;
  const connected = home.agents.filter((a) => a.connected).length;

  const open = (to) => {
    if (to.space) {
      setScreen("home");
      setSpaceId(to.space);
    } else if (to.tab) {
      setTab(to.tab);
    } else {
      setSheet(to);
    }
  };
  const goActivity = () => {
    setScreen("activity");
    setSpaceId(null);
    if (latest) {
      writeSeen(latest);
      setSeen(latest);
    }
  };
  const reloadAll = () => {
    agents.reload();
    spaces.reload();
  };
  const error = spaces.error ?? devices.error ?? agents.error;
  const loading = !spaces.data && !error;

  let body;
  if (screen === "activity") {
    body = <ActivityScreen home={home} flows={flows.data} error={flows.error} />;
  } else if (screen === "profile") {
    body = <ProfileScreen home={home} me={me.data} open={open} />;
  } else if (spaceId) {
    body = <SpaceScreen home={home} spaceId={spaceId} open={open} onBack={() => setSpaceId(null)} />;
  } else {
    body = (
      <>
        <header className="sh-head">
          <Icon name="home" size={30} />
          <h1>스마트홈</h1>
          <button type="button" className="sh-bell" onClick={goActivity} aria-label={unseen ? "새 활동 있음" : "활동"}>
            <Icon name="bell" size={26} />
            {unseen && <i />}
          </button>
        </header>
        <p className="sh-summary">에이전트 {connected}개 연결 · 기기 {allDevices.length}개 중 {onCount}개 켜짐</p>
        <div className="sh-segment" role="tablist" aria-label="보기">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        <Notice error={error} />
        {loading && <p className="sh-empty">불러오는 중…</p>}
        {!loading && tab === "space" && <SpacesTab home={home} open={open} onSearch={(q) => { setQuery(q); setTab("ext"); }} />}
        {!loading && tab === "device" && <DevicesTab home={home} open={open} />}
        {!loading && tab === "ext" && <ConnectTab home={home} open={open} query={query} onQuery={setQuery} />}
      </>
    );
  }

  return (
    <div className="sh-stage">
      <div className="sh-phone">
        <StatusBar />
        <main className={`sh-screen ${screen === "home" && !spaceId ? "is-home" : ""}`}>{body}</main>
        <div className="sh-tabbar" role="navigation" aria-label="앱 메뉴">
          <button type="button" className={screen === "home" ? "active" : ""} onClick={() => { setScreen("home"); setSpaceId(null); }} aria-label="홈">
            <Icon name="home" size={26} />
          </button>
          <a href="/?view=search" aria-label="Agent Hub 카탈로그"><Icon name="grid" size={26} /></a>
          <button type="button" className={screen === "profile" ? "active" : ""} onClick={() => { setScreen("profile"); setSpaceId(null); }} aria-label="내 정보">
            <Icon name="user" size={26} />
          </button>
        </div>
        {sheet?.agent && <AgentSheet key={sheet.agent} home={home} agentId={sheet.agent} onChanged={reloadAll} onClose={() => setSheet(null)} />}
        {sheet?.device && <DeviceSheet home={home} entity={sheet.device} open={open} onClose={() => setSheet(null)} />}
      </div>
      <aside className="sh-caption">
        <strong>Smart Home</strong>
        <span>Agent Hub와 같은 집, 같은 에이전트. 기기 상태와 주인은 실시간이에요.</span>
        <a href="/">Agent Hub 열기 →</a>
      </aside>
    </div>
  );
}
