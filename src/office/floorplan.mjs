// The Parakkat AI Office floor plan: one building, ten rooms, everyone's desk, every wall and door.
// Plain data and geometry with no three.js, so routes, seats and collisions can be tested in Node.
//
// Units are metres. +x runs east, +z runs towards the street. Heading 0 faces +z.
//
//   z=-21 +---------+---------+---------+------+---------+
//         | Meeting | Leader- | Studio  |Server| Game    |
//         | room    | ship    |         | room | room    |
//  z=-8.5 +---------+---------+---------+------+---------+
//         |                  hallway                     |
//  z=-5.5 +---------+----------------+-------------------+
// terrace | Kitchen |                |                   |
//  z=7.5  +---------+     Lounge     |     Workspace     |
//         |Reception|           +----+                   |
//         |         |           | WC |                   |
//   z=21  +--[door]-+-----------+----+-------------------+
//                    plaza, then the street

export const BUILDING = { x1: -29, x2: 29, z1: -21, z2: 21, height: 3 };
export const SPAWN = { x: -22, z: 33, heading: Math.PI };
export const WORLD_BOUNDS = { x1: -44, x2: 40, z1: -30, z2: 37 };

/** The ten rooms, in the order the tour numbers them. */
export const OFFICE_ROOMS = [
  { id: 'reception', no: 1, name: 'Reception', x1: -29, x2: -15, z1: 7.5, z2: 21 },
  { id: 'workspace', no: 2, name: 'Workspace', x1: 4, x2: 29, z1: -5.5, z2: 21 },
  { id: 'meeting', no: 3, name: 'Meeting Room', x1: -29, x2: -15, z1: -21, z2: -8.5 },
  { id: 'leadership', no: 4, name: 'Leadership Suite', x1: -15, x2: -3, z1: -21, z2: -8.5 },
  { id: 'studio', no: 5, name: 'Studio', x1: -3, x2: 9, z1: -21, z2: -8.5 },
  { id: 'server', no: 6, name: 'Server Room', x1: 9, x2: 16, z1: -21, z2: -8.5 },
  { id: 'game', no: 7, name: 'Game Room', x1: 16, x2: 29, z1: -21, z2: -8.5 },
  { id: 'kitchen', no: 8, name: 'Kitchen', x1: -29, x2: -15, z1: -5.5, z2: 7.5 },
  { id: 'lounge', no: 9, name: 'Lounge', x1: -15, x2: 4, z1: -5.5, z2: 21 },
  { id: 'restrooms', no: 10, name: 'Restrooms', x1: -2, x2: 4, z1: 15, z2: 21 },
];
/** Named areas that show on the floor plan but are not numbered rooms. */
export const OTHER_AREAS = [
  { id: 'hallway', name: 'Hallway', x1: -29, x2: 29, z1: -8.5, z2: -5.5 },
  { id: 'terrace', name: 'Terrace', x1: -37, x2: -29, z1: 0, z2: 15 },
  { id: 'front', name: 'Front of the office', x1: -29, x2: 29, z1: 21, z2: 28 },
];

const inside = (r, x, z) => x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2;
/** The room or area containing a point. Restrooms sit inside the lounge's outline, so they are tested first. */
export function areaAt(x, z) {
  const order = [OFFICE_ROOMS[9], ...OFFICE_ROOMS.slice(0, 9), ...OTHER_AREAS];
  return order.find(r => inside(r, x, z)) || null;
}

/* ---------- walls ---------- */
// Finishes are named per side so a wall can be red brick on one face and plaster on the other.
export const FINISH = {
  redBrick: '#4f2318', darkWood: '#3a2518', tan: '#8d6a48', cream: '#a98c66', plaster: '#7c6a55', teal: '#37504c', grey: '#5d5a54', charcoal: '#2c2a28',
  panel: '#5a3a24', exterior: '#6a4a30', tile: '#8e8a80',
};
const W = (x1, z1, x2, z2, kind, a, b, doors = []) => ({ x1, z1, x2, z2, kind, a: FINISH[a], b: FINISH[b ?? a], doors });

