// The 3D Parakkat campus. Framework-free so the same file runs in the Next.js app and the prototype page.
// THREE and OrbitControls are passed in, so the caller decides how three.js is loaded.
//
// The streets, traffic, flats, hills and sky around it live in world.mjs.
//
// Speed: everything that never moves is merged into one mesh per material after the scene is built, each person is five
// meshes, shadows refresh every third frame, and labels are placed every other frame. If frames still run slow the
// renderer lowers its resolution and then drops shadows.

import { buildWorld, istHours } from './world.mjs';
import { createLandscape } from './landscape.mjs';
import { createCampusMaterials } from './materials.mjs';
import { aroundMeetingTable } from './meeting-paths.mjs';
import { createDirectDialogueController, dialogueBubble, dialogueDuration } from './direct-dialogue.mjs';
import { normalizeWorkStatuses, agentWorkStatus, layoutWorkStatuses } from './work-status.mjs';
import { isWorkingStatus } from '../lib/agents/activity-core.mjs';

export const DEPT_COLOR = {
  board: '#b08d57', insights: '#3d6fb0', intel: '#6c4fb3', strategy: '#2b8a64', creative: '#b23a4c', social: '#d07a1f',
  perf: '#23807a', seo: '#4f8a2b', lead: '#1c1c1c', warroom: '#6f3fa0', customer: '#2f7fa8', goldrate: '#b8913f', datahub: '#4a5568',
  forecast: '#3f8f7a', qa: '#8a6a3a', photo: '#c4566a', reels: '#d9603b', catalog: '#8a5a9e', lang: '#3a8f5c', crm: '#2b6cb0', brand: '#a8865a',
};
const SKIN = ['#f0c9a4', '#d7a47c', '#b77d57', '#8c5a3c'];
const HAIR = ['#231812', '#4a2f1e', '#7b5434', '#1d1d24', '#b9b2a8', '#3a2a1c'];
const STATUS_COL = { idle: '#4b8fe0', thinking: '#e89a3c', talking: '#35b07c', walking: '#35b07c', waiting: '#d8b27a' };
const SEAT = [[-3, -2.6], [3, -2.6], [-3, 2.2], [3, 2.2], [0, 2.2]];
const WH = 3.8;
const CAMPUS_VIEW = { pos: [-3, 104, 110], target: [-6, 0, 5] };
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
 * @param {(meeting: any | null) => void} [o.onMeetingClick]  open the current meeting's discussion
 * @param {() => (HTMLElement | null)[]} [o.avoid]  overlay elements labels should not cover
 * @param {boolean} [o.fill]   true when the host has a fixed height the canvas should fill
 * @param {boolean} [o.night]  start in the evening look
 */
