// Builds the office: floors, walls, glass, cubicles, every room's furniture, the plaza and the pine forest.
//
// Speed: nothing here moves except the entrance doors and two wall screens, so everything is merged by look into a
// handful of meshes. A full office draws in a few dozen calls. Lamps are baked as soft pools of light on the floor;
// the engine moves a small set of real lights to whichever lamps are near you.

import { AUTO_DOORS, BUILDING, CUBICLE_PAIRS, CUBICLE_SIZE, MEETING_CHAIRS, MEETING_TABLE, OFFICE_ROOMS, WALLS, cubicleSlots, wallPieces } from './floorplan.mjs';

const WH = BUILDING.height, DOOR_H = 2.35;
const C = {
  wood: '#6d4526', woodDark: '#3b2415', woodLight: '#a97c4e', desk: '#b6a487', deskDark: '#5e432d', teal: '#2e4f4c', trim: '#cdbf9f', metal: '#3b3a38', metalLight: '#8d8a84', black: '#17161a', white: '#e9e4d8', cream: '#d8cbb0',
  leaf: '#3f7a3a', leafDark: '#2b5a2c', pot: '#2a2622', potLight: '#b4603c', red: '#a8322a', orange: '#d27a2c', yellow: '#e2b13c', blue: '#2f4f6d', felt: '#2f6a3f', feltBlue: '#27506b', cloth: '#3c3a38', leather: '#2b2522',
  ceiling: '#3b342c', ceilingDark: '#2a2520', vent: '#6d675c', shade: '#d9ccb2', bulb: '#ffe2ab', pine: '#10291f', pineLight: '#163427', trunk: '#3a2a1e', concrete: '#8d8b84', gold: '#d9a93f',
};