export const WALLS = [
  // outside
  W(-29, -21, 29, -21, 'solid', 'exterior', 'tan'),
  W(29, -21, 29, 21, 'solid', 'redBrick', 'exterior'),
  W(-29, -21, -29, 21, 'solid', 'exterior', 'tan', [[4, 6]]),
  W(-29, 21, -15, 21, 'glass', 'charcoal', 'charcoal', [[-23.5, -20.5]]),
  W(-15, 21, 29, 21, 'solid', 'cream', 'exterior'),
  // hallway, north side
  W(-29, -8.5, 29, -8.5, 'glass', 'charcoal', 'charcoal', [[-18, -16.4], [-10.8, -9.2], [1, 2.6], [11.7, 13.3], [21.7, 23.3]]),
  // hallway, south side
  W(-29, -5.5, 4, -5.5, 'glass', 'charcoal', 'charcoal', [[-18, -16.4], [-6.5, -2.5]]),
  W(4, -5.5, 12, -5.5, 'glass', 'charcoal', 'charcoal', [[7, 9.4]]),
  W(12, -5.5, 25, -5.5, 'solid', 'darkWood', 'redBrick'),
  W(25, -5.5, 29, -5.5, 'glass', 'charcoal'),
  // back row dividers
  W(-15, -21, -15, -8.5, 'solid', 'tan', 'redBrick'),
  W(-3, -21, -3, -8.5, 'solid', 'redBrick', 'charcoal'),
  W(9, -21, 9, -8.5, 'solid', 'charcoal', 'grey'),
  W(16, -21, 16, -8.5, 'solid', 'grey', 'darkWood'),
  // front row dividers
  W(-29, 7.5, -15, 7.5, 'solid', 'cream', 'panel', [[-16.8, -15.4]]),
  W(-15, -5.5, -15, 7.5, 'solid', 'cream', 'tan'),
  W(-15, 7.5, -15, 21, 'glass', 'charcoal', 'charcoal', [[12, 14]]),
  W(4, -5.5, 4, 15, 'glass', 'charcoal', 'charcoal', [[3, 5]]),
  W(4, 15, 4, 21, 'solid', 'tile', 'redBrick'),
  // restrooms
  W(-2, 15, -2, 21, 'solid', 'tan', 'tile'),
  W(-2, 15, 4, 15, 'solid', 'tan', 'tile', [[-1.3, -.1], [2.1, 3.3]]),
  W(1, 15, 1, 21, 'solid', 'tile'),
];

/** Sliding entrances. They open only when someone is walking towards them. */
export const AUTO_DOORS = [
  { id: 'front', axis: 'x', a: -23.5, b: -20.5, at: 21 },
  { id: 'terrace', axis: 'z', a: 4, b: 6, at: -29 },
];

const THICK = .2;
/** Wall lengths with the door gaps cut out, as straight pieces. */
export function wallPieces(walls = WALLS) {
  const out = [];
  for (const w of walls) {
    const alongX = w.z1 === w.z2, from = alongX ? w.x1 : w.z1, to = alongX ? w.x2 : w.z2;
    let at = from;
    for (const [a, b] of [...w.doors].sort((p, q) => p[0] - q[0])) {
      if (a > at) out.push({ ...w, from: at, to: a, alongX, line: alongX ? w.z1 : w.x1 });
      at = b;
    }
    if (at < to) out.push({ ...w, from: at, to, alongX, line: alongX ? w.z1 : w.x1 });
  }
  return out;
}
const pieceBox = p => p.alongX
  ? { x1: p.from, x2: p.to, z1: p.line - THICK / 2, z2: p.line + THICK / 2 }
  : { x1: p.line - THICK / 2, x2: p.line + THICK / 2, z1: p.from, z2: p.to };

const solidPieces = wallPieces().filter(p => p.kind === 'solid');
/** True when a solid wall stands between two points. Glass does not count: you can see through it. */
export function sightBlocked(x1, z1, x2, z2) {
  for (const w of solidPieces) {
    const a = w.alongX ? z1 : x1, b = w.alongX ? z2 : x2;
    if ((a - w.line) * (b - w.line) > 0) continue;
    const t = (w.line - a) / ((b - a) || 1e-9), along = w.alongX ? x1 + (x2 - x1) * t : z1 + (z2 - z1) * t;
    if (along >= w.from && along <= w.to) return true;
  }
  return false;
}

