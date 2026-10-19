// The house as the agents really run it (LIVE): the living room with the Home agent, My Room (room1)
// and the protected room (room2), and the Home Assistant devices in each (agents/**/openclaw.json5
// `owned`, services/config/devices.yaml). MOCK keeps the demo apartment in Home3D.jsx.
import { BedDouble, CookingPot, DoorOpen, ShieldCheck, ShowerHead, Sofa, Sun } from 'lucide-react';
import './house.css';

/**
 * Floor plan for Home3D, in % of the house box, traced from a real Korean 59 m² (type A) apartment:
 * back row bedroom 3, utility balcony, kitchen and dining, entrance (front door at the top) and the
 * shared bathroom; in the middle the master bathroom and the hallway; front row bedroom 1 (main,
 * My Room), the living room and bedroom 2 (protected room) with its balcony and the AC unit room.
 * The outline is not a rectangle, so house.css hides the floor slab and only rooms are drawn. Rooms
 * that are open to each other (hallway, kitchen, living room, entrance) draw no wall between them;
 * every room places its own furniture against the walls (`items`, Furniture3D.jsx);
 * where a door is in a shared wall, only the room with the door draws that wall. The kitchen (with its
 * counter nook) and the L-shaped hallway are rooms of two rectangles (`partOf`).
 */
export const LIVE_PLAN = {
  className: 'plan-live',
  topRotation: 0, // TOP VIEW shows it like the floor plan drawing, north up
  rooms: {
    bedroom3: {
      left: 0.5, top: 8, width: 31, height: 30, windows: { north: ['center'], west: ['center'] }, doors: { south: 'right' },
      items: [
        { kind: 'single-bed', x: 4, y: 2, w: 38, d: 67, face: 'south' },
        { kind: 'study-desk', x: 46, y: 0, w: 36, d: 36, face: 'south' },
        { kind: 'wardrobe', x: 86, y: 40, w: 14, d: 34, face: 'west' },
      ],
    },
    veranda2: {
      left: 31.5, top: 1.5, width: 15.5, height: 17.5, windows: { north: ['center'] }, doors: { south: 'center' },
      items: [
        { kind: 'tiles', x: 6, y: 6, w: 88, d: 88 },
        { kind: 'washer', x: 4, y: 4, w: 42, d: 38, face: 'south' },
        { kind: 'utility-sink', x: 54, y: 4, w: 42, d: 30, face: 'south' },
      ],
    },
    kitchen: {
      left: 31.5, top: 19, width: 35.5, height: 30, walls: { north: false, south: false, west: false }, join: ['north'],
      items: [
        { kind: 'sink-counter', x: 86, y: 0, w: 14, d: 62, face: 'west' },
        { kind: 'dining', x: 22, y: 34, w: 50, d: 60, face: 'south' },
      ],
    },
    'kitchen-nook': {
      partOf: 'kitchen', left: 47, top: 0.5, width: 20, height: 18.5, walls: { south: false, west: false }, windows: { north: ['center'] }, join: ['south'],
      items: [
        { kind: 'fridge', x: 2, y: 2, w: 30, d: 40, face: 'south' },
        { kind: 'stove', x: 34, y: 2, w: 66, d: 34, face: 'south' },
        { kind: 'hood', x: 52, y: 2, w: 30, d: 26, face: 'south' },
        { kind: 'counter', x: 84, y: 36, w: 16, d: 64, face: 'west' },
      ],
    },
    entrance: {
      left: 67, top: 29, width: 15, height: 20, walls: { south: false, west: false, east: false }, doors: { north: 'center' },
      items: [{ kind: 'shoe-cabinet', x: 78, y: 30, w: 22, d: 58, face: 'west' }],
    },
    bath1: {
      left: 82, top: 34, width: 17.5, height: 23, doors: { west: 'bottom' },
      items: [
        { kind: 'tub', x: 0, y: 0, w: 100, d: 32, face: 'south' },
        { kind: 'vanity', x: 74, y: 38, w: 26, d: 24, face: 'west' },
        { kind: 'toilet', x: 74, y: 68, w: 26, d: 26, face: 'west' },
      ],
    },
    bath2: {
      left: 2, top: 38, width: 15, height: 19, doors: { south: 'center' },
      items: [
        { kind: 'shower', x: 0, y: 0, w: 100, d: 38, face: 'south' },
        { kind: 'vanity', x: 0, y: 46, w: 30, d: 26, face: 'east' },
        { kind: 'toilet', x: 70, y: 46, w: 30, d: 28, face: 'west' },
      ],
    },
    hall: { left: 31.5, top: 49, width: 50.5, height: 8, walls: { north: false, south: false, east: false, west: false }, join: ['west'], items: [] },
    'hall-west': { partOf: 'hall', left: 17, top: 38, width: 14.5, height: 19, walls: { north: false, east: false, west: false }, doors: { south: 'center' }, join: ['east'], items: [] },
    // My Room: built-in wardrobe on the west wall (as in the plan), bed head on the north wall left of
    // the door, desk on the east wall with the PC (Desktop agent)
    myroom: {
      left: 2, top: 57, width: 34, height: 42.5, walls: { north: false }, windows: { west: ['center'], south: ['center'] },
      items: [
        { kind: 'wardrobe', x: 0, y: 4, w: 12, d: 92, face: 'east' },
        { kind: 'bed', x: 14, y: 0, w: 44, d: 47, face: 'south' },
        { kind: 'desk', x: 66, y: 58, w: 34, d: 30, face: 'west' },
        { kind: 'plant', x: 86, y: 88, w: 11, d: 9 },
      ],
    },
    // living room: sofa on the west wall facing the TV on the east wall, rug and table between them
    living: {
      left: 36, top: 57, width: 36, height: 42.5, walls: { north: false, west: false }, windows: { south: ['wide'] },
      items: [
        { kind: 'rug', x: 24, y: 26, w: 54, d: 56 },
        { kind: 'sofa', x: 0, y: 28, w: 27, d: 52, face: 'east' },
        { kind: 'coffee-table', x: 36, y: 42, w: 18, d: 24, face: 'east' },
        { kind: 'tv', x: 87, y: 32, w: 13, d: 44, face: 'west' },
        { kind: 'plant', x: 86, y: 84, w: 11, d: 10 },
        { kind: 'plant', x: 2, y: 86, w: 11, d: 10 },
      ],
    },
    // protected room (a child's room): bed on the north wall clear of the door, dresser on the west wall,
    // play mat in the middle, humidifier in the corner
    protected: {
      left: 72, top: 57, width: 26, height: 25, windows: { east: ['center'] }, doors: { north: 'left', south: 'center' },
      items: [
        { kind: 'single-bed', x: 56, y: 2, w: 42, d: 78, face: 'south' },
        { kind: 'dresser', x: 0, y: 34, w: 13, d: 36, face: 'east' },
        { kind: 'rug', x: 18, y: 32, w: 34, d: 44 },
        { kind: 'humidifier', x: 3, y: 80, w: 11, d: 13 },
      ],
    },
    veranda: {
      left: 74, top: 82, width: 17, height: 10, walls: { north: false }, windows: { south: ['wide'] },
      items: [
        { kind: 'tiles', x: 4, y: 8, w: 92, d: 84 },
        { kind: 'plant', x: 6, y: 18, w: 18, d: 64 },
        { kind: 'plant', x: 76, y: 18, w: 18, d: 64 },
      ],
    },
    outdoor: { left: 91, top: 82, width: 8.5, height: 10, items: [{ kind: 'ac-unit', x: 10, y: 14, w: 80, d: 56, face: 'south' }] },
  },
  hall: null,
  // Where the person marker stands when My Room is occupied.
  anchors: { myroom: [20, 90] },
  routes: {},
  // Where each agent stands. The phone (Mobile) is with the user, not in the house: AgentScene shows
  // it in the view's bottom-left corner.
  agents: {
    orchestrator: [56, 65],
    room1: [14, 86],
    room2: [81, 70],
    desktop: [34, 88],
  },
  // The room each agent stands in; in a room close-up only that room's agents show.
  agentRoom: { orchestrator: 'living', room1: 'myroom', room2: 'protected', desktop: 'myroom' },
};

