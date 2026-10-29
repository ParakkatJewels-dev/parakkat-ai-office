// Everything around the campus: avenues and a back road with signalled crossings, mixed Kerala traffic that stops at
// red lights, people on the pavements, a woodland belt, distant buildings, hills, and a sky that follows the clock in
// Kerala with sunrise, sunset, stars and the real phase of the moon.
//
// Speed: static pieces go into the campus's merge group (one draw per material) and never cast shadows; pedestrians
// and vehicle lights are instanced; each vehicle body is one mesh. The sky is one dome, one star cloud and two sprites.

const AVE = [-110, 110], MAIN_Z = 40, BACK_Z = 84, EW = 240, NS = [-130, 200];
const CYCLE = 20; // seconds: east-west green 8, amber 2, north-south green 8, amber 2
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14), MONTH = 29.530588853 * 864e5;
const PHASES = [[.03, 'New moon'], [.22, 'Waxing crescent'], [.28, 'First quarter'], [.47, 'Waxing gibbous'], [.53, 'Full moon'], [.72, 'Waning gibbous'], [.78, 'Last quarter'], [.97, 'Waning crescent'], [1, 'New moon']];
// hour, sky top, horizon, sun colour, sun strength, hemisphere sky, hemisphere ground, hemisphere strength, exposure
const KEYS = [
  [0, '#050a18', '#0e1a2e', '#a9bde8', .35, '#5f7398', '#1e2420', .3, 1.15],
  [5.2, '#050a18', '#0e1a2e', '#a9bde8', .35, '#5f7398', '#1e2420', .3, 1.15],
  [5.9, '#1b2550', '#c06a5a', '#ffb27a', .45, '#8a8fb8', '#3a3428', .4, 1.12],
  [6.6, '#4f7fb8', '#ffb070', '#ffc58f', 1.2, '#c9d6ec', '#7a6a50', .6, 1.08],
  [8, '#6fa3d8', '#d6e6f0', '#fff1d6', 2.1, '#e3f0ff', '#8a7a5c', .75, 1.05],
  [16.5, '#6fa3d8', '#d6e6f0', '#fff1d6', 2.1, '#e3f0ff', '#8a7a5c', .75, 1.05],
  [17.7, '#5d86c0', '#f6b46e', '#ffc07a', 1.5, '#e7d9c6', '#8a6f50', .65, 1.06],
  [18.4, '#2c3970', '#e26a5c', '#ff8a5c', .6, '#a68aa8', '#4a3a30', .45, 1.1],
  [19.1, '#0d1634', '#3a3560', '#a9bde8', .35, '#6f7fa8', '#262a24', .34, 1.14],
  [20, '#050a18', '#0e1a2e', '#a9bde8', .35, '#5f7398', '#1e2420', .3, 1.15],
  [24, '#050a18', '#0e1a2e', '#a9bde8', .35, '#5f7398', '#1e2420', .3, 1.15],
];
const RISE = 6.2, SET = 18.4;

export const istHours = (ms = Date.now()) => ((ms / 36e5 + 5.5) % 24 + 24) % 24;
export function moonPhase(ms = Date.now()) {
  const f = (((ms - NEW_MOON) / MONTH) % 1 + 1) % 1;
  return { f, name: PHASES.find(([t]) => f < t)[1], lit: Math.round((1 - Math.cos(2 * Math.PI * f)) * 50) };
}

/**
 * @param {object} c  the campus builder's helpers: THREE, scene, stat, M, tex, colored, mix, lamps, rnd, reduce, sun, hemi, renderer
 */