/* ---------- the workspace ---------- */
const CUBICLE = { width: 2.4, chair: 1.55, deskZone: 1.02, firstX: 7.4, secondGroupGap: 2.2 };
export const CUBICLE_PAIRS = [0, 5.6, 11.2, 16.8];
const cubicleX = i => CUBICLE.firstX + CUBICLE.width * i + (i >= 4 ? CUBICLE.secondGroupGap : 0);
/** Eight rows of up to eight desks; each row keeps its departments together. */
const WORKSPACE_ROWS = [
  ['insights', 'intel'], ['strategy', 'creative'], ['social', 'seo'], ['perf', 'customer'],
  ['warroom', 'qa'], ['goldrate', 'forecast'], ['catalog', 'lang'], ['crm', 'brand'],
];
export const cubicleSlots = () => {
  const list = [];
  for (let row = 0; row < 8; row++) {
    const pair = row >> 1, south = row % 2 === 1, z = CUBICLE_PAIRS[pair] + (south ? CUBICLE.chair : -CUBICLE.chair);
    for (let i = 0; i < 8; i++) list.push({ row, col: i, x: cubicleX(i), z, heading: south ? Math.PI : 0, south, pairZ: CUBICLE_PAIRS[pair] });
  }
  return list;
};
export const CUBICLE_SIZE = CUBICLE;

/** Fixed places for the teams that keep their own rooms. Heading faces the desk. */
const ROOM_SEATS = {
  board: [{ x: -9, z: -17.6, heading: 0 }],
  lead: [{ x: -12.9, z: -17, heading: -Math.PI / 2 }, { x: -12.9, z: -13.6, heading: -Math.PI / 2 }, { x: -5.1, z: -19, heading: Math.PI / 2 }, { x: -5.1, z: -15.6, heading: Math.PI / 2 }],
  photo: [{ x: 7.2, z: -18.4, heading: Math.PI / 2 }, { x: 7.2, z: -16, heading: Math.PI / 2 }, { x: 7.2, z: -13.6, heading: Math.PI / 2 }, { x: 7.2, z: -11.2, heading: Math.PI / 2 }],
  reels: [{ x: -1.2, z: -16, heading: -Math.PI / 2 }, { x: -1.2, z: -13.6, heading: -Math.PI / 2 }, { x: -1.2, z: -11.2, heading: -Math.PI / 2 }],
  datahub: [{ x: 10.7, z: -12.4, heading: -Math.PI / 2 }, { x: 10.7, z: -10.2, heading: -Math.PI / 2 }, { x: 14.3, z: -12.4, heading: Math.PI / 2 }, { x: 14.3, z: -10.2, heading: Math.PI / 2 }],
};

/** Every person's chair, keyed by person id. Pure function of the roster. */
export function seatsFor(people) {
  const seats = {}, byDept = new Map();
  for (const p of people) { if (!byDept.has(p.room)) byDept.set(p.room, []); byDept.get(p.room).push(p); }
  for (const list of byDept.values()) list.sort((a, b) => a.seat - b.seat);
  for (const [dept, list] of byDept) {
    if (!ROOM_SEATS[dept]) continue;
    list.forEach((p, i) => { const s = ROOM_SEATS[dept][i]; if (s) seats[p.id] = { ...s, area: areaAt(s.x, s.z).id, dept }; });
  }
  const slots = cubicleSlots();
  WORKSPACE_ROWS.forEach((depts, row) => {
    const rowSlots = slots.filter(s => s.row === row);
    let next = 0;
    for (const dept of depts) for (const p of byDept.get(dept) || []) {
      const s = rowSlots[next++]; if (s) seats[p.id] = { x: s.x, z: s.z, heading: s.heading, area: 'workspace', dept, row, col: s.col };
    }
  });
  return seats;
}

/** Where each department's team sits: the centre of its desks, for the map and camera. */
export function teamCentres(people, seats = seatsFor(people)) {
  const sum = {};
  for (const p of people) { const s = seats[p.id]; if (!s) continue; const t = sum[p.room] ||= { x: 0, z: 0, n: 0, area: s.area }; t.x += s.x; t.z += s.z; t.n++; }
  return Object.fromEntries(Object.entries(sum).map(([id, t]) => [id, { x: t.x / t.n, z: t.z / t.n, area: t.area, count: t.n }]));
}

