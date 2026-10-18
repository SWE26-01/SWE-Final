const SPACE_TO_ROOM = {
  living_room: 'living',
  my_room: 'bedroom1',
  protected_room: 'bedroom2',
};

const ENTITY_TO_DEVICE = {
  'input_boolean.living_light': { roomId: 'living', deviceId: 'living-light' },
  'input_boolean.living_tv': { roomId: 'living', deviceId: 'living-tv' },
  'input_boolean.room1_light': { roomId: 'bedroom1', deviceId: 'bedroom1-light' },
  'input_select.room1_light_mode': { roomId: 'bedroom1', deviceId: 'bedroom1-light', valueOnly: true },
  'input_boolean.room1_ac': { roomId: 'bedroom1', deviceId: 'bedroom1-air' },
  'input_boolean.room2_light': { roomId: 'bedroom2', deviceId: 'bedroom2-light' },
  'input_boolean.room2_ac': { roomId: 'bedroom2', deviceId: 'bedroom2-air' },
};

const disconnectedStates = new Set([null, 'unknown', 'unavailable']);

const deviceType = (device) => {
  const icon = device.attributes?.icon || '';
  const value = `${device.entity} ${icon}`;
  if (/light/.test(value)) return 'light';
  if (/television|living_tv/.test(value)) return 'tv';
  if (/air-conditioner|_ac/.test(value)) return 'air';
  if (/sleep/.test(value)) return 'sleep';
  if (/account|occupied/.test(value)) return 'presence';
  return 'device';
};

const isOn = (state) => !disconnectedStates.has(state) && state !== 'off';

const stateLabel = (device) => {
  if (device.state == null) return '상태 확인 중';
  if (device.state === 'unavailable') return '사용할 수 없음';
  if (device.state === 'unknown') return '상태 알 수 없음';
  if (device.state === 'on') return '켜짐';
  if (device.state === 'off') return '꺼짐';
  return device.state;
};

const mergeDevice = (rooms, haDevice) => {
  const mapped = ENTITY_TO_DEVICE[haDevice.entity];
  const roomId = mapped?.roomId || SPACE_TO_ROOM[haDevice.space];
  if (!roomId) return rooms;

  const targetId = mapped?.deviceId || `ha:${haDevice.entity}`;
  const connected = !disconnectedStates.has(haDevice.state);
  let found = false;
  const nextRooms = rooms.map((room) => {
    if (room.id !== roomId) return room;
    const devices = room.devices.map((device) => {
      if (device.id !== targetId) return device;
      found = true;
      return {
        ...device,
        ...(mapped?.valueOnly ? {} : { on: isOn(haDevice.state) }),
        connected,
        entityId: haDevice.entity,
        owner: haDevice.owner,
        value: stateLabel(haDevice),
      };
    });
    if (found || mapped?.valueOnly) return { ...room, devices };
    return {
      ...room,
      devices: [...devices, {
        id: targetId,
        entityId: haDevice.entity,
        owner: haDevice.owner,
        name: haDevice.attributes?.friendly_name || haDevice.entity,
        type: deviceType(haDevice),
        on: isOn(haDevice.state),
        connected,
        value: stateLabel(haDevice),
      }],
    };
  });
  return nextRooms;
};

export const mergeHomeAssistantDevices = (rooms, devices) => (
  devices.reduce(mergeDevice, rooms)
);

export const connectHomeAssistant = ({ url, token, onStatus, onSnapshot, onDevice }) => {
  if (!url || !token) {
    onStatus('configuration_required');
    return () => {};
  }

  let socket;
  let reconnectTimer;
  let stopped = false;
  let retry = 0;

  const open = () => {
    onStatus(retry ? 'reconnecting' : 'connecting');
    const endpoint = new URL(url, window.location.href);
    endpoint.searchParams.set('token', token);
    socket = new WebSocket(endpoint);

    socket.addEventListener('open', () => {
      retry = 0;
      onStatus('connected');
    });
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'snapshot') {
          onStatus(message.ha_connected ? 'connected' : 'ha_disconnected');
          onSnapshot(message.devices || []);
        } else if (message.type === 'device.state_changed' && message.device) {
          onDevice(message.device);
        }
      } catch {
        onStatus('invalid_message');
      }
    });
    socket.addEventListener('close', () => {
      if (stopped) return;
      retry += 1;
      onStatus('reconnecting');
      reconnectTimer = window.setTimeout(open, Math.min(10000, 1000 * (2 ** Math.min(retry, 3))));
    });
    socket.addEventListener('error', () => socket.close());
  };

  open();
  return () => {
    stopped = true;
    window.clearTimeout(reconnectTimer);
    socket?.close();
  };
};