/** Rooms and devices of the real house. `entity` is the Home Assistant entity the device shows; spaces
 * without an agent have no devices. */
export const LIVE_ROOMS = [
  {
    id: 'living', name: '거실', en: 'Living Room', className: 'room-living', icon: Sofa, agent: 'orchestrator',
    description: '공용 공간 · Home 에이전트',
    devices: [
      { id: 'living-light', entity: 'input_boolean.living_light', name: '조명', type: 'light' },
      { id: 'living-tv', entity: 'input_boolean.living_tv', name: 'TV', type: 'tv' },
    ],
  },
  {
    id: 'myroom', name: '내 방 (침실1·안방)', en: 'My Room', className: 'room-myroom', icon: BedDouble, agent: 'room1',
    description: '개인 방 · My Room 에이전트',
    devices: [
      { id: 'myroom-light', entity: 'input_boolean.room1_light', name: '조명', type: 'light' },
      { id: 'myroom-ac', entity: 'input_boolean.room1_ac', name: '에어컨', type: 'air' },
    ],
  },
  {
    id: 'protected', name: '보호 방 (침실2)', en: 'Protected Room', className: 'room-protected', icon: ShieldCheck, agent: 'room2',
    description: '수면·안전 정책 방 · 보호 방 에이전트',
    devices: [
      { id: 'protected-light', entity: 'input_boolean.room2_light', name: '조명', type: 'light' },
      { id: 'protected-ac', entity: 'input_boolean.room2_ac', name: '에어컨', type: 'air' },
    ],
  },
  { id: 'bedroom3', name: '침실3', en: 'Bedroom 3', className: 'room-bedroom3', icon: BedDouble, agent: null, description: '에이전트·기기 없음', devices: [] },
  { id: 'kitchen', name: '주방·식당', en: 'Kitchen', className: 'room-kitchen', icon: CookingPot, agent: null, description: '에이전트·기기 없음', devices: [] },
  { id: 'entrance', name: '현관', en: 'Entrance', className: 'room-entrance', icon: DoorOpen, agent: null, description: '에이전트·기기 없음', devices: [] },
  { id: 'bath1', name: '공용욕실', en: 'Bath', className: 'room-bath1', icon: ShowerHead, agent: null, description: '에이전트·기기 없음', devices: [] },
  { id: 'bath2', name: '부부욕실', en: 'Bath 2', className: 'room-bath2', icon: ShowerHead, agent: null, description: '에이전트·기기 없음', devices: [] },
  { id: 'hall', name: '복도', en: 'Hall', className: 'room-hall', icon: DoorOpen, agent: null, description: '에이전트·기기 없음', devices: [] },
  { id: 'veranda', name: '발코니', en: 'Balcony', className: 'room-veranda', icon: Sun, agent: null, description: '에이전트·기기 없음', devices: [] },
  { id: 'veranda2', name: '발코니 (다용도)', en: 'Utility balcony', className: 'room-veranda', icon: Sun, agent: null, description: '에이전트·기기 없음', devices: [] },
  { id: 'outdoor', name: '실외기실', en: 'AC unit', className: 'room-outdoor', icon: Sun, agent: null, description: '에이전트·기기 없음', devices: [] },
];
