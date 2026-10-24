// The 3D Parakkat campus. Framework-free so the same file runs in the Next.js app and the prototype page.
// THREE and OrbitControls are passed in, so the caller decides how three.js is loaded.

const DEPT_COLOR = {
  board: '#b08d57', insights: '#3d6fb0', intel: '#6c4fb3', strategy: '#2b8a64', creative: '#b23a4c', social: '#d07a1f',
  perf: '#23807a', lead: '#1c1c1c', warroom: '#6f3fa0', customer: '#2f7fa8', goldrate: '#b8913f', datahub: '#4a5568',
  forecast: '#3f8f7a', qa: '#8a6a3a', photo: '#c4566a', reels: '#d9603b', catalog: '#8a5a9e', lang: '#3a8f5c', crm: '#2b6cb0', brand: '#a8865a',
};
const SKIN = ['#f0c9a4', '#d7a47c', '#b77d57', '#8c5a3c'];
const HAIR = ['#231812', '#4a2f1e', '#7b5434', '#1d1d24', '#b9b2a8', '#3a2a1c'];
const STATUS_COL = { idle: '#4b8fe0', thinking: '#e89a3c', talking: '#35b07c', walking: '#35b07c', waiting: '#d8b27a' };
const SEAT = [[-3, -2.6], [3, -2.6], [-3, 2.2], [3, 2.2]];
const WH = 3.0;
const CAMPUS_VIEW = { pos: [0, 74, 92], target: [0, 0, -1] };

/**
 * @param {object} o
 * @param {any} o.THREE
 * @param {any} o.OrbitControls
 * @param {HTMLCanvasElement} o.canvas
 * @param {HTMLElement} o.labels  absolutely positioned layer over the canvas for names and speech
 * @param {HTMLElement} o.host    element whose width sizes the scene
 * @param {{BUILDINGS: any[], ROOMS: any[], PEOPLE: any[]}} o.roster
 * @param {(p: any) => void} [o.onSelect]
 * @param {(p: any) => void} [o.onApproverClick]
 * @param {() => (HTMLElement | null)[]} [o.avoid]  overlay elements labels should not cover
 */
