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
 * where a door is in a shared wall, only the room with the door draws that wall. The kitchen (with its
 * counter nook) and the L-shaped hallway are rooms of two rectangles (`partOf`).
 */
export const LIVE_PLAN = {
  className: 'plan-live',
  topRotation: 0, // TOP VIEW shows it like the floor plan drawing, north up
  rooms: {
    bedroom3: { left: 0.5, top: 8, width: 31, height: 30, furniture: 'bed', appliances: [], windows: { north: ['center'], west: ['center'] }, doors: { south: 'right' } },
    veranda2: { left: 31.5, top: 1.5, width: 15.5, height: 17.5, furniture: 'veranda', appliances: ['washer'], windows: { north: ['center'] }, doors: { south: 'center' } },
    kitchen: { left: 31.5, top: 19, width: 35.5, height: 30, furniture: 'dining', appliances: [], walls: { north: false, south: false, west: false }, join: ['north'] },
    'kitchen-nook': { partOf: 'kitchen', left: 47, top: 0.5, width: 20, height: 18.5, furniture: 'counter', appliances: ['hood'], walls: { south: false, west: false }, windows: { north: ['center'] }, join: ['south'] },
    entrance: { left: 67, top: 29, width: 15, height: 20, furniture: 'none', appliances: [], walls: { south: false, west: false, east: false }, doors: { north: 'center' } },
    bath1: { left: 82, top: 34, width: 17.5, height: 23, furniture: 'bath', appliances: [], doors: { west: 'bottom' } },
    bath2: { left: 2, top: 38, width: 15, height: 19, furniture: 'bath', appliances: [], doors: { south: 'center' } },
    hall: { left: 31.5, top: 49, width: 50.5, height: 8, furniture: 'none', appliances: [], walls: { north: false, south: false, east: false, west: false }, join: ['west'] },
    'hall-west': { partOf: 'hall', left: 17, top: 38, width: 14.5, height: 19, furniture: 'none', appliances: [], walls: { north: false, east: false, west: false }, doors: { south: 'center' }, join: ['east'] },
    myroom: { left: 2, top: 57, width: 34, height: 42.5, furniture: 'bed-desk', appliances: ['computer'], walls: { north: false }, windows: { west: ['center'], south: ['center'] } },
    living: { left: 36, top: 57, width: 36, height: 42.5, furniture: 'sofa', appliances: ['tv'], walls: { north: false, west: false }, windows: { south: ['wide'] } },
    protected: { left: 72, top: 57, width: 26, height: 25, furniture: 'bed', appliances: ['humidifier'], windows: { east: ['center'] }, doors: { north: 'left', south: 'center' } },
    veranda: { left: 74, top: 82, width: 17, height: 10, furniture: 'veranda', appliances: [], walls: { north: false }, windows: { south: ['wide'] } },
    outdoor: { left: 91, top: 82, width: 8.5, height: 10, furniture: 'none', appliances: [] },
  },
  hall: null,
  // Where the person marker stands when My Room is occupied.
  anchors: { myroom: [20, 80] },
  routes: {},
  // Where each agent stands. The phone (Mobile) is with the user, not in the house: AgentScene shows
  // it in the view's bottom-left corner.
  agents: {
    orchestrator: [54, 76],
    room1: [22, 70],
    room2: [85, 66],
    desktop: [7.5, 86],
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
