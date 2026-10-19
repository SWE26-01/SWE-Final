// Turns live data into the shapes the screens already use (rooms/devices, log rows, timeline items).
// Mapping and wording follow docs/frontend-integration.md section 4.
import { LIVE_ROOMS } from './housePlan';

// Home Assistant entity -> screen room/device of the real house (live/housePlan.js).
export const DEVICE_MAP = Object.fromEntries(LIVE_ROOMS.flatMap((room) => room.devices.map((device) => [device.entity, { roomId: room.id, deviceId: device.id }])));
// Entities shown as an extra on another device or room instead of a device of their own.
const TV_MUTED = 'input_boolean.living_tv_muted';
const LIGHT_MODE = 'input_select.room1_light_mode';
const OCCUPIED = 'input_boolean.room1_occupied';
const SLEEP_MODE = 'input_boolean.room2_sleep_mode';

export const AGENTS = {
  desktop: { name: 'Desktop Agent', color: 'purple' },
  smartphone: { name: 'Mobile Agent', color: '' },
  orchestrator: { name: 'Home Agent', color: 'green' },
  room1: { name: 'My Room Agent', color: 'action' },
  room2: { name: '보호 방 Agent', color: 'verify' },
};
export const agentName = (id) => AGENTS[id]?.name || (id === '?' ? '알 수 없는 호출자' : id || '-');
export const agentColor = (id) => AGENTS[id]?.color ?? 'predict';

const VALUE_TEXT = { normal: '일반', meeting: '회의 모드', eco: '절전' };
const COMMAND_TEXT = { TURN_ON: '켜기', TURN_OFF: '끄기' };
const TYPE_TEXT = {
  'context.update': '상태 공유',
  'context.query': '상태 조회',
  'context.subscribe': '구독 신청',
  'context.unsubscribe': '구독 해지',
};
export const REASON_TEXT = {
  OK: '수락',
  PARTIAL: '일부만 수락',
  UNAUTHORIZED: '권한 없음',
  FIELD_NOT_ALLOWED: '공개 안 된 항목 제외',
  STALE: '오래된 정보',
  NOT_OWNER: '담당 기기 아님',
  SAFETY_POLICY: '안전 정책',
  PEER_UNREACHABLE: '상대 응답 없음',
  EXECUTION_FAILED: '실행 실패',
  BAD_REQUEST: '잘못된 요청',
  UNKNOWN_PEER: '모르는 상대',
};
const RULE_TEXT = {
  'meeting_app_active=true': '회의 시작 감지',
  'meeting_app_active=false': '회의 종료 감지',
  'presence="AWAY"': '외출 감지',
  'presence="HOME"': '귀가 감지',
};

export const timeOf = (ts) => {
  const date = new Date(ts);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
};
const valueText = (value) => VALUE_TEXT[value] || String(value);

export function deviceName(entity, devices) {
  return devices[entity]?.attributes?.friendly_name || entity || '';
}

export function actionText(action, devices) {
  if (!action) return '';
  if (action.command === 'ENERGY_SAVING' || action.macro === 'energy_saving') return '집 전체 절전';
  const name = deviceName(action.device, devices);
  if (action.command === 'SET') return `${name} → ${valueText(action.value)}`;
  return `${name} ${COMMAND_TEXT[action.command] || action.command || ''}`.trim();
}

export function resultText(accepted, reasonCode) {
  if (reasonCode && reasonCode !== 'OK') return REASON_TEXT[reasonCode] || reasonCode;
  if (accepted === true) return '수락';
  if (accepted === false) return '거절';
  return '';
}

function requestText(event, devices) {
  // Older agents logged unreachable-peer lines without the action.
  if (event.type === 'device.control') return actionText(event.action, devices) || '기기 제어';
  const base = TYPE_TEXT[event.type] || event.type || '';
  return event.fields?.length ? `${base} (${event.fields.join(', ')})` : base;
}

