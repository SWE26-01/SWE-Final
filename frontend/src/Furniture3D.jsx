// Furniture and appliances as real boxes (CSS 3D): every piece has a top and four sides, so it stands
// in the room instead of lying flat. x, y, w, d are the footprint in % of the room; z (lift) and h
// (height) are in px, like the walls. The faces are shaded so the light seems to come from the back.
import React from 'react';
import './furniture3d.css';

const C = {
  frame: '#e3e9ed', fabric: '#d3dee6', soft: '#f1f4f6', linen: '#fbfbf8', white: '#f8fafb', steel: '#dbe3e9',
  wood: '#e6dccd', dark: '#3c4950', screen: '#56717f', green: '#8fb79c', leaf: '#a9cdb3', pot: '#d8c7b1', accent: '#e1e5ac', water: '#d6e6ee',
};

/**
 * `children` are drawn on the top. `deco` ({ side: 'n'|'s'|'e'|'w', cls }) dresses one side, e.g. a
 * screen or a washer door; `screen` is a shortcut for a screen on that side.
 */
export function Box({ x, y, w, d, z = 0, h, c, r = 0, screen = null, deco = screen ? { side: screen, cls: 'screen-face' } : null, children }) {
  const style = { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${d}%`, '--z': `${z}px`, '--h': `${h}px`, '--c': c, '--r': `${r}px` };
  const side = (name) => `bx-${name} ${deco?.side === name ? deco.cls : ''}`;
  return (
    <div className={`bx ${z === 0 ? 'on-floor' : ''}`} style={style} aria-hidden="true">
      <i className={side('n')} /><i className={side('w')} /><i className={side('e')} /><i className={side('s')} />
      <i className="bx-t">{children}</i>
    </div>
  );
}

/** A flat round shape at height z (table top, burner, plant crown, basin). */
function Disc({ x, y, w, d, z, c }) {
  return <i className="disc" style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${d}%`, '--z': `${z}px`, '--c': c }} aria-hidden="true" />;
}

function Plant({ x, y, size = 1 }) {
  return (
    <>
      <Box x={x + 2 * size} y={y + 5 * size} w={7 * size} d={8 * size} h={9} c={C.pot} r={2} />
      <Disc x={x} y={y} w={11 * size} d={14 * size} z={14} c={C.green} />
      <Disc x={x + 1.8 * size} y={y + 2.5 * size} w={7.5 * size} d={9 * size} z={20} c={C.leaf} />
    </>
  );
}

const Bed = () => (
  <>
    <Box x={24} y={14} w={50} d={4} h={26} c={C.frame} />
    <Box x={24} y={18} w={50} d={52} h={7} c={C.frame} />
    <Box x={26} y={19} w={46} d={50} z={7} h={6} c={C.linen} r={3} />
    <Box x={29} y={21} w={18} d={8} z={13} h={4} c={C.white} r={3} />
    <Box x={51} y={21} w={18} d={8} z={13} h={4} c={C.white} r={3} />
    <Box x={26} y={40} w={46} d={29} z={13} h={2} c={C.accent} r={2} />
  </>
);

const Wardrobe = () => <Box x={76} y={35} w={19} d={49} h={40} c={C.steel} />;

/** Desk against the west wall with the chair on its east side; `x`, `y` move the whole set. */
const Desk = ({ x = 5, y = 58, w = 22, d = 25 }) => (
  <>
    <Box x={x} y={y} w={2} d={d} h={15} c={C.wood} />
    <Box x={x + w - 2} y={y} w={2} d={d} h={15} c={C.wood} />
    <Box x={x} y={y} w={w} d={d} z={15} h={3} c={C.wood} />
    <Box x={x + w + 2} y={y + 6} w={10} d={d - 12} h={9} c={C.fabric} r={2} />
    <Box x={x + w + 10} y={y + 6} w={2} d={d - 12} z={9} h={12} c={C.fabric} />
  </>
);

/** Monitor standing on the desk, facing east (the chair), with its stand and keyboard. */
const Computer = () => (
  <>
    <Box x={8.5} y={68} w={2} d={3} z={18} h={5} c={C.steel} />
    <Box x={8} y={61} w={1.6} d={17} z={23} h={14} c={C.dark} screen="e" />
    <Box x={14} y={63} w={5} d={11} z={18} h={1} c={C.soft} />
  </>
);

