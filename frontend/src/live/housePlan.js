// The house as the agents really run it (LIVE): the living room with the Home agent, My Room (room1)
// and the protected room (room2), and the Home Assistant devices in each (agents/**/openclaw.json5
// `owned`, services/config/devices.yaml). MOCK keeps the demo apartment in Home3D.jsx.
import { BedDouble, CookingPot, DoorOpen, ShieldCheck, ShowerHead, Sofa, Sun } from 'lucide-react';
import './house.css';

/**
 * Floor plan for Home3D, in % of the house box: a common Korean 3-bay apartment with two rooms
 * (about 59 m², 9.9 m x 7.6 m). Front (south, bottom of the plan): the small room (protected room),
 * the living room and the main bedroom (My Room), with the balcony in front of them. Back: the
 * bathroom, the entrance, the kitchen and dining area open to the living room, and the main
 * bedroom's bathroom. Where two rooms share a wall only one of them draws it.
 */
export const LIVE_PLAN = {
  className: 'plan-live',
  rooms: {
    bath1: { left: 1, top: 1, width: 21, height: 33, furniture: 'bath', walls: { south: false }, windows: { north: ['center'] }, doors: { east: 'center' } },
    entrance: { left: 22, top: 1, width: 14, height: 33, furniture: 'none', walls: { south: false, east: false, west: false }, doors: { north: 'center' } },
    kitchen: { left: 36, top: 1, width: 30, height: 33, furniture: 'counter', walls: { south: false }, windows: { north: ['center'] } },
    bath2: { left: 66, top: 1, width: 33, height: 33, furniture: 'bath', walls: { west: false }, windows: { north: ['center'] }, doors: { south: 'center' } },
    protected: { left: 1, top: 34, width: 27, height: 52, furniture: 'bed', appliances: ['humidifier'], windows: { west: ['center'], south: ['center'] }, doors: { east: 'top' } },
    living: { left: 28, top: 34, width: 38, height: 52, furniture: 'sofa', appliances: ['tv'], walls: { north: false, west: false, east: false }, windows: { south: ['wide'] } },
    myroom: { left: 66, top: 34, width: 33, height: 52, furniture: 'bed-desk', appliances: ['computer'], walls: { north: false }, windows: { east: ['center'], south: ['center'] }, doors: { west: 'top' } },
    veranda: { left: 1, top: 86, width: 98, height: 13, furniture: 'veranda', walls: { north: false }, windows: { south: ['wide'] } },
  },
  hall: null,
  // Where the person marker stands when My Room is occupied.
  anchors: { myroom: [84, 62] },
  routes: {},
  // Where each agent stands. The phone (Mobile) is with the user, not in the house: AgentScene shows
  // it in the view's bottom-left corner.
  agents: {
    orchestrator: [47, 64],
    room1: [86, 50],
    room2: [14, 52],
    desktop: [71, 69],
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
    id: 'myroom', name: '내 방 (안방)', en: 'My Room', className: 'room-myroom', icon: BedDouble, agent: 'room1',
    description: '개인 방 · My Room 에이전트',
    devices: [
      { id: 'myroom-light', entity: 'input_boolean.room1_light', name: '조명', type: 'light' },
      { id: 'myroom-ac', entity: 'input_boolean.room1_ac', name: '에어컨', type: 'air' },
    ],
  },
  {
    id: 'protected', name: '보호 방 (작은방)', en: 'Protected Room', className: 'room-protected', icon: ShieldCheck, agent: 'room2',
    description: '수면·안전 정책 방 · 보호 방 에이전트',
    devices: [
      { id: 'protected-light', entity: 'input_boolean.room2_light', name: '조명', type: 'light' },
      { id: 'protected-ac', entity: 'input_boolean.room2_ac', name: '에어컨', type: 'air' },
    ],
  },
  { id: 'kitchen', name: '주방·식당', en: 'Kitchen', className: 'room-kitchen', icon: CookingPot, agent: null, description: '에이전트·기기 없음', devices: [] },
  { id: 'entrance', name: '현관', en: 'Entrance', className: 'room-entrance', icon: DoorOpen, agent: null, description: '에이전트·기기 없음', devices: [] },
  { id: 'bath1', name: '욕실', en: 'Bath', className: 'room-bath1', icon: ShowerHead, agent: null, description: '에이전트·기기 없음', devices: [] },
  { id: 'bath2', name: '안방 욕실', en: 'Bath 2', className: 'room-bath2', icon: ShowerHead, agent: null, description: '에이전트·기기 없음', devices: [] },
  { id: 'veranda', name: '발코니', en: 'Balcony', className: 'room-veranda', icon: Sun, agent: null, description: '에이전트·기기 없음', devices: [] },
];