export function createOffice(o) {
  const { THREE, OrbitControls, canvas, labels, host, roster } = o;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let paused = false, speed = 1, night = false, sel = null, hovered = null, follow = null, fly = null, raf = 0, view = '3d', disposed = false;

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
  let workStatuses = Object.create(null);
  const workStatus = (p, now = Date.now()) => agentWorkStatus(p, workStatuses[p.id], now);
  Object.values(B).forEach(b => { b.people = people.filter(p => p.homeRoom.b === b); b.rooms = Object.values(R).filter(r => r.b === b).length; });
  // One shared table lives in the HQ Boardroom. Participants always come from real meeting data.
  const meetingRoom = R.board || Object.values(R)[0];
  const meetingPoint = { x: meetingRoom.cx + 1, z: meetingRoom.cz + 2.6 };
  const meetingSeats = Array.from({ length: 8 }, (_, i) => ({
    x: meetingPoint.x + [-.75, .75, -2.25, 2.25][Math.floor(i / 2)],
    z: meetingPoint.z + (i % 2 === 0 ? -1.65 : 1.65),
    heading: i % 2 === 0 ? 0 : Math.PI,
  }));
  let currentMeeting = null;

  /* ---------- renderer ---------- */
  THREE.ColorManagement.legacyMode = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(devicePixelRatio || 1, 1.5), quality = 2, shadowsOn = true;
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfdfeb'); scene.fog = new THREE.Fog('#cfdfeb', 140, 300); // the sky in world.mjs takes these over
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 1.5, 1000); // near plane well inside minDistance keeps depth precise at campus distance
  camera.position.set(...CAMPUS_VIEW.pos);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(...CAMPUS_VIEW.target); controls.enableDamping = true; controls.minPolarAngle = .08; controls.maxPolarAngle = 1.47; controls.minDistance = 6; controls.maxDistance = 330; controls.screenSpacePanning = false;
  // Map-style: drag moves across the campus, right-drag (or two fingers) turns and tilts, scroll or pinch zooms.
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.panSpeed = 1.2; controls.rotateSpeed = .7; controls.zoomSpeed = 1.1;
  const hemi = new THREE.HemisphereLight('#e3f0ff', '#8a7a5c', .75); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.1); sun.position.set(-40, 60, 34); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -85, right: 85, top: 50, bottom: -40, near: 1, far: 200 }); sun.shadow.bias = -.00025; sun.shadow.normalBias = .025; sun.shadow.radius = 2;
  scene.add(sun);

  /* ---------- helpers ---------- */
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stat = new THREE.Group(); scene.add(stat); // everything in here is merged once the campus is built
  const matCache = new Map();
  const M = (color, opt = {}) => { if (opt.map) return new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: 0, envMapIntensity: .14, ...opt }); const k = color + JSON.stringify(opt); if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: .7, metalness: 0, envMapIntensity: .14, ...opt })); return matCache.get(k); };
  const sh = m => { m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w, h, d, mat, x, y, z, parent) => { const m = sh(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); m.position.set(x, y, z); (parent || stat).add(m); return m; };
  const cyl = (rt, rb, h, mat, x, y, z, seg = 16, parent) => { const m = sh(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat)); m.position.set(x, y, z); (parent || stat).add(m); return m; };
  const flat = (w, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; stat.add(m); return m; };
  const tex = (draw, w = 256, h = 256, rep = [1, 1]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 4; return t; };
  const finish = createCampusMaterials({ THREE, tex, rnd });
  const landscape = createLandscape({ THREE, stat, M, tex, rnd, sh });
  const { tree, palm } = landscape;
  // A low-resolution studio sky supplies soft reflections to glass, stone and metal.
  // It is rendered once and is separate from the live time-of-day sky.
  const envScene = new THREE.Scene();
  const envShell = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 8), new THREE.MeshBasicMaterial({ color: '#a1b2b3', side: THREE.BackSide }));
  envScene.add(envShell);
  const envTop = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ color: '#f6f0df', side: THREE.DoubleSide }));
  envTop.rotation.x = Math.PI / 2; envTop.position.y = 6; envScene.add(envTop);
  const pmrem = new THREE.PMREMGenerator(renderer), environment = pmrem.fromScene(envScene, .04);
  scene.environment = environment.texture; pmrem.dispose(); envShell.geometry.dispose(); envShell.material.dispose(); envTop.geometry.dispose(); envTop.material.dispose();
  for (const material of [...Object.values(finish.materials), ...Object.values(finish.floorMaterials)]) material.envMapIntensity = .32;
  const screens = [], lamps = [], flags = [];
  const contactMap = tex((g, w, h) => { const r = g.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2); r.addColorStop(0,'rgba(20,24,22,.29)'); r.addColorStop(.5,'rgba(20,24,22,.16)'); r.addColorStop(1,'rgba(20,24,22,0)'); g.fillStyle=r; g.fillRect(0,0,w,h); }, 64, 64);
  const contactM = new THREE.MeshBasicMaterial({map:contactMap, transparent:true, depthWrite:false, toneMapped:false});
  const contact = (x,z,w,d,y=.055) => flat(w,d,contactM,x,y,z);
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
  const tint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .72, envMapIntensity: .12 }), _o = new THREE.Object3D();
  function colored(parts) {
    const g = mergeGeos(parts.map(([geo, color, x, y, z, rx = 0, s = [1, 1, 1]]) => { _o.position.set(x, y, z); _o.rotation.set(rx, 0, 0); _o.scale.set(...s); _o.updateMatrix(); return { geo, color, matrix: _o.matrix.clone() }; }), true);
    return sh(new THREE.Mesh(g, tint));
  }

  /* ---------- ground and landscape ---------- */
  const grass = tex((g, w, h) => { g.fillStyle = '#42633d'; g.fillRect(0, 0, w, h); for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${25 + rnd() * 40 | 0},${55 + rnd() * 55 | 0},${22 + rnd() * 26 | 0},.5)`; g.fillRect(rnd() * w, rnd() * h, 2, 3); } }, 256, 256, [50, 50]);
  flat(520, 520, M('#ffffff', { map: grass, roughness: 1 }), 0, -.32, 0);
  const pave = finish.materials.paving;
  flat(148, 17, pave, 0, -.29, 24.5); // plaza in front of all three buildings
  flat(208, 3, M('#bfb8ab', { roughness: .95 }), 0, -.29, 34.5); // pavement, stopping at the avenues
  box(208, .25, .3, M('#9c968b'), 0, -.2, 36);
  flat(1120, 8, finish.materials.asphalt, 0, -.3, 40); // road
  const dash = M('#e8e2cf'); for (let x = -550; x < 550; x += 7) if (Math.abs(Math.abs(x) - 110) > 7) flat(3.2, .22, dash, x, -.285, 40);
  box(208, .25, .3, M('#9c968b'), 0, -.2, 44); flat(208, 2.4, M('#bfb8ab', { roughness: .95 }), 0, -.29, 45.4);

  // woods behind and beside the campus, a tree line beyond the road
  for (let x = -108; x <= 108; x += 7) { tree(x + (rnd() - .5) * 4, -24 - rnd() * 4, .9 + rnd() * .5); tree(x + (rnd() - .5) * 4, -32 - rnd() * 6, 1 + rnd() * .5); }
  for (let z = -14; z <= 30; z += 7) [-1, 1].forEach(sd => { tree(sd * (78 + rnd() * 5), z, 1 + rnd() * .3); tree(sd * (88 + rnd() * 8), z + 3, 1.1 + rnd() * .4); });
  for (let x = -104; x <= 104; x += 8) { tree(x + rnd() * 3, 50 + rnd() * 3, .9 + rnd() * .5); if (rnd() > .4) tree(x + 4, 57 + rnd() * 4, 1 + rnd() * .4); }

  // plaza: hedges along the building fronts, planters, palms, lamp posts and the fountain
  const soil = M('#4b4536', { roughness: 1 }), stone = finish.materials.stone, post = finish.materials.frame;
  const bulb = M('#fff4dc', { emissive: '#ffcf80', emissiveIntensity: 0 }); lamps.push({ mat: bulb });
  const glowAt = [];
  Object.values(B).forEach(b => {
    const x1 = b.ox - b.half, x2 = b.ox + b.half;
    [[x1 + 1, b.ox - 4], [b.ox + 4, x2 - 1]].forEach(([a, c]) => { landscape.hedge(c - a, 1.1, (a + c) / 2, 16.4, 1.0); box(c - a, .35, 1.6, stone, (a + c) / 2, -.12, 16.4); });
    for (let x = x1 + 3; x < x2 - 2; x += 6) if (Math.abs(x - b.ox) > 5) { box(2.2, .5, 2.2, stone, x, .05, 19.6); flat(1.9, 1.9, soil, x, .34, 19.6); plant(x, 19.6, .9); }
  });
  [0, 1, 2].forEach(i => box(7.6 - i * .8, .16, 1, stone, 0, -.22 + i * .14, 17.6 - i * .6)); // front steps of HQ
  for (let x = -78; x <= 66; x += 12) { if (Math.abs(x) < 8) continue; cyl(.09, .12, 4.4, post, x, 1.9, 31.4, 8).castShadow = false; box(.7, .12, .7, post, x, 4.15, 31.4).castShadow = false; cyl(.22, .22, .25, bulb, x, 3.95, 31.4, 10); glowAt.push([x, 3.9, 31.4]); }
  [-1, 1].forEach(sd => {
    [[17, 28], [56, 28]].forEach(([x,z]) => {
      box(7.5,.45,4.8,stone,sd*x,-.08,z); flat(7.0,4.3,soil,sd*x,.16,z);
      palm(sd*(x-1.4),z,.96); palm(sd*(x+1.5),z+.8,.72);
      landscape.hedge(6.6,1.0,sd*x,z+1.6,.65);
    });
    // Low planted borders frame the promenade without closing the entry paths.
    [[9,40], [45,72]].forEach(([a,b]) => { const x=sd*(a+b)/2; box(b-a,.36,1.8,stone,x,-.10,32.1); landscape.hedge(b-a-.5,1.4,x,32.1,.85); });
  });
  cyl(4.6, 4.9, .6, stone, 0, 0, 24, 40); const water = cyl(4.15, 4.15, .1, M('#3f8fbd', { roughness: .08, metalness: .25 }), 0, .32, 24, 40); water.castShadow = false;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(4.45,.18,8,64),stone); rim.rotation.x=Math.PI/2; rim.position.set(0,.35,24); stat.add(rim);
  const rippleM = M('#b2e0e8',{transparent:true,opacity:.24,roughness:.22,depthWrite:false});
  for(const r of [1.2,2.1,3.05,3.7]){const ring=new THREE.Mesh(new THREE.RingGeometry(r,r+.035,64),rippleM);ring.rotation.x=-Math.PI/2;ring.position.set(0,.38,24);stat.add(ring)}
  const sprayM = M('#d4edf0',{transparent:true,opacity:.54,roughness:.12,depthWrite:false});
  for(let i=0;i<8;i++) { const a=i*Math.PI/4, c=Math.cos(a), d=Math.sin(a); const arc=new THREE.CatmullRomCurve3([new THREE.Vector3(0,2.2,24),new THREE.Vector3(c*.85,2.85,24+d*.85),new THREE.Vector3(c*1.7,2.35,24+d*1.7),new THREE.Vector3(c*2.55,.40,24+d*2.55)]);stat.add(new THREE.Mesh(new THREE.TubeGeometry(arc,14,.027,5,false),sprayM)); }
  cyl(.55, .75, 1.4, stone, 0, .9, 24, 20); cyl(1.5, 1.2, .25, stone, 0, 1.7, 24, 24); const jet = cyl(.08, .3, 1.6, M('#d9f0fb', { transparent: true, opacity: .7, roughness: .1 }), 0, 2.6, 24, 10); jet.castShadow = false;
  const flagTex = tex((g, w, h) => { g.fillStyle = '#1c1c1c'; g.fillRect(0, 0, w, h); g.fillStyle = '#d8c3a5'; g.font = '600 34px Montserrat, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('P', w / 2, h / 2 + 12); g.fillRect(0, h - 10, w, 4); }, 128, 96);
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: .8 }), flagGeo = new THREE.PlaneGeometry(2, 1.4);
  [-6, 6].forEach(x => { cyl(.06, .06, 7, M('#c9c9c9', { metalness: .8, roughness: .3 }), x, 3.2, 20.5, 8); const f = new THREE.Mesh(flagGeo, flagMat); f.position.set(x + 1, 6, 20.5); f.castShadow = true; scene.add(f); flags.push(f); });

  /* ---------- floors ---------- */
  const corridorTex = tex((g, w, h) => { g.fillStyle = '#e8e5de'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,.07)'; for (let i = 0; i < w; i += 64) g.fillRect(i, 0, 2, h); g.fillRect(0, h / 2, w, 2); }, 256, 64, [12, 1]);
  const corridorM = M('#fff', { map: corridorTex, roughness: .5 });
  // the runner's champagne edging is painted into its texture: thin strips of geometry break into dashes from afar
  const runnerTex = tex((g, w, h) => { g.fillStyle = '#1c1c1c'; g.fillRect(0, 0, w, h); g.fillStyle = '#d8c3a5'; g.fillRect(0, h * .02, w, h * .075); g.fillRect(0, h * .905, w, h * .075); }, 64, 128);
  const runnerM = M('#fff', { map: runnerTex, roughness: .9 });

  /* ---------- buildings ---------- */
  const { plaster, frame: frameM, champagne, glass } = finish.materials, plinth = finish.materials.stone;
  const warmStrip = M('#fff0d1', { emissive:'#ffd99a', emissiveIntensity:.15 }); lamps.push({mat:warmStrip,on:1.8});
  const pane = (x1, z1, x2, z2, h = WH) => {
    const len = Math.hypot(x2 - x1, z2 - z1); if (len < .05) return; const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, ang = Math.atan2(z2 - z1, x2 - x1);
    const g = new THREE.Mesh(new THREE.BoxGeometry(len, h, .06), glass); g.position.set(cx, h / 2, cz); g.rotation.y = -ang; stat.add(g);
    box(len, .08, .1, frameM, cx, h, cz).rotation.y = -ang; box(len, .1, .1, frameM, cx, .05, cz).rotation.y = -ang;
    box(.10, h, .12, frameM, x1, h / 2, z1); box(.10, h, .12, frameM, x2, h / 2, z2);
    // Thin mullions divide broad panes; the glazed room dividers stay visually open.
    const sections = Math.ceil(len / 3.2);
    for (let j=1;j<sections;j++) box(.055,h,.085,frameM,x1+(x2-x1)*j/sections,h/2,z1+(z2-z1)*j/sections);
    box(len,.035,.065,champagne,cx,.84,cz).rotation.y=-ang;
  };
  roster.BUILDINGS.forEach(b0 => {
    const b = B[b0.id], { ox, half } = b, W = half * 2;
    box(W + 2, .42, 32, plinth, ox, -.21, 0);
    box(W + 2.3, .10, 32.3, plaster, ox, -.025, 0);
    contact(ox,0,W+4.5,34.6,-.285);
    // floor layers sit a few centimetres apart: closer than that, they flicker against each other from the campus view
    flat(W, 6, corridorM, ox, .04, 0);
    flat(W - 1, 1.6, runnerM, ox, .07, 0);
    box(W + .4, WH, .3, plaster, ox, WH / 2, -15.15);
    [-1, 1].forEach(sd => { box(.3, WH, 12.3, plaster, ox + sd * (half + .15), WH / 2, -9.15); box(.3, WH, 12.3, plaster, ox + sd * (half + .15), WH / 2, 9.15); });
    pane(ox - half, 15, ox - 3, 15, 1.65); pane(ox + 3, 15, ox + half, 15, 1.65);
    // Cutaway front keeps the desks visible; substantial end piers and coping read as a real building.
    for (const sd of [-1,1]) {
      box(.48,WH,.48,plaster,ox+sd*half,WH/2,15);
      box(.46,.14,30.4,plaster,ox+sd*(half+.15),WH+.06,0);
      box(.12,.18,30,stone,ox+sd*(half-.12),.14,0);
    }
    box(W+.7,.22,.6,plaster,ox,WH+.10,-15.15);
    box(W,.16,.16,stone,ox,.12,-14.94);
    box(W-.8,.06,.08,warmStrip,ox,WH-.23,-14.95);
    for(let c=0;c<b.cols;c++) {
      const cx=ox-half+6+12*c;
      box(.4,WH,.45,plaster,ox-half+12*c,WH/2,-15.05);
      // Oak feature panels and shallow perimeter cabinets add depth at the back of each room.
      box(3.7,2.2,.04,finish.floorMaterials.wood,cx,1.65,-14.975);
      box(3.9,.68,.60,finish.materials.desk,cx,.35,-14.54);
      box(3.9,.045,.65,stone,cx,.72,-14.54);
      for(let k=-1;k<=1;k++) box(.025,.60,.02,champagne,cx+k*1.25,.35,-14.22);
      box(.9,.085,.12,warmStrip,cx,2.95,-14.70);
    }
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
    flat(len + .6, 1.6, runnerM, cx, .03, 0);
    [-9, 9].forEach(z => { box(len - 1.2, .5, 9, stone, cx, -.05, z); flat(len - 1.8, 8.4, soil, cx, .24, z); plant(cx, z - 2.5, 1.1); plant(cx, z + 2.5, .9); });
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
  const deskTop = finish.materials.desk, metal = finish.materials.frame, fabric = finish.materials.fabric, white = M('#ebebeb'), mug = M('#ffffff', { roughness: .3 });
  const screenGeo = new THREE.PlaneGeometry(1.02, .58);
  function desk(x, z) {
    contact(x,z+.6,3.9,3.6);
    box(.53,.57,.72,white,x+1.0,.34,z+1.04);
    for(const y of [.30,.48]) box(.25,.025,.025,metal,x+1.0,y,z+.66);
    box(1.1,.012,.55,M('#495350',{roughness:.96}),x,.795,z+.86);
    box(2.6, .07, 1.2, deskTop, x, .75, z + .95); [[-1.2, .45], [1.2, .45], [-1.2, 1.45], [1.2, 1.45]].forEach(([a, c]) => box(.06, .72, .06, metal, x + a, .37, z + c));
    box(.08, .35, .08, metal, x, .95, z + 1.3); box(1.1, .66, .05, metal, x, 1.42, z + 1.3);
    const s = new THREE.Mesh(screenGeo.clone(), screenMat()); s.position.set(x, 1.42, z + 1.27); s.rotation.y = Math.PI; stat.add(s);
    box(.8, .03, .26, white, x, .8, z + .8); box(.12, .14, .12, mug, x - .9, .85, z + .9);
    for(const dx of [-.36,.36]) { box(.045,.33,.045,metal,x+dx,.65,z-.05); box(.10,.065,.44,fabric,x+dx,.84,z-.03); }
    box(.62, .1, .58, fabric, x, .5, z - .05); box(.62, .7, .1, fabric, x, .9, z - .38); cyl(.04, .04, .45, metal, x, .25, z - .05, 6); cyl(.32, .32, .04, metal, x, .07, z - .05, 10);
  }
  function plant(x, z, s = 1) {
    cyl(.32*s,.24*s,.65*s,pot,x,.32*s,z,16);
    cyl(.28*s,.28*s,.02,soil,x,.65*s,z,12);
    for(let i=0;i<8;i++) {
      const a=i*2.39996, y=(.92+(i%3)*.27)*s;
      const stem=cyl(.016*s,.025*s,y-.55*s,leafC,x,.55*s+(y-.55*s)/2,z,5); stem.rotation.z=Math.sin(a)*.22;
      const leaf=sh(new THREE.Mesh(new THREE.SphereGeometry(.28*s,10,6),i%2?leafC:leafD));
      leaf.scale.set(.56,1.85,.14); leaf.position.set(x+Math.cos(a)*.27*s,y,z+Math.sin(a)*.27*s);
      leaf.rotation.set(.5,a,.5); stat.add(leaf);
    }
  }
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

  const floorMat = finish.floorMaterials;
  Object.values(R).forEach(r => {
    const occ = people.filter(p => p.homeRoom === r).map(p => p.seat);
    const top = r.row === 0, farZ = top ? r.cz - 5.3 : r.cz + 5.3, cx = r.cx;
    [...new Set([0, 1, 2, 3, ...occ])].forEach(s => { if (occ.includes(s) || (s !== 3 && r.decor !== 'board')) { const p = seatOf(r, s); desk(p.x, p.z); } });
    if (!['board','lead','photo','reels','moodboard'].includes(r.decor)) {
      desk(cx,r.cz-2.6); desk(cx,r.cz+2.2);
    }
    flat(11.8, 11.8, floorMat[r.floor] || floorMat.oak, cx, .04, r.cz);
    lamp(r);
    switch (r.decor) {
      case 'board': box(6.7, .14, 2.2, finish.floorMaterials.wood, cx + 1, .78, r.cz + 2.6); box(5.8, .055, 2.25, champagne, cx + 1, .68, r.cz + 2.6);
        for (const dx of [-2.2, 2.2]) box(.28, .68, 1.5, metal, cx + 1 + dx, .34, r.cz + 2.6);
        for (const seat of meetingSeats) {
          const cf = M('#d8c3a5'), back = seat.heading === 0 ? -.35 : .35;
          box(.68, .10, .65, cf, seat.x, .5, seat.z);
          box(.68, .65, .12, cf, seat.x, .85, seat.z + back);
          cyl(.06, .06, .45, metal, seat.x, .25, seat.z, 8);
          cyl(.30, .30, .05, metal, seat.x, .06, seat.z, 12);
          box(.45, .025, .32, M('#eee7d8'), seat.x, .87, meetingPoint.z + (seat.heading === 0 ? -.65 : .65));
        }
        cyl(.32, .32, .055, metal, meetingPoint.x, .89, meetingPoint.z, 20);
        cyl(.09, .09, .055, led, meetingPoint.x, .93, meetingPoint.z, 12);
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
    flat(11.8, 11.8, floorMat.wood, cx, .04, cz); lamp({ cx, cz });
    sofa(cx - 2.6, farZ, row ? Math.PI : 0, '#2f5d50'); sofa(cx + 2.6, farZ, row ? Math.PI : 0, '#2f5d50');
    box(1.4, .4, .8, M('#3a2a20', { roughness: .35 }), cx, .2, cz + (row ? 2.4 : -2.4)); plant(cx - 5.2, cz); plant(cx + 5.2, cz, 1.2);
  } });
  Object.values(B).forEach(b => { for (let x = b.ox - b.half + 3; x < b.ox + b.half; x += 12) plant(x, -2.2, .8); });

  // roads, traffic, people, flats, hills and the sky around the campus (its static parts join the merge below)
  const world = buildWorld({ THREE, scene, stat, M, tex, colored, mix, lamps, rnd, sun, hemi, renderer, landscape });

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

  // Static meshes are merged; a lightweight invisible tabletop retains a precise click target.
  const meetingPick = new THREE.Mesh(new THREE.BoxGeometry(6.8, .35, 2.3), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
  meetingPick.position.set(meetingPoint.x, .8, meetingPoint.z); meetingPick.userData.meetingTable = true; scene.add(meetingPick);

  // lamp-post glow as one point cloud
  const glowTex = tex((g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,220,160,1)'); r.addColorStop(.25, 'rgba(255,200,130,.45)'); r.addColorStop(1, 'rgba(255,190,120,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }, 64, 64);
  const glowGeo = new THREE.BufferGeometry(); glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowAt.flat(), 3));
  const glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({ map: glowTex, size: 4.5, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.visible = false; scene.add(glow);
  const poolMap=tex((g,w,h)=>{const r=g.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);r.addColorStop(0,'rgba(255,202,120,.38)');r.addColorStop(.4,'rgba(255,188,94,.18)');r.addColorStop(1,'rgba(255,172,70,0)');g.fillStyle=r;g.fillRect(0,0,w,h)},64,64);
  const poolM=new THREE.MeshBasicMaterial({map:poolMap,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
  const lightPools=new THREE.Group(); scene.add(lightPools);
  for(const [x,,z] of glowAt){const pool=new THREE.Mesh(new THREE.PlaneGeometry(6.6,6.6),poolM);pool.rotation.x=-Math.PI/2;pool.position.set(x,-.268,z);lightPools.add(pool)}
  for(const b of Object.values(B))for(let i=0;i<b.cols;i++){const pool=new THREE.Mesh(new THREE.PlaneGeometry(9,8),poolM);pool.rotation.x=-Math.PI/2;pool.position.set(b.ox-b.half+6+12*i,.065,-11);lightPools.add(pool)}
  lightPools.visible=false;

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
  const meetingLabel = mkEl('button', 'room-label meeting-table-label'); meetingLabel.type = 'button';
  meetingLabel.textContent = 'Meeting table'; meetingLabel.setAttribute('aria-label', 'Open meeting table');
  meetingLabel.onclick = () => { focusMeeting(); o.onMeetingClick?.(currentMeeting); };
  people.forEach(p => {
    p.tag = mkEl('button', 'tag' + (p.human ? ' human' : '')); p.tag.type = 'button'; p.tag.title = `Open ${p.name}`; p.tag.dataset.agentId = p.id;
    p.tag.style.setProperty('--tag-accent', p.human ? '#cba66e' : DEPT_COLOR[p.dept] || '#4f9a7c');
    const avatar = document.createElement('span'); avatar.className = 'tag-avatar'; avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = p.name.trim().split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase();
    const name = document.createElement('span'); name.className = 'tag-name'; name.textContent = p.name;
    const arrow = document.createElement('span'); arrow.className = 'tag-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '↗';
    p.tag.replaceChildren(avatar, name, arrow);
    p.tag.setAttribute('aria-label', `Open ${p.name}`); p.tag.onclick = () => select(p.id);
    p.tag.onpointerenter = () => { hovered = p; }; p.tag.onpointerleave = () => { if (hovered === p && document.activeElement !== p.tag) hovered = null; };
    p.tag.onfocus = () => { hovered = p; }; p.tag.onblur = () => { if (hovered === p) hovered = null; };
    p.nameStem = mkEl('div', 'agent-name-stem'); p.nameStem.setAttribute('aria-hidden', 'true'); p.bub = mkEl('div', 'bubble');
    p.workTag = mkEl('button', 'agent-work'); p.workTag.type = 'button'; p.workTag.dataset.agentId = p.id;
    p.workTag.style.setProperty('--tag-accent', p.human ? '#cba66e' : DEPT_COLOR[p.dept] || '#4f9a7c');
    p.workTag.onclick = () => select(p.id); p.workStem = mkEl('div', 'agent-work-stem'); p.workStem.setAttribute('aria-hidden', 'true');
  });
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
  // Optional room/name labels can be skipped; current work always gets a visible card.
  const placed = []; let avoidRects = [], avoidAge = 99, cardsCompact = false;
  const free = (x, y, w, h) => { if (placed.some(b => Math.abs(b.x - x) < (b.w + w) / 2 && Math.abs(b.y - y) < (b.h + h) / 2)) return false; placed.push({ x, y, w, h }); return true; };
  function hud() {
    placed.length = 0;
    // keep clear of the page's own overlays; their positions are re-read twice a second, not every frame
    if (o.avoid && ++avoidAge > 15) { avoidAge = 0; const hr = host.getBoundingClientRect(); avoidRects = []; for (const el of o.avoid()) { if (!el || el.hidden) continue; const r = el.getBoundingClientRect(); if (r.width) avoidRects.push({ x: r.left - hr.left + r.width / 2, y: r.top - hr.top + r.height / 2, w: r.width + 8, h: r.height + 8 }); } }
    placed.push(...avoidRects);
    const dist = camera.position.distanceTo(controls.target), W = canvas.clientWidth, H = canvas.clientHeight;
    const currentWork = new Map(people.map(p => [p, workStatus(p)]));
    const onScreen = s => s.front && s.x > 0 && s.x < W && s.y > 30 && s.y < H;
    const xs = cards.map(k => project(k.b.ox, WH + .2, -15.2).x).sort((a, b) => a - b), gap = Math.min(...xs.slice(1).map((x, i) => x - xs[i]));
    const compact = gap < 276; if (compact !== cardsCompact) { cardsCompact = compact; cards.forEach(k => k.c.classList.toggle('compact', compact)); }
    for (const k of cards) {
      const a = project(k.b.ox, WH + .2, -15.2), top = project(k.b.ox, WH + (view === '2d' ? 2 : 7.5), -15.2), show = dist > 26 && onScreen(a);
      k.c.hidden = k.stem.hidden = !show; if (!show) continue;
      const busy = k.b.people.filter(p => !p.human && currentWork.get(p)).length;
      if (busy !== k.lastBusy) { k.lastBusy = busy; k.live.textContent = busy ? `${busy} working` : 'Open now'; }
      const cw = k.c.offsetWidth || 250, ch = k.c.offsetHeight || 88, cy = Math.min(top.y, a.y - 18);
      at(k.c, a.x, cy, 'translate(-50%,-100%)'); placed.push({ x: a.x, y: cy - ch / 2, w: cw + 8, h: ch + 8 });
      k.stem.style.height = Math.max(0, a.y - cy) + 'px'; at(k.stem, a.x, cy, 'translateX(-50%)');
    }
    const meetAt = project(meetingPoint.x, 2.7, meetingPoint.z);
    const meetShow = dist < 210 && onScreen(meetAt) && free(meetAt.x, meetAt.y - 10, currentMeeting ? 205 : 135, 28);
    meetingLabel.hidden = !meetShow;
    if (meetShow) at(meetingLabel, meetAt.x, meetAt.y - 10, 'translate(-50%,-100%)');
    // Persistent work and its current dialogue share a card. Every onscreen
    // active agent is placed, including those outside the old speech cap.
    const workCompact = dist > 70 || W < 680;
    const working = people.map(p => ({ p, status: currentWork.get(p), s: project(p.x, p.sitting ? 1.9 : 2.25, p.z) }))
      .filter(item => item.status && onScreen(item.s))
      .sort((a, b) => (b.p === sel) - (a.p === sel) || (b.p === hovered) - (a.p === hovered) || a.s.y - b.s.y || a.p.id.localeCompare(b.p.id));
    const workShown = new Set();
    const positions = layoutWorkStatuses(working.map(({ p, status, s }) => ({ id: p.id, p, status, x: s.x, y: s.y, anchorX: s.x, anchorY: s.y, w: workCompact ? 196 : 240, h: (workCompact ? 84 : 90) + (status.speech ? (workCompact ? 44 : 58) : 0) })), { width: W, height: H, obstacles: placed });
    for (const box of positions) {
      const { p, status } = box;
      const label = [status.label, status.workLabel].filter(Boolean).join(' · ');
      const key = JSON.stringify([workCompact, p.name, status.state, label, status.speech]);
      if (p.workTag._t !== key) {
        p.workTag._t = key; p.workTag.className = 'agent-work' + (workCompact ? ' compact' : '');
        p.workTag.dataset.state = status.state; p.workTag.dataset.source = status.source;
        p.workTag.innerHTML = `<span class="agent-work-name"><i aria-hidden="true"></i>${esc(p.name)}</span><span class="agent-work-label">${esc(label)}</span>${status.speech ? `<span class="agent-work-speech">“${esc(status.speech)}”</span>` : ''}`;
        p.workTag.title = `${p.name}: ${label}${status.speech ? ` — ${status.speech}` : ''}`;
        p.workTag.setAttribute('aria-label', `${p.name}: ${label}${status.speech ? `. Says: ${status.speech}` : ''}. Open agent.`);
      }
      p.workTag.style.width = box.w + 'px'; p.workTag.style.height = box.h + 'px';
      at(p.workTag, box.x, box.y, 'translate(-50%,-50%)'); p.workTag.hidden = false; workShown.add(p);
      const stemX = box.x, stemY = box.y + box.h / 2, dx = box.anchorX - stemX, dy = box.anchorY - stemY;
      p.workStem.style.height = Math.max(0, Math.hypot(dx, dy) - 3) + 'px';
      at(p.workStem, stemX, stemY, `rotate(${Math.atan2(-dx, dy)}rad)`); p.workStem.hidden = Math.hypot(dx, dy) < 8;
      placed.push({ x: box.x, y: box.y, w: box.w + 3, h: box.h + 3 });
    }
    for (const p of people) if (!workShown.has(p)) {
      p.workTag.hidden = true; p.workStem.hidden = true;
      if (p.workTag._t) { p.workTag.replaceChildren(); p.workTag.removeAttribute('title'); p.workTag.removeAttribute('aria-label'); p.workTag._t = null; }
    }
    // Preserve standalone speech for any non-work presentation. Active agents'
    // speech is already shown above with their retained work label.
    const maxBubbles = dist < 40 ? 10 : dist < 90 ? 7 : 5, cx = W / 2, cy = H / 2;
    const talk = people.filter(p => p.bubble && !workShown.has(p)).map(p => ({ p, s: project(p.x, p.sitting ? 1.75 : 2.15, p.z) })).filter(o => onScreen(o.s))
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
    for (const p of people) if (!shown.has(p)) {
      p.bub.hidden = true;
      if (p.bub._t) { p.bub.replaceChildren(); p.bub._t = null; }
    }
    // Names use screen pixels at every zoom level. Nearby alternatives keep
    // labels legible without spreading an entire department across the map.
    const nameCandidates = people.filter(p => !shown.has(p) && !workShown.has(p))
      .map(p => ({ p, s: project(p.x, p.sitting ? 1.75 : 2.15, p.z) })).filter(({ s }) => onScreen(s))
      .sort((a, b) => (b.p === hovered) - (a.p === hovered) || (b.p === sel) - (a.p === sel) || Number(!!b.p.head) - Number(!!a.p.head) || a.s.y - b.s.y || a.p.id.localeCompare(b.p.id));
    const namesShown = new Set();
    for (const { p, s } of nameCandidates) {
      const priority = p === hovered || p === sel, busy = !!currentWork.get(p), maxWidth = Math.min(priority ? 320 : 230, W - 12);
      p.tag.classList.toggle('selected', p === sel); p.tag.classList.toggle('hovered', p === hovered); p.tag.classList.toggle('busy', busy);
      if (p.tag.getAttribute('aria-pressed') !== String(p === sel)) p.tag.setAttribute('aria-pressed', String(p === sel));
      const sizeKey = `${maxWidth}:${busy}`;
      if (p.tag._sizeKey !== sizeKey) {
        p.tag.style.maxWidth = maxWidth + 'px'; p.tag.hidden = false;
        p.tag._size = { w: p.tag.offsetWidth || Math.min(maxWidth, p.name.length * 8 + 54), h: p.tag.offsetHeight || 36 };
        p.tag._sizeKey = sizeKey;
      }
      const { w, h } = p.tag._size, baseY = -10 - h / 2;
      const offsets = [[0, baseY], [-48, baseY], [48, baseY], [0, baseY - h - 5], [-64, baseY - h - 5], [64, baseY - h - 5], [0, 12 + h / 2], [-64, 12 + h / 2], [64, 12 + h / 2]];
      if (priority) {
        if (p.tag._offset) offsets.unshift(p.tag._offset);
        offsets.push([0, baseY - 2 * (h + 5)], [-110, baseY], [110, baseY], [-110, 12 + h / 2], [110, 12 + h / 2]);
      }
      let box = null;
      for (const [dx, dy] of offsets) {
        const x = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, s.x + dx)), y = Math.max(h / 2 + 6, Math.min(H - h / 2 - 6, s.y + dy));
        if (Math.abs(x - s.x) > (priority ? 160 : 100) || Math.abs(y - s.y) > (priority ? 130 : 90)) continue;
        if (free(x, y, w + 6, h + 5)) { box = { x, y }; break; }
      }
      if (!box) continue;
      p.tag._offset = [box.x - s.x, box.y - s.y]; p.tag.hidden = false; namesShown.add(p);
      at(p.tag, box.x, box.y, 'translate(-50%,-50%)');
      const stemX = Math.max(box.x - w / 2, Math.min(box.x + w / 2, s.x)), stemY = Math.max(box.y - h / 2, Math.min(box.y + h / 2, s.y));
      const dx = s.x - stemX, dy = s.y - stemY, length = Math.hypot(dx, dy);
      p.nameStem.style.height = Math.max(0, length - 2) + 'px'; at(p.nameStem, stemX, stemY, `rotate(${Math.atan2(-dx, dy)}rad)`); p.nameStem.hidden = length < 12;
    }
    for (const p of people) if (!namesShown.has(p)) { p.tag.hidden = true; p.nameStem.hidden = true; }
    for (const r of roomLabels) {
      const s = dist < 60 && project(r.cx, 3.4, r.row ? r.cz + 5.6 : r.cz - 5.6);
      const show = !!s && onScreen(s) && free(s.x, s.y, r.name.length * 7.5 + 24, 24);
      if (r.lbl.hidden !== !show) r.lbl.hidden = !show; if (show) at(r.lbl, s.x, s.y, 'translate(-50%,-50%)');
    }
  }

  /* ---------- picking ---------- */
  const ray = new THREE.Raycaster(), mv = new THREE.Vector2(); let down = null, hoverAt = 0;
  const onDown = e => { down = [e.clientX, e.clientY]; hovered = null; };
  const onUp = e => { const start = down; down = null; if (!start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return; const r = canvas.getBoundingClientRect(); mv.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(mv, camera);
    const hit = ray.intersectObjects([...people.map(p => p.g), meetingPick], true).find(h => h.object.userData.person || h.object.userData.meetingTable); if (!hit) return;
    if (hit.object.userData.meetingTable) { focusMeeting(); o.onMeetingClick?.(currentMeeting); return; }
    const p = hit.object.userData.person;
    if (p.human && p.quest && o.onApproverClick) o.onApproverClick(p); else select(p.id); };
  // A small screen-space hit target identifies tiny figures from the campus
  // view without raycasting every mesh or changing the camera on hover.
  const onMove = e => {
    if (e.pointerType === 'touch' || e.buttons || down || performance.now() - hoverAt < 65) return;
    hoverAt = performance.now(); const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let nearest = null, distance = 18;
    for (const p of people) {
      const s = project(p.x, p.sitting ? 1.2 : 1.5, p.z), d = Math.hypot(s.x - x, s.y - y);
      if (s.front && d < distance) { nearest = p; distance = d; }
    }
    hovered = nearest; canvas.style.cursor = nearest ? 'pointer' : '';
  };
  const onLeave = () => { down = null; hovered = null; canvas.style.cursor = ''; };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerleave', onLeave); canvas.addEventListener('pointercancel', onLeave);
  controls.addEventListener('start', () => { fly = null; follow = null; untouched = false; });

  /* ---------- movement ---------- */
  const roomAt = (x, z) => Object.values(R).find(r => Math.abs(x - r.cx) <= 6 && Math.abs(z - r.cz) <= 6) || null;
  function stopMoving(p) { const done = p.resolve; p.resolve = null; p.path = []; done?.(false); }
  function goTo(p, tx, tz, signal) {
    if (disposed || signal?.aborted) return Promise.resolve(false);
    const from = roomAt(p.x, p.z) || p.room, to = roomAt(tx, tz), pts = [{ x: from.cx, z: p.z }];
    if (!to) return Promise.resolve(false);
    if (from !== to) pts.push({ x: from.cx, z: from.door }, { x: from.cx, z: 0 }, { x: to.cx, z: 0 }, { x: to.cx, z: to.door });
    pts.push({ x: to.cx, z: tz }, { x: tx, z: tz });
    stopMoving(p);
    p.sitting = false; p.path = aroundMeetingTable(p, pts, { minX: meetingPoint.x - 3.8, maxX: meetingPoint.x + 3.8, minZ: meetingPoint.z - 1.45, maxZ: meetingPoint.z + 1.45 });
    return new Promise(resolve => {
      const abort = () => { if (p.resolve === done) { p.resolve = null; p.path = []; } done(false); };
      const done = arrived => { signal?.removeEventListener('abort', abort); resolve(arrived); };
      p.resolve = done; signal?.addEventListener('abort', abort, { once: true });
    });
  }
  const standBy = b => ({ x: b.home.x < b.homeRoom.cx ? b.homeRoom.cx - 1.1 : b.homeRoom.cx + 1.1, z: b.home.z + .3 });
  const rest = p => p.meetingId ? (p.path.length ? 'walking' : p.meetingSpeaking ? 'talking' : 'waiting') : p.visitId ? (p.path.length ? 'walking' : p.visitSpeaking ? 'talking' : 'waiting') : p.sitting ? (p.quest ? 'waiting' : 'idle') : 'walking';
  function step(p, dt) {
    if (!p.path.length) return; const t = p.path[0], dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz), v = (reduce ? 40 : Math.abs(dz) < .01 && Math.abs(p.z) < .01 ? 5.5 : 3.1) * dt;
    if (d > .001) p.heading = Math.atan2(dx, dz);
    if (d <= v) { p.x = t.x; p.z = t.z; p.path.shift(); if (!p.path.length && p.resolve) { const r = p.resolve; p.resolve = null; r(true); } } else { p.x += dx / d * v; p.z += dz / d * v; }
  }
  function pose(p, t) {
    const g = p.g, walking = !p.sitting && p.path.length;
    // someone sitting still needs no update unless they are typing or something about them just changed
    if (p._still) { p.ring.visible = p === sel || p.status !== 'idle'; return; }
    p._still = p.sitting && !p.path.length && p.status !== 'thinking' && !((p.meetingId || p.visitId) && p.status === 'talking');
    g.position.set(p.x, 0, p.z);
    if (p.sitting) { g.position.y = -.4; g.position.z = p.z - .05; g.rotation.y = p.meetingId ? p.seatHeading || 0 : p.visitId && p.faceTo ? Math.atan2(p.faceTo.x - p.x, p.faceTo.z - p.z) : 0; p.legs.forEach(l => { l.rotation.x = -Math.PI / 2 + .1; }); p.arms.forEach((a, i) => { a.rotation.x = -.9 + (p.status === 'thinking' ? Math.sin(t * 9 + i * 3) * .12 : (p.meetingId || p.visitId) && p.status === 'talking' ? Math.sin(t * 4 + i * 2) * .08 : 0); }); }
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
    if (!paused) { T += dt * speed; people.forEach(p => step(p, dt * speed)); if (!reduce) world.update(dt, T, night); }
    if (lapse) { lapseH = (lapseH + raw * 24 / 90) % 24; if (frameNo % 2 === 0) applySky(); } else if ((skyAge += raw) > 1) { skyAge = 0; applySky(); }
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
    renderer.setSize(w, h, false); canvas.style.height = h + 'px'; camera.aspect = w / h; people.forEach(p => { p.tag._sizeKey = null; });
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
  function sleep(ms, signal) {
    return new Promise(resolve => {
      let left = ms, last = performance.now(), timer, done = false;
      const finish = value => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(value); };
      const abort = () => finish(false);
      if (signal?.aborted || disposed) return finish(false);
      signal?.addEventListener('abort', abort, { once: true });
      (function tick() { const now = performance.now(); if (!paused) left -= (now - last) * speed; last = now; if (disposed || left <= 0) finish(!disposed); else timer = setTimeout(tick, 80); })();
    });
  }
  function clearSpeech(p) {
    p.speechToken = null; p.bubble = null; p.visitSpeaking = false;
    // Revoked private dialogue must disappear even if the tab's HUD is paused.
    if (p.bub) { p.bub.replaceChildren(); p.bub._t = null; p.bub.hidden = true; }
    if (p.workTag) { p.workTag.querySelector('.agent-work-speech')?.remove(); p.workTag.removeAttribute('title'); p.workTag.removeAttribute('aria-label'); p.workTag._t = null; }
    markDirty(p);
  }
  async function speak(p, text, kind, ms, signal, visitId) {
    const token = Symbol('speech'), meetingId = p.meetingId; p.speechToken = token; p.visitSpeaking = !!visitId;
    markDirty(p); p.active = performance.now(); p.status = kind === 'thinking' ? 'thinking' : 'talking';
    p.bubble = text; p.bubbleKind = kind;
    if (!visitId) { p.log.unshift(text); p.log.length = Math.min(p.log.length, 3); }
    const finished = await sleep(ms, signal);
    if (p.speechToken === token) { clearSpeech(p); p.status = rest(p); markDirty(p); }
    return finished && !disposed && (!visitId || p.visitId === visitId) && p.meetingId === meetingId;
  }
  const visits = createDirectDialogueController({
    hasAgent: id => typeof id === 'string' && Object.hasOwn(P, id),
    async arrive(session, signal) {
      const visitor = P[session.visitorId], recipient = P[session.recipientId];
      for (const p of [visitor, recipient]) {
        clearSpeech(p); stopMoving(p); p.visitId = session.id; p.carry = p === visitor;
        p.faceTo = null; p.active = performance.now(); p.status = 'walking';
        p.task = p === visitor ? `Visiting ${recipient.name}` : `Conversation with ${visitor.name}`; markDirty(p);
      }
      const point = standBy(recipient);
      // The recipient stays at their own office. A prior animation may have
      // left them returning home, so finish that move before showing dialogue.
      const recipientHome = Math.hypot(recipient.x - recipient.home.x, recipient.z - recipient.home.z) < .05;
      if (recipientHome) { recipient.sitting = true; recipient.status = 'waiting'; markDirty(recipient); }
      const [arrived, ready] = await Promise.all([goTo(visitor, point.x, point.z, signal), recipientHome ? Promise.resolve(true) : goTo(recipient, recipient.home.x, recipient.home.z, signal)]);
      if (!arrived || !ready || signal.aborted || disposed || visitor.meetingId || recipient.meetingId) return false;
      visitor.room = recipient.homeRoom; recipient.room = recipient.homeRoom; recipient.sitting = true;
      visitor.faceTo = recipient; recipient.faceTo = visitor;
      visitor.status = recipient.status = 'waiting'; markDirty(visitor); markDirty(recipient);
      return true;
    },
    async speak(session, turn, signal) {
      const p = P[turn.speakerId];
      if (!p || p.visitId !== session.id || p.meetingId || signal.aborted) return false;
      p.task = `Conversation with ${P[p.id === session.visitorId ? session.recipientId : session.visitorId].name}`;
      return speak(p, dialogueBubble(turn.text), 'talking', dialogueDuration(turn.text), signal, session.id);
    },
    async leave(session, { isBlocked, signal }) {
      await Promise.all([session.visitorId, session.recipientId].map(async id => {
        const p = P[id]; if (p.visitId !== session.id) return;
        p.visitId = null;
        // Meeting movement has already replaced this visit's path. Never
        // cancel or overwrite it from a late visit completion.
        if (disposed || p.meetingId || isBlocked(id)) return;
        clearSpeech(p);
        stopMoving(p); p.faceTo = null; p.carry = false;
        p.status = 'walking'; p.task = 'Returning from the conversation'; markDirty(p);
        const atHome = Math.hypot(p.x - p.home.x, p.z - p.home.z) < .05;
        const arrived = atHome || await goTo(p, p.home.x, p.home.z, signal);
        if (disposed || p.meetingId || p.visitId || isBlocked(id)) return;
        if (!arrived) {
          if (!signal.aborted) return;
          // A paused/background tab must not retain both reservations forever.
          // Restore only this owned return; a meeting always keeps its new path.
          p.x = p.home.x; p.z = p.home.z;
        }
        p.room = p.homeRoom; p.sitting = true; p.status = rest(p);
        p.task = p.quest ? 'Waiting on an approval' : 'Waiting for the next job'; markDirty(p);
      }));
    },
  });
  function select(id) { if (sel) markDirty(sel); sel = P[id] || null; follow = sel; if (sel) markDirty(sel); o.onSelect && sel && o.onSelect(sel); }
  function focusMeeting() {
    follow = null; untouched = false;
    const { x, z } = meetingPoint, pos = view === '2d' ? [x, 23, z + .01] : [x + 3, 12, z + 14];
    fly = { t: 0, ft: controls.target.clone(), fp: camera.position.clone(), tt: new THREE.Vector3(x, 0, z), tp: new THREE.Vector3(...pos) };
  }
  /** Reflect one real meeting at the shared table. Repeated polling never restarts attendees' paths. */
  function setMeeting(value) {
    if (disposed) return;
    const ids = [...new Set((Array.isArray(value?.participants) ? value.participants : []).map(p => typeof p === 'string' ? p : p?.id))]
      .filter(id => typeof id === 'string' && Object.hasOwn(P, id) && !P[id].human).slice(0, meetingSeats.length);
    const next = value?.id ? { ...value, participants: ids.map(id => ({ id, name: P[id].name })) } : null;
    const active = next && ['planned', 'running'].includes(next.status), assigned = active ? new Set(ids) : new Set();
    visits.setMeetingParticipants(assigned);
    currentMeeting = next;
    meetingLabel.textContent = active ? `Meeting table · ${ids.length} agents` : next ? 'Meeting table · Summary' : 'Meeting table';
    meetingLabel.title = next?.title || 'Gather agents to discuss a task';
    meetingLabel.setAttribute('aria-label', active ? `Open meeting: ${next.title || 'Agent meeting'}, ${ids.length} agents` : next ? 'Open the latest meeting summary' : 'Open meeting table');
    meetingLabel.dataset.status = next?.status || 'idle';
    for (const p of people) {
      if (p.meetingId && (!assigned.has(p.id) || p.meetingId !== next?.id)) {
        clearSpeech(p);
        p.meetingId = null; p.meetingSeatIndex = null; p.meetingSpeaking = false; p.seatHeading = 0; p.faceTo = null; p.carry = false;
        p.status = 'walking'; p.task = 'Returning from the meeting'; markDirty(p);
        const returning = goTo(p, p.home.x, p.home.z);
        returning.then(arrived => {
          if (!arrived || disposed || p.meetingId) return;
          p.room = p.homeRoom; p.sitting = true; p.status = rest(p); p.task = p.quest ? 'Waiting on an approval' : 'Waiting for the next job'; markDirty(p);
        });
      }
    }
    if (!active) return;
    ids.forEach((id, index) => {
      const p = P[id], seat = meetingSeats[index];
      p.meetingSpeaking = next.speakerId === id || next.speaker_id === id;
      if (p.meetingId === next.id && p.meetingSeatIndex === index) { if (!p.path.length) { p.status = rest(p); markDirty(p); } return; }
      clearSpeech(p);
      p.meetingId = next.id; p.meetingSeatIndex = index; p.seatHeading = seat.heading; p.carry = false; p.faceTo = meetingPoint;
      p.active = performance.now(); p.status = 'walking'; p.task = `Meeting: ${next.title || 'Team discussion'}`; markDirty(p);
      goTo(p, seat.x, seat.z).then(arrived => {
        if (!arrived || disposed || p.meetingId !== next.id || p.meetingSeatIndex !== index) return;
        p.room = meetingRoom; p.sitting = true; p.faceTo = meetingPoint; p.status = rest(p); markDirty(p);
      });
    });
  }
  function flyTo(id) {
    follow = null; let tgt, pos;
    if (!id) { const v = view === '2d' ? TOP_VIEW : CAMPUS_VIEW; tgt = v.target; pos = fit(v); }
    else if (id === 'meeting') return focusMeeting();
    else if (B[id]) { const b = B[id]; tgt = [b.ox, 0, 1]; pos = view === '2d' ? [b.ox, b.cols * 16 + 10, 1.01] : [b.ox + 4, b.cols * 9 + 6, b.cols * 9 + 16]; }
    else if (R[id]) { const r = R[id]; tgt = [r.cx, 0, r.cz]; pos = view === '2d' ? [r.cx, 30, r.cz + .01] : [r.cx + 3, 13, r.cz + 15]; }
    else if (P[id]) return focus(id);
    else return;
    fly = { t: 0, ft: controls.target.clone(), fp: camera.position.clone(), tt: new THREE.Vector3(...tgt), tp: new THREE.Vector3(...pos) };
  }
  function focus(id) { const p = P[id]; if (!p) return; p.meetingId ? focusMeeting() : flyTo(roomAt(p.x, p.z)?.id || p.room.id); sel && markDirty(sel); sel = p; markDirty(p); o.onSelect && o.onSelect(p); }
  function setView(v) {
    view = v === '2d' ? '2d' : '3d';
    controls.enableRotate = view === '3d'; controls.minPolarAngle = view === '2d' ? 0 : .08; controls.maxPolarAngle = view === '2d' ? .02 : 1.47;
    const vw = view === '2d' ? TOP_VIEW : CAMPUS_VIEW;
    fly = { t: 0, ft: controls.target.clone(), fp: camera.position.clone(), tt: new THREE.Vector3(...vw.target), tp: new THREE.Vector3(...fit(vw)) };
  }
  // the sky follows the time in Kerala; the theme switch and the sky button can jump it, or run a day in 90 seconds
  let skyOffset = 0, lapse = false, lapseH = 12, skyAge = 0;
  const hourNow = () => lapse ? lapseH : (istHours() + skyOffset) % 24;
  function applySky(force) {
    const n = world.skyAt(hourNow()); if (n === night && !force) return;
    night = n;
    lamps.forEach(l => { if (l.isLight) l.intensity = n ? 1.25 : 0; else l.mat.emissiveIntensity = n ? (l.on || 1.4) : 0; });
    screens.forEach(s => { s.emissiveIntensity = n ? 1.0 : .55; }); glow.visible = n; lightPools.visible = n;
    renderer.shadowMap.needsUpdate = true;
  }
  function setTime(h) {
    lapse = h === 'lapse';
    if (lapse) lapseH = hourNow(); else skyOffset = h == null ? 0 : ((h - istHours()) % 24 + 24) % 24;
    applySky(true);
  }
  const setNight = n => setTime(n ? 20.5 : 12.5);
  const api = {
    people, byId: P, rooms: R, buildings: B, sleep,
    get paused() { return paused; }, setPaused(v) { paused = v; }, get speed() { return speed; }, setSpeed(v) { speed = v; },
    get night() { return night; }, setNight, setTime, flyTo, focus, select, orbit, pan,
    setMeeting, focusMeeting, get meeting() { return currentMeeting; },
    directDialogue: value => visits.directDialogue(value),
    cancelDialogue: id => visits.cancelDialogue(id),
    /** Replace authoritative current work. It never changes movement or speech. */
    setWorkStatuses(snapshot) { if (!disposed) workStatuses = normalizeWorkStatuses(snapshot, people.map(p => p.id)); },
    // Locate the recipient's office without selecting them or opening a drawer.
    locateDialogue(id) { if (P[id]) flyTo(P[id].homeRoom.id); },
    /** The hour shown in Kerala time, whether it is the live clock or a time-lapse, and tonight's moon. */
    sky() { return { hour: hourNow(), live: !lapse && skyOffset === 0, lapse, moon: world.moon }; },
    get view() { return view; }, setView,
    /** Width in pixels covered by a panel on the right; the scene centres itself in the rest. */
    setInset(px) { inset = px || 0; resize(); if (untouched && !fly && view === '3d') camera.position.set(...fit(CAMPUS_VIEW)); },
    turn(deg) { orbit(deg * Math.PI / 180, 0); }, tilt(deg) { orbit(0, deg * Math.PI / 180); }, zoom(f) { orbit(0, 0, f); },
    fullscreen() { return document.fullscreenElement ? document.exitFullscreen() : host.requestFullscreen?.(); }, get selected() { return sel; }, resize,
    setVisible(v) { visible = v; if (v) resize(); },
    /**
     * Occupancy counts fresh execution leases only. Speech, walks and approval
     * waits stay visible overhead without claiming the agent is executing work.
     */
    stats() { const now = Date.now(), ai = l => l.filter(p => !p.human);
      const active = l => ai(l).filter(p => isWorkingStatus(workStatuses[p.id], now)).length;
      return { total: ai(people).length, active: active(people), buildings: Object.values(B).map(b => ({ id: b.id, name: b.short, total: ai(b.people).length, active: active(b.people), rooms: b.rooms })) }; },
    info() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, quality }; },
    async walkTo(id, toId) { const p = P[id], b = P[toId]; if (!p || !b || p.meetingId || b.meetingId || visits.isReserved(id) || visits.isReserved(toId)) return; markDirty(p); p.active = performance.now(); p.status = 'walking'; p.task = `Walking to ${b.name}`; p.faceTo = null; const s = standBy(b); const arrived = await goTo(p, s.x, s.z); if (!arrived || disposed || p.meetingId || visits.isReserved(id)) return; p.room = roomAt(s.x, s.z) || p.room; p.faceTo = b; },
    async walkHome(id) { const p = P[id]; if (!p || p.meetingId || visits.isReserved(id)) return; markDirty(p); p.status = 'walking'; p.faceTo = null; const arrived = await goTo(p, p.home.x, p.home.z); if (!arrived || disposed || p.meetingId || visits.isReserved(id)) return; p.room = p.homeRoom; p.sitting = true; p.status = rest(p); markDirty(p); p.task = p.quest ? 'Waiting on an approval' : 'Waiting for the next job'; p.carry = false; },
    async say(id, text, kind = 'talking', ms = 2600) { const p = P[id]; if (!p || (visits.isReserved(id) && !p.meetingId)) return; return speak(p, dialogueBubble(text), kind, Math.min(8_000, ms + dialogueBubble(text).length * 20)); },
    async think(id, text, ms = 2600) { const p = P[id]; if (!p || p.meetingId || visits.isReserved(id)) return; p.task = text; return speak(p, dialogueBubble(text) + '…', 'thinking', Math.min(8_000, ms)); },
    setCarry(id, v) { if (P[id] && !P[id].meetingId && !visits.isReserved(id)) { P[id].carry = v; markDirty(P[id]); } },
    setQuest(id, v) { const p = P[id]; if (!p) return; p.quest = v; if (!p.meetingId && !visits.isReserved(id)) { if (p.sitting && !p.bubble) p.status = v ? 'waiting' : 'idle'; p.task = v ? 'Waiting on an approval' : 'Nothing waiting'; } markDirty(p); },
    dispose() {
      disposed = true; visits.dispose(); people.forEach(stopMoving);
      cancelAnimationFrame(raf); canvas.removeEventListener('keydown', onKey); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave); canvas.removeEventListener('pointercancel', onLeave); document.removeEventListener('fullscreenchange', onFs); controls.dispose();
      const geos=new Set(), mats=new Set(), textures=new Set();
      scene.traverse(node=>{if(node.geometry)geos.add(node.geometry);if(node.material)for(const m of Array.isArray(node.material)?node.material:[node.material])mats.add(m)});
      for(const m of mats){for(const value of Object.values(m))if(value?.isTexture)textures.add(value);if(m.uniforms)for(const u of Object.values(m.uniforms))if(u?.value?.isTexture)textures.add(u.value)}
      geos.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());mats.forEach(m=>m.dispose());environment.dispose();finish.dispose();renderer.dispose();labels.innerHTML='';
    },
  };
  applySky(true);
  return api;
}

function mix(a, b, t) { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const c = k => Math.round(((pa >> k) & 255) * (1 - t) + ((pb >> k) & 255) * t); return '#' + ((1 << 24) + (c(16) << 16) + (c(8) << 8) + c(0)).toString(16).slice(1); }