const Sofa = () => (
  <>
    <Box x={10} y={16} w={54} d={6} h={22} c={C.fabric} r={2} />
    <Box x={10} y={22} w={54} d={18} h={9} c={C.fabric} r={2} />
    <Box x={7} y={16} w={3} d={24} h={15} c={C.fabric} r={2} />
    <Box x={64} y={16} w={3} d={24} h={15} c={C.fabric} r={2} />
    {[0, 1, 2].map((i) => <Box key={i} x={11 + i * 17.7} y={23} w={16.5} d={15} z={9} h={3} c={C.soft} r={2} />)}
  </>
);

const CoffeeTable = () => (
  <>
    <Box x={66} y={59} w={4} d={5} h={11} c={C.steel} />
    <Disc x={55} y={49} w={26} d={25} z={11} c={C.soft} />
  </>
);

/** Dining table with four legs and a chair at each corner side. */
const Dining = ({ x = 28, y = 18, w = 42, d = 58 }) => {
  const cw = w * 0.26;
  const cd = d * 0.16;
  const chairs = [
    [x - w * 0.34, y + d * 0.09, 'west'], [x + w * 1.34 - cw, y + d * 0.09, 'east'],
    [x - w * 0.34, y + d * 0.91 - cd, 'west'], [x + w * 1.34 - cw, y + d * 0.91 - cd, 'east'],
  ];
  return (
    <>
      {[[x + 1, y + 1], [x + w - 3.5, y + 1], [x + 1, y + d - 4], [x + w - 3.5, y + d - 4]].map(([lx, ly]) => <Box key={`${lx}-${ly}`} x={lx} y={ly} w={2.5} d={3} h={13} c={C.wood} />)}
      <Box x={x} y={y} w={w} d={d} z={13} h={3} c={C.wood} r={2} />
      {chairs.map(([cx, cy, side]) => (
        <React.Fragment key={`${cx}-${cy}`}>
          <Box x={cx} y={cy} w={cw} d={cd} h={8} c={C.fabric} r={2} />
          <Box x={side === 'west' ? cx : cx + cw - 2} y={cy} w={2} d={cd} z={8} h={12} c={C.fabric} />
        </React.Fragment>
      ))}
    </>
  );
};

const Kitchen = () => (
  <>
    <Box x={57} y={8} w={36} d={70} h={16} c={C.steel}>
      {[[14, 18], [57, 18], [14, 43], [57, 43]].map(([bx, by]) => <i key={`${bx}-${by}`} className="burner" style={{ left: `${bx}%`, top: `${by}%` }} />)}
    </Box>
    <Box x={7} y={30} w={27} d={38} h={16} c={C.soft} />
    <Box x={5} y={6} w={28} d={22} h={44} c={C.white} />
  </>
);

const Bath = () => (
  <>
    <Box x={24} y={17} w={53} d={51} h={10} c={C.white} r={6} />
    <Box x={28} y={21} w={45} d={43} z={8} h={2.5} c={C.water} r={5} />
    <Box x={7} y={69} w={25} d={18} h={14} c={C.white} r={2} />
    <Disc x={11} y={71} w={17} d={13} z={14.5} c={C.water} />
  </>
);

const Veranda = () => (
  <>
    <div className="veranda-grid-3d" />
    <Plant x={12} y={20} />
    <Plant x={72} y={18} />
  </>
);

const FURNITURE = {
  bed: () => <><Bed /><Wardrobe /></>,
  'bed-desk': () => <><Bed /><Wardrobe /><Desk /></>,
  desk: () => <Desk x={25} y={20} w={52} d={25} />,
  sofa: () => <><Sofa /><CoffeeTable /><Plant x={15} y={56} /></>,
  counter: Kitchen,
  dining: () => <><Dining /><Box x={6} y={39} w={17} d={54} h={14} c={C.steel} /></>,
  veranda: Veranda,
  bath: Bath,
};

// --- Pieces placed one by one (a plan room's `items`) ------------------------------------------------
//
// Each piece is drawn facing south in its own footprint: u across, v from its back (0, against the wall)
// to its front (100), both in % of the footprint. `face` turns it so its front looks north, south, east
// or west, and the footprint (x, y, w, d in % of the room) is where it stands.

