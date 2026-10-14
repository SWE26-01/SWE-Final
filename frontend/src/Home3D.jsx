import { useEffect, useRef, useState } from 'react';
import { Activity, AirVent, ArrowLeft, Bot, Droplets, Fan, Flame, Lightbulb, Map, Minus, Monitor, PanelsTopLeft, Plus, Thermometer, Tv, UserRound, WashingMachine, Wind } from 'lucide-react';

const layout = {
  kitchen: { left: 1, top: 1, width: 41, height: 25, furniture: 'counter', pin: [18, 11], walls: { south: false }, windows: { north: ['left'] }, doors: { north: 'right' } },
  dining: { left: 1, top: 26, width: 41, height: 25, furniture: 'dining', pin: [17, 36], walls: { north: false, south: false }, windows: { west: ['center'] } },
  living: { left: 1, top: 51, width: 41, height: 30, furniture: 'sofa', pin: [16, 63], walls: { north: false }, windows: { west: ['top', 'bottom'], south: ['wide'] }, doors: { east: 'center' } },
  veranda: { left: 1, top: 81, width: 41, height: 18, furniture: 'veranda', pin: [18, 89], walls: { north: false } },
  bath1: { left: 42, top: 1, width: 14, height: 21, furniture: 'bath', pin: [49, 9], doors: { south: 'right' } },
  bedroom1: { left: 56, top: 1, width: 43, height: 29, furniture: 'bed', pin: [83, 12], windows: { north: ['center'], east: ['center'] }, doors: { south: 'left' } },
  bedroom2: { left: 56, top: 30, width: 43, height: 22, furniture: 'bed', pin: [83, 38], windows: { east: ['center'] }, doors: { west: 'bottom' } },
  bath2: { left: 56, top: 52, width: 43, height: 17, furniture: 'bath', pin: [84, 58], windows: { east: ['center'] }, doors: { west: 'center' } },
  bedroom3: { left: 56, top: 69, width: 43, height: 30, furniture: 'bed-desk', pin: [83, 80], windows: { east: ['top'], south: ['center'] }, doors: { west: 'top' } },
};

const environmentLimits = { temp: 26, humidity: 60 };
const modelBaseScale = 1.3;
const occupantAnchors = {
  kitchen: [20, 15], dining: [4, 38], living: [18, 59], veranda: [35, 90],
  bath1: [49, 11], bedroom1: [82, 17], bedroom2: [82, 41], bath2: [82, 60], bedroom3: [82, 83], exit: [50, 97],
};
const occupantRoutes = {
  'living>bath1': [[18, 59], [26, 58], [35, 58], [43, 60], [49, 55], [50, 46], [50, 36], [50, 27], [49, 20], [49, 11]],
  'bath1>kitchen': [[49, 11], [46, 20], [41, 24], [34, 24], [27, 23], [22, 20], [20, 15]],
  'kitchen>living': [[20, 20], [18, 23], [13, 25], [7, 27], [4, 33], [4, 42], [6, 48], [14, 50], [24, 50], [33, 52], [35, 55], [30, 57], [24, 58], [18, 59]],
  'living>kitchen': [[24, 58], [30, 57], [35, 55], [33, 52], [24, 50], [14, 50], [6, 48], [4, 42], [4, 33], [7, 27], [13, 25], [18, 23], [20, 20], [20, 15]],
  'living>bedroom1': [[24, 59], [31, 60], [38, 62], [42, 64], [47, 64], [50, 58], [50, 48], [50, 39], [52, 33], [57, 30], [63, 29], [68, 27], [75, 24], [82, 20], [82, 17]],
  'living>exit': [[24, 59], [31, 60], [38, 62], [42, 65], [47, 66], [50, 69], [51, 73], [51, 78], [50, 84], [50, 90], [50, 97]],
};

function Furniture({ type }) {
  if (type === 'bed-desk') return <><div className="furniture bed-3d"><i /><i /><span /></div><div className="furniture tower-3d wardrobe-3d" /><div className="furniture desk-3d bedroom-desk-3d" /><div className="furniture chair-3d bedroom-chair-3d" /></>;
  if (type === 'bed') return <><div className="furniture bed-3d"><i /><i /><span /></div><div className="furniture tower-3d wardrobe-3d" /></>;
  if (type === 'desk') return <><div className="furniture desk-3d"><span /></div><div className="furniture chair-3d" /></>;
  if (type === 'sofa') return <><div className="furniture sofa-3d"><i /><i /><span /></div><div className="furniture table-3d" /><div className="plant-3d"><i /><span /></div></>;
  if (type === 'counter') return <><div className="furniture counter-3d"><i /><i /><i /><i /></div><div className="furniture island-3d" /><div className="furniture tower-3d fridge-3d" /></>;
  if (type === 'dining') return <><div className="furniture dining-3d"><i /><i /><i /><i /></div><div className="furniture dining-sideboard-3d" /></>;
  if (type === 'veranda') return <><div className="veranda-grid-3d" /><div className="plant-3d veranda-plant-a"><i /><span /></div><div className="plant-3d veranda-plant-b"><i /><span /></div></>;
  return <><div className="furniture tub-3d"><span /></div><div className="furniture sink-3d" /></>;
}