/* ---------- meeting table ---------- */
export const MEETING_TABLE = { x: -22, z: -14.6, w: 7.4, d: 2.5 };
/** Ten chairs around the table. Heading faces the table. */
export const MEETING_CHAIRS = (() => {
  const { x, z, w, d } = MEETING_TABLE, out = [];
  for (const dx of [-2.55, -.85, .85, 2.55]) { out.push({ x: x + dx, z: z - d / 2 - .5, heading: 0 }); out.push({ x: x + dx, z: z + d / 2 + .5, heading: Math.PI }); }
  out.push({ x: x - w / 2 - .5, z, heading: Math.PI / 2 }, { x: x + w / 2 + .5, z, heading: -Math.PI / 2 });
  return out;
})();

/* ---------- things you cannot walk through ---------- */
const rect = (cx, cz, w, d) => ({ x1: cx - w / 2, x2: cx + w / 2, z1: cz - d / 2, z2: cz + d / 2 });
export const FURNITURE = [
  rect(MEETING_TABLE.x, MEETING_TABLE.z, MEETING_TABLE.w, MEETING_TABLE.d),
  // leadership
  rect(-9, -16.2, 3.4, 1.2), rect(-14, -17, .9, 2.2), rect(-14, -13.6, .9, 2.2), rect(-4, -19, .9, 2.2), rect(-4, -15.6, .9, 2.2),
  // studio
  rect(8.2, -14.8, .9, 9.6), rect(-2.2, -13.6, .9, 7.2),
  // server racks and desks
  rect(11, -17.2, 1, 6.4), rect(14, -17.2, 1, 6.4), rect(9.6, -11.3, .9, 3.6), rect(15.4, -11.3, .9, 3.6),
  // game room
  rect(22.5, -15, 4.6, 2.6), rect(17.4, -19.6, 2, .9), rect(27.9, -18, 1.6, 2.2),
  // kitchen
  rect(-23.7, -4.7, 10, 1.2), rect(-28.2, -1.5, 1.2, 5.2), rect(-22.8, 2.4, 3.2, 1.5),
  // reception
  rect(-22, 11, 6, 1.3), rect(-27.4, 17, 2, 4.4), rect(-17.2, 18, 2.2, 2.2),
  // lounge
  rect(-9.4, 2, 4.8, 2.6), rect(-1.6, 7.6, 4.8, 2.6), rect(-13.8, 7.5, 1.1, 2.2), rect(-13.8, 10.4, 1.1, 2.2), rect(-7.2, 12.4, 2.4, 1.2),
  rect(-9.5, 18.8, 4, 1.4), rect(-9.5, 15.8, 2.2, 1), rect(-13.6, 18.8, 1.4, 2.6),
  // restrooms
  rect(-1.2, 20.3, 1.2, 1), rect(3, 20.3, 1.6, 1),
  // terrace
  rect(-32.5, 11, 3.6, 1.4), rect(-33, 3.6, 1.8, 1.8),
];
/** Cubicle blocks: the desks and centre partition. Chair pockets stay clear so people can sit down. */
const cubicleBlocks = () => CUBICLE_PAIRS.flatMap(z => [
  { x1: cubicleX(0) - CUBICLE.width / 2, x2: cubicleX(3) + CUBICLE.width / 2, z1: z - CUBICLE.deskZone, z2: z + CUBICLE.deskZone },
  { x1: cubicleX(4) - CUBICLE.width / 2, x2: cubicleX(7) + CUBICLE.width / 2, z1: z - CUBICLE.deskZone, z2: z + CUBICLE.deskZone },
]);
/** The side panels between neighbouring chair pockets. */
const cubicleFins = () => CUBICLE_PAIRS.flatMap(z => [0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap(i => {
  if (i === 4) return [];
  const x = i < 4 ? cubicleX(i) - CUBICLE.width / 2 : i === 8 ? cubicleX(7) + CUBICLE.width / 2 : cubicleX(i) - CUBICLE.width / 2;
  return [{ x1: x - .05, x2: x + .05, z1: z - CUBICLE.deskZone - .75, z2: z - CUBICLE.deskZone }, { x1: x - .05, x2: x + .05, z1: z + CUBICLE.deskZone, z2: z + CUBICLE.deskZone + .75 }];
}));
const cubicleEnds = () => CUBICLE_PAIRS.flatMap(z => [3, 7].map(i => { const x = cubicleX(i) + CUBICLE.width / 2; return [
  { x1: x - .05, x2: x + .05, z1: z - CUBICLE.deskZone - .75, z2: z - CUBICLE.deskZone }, { x1: x - .05, x2: x + .05, z1: z + CUBICLE.deskZone, z2: z + CUBICLE.deskZone + .75 },
]; }).flat());

/** Everything solid, for walking. Automatic doors are handled separately because they move. */
export function buildColliders() {
  return [...wallPieces().map(pieceBox), ...FURNITURE, ...cubicleBlocks(), ...cubicleFins(), ...cubicleEnds()];
}

/* ---------- routes for the people in the building ---------- */
const NAV = { x1: -30, z1: -22, cell: .4 }; NAV.cols = Math.ceil(60 / NAV.cell); NAV.rows = Math.ceil(44 / NAV.cell);
/** A grid of walkable cells inside the building. Staff use the doors, never the walls. */
export function createNavGrid(colliders = buildColliders(), inflate = .24) {
  const { cols, rows, cell, x1, z1 } = NAV, blocked = new Uint8Array(cols * rows);
  for (const b of colliders) {
    const c1 = Math.max(0, Math.floor((b.x1 - inflate - x1) / cell)), c2 = Math.min(cols - 1, Math.floor((b.x2 + inflate - x1) / cell));
    const r1 = Math.max(0, Math.floor((b.z1 - inflate - z1) / cell)), r2 = Math.min(rows - 1, Math.floor((b.z2 + inflate - z1) / cell));
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) blocked[r * cols + c] = 1;
  }
  // Staff stay indoors: the automatic entrances count as closed.
  for (const d of AUTO_DOORS) {
    const box = d.axis === 'x' ? { x1: d.a, x2: d.b, z1: d.at - .1, z2: d.at + .1 } : { x1: d.at - .1, x2: d.at + .1, z1: d.a, z2: d.b };
    const c1 = Math.floor((box.x1 - inflate - x1) / cell), c2 = Math.floor((box.x2 + inflate - x1) / cell), r1 = Math.floor((box.z1 - inflate - z1) / cell), r2 = Math.floor((box.z2 + inflate - z1) / cell);
    for (let r = Math.max(0, r1); r <= Math.min(rows - 1, r2); r++) for (let c = Math.max(0, c1); c <= Math.min(cols - 1, c2); c++) blocked[r * cols + c] = 1;
  }
  return { blocked, cols, rows, cell, x1, z1 };
}
const cellOf = (g, x, z) => ({ c: Math.max(0, Math.min(g.cols - 1, Math.floor((x - g.x1) / g.cell))), r: Math.max(0, Math.min(g.rows - 1, Math.floor((z - g.z1) / g.cell))) });
const centreOf = (g, c, r) => ({ x: g.x1 + (c + .5) * g.cell, z: g.z1 + (r + .5) * g.cell });
/** The closest open cell, for chairs that sit right against a desk. */
function openCell(g, at) {
  if (!g.blocked[at.r * g.cols + at.c]) return at;
  for (let d = 1; d < 12; d++) {
    let best = null, bestD = Infinity;
    for (let r = at.r - d; r <= at.r + d; r++) for (let c = at.c - d; c <= at.c + d; c++) {
      if (r < 0 || c < 0 || r >= g.rows || c >= g.cols || g.blocked[r * g.cols + c]) continue;
      const dd = (r - at.r) ** 2 + (c - at.c) ** 2; if (dd < bestD) { bestD = dd; best = { c, r }; }
    }
    if (best) return best;
  }
  return null;
}
/** The closest spot to a point that a person can stand on. */
export function nearestOpen(g, x, z) {
  const cell = openCell(g, cellOf(g, x, z));
  return cell ? centreOf(g, cell.c, cell.r) : { x, z };
}
function lineClear(g, a, b) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (g.cell * .4));
  for (let i = 1; i < steps; i++) {
    const { c, r } = cellOf(g, a.x + (b.x - a.x) * i / steps, a.z + (b.z - a.z) * i / steps);
    if (g.blocked[r * g.cols + c]) return false;
  }
  return true;
}
/**
 * The shortest walkable path between two points, ending exactly on the target.
 * Returns null only when the target cannot be reached.
 */