/** A2A log row from a received message (`in`): the receiver's line carries the result. */
export function toLogRow(event, devices) {
  const result = resultText(event.accepted, event.reason_code);
  return {
    key: event.id,
    time: timeOf(event.ts),
    from: agentName(event.from),
    to: agentName(event.agent),
    color: agentColor(event.from),
    text: [requestText(event, devices), result].filter(Boolean).join(' · '),
    accepted: event.accepted,
  };
}

/** Timeline item from an execution (`exec`) or a fired automation rule (`rule`). */
export function toActivity(event, devices) {
  const result = resultText(event.accepted, event.reason_code);
  if (event.dir === 'rule') {
    return {
      key: event.id,
      time: timeOf(event.ts),
      agent: agentName(event.agent),
      title: `자동화 규칙 · ${RULE_TEXT[event.rule] || event.rule}`,
      detail: `${agentName(event.agent)} → ${actionText(event.action, devices)}${result ? ` · ${result}` : ''}`,
      tag: 'RULE',
      tone: 'sensor',
    };
  }
  return {
    key: event.id,
    time: timeOf(event.ts),
    agent: agentName(event.agent),
    title: actionText(event.action, devices),
    detail: `${agentName(event.agent)} · ${result}${event.reason_code && event.reason_code !== 'OK' && event.message ? ` (${event.message})` : ''}`,
    tag: event.accepted ? 'ACTION' : 'REJECT',
    tone: event.accepted ? 'action' : 'predict',
  };
}

/** Card for one request followed across agents (GET /flows item). */
export function toFlowCard(flow, devices) {
  const path = [flow.requester, flow.entry, ...flow.agents]
    .filter((id, index, all) => id && all.indexOf(id) === index)
    .map((id) => agentName(id).replace(' Agent', ''));
  return {
    key: flow.flow,
    time: timeOf(flow.started_at),
    title: actionText(flow.action, devices) || '요청',
    path,
    result: resultText(flow.accepted, flow.reason_code),
    accepted: flow.accepted,
    events: flow.events,
  };
}

const ON_OFF_TEXT = { on: '켜짐', off: '꺼짐' };
const powerText = (state) => ON_OFF_TEXT[state] || '상태 없음';
const stateText = (state) => ON_OFF_TEXT[state] || valueText(state); // on/off, or an option like meeting

/** The real house's rooms (live/housePlan.js) with live device states. No temperature sensors: temp is null. */
export function liveRooms(devices, online) {
  const state = (entity) => devices[entity]?.state;
  return LIVE_ROOMS.map((room) => {
    const extras = [];
    if (room.id === 'protected' && state(SLEEP_MODE)) extras.push(`수면 모드 ${powerText(state(SLEEP_MODE))}`);
    if (room.id === 'myroom' && state(OCCUPIED)) extras.push(state(OCCUPIED) === 'on' ? '재실' : '비어 있음');
    return {
      ...room,
      temp: null,
      humidity: null,
      description: extras.length ? `${room.description} · ${extras.join(' · ')}` : room.description,
      devices: room.devices.map((device) => {
        const value = state(device.entity);
        const connected = online && value != null;
        let text = connected ? powerText(value) : '연결 안 됨';
        if (connected && device.entity === 'input_boolean.living_tv' && state(TV_MUTED) === 'on') text += ' · 음소거';
        if (connected && device.entity === 'input_boolean.room1_light' && state(LIGHT_MODE)) text += ` · ${valueText(state(LIGHT_MODE))}`;
        return { ...device, on: connected && value === 'on', connected, value: text };
      }),
    };
  });
}

/** Room the occupant marker should show (My Room is occupied), or null. */
export function liveOccupantRoom(devices) {
  return devices[OCCUPIED]?.state === 'on' ? 'myroom' : null;
}