export function createBuilding({ THREE, scene, rnd, seats, people, rooms }) {
  /* ---------- geometry kit: everything lands in a bucket that becomes one mesh ---------- */
  const bucket = () => ({ pos: [], nor: [], col: [] }); const B = { solid: bucket(), ceiling: bucket(), outside: bucket(), glow: bucket(), glass: bucket() };
  const _c = new THREE.Color(), _m = new THREE.Matrix4(), _n = new THREE.Matrix3(), _v = new THREE.Vector3(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const flat = g => { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; };
  const BOX = flat(new THREE.BoxGeometry(1, 1, 1)), cyls = new Map(), icos = new Map();
  const colorCache = new Map(); const rgb = hex => { let c = colorCache.get(hex); if (!c) { _c.set(hex); c = [_c.r, _c.g, _c.b]; colorCache.set(hex, c); } return c; };
  function emit(geo, hex, x, y, z, sx, sy, sz, o) {
    const b = B[o?.bucket || 'solid'], [r, g, bl] = rgb(hex), pa = geo.attributes.position, na = geo.attributes.normal;
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(o?.rx || 0, o?.ry || 0, o?.rz || 0, 'YXZ')), _s.set(sx, sy, sz)); _n.getNormalMatrix(_m);
    for (let i = 0; i < pa.count; i++) {
      _v.fromBufferAttribute(pa, i).applyMatrix4(_m); b.pos.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(na, i).applyMatrix3(_n).normalize(); b.nor.push(_v.x, _v.y, _v.z); b.col.push(r, g, bl);
    }
  }
  const box = (w, h, d, hex, x, y, z, o) => emit(BOX, hex, x, y, z, w, h, d, o);
  /** A box standing on the floor: y is its base, not its centre. */
  const post = (w, h, d, hex, x, y, z, o) => box(w, h, d, hex, x, y + h / 2, z, o);
  function cyl(rt, rb, h, hex, x, y, z, o = {}) { const seg = o.seg || 8, k = `${rt}|${rb}|${seg}`; if (!cyls.has(k)) cyls.set(k, flat(new THREE.CylinderGeometry(rt, rb, 1, seg, 1))); emit(cyls.get(k), hex, x, y, z, 1, h, 1, o); }
  function ico(r, hex, x, y, z, o = {}) { const d = o.detail ?? 1; if (!icos.has(d)) icos.set(d, flat(new THREE.IcosahedronGeometry(1, d))); emit(icos.get(d), hex, x, y, z, r * (o.sx ?? 1), r * (o.sy ?? 1), r * (o.sz ?? 1), o); }

  /* ---------- textured floors ---------- */
  const floorCanvas = (draw, size = 512) => { const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t; };
  const planks = (base, dark, light, n = 6) => (g, S) => { g.fillStyle = base; g.fillRect(0, 0, S, S); const w = S / n; for (let i = 0; i < n; i++) { const off = rnd() * S; for (let k = 0; k < 3; k++) { g.fillStyle = rnd() > .5 ? dark : light; g.globalAlpha = .1 + rnd() * .22; g.fillRect(i * w, (off + k * S / 2) % S, w, S / 2); } g.globalAlpha = .6; g.fillStyle = 'rgba(20,10,4,.75)'; g.fillRect(i * w, 0, 1.6, S); g.fillRect(i * w, off % S, w, 1.6); g.globalAlpha = 1; } };
  const chevron = (a, b, line) => (g, S) => { g.fillStyle = a; g.fillRect(0, 0, S, S); const n = 8, h = S / n; for (let r = -1; r <= n; r++) { g.lineWidth = h * .96; g.strokeStyle = r % 2 ? a : b; g.beginPath(); g.moveTo(-10, r * h + S / 4); g.lineTo(S / 2, r * h); g.lineTo(S + 10, r * h + S / 4); g.stroke(); g.lineWidth = 1.4; g.strokeStyle = line; g.beginPath(); g.moveTo(-10, r * h + S / 4 + h / 2); g.lineTo(S / 2, r * h + h / 2); g.lineTo(S + 10, r * h + S / 4 + h / 2); g.stroke(); } };
  const speckle = (base, marks) => (g, S) => { g.fillStyle = base; g.fillRect(0, 0, S, S); for (let i = 0; i < 90; i++) { g.fillStyle = marks[Math.floor(rnd() * marks.length)]; const w = 10 + rnd() * 36, h = 5 + rnd() * 22; g.fillRect(rnd() * S, rnd() * S, w, h); } };
  const tiles = (base, line, n = 4) => (g, S) => { g.fillStyle = base; g.fillRect(0, 0, S, S); g.fillStyle = line; for (let i = 0; i < n; i++) { g.fillRect(i * S / n, 0, 2, S); g.fillRect(0, i * S / n, S, 2); } };
  const grain = (base, spread) => (g, S) => { g.fillStyle = base; g.fillRect(0, 0, S, S); for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${spread},${.04 + rnd() * .1})`; g.fillRect(rnd() * S, rnd() * S, 2, 2); } };
  const FLOORS = {
    planks: [planks('#b38a58', '#8d6638', '#cda673'), 3.2], hall: [planks('#8a5c33', '#6a4322', '#a4743f', 5), 2.6], chevron: [chevron('#94704b', '#7d5c3b', 'rgba(30,16,6,.7)'), 2.2], chevronDark: [chevron('#3d3a36', '#2f2d2a', 'rgba(0,0,0,.6)'), 2.2],
    carpet: [speckle('#6e2f1e', ['#7d3a24', '#5f2717', '#8a4429', '#68301f']), 4], carpetDark: [speckle('#3c1a14', ['#4a2118', '#32150f', '#552820']), 3.4], rubber: [grain('#1e3a24', '0,0,0'), 2], tile: [tiles('#6f6d67', 'rgba(25,24,22,.55)'), 2.4],
    deck: [planks('#83603c', '#694a2b', '#986f45', 7), 3], concrete: [tiles('#6a6964', 'rgba(20,20,20,.45)', 3), 4.2], asphalt: [grain('#23252a', '255,255,255'), 3], grass: [grain('#16261b', '60,110,60'), 5], path: [tiles('#57564f', 'rgba(15,15,15,.5)', 2), 2],
  };
  const floorData = {};
  function floor(key, x1, z1, x2, z2, y = .012) {
    const f = floorData[key] ||= { pos: [], uv: [] }, s = FLOORS[key][1], q = [[x1, z1], [x1, z2], [x2, z2], [x1, z1], [x2, z2], [x2, z1]];
    for (const [x, z] of q) { f.pos.push(x, y, z); f.uv.push(x / s, z / s); }
  }

  /* ---------- soft pools of lamplight ---------- */
  const pools = [];
  // Decorative mats top out at y=.03. Keep light overlays clearly above them so
  // the depth buffer does not alternate between the mat and the light quad.
  function pool(x, z, r, strength = 1, y = .06) { pools.push({ x, z, r, y, strength }); }
  const LAMPS = [];
  const lampAt = (x, z, r = 5.2, strength = 1) => { LAMPS.push({ x, z, y: WH - .35 }); pool(x, z, r, strength); };

  /* ---------- shared texture for signs, posters and screens ---------- */
  const SIZE = 2048, atlasCanvas = document.createElement('canvas'); atlasCanvas.width = atlasCanvas.height = SIZE; const A = atlasCanvas.getContext('2d');
  let ax = 0, ay = 0, rowH = 0;
  function atlas(w, h, draw) {
    if (ax + w + 2 > SIZE) { ax = 0; ay += rowH + 2; rowH = 0; }
    const x = ax, y = ay; ax += w + 2; rowH = Math.max(rowH, h);
    A.save(); A.beginPath(); A.rect(x, y, w, h); A.clip(); A.translate(x, y); draw(A, w, h); A.restore();
    return { u0: x / SIZE, u1: (x + w) / SIZE, v0: 1 - (y + h) / SIZE, v1: 1 - y / SIZE };
  }
  const quads = { lit: { pos: [], nor: [], uv: [] }, glow: { pos: [], nor: [], uv: [] } };
  function sign(rect, w, h, x, y, z, ry = 0, glow = false) {
    const q = quads[glow ? 'glow' : 'lit'], cs = Math.cos(ry), sn = Math.sin(ry);
    const put = (lx, ly, u, v) => { q.pos.push(x + lx * cs, y + ly, z - lx * sn); q.nor.push(sn, 0, cs); q.uv.push(rect.u0 + u * (rect.u1 - rect.u0), rect.v0 + v * (rect.v1 - rect.v0)); };
    put(-w / 2, -h / 2, 0, 0); put(w / 2, -h / 2, 1, 0); put(w / 2, h / 2, 1, 1); put(-w / 2, -h / 2, 0, 0); put(w / 2, h / 2, 1, 1); put(-w / 2, h / 2, 0, 1);
  }
  const FONT = '"Archivo", "Arial Black", Arial, sans-serif';
  const label = (text, opt = {}) => atlas(opt.w || 256, opt.h || 64, (g, w, h) => {
    g.fillStyle = opt.bg || '#2c1b12'; g.fillRect(0, 0, w, h);
    if (opt.border) { g.strokeStyle = opt.border; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6); }
    g.fillStyle = opt.ink || '#efe6d4'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = Array.isArray(text) ? text : [text], size = opt.size || Math.min(h * .6 / lines.length, w / (Math.max(...lines.map(l => l.length)) * .68));
    g.font = `800 ${size}px ${FONT}`; lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.15));
  });
  const SCREENS = {
    bars: atlas(128, 80, (g, w, h) => { g.fillStyle = '#10182a'; g.fillRect(0, 0, w, h); g.fillStyle = '#c7b4ff'; for (let i = 0; i < 7; i++) { const b = 14 + rnd() * 48; g.fillRect(10 + i * 16, h - 8 - b, 11, b); } }),
    pie: atlas(128, 80, (g, w, h) => { g.fillStyle = '#efe9dc'; g.fillRect(0, 0, w, h); g.fillStyle = '#3a2a55'; for (let i = 0; i < 5; i++) g.fillRect(10 + i * 10, h - 14 - i * 8, 7, 8 + i * 8); g.fillStyle = '#6d4bd1'; g.beginPath(); g.moveTo(92, 40); g.arc(92, 40, 24, 0, 4.4); g.fill(); }),
    doc: atlas(128, 80, (g, w, h) => { g.fillStyle = '#f4efe2'; g.fillRect(0, 0, w, h); g.fillStyle = '#39352e'; g.font = `800 11px ${FONT}`; g.fillText('Notes', 12, 18); g.fillStyle = '#8a857a'; for (let i = 0; i < 6; i++) g.fillRect(12, 28 + i * 8, 40 + rnd() * 60, 3); }),
    code: atlas(128, 80, (g, w, h) => { g.fillStyle = '#10141c'; g.fillRect(0, 0, w, h); for (let i = 0; i < 9; i++) { g.fillStyle = ['#7dd3a8', '#e2b13c', '#8fb6ff', '#d6d1c4'][i % 4]; g.fillRect(8 + (i % 3) * 8, 8 + i * 7.4, 24 + rnd() * 70, 3); } }),
    sprint: atlas(128, 80, (g, w, h) => { g.fillStyle = '#f2eee3'; g.fillRect(0, 0, w, h); g.fillStyle = '#26303d'; g.fillRect(0, 0, w, 10); for (let c = 0; c < 3; c++) for (let i = 0; i < 4 - c; i++) { g.fillStyle = '#ffffff'; g.fillRect(6 + c * 41, 15 + i * 15, 36, 12); g.fillStyle = ['#d0548a', '#3a7bd5', '#5b8c3e'][c]; g.fillRect(6 + c * 41, 15 + i * 15, 2.4, 12); } }),
    photo: atlas(128, 80, (g, w, h) => { g.fillStyle = '#2a120c'; g.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) { g.fillStyle = ['#e2b13c', '#c8704a', '#7a3020', '#f2d9a6'][i % 4]; g.beginPath(); g.arc(rnd() * w, rnd() * h, 4 + rnd() * 10, 0, 7); g.fill(); } }),
    timer: atlas(128, 80, (g, w, h) => { g.fillStyle = '#0b1a26'; g.fillRect(0, 0, w, h); g.fillStyle = '#dff1ff'; g.font = `800 28px ${FONT}`; g.textAlign = 'center'; g.fillText('06:05', w / 2, 50); }),
  };
  const screenKeys = Object.keys(SCREENS);
  const P = {
    achieve: label('ACHIEVE', { w: 256, h: 128, bg: '#23313f', ink: '#f2ead8', border: '#d9a93f' }), profits: label('PROFITS', { w: 200, h: 256, bg: '#efe9dc', ink: '#2a2622', border: '#2a2622' }),
    stocks: atlas(240, 180, (g, w, h) => { g.fillStyle = '#efe9dc'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2a2622'; g.lineWidth = 3; g.beginPath(); g.moveTo(24, 16); g.lineTo(24, h - 24); g.lineTo(w - 14, h - 24); g.stroke(); g.strokeStyle = '#b5362b'; g.lineWidth = 4; g.beginPath(); g.moveTo(30, 40); g.lineTo(90, 90); g.lineTo(130, 74); g.lineTo(w - 24, h - 34); g.stroke(); g.fillStyle = '#26303d'; g.font = `800 18px ${FONT}`; g.textAlign = 'center'; g.fillText('SALES', w / 2, 24); }),
    cert: atlas(120, 150, (g, w, h) => { g.fillStyle = '#efe7d3'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2a2622'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); g.fillStyle = '#8f2d22'; g.beginPath(); g.arc(w / 2, 50, 16, 0, 7); g.fill(); g.fillStyle = '#6c665a'; for (let i = 0; i < 4; i++) g.fillRect(24, 82 + i * 12, w - 48, 3); }),
    outOfOrder: label(['OUT OF', 'ORDER'], { w: 200, h: 140, bg: '#a42a20', ink: '#f6e6d6', border: '#f6e6d6' }), receptionist: label('RECEPTIONIST', { w: 512, h: 96, bg: '#3a2214', ink: '#efe2c9', border: '#c9a97c' }),
    brandWall: atlas(1024, 256, (g, w) => { g.clearRect(0, 0, w, 256); g.fillStyle = '#3a2214'; g.fillRect(0, 0, w, 256); g.fillStyle = '#f1e7d2'; g.textAlign = 'center'; g.font = `800 92px ${FONT}`; g.fillText('PARAKKAT AI OFFICE', w / 2, 118); g.font = `600 38px ${FONT}`; g.fillStyle = '#d9a93f'; g.fillText('74 PEOPLE  ·  ALWAYS ON', w / 2, 188); }),
    canopy: atlas(1024, 200, (g, w, h) => { g.fillStyle = '#26292e'; g.fillRect(0, 0, w, h); g.fillStyle = '#f1e7d2'; g.textAlign = 'center'; g.font = `800 84px ${FONT}`; g.fillText('PARAKKAT AI OFFICE', w / 2, 100); g.font = `600 34px ${FONT}`; g.fillStyle = '#d9a93f'; g.fillText('PARAKKAT JEWELS · MARKETING', w / 2, 158); }),
    men: label('MEN', { w: 96, h: 96, bg: '#1e4f79', ink: '#fff' }), women: label('WOMEN', { w: 96, h: 96, bg: '#7b2e55', ink: '#fff' }), exit: label('EXIT', { w: 128, h: 56, bg: '#1b6b3d', ink: '#e8ffe9' }), wet: label(['WET', 'FLOOR'], { w: 96, h: 128, bg: '#e2b13c', ink: '#1a1712' }),
  };
  const roomPlate = {}; for (const r of OFFICE_ROOMS) roomPlate[r.id] = label(r.name.toUpperCase(), { w: 360, h: 72, bg: '#17161a', ink: '#f1e7d2' });

  /* ---------- walls, glass and doors ---------- */
  const glassParts = [];
  for (const w of wallPieces()) {
    const len = w.to - w.from, mid = (w.from + w.to) / 2;
    const at = (along, across = 0) => w.alongX ? [along, w.line + across] : [w.line + across, along];
    const span = (l, across, h, hex, y, t = .06, o) => { const [x, z] = at(mid, across); w.alongX ? post(l, h, t, hex, x, y, z, o) : post(t, h, l, hex, x, y, z, o); };
    if (w.kind === 'solid') {
      span(len, -.055, WH, w.a, 0, .09); span(len, .055, WH, w.b, 0, .09);
      span(len, -.11, .12, C.woodDark, 0, .02); span(len, .11, .12, C.woodDark, 0, .02);
      span(len, 0, .08, C.metal, WH, .24);
    } else {
      const parts = Math.max(1, Math.round(len / 2.2));
      span(len, 0, .1, C.black, 0, .14); span(len, 0, .1, C.black, WH - .1, .14); span(len, 0, .05, C.black, 1.05, .08);
      for (let i = 0; i <= parts; i++) { const [x, z] = at(w.from + len * i / parts); post(.09, WH, .09, C.black, x, 0, z); }
      const [gx, gz] = at(mid); glassParts.push({ x: gx, z: gz, w: w.alongX ? len : .05, d: w.alongX ? .05 : len });
      // venetian blinds on some panes, as in a real office
      for (let i = 0; i < parts; i++) if (rnd() > .46) {
        const a = w.from + len * i / parts + .06, b = w.from + len * (i + 1) / parts - .06, low = 1.2 + rnd() * .5, sMid = (a + b) / 2, [x, z] = at(sMid);
        for (let y = low; y < WH - .15; y += .13) w.alongX ? box(b - a, .026, .05, '#b9b1a0', x, y, z) : box(.05, .026, b - a, '#b9b1a0', x, y, z);
      }
    }
    // the cut wall tops read clearly from above
  }
  for (const w of WALLS) for (const [a, b] of w.doors) {
    const alongX = w.z1 === w.z2, line = alongX ? w.z1 : w.x1, m = (a + b) / 2, hex = w.kind === 'glass' ? C.black : C.woodDark, l = b - a;
    alongX ? post(l, WH - DOOR_H, .24, w.kind === 'glass' ? C.black : w.a, m, DOOR_H, line) : post(.24, WH - DOOR_H, l, w.kind === 'glass' ? C.black : w.a, line, DOOR_H, m);
    for (const e of [a, b]) alongX ? post(.1, DOOR_H, .26, hex, e, 0, line) : post(.26, DOOR_H, .1, hex, line, 0, e);
  }
  // windows with blinds: on both faces of the outside walls
  function windowOn(alongX, line, a, b, outsideSign, y1 = 1, y2 = 2.45) {
    const m = (a + b) / 2, l = b - a, h = y2 - y1, cy = (y1 + y2) / 2;
    const place = (sd, off, w, ht, hex, y, o) => alongX ? box(w, ht, .03, hex, m, y, line + sd * off, o) : box(.03, ht, w, hex, line + sd * off, y, m, o);
    for (const sd of [-1, 1]) {
      const outside = sd === outsideSign;
      place(sd, .13, l, h, outside ? '#1c130b' : '#1a2a32', cy);
      place(sd, .15, l + .12, .07, C.black, y2); place(sd, .15, l + .12, .07, C.black, y1);
      for (const e of [a, b, m]) alongX ? box(.05, h, .03, C.black, e, cy, line + sd * .15) : box(.03, h, .05, C.black, line + sd * .15, cy, e);
      for (let y = y1 + .08; y < y2; y += .13) place(sd, .17, l - .05, .03, outside ? '#c9a06a' : '#c9c1ae', y, outside ? { bucket: 'glow' } : undefined);
    }
  }
  for (const [a, b] of [[-27, -24], [-20, -17], [-13, -10], [-7, -4], [0, 3], [5, 8], [11.5, 13.5], [18, 21], [24, 27]]) windowOn(true, -21, a, b, -1);
  for (const [a, b] of [[-13, -9], [-7, -3], [6, 10], [12, 16], [18, 22], [24, 28]]) windowOn(true, 21, a, b, 1);
  for (const [a, b] of [[-19, -16], [-14, -10], [8, 12], [15, 19]]) windowOn(false, 29, a, b, 1);
  for (const [a, b] of [[-18, -14], [-3, 1], [9, 13]]) windowOn(false, -29, a, b, -1);

  /* ---------- floors and ceilings ---------- */
  const roomFloor = { reception: 'chevron', workspace: 'carpet', meeting: 'chevron', leadership: 'carpetDark', studio: 'chevronDark', server: 'rubber', game: 'planks', kitchen: 'tile', lounge: 'planks', restrooms: 'tile' };
  for (const r of OFFICE_ROOMS) { if (r.id === 'lounge') continue; floor(roomFloor[r.id], r.x1, r.z1, r.x2, r.z2); }
  floor('planks', -15, -5.5, 4, 15); floor('planks', -15, 15, -2, 21);
  floor('hall', BUILDING.x1, -8.5, BUILDING.x2, -5.5);
  for (const x of [-20, -9, 2, 13, 24]) post(4, .012, 1.4, '#7a2f22', x, .014, -7);
  post(BUILDING.x2 - BUILDING.x1 + .6, .32, BUILDING.z2 - BUILDING.z1 + .6, '#2b2823', 0, -.32, 0, { bucket: 'outside' });

  function ceilingOver(x1, z1, x2, z2) {
    const w = x2 - x1, d = z2 - z1, cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, o = { bucket: 'ceiling' };
    post(w, .1, d, C.ceiling, cx, WH, cz, o);
    const panelEvery = 3.6;
    for (let x = x1 + panelEvery / 2; x < x2 - .6; x += panelEvery) for (let z = z1 + panelEvery / 2; z < z2 - .6; z += panelEvery) {
      post(panelEvery - .5, .02, panelEvery - .5, rnd() > .5 ? C.ceilingDark : '#463e34', x, WH - .02, z, o);
      if (rnd() > .86) { post(.9, .08, .5, C.vent, x, WH - .1, z, o); for (let i = -2; i <= 2; i++) box(.8, .012, .03, C.ceilingDark, x, WH - .105, z + i * .08, o); }
    }
    for (let x = x1 + .9; x < x2; x += 5.4) post(.12, .2, d, C.woodDark, x, WH - .2, cz, o);
  }
  ceilingOver(BUILDING.x1, BUILDING.z1, BUILDING.x2, BUILDING.z2);

  /** A hanging shade over a table: the angular shade the rooms are lit by. */
  function pendant(x, z, dark = false, y = 2.15) {
    const o = { bucket: 'ceiling' }, shade = dark ? '#26231f' : C.shade;
    cyl(.012, .012, WH - y - .24, C.black, x, (WH + y + .24) / 2, z, { ...o, seg: 5 });
    cyl(.06, .3, .24, shade, x, y + .12, z, { ...o, seg: 8 }); cyl(.3, .36, .1, shade, x, y - .03, z, { ...o, seg: 8 });
    cyl(.34, .34, .012, C.bulb, x, y - .085, z, { bucket: 'glow', seg: 8 });
    lampAt(x, z, 5.4, 1.15);
  }
  /** A flat ceiling light. */
  function downlight(x, z, r = 4.8, strength = .9) {
    cyl(.34, .38, .1, C.vent, x, WH - .05, z, { bucket: 'ceiling', seg: 8 }); cyl(.25, .25, .012, C.bulb, x, WH - .105, z, { bucket: 'glow', seg: 8 });
    lampAt(x, z, r, strength);
  }

  /* ---------- furniture ---------- */
  function chair(x, z, heading = 0, hex = C.leather, tall = false) {
    const s = Math.sin(heading), c = Math.cos(heading), back = (d) => [x - s * d, z - c * d];
    for (let i = 0; i < 5; i++) { const a = i * 1.257; box(.26, .025, .035, C.metal, x + Math.cos(a) * .13, .075, z - Math.sin(a) * .13, { ry: a }); cyl(.03, .03, .03, C.black, x + Math.cos(a) * .26, .035, z - Math.sin(a) * .26, { seg: 5 }); }
    cyl(.025, .03, .36, C.metal, x, .26, z, { seg: 6 });
    box(.48, .08, .46, hex, x, .47, z, { ry: heading });
    const [bx, bz] = back(.21), h = tall ? .86 : .62; box(.44, h, .08, hex, bx, .5 + h / 2, bz, { ry: heading, rx: -.08 });
    for (const sd of [-1, 1]) box(.04, .03, .28, C.metal, x + c * sd * .26 - s * .02, .67, z - s * sd * .26 - c * .02, { ry: heading });
  }
  function plant(x, z, s = 1, big = false) {
    cyl(.2 * s, .14 * s, .32 * s, C.pot, x, .16 * s, z, { seg: 8 });
    const n = big ? 8 : 6;
    for (let i = 0; i < n; i++) { const a = i * 2.4, r = (.18 + (i % 3) * .1) * s, y = (.48 + (i % 3) * .24) * s * (big ? 1.5 : 1);
      ico(.3 * s, i % 2 ? C.leaf : C.leafDark, x + Math.cos(a) * r, y, z + Math.sin(a) * r, { detail: 0, sx: .32, sy: big ? 1.1 : .75, sz: .16, ry: -a, rz: .5 }); }
  }
  function monitor(x, y, z, heading, kind, w = .72, h = .44) {
    const s = Math.sin(heading), c = Math.cos(heading), rect = SCREENS[kind || screenKeys[Math.floor(rnd() * screenKeys.length)]];
    box(.16, .02, .13, C.black, x, y + .01, z, { ry: heading }); box(.04, .14, .04, C.black, x, y + .08, z);
    box(w + .04, h + .04, .035, C.black, x, y + .15 + h / 2, z, { ry: heading });
    sign(rect, w, h, x + s * .022, y + .15 + h / 2, z + c * .022, heading, true);
  }
  const cup = (x, y, z) => { cyl(.038, .03, .1, '#f0ece2', x, y + .05, z, { seg: 6 }); cyl(.04, .04, .018, C.black, x, y + .108, z, { seg: 6 }); };
  const mug = (x, y, z, hex = '#e6e0d3') => cyl(.036, .036, .08, hex, x, y + .04, z, { seg: 7 });
  const papers = (x, y, z, n = 4) => { for (let i = 0; i < n; i++) box(.2, .006, .28, '#ece6d8', x + (rnd() - .5) * .03, y + i * .007, z + (rnd() - .5) * .03, { ry: (rnd() - .5) * .35 }); };
  function deskClutter(x, y, z, facing, level = 1) {
    // Facing is the side the sitter is on. Every desk gets its own mess.
    const f = facing, side = () => (rnd() - .5);
    if (rnd() < .7) { cup(x + side() * 1.5, y, z + f * (.05 + rnd() * .15)); }
    if (rnd() < .6 * level) papers(x + side() * 1.5, y, z + f * .05, 2 + Math.floor(rnd() * 5));
    if (rnd() < .4) { const hx = x + side() * 1.5, hz = z - f * .1; for (let i = 0; i < 4; i++) box(.2 + rnd() * .05, .024, .27, ['#7a3020', '#26303d', '#d9cdb5', '#3f6e55'][i], hx, y + .012 + i * .025, hz, { ry: rnd() * .3 }); }
    if (rnd() < .35) plant(x + side() * 1.5, z - f * .2, .34);
    if (rnd() < .3) { const tx = x + side(), tz = z - f * .12; box(.32, .012, .24, C.metal, tx, y + .015, tz); for (const k of [-1, 1]) box(.32, .05, .01, C.metal, tx, y + .04, tz + k * .12); for (const k of [-1, 1]) box(.01, .05, .24, C.metal, tx + k * .16, y + .04, tz); }
    if (rnd() < .3) { const fx = x + side() * 1.5; box(.16, .2, .012, C.black, fx, y + .1, z - f * .2); }
    if (rnd() < .25) { const cx = x + side() * 1.2, cz = z - f * .15; cyl(.05, .05, .012, C.black, cx, y + .008, cz, { seg: 6 }); box(.015, .22, .015, C.black, cx, y + .12, cz); box(.2, .03, .08, C.black, cx + .08, y + .23, cz); }
    if (rnd() < .4) { for (let i = 0; i < 4; i++) box(.3 + rnd() * .3, .006, .012, C.black, x + side(), .006, z - f * (.2 + rnd() * .3), { ry: rnd() * 2 }); }
  }
  function desk(x, z, w, d, heading, kind, top = C.desk) {
    // heading points at the sitter. A plain desk on two side panels.
    const alongX = Math.abs(Math.sin(heading)) < .5, sw = alongX ? w : d, sd = alongX ? d : w;
    post(sw, .05, sd, top, x, .72, z);
    for (const k of [-1, 1]) alongX ? post(.05, .72, sd * .9, C.metal, x + k * (sw / 2 - .08), 0, z) : post(sd === d ? sw * .9 : sw * .9, .72, .05, C.metal, x, 0, z + k * (sd / 2 - .08));
    const s = Math.sin(heading), c = Math.cos(heading);
    monitor(x - s * d * .22, .77, z - c * d * .22, heading, kind);
    box(.42, .02, .14, C.black, x + s * d * .16, .78, z + c * d * .16, { ry: heading });
    deskClutter(x, .77, z, alongX ? Math.sign(c) : 1, .9);
  }
  function shelf(x, z, w, h, heading = 0, frame = C.white) {
    const s = Math.sin(heading), c = Math.cos(heading), t = .32, o = { ry: heading };
    box(w, h, .02, frame, x - s * t / 2, h / 2, z - c * t / 2, o);
    for (const k of [-1, 1]) box(.03, h, t, frame, x + c * k * w / 2, h / 2, z - s * k * w / 2, o);
    const rows = Math.floor(h / .42);
    for (let r = 0; r <= rows; r++) box(w, .03, t, frame, x, .03 + r * (h - .04) / rows, z, o);
    for (let r = 0; r < rows; r++) { let u = -w / 2 + .08; while (u < w / 2 - .12) { const bw = .03 + rnd() * .04, bh = .18 + rnd() * .14, hex = ['#7a3020', '#26303d', '#d9cdb5', '#3f6e55', '#8a6a3a', '#1d1c20'][Math.floor(rnd() * 6)]; if (rnd() > .24) box(bw, bh, .2, hex, x + c * u, .05 + r * (h - .04) / rows + bh / 2, z - s * u, o); u += bw + .006; if (rnd() > .9) u += .18; } }
  }
  function sofa(x, z, w, heading, hex = '#4a463f') {
    const s = Math.sin(heading), c = Math.cos(heading), o = { ry: heading };
    box(w, .36, .86, hex, x, .22, z, o); box(w, .5, .2, hex, x - s * .36, .62, z - c * .36, o);
    for (const k of [-1, 1]) box(.18, .46, .86, hex, x + c * k * (w / 2 - .09), .32, z - s * k * (w / 2 - .09), o);
    for (let i = 0, n = Math.max(2, Math.round(w / .8)); i < n; i++) { const u = -w / 2 + .2 + (w - .4) * (i + .5) / n; box((w - .4) / n - .03, .12, .62, '#5c584f', x + c * u + s * .06, .44, z - s * u + c * .06, o); }
  }
  const beanbag = (x, z, hex) => { ico(.5, hex, x, .36, z, { detail: 1, sy: .72 }); };
  function poolTable(x, z, felt, along = true) {
    const w = along ? 4.4 : 2.2, d = along ? 2.2 : 4.4;
    post(w + .3, .2, d + .3, C.woodDark, x, .66, z); post(w, .03, d, felt, x, .86, z);
    for (const a of [-1, 1]) { post(w + .3, .1, .15, C.wood, x, .84, z + a * (d / 2 + .08)); post(.15, .1, d + .3, C.wood, x + a * (w / 2 + .08), .84, z); }
    for (const a of [-1, 1]) for (const b of [-1, 1]) { post(.22, .66, .22, C.woodDark, x + a * (w / 2 - .1), 0, z + b * (d / 2 - .1)); cyl(.07, .07, .02, C.black, x + a * w / 2, .895, z + b * d / 2, { seg: 8 }); }
    for (const a of [-1, 0, 1]) cyl(.07, .07, .02, C.black, x + a * 0, .895, z + (along ? 1 : 0) * (d / 2), { seg: 8 });
    for (let i = 0; i < 9; i++) ico(.04, ['#e9e4d8', '#c9322b', '#e2b13c', '#2f4f6d', '#1a1a1a'][i % 5], x + (rnd() - .5) * w * .7, .93, z + (rnd() - .5) * d * .7, { detail: 0 });
    box(1.5, .025, .025, '#c9a97c', x - .2, .92, z + .4, { ry: .7 });
  }
  function bookcaseWall(x, z) { shelf(x, z, 2, 1.8, 0); }

  /* ---------- 1. reception ---------- */
  {
    const fx = -22; for (let x = -28.7; x < -15.2; x += .46) post(.16, WH - .1, .12, x % 2 < 1 ? '#6b4326' : '#5a3a20', x, 0, 7.72);
    sign(P.brandWall, 7.2, 1.8, fx, 2.3, 7.83, 0, true);
    // curved front desk, built from angled facets
    const seg = 7, R = 4.2, cz = 7.4, deskH = .92;
    for (let i = 0; i < seg; i++) { const a = -0.72 + (1.44 * i) / (seg - 1), x = fx + Math.sin(a) * R, z = cz + Math.cos(a) * R; post(1.16, deskH, .32, '#7c5330', x, 0, z, { ry: a }); post(1.22, .05, .62, '#92683f', x, deskH, z - Math.cos(a) * .12, { ry: a }); post(1.1, .04, .5, '#b08a5c', x, .72, z - Math.cos(a) * .36, { ry: a }); }
    post(1.62, .36, .05, '#2a170d', fx, .98, 11.3); sign(P.receptionist, 1.5, .28, fx, 1.16, 11.34, 0);
    monitor(fx + .95, .76, 10.25, -Math.PI * .86, 'doc', .72, .42); box(.4, .02, .14, C.black, fx + .5, .77, 9.95, { ry: .4 });
    chair(fx, 9.45, 0, C.leather, true);
    const jar = [fx + 1.7, .97, 11.1]; cyl(.14, .14, .3, '#d8e4dd', jar[0], jar[1] + .15, jar[2], { seg: 9 }); for (let i = 0; i < 10; i++) ico(.035, ['#e2b13c', '#c9322b', '#3a7bd5', '#5b8c3e'][i % 4], jar[0] + (rnd() - .5) * .16, jar[1] + .06 + rnd() * .18, jar[2] + (rnd() - .5) * .16, { detail: 0 });
    for (let i = 0; i < 3; i++) cup(fx - 1.6 - i * .14, .97, 11.1 + (i % 2) * .1);
    sofa(-27.4, 16, 2.6, Math.PI / 2, '#8a8074'); sofa(-27.4, 18.9, 1.7, Math.PI / 2, '#8a8074'); box(.9, .36, 1.3, C.wood, -25.5, .18, 17);
    plant(-27.9, 12, 1, true); plant(-16, 9.4, 1, true); plant(-16, 20, .9, true);
    // the jeweller's mark in the lobby: one big faceted diamond on a stepped plinth
    cyl(1.05, 1.15, .24, '#3a3631', -17.2, .12, 18, { seg: 8 }); cyl(.72, .8, .24, '#46413a', -17.2, .36, 18, { seg: 8 }); post(.34, .34, .34, '#7a2c22', -17.2, .46, 18);
    cyl(.8, 0, 1.1, C.gold, -17.2, 1.35, 18, { seg: 8, rx: Math.PI }); cyl(.5, .8, .42, '#f0c75a', -17.2, 2.1, 18, { seg: 8 });
    downlight(-26, 18, 5.4, .95); downlight(-18, 18, 5.4, .95); pendant(-24.4, 11.2); pendant(-19.6, 11.2);
  }

  /* ---------- 2. workspace: the cubicle floor ---------- */
  {
    const fin = (x, z1, z2) => { post(.1, 1.34, Math.abs(z2 - z1), C.teal, x, 0, (z1 + z2) / 2); post(.13, .05, Math.abs(z2 - z1) + .02, C.trim, x, 1.34, (z1 + z2) / 2); };
    const w = CUBICLE_SIZE.width, dz = CUBICLE_SIZE.deskZone;
    for (const pz of CUBICLE_PAIRS) for (const [i0, i1] of [[0, 3], [4, 7]]) {
      const x1 = cubicleSlots()[i0].x - w / 2, x2 = cubicleSlots()[i1].x + w / 2;
      post(x2 - x1, 1.34, .1, C.teal, (x1 + x2) / 2, 0, pz); post(x2 - x1 + .02, .05, .13, C.trim, (x1 + x2) / 2, 1.34, pz);
      for (let i = i0; i <= i1 + 1; i++) { const x = cubicleSlots()[Math.min(i, i1)].x + (i > i1 ? w / 2 : -w / 2); fin(x, pz - dz - .75, pz + dz + .75); }
      for (const k of [-1, 1]) post(.17, 1.4, .17, C.trim, x1, 0, pz + k * (dz + .75)), post(.17, 1.4, .17, C.trim, x2, 0, pz + k * (dz + .75));
    }
    const occupied = new Set(Object.values(seats).filter(s => s.area === 'workspace').map(s => `${s.row}:${s.col}`));
    for (const slot of cubicleSlots()) {
      const f = slot.south ? 1 : -1, dzc = slot.pairZ + f * .52;
      post(w - .14, .05, .9, C.desk, slot.x, .72, dzc);
      post(.05, .72, .84, C.metal, slot.x - w / 2 + .12, 0, dzc); post(.5, .66, .78, '#4d4f4d', slot.x + w / 2 - .4, 0, dzc);
      for (let d = 0; d < 3; d++) box(.46, .004, .02, C.black, slot.x + w / 2 - .4, .2 + d * .2, dzc + f * .4);
      const used = occupied.has(`${slot.row}:${slot.col}`);
      const heading = slot.south ? Math.PI : 0;
      monitor(slot.x + (rnd() - .5) * .3, .77, slot.pairZ + f * .22, slot.south ? 0 : Math.PI, used ? null : 'timer');
      box(.42, .02, .14, C.black, slot.x, .78, slot.pairZ + f * .72); box(.07, .025, .11, C.black, slot.x + .34, .78, slot.pairZ + f * .72);
      deskClutter(slot.x, .77, dzc, f, used ? 1 : .4);
      chair(slot.x, slot.z, heading, '#2a2b2c');
      // notes and photos pinned on the partition
      for (let i = 0, n = Math.floor(rnd() * 4); i < n; i++) box(.15, .15, .006, ['#e6d36a', '#e8e2d2', '#d58c5c', '#89b6a0'][i % 4], slot.x - .7 + rnd() * 1.4, 1 + rnd() * .22, slot.pairZ + f * .056);
    }
    // team signs on the partitions
    const teams = new Map();
    for (const p of people) { const s = seats[p.id]; if (s?.area !== 'workspace') continue; const t = teams.get(s.dept) || { sum: 0, n: 0, z: s.z, row: s.row }; t.sum += s.x; t.n++; teams.set(s.dept, t); }
    for (const [id, t] of teams) {
      const name = rooms.find(r => r.id === id)?.name || id, plate = label(name.toUpperCase(), { w: 400, h: 60, bg: '#141312', ink: '#ffd338' }), pz = CUBICLE_PAIRS[t.row >> 1], f = t.row % 2 ? 1 : -1;
      const bw = Math.min(2.4, name.length * .16 + .3);
      post(bw + .06, .32, .08, C.black, t.sum / t.n, 1.39, pz); sign(plate, bw, .28, t.sum / t.n, 1.55, pz + f * .045, f > 0 ? 0 : Math.PI, true);
    }
    // the rest of the floor
    plant(5, -4.4, 1.1, true); plant(28, -4.2, 1.1, true); plant(28, 20, 1.1, true); plant(5.1, 19.8, 1, true); plant(16.8, 19.8, .9, true);
    post(.34, 1.05, .34, '#c6c1b4', 27.6, 0, 8); cyl(.13, .13, .32, '#9bc4d8', 27.6, 1.22, 8, { seg: 8 });
    for (const x of [10, 16.8, 23.5]) for (const z of [-1.5, 8.4, 19]) if (!(z === 19 && x === 16.8)) downlight(x, z, 5.6, .9);
    downlight(10, 3.4, 4.8, .55); downlight(23.5, 3.4, 4.8, .55); downlight(10, 14, 4.8, .55); downlight(23.5, 14, 4.8, .55);
    // cork boards along the brick wall
    for (const z of [2, 12]) { post(.05, 1, 1.8, '#a07a4f', 28.84, 1.1, z); for (let i = 0; i < 9; i++) box(.006, .14, .14, ['#e6d36a', '#e8e2d2', '#d58c5c'][i % 3], 28.8, 1.25 + rnd() * .7, z - .7 + rnd() * 1.4); }
    sign(P.achieve, 1.6, .8, 13, 1.9, 21 - .13, Math.PI); sign(P.stocks, 1.3, 1, 20, 1.8, 21 - .13, Math.PI); sign(P.exit, .5, .22, 8.2, 2.62, -5.38, 0, true);
  }

  /* ---------- 3. meeting room ---------- */
  {
    const { x, z, w, d } = MEETING_TABLE;
    post(w + 1.8, .012, d + 3, '#b87a2e', x, .018, z);
    post(w, .07, d, '#4a3323', x, .72, z);
    for (const k of [-1, 1]) { post(.5, .72, 1, C.black, x + k * (w / 2 - 1.2), 0, z); }
    for (const c of MEETING_CHAIRS) chair(c.x, c.z, c.heading, C.leather, true);
    const lap = (lx, lz, f) => { box(.46, .02, .32, C.black, lx, .8, lz); box(.46, .3, .015, ['#c23a2c', '#2f4f6d', '#efe6d4'][Math.floor(rnd() * 3)], lx, .95, lz - f * .15, { rx: f * -.1 }); sign(SCREENS[rnd() > .5 ? 'photo' : 'sprint'], .4, .25, lx, .95, lz - f * .135, f > 0 ? 0 : Math.PI, true); };
    lap(x - 1.8, z - .55, -1); lap(x + .6, z - .55, -1); lap(x - .6, z + .55, 1); lap(x + 1.9, z + .55, 1);
    for (let i = 0; i < 4; i++) cup(x + .3 + (i % 2) * .12, .79, z + .06 + (i >> 1) * .12);
    papers(x - .3, .79, z - .05, 4); cyl(.06, .08, .04, '#b5823f', x - 1, .8, z + .2, { seg: 8 }); cyl(.05, .06, .22, '#8db5c5', x + 2.8, .9, z - .1, { seg: 7 });
    pendant(x - 1.9, z); pendant(x + 1.9, z); downlight(-26.8, -10.6, 3.6, .5); downlight(-17, -19, 3.6, .5);
    plant(-16.2, -19.8, 1, true); plant(-28.1, -9.6, .9, true);
    shelf(-28.75, -11.5, 1.8, 1.3, Math.PI / 2, C.woodDark); sign(P.stocks, 1, .75, -27.6, 1.9, -20.86, 0);
    // whiteboard on wheels
    post(.05, 1.15, 1.6, '#e9e6dc', -15.9, .8, -11.5); post(.09, .06, 1.7, C.metal, -15.9, 1.95, -11.5); post(.5, .04, .05, C.metal, -15.9, .1, -12.3); post(.5, .04, .05, C.metal, -15.9, .1, -10.7);
    post(.04, .8, .04, C.metal, -15.9, .1, -12.3); post(.04, .8, .04, C.metal, -15.9, .1, -10.7);
    sign(roomPlate.meeting, 1.2, .24, -17.2, 2.62, -8.38, 0);
  }

  /* ---------- 4. leadership suite ---------- */
  {
    const x = -9, z = -16.2;
    post(3.4, .08, 1.2, '#51331d', x, .72, z); post(3.2, .72, .1, '#3b2415', x, 0, z + .5);
    for (const k of [-1, 1]) post(.7, .72, 1, '#3b2415', x + k * 1.25, 0, z);
    monitor(x, .8, z - .28, 0, 'sprint', .85, .5); box(.42, .02, .14, C.black, x, .81, z - .02); box(.07, .025, .11, C.black, x + .36, .81, z - .02);
    chair(x, -17.6, 0, '#321613', true);
    // trophy, globe, in-tray
    cyl(.05, .09, .05, C.gold, x - 1.3, .83, z, { seg: 8 }); cyl(.015, .015, .12, C.gold, x - 1.3, .91, z, { seg: 6 }); cyl(.11, .05, .16, C.gold, x - 1.3, 1.05, z, { seg: 8 });
    ico(.15, '#3f6e92', x + 1.3, 1.04, z - .1, { detail: 1 }); cyl(.012, .012, .2, C.metal, x + 1.3, .9, z - .1, { seg: 5 }); papers(x + .9, .8, z + .15, 5); mug(x - .7, .8, z + .2);
    shelf(-9, -20.72, 3.4, 2, 0); post(.5, .26, .36, '#a98a5e', -9.4, 2, -20.72);
    desk(-14, -17, 2.2, .9, Math.PI / 2, 'doc', '#5e432d'); chair(-12.9, -17, -Math.PI / 2, '#321613');
    desk(-14, -13.6, 2.2, .9, Math.PI / 2, 'sprint', '#5e432d'); chair(-12.9, -13.6, -Math.PI / 2, '#321613');
    desk(-4, -19, 2.2, .9, -Math.PI / 2, 'bars', '#5e432d'); chair(-5.1, -19, Math.PI / 2, '#321613');
    desk(-4, -15.6, 2.2, .9, -Math.PI / 2, 'pie', '#5e432d'); chair(-5.1, -15.6, Math.PI / 2, '#321613');
    pendant(-9, -16); downlight(-12.8, -10.6, 3.6, .55); downlight(-5, -17, 4, .6);
    // the mini golf green, a management perk
    post(4, .03, 3, '#3a7a3a', -5.5, .018, -10.9); cyl(.06, .06, .015, C.black, -4.2, .05, -11.6, { seg: 8 }); post(.012, .8, .012, C.white, -4.2, .05, -11.6); box(.26, .16, .008, C.orange, -4.07, .79, -11.6); ico(.03, C.white, -6.2, .07, -10.5, { detail: 0 }); box(.8, .018, .018, C.metalLight, -6.5, .09, -10.1, { ry: .6 });
    // filing cabinet with typewriter and phone
    post(.55, .95, .55, '#8d8a84', -14.4, 0, -10); for (let i = 0; i < 3; i++) box(.2, .02, .02, C.black, -14.1, .22 + i * .3, -10); box(.34, .1, .24, C.black, -14.4, 1, -10);
    cyl(.02, .025, 1.8, C.woodDark, -3.6, .9, -12.9, { seg: 6 }); box(.24, .9, .06, '#7b7262', -3.6, 1.2, -12.75);
    plant(-13.8, -20.2, 1, true);
    sign(P.cert, .32, .4, -14.86, 2, -11.3, Math.PI / 2); sign(P.cert, .32, .4, -14.86, 2, -12.1, Math.PI / 2); sign(P.stocks, .75, .95, -3.14, 1.8, -12.4, -Math.PI / 2);
    sign(roomPlate.leadership, 1.3, .25, -10, 2.62, -8.38, 0);
  }

  /* ---------- 5. studio ---------- */
  {
    post(5.6, 2.5, .05, '#d8d2c4', 3, 0, -20.7); post(5.6, .04, 2.2, '#d8d2c4', 3, .012, -19.6); cyl(.04, .04, 5.8, C.black, 3, 2.56, -20.6, { rz: Math.PI / 2, seg: 6 });
    post(4.8, .012, 3.2, '#7c2a20', 3, .018, -17.7);
    chair(1.9, -18.2, Math.PI / 2 + .4, C.leather); chair(4.1, -18.2, -Math.PI / 2 - .4, C.leather);
    for (const x of [2.5, 3.5]) { cyl(.012, .014, 1, C.black, x, .5, -17.2, { seg: 5 }); cyl(.035, .03, .13, '#c7c1b4', x, 1.06, -17.2, { seg: 7 }); }
    const tripod = (x, z, ry) => { for (let i = 0; i < 3; i++) { const a = i * 2.09; box(.025, 1.3, .025, C.black, x + Math.cos(a) * .22, .65, z + Math.sin(a) * .22, { rx: Math.sin(a) * .34, rz: -Math.cos(a) * .34 }); } box(.3, .28, .46, C.black, x, 1.45, z, { ry }); cyl(.08, .09, .22, '#0e0e10', x + Math.sin(ry) * -.3, 1.45, z - Math.cos(ry) * .3, { seg: 8, rx: Math.PI / 2 }); box(.26, .18, .02, C.black, x + .1, 1.72, z + .2, { ry }); sign(SCREENS.photo, .22, .14, x + .1, 1.72, z + .212, ry, true); };
    tripod(.9, -14.8, -.4); tripod(5.1, -14.8, .4);
    // softboxes
    for (const [x, z] of [[-1.5, -19.9], [7.4, -20]]) { cyl(.02, .02, 1.9, C.black, x, .95, z, { seg: 5 }); box(.8, .6, .25, C.black, x, 2.05, z, { rx: .35 }); box(.74, .54, .02, '#fff6dd', x, 2.0, z + .14, { rx: .35, bucket: 'glow' }); }
    // edit benches
    post(.9, .05, 9.6, '#3d3a36', 8.2, .72, -14.8); post(.9, .05, 7.2, '#3d3a36', -2.2, .72, -13.6);
    for (const z of [-18.4, -16, -13.6, -11.2]) { post(.8, .72, .05, C.metal, 8.2, 0, z - 1.1); monitor(8.3, .77, z, -Math.PI / 2, 'photo'); chair(7.2, z, Math.PI / 2, '#222224'); box(.14, .02, .42, C.black, 7.82, .78, z); }
    for (const z of [-16, -13.6, -11.2]) { post(.8, .72, .05, C.metal, -2.2, 0, z - 1.1); monitor(-2.3, .77, z, Math.PI / 2, rnd() > .5 ? 'bars' : 'photo'); chair(-1.2, z, -Math.PI / 2, '#222224'); box(.14, .02, .42, C.black, -1.82, .78, z); }
    shelf(-2.72, -19.2, 1.5, 1.8, Math.PI / 2, C.woodDark); cyl(.05, .09, .05, C.gold, -2.6, 1.88, -19.2, { seg: 8 }); cyl(.11, .05, .18, C.gold, -2.6, 2, -19.2, { seg: 8 });
    plant(8, -9.5, .9, true); downlight(3, -18, 5.2, .8); downlight(3, -11.2, 4.4, .55); downlight(7, -13, 3.6, .4); downlight(-1, -13, 3.6, .4);
    sign(roomPlate.studio, 1, .24, 1.8, 2.62, -8.38, 0);
  }

  /* ---------- 6. server room ---------- */
  {
    const led = ['#58e08a', '#58e08a', '#e2b13c', '#4f9ce0', '#ff5c4a'];
    for (const rx of [11, 14]) for (let z = -20; z <= -14.6; z += 1.08) {
      post(.95, 2.3, 1, '#1d1e22', rx, 0, z);
      for (const face of [-1, 1]) for (let y = .25; y < 2.15; y += .2) { box(.012, .15, .86, '#2b2d33', rx + face * .48, y, z); for (let i = 0; i < 4; i++) if (rnd() > .28) box(.012, .022, .03, led[Math.floor(rnd() * 5)], rx + face * .49, y, z - .34 + i * .22, { bucket: 'glow' }); }
    }
    // overhead cable trays, and cables everywhere
    for (const x of [11, 14]) { post(.5, .04, 7, '#47494d', x, 2.5, -17.2); for (let i = 0; i < 7; i++) box(.05, .05, 6.8, ['#23446f', '#23446f', '#a42a20', '#1f6b45'][i % 4], x - .18 + i * .06, 2.56, -17.2); }
    for (let i = 0; i < 16; i++) box(.5 + rnd() * 1.2, .018, .018, ['#23446f', '#a42a20', '#1d1e22'][i % 3], 12.5 + (rnd() - .5) * 1.4, .02, -18 + rnd() * 7, { ry: rnd() * 3 });
    cyl(.28, .28, .1, '#23446f', 12.5, .05, -13.4, { seg: 10 }); post(.34, .34, .34, C.metal, 15.4, 0, -13.8);
    desk(9.6, -12.4, 1.1, .9, Math.PI / 2, 'code', '#3d3a36'); desk(9.6, -10.2, 1.1, .9, Math.PI / 2, 'code', '#3d3a36'); desk(15.4, -12.4, 1.1, .9, -Math.PI / 2, 'code', '#3d3a36'); desk(15.4, -10.2, 1.1, .9, -Math.PI / 2, 'bars', '#3d3a36');
    for (const [x, z, h] of [[10.7, -12.4, -Math.PI / 2], [10.7, -10.2, -Math.PI / 2], [14.3, -12.4, Math.PI / 2], [14.3, -10.2, Math.PI / 2]]) chair(x, z, h, '#222224');
    downlight(12.5, -17, 4.4, .6); downlight(12.5, -11, 4, .6);
    sign(roomPlate.server, 1, .24, 12.5, 2.62, -8.38, 0);
  }

  /* ---------- 7. game room ---------- */
  {
    const x = 22.5, z = -15; post(4.6, .06, 2.6, '#25465f', x, .74, z); post(4.6, .012, .03, C.white, x, .8, z); post(.03, .012, 2.6, C.white, x, .8, z);
    for (const a of [-1, 1]) for (const b of [-1, 1]) post(.08, .74, .08, C.black, x + a * 2.1, 0, z + b * 1.1);
    post(.03, .18, 2.8, C.black, x, .8, z);
    for (let i = 0; i < 2; i++) { box(.14, .02, .14, '#a42a20', x - .6 + i * 1.3, .82, z + .4 - i * .8); }
    beanbag(18, -10.4, '#b5432e'); beanbag(19.5, -10.1, '#d69a32'); beanbag(27.5, -10.3, '#3c6a7c');
    post(2, .05, .9, C.white, 17.4, .72, -19.6); for (const k of [-1, 1]) post(.05, .72, .85, C.metal, 17.4 + k * .9, 0, -19.6); box(.7, .08, .34, '#1d1e22', 17.2, .8, -19.6); box(.26, .03, .16, C.black, 17.9, .78, -19.6); monitor(16.9, .77, -19.9, 0, 'photo', .55, .34);
    chair(17.4, -18.4, Math.PI, '#a8322a');
    sofa(27.9, -18, 2, -Math.PI / 2, '#b8a98c'); shelf(23, -20.72, 2, 1.7, 0, C.woodDark); plant(28.2, -9.6, 1, true); plant(16.8, -9.5, .8, true);
    // bunting strung across the room, left up after the last party
    const o = { bucket: 'ceiling' }, flags = ['#a8322a', '#d27a2c', '#3f7a3a', '#2f4f6d', '#e2b13c'];
    for (const [a, b] of [[[16.6, -20], [28.6, -19]], [[16.6, -12], [28.6, -13]]]) for (let i = 0; i <= 16; i++) { const t = i / 16, fx = a[0] + (b[0] - a[0]) * t, fz = a[1] + (b[1] - a[1]) * t, fy = 2.55 - Math.sin(t * Math.PI) * .32; cyl(0, .09, .18, flags[i % 5], fx, fy, fz, { ...o, seg: 3, rx: Math.PI }); }
    // ceiling fan
    cyl(.05, .05, .25, C.metal, x, WH - .14, z, { ...o, seg: 6 }); cyl(.14, .14, .1, C.metal, x, WH - .3, z, { ...o, seg: 8 }); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; box(1.3, .02, .22, C.woodLight, x + Math.cos(a) * .75, WH - .32, z - Math.sin(a) * .75, { ...o, ry: a }); }
    downlight(19, -16.6, 4.6, .75); downlight(26, -13.4, 4.6, .75); downlight(19, -11, 3.4, .45); pool(x, z, 3.8, .55);
    sign(roomPlate.game, 1, .24, 22.5, 2.62, -8.38, 0);
  }

  /* ---------- 8. kitchen ---------- */
  {
    post(10, .9, .62, '#cdc4ae', -23.7, 0, -5.02); post(10.04, .05, .68, '#3f3b36', -23.7, .9, -5.02);
    post(10, .78, .36, '#d8cfb9', -23.7, 1.72, -5.22); for (let x = -28.5; x < -18.9; x += .9) { box(.012, .74, .012, '#9c927d', x, 2.1, -5.04); box(.16, .02, .02, C.black, x + .45, 1.78, -5.02); box(.012, .86, .012, '#9c927d', x, .45, -4.7); box(.16, .02, .02, C.black, x + .45, .78, -4.7); }
    // appliances
    box(.34, .34, .28, '#a8322a', -21, 1.12, -5, {}); box(.42, .22, .26, C.metalLight, -22.4, 1.04, -5); box(.2, .34, .2, '#d9d4c7', -23.6, 1.12, -5); cyl(.1, .14, .26, '#c9c2b4', -25, 1.08, -5, { seg: 8 }); post(.5, .28, .36, '#d8d3c8', -26.5, .95, -5);
    cyl(.012, .012, .3, C.metalLight, -24.2, 1.1, -5.15, { seg: 5 }); box(.6, .1, .4, '#a7a49b', -24.2, .9, -4.95);
    post(1.2, 2.3, 1.2, '#1f1e22', -28.2, 0, .6); box(.02, .9, .03, C.metalLight, -27.58, 1.3, .35); box(.02, .9, .03, C.metalLight, -27.58, 1.3, .85);
    post(1.1, .9, 3, '#cdc4ae', -28.25, 0, -2.6); post(1.14, .05, 3.04, '#3f3b36', -28.25, .9, -2.6);
    post(3.2, .06, 1.5, '#b08a5c', -22.8, .72, 2.4); for (const a of [-1, 1]) for (const b of [-1, 1]) post(.07, .72, .07, C.woodDark, -22.8 + a * 1.45, 0, 2.4 + b * .6);
    for (const dx of [-1, 0, 1]) { chair(-22.8 + dx, 1.1, 0, '#8a8074'); chair(-22.8 + dx, 3.7, Math.PI, '#8a8074'); } cup(-23.1, .78, 2.4); mug(-22.3, .78, 2.5); papers(-22.7, .78, 2.2, 2);
    plant(-16, 6.6, .9, true); pendant(-22.8, 2.4); downlight(-24, -2, 4.6, .8); downlight(-18, -2, 4.2, .6);
    sign(roomPlate.kitchen, 1, .24, -17.2, 2.62, -5.62, Math.PI);
  }

  /* ---------- 9. lounge ---------- */
  {
    poolTable(-9.4, 2, '#2f6a3f'); poolTable(-1.6, 7.6, '#2f6a3f');
    post(5.6, .012, 3.4, '#1f3f50', -9.4, .018, 2); post(5.6, .012, 3.4, '#a06e22', -1.6, .018, 7.6);
    // arcade cabinets on the west wall
    for (const [z, hex] of [[7.5, '#2a2622'], [10.4, '#20242c']]) {
      post(1, 1.9, 1.1, hex, -13.8, 0, z); post(.55, .06, .9, '#3a3631', -13.3, 1, z);
      sign(SCREENS[z < 9 ? 'bars' : 'photo'], .72, .5, -13.28, 1.44, z, Math.PI / 2, true); post(.1, .24, .9, C.orange, -13.3, 1.84, z);
      for (const k of [-1, 1]) { cyl(.035, .035, .05, '#c9322b', -13.3, 1.05, z + k * .2, { seg: 6 }); cyl(.02, .02, .12, C.black, -13.2, 1.1, z - k * .3, { seg: 5 }); }
    }
    // foosball
    post(2.2, .22, 1, '#4c3522', -7.2, .68, 12.4); post(2, .012, .9, '#3e7a3e', -7.2, .9, 12.4); for (const k of [-1, 1]) for (const j of [-1, 1]) post(.1, .68, .1, '#3b2415', -7.2 + k * .95, 0, 12.4 + j * .4);
    for (let i = 0; i < 6; i++) { const x = -8.1 + i * .36; cyl(.012, .012, 1.5, C.metalLight, x, .98, 12.4, { rx: Math.PI / 2, seg: 5 }); for (let j = 0; j < 2; j++) box(.04, .12, .05, i % 2 ? '#c9322b' : '#2f4f6d', x, .94, 12.1 + j * .6); }
    // sitting area
    post(5.6, .012, 4.2, '#7c2a20', -9.5, .018, 17.2); sofa(-9.5, 18.8, 4, Math.PI, '#57534b'); post(2.2, .05, 1, '#6d4526', -9.5, .38, 15.8); for (const k of [-1, 1]) post(.08, .38, .9, C.woodDark, -9.5 + k * 1, 0, 15.8); mug(-9.8, .43, 15.7); papers(-9.1, .43, 15.9, 3);
    box(1.4, .42, 2.6, '#6a6358', -13.6, .22, 18.8); box(.3, .46, 2.6, '#6a6358', -14.2, .62, 18.8); beanbag(-5, 17, '#a8322a');
    post(1.4, .04, .7, C.woodLight, -13.5, .72, 15); post(.05, .72, .6, C.metal, -14, 0, 15); post(.05, .72, .6, C.metal, -13, 0, 15); box(.34, .22, .02, C.black, -13.6, .86, 15, {});
    plant(3, -4.4, 1.2, true); plant(-14.2, -4.4, 1, true); plant(-3.6, 19.8, 1.1, true); plant(3.3, 13.8, .9, true);
    post(.05, 1, 1.8, '#a07a4f', 3.87, 1.1, 10.8);
    for (let i = 0; i < 8; i++) box(.006, .14, .14, ['#e6d36a', '#e8e2d2', '#d58c5c'][i % 3], 3.83, 1.25 + rnd() * .7, 10 + rnd() * 1.6);
    // ceiling fans
    const o = { bucket: 'ceiling' };
    for (const [x, z] of [[-6, 7.6], [-9, 14]]) { cyl(.14, .14, .1, C.metal, x, WH - .3, z, { ...o, seg: 8 }); cyl(.05, .05, .25, C.metal, x, WH - .14, z, { ...o, seg: 6 }); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + .3; box(1.3, .02, .22, C.woodLight, x + Math.cos(a) * .75, WH - .32, z - Math.sin(a) * .75, { ...o, ry: a }); } }
    pendant(-9.4, 1); pendant(-9.4, 3.4); pendant(-1.6, 6.4); pendant(-1.6, 8.8); downlight(-9.5, 17, 5.2, .85); downlight(-13, 9, 4, .65); downlight(-4, -2.2, 4, .6); downlight(1.5, 1.4, 3.6, .5); downlight(-6.4, 11, 4, .6);
    sign(roomPlate.lounge, 1, .24, -4.5, 2.62, -5.62, Math.PI);
    sign(P.men, .3, .3, -.7, 1.9, 14.87, Math.PI); sign(P.women, .3, .3, 2.7, 1.9, 14.87, Math.PI);
  }

  /* ---------- 10. restrooms ---------- */
  {
    // sinks and mirrors, then stalls; the last stall has its sign
    for (const [x, sd] of [[-1.85, 1], [3.85, -1]]) { post(.5, .08, 2, '#c8c3b6', x + sd * .25, .82, 16.5); for (const z of [16, 17]) { cyl(.14, .1, .05, '#e4e0d6', x + sd * .24, .89, z, { seg: 8 }); cyl(.012, .012, .16, C.metalLight, x + sd * .05, .96, z, { seg: 5 }); post(.012, .6, .6, '#a9c0c9', x, 1.12, z); } }
    for (const [cx, door] of [[-1.2, false], [-.2, false], [2, false], [3, true]]) {
      post(.04, 2, 1.5, '#7e7a6e', cx - .5, .05, 20.1); post(.92, 2, .04, '#88847a', cx, .05, 19.35);
      cyl(.2, .16, .38, '#e3e0d6', cx, .2, 20.3, { seg: 8 }); post(.4, .5, .16, '#d9d6cc', cx, .36, 20.78);
      if (door) sign(P.outOfOrder, .36, .25, cx, 1.2, 19.32, Math.PI);
    }
    downlight(-.5, 17.2, 3, .7); downlight(2.5, 17.2, 3, .7);
    // the cleaner's sign in the hall
    sign(P.wet, .2, .28, -1, .3, -6.9, Math.PI * .1); post(.34, .34, .02, C.yellow, -1, .13, -6.86, { ry: .1 });
  }

  /* ---------- hallway ---------- */
  {
    for (const x of [-24, -13, -3, 8, 18, 26]) downlight(x, -7, 4.6, .7);
    plant(28.2, -7.8, .9, true); plant(-28.2, -6.4, .9, true); sign(P.profits, .5, .64, -14.88, 1.7, -8.38, 0); sign(P.exit, .5, .22, -22, 2.62, -5.62, Math.PI, true);
    post(.5, 2.2, .1, C.metal, 28.86, 0, -7); post(.86, .96, .55, '#2a2622', 19, 0, -5.85);
  }

  /* ---------- outside: terrace, entrance, plaza, the street and the pines ---------- */
  let canopySign = null;
  {
    floor('deck', -37, 0, -29, 15, .03); post(8.3, .1, 15.3, '#3a2c20', -33, -.08, 7.5, { bucket: 'outside' });
    // pergola
    for (const [x, z] of [[-36.6, .4], [-36.6, 14.6], [-29.4, .4], [-29.4, 14.6], [-36.6, 7.5]]) post(.18, 2.7, .18, C.woodDark, x, 0, z);
    for (const z of [.4, 14.6]) post(7.4, .16, .14, C.woodDark, -33, 2.7, z); post(.14, .16, 14.4, C.woodDark, -36.6, 2.7, 7.5); post(.14, .16, 14.4, C.woodDark, -29.4, 2.7, 7.5);
    for (let z = 1; z < 14.6; z += .85) post(7.2, .1, .08, '#4a3323', -33, 2.86, z);
    // tables
    post(3.6, .06, 1.4, '#4a3323', -32.5, .72, 11); for (const k of [-1, 1]) post(.08, .72, 1, C.woodDark, -32.5 + k * 1.5, 0, 11); for (const dx of [-1, 0, 1]) { chair(-32.5 + dx, 9.9, 0, '#6d4a2c'); chair(-32.5 + dx, 12.1, Math.PI, '#6d4a2c'); }
    cyl(.9, .9, .06, '#4a3323', -33, .72, 3.6, { seg: 12 }); cyl(.05, .05, .72, C.woodDark, -33, .36, 3.6, { seg: 6 }); chair(-34.3, 3.4, Math.PI / 2, '#6d4a2c'); chair(-31.8, 3.6, -Math.PI / 2, '#6d4a2c');
    pool(-33, 11, 4, .55, .07); pool(-33, 3.6, 3, .4, .07); LAMPS.push({ x: -33, z: 7, y: 2.5 });
    for (const [x, z] of [[-33, 11], [-33, 3.6]]) { cyl(.012, .012, .4, C.black, x, 2.5, z, { seg: 5 }); cyl(.2, .24, .16, C.bulb, x, 2.26, z, { seg: 8, bucket: 'glow' }); }

    // plaza and street
    floor('concrete', -36, 21, 36, 27.5, .01); floor('asphalt', -120, 28.5, 120, 36, .002); post(240, .12, .4, '#6d6b65', 0, -.04, 28.3, { bucket: 'outside' }); floor('path', -24.5, 27.5, -19.5, 28.5, .012);
    for (let x = -110; x < 110; x += 7) post(3, .006, .16, '#c7bfa8', x, .006, 32.2, { bucket: 'outside' });
    floor('grass', -160, -140, 160, 28, -.012); floor('grass', -160, 36, 160, 140, -.012);
    for (const [x1, z1, x2, z2] of [[-16, 21.6, 28, 23]]) post(x2 - x1, .32, z2 - z1, '#27463a', (x1 + x2) / 2, 0, (z1 + z2) / 2, { bucket: 'outside' });
    for (let x = -14; x < 28; x += 3.6) ico(.62 + rnd() * .3, '#2a5a35', x, .55, 22.3 + (rnd() - .5) * .3, { detail: 1, sy: .8 });
    // canopy with the office name on it
    const cx = -22, o = { bucket: 'ceiling' }; post(11, .36, 5, '#30343a', cx, 2.9, 23.3, o); post(11.2, .08, 5.2, '#22252a', cx, 3.26, 23.3, o); post(6.5, .36, .03, '#26292e', cx, 2.9, 25.82, o); canopySign = () => sign(P.canopy, 6.2, .34, cx, 3.08, 25.86, 0, true);
    for (const x of [cx - 4.6, cx + 4.6]) { post(.42, 1, .42, '#2a5a8a', x, 0, 25.2); post(.42, 1.95, .42, '#cfc8b8', x, 1, 25.2); }
    pool(cx, 23, 6, .95, .07); LAMPS.push({ x: cx, z: 23.5, y: 2.7 }); for (const x of [cx - 2, cx + 2]) { cyl(.18, .2, .05, C.bulb, x, 2.87, 23.5, { bucket: 'glow', seg: 8 }); }
    // planters, bench, bike racks
    for (const x of [-26, -18]) plant(x, 21.8, 1.25, true);
    post(2.2, .08, .5, '#6b4a2c', -8, .42, 26); for (const k of [-1, 1]) post(.1, .42, .46, C.metal, -8 + k * .95, 0, 26); post(2.2, .4, .06, '#6b4a2c', -8, .62, 26.26); post(.5, .9, .5, '#2a2622', -5.6, 0, 26);
    for (let i = 0; i < 5; i++) { const x = 2 + i * .9; for (const k of [0, .55]) { box(.03, .7, .03, C.metalLight, x + k, .35, 25.2); } box(.58, .03, .03, C.metalLight, x + .28, .7, 25.2); if (i % 2) { cyl(.3, .3, .03, '#17161a', x + .28, .32, 24.5, { rz: Math.PI / 2, seg: 12 }); cyl(.3, .3, .03, '#17161a', x + .28, .32, 25.6, { rz: Math.PI / 2, seg: 12 }); box(.03, .03, 1, '#a8322a', x + .28, .6, 25.05); } }
    // street lamps
    for (const x of [-34, -10, 6, 22, 38]) for (const z of [27.4]) {
      post(.14, 4.6, .14, C.metal, x, 0, z); post(.9, .06, .12, C.metal, x, 4.6, z - .4, { ry: Math.PI / 2 });
      ico(.2, '#fff0cc', x, 4.5, z - .8, { detail: 1, bucket: 'glow' }); pool(x, z - .6, 7, .85, .07); LAMPS.push({ x, z: z - .8, y: 4.4 });
    }
    for (const [x, z] of [[-40, 8], [-40, -14], [33, 8], [33, -14], [-10, -26], [12, -26]]) { post(.14, 4.2, .14, C.metal, x, 0, z); ico(.2, '#fff0cc', x, 4.25, z, { detail: 1, bucket: 'glow' }); pool(x, z, 6.4, .7, .06); }
    // industrial units behind the building
    for (let i = 0; i < 3; i++) { post(2.2, 1.3, 2.2, '#3a3a3c', 32 + i * 2.8, 0, 16); box(1.6, .05, 1.6, '#25252a', 32 + i * 2.8, 1.33, 16); }
    box(9, .36, .36, '#47494d', 36, 1, 12.6); box(.36, .36, 5, '#47494d', 32.6, 1, 14);
    // 187 pines
    const clearOfBuilding = (x, z) => x > -41 && x < 40 && z > -27 && z < 37.5;
    let planted = 0, guard = 0;
    const pine = (x, z, s) => { const o2 = { bucket: 'outside' };
      cyl(.14 * s, .2 * s, 1 * s, C.trunk, x, .5 * s, z, { ...o2, seg: 6 });
      const hex = rnd() > .5 ? C.pine : C.pineLight;
      [[2.1, 1.7, 1.2], [1.7, 1.6, 2.5], [1.25, 1.5, 3.7], [.8, 1.3, 4.8]].forEach(([r, h, y]) => cyl(0, r * s, h * s, hex, x, y * s, z, { ...o2, seg: 7, ry: rnd() * 3 })); };
    while (planted < 187 && guard++ < 6000) {
      const a = rnd() * Math.PI * 2, r = 30 + Math.pow(rnd(), .8) * 62, x = Math.cos(a) * r * 1.18, z = Math.sin(a) * r;
      if (clearOfBuilding(x, z)) continue; pine(x, z, .85 + rnd() * .55); planted++;
    }
    for (const [x, z, s] of [[-6, 24.6, .5], [19, 25.8, .55], [-31, 26.8, .55], [30, 26.3, .5]]) { ico(.7 * s + .4, '#2a5a35', x, .7, z, { detail: 1, sy: 1.1 }); }
  }

  /* ---------- turn everything into meshes ---------- */
  canopySign?.();
  const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true }), glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const makeMesh = (b, mat, opt = {}) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    if (b.nor?.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    if (b.col?.length) g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    if (b.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat); m.castShadow = !!opt.cast; m.receiveShadow = !!opt.receive; m.matrixAutoUpdate = false; m.updateMatrix(); scene.add(m); return m;
  };
  makeMesh(B.solid, solidMat, { cast: true, receive: true });
  makeMesh(B.outside, solidMat, { receive: true });
  makeMesh(B.glow, glowMat);
  const ceiling = makeMesh(B.ceiling, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#6b5a44', emissiveIntensity: .34 }));
  ceiling.visible = false;

  // glass panes: one transparent mesh
  const glassBucket = bucket(); B.glass = glassBucket; for (const p of glassParts) { const b0 = B.glass; const n0 = b0.pos.length; post(p.w, WH - .12, p.d, '#a8c4c9', p.x, .06, p.z, { bucket: 'glass' }); if (n0 < 0) break; }
  const glassMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: .13, depthWrite: false });
  const glassMesh = makeMesh(B.glass, glassMat); glassMesh.renderOrder = 2;

  // floors: one mesh per finish
  for (const [key, data] of Object.entries(floorData)) {
    const [draw] = FLOORS[key], tex = floorCanvas(draw), mat = new THREE.MeshLambertMaterial({ map: tex, color: key === 'grass' || key === 'asphalt' ? '#ffffff' : '#b9a998' }), n = data.pos.length / 3, nor = new Float32Array(n * 3); for (let i = 0; i < n; i++) nor[i * 3 + 1] = 1;
    const m = makeMesh({ pos: data.pos, uv: data.uv }, mat, { receive: true }); m.geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); m.renderOrder = -1;
  }
  const atlasTex = new THREE.CanvasTexture(atlasCanvas); atlasTex.encoding = THREE.sRGBEncoding; atlasTex.anisotropy = 8;
  if (quads.lit.pos.length) { const m = makeMesh(quads.lit, new THREE.MeshLambertMaterial({ map: atlasTex, polygonOffset: true, polygonOffsetFactor: -2 }), {}); m.renderOrder = 1; }
  if (quads.glow.pos.length) { const m = makeMesh(quads.glow, new THREE.MeshBasicMaterial({ map: atlasTex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3 }), {}); m.renderOrder = 1; }

  // pools of lamplight: additive quads with a soft radial texture
  const poolTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,214,150,.46)'); r.addColorStop(.35, 'rgba(255,190,120,.22)'); r.addColorStop(.7, 'rgba(255,170,90,.07)'); r.addColorStop(1, 'rgba(255,160,80,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t; })();
  const poolData = { pos: [], uv: [], col: [] };
  for (const p of pools) { const q = [[-1, -1, 0, 0], [-1, 1, 0, 1], [1, 1, 1, 1], [-1, -1, 0, 0], [1, 1, 1, 1], [1, -1, 1, 0]]; for (const [a, b, u, v] of q) { poolData.pos.push(p.x + a * p.r, p.y, p.z + b * p.r); poolData.uv.push(u, v); poolData.col.push(p.strength, p.strength, p.strength); } }
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  const poolMesh = makeMesh(poolData, poolMat); poolMesh.renderOrder = 1;
  const glowUp = { pos: [], uv: [], col: [] };
  for (const l of LAMPS) { if (l.y !== WH - .35) continue; const r = 3, q = [[-1, -1, 0, 0], [1, 1, 1, 1], [-1, 1, 0, 1], [-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1]]; for (const [a, b, u, v] of q) { glowUp.pos.push(l.x + a * r, WH - .035, l.z + b * r); glowUp.uv.push(u, v); glowUp.col.push(.7, .7, .7); } }
  const ceilingGlow = makeMesh(glowUp, poolMat); ceilingGlow.renderOrder = 1; ceilingGlow.visible = false;

  /* ---------- entrance doors: the only part of the building that moves ---------- */
  const doorGlass = new THREE.MeshLambertMaterial({ color: '#b6cdd2', transparent: true, opacity: .2, depthWrite: false }), doorFrame = new THREE.MeshLambertMaterial({ color: C.black });
  const leaves = {};
  for (const d of AUTO_DOORS) {
    const half = (d.b - d.a) / 2, list = [];
    for (const sd of [-1, 1]) {
      const g = new THREE.Group(), w = half, along = d.axis === 'x';
      const pane = new THREE.Mesh(new THREE.BoxGeometry(along ? w - .08 : .03, DOOR_H - .1, along ? .03 : w - .08), doorGlass); pane.renderOrder = 3; g.add(pane);
      for (const k of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(along ? .06 : .07, DOOR_H, along ? .07 : .06), doorFrame); rail.position[along ? 'x' : 'z'] = k * (w / 2 - .03); g.add(rail); }
      for (const k of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(along ? w : .07, .07, along ? .07 : w), doorFrame); rail.position.y = k * (DOOR_H / 2 - .04); g.add(rail); }
      const handle = new THREE.Mesh(new THREE.BoxGeometry(along ? .03 : .1, .5, along ? .1 : .03), doorFrame); handle.position.set(along ? -sd * (w / 2 - .12) : 0, 0, along ? 0 : -sd * (w / 2 - .12)); g.add(handle);
      const mid = (d.a + d.b) / 2 + sd * half / 2;
      g.position.set(along ? mid : d.at, DOOR_H / 2, along ? d.at : mid); scene.add(g); list.push({ g, sd, base: mid, along, half });
    }
    leaves[d.id] = list;
  }
  /** Slide a door: 0 shut, 1 fully open. */
  function setDoor(id, open) { for (const l of leaves[id] || []) { const v = l.base + l.sd * l.half * open * .92; if (l.along) l.g.position.x = v; else l.g.position.z = v; } }

  /* ---------- two live wall screens, drawn only when their contents change ---------- */
  function liveScreen(w, h, cw, ch, x, y, z, ry, frameHex, draw) {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d'), tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 8;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); mesh.position.set(x, y, z); mesh.rotation.y = ry; mesh.renderOrder = 1; scene.add(mesh);
    const s = Math.sin(ry), co = Math.cos(ry), frame = new THREE.Mesh(new THREE.BoxGeometry(w + .14, h + .14, .05), new THREE.MeshLambertMaterial({ color: frameHex })); frame.position.set(x - s * .035, y, z - co * .035); frame.rotation.y = ry; scene.add(frame);
    let last = ''; const update = data => { const key = JSON.stringify(data); if (key === last) return; last = key; draw(g, cw, ch, data); tex.needsUpdate = true; };
    return { update };
  }
  const clip = (g, text, maxW) => { let t = String(text ?? ''); if (g.measureText(t).width <= maxW) return t; while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; };
  const wrap = (g, text, maxW, lines) => { const out = []; let cur = ''; for (const word of String(text ?? '').split(/\s+/)) { const next = cur ? cur + ' ' + word : word; if (g.measureText(next).width > maxW && cur) { out.push(cur); cur = word; if (out.length === lines) break; } else cur = next; } if (out.length < lines && cur) out.push(cur); return out; };
  const meetingScreen = liveScreen(5.2, 2.7, 1024, 532, MEETING_TABLE.x, 1.85, -20.82, 0, C.black, (g, w, h, d) => {
    g.fillStyle = '#0a1438'; g.fillRect(0, 0, w, h); g.fillStyle = '#9fb7ff'; g.font = '700 26px "JetBrains Mono", monospace'; g.fillText('MEETING ROOM', 44, 62);
    g.fillStyle = '#ffffff'; g.font = `800 ${d.title ? 52 : 46}px ${FONT}`; wrap(g, d.title || 'Free', w - 88, 2).forEach((l, i) => g.fillText(l, 44, 132 + i * 60));
    g.font = '500 26px Inter, Arial, sans-serif'; g.fillStyle = '#b8c4e6'; if (d.status) g.fillText(d.status, 44, 268);
    g.fillStyle = '#e8ecf8'; (d.lines || []).slice(0, 4).forEach((l, i) => g.fillText(clip(g, l, w - 88), 44, 322 + i * 42));
  });
  const projectBoard = liveScreen(8, 2.1, 1280, 336, 18.5, 1.82, -5.27, 0, C.black, (g, w, h, d) => {
    g.fillStyle = '#eef0f3'; g.fillRect(0, 0, w, h); g.fillStyle = '#1a2230'; g.fillRect(0, 0, w, 52); g.fillStyle = '#ffd338'; g.font = `800 28px ${FONT}`; g.fillText('PROJECT BOARD', 22, 36);
    g.textAlign = 'right'; g.fillStyle = '#c7d0dc'; g.font = '600 20px "JetBrains Mono", monospace'; g.fillText(d.status || '', w - 22, 34); g.textAlign = 'left';
    const cols = d.columns || [], cw = (w - 24) / Math.max(1, cols.length);
    cols.forEach((col, i) => { const x = 12 + i * cw; g.fillStyle = '#1a2230'; g.font = '800 19px Inter, Arial, sans-serif'; g.fillText(`${col.title} · ${col.count}`, x + 8, 82); (col.items || []).slice(0, 4).forEach((t, k) => { g.fillStyle = '#ffffff'; g.fillRect(x + 6, 94 + k * 58, cw - 14, 50); g.fillStyle = ['#3a7bd5', '#d0548a', '#5b8c3e', '#e2963c'][i % 4]; g.fillRect(x + 6, 94 + k * 58, 5, 50); g.fillStyle = '#26303d'; g.font = '500 17px Inter, Arial, sans-serif'; wrap(g, t, cw - 34, 2).forEach((l, n) => g.fillText(l, x + 18, 115 + k * 58 + n * 19)); }); });
  });
  meetingScreen.update({}); projectBoard.update({ status: 'LIVE', columns: [{ title: 'Working now', count: 0, items: [] }, { title: 'Waiting on people', count: 0, items: [] }, { title: 'Latest', count: 0, items: [] }] });

  return { ceiling, ceilingGlow, lamps: LAMPS, setDoor, meetingScreen, projectBoard, stats: () => ({ solidTriangles: B.solid.pos.length / 9 }) };
}