export function buildWorld(c) {
  const { THREE, scene, stat, M, tex, colored, mix, lamps, rnd } = c;
  const BOX = new THREE.BoxGeometry(1, 1, 1), WHEEL = new THREE.CylinderGeometry(.42, .42, .3, 12);
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); stat.add(m); return m; };
  const block = (w, h, d, mat, x, y, z) => { const m = add(new THREE.BoxGeometry(w, h, d), mat, x, y, z); return m; };
  const plane = (w, d, mat, x, y, z) => { const m = add(new THREE.PlaneGeometry(w, d), mat, x, y, z); m.rotation.x = -Math.PI / 2; m.receiveShadow = true; return m; };

  /* ---------- roads: two avenues crossing the main road, and a back road ---------- */
  const road = M('#2f3236', { roughness: .9 }), dash = M('#e8e2cf'), walk = M('#bfb8ab', { roughness: .95 }), zebra = M('#f2efe6', { roughness: .8 });
  const zSeg = [[NS[0], MAIN_Z - 4], [MAIN_Z + 4, BACK_Z - 4], [BACK_Z + 4, NS[1] + 60]];
  for (const ax of AVE) {
    zSeg.forEach(([a, b]) => { plane(8, b - a, road, ax, -.3, (a + b) / 2); for (let z = a + 3; z < b - 3; z += 7) plane(.22, 3.2, dash, ax, -.285, z); });
    [MAIN_Z, BACK_Z].forEach(z => plane(8, 8, road, ax, -.3, z));
    // pavements beside the avenue, stopping short of each road they meet
    [[NS[0], MAIN_Z - 6], [MAIN_Z + 6, BACK_Z - 6], [BACK_Z + 6, NS[1] + 60]].forEach(([a, b]) => [-1, 1].forEach(sd => plane(2.4, b - a, walk, ax + sd * 5.4, -.29, (a + b) / 2)));
    // zebra crossings on every side of both junctions
    [MAIN_Z, BACK_Z].forEach(z => {
      [-1, 1].forEach(sd => { for (let i = -3; i <= 3; i++) { plane(2.2, .5, zebra, ax + sd * 6.6, -.285, z + i * 1.1); plane(.5, 2.2, zebra, ax + i * 1.1, -.285, z + sd * 6.6); } });
    });
  }
  // back road, cut where the avenues cross it
  [[-560, AVE[0] - 4], [AVE[0] + 4, AVE[1] - 4], [AVE[1] + 4, 560]].forEach(([a, b]) => {
    plane(b - a, 8, road, (a + b) / 2, -.3, BACK_Z);
    for (let x = a + 3; x < b - 3; x += 7) plane(3.2, .22, dash, x, -.285, BACK_Z);
    [-1, 1].forEach(sd => plane(b - a - 4, 2.4, walk, (a + b) / 2, -.29, BACK_Z + sd * 5.4));
  });

  /* ---------- traffic signals: one set of lamp materials per direction, switched by the cycle ---------- */
  const lampMat = (col, glow) => new THREE.MeshStandardMaterial({ color: col, emissive: glow, emissiveIntensity: 0, roughness: .4 });
  const SIG = { x: { r: lampMat('#3a0d0d', '#ff3b30'), a: lampMat('#3a2a08', '#ffb020'), g: lampMat('#0c2c16', '#2bd66b') }, z: { r: lampMat('#3a0d0d', '#ff3b30'), a: lampMat('#3a2a08', '#ffb020'), g: lampMat('#0c2c16', '#2bd66b') } };
  const pole = M('#2a2d31', { metalness: .5, roughness: .45 }), housing = M('#15171a', { roughness: .6 });
  const LAMPG = new THREE.SphereGeometry(.17, 10, 8);
  for (const ax of AVE) for (const z of [MAIN_Z, BACK_Z]) {
    // a pole on each corner: two show the main-road lights, two the avenue lights
    [[-1, -1, 'z'], [1, 1, 'z'], [-1, 1, 'x'], [1, -1, 'x']].forEach(([sx, sz, axis]) => {
      const px = ax + sx * 5, pz = z + sz * 5;
      add(new THREE.CylinderGeometry(.09, .11, 4.2, 8), pole, px, 1.8, pz);
      const along = axis === 'x', hx = px + (along ? 0 : -sx * .9), hz = pz + (along ? -sz * .9 : 0);
      block(along ? .9 : .3, 1.15, along ? .3 : .9, housing, hx, 3.6, hz);
      if (along) block(.05, .05, .9, pole, px, 3.9, pz - sz * .45); else block(.9, .05, .05, pole, px - sx * .45, 3.9, pz);
      // lamps face the traffic they control
      const fx = along ? 0 : sx * .17, fz = along ? sz * .17 : 0;
      [['r', 4.0], ['a', 3.62], ['g', 3.24]].forEach(([k, y]) => add(LAMPG, SIG[axis][k], hx + fx, y, hz + fz));
    });
  }
  const light = (axis, t) => { const p = t % CYCLE; const green = axis === 'x' ? p < 8 : p >= 10 && p < 18, amber = axis === 'x' ? p >= 8 && p < 10 : p >= 18; return green ? 'g' : amber ? 'a' : 'r'; };
  let shown = '';
  function setSignals(t) {
    const k = light('x', t) + light('z', t); if (k === shown) return; shown = k;
    ['x', 'z'].forEach((axis, i) => ['r', 'a', 'g'].forEach(c => { SIG[axis][c].emissiveIntensity = k[i] === c ? 2.4 : 0; }));
  }

  /* ---------- vehicles ---------- */
  const W = (x, z, s = 1) => [WHEEL, '#121212', x, .42 * s, z, Math.PI / 2, [s, 1, s]];
  const TYPES = {
    car: col => ({ len: 4.4, v: 9, parts: [[BOX, col, 0, .62, 0, 0, [4.4, .7, 1.9]], [BOX, '#202833', -.2, 1.22, 0, 0, [2.4, .62, 1.7]], [BOX, col, -.2, 1.55, 0, 0, [2.3, .06, 1.72]], W(-1.4, -.85), W(1.4, -.85), W(-1.4, .85), W(1.4, .85)], lights: [2.21, .72, .62, -2.21] }),
    suv: col => ({ len: 4.8, v: 8.5, parts: [[BOX, col, 0, .8, 0, 0, [4.8, .95, 2.05]], [BOX, '#1d2530', -.3, 1.6, 0, 0, [3.1, .7, 1.9]], [BOX, col, -.3, 1.98, 0, 0, [3.0, .08, 1.95]], W(-1.55, -.9, 1.15), W(1.55, -.9, 1.15), W(-1.55, .9, 1.15), W(1.55, .9, 1.15)], lights: [2.41, .95, .68, -2.41] }),
    bus: (col, band) => ({ len: 11, v: 7, parts: [[BOX, col, 0, 1.75, 0, 0, [11, 2.6, 2.5]], [BOX, band, 0, 1.15, 0, 0, [11.04, .4, 2.54]], [BOX, '#1b222b', .1, 2.45, 0, 0, [10.4, .75, 2.56]], [BOX, '#ecebe6', 0, 3.1, 0, 0, [10.8, .14, 2.4]], [BOX, '#1b222b', 5.51, 2.1, 0, 0, [.04, 1.2, 2.1]],
      W(-3.8, -1.15, 1.15), W(-2.4, -1.15, 1.15), W(3.6, -1.15, 1.15), W(-3.8, 1.15, 1.15), W(-2.4, 1.15, 1.15), W(3.6, 1.15, 1.15)], lights: [5.52, 1.0, .9, -5.52] }),
    truck: (col, load) => ({ len: 8.8, v: 6.5, parts: [[BOX, col, 3.55, 1.55, 0, 0, [2.1, 2.1, 2.3]], [BOX, '#1b222b', 4.61, 2.0, 0, 0, [.04, .8, 2.0]], [BOX, load, -.9, 1.9, 0, 0, [6.6, 2.7, 2.4]], [BOX, '#26282c', 0, .6, 0, 0, [8.6, .3, 1.6]],
      W(3.4, -1.1, 1.1), W(-2.4, -1.1, 1.1), W(-3.6, -1.1, 1.1), W(3.4, 1.1, 1.1), W(-2.4, 1.1, 1.1), W(-3.6, 1.1, 1.1)], lights: [4.62, .9, .85, -4.25] }),
    auto: () => ({ len: 2.7, v: 6, parts: [[BOX, '#1c1c1c', -.1, .45, 0, 0, [2.6, .22, 1.3]], [BOX, '#f2c230', -.25, 1.1, 0, 0, [1.9, 1.1, 1.3]], [BOX, '#1c1c1c', -.15, 1.72, 0, 0, [2.3, .12, 1.42]], [BOX, '#f2c230', 1.05, .85, 0, 0, [.55, .7, .6]], [BOX, '#26313d', .72, 1.35, 0, 0, [.04, .6, 1.05]],
      W(1.12, 0, .62), W(-.85, -.62, .62), W(-.85, .62, .62)], lights: [1.34, 1.0, 0, -1.36] }),
    scooter: (col, shirt) => ({ len: 1.9, v: 8, parts: [[BOX, col, 0, .6, 0, 0, [1.5, .35, .38]], [BOX, '#1c1c1c', -.2, .85, 0, 0, [.7, .12, .34]], [BOX, col, .62, 1.0, 0, 0, [.14, .8, .3]], [BOX, shirt, -.2, 1.3, 0, 0, [.36, .62, .46]], [BOX, '#2f3a6b', -.05, .95, 0, 0, [.5, .2, .4]], [BOX, '#e6e6e6', -.15, 1.78, 0, 0, [.32, .32, .32]],
      W(.68, 0, .7), W(-.62, 0, .7)], lights: [.72, 1.15, 0, -.95] }),
  };
  const PAINT = ['#c9ccd1', '#1f2328', '#8e1d23', '#e8e6df', '#2f4f7f', '#5f6b5a', '#b7a37a'];
  const pick = a => a[(rnd() * a.length) | 0];
  const make = kind => kind === 'bus' ? TYPES.bus(pick(['#c0282d', '#1f6fb2', '#2c8a4b', '#e5a020']), pick(['#f2c230', '#ffffff', '#1c1c1c']))
    : kind === 'truck' ? TYPES.truck(pick(['#d9603b', '#2f6db0', '#e0b030']), pick(['#d9d4c7', '#3f6e55', '#8a5a3c']))
    : kind === 'scooter' ? TYPES.scooter(pick(['#c0282d', '#1c1c1c', '#e8e6df', '#2f4f7f']), pick(['#4b8fe0', '#d07a1f', '#ffffff', '#2b8a64']))
    : TYPES[kind](pick(PAINT));
  // lanes: which way they run, where junctions are, and the stretch vehicles loop over
  const lanes = [];
  const ew = (z, dir, kinds) => lanes.push({ axis: 'x', at: z, dir, stops: AVE, range: [-EW, EW], kinds });
  const ns = (x, dir, kinds) => lanes.push({ axis: 'z', at: x, dir, stops: [MAIN_Z, BACK_Z], range: NS, kinds });
  ew(MAIN_Z - 2, 1, ['car', 'bus', 'auto', 'suv', 'scooter', 'truck', 'car']);
  ew(MAIN_Z + 2, -1, ['suv', 'auto', 'car', 'bus', 'scooter', 'car', 'truck']);
  ew(BACK_Z - 2, 1, ['car', 'auto', 'truck', 'scooter']);
  ew(BACK_Z + 2, -1, ['bus', 'car', 'auto', 'suv']);
  AVE.forEach(ax => { ns(ax + 2, 1, ['car', 'auto', 'suv']); ns(ax - 2, -1, ['scooter', 'car', 'truck']); });
  const vehicles = [], tint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .15 });
  for (const lane of lanes) {
    const span = lane.range[1] - lane.range[0], gap = span / lane.kinds.length;
    lane.kinds.forEach((kind, i) => {
      const t = make(kind), mesh = colored(t.parts); mesh.material = tint; mesh.castShadow = false; mesh.receiveShadow = false;
      const g = new THREE.Group(); g.add(mesh); scene.add(g);
      const rot = lane.axis === 'x' ? (lane.dir > 0 ? 0 : Math.PI) : (lane.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      g.rotation.y = rot;
      vehicles.push({ g, lane, len: t.len, vmax: t.v * (.85 + rnd() * .3), v: t.v, s: lane.range[0] + gap * (i + rnd() * .5), lights: t.lights });
    });
  }
  // head and tail lights for every vehicle as two instanced meshes
  const headM = new THREE.MeshStandardMaterial({ color: '#fff8e0', emissive: '#ffe6a8', emissiveIntensity: 0 }), tailM = new THREE.MeshStandardMaterial({ color: '#7a1010', emissive: '#ff2a2a', emissiveIntensity: 0 });
  lamps.push({ mat: headM, on: 1.8 }, { mat: tailM, on: 1.3 });
  const nL = vehicles.length * 2, heads = new THREE.InstancedMesh(BOX, headM, nL), tails = new THREE.InstancedMesh(BOX, tailM, nL);
  heads.frustumCulled = tails.frustumCulled = false; scene.add(heads, tails);
  const _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  function placeLights() {
    vehicles.forEach((v, i) => {
      const [fx, y, z, bx] = v.lights; v.g.updateMatrix();
      [-1, 1].forEach((sd, k) => {
        const zz = z ? sd * z : 0;
        _l.compose(_p.set(fx, y, zz), _q.identity(), _s.set(.06, .16, z ? .34 : .2)); heads.setMatrixAt(i * 2 + k, _m.multiplyMatrices(v.g.matrix, _l));
        _l.compose(_p.set(bx, y, zz), _q.identity(), _s.set(.06, .14, z ? .3 : .16)); tails.setMatrixAt(i * 2 + k, _m.multiplyMatrices(v.g.matrix, _l));
      });
    });
    heads.instanceMatrix.needsUpdate = tails.instanceMatrix.needsUpdate = true;
  }

  // follow the vehicle ahead, stop at a red or amber light, loop round at the end of the stretch
  function drive(dt, t) {
    for (const lane of lanes) {
      const mine = vehicles.filter(v => v.lane === lane).sort((a, b) => (b.s - a.s) * lane.dir);
      const sig = light(lane.axis, t);
      mine.forEach((v, i) => {
        let target = v.vmax;
        const lead = mine[i - 1];
        if (lead) { const gap = (lead.s - v.s) * lane.dir - (lead.len + v.len) / 2; if (gap < 3) target = 0; else if (gap < 14) target = Math.min(target, lead.v * (gap / 14)); }
        if (sig !== 'g') for (const c of lane.stops) {
          const d = (c - v.s) * lane.dir - v.len / 2 - 7; // distance from the bumper to the stop line
          if (d > (sig === 'a' ? 1.5 : -.5) && d < 16) target = Math.min(target, Math.max(0, d - .5) * .8);
        }
        v.v += Math.max(-14 * dt, Math.min(4 * dt, target - v.v));
        v.s += v.v * lane.dir * dt;
        const [lo, hi] = lane.range;
        if (lane.dir > 0 && v.s > hi) v.s = lo; else if (lane.dir < 0 && v.s < lo) v.s = hi;
        if (lane.axis === 'x') v.g.position.set(v.s, -.3, lane.at); else v.g.position.set(lane.at, -.3, v.s);
      });
    }
  }

  /* ---------- people on the pavements, three instanced draws for all of them ---------- */
  const walks = [
    ...[34.5, 45.4].map(z => ({ axis: 'x', at: z, range: [-100, 100] })),
    { axis: 'x', at: 29.6, range: [-72, 66] },
    ...AVE.flatMap(ax => [-1, 1].map(sd => ({ axis: 'z', at: ax + sd * 5.4, range: [-60, 34] }))),
    ...AVE.flatMap(ax => [-1, 1].map(sd => ({ axis: 'z', at: ax + sd * 5.4, range: [46, 78] }))),
    ...[-1, 1].map(sd => ({ axis: 'x', at: BACK_Z + sd * 5.4, range: [-100, 100] })),
  ];
  const peds = [];
  walks.forEach(w => { const n = w.range[1] - w.range[0] > 100 ? 4 : 2; for (let i = 0; i < n; i++) peds.push({ w, s: w.range[0] + rnd() * (w.range[1] - w.range[0]), dir: rnd() > .5 ? 1 : -1, v: .9 + rnd() * .6, ph: rnd() * 6, off: (rnd() - .5) * 1.2 }); });
  const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .8 });
  const LEGS = new THREE.BoxGeometry(.34, .82, .22).translate(0, .41, 0), BODY = new THREE.BoxGeometry(.5, .62, .28).translate(0, 1.13, 0), HEAD = new THREE.SphereGeometry(.15, 10, 8).translate(0, 1.6, 0);
  const parts = [LEGS, BODY, HEAD].map(g => { const m = new THREE.InstancedMesh(g, white, peds.length); m.frustumCulled = false; m.castShadow = false; scene.add(m); return m; });
  const SHIRTS = ['#c0282d', '#2f6db0', '#f2c230', '#2b8a64', '#ffffff', '#d07a1f', '#8a5a9e', '#e8a0b0'], PANTS = ['#1f2a44', '#2b2b2b', '#5a4a3a', '#e8e2cf', '#3a4a5a'], SKINS = ['#d7a47c', '#b77d57', '#8c5a3c', '#f0c9a4'];
  const _c = new THREE.Color();
  peds.forEach((p, i) => { parts[0].setColorAt(i, _c.set(pick(PANTS))); parts[1].setColorAt(i, _c.set(pick(SHIRTS))); parts[2].setColorAt(i, _c.set(pick(SKINS))); });
  parts.forEach(m => { m.instanceColor.needsUpdate = true; });
  function stroll(dt, T) {
    peds.forEach((p, i) => {
      p.s += p.dir * p.v * dt;
      if (p.s > p.w.range[1]) { p.s = p.w.range[1]; p.dir = -1; } else if (p.s < p.w.range[0]) { p.s = p.w.range[0]; p.dir = 1; }
      const bob = Math.abs(Math.sin(T * 6 * p.v + p.ph)) * .07, x = p.w.axis === 'x' ? p.s : p.w.at + p.off * .5, z = p.w.axis === 'x' ? p.w.at + p.off : p.s;
      const yaw = p.w.axis === 'x' ? (p.dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (p.dir > 0 ? 0 : Math.PI);
      _m.compose(_p.set(x, -.29 + bob, z), _q.setFromEuler(_e.set(0, yaw, Math.sin(T * 6 * p.v + p.ph) * .04)), _s.set(1, 1, 1));
      parts.forEach(m => m.setMatrixAt(i, _m));
    });
    parts.forEach(m => { m.instanceMatrix.needsUpdate = true; });
  }

  /* ---------- layered woodland, with buildings kept beyond the campus grounds ---------- */
  if (c.landscape) {
    for (let row = 0; row < 3; row++) {
      for (let x = -151; x <= 151; x += 10) {
        c.landscape.tree(x + (rnd() - .5) * 5, -48 - row * 13 - rnd() * 6, 1.1 + rnd() * .55);
      }
    }
    // Loose groves frame both sides when the map is rotated, without crowding
    // the entrances or the roads the agents walk across.
    for (const side of [-1, 1]) for (let z = -35; z < 76; z += 12) {
      if (Math.abs(z - MAIN_Z) < 9) continue;
      c.landscape.tree(side * (132 + rnd() * 14), z, 1.2 + rnd() * .5);
      c.landscape.tree(side * (155 + rnd() * 10), z - 5, 1.1 + rnd() * .6);
    }
  }
  const facade = tex((g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 8; r++) for (let k = 0; k < 4; k++) { const x = k * 32 + 6, y = r * 32 + 8; g.fillStyle = '#4a5a6a'; g.fillRect(x, y, 20, 16); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x, y, 20, 3); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(k * 32, r * 32 + 28, 32, 4); }
  }, 128, 256);
  const litMap = tex((g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 8; r++) for (let k = 0; k < 4; k++) if (rnd() > .45) { g.fillStyle = rnd() > .3 ? '#ffd58a' : '#cfe3ff'; g.fillRect(k * 32 + 6, r * 32 + 8, 20, 16); }
  }, 128, 256);
  const flatMats = ['#efe6d8', '#dfe6ea', '#f1d9c7', '#e6e2d3'].map(col => { const m = new THREE.MeshStandardMaterial({ color: col, map: facade, emissive: '#ffffff', emissiveMap: litMap, emissiveIntensity: 0, roughness: .85 }); lamps.push({ mat: m, on: .9 }); return m; });
  const roofM = M('#9a958c', { roughness: .95 }), tankM = M('#2f3a44', { roughness: .6 });
  function tower(x, z, w, d, h) {
    const geo = new THREE.BoxGeometry(w, h, d), uv = geo.attributes.uv;
    // windows repeat every 12 m across and 24 m up; the roof samples a plain corner of the texture
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k, side = f < 2 ? d : w;
      if (f === 2 || f === 3) uv.setXY(i, .01, .99); else uv.setXY(i, uv.getX(i) * side / 12, uv.getY(i) * h / 24);
    }
    add(geo, pick(flatMats), x, h / 2 - .3, z);
    block(w + .3, .4, d + .3, roofM, x, h - .1, z);
    block(1.6, 1.4, 1.6, tankM, x + w / 4, h + .8, z - d / 4);
  }
  const H = () => 9 + ((rnd() * 4) | 0) * 3;
  for (let x = -170; x <= 170; x += 46) tower(x + rnd() * 4, -158 - rnd() * 22, 14, 10, H());
  for (let x = -170; x <= 170; x += 55) tower(x + rnd() * 4, 176 + rnd() * 12, 14, 10, H() * .65);
  [-1, 1].forEach(sd => { for (let z = -50; z <= 90; z += 48) tower(sd * (202 + rnd() * 12), z, 12, 14, H()); });

  /* ---------- hills on the horizon, hazed towards the sky colour ---------- */
  const hillLayers = [[440, '#3f6340', 45, 85, 30], [530, '#55745f', 75, 130, 26], [610, '#71899a', 105, 175, 22]].map(([r, base, hMin, hMax, n], li) => {
    const mat = new THREE.MeshStandardMaterial({ color: base, roughness: 1, fog: false }), geos = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * .2, rr = r + (rnd() - .5) * 40, h = hMin + rnd() * (hMax - hMin), rad = h * (1.15 + rnd() * .55);
      const g = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        p.setXYZ(k, x * rad, y * h * (.84 + .16 * Math.sin(x * 4 + li) * Math.cos(z * 3)), z * rad * .85);
      }
      g.computeVertexNormals(); g.translate(Math.cos(a) * rr, -.4, Math.sin(a) * rr); geos.push(g.toNonIndexed()); g.dispose();
    }
    let total = 0; geos.forEach(g => { total += g.attributes.position.count; });
    const pos = new Float32Array(total * 3), normal = new Float32Array(total * 3); let o = 0;
    geos.forEach(g => { pos.set(g.attributes.position.array, o); normal.set(g.attributes.normal.array, o); o += g.attributes.position.array.length; g.dispose(); });
    const merged = new THREE.BufferGeometry(); merged.setAttribute('position', new THREE.BufferAttribute(pos, 3)); merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    const mesh = new THREE.Mesh(merged, mat); scene.add(mesh);
    return { mat, base, haze: .25 + li * .2 };
  });
  // the ground reaches the foot of the hills
  const far = new THREE.Mesh(new THREE.RingGeometry(250, 700, 48, 1), new THREE.MeshStandardMaterial({ color: '#557a45', roughness: 1, fog: true }));
  far.rotation.x = -Math.PI / 2; far.position.y = -.4; scene.add(far);

  /* ---------- sky ---------- */
  const uni = { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, glow: { value: new THREE.Color('#ffb070') }, glowK: { value: 0 } };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(760, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false, uniforms: uni,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 glow; uniform float glowK; varying vec3 vDir;
      void main(){ float h = vDir.y; vec3 col = mix(hor, top, pow(clamp(h, 0.0, 1.0), 0.55)); if (h < 0.0) col = hor;
        float s = max(dot(normalize(vDir), sunDir), 0.0); col += glow * (pow(s, 6.0) * 0.45 + pow(s, 80.0) * 0.6) * glowK;
        gl_FragColor = vec4(col, 1.0);
        #include <encodings_fragment>
      }`,
  }));
  dome.renderOrder = -10; dome.frustumCulled = false; scene.add(dome);
  const starPos = []; for (let i = 0; i < 700; i++) { const a = rnd() * Math.PI * 2, y = .08 + rnd() * .92, r = Math.sqrt(1 - y * y); starPos.push(Math.cos(a) * r * 700, y * 700, Math.sin(a) * r * 700); }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  stars.renderOrder = -9; scene.add(stars);
  const disc = (draw) => { const t = tex(draw, 128, 128); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; };
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: disc((g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, '#fffdf2'); r.addColorStop(.28, '#fff1c4'); r.addColorStop(.36, 'rgba(255,214,140,.55)'); r.addColorStop(1, 'rgba(255,190,120,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); }), fog: false, depthWrite: false, transparent: true, toneMapped: false }));
  sunSprite.scale.set(110, 110, 1); sunSprite.renderOrder = -8; scene.add(sunSprite);
  const phase = moonPhase();
  const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: disc((g, w) => {
    const cx = w / 2, r = 40, lit = '#f4f1e6', dark = 'rgba(40,48,66,.55)', side = phase.f < .5 ? 1 : -1, k = Math.cos(2 * Math.PI * phase.f);
    const halo = g.createRadialGradient(cx, cx, r * .9, cx, cx, w / 2); halo.addColorStop(0, `rgba(220,230,255,${.08 + phase.lit / 500})`); halo.addColorStop(1, 'rgba(220,230,255,0)'); g.fillStyle = halo; g.fillRect(0, 0, w, w);
    g.fillStyle = dark; g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = lit; g.beginPath(); g.arc(cx, cx, r, -Math.PI / 2, Math.PI / 2, side < 0); g.closePath(); g.fill();
    g.fillStyle = k > 0 ? dark : lit; g.beginPath(); g.ellipse(cx, cx, Math.abs(k) * r, r, 0, 0, Math.PI * 2); g.fill();
    if (k > 0) { g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(cx, cx, Math.abs(k) * r, r, 0, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = 'source-over'; }
    g.fillStyle = 'rgba(150,145,130,.25)'; [[-12, -10, 7], [10, 6, 9], [-4, 16, 5], [14, -14, 4]].forEach(([a, b, s]) => { g.beginPath(); g.arc(cx + a, cx + b, s, 0, Math.PI * 2); g.fill(); });
  }), fog: false, depthWrite: false, transparent: true, toneMapped: false }));
  moonSprite.scale.set(60, 60, 1); moonSprite.renderOrder = -8; scene.add(moonSprite);

  const lerpKey = h => {
    let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
    const a = KEYS[i], b = KEYS[i + 1], t = (h - a[0]) / Math.max(.001, b[0] - a[0]);
    return a.map((v, k) => k === 0 ? h : typeof v === 'string' ? mix(v, b[k], t) : v + (b[k] - v) * t);
  };
  const dirFor = (frac, alt) => { const az = Math.PI * frac, e = Math.sin(Math.PI * frac) * alt; return new THREE.Vector3(Math.cos(az) * Math.cos(e), Math.sin(e), .35 * Math.cos(e)).normalize(); };

  /** Sky, light and haze for an hour of the day in Kerala; returns whether it is dark enough for lamps. */
  function skyAt(h) {
    const [, top, hor, sunC, sunI, hs, hg, hi, exp] = lerpKey(h);
    uni.top.value.set(top); uni.hor.value.set(hor);
    const day = (h - RISE) / (SET - RISE), nightFrac = ((h - SET + 24) % 24) / (24 - (SET - RISE));
    const sunUp = day > -.04 && day < 1.04, sDir = dirFor(Math.min(1.04, Math.max(-.04, day)), 1.2), mDir = dirFor(nightFrac, 1.0);
    uni.sunDir.value.copy(sDir); uni.glowK.value = sunUp ? Math.max(0, 1 - Math.abs(sDir.y) * 2.2) + .15 : 0;
    sunSprite.visible = sunUp; sunSprite.position.copy(sDir).multiplyScalar(680);
    const dark = h < 6.0 || h > 18.7, dusk = h < 6.6 || h > 18.1;
    moonSprite.visible = dusk && mDir.y > -.02 && phase.f > .03 && phase.f < .97; moonSprite.position.copy(mDir).multiplyScalar(660);
    stars.material.opacity = dark ? .85 : dusk ? .3 : 0;
    // the scene's key light is the sun by day and the moon by night
    const key = sunUp ? sDir : mDir;
    c.sun.position.copy(key).multiplyScalar(110).setY(Math.max(18, key.y * 110)); c.sun.color.set(sunC); c.sun.intensity = sunI * (sunUp ? 1 : .5 + phase.lit / 200);
    c.hemi.color.set(hs); c.hemi.groundColor.set(hg); c.hemi.intensity = hi; c.renderer.toneMappingExposure = exp;
    scene.fog.color.set(hor); scene.background = scene.fog.color;
    hillLayers.forEach(l => l.mat.color.set(mix(l.base, hor, Math.min(.85, l.haze + (dark ? .25 : 0)))));
    far.material.color.set(mix('#557a45', hor, dark ? .55 : .25));
    return dark;
  }

  return {
    setSignals, drive, stroll, placeLights, skyAt, moon: phase,
    update(dt, T, night) { setSignals(T); drive(dt, T); stroll(dt, T); heads.visible = tails.visible = night; if (night) placeLights(); },
  };
}
