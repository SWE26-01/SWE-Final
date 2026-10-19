// The house as the agents really run it (LIVE): the living room with the Home agent, My Room (room1)
// and the protected room (room2), and the Home Assistant devices in each (agents/**/openclaw.json5
// `owned`, services/config/devices.yaml). MOCK keeps the demo apartment in Home3D.jsx.
import { BedDouble, ShieldCheck, Sofa } from 'lucide-react';
import './house.css';

/**
 * Floor plan for Home3D, in % of the house box: the two rooms side by side at the back, the living
 * room (sofa and dining table) across the front with the front door. Same shape as Home3D's demo
 * `layout` entries; house.css sizes the box and the living room's furniture.
 */
export const LIVE_PLAN = {
  className: 'plan-live',
  rooms: {
    myroom: { left: 1, top: 1, width: 49, height: 43, furniture: 'bed-desk', appliances: ['computer'], windows: { north: ['center'], west: ['center'] }, doors: { south: 'right' } },
    protected: { left: 50, top: 1, width: 49, height: 43, furniture: 'bed', appliances: ['humidifier'], windows: { north: ['center'], east: ['center'] }, doors: { south: 'left' } },
    living: { left: 1, top: 44, width: 98, height: 55, furniture: 'living-dining', appliances: ['tv'], walls: { north: false }, windows: { west: ['center'], east: ['center'] }, doors: { south: 'right' } },
  },
  hall: null,
  // Where the person marker stands when My Room is occupied.
  anchors: { myroom: [30, 24] },
  routes: {},
  // Where each agent stands. Mobile is the phone, with the user, outside the front door.
  agents: {
    orchestrator: [50, 72],
    room1: [33, 13],
    room2: [72, 13],
    desktop: [10, 31],
    smartphone: [80, 108],
  },
  // The room each agent stands in; in a room close-up only that room's agents show.
  agentRoom: { orchestrator: 'living', room1: 'myroom', room2: 'protected', desktop: 'myroom', smartphone: null },
};

/** Rooms and devices of the real house. `entity` is the Home Assistant entity the device shows. */
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
    id: 'myroom', name: '내 방', en: 'My Room', className: 'room-myroom', icon: BedDouble, agent: 'room1',
    description: '개인 방 · My Room 에이전트',
    devices: [
      { id: 'myroom-light', entity: 'input_boolean.room1_light', name: '조명', type: 'light' },
      { id: 'myroom-ac', entity: 'input_boolean.room1_ac', name: '에어컨', type: 'air' },
    ],
  },
  {
    id: 'protected', name: '보호 방', en: 'Protected Room', className: 'room-protected', icon: ShieldCheck, agent: 'room2',
    description: '수면·안전 정책 방 · 보호 방 에이전트',
    devices: [
      { id: 'protected-light', entity: 'input_boolean.room2_light', name: '조명', type: 'light' },
      { id: 'protected-ac', entity: 'input_boolean.room2_ac', name: '에어컨', type: 'air' },
    ],
  },
];