export function createOffice(o) {
  const { THREE, OrbitControls, canvas, labels, host, roster } = o;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let paused = false, speed = 1, night = false, sel = null, follow = null, fly = null, raf = 0;

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

  /* ---------- renderer ---------- */
  THREE.ColorManagement.legacyMode = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const SKY_DAY = '#cfdfeb', SKY_NIGHT = '#0d1526';
  scene.background = new THREE.Color(SKY_DAY); scene.fog = new THREE.Fog(SKY_DAY, 120, 260);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, .5, 600);
  camera.position.set(...CAMPUS_VIEW.pos);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(...CAMPUS_VIEW.target); controls.enableDamping = true; controls.minPolarAngle = .08; controls.maxPolarAngle = 1.47; controls.minDistance = 6; controls.maxDistance = 170; controls.screenSpacePanning = false;
  // Map-style: drag moves across the campus, right-drag (or two fingers) turns and tilts, scroll or pinch zooms.
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.panSpeed = 1.2; controls.rotateSpeed = .7; controls.zoomSpeed = 1.1;
  const hemi = new THREE.HemisphereLight('#e3f0ff', '#8a7a5c', .75); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.1); sun.position.set(-40, 60, 34); sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096); Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 45, bottom: -45, near: 1, far: 200 }); sun.shadow.bias = -.0004; sun.shadow.normalBias = .03;
  scene.add(sun);

  /* ---------- helpers ---------- */
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const matCache = new Map();
  const M = (color, opt = {}) => { if (opt.map) return new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: 0, ...opt }); const k = color + JSON.stringify(opt); if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: 0, ...opt })); return matCache.get(k); };
  const sh = m => { m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w, h, d, mat, x, y, z, parent) => { const m = sh(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); m.position.set(x, y, z); (parent || scene).add(m); return m; };
  const cyl = (rt, rb, h, mat, x, y, z, seg = 16, parent) => { const m = sh(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat)); m.position.set(x, y, z); (parent || scene).add(m); return m; };
  const flat = (w, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m; };
  const tex = (draw, w = 256, h = 256, rep = [1, 1]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 4; return t; };
  const screens = [], lamps = [], flags = [];

  /* ---------- ground and landscape ---------- */
  const grass = tex((g, w, h) => { g.fillStyle = '#6f9a4e'; g.fillRect(0, 0, w, h); for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${40 + rnd() * 50 | 0},${90 + rnd() * 60 | 0},${30 + rnd() * 30 | 0},.5)`; g.fillRect(rnd() * w, rnd() * h, 2, 3); } }, 256, 256, [50, 50]);
  const ground = flat(500, 500, M('#ffffff', { map: grass, roughness: 1 }), 0, -.32, 0);
  const paving = tex((g, w, h) => { g.fillStyle = '#d3cec4'; g.fillRect(0, 0, w, h); g.strokeStyle = '#bdb6aa'; g.lineWidth = 2; for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } }, 256, 256, [26, 4]);
  flat(160, 16, M('#fff', { map: paving, roughness: .95 }), 0, -.3, 24);
  flat(500, 10, M('#3a3d42', { roughness: .9 }), 0, -.31, 38);
  const dash = M('#e8e2cf'); for (let x = -240; x < 240; x += 6) flat(3, .25, dash, x, -.3, 38);
  const trunk = M('#6b4b33'), leafA = M('#4f7f3a'), leafB = M('#5f9443');
  const tree = (x, z, s = 1) => { cyl(.18 * s, .25 * s, 2.2 * s, trunk, x, 1.1 * s - .3, z, 8); for (let i = 0; i < 3; i++) { const m = sh(new THREE.Mesh(new THREE.IcosahedronGeometry((1.5 - i * .3) * s, 1), i % 2 ? leafA : leafB)); m.position.set(x + (rnd() - .5) * .6 * s, (2.4 + i * .9) * s - .3, z + (rnd() - .5) * .6 * s); scene.add(m); } };
  const palm = (x, z) => { for (let i = 0; i < 6; i++) cyl(.16, .2, .9, trunk, x + i * .12, .15 + i * .85, z, 8).rotation.z = -.08; for (let k = 0; k < 7; k++) { const f = sh(new THREE.Mesh(new THREE.ConeGeometry(.35, 3.2, 4), leafB)); f.position.set(x + .7, 5.3, z); f.rotation.set(Math.PI / 2 - .5, k / 7 * Math.PI * 2, 0, 'YXZ'); f.translateY(1.4); scene.add(f); } };
  for (let x = -96; x <= 96; x += 12) { tree(x + (rnd() - .5) * 4, -26 - rnd() * 6, .9 + rnd() * .4); if (Math.abs(x) > 74) { tree(x, 0, 1.1); tree(x + 3, 14, 1); } }
  [-84, -60, 60, 84].forEach(x => palm(x, 22)); [-30, 30].forEach(x => palm(x, 30));
  for (let x = -100; x <= 100; x += 9) if (Math.abs(x) > 12) tree(x, 46 + rnd() * 6, .8 + rnd() * .5);

  // fountain and brand flags in front of HQ
  cyl(4, 4.3, .6, M('#d8d2c6', { roughness: .6 }), 0, 0, 24, 40); const water = cyl(3.6, 3.6, .1, M('#7fb8d6', { roughness: .1, metalness: .2 }), 0, .32, 24, 40); water.castShadow = false;
  cyl(.5, .7, 1.4, M('#d8d2c6'), 0, .9, 24, 20); const jet = cyl(.08, .25, 1.4, M('#cfe8f5', { transparent: true, opacity: .7, roughness: .1 }), 0, 2.2, 24, 12); jet.castShadow = false;
  const flagTex = tex((g, w, h) => { g.fillStyle = '#1c1c1c'; g.fillRect(0, 0, w, h); g.fillStyle = '#d8c3a5'; g.font = '600 34px Montserrat, Arial, sans-serif'; g.textAlign = 'center'; g.save(); g.translate(w / 2, h / 2); g.fillText('P', 0, 12); g.restore(); g.fillRect(0, h - 10, w, 4); }, 128, 96);
  [-9, -5, 5, 9].forEach(x => { cyl(.06, .06, 7, M('#c9c9c9', { metalness: .8, roughness: .3 }), x, 3.2, 19, 8); const f = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.4, 8, 1), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: .8 })); f.position.set(x + 1, 6, 19); f.castShadow = true; scene.add(f); flags.push(f); });

  /* ---------- floors ---------- */
  const shade = (hex, v) => { const n = parseInt(hex.slice(1), 16), c = k => Math.max(0, Math.min(255, ((n >> k) & 255) + v | 0)); return `rgb(${c(16)},${c(8)},${c(0)})`; };
  const plank = (base, dark) => tex((g, w, h) => { for (let y = 0; y < h; y += 16) { const off = (y / 16 % 2) * 64; for (let x = -64; x < w; x += 128) { g.fillStyle = shade(base, (rnd() - .5) * 22); g.fillRect(x + off, y, 128, 16); g.fillStyle = dark; g.fillRect(x + off, y, 1.5, 16); } g.fillStyle = dark; g.fillRect(0, y, w, 1); } }, 256, 256, [3, 3]);
  const FLOORS = {
    wood: plank('#9b6a43', 'rgba(60,35,20,.5)'), oak: plank('#c39a6b', 'rgba(90,60,30,.45)'),
    concrete: tex((g, w, h) => { g.fillStyle = '#bdbab3'; g.fillRect(0, 0, w, h); for (let i = 0; i < 1800; i++) { const v = 150 + rnd() * 60 | 0; g.fillStyle = `rgba(${v},${v},${v - 6},.35)`; g.fillRect(rnd() * w, rnd() * h, 2, 2); } }, 256, 256, [3, 3]),
    carpet: tex((g, w, h) => { g.fillStyle = '#3a4a52'; g.fillRect(0, 0, w, h); for (let i = 0; i < 3000; i++) { g.fillStyle = rnd() > .5 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.06)'; g.fillRect(rnd() * w, rnd() * h, 2, 2); } }, 256, 256, [4, 4]),
    marble: tex((g, w, h) => { g.fillStyle = '#ece8e1'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(150,140,130,.35)'; for (let i = 0; i < 14; i++) { g.beginPath(); let x = rnd() * w, y = rnd() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - .3) * 50; y += (rnd() - .5) * 40; g.lineTo(x, y); } g.stroke(); } g.strokeStyle = 'rgba(120,110,100,.25)'; g.strokeRect(0, 0, w, h); }, 256, 256, [3, 3]),
  };
  const corridorTex = tex((g, w, h) => { g.fillStyle = '#e2ded6'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,.07)'; for (let i = 0; i < w; i += 64) g.fillRect(i, 0, 2, h); g.fillRect(0, h / 2, w, 2); }, 256, 64, [12, 1]);

  /* ---------- buildings ---------- */
  const plaster = M('#f1eee9', { roughness: .9 }), frameM = M('#1c1c1c', { roughness: .4, metalness: .5 }), champagne = M('#d8c3a5', { roughness: .35, metalness: .55 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#d6ecff', transparent: true, opacity: .16, roughness: .05, metalness: 0, depthWrite: false });
  const pane = (x1, z1, x2, z2, h = WH) => {
    const len = Math.hypot(x2 - x1, z2 - z1); if (len < .05) return; const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, ang = Math.atan2(z2 - z1, x2 - x1);
    const g = new THREE.Mesh(new THREE.BoxGeometry(len, h, .06), glass); g.position.set(cx, h / 2, cz); g.rotation.y = -ang; scene.add(g);
    box(len, .08, .1, frameM, cx, h, cz).rotation.y = -ang; box(len, .1, .1, frameM, cx, .05, cz).rotation.y = -ang;
    box(.08, h, .1, frameM, x1, h / 2, z1); box(.08, h, .1, frameM, x2, h / 2, z2);
  };
  function signTexture(main, sub) {
    return tex((g, w, h) => { g.fillStyle = '#1c1c1c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#d8c3a5'; g.lineWidth = 3; g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = '#e9d9c1'; g.textAlign = 'center'; g.font = `600 ${sub ? 92 : 120}px Montserrat, "Helvetica Neue", Arial, sans-serif`;
      const spaced = main.split('').join(String.fromCharCode(8202) + String.fromCharCode(8202)); g.fillText(spaced, w / 2, sub ? 128 : 170);
      if (sub) { g.fillStyle = '#b8a07e'; g.font = '500 40px Montserrat, Arial, sans-serif'; g.fillText(sub.toUpperCase().split('').join(String.fromCharCode(8202)), w / 2, 200); } }, 1024, 256);
  }
  roster.BUILDINGS.forEach(b0 => {
    const b = B[b0.id], { ox, half } = b, W = half * 2;
    box(W + 2, .32, 32, M('#d6d2c8', { roughness: .9 }), ox, -.16, 0);
    flat(W, 6, M('#fff', { map: corridorTex, roughness: .5 }), ox, .012, 0);
    flat(W - 1, 1.6, M('#1c1c1c', { roughness: .95 }), ox, .02, 0); flat(W - 1, .12, champagne, ox, .025, .74); flat(W - 1, .12, champagne, ox, .025, -.74);
    box(W + .4, WH, .3, plaster, ox, WH / 2, -15.15);
    [-1, 1].forEach(sd => { box(.3, WH, 12.3, plaster, ox + sd * (half + .15), WH / 2, -9.15); box(.3, WH, 12.3, plaster, ox + sd * (half + .15), WH / 2, 9.15); });
    pane(ox - half, 15, ox + half, 15, 1.2);
    [-3, 3].forEach(z => { for (let c = 0; c < b.cols; c++) { const cx = ox - half + 6 + 12 * c; pane(cx - 6, z, cx - 1.1, z); pane(cx + 1.1, z, cx + 6, z); } });
    for (let c = 1; c < b.cols; c++) { const x = ox - half + 12 * c; pane(x, -15, x, -3); pane(x, 3, x, 15); }
    // brand sign above the back wall
    const sw = Math.min(W - 6, b.id === 'hq' ? 30 : 22), sh2 = sw / 4;
    box(sw + .3, sh2 + .3, .3, frameM, ox, WH + sh2 / 2 + .4, -15.2);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh2), new THREE.MeshStandardMaterial({ map: signTexture('PARAKKAT', b.id === 'hq' ? 'Jewels · Marketing HQ' : b.short), emissive: '#ffffff', emissiveIntensity: .0, roughness: .5 }));
    sign.material.emissiveMap = sign.material.map; sign.position.set(ox, WH + sh2 / 2 + .4, -15.03); scene.add(sign); screens.push(sign.material);
    box(.25, .8, .25, frameM, ox - sw / 3, WH + .2, -15.2); box(.25, .8, .25, frameM, ox + sw / 3, WH + .2, -15.2);
    // champagne roof trim
    box(W + .4, .12, .34, champagne, ox, WH + .06, -15.15);
    const L = new THREE.PointLight('#ffd9a0', 0, 46, 1.6); L.position.set(ox, 6, 0); scene.add(L); lamps.push(L);
  });
  // covered walkways between buildings along the corridor line
  const sorted = [...roster.BUILDINGS].map(b => B[b.id]).sort((a, c) => a.ox - c.ox);
  for (let i = 0; i < sorted.length - 1; i++) {
    const x1 = sorted[i].ox + sorted[i].half, x2 = sorted[i + 1].ox - sorted[i + 1].half, cx = (x1 + x2) / 2, len = x2 - x1;
    flat(len + .6, 6, M('#fff', { map: corridorTex, roughness: .5 }), cx, -.02, 0); box(len + .6, .3, 6.4, M('#d6d2c8', { roughness: .9 }), cx, -.2, 0);
    flat(len + .6, 1.6, M('#1c1c1c', { roughness: .95 }), cx, .0, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + .6, .1, 6.4), glass); roof.position.set(cx, WH + .2, 0); scene.add(roof);
    [-3.1, 3.1].forEach(z => { box(len + .6, .12, .12, champagne, cx, WH + .2, z); [x1 + .2, x2 - .2].forEach(x => box(.12, WH + .2, .12, frameM, x, (WH + .2) / 2, z)); });
  }

  /* ---------- furniture ---------- */
  const SCREEN_COLS = ['#5fb7ff', '#5fe0a8', '#ffcf5a', '#ff8fa3', '#d8c3a5'];
  function screenTex(kind, col) {
    return tex((g, w, h) => { g.fillStyle = '#0f1624'; g.fillRect(0, 0, w, h); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 4;
      if (kind === 'bars') for (let i = 0; i < 7; i++) { const bh = 20 + rnd() * (h - 44); g.fillRect(10 + i * (w - 20) / 7, h - 10 - bh, (w - 20) / 7 - 6, bh); }
      else { g.beginPath(); for (let i = 0; i <= 20; i++) { const x = 8 + i * (w - 16) / 20, y = h * .75 - Math.sin(i / 3 + rnd()) * h * .2 - i * h * .012; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
      g.globalAlpha = .35; g.fillRect(10, 8, w * .4, 6); }, 128, 80);
  }
  const screenMat = (kind, col) => { const t = screenTex(kind || (rnd() > .5 ? 'bars' : 'line'), col || SCREEN_COLS[(rnd() * 5) | 0]); const m = new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: .55, roughness: .3 }); screens.push(m); return m; };
  const deskTop = M('#e4d8c6', { roughness: .55 }), metal = M('#2d3036', { metalness: .6, roughness: .35 }), fabric = M('#2b2e35', { roughness: .85 });
  function desk(x, z) {
    box(2.6, .07, 1.2, deskTop, x, .75, z + .95); [[-1.2, .45], [1.2, .45], [-1.2, 1.45], [1.2, 1.45]].forEach(([a, c]) => box(.06, .72, .06, metal, x + a, .37, z + c));
    box(.08, .35, .08, metal, x, .95, z + 1.3); box(1.1, .66, .05, metal, x, 1.42, z + 1.3);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.02, .58), screenMat()); s.position.set(x, 1.42, z + 1.27); s.rotation.y = Math.PI; scene.add(s);
    box(.8, .03, .26, M('#ebebeb'), x, .8, z + .8); box(.12, .14, .12, M('#ffffff', { roughness: .3 }), x - .9, .85, z + .9);
    box(.62, .1, .58, fabric, x, .5, z - .05); box(.62, .7, .1, fabric, x, .9, z - .38); cyl(.04, .04, .45, metal, x, .25, z - .05, 8); cyl(.32, .32, .04, metal, x, .03, z - .05, 12);
  }
  const pot = M('#ece6da', { roughness: .6 }), leafC = M('#3f7a3a', { roughness: .8 }), leafD = M('#55964a', { roughness: .8 });
  function plant(x, z, s = 1) { cyl(.28 * s, .22 * s, .55 * s, pot, x, .27 * s, z, 16); for (let i = 0; i < 5; i++) { const m = sh(new THREE.Mesh(new THREE.IcosahedronGeometry(.32 * s, 0), i % 2 ? leafC : leafD)); m.position.set(x + (rnd() - .5) * .4 * s, (.8 + rnd() * .6) * s, z + (rnd() - .5) * .4 * s); m.scale.y = 1.5; scene.add(m); } }
  function wallScreen(x, w, h, kind, col) { box(w + .12, h + .12, .08, M('#16181d', { metalness: .4, roughness: .3 }), x, 1.9, -14.95); const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat(kind, col)); s.position.set(x, 1.9, -14.9); scene.add(s); }
  function standScreen(x, z, w = 1.8) { box(.08, 1.2, .08, metal, x, .6, z); box(w + .1, 1.1, .08, M('#16181d'), x, 1.6, z); const s = new THREE.Mesh(new THREE.PlaneGeometry(w, 1), screenMat()); s.position.set(x, 1.6, z - .05); s.rotation.y = Math.PI; scene.add(s); }
  function sofa(x, z, rot = 0, col = '#1c1c1c') { const g = new THREE.Group(), f = M(col, { roughness: .9 }); box(2.4, .42, .95, f, 0, .3, 0, g); box(2.4, .6, .22, f, 0, .7, -.38, g); box(.22, .5, .95, f, -1.15, .5, 0, g); box(.22, .5, .95, f, 1.15, .5, 0, g); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g); }
  function shelf(x, z) { box(2.2, 2.2, .45, M('#3b2a20', { roughness: .7 }), x, 1.1, z); for (let r = 0; r < 4; r++) for (let i = 0; i < 9; i++) box(.16, .38, .3, M(['#d8c3a5', '#1c1c1c', '#8a5a3c', '#b23a4c', '#3d6fb0'][(i + r) % 5]), x - .9 + i * .22, .45 + r * .5, z - .05); }
  function rack(x, z) { box(.9, 2.2, .9, M('#24272e', { metalness: .5, roughness: .35 }), x, 1.1, z); for (let i = 0; i < 6; i++) box(.06, .06, .02, M('#5fe0a8', { emissive: '#5fe0a8', emissiveIntensity: 1 }), x - .25, .5 + i * .3, z + .46); }
  function softbox(x, z) { cyl(.03, .03, 1.8, metal, x, .9, z, 6); box(.9, .9, .3, M('#fafafa', { emissive: '#ffffff', emissiveIntensity: .4 }), x, 2.0, z).rotation.x = .3; }
  function lamp(r) { const m = M('#f6f1e6', { emissive: '#ffcf80', emissiveIntensity: 0 }); const d = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, .06, 24), m); d.position.set(r.cx, 3.3, r.cz); scene.add(d); lamps.push({ mat: m }); }

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
      case 'social': { cyl(.03, .03, 1.7, metal, cx, .85, farZ, 8); const ring = new THREE.Mesh(new THREE.TorusGeometry(.42, .05, 8, 32), M('#ffffff', { emissive: '#ffffff', emissiveIntensity: .8 })); ring.position.set(cx, 1.85, farZ); scene.add(ring); sofa(cx - 3.5, farZ, top ? 0 : Math.PI, '#36507a'); plant(cx + 5, farZ); break; }
      case 'perf': rack(cx + 5, r.cz - 4.9); plant(cx - 5, farZ, 1.1); standScreen(cx, farZ); break;
      case 'lead': box(5, .9, .1, champagne, cx, 2.0, r.cz - 5.75); sofa(cx - 3.2, farZ, Math.PI, '#d8cfc0'); sofa(cx + 3.2, farZ, Math.PI, '#d8cfc0'); box(1.4, .4, .8, M('#3a2a20', { roughness: .35 }), cx, .2, farZ); plant(cx - 5.3, r.cz - 5.2, 1.2); plant(cx + 5.3, r.cz - 5.2, 1.2); break;
      case 'warroom': wallScreen(cx - 3.4, 2.4, 1.5, 'bars', '#ff8fa3'); wallScreen(cx, 2.8, 1.7, 'line', '#d8c3a5'); wallScreen(cx + 3.4, 2.4, 1.5, 'bars', '#5fb7ff'); break;
      case 'screens': if (top) { wallScreen(cx - 2, 2.6, 1.5); wallScreen(cx + 2, 2.6, 1.5); } else { standScreen(cx - 2.6, farZ); standScreen(cx + 2.6, farZ); } plant(cx + 5.3, farZ); break;
      case 'ticker': wallScreen(cx, 5, 1.4, 'line', '#e1b452'); plant(cx - 5.3, farZ); plant(cx + 5.3, farZ); break;
      case 'servers': [-4.6, -3.4, 4.6].forEach(dx => rack(cx + dx, farZ)); standScreen(cx + .4, farZ); break;
      case 'shelves': shelf(cx - 4, top ? -14.6 : farZ + .4); shelf(cx + 4, top ? -14.6 : farZ + .4); if (!occ.includes(3)) plant(seatOf(r, 3).x, seatOf(r, 3).z + 1); break;
      case 'photo': { const sweep = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3, 24, 1, true, Math.PI, Math.PI / 2), M('#f7f7f7', { side: THREE.DoubleSide, roughness: .9 })); sweep.position.set(cx, 1.6, -13.4); sweep.rotation.z = Math.PI / 2; scene.add(sweep);
        cyl(.35, .35, .9, M('#1c1c1c'), cx, .45, -13.3, 20); const ring = new THREE.Mesh(new THREE.TorusGeometry(.18, .04, 10, 28), champagne); ring.position.set(cx, 1.1, -13.3); scene.add(ring); softbox(cx - 5, -13.6); softbox(cx + 5, -13.6); break; }
      case 'reels': { [-1, 1].forEach(sd => { box(.04, 1.4, .04, metal, cx + sd * .25, .7, -12.8).rotation.z = sd * .2; }); box(.5, .3, .35, M('#1c1c1c'), cx, 1.45, -12.8); cyl(.1, .12, .3, M('#333'), cx, 1.45, -12.55, 12).rotation.x = Math.PI / 2;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.42, .05, 8, 32), M('#ffffff', { emissive: '#ffffff', emissiveIntensity: .8 })); ring.position.set(cx + 4.8, 1.85, -13.8); scene.add(ring); cyl(.03, .03, 1.7, metal, cx + 4.8, .85, -13.8, 8); box(2, 1.6, .1, M('#d9603b'), cx - 4.4, 1.2, -14.8); break; }
      case 'moodboard': box(3.2, 1.8, .08, M('#ffffff'), cx, 1.6, farZ); ['#1c1c1c', '#d8c3a5', '#e2d1c3', '#b08d57', '#8a5a3c', '#f4efe6'].forEach((c, i) => box(.8, .6, .02, M(c), cx - 1.05 + (i % 3) * 1.05, 1.95 - Math.floor(i / 3) * .7, farZ - .06)); box(.08, .8, .08, metal, cx, .4, farZ); plant(cx + 5.2, farZ); break;
    }
  });
  Object.values(B).forEach(b => { for (let x = b.ox - b.half + 3; x < b.ox + b.half; x += 12) plant(x, -2.2, .8); });

  /* ---------- people ---------- */
  const eyeM = M('#111111'), badgeM = M('#d8c3a5', { metalness: .8, roughness: .3 }), folderM = M('#d8c3a5', { roughness: .4 });
  const G = { leg: new THREE.CapsuleGeometry(.085, .62, 4, 8), shoe: new THREE.BoxGeometry(.14, .08, .26), torso: new THREE.CapsuleGeometry(.2, .42, 4, 12), arm: new THREE.CapsuleGeometry(.06, .46, 4, 8), hand: new THREE.SphereGeometry(.065, 10, 8), neck: new THREE.CylinderGeometry(.07, .08, .1, 10), head: new THREE.SphereGeometry(.17, 20, 16), hair: new THREE.SphereGeometry(.182, 20, 12, 0, Math.PI * 2, 0, Math.PI * .52), eye: new THREE.SphereGeometry(.022, 8, 6), ring: new THREE.RingGeometry(.42, .52, 32), quest: new THREE.OctahedronGeometry(.22) };
  people.forEach(p => {
    const g = new THREE.Group(), sk = M(p.skin, { roughness: .6 }), shirt = M(p.shirt, { roughness: .75 }), pants = M(p.human ? '#1c1c1c' : '#3a4152', { roughness: .8 }), hair = M(p.hair, { roughness: .9 }), shoe = M('#17181b', { roughness: .5 });
    const mk = (geo, mat, x, y, z, parent) => { const m = sh(new THREE.Mesh(geo, mat)); m.position.set(x, y, z); m.userData.person = p; (parent || g).add(m); return m; };
    const legs = [-1, 1].map(sd => { const pv = new THREE.Group(); pv.position.set(.11 * sd, .9, 0); g.add(pv); mk(G.leg, pants, 0, -.42, 0, pv); mk(G.shoe, shoe, 0, -.85, .05, pv); return pv; });
    mk(G.torso, shirt, 0, 1.25, 0).scale.z = .7;
    const arms = [-1, 1].map(sd => { const pv = new THREE.Group(); pv.position.set(.27 * sd, 1.48, 0); g.add(pv); mk(G.arm, shirt, 0, -.27, 0, pv); mk(G.hand, sk, 0, -.56, 0, pv); return pv; });
    mk(G.neck, sk, 0, 1.6, 0); mk(G.head, sk, 0, 1.79, 0); mk(G.hair, hair, 0, 1.81, -.015).rotation.x = -.25;
    [-1, 1].forEach(sd => mk(G.eye, eyeM, .06 * sd, 1.8, .155));
    if (p.human) mk(new THREE.BoxGeometry(.08, .1, .02), badgeM, .1, 1.36, .145);
    const ring = new THREE.Mesh(G.ring, new THREE.MeshBasicMaterial({ color: STATUS_COL.idle, transparent: true, opacity: .85 })); ring.rotation.x = -Math.PI / 2; ring.position.y = .03; scene.add(ring);
    const folder = mk(new THREE.BoxGeometry(.32, .04, .24), folderM, .3, 1.0, .25); folder.visible = false;
    const qm = new THREE.Mesh(G.quest, new THREE.MeshStandardMaterial({ color: '#e1c38f', emissive: '#b08d57', emissiveIntensity: .8, metalness: .6, roughness: .25 })); qm.scale.y = 1.5; qm.visible = false; scene.add(qm);
    scene.add(g); Object.assign(p, { g, legs, arms, ring, folder, qm });
  });

  /* ---------- HUD layer ---------- */
  const roomLabels = Object.values(R).map(r => { const d = document.createElement('button'); d.type = 'button'; d.className = 'room-label'; d.textContent = r.name; d.onclick = () => flyTo(r.id); labels.appendChild(d); r.lbl = d; return r; });
  people.forEach(p => { const t = document.createElement('div'); t.className = 'tag' + (p.human ? ' human' : ''); t.textContent = p.name.replace(' AI', ''); t.hidden = true; labels.appendChild(t); p.tag = t;
    const b = document.createElement('div'); b.className = 'bubble'; b.hidden = true; labels.appendChild(b); p.bub = b; });
  const v3 = new THREE.Vector3();
  const project = (x, y, z) => { v3.set(x, y, z).project(camera); return { x: (v3.x + 1) / 2 * canvas.clientWidth, y: (1 - v3.y) / 2 * canvas.clientHeight, front: v3.z < 1 }; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Labels are placed greedily and anything that would overlap an earlier one is skipped, so the view never gets crowded.
  const placed = [];
  const free = (x, y, w, h) => { if (placed.some(b => Math.abs(b.x - x) < (b.w + w) / 2 && Math.abs(b.y - y) < (b.h + h) / 2)) return false; placed.push({ x, y, w, h }); return true; };
  function hud() {
    placed.length = 0;
    // keep clear of the page's own overlays (mission card, place chips, buttons)
    if (o.avoid) { const hr = host.getBoundingClientRect(); for (const el of o.avoid()) { if (!el || el.hidden) continue; const r = el.getBoundingClientRect(); if (r.width) placed.push({ x: r.left - hr.left + r.width / 2, y: r.top - hr.top + r.height / 2, w: r.width + 8, h: r.height + 8 }); } }
    const dist = camera.position.distanceTo(controls.target), W = canvas.clientWidth, H = canvas.clientHeight, close = dist < 24;
    const onScreen = s => s.front && s.x > 0 && s.x < W && s.y > 40 && s.y < H;
    // speech first: selected person, then talking over thinking, then nearest the middle of the view
    const maxBubbles = dist < 30 ? 6 : dist < 70 ? 4 : 3, cx = W / 2, cy = H / 2;
    const talk = people.filter(p => p.bubble).map(p => ({ p, s: project(p.x, p.sitting ? 1.75 : 2.15, p.z) })).filter(o => onScreen(o.s))
      .sort((a, b) => (b.p === sel) - (a.p === sel) || (a.p.bubbleKind === 'thinking') - (b.p.bubbleKind === 'thinking') || Math.hypot(a.s.x - cx, a.s.y - cy) - Math.hypot(b.s.x - cx, b.s.y - cy));
    const shown = new Set();
    for (const { p, s } of talk) {
      if (shown.size >= maxBubbles) break;
      const compact = dist > 60 && p !== sel, w = compact ? 170 : 230, h = compact ? 40 : 64;
      const bx = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, s.x));
      if (!free(bx, s.y - 14 - h / 2, w, h)) continue;
      shown.add(p);
      const key = (compact ? 'c' : 'f') + p.bubble;
      if (p.bub._t !== key) { p.bub.innerHTML = `<span class="who">${esc(p.name)}</span>${esc(compact && p.bubble.length > 60 ? p.bubble.slice(0, 57) + '…' : p.bubble)}`; p.bub._t = key; }
      p.bub.className = 'bubble ' + p.bubbleKind + (compact ? ' compact' : ''); p.bub.style.left = bx + 'px'; p.bub.style.top = (s.y - 14) + 'px'; p.bub.hidden = false;
    }
    people.forEach(p => { if (!shown.has(p)) p.bub.hidden = true; });
    people.forEach(p => { const s = project(p.x, p.sitting ? 1.75 : 2.15, p.z);
      const want = onScreen(s) && !shown.has(p) && (close || p === sel || (p.human && p.quest));
      const show = want && free(s.x, s.y - 16, p.name.length * 6.6 + 16, 20);
      p.tag.hidden = !show; if (show) { p.tag.style.left = s.x + 'px'; p.tag.style.top = (s.y - 8) + 'px'; } });
    roomLabels.forEach(r => { const s = project(r.cx, 3.4, r.row ? r.cz + 5.6 : r.cz - 5.6);
      const show = dist < 75 && onScreen(s) && free(s.x, s.y, r.name.length * 7.5 + 24, 24);
      r.lbl.hidden = !show; if (show) { r.lbl.style.left = s.x + 'px'; r.lbl.style.top = s.y + 'px'; } });
  }

  /* ---------- picking ---------- */
  const ray = new THREE.Raycaster(), mv = new THREE.Vector2(); let down = null;
  const onDown = e => { down = [e.clientX, e.clientY]; };
  const onUp = e => { if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; const r = canvas.getBoundingClientRect(); mv.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(mv, camera);
    const hit = ray.intersectObjects(people.map(p => p.g), true).find(h => h.object.userData.person); if (!hit) return; const p = hit.object.userData.person;
    if (p.human && p.quest && o.onApproverClick) o.onApproverClick(p); else select(p.id); };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp);
  controls.addEventListener('start', () => { fly = null; follow = null; });

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
    g.position.set(p.x, 0, p.z);
    if (p.sitting) { g.position.y = -.4; g.position.z = p.z - .05; g.rotation.y = 0; p.legs.forEach(l => { l.rotation.x = -Math.PI / 2 + .1; }); p.arms.forEach((a, i) => { a.rotation.x = -.9 + (p.status === 'thinking' ? Math.sin(t * 9 + i * 3) * .12 : 0); }); }
    else { g.position.y = walking ? Math.abs(Math.sin(t * 9 + p.phase)) * .04 : 0;
      const face = !walking && p.faceTo ? Math.atan2(p.faceTo.x - p.x, p.faceTo.z - p.z) : p.heading;
      g.rotation.y += ((((face - g.rotation.y) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI) * .2;
      const sw = walking ? Math.sin(t * 9 + p.phase) * .6 : 0; p.legs[0].rotation.x = sw; p.legs[1].rotation.x = -sw; p.arms[0].rotation.x = p.carry ? -1.1 : -sw * .8; p.arms[1].rotation.x = sw * .8 + (p.status === 'talking' ? Math.sin(t * 5) * .3 - .3 : 0); }
    p.folder.visible = p.carry && !p.sitting;
    p.ring.position.set(p.x, .03, p.z); p.ring.material.color.set(STATUS_COL[p.status] || STATUS_COL.idle);
    p.qm.visible = p.quest; if (p.quest) { p.qm.position.set(p.x, (p.sitting ? 2.6 : 3) + Math.sin(t * 3) * .12, p.z); p.qm.rotation.y = t * 2; }
  }

  /* ---------- loop ---------- */
  let last = performance.now(), T = 0, visible = true;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!paused) { T += dt * speed; people.forEach(p => step(p, dt * speed)); }
    if (!visible) return;
    people.forEach(p => pose(p, T));
    flags.forEach((f, i) => { f.rotation.y = Math.sin(T * 2 + i) * .25; });
    if (fly) { fly.t = Math.min(1, fly.t + dt * 1.1); const k = 1 - Math.pow(1 - fly.t, 3); controls.target.lerpVectors(fly.ft, fly.tt, k); camera.position.lerpVectors(fly.fp, fly.tp, k); if (fly.t >= 1) fly = null; }
    else if (follow && !follow.sitting) { const d = new THREE.Vector3(follow.x, 0, follow.z).sub(controls.target).multiplyScalar(.06); controls.target.add(d); camera.position.add(d); }
    controls.update(); renderer.render(scene, camera); hud();
  }
  function resize() { const fs = document.fullscreenElement === host, w = host.clientWidth || 800, h = fs ? host.clientHeight : Math.max(460, Math.min(innerHeight - 150, w * .72)); renderer.setSize(w, h, false); canvas.style.height = h + 'px'; camera.aspect = w / h; camera.updateProjectionMatrix(); }
  resize(); raf = requestAnimationFrame(frame);

  /* ---------- camera moves for buttons and keys ---------- */
  const sphere = new THREE.Spherical(), off = new THREE.Vector3();
  function orbit(dTheta, dPhi, scale = 1) {
    fly = null; follow = null; off.copy(camera.position).sub(controls.target); sphere.setFromVector3(off);
    sphere.theta += dTheta; sphere.phi = Math.min(controls.maxPolarAngle, Math.max(controls.minPolarAngle, sphere.phi + dPhi));
    sphere.radius = Math.min(controls.maxDistance, Math.max(controls.minDistance, sphere.radius * scale));
    off.setFromSpherical(sphere); camera.position.copy(controls.target).add(off);
  }
  function pan(right, forward) {
    fly = null; follow = null; const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; f.normalize();
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
  document.addEventListener('fullscreenchange', () => setTimeout(resize, 50));

  /* ---------- public API ---------- */
  function sleep(ms) { return new Promise(res => { let left = ms, l = performance.now(); (function st() { const n = performance.now(); if (!paused) left -= (n - l) * speed; l = n; left <= 0 ? res() : setTimeout(st, 80); })(); }); }
  function select(id) { sel = P[id] || null; follow = sel; o.onSelect && sel && o.onSelect(sel); }
  function flyTo(id) {
    follow = null; let tgt, pos;
    if (!id) { tgt = CAMPUS_VIEW.target; pos = CAMPUS_VIEW.pos; }
    else if (B[id]) { const b = B[id]; tgt = [b.ox, 0, 1]; pos = [b.ox + 4, b.cols * 9 + 6, b.cols * 9 + 16]; }
    else if (R[id]) { const r = R[id]; tgt = [r.cx, 0, r.cz]; pos = [r.cx + 3, 13, r.cz + 15]; }
    else return;
    fly = { t: 0, ft: controls.target.clone(), fp: camera.position.clone(), tt: new THREE.Vector3(...tgt), tp: new THREE.Vector3(...pos) };
  }
  function setNight(n) {
    night = n; const sky = new THREE.Color(n ? SKY_NIGHT : SKY_DAY); scene.background = sky; scene.fog.color = sky;
    sun.intensity = n ? .1 : 2.1; sun.color.set(n ? '#9fb7ff' : '#fff1d6'); hemi.intensity = n ? .12 : .75; hemi.color.set(n ? '#6d7fb0' : '#e3f0ff');
    lamps.forEach(l => { if (l.isLight) l.intensity = n ? 2.2 : 0; else l.mat.emissiveIntensity = n ? 1.3 : 0; });
    screens.forEach(s => { s.emissiveIntensity = n ? 1.0 : (s.map && s.map.image && s.map.image.width === 1024 ? 0 : .55); }); renderer.toneMappingExposure = n ? 1.1 : 1.05;
  }
  const api = {
    people, byId: P, rooms: R, buildings: B, sleep,
    get paused() { return paused; }, setPaused(v) { paused = v; }, get speed() { return speed; }, setSpeed(v) { speed = v; },
    get night() { return night; }, setNight, flyTo, select, orbit, pan,
    turn(deg) { orbit(deg * Math.PI / 180, 0); }, tilt(deg) { orbit(0, deg * Math.PI / 180); }, zoom(f) { orbit(0, 0, f); },
    fullscreen() { return document.fullscreenElement ? document.exitFullscreen() : host.requestFullscreen?.(); }, get selected() { return sel; }, resize,
    setVisible(v) { visible = v; if (v) resize(); },
    async walkTo(id, toId) { const p = P[id], b = P[toId]; if (!p || !b) return; p.status = 'walking'; p.task = `Walking to ${b.name}`; p.faceTo = null; const s = standBy(b); await goTo(p, s.x, s.z); p.room = roomAt(s.x, s.z) || p.room; p.faceTo = b; },
    async walkHome(id) { const p = P[id]; if (!p) return; p.status = 'walking'; p.faceTo = null; await goTo(p, p.home.x, p.home.z); p.room = p.homeRoom; p.sitting = true; p.status = rest(p); p.task = p.quest ? 'Waiting on an approval' : 'Waiting for the next job'; p.carry = false; },
    async say(id, text, kind = 'talking', ms = 2600) { const p = P[id]; if (!p) return; p.status = 'talking'; p.bubble = text; p.bubbleKind = kind; p.log.unshift(text); p.log.length = Math.min(p.log.length, 3); await sleep(ms + text.length * 20); if (p.bubble === text) p.bubble = null; p.status = rest(p); },
    async think(id, text, ms = 2600) { const p = P[id]; if (!p) return; p.status = 'thinking'; p.task = text; p.bubble = text + '…'; p.bubbleKind = 'thinking'; p.log.unshift(text); p.log.length = Math.min(p.log.length, 3); await sleep(ms); if (p.bubble === text + '…') p.bubble = null; p.status = rest(p); },
    setCarry(id, v) { if (P[id]) P[id].carry = v; },
    setQuest(id, v) { const p = P[id]; if (!p) return; p.quest = v; if (p.sitting && !p.bubble) p.status = v ? 'waiting' : 'idle'; p.task = v ? 'Waiting on an approval' : 'Nothing waiting'; },
    dispose() { cancelAnimationFrame(raf); canvas.removeEventListener('keydown', onKey); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); controls.dispose(); renderer.dispose(); labels.innerHTML = ''; },
  };
  setNight(false);
  return api;
}

function mix(a, b, t) { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const c = k => Math.round(((pa >> k) & 255) * (1 - t) + ((pb >> k) & 255) * t); return '#' + ((1 << 24) + (c(16) << 16) + (c(8) << 8) + c(0)).toString(16).slice(1); }
