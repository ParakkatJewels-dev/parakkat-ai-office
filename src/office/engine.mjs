// The 3D Parakkat campus. Framework-free so the same file runs in the Next.js app and the prototype page.
// THREE and OrbitControls are passed in, so the caller decides how three.js is loaded.
//
// Speed: everything that never moves is merged into one mesh per material after the scene is built, each person is five
// meshes, shadows refresh every third frame, and labels are placed every other frame. If frames still run slow the
// renderer lowers its resolution and then drops shadows.

export const DEPT_COLOR = {
  board: '#b08d57', insights: '#3d6fb0', intel: '#6c4fb3', strategy: '#2b8a64', creative: '#b23a4c', social: '#d07a1f',
  perf: '#23807a', seo: '#4f8a2b', lead: '#1c1c1c', warroom: '#6f3fa0', customer: '#2f7fa8', goldrate: '#b8913f', datahub: '#4a5568',
  forecast: '#3f8f7a', qa: '#8a6a3a', photo: '#c4566a', reels: '#d9603b', catalog: '#8a5a9e', lang: '#3a8f5c', crm: '#2b6cb0', brand: '#a8865a',
};
const SKIN = ['#f0c9a4', '#d7a47c', '#b77d57', '#8c5a3c'];
const HAIR = ['#231812', '#4a2f1e', '#7b5434', '#1d1d24', '#b9b2a8', '#3a2a1c'];
const STATUS_COL = { idle: '#4b8fe0', thinking: '#e89a3c', talking: '#35b07c', walking: '#35b07c', waiting: '#d8b27a' };
const BUSY = new Set(['thinking', 'talking', 'walking']);
const SEAT = [[-3, -2.6], [3, -2.6], [-3, 2.2], [3, 2.2]];
const WH = 3.0;
const CAMPUS_VIEW = { pos: [-6, 116, 118], target: [-6, 0, 6] };
const TOP_VIEW = { pos: [-6, 180, 5.01], target: [-6, 0, 5] };
const ICON = {
  hq: '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M11 3 8 9l4 12 4-12-3-6M2 9h20"/>',
  ic: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  ch: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>',
};
const svg = (d, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

/**
 * @param {object} o
 * @param {any} o.THREE
 * @param {any} o.OrbitControls
 * @param {HTMLCanvasElement} o.canvas
 * @param {HTMLElement} o.labels  absolutely positioned layer over the canvas for names, speech and building cards
 * @param {HTMLElement} o.host    element that sizes the scene
 * @param {{BUILDINGS: any[], ROOMS: any[], PEOPLE: any[]}} o.roster
 * @param {(p: any) => void} [o.onSelect]
 * @param {(p: any) => void} [o.onApproverClick]
 * @param {() => (HTMLElement | null)[]} [o.avoid]  overlay elements labels should not cover
 * @param {boolean} [o.fill]   true when the host has a fixed height the canvas should fill
 * @param {boolean} [o.night]  start in the evening look
 */
export function createOffice(o) {
  const { THREE, OrbitControls, canvas, labels, host, roster } = o;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let paused = false, speed = 1, night = false, sel = null, follow = null, fly = null, raf = 0, view = '3d';

  /* ---------- layout from the roster ---------- */
  const B = {}, R = {}, P = {};
  roster.BUILDINGS.forEach(b => { B[b.id] = { ...b, half: b.cols * 6 }; });
  roster.ROOMS.forEach(r => { const b = B[r.building]; R[r.id] = { ...r, b, cx: b.ox - b.half + 6 + 12 * r.col, cz: r.row ? 9 : -9, door: r.row ? 3 : -3 }; });
  const seatOf = (r, s) => ({ x: r.cx + SEAT[s][0], z: r.cz + SEAT[s][1] });
  const people = roster.PEOPLE.map((d, i) => {
    const room = R[d.room], s = seatOf(room, d.seat), base = DEPT_COLOR[d.dept] || '#667';
    return { ...d, homeRoom: room, room, home: s, x: s.x, z: s.z, sitting: true, path: [], resolve: null, status: 'idle', bubble: null, bubbleKind: '',
      carry: false, quest: false, task: 'Waiting for the next job', log: [], phase: i * .9, heading: 0, faceTo: null,
      shirt: d.human ? (d.id === 'superAdmin' ? '#d8c3a5' : '#1c1c1c') : d.head ? base : mix(base, '#ffffff', .28), skin: SKIN[(i * 3) % 4], hair: HAIR[(i * 5) % 6] };
  });
  people.forEach(p => { P[p.id] = p; });
  Object.values(B).forEach(b => { b.people = people.filter(p => p.homeRoom.b === b); b.rooms = Object.values(R).filter(r => r.b === b).length; });

  /* ---------- renderer ---------- */
  THREE.ColorManagement.legacyMode = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(devicePixelRatio || 1, 1.5), quality = 2, shadowsOn = true;
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const SKY_DAY = '#cfdfeb', SKY_NIGHT = '#0b1512';
  scene.background = new THREE.Color(SKY_DAY); scene.fog = new THREE.Fog(SKY_DAY, 140, 300);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, .5, 600);
  camera.position.set(...CAMPUS_VIEW.pos);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(...CAMPUS_VIEW.target); controls.enableDamping = true; controls.minPolarAngle = .08; controls.maxPolarAngle = 1.47; controls.minDistance = 6; controls.maxDistance = 330; controls.screenSpacePanning = false;
  // Map-style: drag moves across the campus, right-drag (or two fingers) turns and tilts, scroll or pinch zooms.
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.panSpeed = 1.2; controls.rotateSpeed = .7; controls.zoomSpeed = 1.1;
  const hemi = new THREE.HemisphereLight('#e3f0ff', '#8a7a5c', .75); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.1); sun.position.set(-40, 60, 34); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -85, right: 85, top: 50, bottom: -40, near: 1, far: 200 }); sun.shadow.bias = -.0005; sun.shadow.normalBias = .04;
  scene.add(sun);

  /* ---------- helpers ---------- */
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stat = new THREE.Group(); scene.add(stat); // everything in here is merged once the campus is built
  const matCache = new Map();
  const M = (color, opt = {}) => { if (opt.map) return new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: 0, ...opt }); const k = color + JSON.stringify(opt); if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: 0, ...opt })); return matCache.get(k); };
  const sh = m => { m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w, h, d, mat, x, y, z, parent) => { const m = sh(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); m.position.set(x, y, z); (parent || stat).add(m); return m; };
  const cyl = (rt, rb, h, mat, x, y, z, seg = 16, parent) => { const m = sh(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat)); m.position.set(x, y, z); (parent || stat).add(m); return m; };
  const flat = (w, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; stat.add(m); return m; };
  const tex = (draw, w = 256, h = 256, rep = [1, 1]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 4; return t; };
  const screens = [], lamps = [], flags = [], cars = [];
  const pot = M('#ece6da', { roughness: .6 }), leafC = M('#3f7a3a', { roughness: .8 }), leafD = M('#55964a', { roughness: .8 });

  // Merges geometries into one, baking each matrix in; with colours it writes a vertex colour attribute instead of uvs.
  const _m3 = new THREE.Matrix3(), _v = new THREE.Vector3(), _c = new THREE.Color();
  function mergeGeos(list, withColor) {
    let nv = 0, ni = 0; const useUv = !withColor && list.every(i => i.geo.attributes.uv);
    for (const i of list) { const n = i.geo.attributes.position.count; nv += n; ni += i.geo.index ? i.geo.index.count : n; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = useUv ? new Float32Array(nv * 2) : null, col = withColor ? new Float32Array(nv * 3) : null;
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const { geo, matrix, color } of list) {
      const p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv; _m3.getNormalMatrix(matrix); if (color) _c.set(color);
      for (let k = 0; k < p.count; k++) {
        const a = (vo + k) * 3;
        _v.fromBufferAttribute(p, k).applyMatrix4(matrix); pos[a] = _v.x; pos[a + 1] = _v.y; pos[a + 2] = _v.z;
        _v.fromBufferAttribute(n, k).applyMatrix3(_m3).normalize(); nor[a] = _v.x; nor[a + 1] = _v.y; nor[a + 2] = _v.z;
        if (uv) { uv[(vo + k) * 2] = u.getX(k); uv[(vo + k) * 2 + 1] = u.getY(k); }
        if (col) { col[a] = _c.r; col[a + 1] = _c.g; col[a + 2] = _c.b; }
      }
      if (geo.index) for (let k = 0; k < geo.index.count; k++) idx[io + k] = geo.index.getX(k) + vo; else for (let k = 0; k < p.count; k++) idx[io + k] = vo + k;
      vo += p.count; io += geo.index ? geo.index.count : p.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere(); return g;
  }
  // a single mesh in vertex colours from [geometry, colour, x, y, z, rotX?, scale?] parts
  const tint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .72 }), _o = new THREE.Object3D();
  function colored(parts) {
    const g = mergeGeos(parts.map(([geo, color, x, y, z, rx = 0, s = [1, 1, 1]]) => { _o.position.set(x, y, z); _o.rotation.set(rx, 0, 0); _o.scale.set(...s); _o.updateMatrix(); return { geo, color, matrix: _o.matrix.clone() }; }), true);
    return sh(new THREE.Mesh(g, tint));
  }

  /* ---------- ground and landscape ---------- */
  const grass = tex((g, w, h) => { g.fillStyle = '#6f9a4e'; g.fillRect(0, 0, w, h); for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${40 + rnd() * 50 | 0},${90 + rnd() * 60 | 0},${30 + rnd() * 30 | 0},.5)`; g.fillRect(rnd() * w, rnd() * h, 2, 3); } }, 256, 256, [50, 50]);
  flat(520, 520, M('#ffffff', { map: grass, roughness: 1 }), 0, -.32, 0);
  const paving = tex((g, w, h) => { g.fillStyle = '#c4b9a7'; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { const v = 170 + rnd() * 40 | 0; g.fillStyle = `rgba(${v},${v - 4},${v - 10},.35)`; g.fillRect(rnd() * w, rnd() * h, 3, 3); } g.strokeStyle = '#b9b1a3'; g.lineWidth = 2; for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } }, 256, 256, [36, 5]);
  const pave = M('#fff', { map: paving, roughness: .95 });
  flat(148, 17, pave, 0, -.29, 24.5); // plaza in front of all three buildings
  flat(220, 3, M('#bfb8ab', { roughness: .95 }), 0, -.29, 34.5); // pavement
  box(220, .25, .3, M('#9c968b'), 0, -.2, 36);
  flat(520, 8, M('#2f3236', { roughness: .9 }), 0, -.31, 40); // road
  const dash = M('#e8e2cf'); for (let x = -250; x < 250; x += 7) flat(3.2, .22, dash, x, -.3, 40);
  box(220, .25, .3, M('#9c968b'), 0, -.2, 44); flat(220, 2.4, M('#bfb8ab', { roughness: .95 }), 0, -.29, 45.4);

  const trunk = M('#6b4b33'), leafA = M('#3f6e30'), leafB = M('#4e8239'), leafE = M('#2f5a2a');
  const tree = (x, z, s = 1) => { cyl(.18 * s, .25 * s, 2.2 * s, trunk, x, 1.1 * s - .3, z, 6); for (let i = 0; i < 3; i++) { const m = sh(new THREE.Mesh(new THREE.IcosahedronGeometry((1.5 - i * .3) * s, 1), [leafA, leafB, leafE][(i + Math.abs(x | 0)) % 3])); m.position.set(x + (rnd() - .5) * .6 * s, (2.4 + i * .9) * s - .3, z + (rnd() - .5) * .6 * s); stat.add(m); } };
  const palm = (x, z, s = 1) => { for (let i = 0; i < 6; i++) cyl(.16 * s, .2 * s, .9 * s, trunk, x + i * .12 * s, (.15 + i * .85) * s, z, 6).rotation.z = -.08; for (let k = 0; k < 8; k++) { const f = sh(new THREE.Mesh(new THREE.ConeGeometry(.35 * s, 3.2 * s, 4), leafB)); f.position.set(x + .7 * s, 5.3 * s, z); f.rotation.set(Math.PI / 2 - .5, k / 8 * Math.PI * 2, 0, 'YXZ'); f.translateY(1.4 * s); stat.add(f); } };
  // woods behind and beside the campus, a tree line beyond the road
  for (let x = -108; x <= 108; x += 7) { tree(x + (rnd() - .5) * 4, -24 - rnd() * 4, .9 + rnd() * .5); tree(x + (rnd() - .5) * 4, -32 - rnd() * 6, 1 + rnd() * .5); }
  for (let z = -14; z <= 30; z += 7) [-1, 1].forEach(sd => { tree(sd * (78 + rnd() * 5), z, 1 + rnd() * .3); tree(sd * (88 + rnd() * 8), z + 3, 1.1 + rnd() * .4); });
  for (let x = -104; x <= 104; x += 8) { tree(x + rnd() * 3, 50 + rnd() * 3, .9 + rnd() * .5); if (rnd() > .4) tree(x + 4, 57 + rnd() * 4, 1 + rnd() * .4); }

  // plaza: hedges along the building fronts, planters, palms, lamp posts and the fountain
  const hedge = M('#3d6b33', { roughness: .95 }), soil = M('#5a4634', { roughness: 1 }), stone = M('#d8d2c6', { roughness: .6 }), post = M('#2a2d31', { metalness: .5, roughness: .4 });
  const bulb = M('#fff4dc', { emissive: '#ffcf80', emissiveIntensity: 0 }); lamps.push({ mat: bulb });
  const glowAt = [];
  Object.values(B).forEach(b => {
    const x1 = b.ox - b.half, x2 = b.ox + b.half;
    [[x1 + 1, b.ox - 4], [b.ox + 4, x2 - 1]].forEach(([a, c]) => { box(c - a, .9, 1.1, hedge, (a + c) / 2, .2, 16.4); box(c - a, .35, 1.6, stone, (a + c) / 2, -.12, 16.4); });
    for (let x = x1 + 3; x < x2 - 2; x += 6) if (Math.abs(x - b.ox) > 5) { box(2.2, .5, 2.2, stone, x, .05, 19.6); flat(1.9, 1.9, soil, x, .31, 19.6); plant(x, 19.6, .9); }
  });
  [0, 1, 2].forEach(i => box(7.6 - i * .8, .16, 1, stone, 0, -.22 + i * .14, 17.6 - i * .6)); // front steps of HQ
  for (let x = -78; x <= 66; x += 12) { if (Math.abs(x) < 8) continue; cyl(.09, .12, 4.4, post, x, 1.9, 31.4, 8).castShadow = false; box(.7, .12, .7, post, x, 4.15, 31.4).castShadow = false; cyl(.22, .22, .25, bulb, x, 3.95, 31.4, 10); glowAt.push([x, 3.9, 31.4]); }
  [-1, 1].forEach(sd => { [[15, 27.5], [33, 27], [62, 28]].forEach(([x, z]) => palm(sd * x, z, .95)); });
  cyl(4.6, 4.9, .6, stone, 0, 0, 24, 40); const water = cyl(4.15, 4.15, .1, M('#3f8fbd', { roughness: .08, metalness: .25 }), 0, .32, 24, 40); water.castShadow = false;
  cyl(.55, .75, 1.4, stone, 0, .9, 24, 20); cyl(1.5, 1.2, .25, stone, 0, 1.7, 24, 24); const jet = cyl(.08, .3, 1.6, M('#d9f0fb', { transparent: true, opacity: .7, roughness: .1 }), 0, 2.6, 24, 10); jet.castShadow = false;
  const flagTex = tex((g, w, h) => { g.fillStyle = '#1c1c1c'; g.fillRect(0, 0, w, h); g.fillStyle = '#d8c3a5'; g.font = '600 34px Montserrat, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('P', w / 2, h / 2 + 12); g.fillRect(0, h - 10, w, 4); }, 128, 96);
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: .8 }), flagGeo = new THREE.PlaneGeometry(2, 1.4);
  [-6, 6].forEach(x => { cyl(.06, .06, 7, M('#c9c9c9', { metalness: .8, roughness: .3 }), x, 3.2, 20.5, 8); const f = new THREE.Mesh(flagGeo, flagMat); f.position.set(x + 1, 6, 20.5); f.castShadow = true; scene.add(f); flags.push(f); });

  /* ---------- floors ---------- */
  const shade = (hex, v) => { const n = parseInt(hex.slice(1), 16), c = k => Math.max(0, Math.min(255, ((n >> k) & 255) + v | 0)); return `rgb(${c(16)},${c(8)},${c(0)})`; };
  const plank = (base, dark) => tex((g, w, h) => { for (let y = 0; y < h; y += 16) { const off = (y / 16 % 2) * 64; for (let x = -64; x < w; x += 128) { g.fillStyle = shade(base, (rnd() - .5) * 22); g.fillRect(x + off, y, 128, 16); g.fillStyle = dark; g.fillRect(x + off, y, 1.5, 16); } g.fillStyle = dark; g.fillRect(0, y, w, 1); } }, 256, 256, [3, 3]);
  const tiles = (base, line, n = 4) => tex((g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < 1200; i++) { g.fillStyle = rnd() > .5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)'; g.fillRect(rnd() * w, rnd() * h, 2, 2); } g.strokeStyle = line; g.lineWidth = 2; for (let i = 0; i <= w; i += w / n) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } }, 256, 256, [3, 3]);
  const FLOORS = {
    wood: plank('#9b6a43', 'rgba(60,35,20,.5)'), oak: plank('#c39a6b', 'rgba(90,60,30,.45)'),
    concrete: tiles('#e9e7e2', 'rgba(150,145,135,.35)'), carpet: tiles('#3b4650', 'rgba(0,0,0,.25)', 8), marble: tiles('#f4f1ec', 'rgba(170,160,150,.3)', 2),
  };
  const corridorTex = tex((g, w, h) => { g.fillStyle = '#e8e5de'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,.07)'; for (let i = 0; i < w; i += 64) g.fillRect(i, 0, 2, h); g.fillRect(0, h / 2, w, 2); }, 256, 64, [12, 1]);
  const corridorM = M('#fff', { map: corridorTex, roughness: .5 });

  /* ---------- buildings ---------- */
  const plaster = M('#f4f2ee', { roughness: .9 }), frameM = M('#1c1c1c', { roughness: .4, metalness: .5 }), champagne = M('#d8c3a5', { roughness: .35, metalness: .55 }), plinth = M('#cfcac0', { roughness: .9 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#d6ecff', transparent: true, opacity: .16, roughness: .05, metalness: 0, depthWrite: false });
  const pane = (x1, z1, x2, z2, h = WH) => {
    const len = Math.hypot(x2 - x1, z2 - z1); if (len < .05) return; const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, ang = Math.atan2(z2 - z1, x2 - x1);
    const g = new THREE.Mesh(new THREE.BoxGeometry(len, h, .06), glass); g.position.set(cx, h / 2, cz); g.rotation.y = -ang; stat.add(g);
    box(len, .08, .1, frameM, cx, h, cz).rotation.y = -ang; box(len, .1, .1, frameM, cx, .05, cz).rotation.y = -ang;
    box(.08, h, .1, frameM, x1, h / 2, z1); box(.08, h, .1, frameM, x2, h / 2, z2);
  };
  roster.BUILDINGS.forEach(b0 => {
    const b = B[b0.id], { ox, half } = b, W = half * 2;
    box(W + 2, .32, 32, plinth, ox, -.16, 0);
    flat(W, 6, corridorM, ox, .012, 0);
    flat(W - 1, 1.6, M('#1c1c1c', { roughness: .95 }), ox, .02, 0); flat(W - 1, .12, champagne, ox, .025, .74); flat(W - 1, .12, champagne, ox, .025, -.74);
    box(W + .4, WH, .3, plaster, ox, WH / 2, -15.15);
    [-1, 1].forEach(sd => { box(.3, WH, 12.3, plaster, ox + sd * (half + .15), WH / 2, -9.15); box(.3, WH, 12.3, plaster, ox + sd * (half + .15), WH / 2, 9.15); });
    pane(ox - half, 15, ox - 3, 15, 1.2); pane(ox + 3, 15, ox + half, 15, 1.2);
    [-3, 3].forEach(z => { for (let c = 0; c < b.cols; c++) { const cx = ox - half + 6 + 12 * c; pane(cx - 6, z, cx - 1.1, z); pane(cx + 1.1, z, cx + 6, z); } });
    for (let c = 1; c < b.cols; c++) { const x = ox - half + 12 * c; pane(x, -15, x, -3); pane(x, 3, x, 15); }
    box(W + .4, .12, .34, champagne, ox, WH + .06, -15.15);
    const L = new THREE.PointLight('#ffd9a0', 0, 52, 1.4); L.position.set(ox, 7, 0); scene.add(L); lamps.push(L);
  });
  // open walkways between buildings along the corridor line, with planting either side
  const sorted = [...roster.BUILDINGS].map(b => B[b.id]).sort((a, c) => a.ox - c.ox);
  for (let i = 0; i < sorted.length - 1; i++) {
    const x1 = sorted[i].ox + sorted[i].half, x2 = sorted[i + 1].ox - sorted[i + 1].half, cx = (x1 + x2) / 2, len = x2 - x1;
    flat(len + .6, 6, corridorM, cx, -.02, 0); box(len + .6, .3, 6.4, plinth, cx, -.2, 0);
    flat(len + .6, 1.6, M('#1c1c1c', { roughness: .95 }), cx, .0, 0);
    [-9, 9].forEach(z => { box(len - 1.2, .5, 9, stone, cx, -.05, z); flat(len - 1.8, 8.4, soil, cx, .21, z); plant(cx, z - 2.5, 1.1); plant(cx, z + 2.5, .9); });
    [-1, 1].forEach(sd => { cyl(.05, .05, 2.4, post, cx + sd * (len / 2 - .4), 1.1, 3.4, 6).castShadow = false; cyl(.05, .05, 2.4, post, cx + sd * (len / 2 - .4), 1.1, -3.4, 6).castShadow = false; });
  }

  /* ---------- furniture ---------- */
  const SCREEN_COLS = ['#5fb7ff', '#5fe0a8', '#ffcf5a', '#ff8fa3', '#d8c3a5'];
  function screenTex(kind, col) {
    return tex((g, w, h) => { g.fillStyle = '#0f1624'; g.fillRect(0, 0, w, h); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 4;
      if (kind === 'bars') for (let i = 0; i < 7; i++) { const bh = 20 + rnd() * (h - 44); g.fillRect(10 + i * (w - 20) / 7, h - 10 - bh, (w - 20) / 7 - 6, bh); }
      else { g.beginPath(); for (let i = 0; i <= 20; i++) { const x = 8 + i * (w - 16) / 20, y = h * .75 - Math.sin(i / 3 + rnd()) * h * .2 - i * h * .012; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
      g.globalAlpha = .35; g.fillRect(10, 8, w * .4, 6); }, 128, 80);
  }
  // a small pool of screen materials, so every monitor of one look merges into a single draw
  const screenPool = new Map();
  const screenMat = (kind, col) => { kind = kind || (rnd() > .5 ? 'bars' : 'line'); col = col || SCREEN_COLS[(rnd() * 5) | 0]; const k = kind + col;
    if (!screenPool.has(k)) { const t = screenTex(kind, col); const m = new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: .55, roughness: .3 }); screens.push(m); screenPool.set(k, m); }
    return screenPool.get(k); };
  const deskTop = M('#e9dfd0', { roughness: .55 }), metal = M('#2d3036', { metalness: .6, roughness: .35 }), fabric = M('#23262c', { roughness: .85 }), white = M('#ebebeb'), mug = M('#ffffff', { roughness: .3 });
  const screenGeo = new THREE.PlaneGeometry(1.02, .58);
  function desk(x, z) {
    box(2.6, .07, 1.2, deskTop, x, .75, z + .95); [[-1.2, .45], [1.2, .45], [-1.2, 1.45], [1.2, 1.45]].forEach(([a, c]) => box(.06, .72, .06, metal, x + a, .37, z + c));
    box(.08, .35, .08, metal, x, .95, z + 1.3); box(1.1, .66, .05, metal, x, 1.42, z + 1.3);
    const s = new THREE.Mesh(screenGeo.clone(), screenMat()); s.position.set(x, 1.42, z + 1.27); s.rotation.y = Math.PI; stat.add(s);
    box(.8, .03, .26, white, x, .8, z + .8); box(.12, .14, .12, mug, x - .9, .85, z + .9);
    box(.62, .1, .58, fabric, x, .5, z - .05); box(.62, .7, .1, fabric, x, .9, z - .38); cyl(.04, .04, .45, metal, x, .25, z - .05, 6); cyl(.32, .32, .04, metal, x, .03, z - .05, 10);
  }
  function plant(x, z, s = 1) { cyl(.28 * s, .22 * s, .55 * s, pot, x, .27 * s, z, 12); for (let i = 0; i < 5; i++) { const m = sh(new THREE.Mesh(new THREE.IcosahedronGeometry(.32 * s, 0), i % 2 ? leafC : leafD)); m.position.set(x + (rnd() - .5) * .4 * s, (.8 + rnd() * .6) * s, z + (rnd() - .5) * .4 * s); m.scale.y = 1.5; stat.add(m); } }
  const bezel = M('#16181d', { metalness: .4, roughness: .3 });
  function wallScreen(x, w, h, kind, col) { box(w + .12, h + .12, .08, bezel, x, 1.9, -14.95); const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat(kind, col)); s.position.set(x, 1.9, -14.9); stat.add(s); }
  function standScreen(x, z, w = 1.8) { box(.08, 1.2, .08, metal, x, .6, z); box(w + .1, 1.1, .08, bezel, x, 1.6, z); const s = new THREE.Mesh(new THREE.PlaneGeometry(w, 1), screenMat()); s.position.set(x, 1.6, z - .05); s.rotation.y = Math.PI; stat.add(s); }
  function sofa(x, z, rot = 0, col = '#1c1c1c') { const g = new THREE.Group(), f = M(col, { roughness: .9 }); box(2.4, .42, .95, f, 0, .3, 0, g); box(2.4, .6, .22, f, 0, .7, -.38, g); box(.22, .5, .95, f, -1.15, .5, 0, g); box(.22, .5, .95, f, 1.15, .5, 0, g); g.position.set(x, 0, z); g.rotation.y = rot; stat.add(g); }
  const BOOKS = ['#d8c3a5', '#1c1c1c', '#8a5a3c', '#b23a4c', '#3d6fb0'].map(c => M(c));
  function shelf(x, z) { box(2.2, 2.2, .45, M('#3b2a20', { roughness: .7 }), x, 1.1, z); for (let r = 0; r < 4; r++) for (let i = 0; i < 9; i++) box(.16, .38, .3, BOOKS[(i + r) % 5], x - .9 + i * .22, .45 + r * .5, z - .05); }
  const led = M('#5fe0a8', { emissive: '#5fe0a8', emissiveIntensity: 1 });
  function rack(x, z) { box(.9, 2.2, .9, M('#24272e', { metalness: .5, roughness: .35 }), x, 1.1, z); for (let i = 0; i < 6; i++) box(.06, .06, .02, led, x - .25, .5 + i * .3, z + .46); }
  function softbox(x, z) { cyl(.03, .03, 1.8, metal, x, .9, z, 6); box(.9, .9, .3, M('#fafafa', { emissive: '#ffffff', emissiveIntensity: .4 }), x, 2.0, z).rotation.x = .3; }
  const ceiling = M('#f6f1e6', { emissive: '#ffcf80', emissiveIntensity: 0 }); lamps.push({ mat: ceiling });
  function lamp(r) { cyl(.5, .5, .06, ceiling, r.cx, 3.3, r.cz, 20); }

  const floorMat = Object.fromEntries(Object.entries(FLOORS).map(([k, t]) => [k, M('#ffffff', { map: t, roughness: k === 'marble' ? .3 : .8 })]));
  Object.values(R).forEach(r => {
    const occ = people.filter(p => p.homeRoom === r).map(p => p.seat);
    const top = r.row === 0, farZ = top ? r.cz - 5.3 : r.cz + 5.3, cx = r.cx;
    [0, 1, 2, 3].forEach(s => { if (occ.includes(s) || (s !== 3 && r.decor !== 'board')) { const p = seatOf(r, s); desk(p.x, p.z); } });
    flat(11.8, 11.8, floorMat[r.floor] || floorMat.oak, cx, .01, r.cz);
    lamp(r);
    switch (r.decor) {
      case 'board': box(6, .08, 2, M('#3a2a20', { roughness: .4 }), cx + 1, .76, r.cz + 2.6); box(5.2, .7, .4, metal, cx + 1, .37, r.cz + 2.6);
        for (let i = 0; i < 4; i++) { const cf = M('#d8c3a5'); box(.55, .08, .55, cf, cx - 1.2 + i * 1.5, .5, r.cz + 1.2); box(.55, .55, .08, cf, cx - 1.2 + i * 1.5, .8, r.cz + .95); box(.55, .08, .55, cf, cx - 1.2 + i * 1.5, .5, r.cz + 4); box(.55, .55, .08, cf, cx - 1.2 + i * 1.5, .8, r.cz + 4.25); }
        wallScreen(cx + 2.6, 3.6, 1.9, 'line', '#d8c3a5'); break;
      case 'insights': wallScreen(cx - 2.5, 2.6, 1.5, 'bars', '#5fb7ff'); wallScreen(cx + 1, 2.6, 1.5, 'line', '#5fe0a8'); break;
      case 'intel': box(4.2, 1.8, .06, M('#b88b55', { roughness: 1 }), cx - 1, 1.9, -14.95); [[-2.4, 2.2, '#c8443b'], [-1.6, 1.6, '#2f6fb3'], [-.4, 2.3, '#e1b452'], [.3, 1.5, '#23885f']].forEach(([a, y, c]) => { cyl(.06, .06, .08, M(c), cx + a, y, -14.9, 8).rotation.x = Math.PI / 2; }); break;
      case 'strategy': box(4.4, 1.7, .05, M('#fafafa', { roughness: .25 }), cx - .5, 1.9, -14.95); ['#ffe27a', '#ffb0b0', '#a8e2ff', '#c4f2a3', '#ffe27a', '#ffd0f0'].forEach((c, i) => box(.42, .42, .02, M(c), cx - 2.2 + (i % 3) * .9, 2.2 - Math.floor(i / 3) * .7, -14.9)); break;
      case 'creative': { const e = M('#8b5e3c'); [[-.3, .2], [.3, .2], [0, -.35]].forEach(([a, c]) => { box(.06, 2.2, .06, e, cx + 4.6 + a, 1.05, r.cz - 4.8 + c).rotation.x = c > 0 ? -.12 : .2; }); box(1.3, .95, .05, M('#1c1c1c'), cx + 4.6, 1.5, r.cz - 4.55); box(.5, .5, .06, champagne, cx + 4.6, 1.5, r.cz - 4.5); plant(cx - 5, farZ); plant(cx + 5, farZ, 1.2); break; }
      case 'social': { cyl(.03, .03, 1.7, metal, cx, .85, farZ, 8); const ring = new THREE.Mesh(new THREE.TorusGeometry(.42, .05, 8, 32), M('#ffffff', { emissive: '#ffffff', emissiveIntensity: .8 })); ring.position.set(cx, 1.85, farZ); stat.add(ring); sofa(cx - 3.5, farZ, top ? 0 : Math.PI, '#36507a'); plant(cx + 5, farZ); break; }
      case 'perf': rack(cx + 5, r.cz - 4.9); plant(cx - 5, farZ, 1.1); standScreen(cx, farZ); break;
      case 'lead': box(5, .9, .1, champagne, cx, 2.0, r.cz - 5.75); sofa(cx - 3.2, farZ, Math.PI, '#d8cfc0'); sofa(cx + 3.2, farZ, Math.PI, '#d8cfc0'); box(1.4, .4, .8, M('#3a2a20', { roughness: .35 }), cx, .2, farZ); plant(cx - 5.3, r.cz - 5.2, 1.2); plant(cx + 5.3, r.cz - 5.2, 1.2); break;
      case 'warroom': wallScreen(cx - 3.4, 2.4, 1.5, 'bars', '#ff8fa3'); wallScreen(cx, 2.8, 1.7, 'line', '#d8c3a5'); wallScreen(cx + 3.4, 2.4, 1.5, 'bars', '#5fb7ff'); break;
      case 'screens': if (top) { wallScreen(cx - 2, 2.6, 1.5); wallScreen(cx + 2, 2.6, 1.5); } else { standScreen(cx - 2.6, farZ); standScreen(cx + 2.6, farZ); } plant(cx + 5.3, farZ); break;
      case 'seo': wallScreen(cx - 2.2, 2.6, 1.5, 'line', '#8fd16a'); wallScreen(cx + 2, 2.2, 1.5, 'bars', '#e1b452'); plant(cx + 5.3, farZ); break;
      case 'ticker': wallScreen(cx, 5, 1.4, 'line', '#e1b452'); plant(cx - 5.3, farZ); plant(cx + 5.3, farZ); break;
      case 'servers': [-4.6, -3.4, 4.6].forEach(dx => rack(cx + dx, farZ)); standScreen(cx + .4, farZ); break;
      case 'shelves': shelf(cx - 4, top ? -14.6 : farZ + .4); shelf(cx + 4, top ? -14.6 : farZ + .4); if (!occ.includes(3)) plant(seatOf(r, 3).x, seatOf(r, 3).z + 1); break;
      case 'photo': { const sweep = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3, 24, 1, true, Math.PI, Math.PI / 2), M('#f7f7f7', { side: THREE.DoubleSide, roughness: .9 })); sweep.position.set(cx, 1.6, -13.4); sweep.rotation.z = Math.PI / 2; stat.add(sweep);
        cyl(.35, .35, .9, M('#1c1c1c'), cx, .45, -13.3, 20); const ring = new THREE.Mesh(new THREE.TorusGeometry(.18, .04, 10, 28), champagne); ring.position.set(cx, 1.1, -13.3); stat.add(ring); softbox(cx - 5, -13.6); softbox(cx + 5, -13.6); break; }
      case 'reels': { [-1, 1].forEach(sd => { box(.04, 1.4, .04, metal, cx + sd * .25, .7, -12.8).rotation.z = sd * .2; }); box(.5, .3, .35, M('#1c1c1c'), cx, 1.45, -12.8); cyl(.1, .12, .3, M('#333'), cx, 1.45, -12.55, 12).rotation.x = Math.PI / 2;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.42, .05, 8, 32), M('#ffffff', { emissive: '#ffffff', emissiveIntensity: .8 })); ring.position.set(cx + 4.8, 1.85, -13.8); stat.add(ring); cyl(.03, .03, 1.7, metal, cx + 4.8, .85, -13.8, 8); box(2, 1.6, .1, M('#d9603b'), cx - 4.4, 1.2, -14.8); break; }
      case 'moodboard': box(3.2, 1.8, .08, M('#ffffff'), cx, 1.6, farZ); ['#1c1c1c', '#d8c3a5', '#e2d1c3', '#b08d57', '#8a5a3c', '#f4efe6'].forEach((c, i) => box(.8, .6, .02, M(c), cx - 1.05 + (i % 3) * 1.05, 1.95 - Math.floor(i / 3) * .7, farZ - .06)); box(.08, .8, .08, metal, cx, .4, farZ); plant(cx + 5.2, farZ); break;
    }
  });
  // a lounge in any bay without a department, so a building never shows a hole
  Object.values(B).forEach(b => { for (let c = 0; c < b.cols; c++) for (const row of [0, 1]) {
    if (Object.values(R).some(r => r.b === b && r.col === c && r.row === row)) continue;
    const cx = b.ox - b.half + 6 + 12 * c, cz = row ? 9 : -9, farZ = row ? cz + 5.3 : cz - 5.3;
    flat(11.8, 11.8, floorMat.wood, cx, .01, cz); lamp({ cx, cz });
    sofa(cx - 2.6, farZ, row ? Math.PI : 0, '#2f5d50'); sofa(cx + 2.6, farZ, row ? Math.PI : 0, '#2f5d50');
    box(1.4, .4, .8, M('#3a2a20', { roughness: .35 }), cx, .2, cz + (row ? 2.4 : -2.4)); plant(cx - 5.2, cz); plant(cx + 5.2, cz, 1.2);
  } });
  Object.values(B).forEach(b => { for (let x = b.ox - b.half + 3; x < b.ox + b.half; x += 12) plant(x, -2.2, .8); });

  // merge every static mesh into one per material: thousands of draws become a few dozen
  (function mergeStatic() {
    stat.updateMatrixWorld(true);
    const byMat = new Map(), old = [];
    stat.traverse(m => { if (!m.isMesh) return; old.push(m); if (!byMat.has(m.material)) byMat.set(m.material, []); byMat.get(m.material).push(m); });
    stat.clear();
    for (const [mat, list] of byMat) {
      const mesh = new THREE.Mesh(mergeGeos(list.map(m => ({ geo: m.geometry, matrix: m.matrixWorld }))), mat);
      mesh.castShadow = list.some(m => m.castShadow); mesh.receiveShadow = list.some(m => m.receiveShadow); mesh.matrixAutoUpdate = false; stat.add(mesh);
    }
    old.forEach(m => m.geometry.dispose());
  })();

  // lamp-post glow as one point cloud
  const glowTex = tex((g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,220,160,1)'); r.addColorStop(.25, 'rgba(255,200,130,.45)'); r.addColorStop(1, 'rgba(255,190,120,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }, 64, 64);
  const glowGeo = new THREE.BufferGeometry(); glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowAt.flat(), 3));
  const glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({ map: glowTex, size: 4.5, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.visible = false; scene.add(glow);

  // cars on the road
  const lightM = M('#fff8e0', { emissive: '#ffe6a8', emissiveIntensity: 0 }), tailM = M('#7a1010', { emissive: '#ff2a2a', emissiveIntensity: 0 }); lamps.push({ mat: lightM, on: 1.6 }, { mat: tailM, on: 1.2 });
  const BOXG = new THREE.BoxGeometry(1, 1, 1), WHEEL = new THREE.CylinderGeometry(.42, .42, .3, 12);
  [['#c9ccd1', -60, 38, 1, 7], ['#1f2328', 40, 42, -1, 6], ['#8e1d23', -150, 38, 1, 8.5]].forEach(([col, x, z, dir, v]) => {
    const g = new THREE.Group();
    g.add(colored([[BOXG, col, 0, .62, 0, 0, [4.4, .7, 1.9]], [BOXG, '#202833', -.2, 1.22, 0, 0, [2.4, .62, 1.7]], [BOXG, col, -.2, 1.55, 0, 0, [2.3, .06, 1.72]],
      ...[[-1.4, -.85], [1.4, -.85], [-1.4, .85], [1.4, .85]].map(([a, c]) => [WHEEL, '#121212', a, .42, c, Math.PI / 2])]));
    [-.62, .62].forEach(c => { const h = new THREE.Mesh(BOXG, lightM); h.scale.set(.06, .18, .4); h.position.set(2.21, .72, c); g.add(h); const t = new THREE.Mesh(BOXG, tailM); t.scale.set(.06, .16, .36); t.position.set(-2.21, .72, c); g.add(t); });
    g.position.set(x, -.3, z); g.rotation.y = dir > 0 ? 0 : Math.PI; scene.add(g); cars.push({ g, dir, v });
  });

  /* ---------- people: a body and four limbs each, in vertex colours ---------- */
  const folderM = M('#d8c3a5', { roughness: .4 });
  const G = { leg: new THREE.CapsuleGeometry(.085, .62, 3, 6), shoe: new THREE.BoxGeometry(.14, .08, .26), torso: new THREE.CapsuleGeometry(.2, .42, 3, 10), arm: new THREE.CapsuleGeometry(.06, .46, 3, 6), hand: new THREE.SphereGeometry(.065, 8, 6), neck: new THREE.CylinderGeometry(.07, .08, .1, 8), head: new THREE.SphereGeometry(.17, 14, 10), hair: new THREE.SphereGeometry(.182, 14, 8, 0, Math.PI * 2, 0, Math.PI * .52), eye: new THREE.SphereGeometry(.022, 6, 4), badge: new THREE.BoxGeometry(.08, .1, .02), folder: new THREE.BoxGeometry(.32, .04, .24), ring: new THREE.RingGeometry(.42, .52, 28), quest: new THREE.OctahedronGeometry(.22) };
  const RING_MAT = Object.fromEntries(Object.entries(STATUS_COL).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .85 })]));
  const questMat = new THREE.MeshStandardMaterial({ color: '#e1c38f', emissive: '#b08d57', emissiveIntensity: .8, metalness: .6, roughness: .25 });
  people.forEach(p => {
    const g = new THREE.Group(), pants = p.human ? '#1c1c1c' : '#3a4152';
    const tag = m => { m.userData.person = p; return m; };
    const body = tag(colored([[G.torso, p.shirt, 0, 1.25, 0, 0, [1, 1, .7]], [G.neck, p.skin, 0, 1.6, 0], [G.head, p.skin, 0, 1.79, 0], [G.hair, p.hair, 0, 1.81, -.015, -.25],
      [G.eye, '#111111', -.06, 1.8, .155], [G.eye, '#111111', .06, 1.8, .155], ...(p.human ? [[G.badge, '#d8c3a5', .1, 1.36, .145]] : [])]));
    g.add(body);
    const legs = [-1, 1].map(sd => { const pv = new THREE.Group(); pv.position.set(.11 * sd, .9, 0); pv.add(tag(colored([[G.leg, pants, 0, -.42, 0], [G.shoe, '#17181b', 0, -.85, .05]]))); g.add(pv); return pv; });
    const arms = [-1, 1].map(sd => { const pv = new THREE.Group(); pv.position.set(.27 * sd, 1.48, 0); pv.add(tag(colored([[G.arm, p.shirt, 0, -.27, 0], [G.hand, p.skin, 0, -.56, 0]]))); g.add(pv); return pv; });
    const ring = new THREE.Mesh(G.ring, RING_MAT.idle); ring.rotation.x = -Math.PI / 2; ring.position.y = .03; ring.visible = false; scene.add(ring);
    const folder = new THREE.Mesh(G.folder, folderM); folder.position.set(.3, 1.0, .25); folder.visible = false; g.add(folder);
    const qm = new THREE.Mesh(G.quest, questMat); qm.scale.y = 1.5; qm.visible = false; scene.add(qm);
    scene.add(g); Object.assign(p, { g, legs, arms, ring, folder, qm });
  });

  /* ---------- HUD layer ---------- */
  const at = (el, x, y, how) => { el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) ${how}`; };
  const mkEl = (tag, cls) => { const d = document.createElement(tag); d.className = cls; d.style.left = '0'; d.style.top = '0'; d.hidden = true; labels.appendChild(d); return d; };
  const roomLabels = Object.values(R).map(r => { const d = mkEl('button', 'room-label'); d.type = 'button'; d.textContent = r.name; d.onclick = () => flyTo(r.id); r.lbl = d; return r; });
  people.forEach(p => { p.tag = mkEl('div', 'tag' + (p.human ? ' human' : '')); p.tag.textContent = p.name.replace(' AI', ''); p.bub = mkEl('div', 'bubble'); });
  // floating card above each building, as in a campus map
  const cards = Object.values(B).map(b => {
    const stem = mkEl('div', 'bstem'), c = mkEl('div', 'bcard');
    c.innerHTML = `<div class="bc-head"><span class="bc-ic">${svg(ICON[b.id] || ICON.hq)}</span><span class="bc-name"><b>PARAKKAT</b><small>${b.short.toUpperCase()}</small></span><span class="bc-live"><i></i><em>Open now</em></span></div>
      <div class="bc-foot"><span>${svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>', 14)} ${b.people.length}</span><span>${svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M14 12h.01"/>', 14)} ${b.rooms} Rooms</span><button type="button" aria-label="Go to ${b.short}">${svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 15)}</button></div>`;
    c.querySelector('button').onclick = () => flyTo(b.id); c.style.pointerEvents = 'auto';
    return { b, c, stem, live: c.querySelector('.bc-live em'), lastBusy: -1 };
  });
  const v3 = new THREE.Vector3();
  const project = (x, y, z) => { v3.set(x, y, z).project(camera); return { x: (v3.x + 1) / 2 * canvas.clientWidth, y: (1 - v3.y) / 2 * canvas.clientHeight, front: v3.z < 1 }; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Labels are placed greedily and anything that would overlap an earlier one is skipped, so the view never gets crowded.
  const placed = []; let avoidRects = [], avoidAge = 99, cardsCompact = false;
  const free = (x, y, w, h) => { if (placed.some(b => Math.abs(b.x - x) < (b.w + w) / 2 && Math.abs(b.y - y) < (b.h + h) / 2)) return false; placed.push({ x, y, w, h }); return true; };
  function hud() {
    placed.length = 0;
    // keep clear of the page's own overlays; their positions are re-read twice a second, not every frame
    if (o.avoid && ++avoidAge > 15) { avoidAge = 0; const hr = host.getBoundingClientRect(); avoidRects = []; for (const el of o.avoid()) { if (!el || el.hidden) continue; const r = el.getBoundingClientRect(); if (r.width) avoidRects.push({ x: r.left - hr.left + r.width / 2, y: r.top - hr.top + r.height / 2, w: r.width + 8, h: r.height + 8 }); } }
    placed.push(...avoidRects);
    const dist = camera.position.distanceTo(controls.target), W = canvas.clientWidth, H = canvas.clientHeight, close = dist < 24;
    const onScreen = s => s.front && s.x > 0 && s.x < W && s.y > 30 && s.y < H;
    const xs = cards.map(k => project(k.b.ox, WH + .2, -15.2).x).sort((a, b) => a - b), gap = Math.min(...xs.slice(1).map((x, i) => x - xs[i]));
    const compact = gap < 276; if (compact !== cardsCompact) { cardsCompact = compact; cards.forEach(k => k.c.classList.toggle('compact', compact)); }
    for (const k of cards) {
      const a = project(k.b.ox, WH + .2, -15.2), top = project(k.b.ox, WH + (view === '2d' ? 2 : 7.5), -15.2), show = dist > 26 && onScreen(a);
      k.c.hidden = k.stem.hidden = !show; if (!show) continue;
      const busy = k.b.people.filter(p => BUSY.has(p.status)).length;
      if (busy !== k.lastBusy) { k.lastBusy = busy; k.live.textContent = busy ? `${busy} working` : 'Open now'; }
      const cw = k.c.offsetWidth || 250, ch = k.c.offsetHeight || 88, cy = Math.min(top.y, a.y - 18);
      at(k.c, a.x, cy, 'translate(-50%,-100%)'); placed.push({ x: a.x, y: cy - ch / 2, w: cw + 8, h: ch + 8 });
      k.stem.style.height = Math.max(0, a.y - cy) + 'px'; at(k.stem, a.x, cy, 'translateX(-50%)');
    }
    // speech first: selected person, then talking over thinking, then nearest the middle of the view
    const maxBubbles = dist < 40 ? 10 : dist < 90 ? 7 : 5, cx = W / 2, cy = H / 2;
    const talk = people.filter(p => p.bubble).map(p => ({ p, s: project(p.x, p.sitting ? 1.75 : 2.15, p.z) })).filter(o => onScreen(o.s))
      .sort((a, b) => (b.p === sel) - (a.p === sel) || (a.p.bubbleKind === 'thinking') - (b.p.bubbleKind === 'thinking') || Math.hypot(a.s.x - cx, a.s.y - cy) - Math.hypot(b.s.x - cx, b.s.y - cy));
    const shown = new Set();
    for (const { p, s } of talk) {
      if (shown.size >= maxBubbles) break;
      const compact = dist > 90 && p !== sel, w = compact ? 200 : 250, h = compact ? 46 : 70;
      const bx = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, s.x));
      if (!free(bx, s.y - 14 - h / 2, w, h)) continue;
      shown.add(p);
      const key = (compact ? 'c' : 'f') + p.bubble;
      if (p.bub._t !== key) { p.bub.innerHTML = `<span class="who">${esc(p.name)}</span>${esc(compact && p.bubble.length > 60 ? p.bubble.slice(0, 57) + '…' : p.bubble)}`; p.bub._t = key; p.bub.className = 'bubble ' + p.bubbleKind + (compact ? ' compact' : ''); }
      at(p.bub, bx, s.y - 14, 'translate(-50%,-100%)'); p.bub.hidden = false;
    }
    for (const p of people) if (!shown.has(p) && !p.bub.hidden) p.bub.hidden = true;
    for (const p of people) {
      // names stay readable from the campus view: everyone up to mid-range, people at work from further out
      const busy = BUSY.has(p.status);
      const want = !shown.has(p) && (close || dist < 60 || (busy && dist < 200) || p === sel || (p.human && p.quest));
      const s = want && project(p.x, p.sitting ? 1.75 : 2.15, p.z);
      const show = want && onScreen(s) && free(s.x, s.y - 16, p.name.length * 7.4 + (busy ? 30 : 18), 22);
      if (p.tag.hidden !== !show) p.tag.hidden = !show;
      if (show) { if (p.tag._busy !== busy) { p.tag._busy = busy; p.tag.classList.toggle('busy', busy); } at(p.tag, s.x, s.y - 8, 'translate(-50%,-100%)'); }
    }
    for (const r of roomLabels) {
      const s = dist < 60 && project(r.cx, 3.4, r.row ? r.cz + 5.6 : r.cz - 5.6);
      const show = !!s && onScreen(s) && free(s.x, s.y, r.name.length * 7.5 + 24, 24);
      if (r.lbl.hidden !== !show) r.lbl.hidden = !show; if (show) at(r.lbl, s.x, s.y, 'translate(-50%,-50%)');
    }
  }

  /* ---------- picking ---------- */
  const ray = new THREE.Raycaster(), mv = new THREE.Vector2(); let down = null;
  const onDown = e => { down = [e.clientX, e.clientY]; };
  const onUp = e => { if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; const r = canvas.getBoundingClientRect(); mv.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(mv, camera);
    const hit = ray.intersectObjects(people.map(p => p.g), true).find(h => h.object.userData.person); if (!hit) return; const p = hit.object.userData.person;
    if (p.human && p.quest && o.onApproverClick) o.onApproverClick(p); else select(p.id); };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp);
  controls.addEventListener('start', () => { fly = null; follow = null; untouched = false; });

  /* ---------- movement ---------- */
  const roomAt = (x, z) => Object.values(R).find(r => Math.abs(x - r.cx) <= 6 && Math.abs(z - r.cz) <= 6) || null;
  function goTo(p, tx, tz) {
    const from = roomAt(p.x, p.z) || p.room, to = roomAt(tx, tz), pts = [{ x: from.cx, z: p.z }];
    if (from !== to) pts.push({ x: from.cx, z: from.door }, { x: from.cx, z: 0 }, { x: to.cx, z: 0 }, { x: to.cx, z: to.door });
    pts.push({ x: to.cx, z: tz }, { x: tx, z: tz });
    if (p.resolve) { const r = p.resolve; p.resolve = null; r(); }
    p.sitting = false; p.path = pts; return new Promise(r => { p.resolve = r; });
  }
  const standBy = b => ({ x: b.home.x < b.homeRoom.cx ? b.homeRoom.cx - 1.1 : b.homeRoom.cx + 1.1, z: b.home.z + .3 });
  const rest = p => p.sitting ? (p.quest ? 'waiting' : 'idle') : 'walking';
  function step(p, dt) {
    if (!p.path.length) return; const t = p.path[0], dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz), v = (reduce ? 40 : Math.abs(dz) < .01 && Math.abs(p.z) < .01 ? 5.5 : 3.1) * dt;
    if (d > .001) p.heading = Math.atan2(dx, dz);
    if (d <= v) { p.x = t.x; p.z = t.z; p.path.shift(); if (!p.path.length && p.resolve) { const r = p.resolve; p.resolve = null; r(); } } else { p.x += dx / d * v; p.z += dz / d * v; }
  }
  function pose(p, t) {
    const g = p.g, walking = !p.sitting && p.path.length;
    // someone sitting still needs no update unless they are typing or something about them just changed
    if (p._still) { p.ring.visible = p === sel || p.status !== 'idle'; return; }
    p._still = p.sitting && !p.path.length && p.status !== 'thinking';
    g.position.set(p.x, 0, p.z);
    if (p.sitting) { g.position.y = -.4; g.position.z = p.z - .05; g.rotation.y = 0; p.legs.forEach(l => { l.rotation.x = -Math.PI / 2 + .1; }); p.arms.forEach((a, i) => { a.rotation.x = -.9 + (p.status === 'thinking' ? Math.sin(t * 9 + i * 3) * .12 : 0); }); }
    else { g.position.y = walking ? Math.abs(Math.sin(t * 9 + p.phase)) * .04 : 0;
      const face = !walking && p.faceTo ? Math.atan2(p.faceTo.x - p.x, p.faceTo.z - p.z) : p.heading;
      g.rotation.y += ((((face - g.rotation.y) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI) * .2;
      const sw = walking ? Math.sin(t * 9 + p.phase) * .6 : 0; p.legs[0].rotation.x = sw; p.legs[1].rotation.x = -sw; p.arms[0].rotation.x = p.carry ? -1.1 : -sw * .8; p.arms[1].rotation.x = sw * .8 + (p.status === 'talking' ? Math.sin(t * 5) * .3 - .3 : 0); }
    p.folder.visible = p.carry && !p.sitting;
    p.ring.visible = p === sel || p.status !== 'idle'; p.ring.position.set(p.x, .03, p.z); p.ring.material = RING_MAT[p.status] || RING_MAT.idle;
  }
  const markDirty = p => { p._still = false; };

  /* ---------- loop ---------- */
  let last = performance.now(), T = 0, visible = true, frameNo = 0, slow = 0, timed = 0;
  const lastCam = new THREE.Matrix4();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const raw = (now - last) / 1000, dt = Math.min(.05, raw); last = now;
    if (!paused) { T += dt * speed; people.forEach(p => step(p, dt * speed)); cars.forEach(c => { c.g.position.x += c.dir * c.v * dt * (reduce ? 0 : 1); if (Math.abs(c.g.position.x) > 130) c.g.position.x = -c.dir * 130; }); }
    if (!visible) return;
    frameNo++;
    people.forEach(p => pose(p, T));
    for (const p of people) if (p.quest || p.qm.visible) { p.qm.visible = p.quest; if (p.quest) { p.qm.position.set(p.x, (p.sitting ? 2.6 : 3) + Math.sin(T * 3) * .12, p.z); p.qm.rotation.y = T * 2; } }
    flags.forEach((f, i) => { f.rotation.y = Math.sin(T * 2 + i) * .25; });
    if (fly) { fly.t = Math.min(1, fly.t + dt * 1.1); const k = 1 - Math.pow(1 - fly.t, 3); controls.target.lerpVectors(fly.ft, fly.tt, k); camera.position.lerpVectors(fly.fp, fly.tp, k); if (fly.t >= 1) fly = null; }
    else if (follow && !follow.sitting) { const d = new THREE.Vector3(follow.x, 0, follow.z).sub(controls.target).multiplyScalar(.06); controls.target.add(d); camera.position.add(d); }
    controls.update();
    if (shadowsOn && frameNo % 3 === 1) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    const moved = !lastCam.equals(camera.matrixWorld);
    if (moved) { lastCam.copy(camera.matrixWorld); const d = camera.position.distanceTo(controls.target); scene.fog.near = d + 30; scene.fog.far = d + 230; }
    if (moved || frameNo % 2 === 0) hud();
    // if the device cannot keep up, lower the resolution, then switch shadows off
    if (quality > 0 && raw < .5) { timed++; if (raw > 1 / 32) slow++; if (timed >= 90) { if (slow > 60) degrade(); timed = slow = 0; } }
  }
  function degrade() {
    quality--;
    if (quality === 1 && pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); resize(); }
    else { quality = 0; shadowsOn = false; scene.traverse(m => { if (m.isMesh) m.castShadow = false; }); renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); }
  }
  let inset = 0;
  function resize() {
    const fs = document.fullscreenElement === host, w = host.clientWidth || 800;
    const h = fs || o.fill ? Math.max(320, host.clientHeight) : Math.max(460, Math.min(innerHeight - 150, w * .72));
    renderer.setSize(w, h, false); canvas.style.height = h + 'px'; camera.aspect = w / h;
    if (inset && w > 860) camera.setViewOffset(w, h, inset / 2, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix(); avoidAge = 99;
  }
  // on narrow screens the campus view steps back so all three buildings fit across
  function fit(v) { const w = host.clientWidth || 800, a = (w - (inset && w > 860 ? inset : 0)) / Math.max(1, host.clientHeight || 600), k = Math.min(2.4, Math.max(1, 1.3 / a)); return v.pos.map((c, i) => v.target[i] + (c - v.target[i]) * k); }
  let untouched = true;
  resize(); camera.position.set(...fit(CAMPUS_VIEW)); raf = requestAnimationFrame(frame);

  /* ---------- camera moves for buttons and keys ---------- */
  const sphere = new THREE.Spherical(), off = new THREE.Vector3();
  function orbit(dTheta, dPhi, scale = 1) {
    fly = null; follow = null; off.copy(camera.position).sub(controls.target); sphere.setFromVector3(off);
    sphere.theta += dTheta; sphere.phi = Math.min(controls.maxPolarAngle, Math.max(controls.minPolarAngle, sphere.phi + dPhi));
    sphere.radius = Math.min(controls.maxDistance, Math.max(controls.minDistance, sphere.radius * scale));
    off.setFromSpherical(sphere); camera.position.copy(controls.target).add(off);
  }
  function pan(right, forward) {
    fly = null; follow = null; const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x), k = camera.position.distanceTo(controls.target) * .08;
    const d = r.multiplyScalar(right * k).add(f.multiplyScalar(forward * k)); controls.target.add(d); camera.position.add(d);
  }
  const KEYS = { ArrowLeft: () => pan(-1, 0), ArrowRight: () => pan(1, 0), ArrowUp: () => pan(0, 1), ArrowDown: () => pan(0, -1), a: () => pan(-1, 0), d: () => pan(1, 0), w: () => pan(0, 1), s: () => pan(0, -1),
    q: () => orbit(.12, 0), e: () => orbit(-.12, 0), r: () => orbit(0, -.08), f: () => orbit(0, .08), '+': () => orbit(0, 0, .85), '=': () => orbit(0, 0, .85), '-': () => orbit(0, 0, 1.18) };
  const onKey = e => { if (e.target.closest && e.target.closest('input, textarea, select')) return; const k = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key]; if (k) { k(); e.preventDefault(); } };
  canvas.tabIndex = 0; canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  // keep the camera over the campus
  controls.addEventListener('change', () => { const t = controls.target, cx = Math.max(-95, Math.min(95, t.x)), cz = Math.max(-35, Math.min(50, t.z)); if (cx !== t.x || cz !== t.z || t.y !== 0) { const d = new THREE.Vector3(cx - t.x, -t.y, cz - t.z); t.add(d); camera.position.add(d); } });
  const onFs = () => setTimeout(resize, 50); document.addEventListener('fullscreenchange', onFs);

  /* ---------- public API ---------- */
  function sleep(ms) { return new Promise(res => { let left = ms, l = performance.now(); (function st() { const n = performance.now(); if (!paused) left -= (n - l) * speed; l = n; left <= 0 ? res() : setTimeout(st, 80); })(); }); }
  function select(id) { if (sel) markDirty(sel); sel = P[id] || null; follow = sel; if (sel) markDirty(sel); o.onSelect && sel && o.onSelect(sel); }
  function flyTo(id) {
    follow = null; let tgt, pos;
    if (!id) { const v = view === '2d' ? TOP_VIEW : CAMPUS_VIEW; tgt = v.target; pos = fit(v); }
    else if (B[id]) { const b = B[id]; tgt = [b.ox, 0, 1]; pos = view === '2d' ? [b.ox, b.cols * 16 + 10, 1.01] : [b.ox + 4, b.cols * 9 + 6, b.cols * 9 + 16]; }
    else if (R[id]) { const r = R[id]; tgt = [r.cx, 0, r.cz]; pos = view === '2d' ? [r.cx, 30, r.cz + .01] : [r.cx + 3, 13, r.cz + 15]; }
    else if (P[id]) return focus(id);
    else return;
    fly = { t: 0, ft: controls.target.clone(), fp: camera.position.clone(), tt: new THREE.Vector3(...tgt), tp: new THREE.Vector3(...pos) };
  }
  function focus(id) { const p = P[id]; if (!p) return; flyTo(roomAt(p.x, p.z)?.id || p.room.id); sel && markDirty(sel); sel = p; markDirty(p); o.onSelect && o.onSelect(p); }
  function setView(v) {
    view = v === '2d' ? '2d' : '3d';
    controls.enableRotate = view === '3d'; controls.minPolarAngle = view === '2d' ? 0 : .08; controls.maxPolarAngle = view === '2d' ? .02 : 1.47;
    const vw = view === '2d' ? TOP_VIEW : CAMPUS_VIEW;
    fly = { t: 0, ft: controls.target.clone(), fp: camera.position.clone(), tt: new THREE.Vector3(...vw.target), tp: new THREE.Vector3(...fit(vw)) };
  }
  function setNight(n) {
    night = n; const sky = new THREE.Color(n ? SKY_NIGHT : SKY_DAY); scene.background = sky; scene.fog.color = sky;
    sun.intensity = n ? .4 : 2.1; sun.color.set(n ? '#a9bde8' : '#fff1d6'); hemi.intensity = n ? .36 : .75; hemi.color.set(n ? '#8fa6c9' : '#e3f0ff'); hemi.groundColor.set(n ? '#2e3528' : '#8a7a5c');
    lamps.forEach(l => { if (l.isLight) l.intensity = n ? 2.6 : 0; else l.mat.emissiveIntensity = n ? (l.on || 1.4) : 0; });
    screens.forEach(s => { s.emissiveIntensity = n ? 1.0 : .55; }); glow.visible = n; renderer.toneMappingExposure = n ? 1.15 : 1.05;
    renderer.shadowMap.needsUpdate = true;
  }
  const api = {
    people, byId: P, rooms: R, buildings: B, sleep,
    get paused() { return paused; }, setPaused(v) { paused = v; }, get speed() { return speed; }, setSpeed(v) { speed = v; },
    get night() { return night; }, setNight, flyTo, focus, select, orbit, pan,
    get view() { return view; }, setView,
    /** Width in pixels covered by a panel on the right; the scene centres itself in the rest. */
    setInset(px) { inset = px || 0; resize(); if (untouched && !fly && view === '3d') camera.position.set(...fit(CAMPUS_VIEW)); },
    turn(deg) { orbit(deg * Math.PI / 180, 0); }, tilt(deg) { orbit(0, deg * Math.PI / 180); }, zoom(f) { orbit(0, 0, f); },
    fullscreen() { return document.fullscreenElement ? document.exitFullscreen() : host.requestFullscreen?.(); }, get selected() { return sel; }, resize,
    setVisible(v) { visible = v; if (v) resize(); },
    /** Who is at work: everyone, and how many were busy in the last five minutes, overall and per building. */
    stats() { const now = performance.now(), active = l => l.filter(p => BUSY.has(p.status) || now - (p.active || -1e9) < 3e5).length;
      return { total: people.length, active: active(people), buildings: Object.values(B).map(b => ({ id: b.id, name: b.short, total: b.people.length, active: active(b.people), rooms: b.rooms })) }; },
    info() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, quality }; },
    async walkTo(id, toId) { const p = P[id], b = P[toId]; if (!p || !b) return; markDirty(p); p.active = performance.now(); p.status = 'walking'; p.task = `Walking to ${b.name}`; p.faceTo = null; const s = standBy(b); await goTo(p, s.x, s.z); p.room = roomAt(s.x, s.z) || p.room; p.faceTo = b; },
    async walkHome(id) { const p = P[id]; if (!p) return; markDirty(p); p.status = 'walking'; p.faceTo = null; await goTo(p, p.home.x, p.home.z); p.room = p.homeRoom; p.sitting = true; p.status = rest(p); markDirty(p); p.task = p.quest ? 'Waiting on an approval' : 'Waiting for the next job'; p.carry = false; },
    async say(id, text, kind = 'talking', ms = 2600) { const p = P[id]; if (!p) return; markDirty(p); p.active = performance.now(); p.status = 'talking'; p.bubble = text; p.bubbleKind = kind; p.log.unshift(text); p.log.length = Math.min(p.log.length, 3); await sleep(ms + text.length * 20); if (p.bubble === text) p.bubble = null; p.status = rest(p); markDirty(p); },
    async think(id, text, ms = 2600) { const p = P[id]; if (!p) return; markDirty(p); p.active = performance.now(); p.status = 'thinking'; p.task = text; p.bubble = text + '…'; p.bubbleKind = 'thinking'; p.log.unshift(text); p.log.length = Math.min(p.log.length, 3); await sleep(ms); if (p.bubble === text + '…') p.bubble = null; p.status = rest(p); markDirty(p); },
    setCarry(id, v) { if (P[id]) { P[id].carry = v; markDirty(P[id]); } },
    setQuest(id, v) { const p = P[id]; if (!p) return; p.quest = v; if (p.sitting && !p.bubble) p.status = v ? 'waiting' : 'idle'; p.task = v ? 'Waiting on an approval' : 'Nothing waiting'; markDirty(p); },
    dispose() { cancelAnimationFrame(raf); canvas.removeEventListener('keydown', onKey); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); document.removeEventListener('fullscreenchange', onFs); controls.dispose(); renderer.dispose(); labels.innerHTML = ''; },
  };
  setNight(!!o.night);
  return api;
}

function mix(a, b, t) { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const c = k => Math.round(((pa >> k) & 255) * (1 - t) + ((pb >> k) & 255) * t); return '#' + ((1 << 24) + (c(16) << 16) + (c(8) << 8) + c(0)).toString(16).slice(1); }