export function findRoute(g, from, to) {
  const start = openCell(g, cellOf(g, from.x, from.z)), goal = openCell(g, cellOf(g, to.x, to.z));
  if (!start || !goal) return null;
  const N = g.cols * g.rows, key = (c, r) => r * g.cols + c, cost = new Float64Array(N).fill(Infinity), came = new Int32Array(N).fill(-1);
  const heap = [], push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const up = (i - 1) >> 1; if (heap[up][0] <= heap[i][0]) break; [heap[up], heap[i]] = [heap[i], heap[up]]; i = up; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const h = (c, r) => Math.hypot(c - goal.c, r - goal.r), sk = key(start.c, start.r), gk = key(goal.c, goal.r);
  cost[sk] = 0; push(sk, h(start.c, start.r));
  const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  while (heap.length) {
    const [, k] = pop(); if (k === gk) break;
    const r = Math.floor(k / g.cols), c = k - r * g.cols;
    for (const [dc, dr, w] of STEPS) {
      const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const nk = key(nc, nr); if (g.blocked[nk]) continue;
      if (dc && dr && (g.blocked[key(c + dc, r)] || g.blocked[key(c, r + dr)])) continue;
      const next = cost[k] + w; if (next < cost[nk]) { cost[nk] = next; came[nk] = k; push(nk, next + h(nc, nr)); }
    }
  }
  if (cost[gk] === Infinity) return null;
  const cells = []; for (let k = gk; k !== -1; k = came[k]) { const r = Math.floor(k / g.cols); cells.push(centreOf(g, k - r * g.cols, r)); if (k === sk) break; }
  cells.reverse();
  // string-pull: keep only the corners, so people walk straight lines rather than a staircase
  const path = []; let anchor = cells[0];
  for (let i = 1; i < cells.length - 1; i++) if (!lineClear(g, anchor, cells[i + 1])) { path.push(cells[i]); anchor = cells[i]; }
  path.push(cells[cells.length - 1], { x: to.x, z: to.z });
  return path.filter((p, i) => !i || Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z) > .02);
}