/** The 3D view's environment card in LIVE: real states (the house has no temperature sensors). */
export function liveEnvironmentCard(devices, room) {
  const state = (entity) => devices[entity]?.state;
  return {
    label: room ? room.name : '평균',
    rows: [
      { icon: 'presence', text: state(OCCUPIED) === 'on' ? '내 방 재실' : '내 방 비어 있음' },
      { icon: 'light', text: `내 방 조명 · ${state(LIGHT_MODE) ? valueText(state(LIGHT_MODE)) : '—'}` },
      { icon: 'sleep', text: `보호 방 수면 모드 ${powerText(state(SLEEP_MODE))}` },
    ],
  };
}

const ROLE_TEXT = { external: '외부 기기', home: '공용 공간', room: '방' };
const SPACE_TEXT = { living_room: '거실', my_room: '내 방', protected_room: '보호 방' };

/** Agent card from a Collector agent status (GET /agents item). */
export function toAgentCard(status) {
  const where = [ROLE_TEXT[status.role], SPACE_TEXT[status.space]].filter(Boolean).join(' · ');
  const last = status.last_event_at ? `마지막 활동 ${timeOf(status.last_event_at)}` : '활동 기록 없음';
  return {
    id: status.id,
    name: agentName(status.id),
    online: status.online,
    checked: Boolean(status.checked_at),
    detail: [where, last].filter(Boolean).join(' · '),
  };
}

// --- Live Simulation runs (services/runner) -----------------------------------------------------

const RUN_LEAD_MS = 1000; // only for events without received_at (older Collector): agent clocks may differ
const RUN_TAIL_MS = 5000; // automation rules fire just after the reply that triggered them

/**
 * Collector events that arrived during a run. Context updates carry no request_id, so this goes by
 * time: the Collector's `received_at`, which shares the Runner's clock (both run in services/),
 * not the agent's `ts`, which comes from the host and can drift from the Docker VM's clock.
 * Shown in the order things happened (`ts`).
 */
export function eventsOfRun(events, run) {
  if (!run) return [];
  const start = Date.parse(run.started_at);
  const end = run.ended_at ? Date.parse(run.ended_at) + RUN_TAIL_MS : Infinity;
  return events
    .filter((event) => {
      const at = event.received_at ? Date.parse(event.received_at) : Date.parse(event.ts) + RUN_LEAD_MS;
      return at >= start && at <= end;
    })
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id - b.id));
}

/** A2A log row for a run: answered messages, plus messages that never reached their peer. */
export function toRunLogRow(event, devices) {
  if (event.dir === 'in') return toLogRow(event, devices);
  return {
    key: event.id,
    time: timeOf(event.ts),
    from: agentName(event.agent),
    to: agentName(event.to),
    color: agentColor(event.agent),
    text: [requestText(event, devices), REASON_TEXT.PEER_UNREACHABLE].filter(Boolean).join(' · '),
    accepted: false,
  };
}

export const isRunLogEvent = (event) => event.dir === 'in' || event.dir === 'out-error';

const STEP_TEXT = { pending: '대기', running: '답변 기다리는 중', done: '답변', failed: '실패', skipped: '건너뜀' };
export const stepText = (status) => STEP_TEXT[status] || status;

/** Phase badge for a run: READY, SETUP (preparing), LLM (waiting for an answer), DONE, FAILED. */
export function runPhase(run) {
  if (!run) return { label: 'READY', tone: '' };
  if (run.status === 'done') return { label: 'DONE', tone: 'verify' };
  if (run.status === 'failed') return { label: 'FAILED', tone: 'failed' };
  const step = run.steps.find((item) => item.status === 'running');
  return step?.setup ? { label: 'SETUP', tone: 'sensor' } : { label: 'LLM', tone: 'predict' };
}

/**
 * Expected device states of a scenario next to the live ones. Only a device that got there during
 * the run counts: `reached`. Otherwise `already` (it was like that before the run, so the run proved
 * nothing), `pending` (not yet, the run is still going) or `missed`. HA's `last_changed` and the
 * Runner's `started_at` share the Docker VM's clock.
 */
