const SPACE_TO_ROOM = {
  kitchen: 'kitchen',
  dining: 'dining',
  living: 'living',
  veranda: 'veranda',
  bath1: 'bath1',
  bedroom1: 'bedroom1',
  bedroom2: 'bedroom2',
  bath2: 'bath2',
  bedroom3: 'bedroom3',
  living_room: 'living',
  my_room: 'bedroom1',
  protected_room: 'bedroom2',
};

const ENTITY_TO_DEVICE = {
  'input_boolean.kitchen_light': { roomId: 'kitchen', deviceId: 'kitchen-light' },
  'input_boolean.kitchen_stove': { roomId: 'kitchen', deviceId: 'kitchen-stove' },
  'input_boolean.kitchen_air': { roomId: 'kitchen', deviceId: 'kitchen-air' },
  'input_boolean.kitchen_hood': { roomId: 'kitchen', deviceId: 'kitchen-hood' },
  'input_boolean.dining_light': { roomId: 'dining', deviceId: 'dining-light' },
  'input_boolean.living_light': { roomId: 'living', deviceId: 'living-light' },
  'input_boolean.living_air': { roomId: 'living', deviceId: 'living-air' },
  'input_boolean.living_cleaner': { roomId: 'living', deviceId: 'living-cleaner' },
  'input_boolean.living_tv': { roomId: 'living', deviceId: 'living-tv' },
  'input_boolean.living_purifier': { roomId: 'living', deviceId: 'living-purifier' },
  'input_boolean.veranda_light': { roomId: 'veranda', deviceId: 'veranda-light' },
  'input_boolean.veranda_washer': { roomId: 'veranda', deviceId: 'veranda-washer' },
  'input_boolean.bath1_light': { roomId: 'bath1', deviceId: 'bath1-light' },
  'input_boolean.bath1_air': { roomId: 'bath1', deviceId: 'bath1-air' },
  'input_boolean.room1_light': { roomId: 'bedroom1', deviceId: 'bedroom1-light' },
  'input_select.room1_light_mode': { roomId: 'bedroom1', deviceId: 'bedroom1-light', valueOnly: true },
  'input_boolean.room1_ac': { roomId: 'bedroom1', deviceId: 'bedroom1-air' },
  'input_boolean.bedroom1_curtain': { roomId: 'bedroom1', deviceId: 'bedroom1-curtain' },
  'input_boolean.bedroom1_humidifier': { roomId: 'bedroom1', deviceId: 'bedroom1-humidifier' },
  'input_boolean.room2_light': { roomId: 'bedroom2', deviceId: 'bedroom2-light' },
  'input_boolean.room2_ac': { roomId: 'bedroom2', deviceId: 'bedroom2-air' },
  'input_boolean.bedroom2_humidifier': { roomId: 'bedroom2', deviceId: 'bedroom2-humidifier' },
  'input_boolean.bath2_light': { roomId: 'bath2', deviceId: 'bath2-light' },
  'input_boolean.bath2_air': { roomId: 'bath2', deviceId: 'bath2-air' },
  'input_boolean.bedroom3_light': { roomId: 'bedroom3', deviceId: 'bedroom3-light' },
  'input_boolean.bedroom3_air': { roomId: 'bedroom3', deviceId: 'bedroom3-air' },
  'input_boolean.bedroom3_humidifier': { roomId: 'bedroom3', deviceId: 'bedroom3-humidifier' },
  'input_boolean.bedroom3_pc': { roomId: 'bedroom3', deviceId: 'bedroom3-pc' },
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
