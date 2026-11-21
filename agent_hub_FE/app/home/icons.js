// Line icons for the smart home app (24x24, stroke only). Spaces and device kinds map to one each.

const PATHS = {
  home: "M4 11.5 12 5l8 6.5M6.5 9.8V19h4v-5h3v5h4V9.8",
  bell: "M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5l1.5-1.5ZM10 20.5h4",
  chevron: "m10 7 5 5-5 5",
  back: "m14 7-5 5 5 5",
  search: "M10.8 17a6.2 6.2 0 1 0 0-12.4 6.2 6.2 0 0 0 0 12.4Zm4.6-1.6 4 4",
  plus: "M12 6v12M6 12h12",
  grid: "M5 5h5.5v5.5H5zM13.5 5H19v5.5h-5.5zM5 13.5h5.5V19H5zM13.5 13.5H19V19h-5.5z",
  pulse: "M3.5 12.5h4l2.2-5 4.2 10 2.4-5h4.2",
  puzzle: "M9 4.5h3v1.8a1.7 1.7 0 1 0 3.4 0V4.5h3.1v5.1h-1.7a1.7 1.7 0 1 0 0 3.4h1.7v5.5H13v-1.7a1.7 1.7 0 1 0-3.4 0v1.7H4.5v-5.5h1.7a1.7 1.7 0 1 0 0-3.4H4.5V4.5H9Z",
  sparkle: "M12 4.5c.6 3.7 2 5.2 5.5 5.8-3.5.6-4.9 2.1-5.5 5.8-.6-3.7-2-5.2-5.5-5.8 3.5-.6 4.9-2.1 5.5-5.8ZM18 15.5c.3 1.4.8 2 2 2.2-1.2.3-1.7.8-2 2.3-.3-1.5-.8-2-2-2.3 1.2-.2 1.7-.8 2-2.2Z",
  // spaces
  sofa: "M5.5 11V8.5A2 2 0 0 1 7.5 6.5h9a2 2 0 0 1 2 2V11M4 11.5a1.5 1.5 0 0 1 3 0V14h10v-2.5a1.5 1.5 0 0 1 3 0V17H4v-5.5ZM6 17v1.5M18 17v1.5",
  desk: "M5 7h14v8.5H5zM3.5 18.5h17M9.5 15.5l-.5 3M14.5 15.5l.5 3",
  crib: "M5 6v13M19 6v13M5 10h14M5 16h14M8.5 10v6M12 10v6M15.5 10v6",
  // device kinds
  light: "M8.5 5h7l2.5 6.5H6L8.5 5ZM12 11.5v6M8.5 19.5h7",
  light_mode: "M12 3.5v2M5.6 6.1l1.4 1.4M18.4 6.1 17 7.5M9.5 17.5h5M10 20h4M12 8a4.3 4.3 0 0 0-2.5 7.8V17.5h5v-1.7A4.3 4.3 0 0 0 12 8Z",
  tv: "M4 6.5h16v10H4zM9 20h6M12 16.5V20",
  tv_muted: "M5 10h3l4-3.5v11L8 14H5v-4ZM15.5 10l4 4M19.5 10l-4 4",
  ac: "M12 4v16M5.1 8l13.8 8M5.1 16l13.8-8M10 5.5 12 7.5l2-2M10 18.5l2-2 2 2",
  user: "M12 11.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2ZM5 20a7 7 0 0 1 14 0",
  occupancy: "M12 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM5.5 19.5a6.5 6.5 0 0 1 13 0",
  sleep_mode: "M17.5 14.8A7 7 0 0 1 9.2 6.5a7 7 0 1 0 8.3 8.3Z",
  device: "M6 5h12v14H6zM10 16h4",
  // external agents
  monitor: "M4 5.5h16v10.5H4zM9 19.5h6M12 16v3.5",
  phone: "M8 3.5h8a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1ZM11 17.5h2",
  link: "M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1",
  lock: "M7 11h10v8.5H7zM9 11V8.5a3 3 0 0 1 6 0V11",
  close: "M7 7l10 10M17 7 7 17",
  check: "m5.5 12.5 4 4 9-9",
  logout: "M14 7V5.5A1.5 1.5 0 0 0 12.5 4h-6A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20h6a1.5 1.5 0 0 0 1.5-1.5V17M10 12h10m-3-3 3 3-3 3",
  share: "M12 15V4m-4 4 4-4 4 4M6 12v6.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V12",
  trash: "M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12",
  arrow: "M5 12h13m-5-5 5 5-5 5",
  phoneApp: "M8 3.5h8a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1ZM10.5 6h3",
  hub: "M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6ZM12 3v6.2M12 14.8V21M4.2 7.5l5.4 3.1M14.4 13.4l5.4 3.1M4.2 16.5l5.4-3.1M14.4 10.6l5.4-3.1",
  wand: "M5 19 15 9m0 0 2-2m-2 2-2-2m2 2 2 2M18 3.5v2M17 4.5h2M8 4v2M7 5h2M19 13v2M18 14h2",
};

export function Icon({ name, size = 22, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name] ?? PATHS.device} />
    </svg>
  );
}

export const SPACE_ICONS = { living_room: "sofa", my_room: "desk", protected_room: "crib" };

/** An icon for an external agent, from what it shares. */
export function agentIcon(agent) {
  if (agent.origin === "studio") return "sparkle";
  if (agent.provided_fields?.includes("presence")) return "phone";
  if (agent.provided_fields?.includes("pc_state")) return "monitor";
  if (agent.role === "external" || agent.origin === "external") return "link";
  return SPACE_ICONS[agent.space] ?? "home";
}