/* ---------- places people visit on a break, and the cleaner's round ---------- */
export const BREAK_SPOTS = [
  { x: -21.5, z: -2.6, area: 'kitchen' }, { x: -19.2, z: -1.2, area: 'kitchen' }, { x: -24.4, z: -2.8, area: 'kitchen' }, { x: -20, z: 2.5, area: 'kitchen' },
  { x: -6, z: 4.6, area: 'lounge' }, { x: -12.6, z: 2, area: 'lounge' }, { x: -3.8, z: 5, area: 'lounge' }, { x: -7.2, z: 17, area: 'lounge' },
  { x: 19.4, z: -13, area: 'game' }, { x: 25.6, z: -13, area: 'game' },
];
export const CLEANER_ROUND = [{ x: -26, z: -7 }, { x: 18, z: -7 }, { x: 8, z: -7 }, { x: 16.8, z: 2.8 }, { x: 8, z: -7 }, { x: -4, z: -7 }, { x: -4, z: 13 }, { x: -12, z: 13 }, { x: -18, z: 13 }, { x: -12, z: 13 }, { x: -4, z: 2 }, { x: -4.5, z: -7 }, { x: -17, z: -7 }, { x: -17, z: 1 }];

/** The ten rooms and other areas as shapes on a 0..100 map, for the floor plan in the corner. */
export function floorMapShapes() {
  const X1 = -38, X2 = 30, Z1 = -22, Z2 = 29, w = X2 - X1, h = Z2 - Z1, s = 100 / w;
  const shape = r => ({ id: r.id, name: r.name, no: r.no, x: (r.x1 - X1) * s, y: (r.z1 - Z1) * s, w: (r.x2 - r.x1) * s, h: (r.z2 - r.z1) * s });
  return { width: 100, height: h * s, rooms: OFFICE_ROOMS.map(shape), areas: OTHER_AREAS.map(shape), project: (x, z) => ({ x: (x - X1) * s, y: (z - Z1) * s }) };
}