const box = (u, v, w, d, h, c, more = {}) => ({ u, v, w, d, h, c, z: 0, ...more });
const disc = (u, v, w, d, z, c) => ({ disc: true, u, v, w, d, z, c });
const legs = (h, c, inset = 4) => [[inset, inset], [100 - inset - 6, inset], [inset, 100 - inset - 8], [100 - inset - 6, 100 - inset - 8]].map(([u, v]) => box(u, v, 6, 8, h, c));
const bedParts = (pillows) => [
  box(0, 0, 100, 8, 26, C.frame),
  box(0, 8, 100, 92, 7, C.frame),
  box(3, 9, 94, 89, 6, C.linen, { z: 7, r: 3 }),
  ...pillows.map(([u, w]) => box(u, 11, w, 12, 4, C.white, { z: 13, r: 3 })),
  box(3, 42, 94, 56, 2, C.accent, { z: 13, r: 2 }),
];

const PIECES = {
  bed: bedParts([[8, 38], [54, 38]]),
  'single-bed': bedParts([[18, 64]]),
  wardrobe: [box(0, 0, 100, 100, 42, C.steel, { front: 'doors-face' })],
  'shoe-cabinet': [box(0, 0, 100, 100, 30, C.wood, { front: 'doors-face' })],
  dresser: [box(0, 0, 100, 100, 18, C.wood, { front: 'drawers-face' })],
  // desk against the wall, monitor facing the chair, chair in front
  desk: [
    box(0, 0, 5, 55, 15, C.wood), box(95, 0, 5, 55, 15, C.wood), box(0, 0, 100, 55, 3, C.wood, { z: 15 }),
    box(44, 10, 12, 8, 5, C.steel, { z: 18 }), box(20, 6, 60, 5, 15, C.dark, { z: 23, front: 'screen-face' }),
    box(28, 30, 44, 12, 1, C.soft, { z: 18 }),
    box(30, 62, 40, 26, 9, C.fabric, { r: 2 }), box(30, 88, 40, 8, 12, C.fabric, { z: 9 }),
  ],
  // a desk without a computer (only My Room's desk has the PC the Desktop agent runs on)
  'study-desk': [
    box(0, 0, 5, 55, 15, C.wood), box(95, 0, 5, 55, 15, C.wood), box(0, 0, 100, 55, 3, C.wood, { z: 15 }),
    box(30, 62, 40, 26, 9, C.fabric, { r: 2 }), box(30, 88, 40, 8, 12, C.fabric, { z: 9 }),
  ],
  sofa: [
    box(0, 0, 100, 26, 22, C.fabric, { r: 2 }), box(0, 26, 100, 74, 9, C.fabric, { r: 2 }),
    box(0, 0, 6, 100, 15, C.fabric, { r: 2 }), box(94, 0, 6, 100, 15, C.fabric, { r: 2 }),
    ...[0, 1, 2].map((i) => box(7 + i * 29, 28, 28, 68, 3, C.soft, { z: 9, r: 2 })),
  ],
  'coffee-table': [...legs(10, C.wood), box(0, 0, 100, 100, 3, C.wood, { z: 10, r: 2 })],
  rug: [box(0, 0, 100, 100, 0.6, '#e9eee4', { r: 4 })],
  // TV stand against the wall, the screen facing the room
  tv: [box(0, 0, 100, 100, 10, C.steel), box(6, 18, 88, 10, 26, C.dark, { z: 10, front: 'screen-face' })],
  plant: [box(25, 25, 50, 50, 9, C.pot, { r: 2 }), disc(5, 0, 90, 90, 14, C.green), disc(20, 15, 60, 60, 21, C.leaf)],
  // table with two chairs on each long side
  dining: [
    ...[[12, 27], [82, 27], [12, 66], [82, 66]].map(([u, v]) => box(u, v, 6, 7, 13, C.wood)),
    box(10, 25, 80, 50, 3, C.wood, { z: 13, r: 2 }),
    ...[18, 58].flatMap((u) => [
      box(u, 2, 24, 18, 8, C.fabric, { r: 2 }), box(u, 0, 24, 4, 12, C.fabric, { z: 8 }),
      box(u, 80, 24, 18, 8, C.fabric, { r: 2 }), box(u, 96, 24, 4, 12, C.fabric, { z: 8 }),
    ]),
  ],
  counter: [box(0, 0, 100, 100, 16, C.steel, { front: 'drawers-face' })],
  stove: [box(0, 0, 100, 100, 16, C.steel, { front: 'drawers-face', burners: true })],
  'sink-counter': [box(0, 0, 100, 100, 16, C.steel, { front: 'drawers-face' }), disc(22, 30, 56, 40, 16.5, C.water)],
  fridge: [box(0, 0, 100, 100, 46, C.white, { front: 'doors-face' })],
  hood: [box(0, 0, 100, 100, 8, C.steel, { z: 32 })],
  tub: [box(0, 0, 100, 100, 10, C.white, { r: 6 }), box(5, 10, 90, 80, 2.5, C.water, { z: 8, r: 5 })],
  vanity: [box(0, 0, 100, 100, 14, C.white, { r: 2 }), disc(20, 20, 60, 60, 14.5, C.water)],
  toilet: [box(15, 0, 70, 30, 18, C.white, { r: 2 }), box(20, 30, 60, 62, 9, C.white, { r: 8 })],
  shower: [box(0, 0, 100, 100, 1.5, C.water, { r: 2 }), box(0, 94, 100, 6, 30, 'rgba(214,232,244,.55)')],
  washer: [box(0, 0, 100, 100, 22, C.white, { r: 2, front: 'washer-face' })],
  'utility-sink': [box(0, 0, 100, 100, 14, C.steel), disc(15, 20, 70, 60, 14.5, C.water)],
  humidifier: [box(10, 10, 80, 80, 12, C.white, { r: 3 }), disc(30, 30, 40, 40, 12.5, C.water)],
  'ac-unit': [box(0, 0, 100, 100, 16, C.steel, { front: 'fan-face' })],
};