export function expectRows(expect, devices, run) {
  const started = run ? Date.parse(run.started_at) : NaN;
  return Object.entries(expect || {}).map(([entity, want]) => {
    const device = devices[entity];
    const got = device?.state ?? null;
    let status;
    if (got === want) status = Date.parse(device.last_changed) >= started ? 'reached' : 'already';
    else status = run?.status === 'running' ? 'pending' : 'missed';
    return { entity, name: deviceName(entity, devices), want: stateText(want), got: got == null ? '알 수 없음' : stateText(got), status };
  });
}

// Agent nodes drawn on the Home tab, by label.
export const NODE_AGENT = { Home: 'orchestrator', 'My Room': 'room1', Desktop: 'desktop', Mobile: 'smartphone' };

export const socketLabel = (status) => ({ open: 'CONNECTED', connecting: 'CONNECTING', closed: 'RECONNECTING', off: 'OFF' }[status] || status);

// --- Agent console (Agents tab) -----------------------------------------------------------------

export const AGENT_ORDER = ['desktop', 'smartphone', 'orchestrator', 'room1', 'room2'];

export const AGENT_ROLE = {
  desktop: 'PC에서 회의 중인지 알려 주고, Home에 집중 환경을 부탁해요',
  smartphone: '외출·귀가를 알려 주고, Home에 집 전체 절전을 부탁해요',
  orchestrator: '거실 기기를 맡고, 방 기기 요청은 그 방에 넘겨 결과를 모아요',
  room1: '내 방 기기를 맡아요. 회의가 시작되면 조명을 회의 모드로 바꿔요',
  room2: '보호 방 기기를 맡아요. 수면 중에는 에어컨 끄기를 거절해요',
};

export const SUGGESTIONS = {
  desktop: ['나 회의 시작할게', '회의 끝났어', '지금 무슨 상태야?'],
  smartphone: ['나 나간다', '집 도착', '집 전체 절전해줘'],
  orchestrator: ['집 전체 절전해도 될까?', '거실 조명 켜줘', '지금 거실 상태 알려줘'],
  room1: ['내 방 에어컨 켜줘', '조명 일반 모드로 바꿔줘', '내 방 상태 알려줘'],
  room2: ['보호 방 수면 모드 켜줘', '보호 방 에어컨 꺼줘', '보호 방 상태 알려줘'],
};

/**
 * The requests a run set off (GET /flows items whose events are among the run's events), as flow
 * cards. Requests an agent asked for come first, then the automation rules they triggered (`rule`).
 */
export function requestFlows(flows, runEvents, devices) {
  const ids = new Set(runEvents.map((event) => event.flow).filter(Boolean));
  const ruleFlows = new Set(runEvents.filter((event) => event.dir === 'rule').map((event) => event.flow));
  return flows
    .filter((flow) => ids.has(flow.flow))
    .map((flow) => ({ ...toFlowCard(flow, devices), rule: ruleFlows.has(flow.flow), startedAt: flow.started_at }))
    .sort((a, b) => a.rule - b.rule || (a.startedAt < b.startedAt ? -1 : 1));
}

/** "거실 조명 꺼짐" style chips for the devices an agent owns. */
export function ownedDeviceChips(status, devices) {
  return (status?.owned_devices || []).map((entity) => {
    const state = devices[entity]?.state;
    const text = state === 'on' ? '켜짐' : state === 'off' ? '꺼짐' : state ? valueText(state) : '—';
    return { entity, name: deviceName(entity, devices), text, on: state === 'on' || (state && state !== 'off' && state !== 'normal') };
  });
}

