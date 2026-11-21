// Plain-language names for what the services return as ids and codes.
// Device names come live from the Gateway (devices.yaml `name`); these are the rest.

export const SPACES = { living_room: "거실", my_room: "내 방", protected_room: "보호 방" };

export const FIELDS = {
  meeting_app_active: "회의 중인지",
  pc_state: "PC 상태",
  presence: "집에 있는지",
};

export const ROLES = { home: "Root Agent", room: "Room Agent", external: "External Agent" };
export const ORIGINS = { platform: "기본 에이전트", studio: "Studio에서 만듦", external: "외부 에이전트" };

export const SKILLS = {
  meeting_mode: "회의 모드",
  sleep_mode: "수면 모드",
  energy_saving: "절전",
  location_aware: "외출·귀가 자동화",
  temperature_monitoring: "온도 감시",
  "device.control": "기기 제어",
  "home.energy_saving": "집 전체 절전",
  "context.subscribe": "상태 구독",
  "context.query": "상태 조회",
};

const REASONS = {
  OWNERSHIP_CONFLICT: "기기마다 주인은 하나예요",
  ALREADY_CONNECTED: "이미 연결되어 있어요",
  ALREADY_REVOKED: "이미 해제된 연결이에요",
  NOT_REQUESTED: "에이전트가 요청하지 않은 권한이에요",
  UNKNOWN_AGENT: "그런 에이전트가 없어요",
  UNKNOWN_DEVICE: "집에 없는 기기예요",
  INVALID_CARD: "Agent Card를 읽을 수 없어요",
  AGENT_EXISTS: "이미 등록된 에이전트예요",
  CARD_UNAVAILABLE: "에이전트가 응답하지 않아요",
  PLATFORM_AGENT: "기본 에이전트는 삭제할 수 없고 연결만 해제할 수 있어요",
  NOT_READY: "아직 승인할 수 있는 상태가 아니에요",
  NOT_ASKING: "Studio가 질문하고 있지 않아요",
  HARNESS: "안전 검사를 통과하지 못했어요",
  HUB: "Agent Hub에 등록하지 못했어요",
  UNKNOWN_SPACE: "그런 공간이 없어요",
  EMPTY: "만들고 싶은 에이전트를 적어 주세요",
  SERVICE_DOWN: "서비스에 연결할 수 없어요",
  NO_TOKEN: "화면 서버에 토큰이 설정되지 않았어요 (.env)",
  NOT_ALLOWED: "화면에서 쓸 수 없는 요청이에요",
  LOGIN_REQUIRED: "로그인이 필요해요",
  BAD_LOGIN: "아이디나 비밀번호가 맞지 않아요",
  USERNAME_TAKEN: "이미 쓰고 있는 아이디예요",
  NOT_CREATOR: "만든 사람만 바꿀 수 있어요",
  ACCOUNT_ONLY: "계정으로 로그인해야 별을 줄 수 있어요",
};

export const agentName = (id, agents) => agents?.find((a) => a.id === id)?.name ?? id;

/** One line for an error detail ({reason_code, message, owners ...}). */
export function reasonText(detail) {
  if (!detail) return "알 수 없는 오류";
  const base = REASONS[detail.reason_code];
  if (detail.reason_code === "OWNERSHIP_CONFLICT" && detail.owners) {
    const holders = [...new Set(Object.values(detail.owners))].join(", ");
    return `${base}. 먼저 ${holders} 연결을 해제하세요.`;
  }
  if (base) return detail.message && detail.reason_code !== "NO_TOKEN" ? `${base} (${detail.message})` : base;
  return detail.message || String(detail.detail || "알 수 없는 오류");
}

/** "device:input_boolean.room1_light" -> {kind: "device", id, label}; "context:desktop.presence" too. */
export function permission(p, devices) {
  if (p.startsWith("device:")) {
    const id = p.slice(7);
    return { kind: "device", id, label: deviceName(id, devices), detail: "기기 제어" };
  }
  const [agent, field] = p.slice(8).split(".");
  return { kind: "context", id: p, label: FIELDS[field] ?? field, detail: `${agent}의 상태 읽기` };
}

/** The device kind from its entity id (icons): input_boolean.room1_light -> light. */
export function kindOf(entity = "") {
  const name = entity.split(".").pop();
  for (const kind of ["light_mode", "tv_muted", "sleep_mode", "light", "tv"]) if (name.endsWith(kind)) return kind;
  if (name.endsWith("_ac")) return "ac";
  if (name.endsWith("occupied")) return "occupancy";
  return "device";
}

export const deviceName = (entity, devices) => devices?.find((d) => d.entity === entity)?.attributes?.friendly_name ?? entity;

export function stateText(device) {
  if (!device?.state) return "";
  const s = device.state;
  return { on: "켜짐", off: "꺼짐", normal: "일반", meeting: "회의", eco: "절전" }[s] ?? s;
}

export const spaceName = (id) => SPACES[id] ?? id ?? "";

/** Short note under an agent's name: where it works and what it is. */
export function agentNote(a) {
  return [a.space ? spaceName(a.space) : null, ROLES[a.role] ?? (a.origin === "external" ? "External" : null)].filter(Boolean).join(" · ");
}

const ACTIONS = {
  register: "등록됨", connect: "연결됨", disconnect: "연결 해제", remove: "삭제됨", discover: "Agent Card로 등록",
  refresh: "카드 새로 읽음", share: "Hub에 공유", unshare: "공유 중지", signup: "가입",
};

/** "@alice" or the maker's name, for an agent's card. */
export const makerText = (a) => (a.origin === "platform" ? "우리 집 기본 에이전트" : a.created_by ? `@${a.created_by}${a.creator_name ? ` · ${a.creator_name}` : ""}` : "외부 에이전트");

export const dateText = (iso) => (iso ? iso.slice(0, 10) : "");

/** 1234 -> "1.2k" */
export const countText = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n ?? 0));
export const actionText = (a) => ACTIONS[a] ?? a;

const CODES = {
  OK: "허용",
  PARTIAL: "일부만 허용",
  UNAUTHORIZED: "권한 없음",
  NOT_OWNER: "주인이 아님",
  SAFETY_POLICY: "안전 정책으로 거절",
  FIELD_NOT_ALLOWED: "공개되지 않은 정보",
  STALE: "오래된 정보",
  PEER_UNREACHABLE: "상대가 응답 없음",
  EXECUTION_FAILED: "실행 실패",
};
export const codeText = (c) => CODES[c] ?? c ?? "";

export function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

const COMMANDS = { TURN_ON: "켜기", TURN_OFF: "끄기", ENERGY_SAVING: "절전" };

/** What a request did, in words: "내 방 조명 모드 → 회의", "내 방 조명 끄기", "집 전체 절전". */
export function actionLine(action, devices) {
  if (!action) return "상태 공유";
  if (action.macro === "energy_saving" || (action.command === "ENERGY_SAVING" && !action.device)) return "집 전체 절전";
  const name = action.device ? deviceName(action.device, devices) : "";
  if (action.command === "SET") return `${name} → ${stateText({ state: String(action.value) })}`;
  return `${name} ${COMMANDS[action.command] ?? action.command ?? ""}`.trim();
}
