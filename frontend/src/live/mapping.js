// Turns live data into the shapes the screens already use (rooms/devices, log rows, timeline items).
// Mapping and wording follow docs/frontend-integration.md section 4.

// Home Assistant entity -> screen room/device. Rooms not listed here have no real devices.
export const DEVICE_MAP = {
  'input_boolean.living_light': { roomId: 'living', deviceId: 'living-light' },
  'input_boolean.living_tv': { roomId: 'living', deviceId: 'living-tv' },
  'input_boolean.room1_light': { roomId: 'bedroom3', deviceId: 'bedroom3-light' },
  'input_boolean.room1_ac': { roomId: 'bedroom3', deviceId: 'bedroom3-air' },
  'input_boolean.room2_light': { roomId: 'bedroom2', deviceId: 'bedroom2-light' },
  'input_boolean.room2_ac': { roomId: 'bedroom2', deviceId: 'bedroom2-air' },
};
// Entities shown as an extra on another device or room instead of a device of their own.
const TV_MUTED = 'input_boolean.living_tv_muted';
const LIGHT_MODE = 'input_select.room1_light_mode';
const OCCUPIED = 'input_boolean.room1_occupied';
const SLEEP_MODE = 'input_boolean.room2_sleep_mode';

export const LIVE_ROOM_AGENT = { living: 'Home Agent', bedroom3: 'My Room Agent', bedroom2: '보호 방 Agent' };

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
  if (event.type === 'device.control') return actionText(event.action, devices);
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
    .map(agentName);
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

const powerText = (state) => (state === 'on' ? '켜짐' : state === 'off' ? '꺼짐' : '상태 없음');

/** Rooms with live device states. Devices without a real counterpart show as not connected. */
export function applyLiveDevices(rooms, devices, online) {
  const byDevice = Object.fromEntries(Object.entries(DEVICE_MAP).map(([entity, target]) => [target.deviceId, entity]));
  const state = (entity) => devices[entity]?.state;
  return rooms.map((room) => {
    const extras = [];
    if (room.id === 'bedroom2' && state(SLEEP_MODE)) extras.push(`수면 모드 ${powerText(state(SLEEP_MODE))}`);
    if (room.id === 'bedroom3' && state(OCCUPIED)) extras.push(state(OCCUPIED) === 'on' ? '재실' : '비어 있음');
    return {
      ...room,
      description: extras.length ? `${room.description} · ${extras.join(' · ')}` : room.description,
      devices: room.devices.map((device) => {
        const entity = byDevice[device.id];
        if (!entity) return { ...device, on: false, connected: false, value: '시뮬레이션 전용' };
        const value = state(entity);
        const connected = online && value != null;
        let text = connected ? powerText(value) : '연결 안 됨';
        if (connected && device.id === 'living-tv' && state(TV_MUTED) === 'on') text += ' · 음소거';
        if (connected && device.id === 'bedroom3-light' && state(LIGHT_MODE)) text += ` · ${valueText(state(LIGHT_MODE))}`;
        return { ...device, on: connected && value === 'on', connected, value: text };
      }),
    };
  });
}

/** Room the occupant marker should show (My Room is occupied), or null. */
export function liveOccupantRoom(devices) {
  return devices[OCCUPIED]?.state === 'on' ? 'bedroom3' : null;
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

// Agent nodes drawn on the Home tab, by label.
export const NODE_AGENT = { Home: 'orchestrator', 'My Room': 'room1', Desktop: 'desktop', Mobile: 'smartphone' };

export const socketLabel = (status) => ({ open: 'CONNECTED', connecting: 'CONNECTING', closed: 'RECONNECTING', off: 'OFF' }[status] || status);