function RoomAppliances({ roomId }) {
  if (roomId === 'kitchen') return <div className="appliance-3d hood-3d"><i /><i /><i /></div>;
  if (roomId === 'living') return <><div className="appliance-3d television-3d"><i /></div><div className="appliance-3d purifier-3d"><i /><i /><i /></div></>;
  if (roomId === 'veranda') return <div className="appliance-3d washer-3d"><i /></div>;
  if (roomId === 'bedroom3') return <><div className="appliance-3d humidifier-3d bedroom3-humidifier-3d"><i /></div><div className="appliance-3d computer-3d"><i /><span /></div></>;
  if (roomId.startsWith('bedroom')) return <div className="appliance-3d humidifier-3d"><i /></div>;
  return null;
}

function WallOpenings({ side, windows = [], door }) {
  return <>{windows.map((position) => <i key={`${side}-${position}`} className={`window-3d window-${side} opening-${position}`} />)}{door && <i className={`door-gap door-${side} opening-${door}`} />}</>;
}

function RoomWalls({ walls = {}, windows = {}, doors = {} }) {
  const visible = (side) => walls[side] !== false;
  return (
    <div className="room-walls" aria-hidden="true">
      {visible('north') && <span className="wall-3d wall-north"><WallOpenings side="north" windows={windows.north} door={doors.north} /></span>}
      {visible('south') && <span className="wall-3d wall-south"><WallOpenings side="south" windows={windows.south} door={doors.south} /></span>}
      {visible('west') && <span className="wall-3d wall-west"><WallOpenings side="west" windows={windows.west} door={doors.west} /></span>}
      {visible('east') && <span className="wall-3d wall-east"><WallOpenings side="east" windows={windows.east} door={doors.east} /></span>}
    </div>
  );
}

function Pin({ device, style }) {
  let Icon = Lightbulb;
  if (device.type === 'cleaner') Icon = Bot;
  else if (device.type === 'curtain') Icon = PanelsTopLeft;
  else if (device.type === 'tv') Icon = Tv;
  else if (device.type === 'washer') Icon = WashingMachine;
  else if (device.type === 'humidifier') Icon = Droplets;
  else if (device.type === 'hood' || device.type === 'purifier') Icon = Wind;
  else if (device.type === 'pc') Icon = Monitor;
  else if (device.type === 'stove') Icon = Flame;
  else if (device.name === '에어컨') Icon = AirVent;
  else if (device.name === '환풍기') Icon = Fan;
  else if (device.type === 'air') Icon = Wind;
  return <span className={`css-device-pin ${device.on ? 'active' : ''}`} style={style} role="img" aria-label={`${device.name} ${device.on ? '켜짐' : '꺼짐'}`} title={device.name}><Icon size={15} /></span>;
}

function getDevicePinPosition(index, count, roomId) {
  const slots = {
    1: [[50, 54]],
    2: [[35, 57], [65, 57]],
    3: [[27, 62], [50, 62], [73, 62]],
    4: [[28, 52], [72, 52], [28, 72], [72, 72]],
    5: [[22, 50], [50, 50], [78, 50], [35, 72], [65, 72]],
  };
  const slotCount = Math.min(count, 5);
  const position = (slots[slotCount] || slots[5])[index % slotCount];
  if (roomId === 'bath1') return [50, 38 + index * 25];
  if (roomId === 'bath2') return [36 + index * 28, 62];
  if (roomId === 'veranda') return [50, 48];
  return position;
}