/** Short "what it did recently" lines for one agent, newest first. */
export function recentDoings(agentId, events, devices, limit = 3) {
  return events
    .filter((event) => event.agent === agentId && ['exec', 'rule', 'in', 'out'].includes(event.dir) && event.type !== 'context.subscribe')
    .slice(0, limit)
    .map((event) => {
      if (event.dir === 'exec' || event.dir === 'rule') {
        const item = toActivity(event, devices);
        const rejected = event.accepted === false;
        const label = event.dir === 'rule' ? item.title.replace('자동화 규칙 · ', '규칙: ') : `${rejected ? '거절' : '실행'}: ${item.title}`;
        const reason = rejected ? ` (${resultText(event.accepted, event.reason_code)})` : '';
        return { key: event.id, time: item.time, text: `${label}${reason}`, ok: !rejected };
      }
      if (event.dir === 'out') {
        const what = event.type === 'device.control' ? actionText(event.action, devices) : (TYPE_TEXT[event.type] || event.type);
        return { key: event.id, time: timeOf(event.ts), text: `${shortAgent(event.to)}에게 ${what}`, ok: true };
      }
      const row = toLogRow(event, devices);
      return { key: event.id, time: row.time, text: `${shortAgent(event.from)}의 ${row.text}`, ok: event.accepted !== false };
    });
}

// --- Agents on the 3D house (AgentScene) --------------------------------------------------------

// Reasons Home gives itself; any other refusal of a passed-on request comes from the room.
const HOME_REASONS = new Set(['UNAUTHORIZED', 'NOT_OWNER', 'UNKNOWN_PEER', 'BAD_REQUEST']);
// Entities without a pin of their own flash on the pin they belong to.
const FLASH_PIN = { [TV_MUTED]: 'living-tv', [LIGHT_MODE]: 'myroom-light', [SLEEP_MODE]: 'protected-light' };
const FIELD_TEXT = { meeting_app_active: '회의 여부', pc_state: 'PC 상태', presence: '외출·귀가' };
const shortAgent = (id) => agentName(id).replace(' Agent', '');

/** One speech-bubble line for an agent event, or null when the event isn't shown as speech. */
export function sceneLine(event, devices) {
  const what = actionText(event.action, devices);
  const fields = (event.fields || []).map((field) => FIELD_TEXT[field] || field).join('·');
  if (event.dir === 'out') {
    if (event.type === 'device.control') return { text: `${shortAgent(event.to)}에게 부탁: ${what}` };
    if (event.type === 'context.update') return { text: `${shortAgent(event.to)}에게 내 상태 알림${fields ? ` (${fields})` : ''}` };
    if (event.type === 'context.query') return { text: `${shortAgent(event.to)}에게 상태 물어봄${fields ? ` (${fields})` : ''}` };
    return null;
  }
  if (event.dir === 'in' && event.type === 'device.control') {
    const owner = devices[event.action?.device]?.owner;
    if (owner && owner !== event.agent && !HOME_REASONS.has(event.reason_code)) {
      return { text: `${shortAgent(event.from)} 부탁 권한 확인 ✓ → ${shortAgent(owner)}에게 넘김`, ok: true };
    }
    const result = resultText(event.accepted, event.reason_code);
    const verdict = event.reason_code === 'PARTIAL' || event.accepted !== false ? result || '수락' : `거절 (${result})`;
    return { text: `${shortAgent(event.from)} 부탁 ${verdict}: ${what}`, ok: event.accepted !== false };
  }
  if (event.dir === 'rule') return { text: `자동 규칙 · ${RULE_TEXT[event.rule] || event.rule}: ${what}`, ok: event.accepted !== false };
  return null;
}

/** Device change (or refusal) from an `exec` event, keyed by the screen pin it flashes on. */
export function sceneFlash(event, devices) {
  const entity = event.action?.device;
  const pin = DEVICE_MAP[entity]?.deviceId || FLASH_PIN[entity];
  if (!pin) return null;
  const ok = event.accepted !== false;
  return { pin, ok, text: `${actionText(event.action, devices)}${ok ? ' ✓' : ` ✗ ${resultText(event.accepted, event.reason_code)}`}` };
}