const FACE_SIDE = { south: 's', north: 'n', east: 'e', west: 'w' };

/** Local footprint rect (u, v, w, d) of a piece facing `face`, in % of the room. */
function placeRect({ x, y, w, d }, face, p) {
  if (face === 'north') return { x: x + ((100 - p.u - p.w) / 100) * w, y: y + ((100 - p.v - p.d) / 100) * d, w: (p.w / 100) * w, d: (p.d / 100) * d };
  if (face === 'east') return { x: x + (p.v / 100) * w, y: y + (p.u / 100) * d, w: (p.d / 100) * w, d: (p.w / 100) * d };
  if (face === 'west') return { x: x + ((100 - p.v - p.d) / 100) * w, y: y + (p.u / 100) * d, w: (p.d / 100) * w, d: (p.w / 100) * d };
  return { x: x + (p.u / 100) * w, y: y + (p.v / 100) * d, w: (p.w / 100) * w, d: (p.d / 100) * d };
}

function Item({ kind, x, y, w, d, face = 'south' }) {
  if (kind === 'tiles') return <div className="veranda-grid-3d" style={{ inset: 'auto', left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${d}%` }} />;
  const parts = PIECES[kind];
  if (!parts) return null;
  return parts.map((part, index) => {
    const rect = placeRect({ x, y, w, d }, face, part);
    if (part.disc) return <Disc key={index} {...rect} z={part.z} c={part.c} />;
    return (
      <Box key={index} {...rect} z={part.z} h={part.h} c={part.c} r={part.r || 0} deco={part.front ? { side: FACE_SIDE[face], cls: part.front } : null}>
        {part.burners && [[14, 18], [57, 18], [14, 58], [57, 58]].map(([bx, by]) => <i key={`${bx}-${by}`} className="burner" style={{ left: `${bx}%`, top: `${by}%` }} />)}
      </Box>
    );
  });
}

/** A room's furniture: its own `items` (the real house), or a standard set by `type` (demo apartment). */
export function Furniture3D({ type, items }) {
  if (items) return items.map((item, index) => <Item key={`${item.kind}-${index}`} {...item} />);
  if (!type || type === 'none') return null;
  const Piece = FURNITURE[type] || Bath;
  return <Piece />;
}

const APPLIANCES = {
  tv: () => (
    <>
      <Box x={88} y={30} w={8} d={36} h={9} c={C.steel} />
      <Box x={92} y={32} w={1.4} d={32} z={9} h={20} c={C.dark} screen="w" />
    </>
  ),
  purifier: () => <Box x={77} y={71} w={9} d={16} h={22} c={C.white} r={2}><i className="vent" /></Box>,
  computer: Computer,
  humidifier: () => <><Box x={82} y={86} w={7} d={9} h={12} c={C.white} r={3} /><Disc x={83.5} y={87.5} w={4} d={6} z={12.5} c={C.water} /></>,
  washer: () => <Box x={73} y={18} w={18} d={53} h={22} c={C.white} r={2}><i className="washer-door" /></Box>,
  hood: () => <Box x={67} y={15} w={18} d={20} z={32} h={8} c={C.steel} />,
};

export function Appliance3D({ kind }) {
  const Piece = APPLIANCES[kind];
  return Piece ? <Piece /> : null;
}