export default function Home3D({ rooms, environment, selectedRoom, onRoomSelect, onBack, occupantRoom = null }) {
  const [rotation, setRotation] = useState(-33);
  const [tilt, setTilt] = useState(55);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const drag = useRef(null);
  const dragFrame = useRef(null);
  const pendingDrag = useRef(null);
  const wasDragged = useRef(false);
  const previousOccupantRoom = useRef(null);
  const movementFrame = useRef(null);
  const occupantPositionRef = useRef(null);
  const [occupantPosition, setOccupantPosition] = useState(null);
  const [occupantVisible, setOccupantVisible] = useState(false);
  const [occupantMoving, setOccupantMoving] = useState(false);

  useEffect(() => {
    if (movementFrame.current) window.cancelAnimationFrame(movementFrame.current);
    const previousRoom = previousOccupantRoom.current;
    if (!occupantRoom) {
      setOccupantVisible(false);
      setOccupantMoving(false);
      previousOccupantRoom.current = null;
      return undefined;
    }
    const destination = occupantAnchors[occupantRoom];
    if (!destination) return undefined;
    const route = occupantRoutes[`${previousRoom}>${occupantRoom}`];
    if (!previousRoom || !route || !occupantPositionRef.current) {
      setOccupantPosition(destination);
      occupantPositionRef.current = destination;
      setOccupantVisible(true);
      setOccupantMoving(false);
    } else {
      setOccupantVisible(true);
      setOccupantMoving(true);
      const points = [occupantPositionRef.current, ...route];
      const distances = [0];
      for (let index = 1; index < points.length; index += 1) {
        distances[index] = distances[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
      }
      const totalDistance = distances[distances.length - 1];
      const duration = occupantRoom === 'exit' ? 4400 : Math.min(5200, Math.max(3200, totalDistance * 72));
      const startedAt = window.performance.now();
      const animateMovement = (now) => {
        const rawProgress = Math.min(1, (now - startedAt) / duration);
        const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);
        const travelled = totalDistance * progress;
        let segment = 1;
        while (segment < distances.length - 1 && distances[segment] < travelled) segment += 1;
        const segmentStart = distances[segment - 1];
        const segmentLength = Math.max(.001, distances[segment] - segmentStart);
        const segmentProgress = (travelled - segmentStart) / segmentLength;
        const from = points[segment - 1];
        const to = points[segment];
        const nextPosition = [from[0] + (to[0] - from[0]) * segmentProgress, from[1] + (to[1] - from[1]) * segmentProgress];
        occupantPositionRef.current = nextPosition;
        setOccupantPosition(nextPosition);
        if (rawProgress < 1) movementFrame.current = window.requestAnimationFrame(animateMovement);
        else {
          movementFrame.current = null;
          setOccupantMoving(false);
        }
      };
      movementFrame.current = window.requestAnimationFrame(animateMovement);
    }
    previousOccupantRoom.current = occupantRoom;
    return () => { if (movementFrame.current) window.cancelAnimationFrame(movementFrame.current); };
  }, [occupantRoom]);

  const startDrag = (event) => {
    wasDragged.current = false;
    setIsDragging(true);
    drag.current = { x: event.clientX, y: event.clientY, rotation, tilt };
  };
  const moveDrag = (event) => {
    if (!drag.current) return;
    if (Math.abs(event.clientX - drag.current.x) + Math.abs(event.clientY - drag.current.y) > 5) wasDragged.current = true;
    const rotationSensitivity = selectedRoom ? .24 : .35;
    const tiltSensitivity = selectedRoom ? .12 : .18;
    pendingDrag.current = {
      rotation: drag.current.rotation - (event.clientX - drag.current.x) * rotationSensitivity,
      tilt: Math.max(0, Math.min(72, drag.current.tilt - (event.clientY - drag.current.y) * tiltSensitivity)),
    };
    if (dragFrame.current) return;
    dragFrame.current = window.requestAnimationFrame(() => {
      setRotation(pendingDrag.current.rotation);
      setTilt(pendingDrag.current.tilt);
      dragFrame.current = null;
    });
  };
  const stopDrag = () => {
    drag.current = null;
    setIsDragging(false);
    window.requestAnimationFrame(() => { wasDragged.current = false; });
  };
  const topView = () => { setRotation(-90); setTilt(0); };
  const adjustZoom = (amount) => setZoom((current) => Math.min(1.5, Math.max(.5, Number((current + amount).toFixed(2)))));
  const selectedLayout = selectedRoom ? layout[selectedRoom] : null;
  const center = selectedLayout ? [selectedLayout.left + selectedLayout.width / 2, selectedLayout.top + selectedLayout.height / 2] : [50, 50];
  const focus = selectedLayout ? [`${(50 - center[0]) * 1.05}%`, `${(50 - center[1]) * 1.05}%`] : null;
  const selectedScale = selectedLayout ? Math.min(2.8, Math.max(2.08, 58 / Math.max(selectedLayout.width, selectedLayout.height))) : 1;
  const houseTransform = `${focus ? `translate(${focus[0]}, ${focus[1]})` : ''} scale(${selectedScale * modelBaseScale * zoom}) rotateX(${tilt}deg) rotateZ(${rotation}deg)`;
  const isTopView = tilt < 1;

  return (
    <div
      className="home-3d"
      aria-label="회전 가능한 3D 스마트홈 평면도"
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onPointerLeave={stopDrag}
    >
      <div className="model-environment" aria-label={environment.label === '평균' ? 'Environment' : `Environment - ${environment.label}`}>
        <strong>Environment{environment.label !== '평균' && <span> - {environment.label}</span>}</strong>
        <span><Thermometer size={13} /><b>{environment.temp.toFixed(1)}°C</b></span>
        <span><Droplets size={13} /><b>{Math.round(environment.humidity)}%</b></span>
        <span><Activity size={13} /><b>센서 {environment.sensor}</b></span>
        <span><UserRound size={13} /><b>{environment.presence || '거실'}</b></span>
      </div>
      {selectedRoom && (
        <button className="three-back" onPointerDown={(event) => event.stopPropagation()} onClick={onBack}>
          <ArrowLeft size={14} /> 뒤로가기
        </button>
      )}
      <div className="css-3d-stage">
        <div className={`css-house ${selectedRoom ? 'room-focused' : ''} ${isDragging ? 'is-dragging' : ''} ${isTopView ? 'is-top-view' : ''}`} style={{ transform: houseTransform, transformOrigin: `${center[0]}% ${center[1]}%`, '--counter-rotation': `${-rotation}deg` }}>
          <div className="house-base" />
          <div className={`hall-3d ${selectedRoom ? 'room-muted' : ''}`}><span className="stairs-3d"><i /><i /><i /><i /></span></div>
          {rooms.map((room) => {
            const roomLayout = layout[room.id];
            const active = room.devices.some((device) => device.on);
            const highTemp = room.temp > environmentLimits.temp;
            const highHumidity = room.humidity > environmentLimits.humidity;
            const roomStyle = { left: `${roomLayout.left}%`, top: `${roomLayout.top}%`, width: `${roomLayout.width}%`, height: `${roomLayout.height}%` };
            return (
              <button className={`css-room css-room-${room.id} ${selectedRoom && selectedRoom !== room.id ? 'room-muted' : ''} ${selectedRoom === room.id ? 'room-selected' : ''}`} style={roomStyle} key={room.id} onClick={() => { if (!wasDragged.current) onRoomSelect(room.id); }} aria-label={`${room.name} 입장`}>
                <RoomWalls walls={roomLayout.walls} windows={roomLayout.windows} doors={roomLayout.doors} />
                <Furniture type={roomLayout.furniture} />
                <RoomAppliances roomId={room.id} />
                <span className="css-room-name"><b>{room.name}</b><small>{room.en}</small></span>
                <span className={`css-room-temp ${active ? 'active' : ''}`}>
                  <span className={`room-metric metric-temp ${highTemp ? 'is-alert-value' : ''}`}><Thermometer size={8} />{room.temp.toFixed(1)}°</span>
                  <span className={`room-metric metric-humidity ${highHumidity ? 'is-alert-value' : ''}`}><Droplets size={8} />{Math.round(room.humidity)}%</span>
                </span>
                {room.devices.map((device, index) => {
                  const [left, top] = getDevicePinPosition(index, room.devices.length, room.id);
                  return <Pin key={device.id} device={device} style={{ left: `${left}%`, top: `${top}%` }} />;
                })}
              </button>
            );
          })}
          {occupantPosition && <span className={`occupant-marker ${occupantVisible ? 'visible' : ''} ${occupantMoving ? 'moving' : ''} ${selectedRoom && selectedRoom !== occupantRoom ? 'room-muted' : ''}`} style={{ left: `${occupantPosition[0]}%`, top: `${occupantPosition[1]}%` }} role="img" aria-label={`사용자 위치 · ${rooms.find((item) => item.id === occupantRoom)?.name || '이동 중'}`}><UserRound size={11} /></span>}
        </div>
      </div>
      <div className="three-zoom" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => adjustZoom(-.05)} aria-label="3D 모델 축소"><Minus size={12} /></button>
        <input
          aria-label="3D 모델 확대 축소"
          type="range"
          min="0.5"
          max="1.5"
          step="0.05"
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
        />
        <button type="button" onClick={() => adjustZoom(.05)} aria-label="3D 모델 확대"><Plus size={12} /></button>
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      <button className="three-topview" onClick={topView} aria-label="완전 탑뷰로 전환"><Map size={13} /> TOP VIEW</button>
    </div>
  );
}
