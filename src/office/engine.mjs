// The Parakkat AI Office: one building you can look down into from above or walk through on foot.
// Framework-free, so the same file runs in the Next.js app and the local preview page.
// THREE and OrbitControls are passed in, so the caller decides how three.js is loaded.
//
// floorplan.mjs holds the rooms, seats and routes; walk.mjs the movement rules; building.mjs the geometry;
// crowd.mjs the people. This file runs them, and connects real agent work, speech and meetings to what you see.
//
// Speed: the building is a few merged meshes, the people are instanced by body part, shadows refresh every sixth frame,
// and if frames still run slow the renderer lowers its resolution and then drops shadows.

import { AUTO_DOORS, BREAK_SPOTS, CLEANER_ROUND, MEETING_CHAIRS, MEETING_TABLE, OFFICE_ROOMS, OTHER_AREAS, SPAWN, WORLD_BOUNDS, areaAt, buildColliders, createNavGrid, findRoute, nearestOpen, seatsFor, sightBlocked, teamCentres } from './floorplan.mjs';
import { WALK, createPlayer, look, movePlayer, promptFor, sitDown, standUp, stepDoors } from './walk.mjs';
import { createBuilding } from './building.mjs';
import { createCrowd, lookFor } from './crowd.mjs';
import { createDirectDialogueController, dialogueBubble, dialogueDuration } from './direct-dialogue.mjs';
import { normalizeWorkStatuses, agentWorkStatus, layoutWorkStatuses } from './work-status.mjs';
import { characterMotion } from './character-motion.mjs';
import { forwardLabelWheel } from './map-input.mjs';
import { isWorkingStatus } from '../lib/agents/activity-core.mjs';

export const DEPT_COLOR = {
  board: '#b08d57', insights: '#3d6fb0', intel: '#6c4fb3', strategy: '#2b8a64', creative: '#b23a4c', social: '#d07a1f',
  perf: '#23807a', seo: '#4f8a2b', lead: '#1c1c1c', warroom: '#6f3fa0', customer: '#2f7fa8', goldrate: '#b8913f', datahub: '#4a5568',
  forecast: '#3f8f7a', qa: '#8a6a3a', photo: '#c4566a', reels: '#d9603b', catalog: '#8a5a9e', lang: '#3a8f5c', crm: '#2b6cb0', brand: '#a8865a',
};
const STATUS_COL = { idle: '#7aa7d9', thinking: '#e89a3c', talking: '#ffd338', walking: '#ffd338', waiting: '#e6c271' };
const OVERVIEW = { pos: [0, 60, 58], target: [0, 0, 2] };
const TOP_VIEW = { pos: [0, 96, 2.01], target: [0, 0, 2] };
const WALK_FOV = 68, MAP_FOV = 38, TALK_RANGE = 15;

/**
 * @param {object} o
 * @param {any} o.THREE
 * @param {any} o.OrbitControls
 * @param {HTMLCanvasElement} o.canvas
 * @param {HTMLElement} o.labels  absolutely positioned layer over the canvas for names and speech
 * @param {HTMLElement} o.host    element that sizes the scene
 * @param {{BUILDINGS: any[], ROOMS: any[], PEOPLE: any[]}} o.roster
 * @param {boolean} [o.fill]  true when the host has a fixed height the canvas should fill
 * @param {(p: any) => void} [o.onSelect]
 * @param {(meeting: any | null) => void} [o.onMeetingClick]  open the current meeting's discussion
 * @param {() => (HTMLElement | null)[]} [o.avoid]  overlay elements labels should not cover
 * @param {(mode: 'overview' | 'walk') => void} [o.onMode]
 * @param {(area: any | null) => void} [o.onArea]  you walked into a room
 * @param {(prompt: any | null) => void} [o.onPrompt]  what pressing E would do
 * @param {(p: any) => void} [o.onTalk]  you pressed E beside an agent
 * @param {(open: boolean) => void} [o.onMenu]  the Esc menu should open
 * @param {(state: { x: number, z: number, yaw: number }) => void} [o.onPlayer]
 */
export function createOffice(o) {
  const { THREE, OrbitControls, canvas, labels, host, roster } = o;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let paused = false, speed = 1, sel = null, hovered = null, follow = null, fly = null, raf = 0, view = '3d', disposed = false, mode = 'overview';

  /* ---------- who sits where ---------- */
  const seats = seatsFor(roster.PEOPLE), centres = teamCentres(roster.PEOPLE, seats);
  const B = {}, R = {}, P = {};
  roster.BUILDINGS.forEach(b => { B[b.id] = { ...b }; });
  roster.ROOMS.forEach(r => { const c = centres[r.id] || { x: 0, z: 0, area: 'workspace' }; R[r.id] = { ...r, b: B[r.building], cx: c.x, cz: c.z, area: c.area }; });
  const people = roster.PEOPLE.map((d, i) => {
    const room = R[d.room], s = seats[d.id];
    return { ...d, homeRoom: room, room, home: { x: s.x, z: s.z }, homeHeading: s.heading, x: s.x, z: s.z, sitting: true, path: [], resolve: null, status: 'idle', bubble: null, bubbleKind: '',
      carry: false, quest: false, task: 'Waiting for the next job', log: [], phase: i * .9, heading: s.heading, faceTo: null, look: lookFor(i, DEPT_COLOR[d.dept], d.human) };
  });
  people.forEach(p => { P[p.id] = p; });
  let workStatuses = Object.create(null);
  const workStatus = (p, now = Date.now()) => agentWorkStatus(p, workStatuses[p.id], now);
  Object.values(B).forEach(b => { b.people = people.filter(p => p.homeRoom.b === b); b.rooms = Object.values(R).filter(r => r.b === b).length; });
  const meetingRoom = R.board || Object.values(R)[0];
  const meetingPoint = { x: MEETING_TABLE.x, z: MEETING_TABLE.z };
  const meetingSeats = MEETING_CHAIRS;
  let currentMeeting = null;

  /* ---------- renderer ---------- */
  THREE.ColorManagement.legacyMode = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(devicePixelRatio || 1, 1.5), quality = 2, shadowsOn = true;
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
  const scene = new THREE.Scene();
  // here it is always night
  scene.background = new THREE.Color('#06090d'); scene.fog = new THREE.Fog('#06090d', 90, 210);
  const camera = new THREE.PerspectiveCamera(MAP_FOV, 16 / 9, .9, 600); camera.rotation.order = 'YXZ';
  camera.position.set(...OVERVIEW.pos);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(...OVERVIEW.target); controls.enableDamping = true; controls.minPolarAngle = .02; controls.maxPolarAngle = 1.32; controls.minDistance = 5; controls.maxDistance = 170; controls.screenSpacePanning = false;
  // Map-style: drag moves across the building, right-drag (or two fingers) turns and tilts, scroll or pinch zooms.
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.panSpeed = 1.2; controls.rotateSpeed = .7; controls.zoomSpeed = 1.1;
  scene.add(new THREE.HemisphereLight('#a08a70', '#2c2118', .86));
  const key = new THREE.DirectionalLight('#ffdcb0', .72); key.position.set(-12, 70, 22); key.castShadow = true; scene.add(key); scene.add(key.target); key.target.position.set(0, 0, 2);
  key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -46, right: 46, top: 40, bottom: -40, near: 10, far: 120 }); key.shadow.bias = -.0006; key.shadow.normalBias = .03;
  // A handful of real lights follow you between the lamps. Their count never changes, so shaders never recompile.
  const nearLights = Array.from({ length: 6 }, () => { const l = new THREE.PointLight('#ffcf94', 1.05, 14, 1.6); scene.add(l); return l; });

  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const building = createBuilding({ THREE, scene, rnd, seats, people, rooms: roster.ROOMS });
  const crowd = createCrowd({ THREE, scene, count: people.length + 24 });
  const colliders = buildColliders(), nav = createNavGrid(colliders);
  const ringGeo = new THREE.RingGeometry(.42, .54, 20); ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: .9, toneMapped: false, depthWrite: false, vertexColors: false });
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, people.length); rings.setColorAt(0, new THREE.Color('#ffffff')); rings.frustumCulled = false; rings.renderOrder = 2; scene.add(rings);

  /* ---------- the rest of the staff: nobody stands still ---------- */
  const ambient = [];
  const staff = (role, x, z, heading, extras = {}) => { const i = ambient.length + 90, look = extras.look || lookFor(i); const a = { id: 'staff:' + ambient.length, ambient: true, role, x, z, home: { x, z }, heading, homeHeading: heading, sitting: !!extras.sit, path: [], status: extras.status || 'idle', phase: i * .7, look, extras, faceTo: null, carry: false }; ambient.push(a); return a; };
  const uniform = (shirt, pants = '#17181d') => ({ ...lookFor(ambient.length + 3), shirt, sleeve: shirt, forearm: shirt, pants });
  staff('Security', -25.4, 23.6, 0, { cap: '#16171c', look: uniform('#d8d4cb') }); staff('Security', -18.6, 23.6, 0, { cap: '#16171c', look: uniform('#d8d4cb') });
  staff('Receptionist', -22, 9.45, 0, { sit: true, look: uniform('#6b3024', '#1d1c20') });
  staff('Interviewer', 1.9, -18.2, Math.PI / 2 + .4, { sit: true, status: 'talking', look: uniform('#c98a3e', '#2a2622') }); staff('Guest', 4.1, -18.2, -Math.PI / 2 - .4, { sit: true, look: uniform('#efe9dc', '#1c1c20') });
  staff('Camera operator', .55, -13.9, .25, { look: uniform('#8a4a96', '#1c1c20') });
  staff('Server technician', 12.5, -13.2, Math.PI, { look: uniform('#d9d4c7', '#16171c') });
  staff('Regular', -9.4, -.1, 0, { status: 'talking' }); staff('Regular', -12.6, 2, Math.PI / 2); staff('Regular', -1.6, 9.7, Math.PI, { status: 'talking' }); staff('Regular', -4.6, 7.6, Math.PI / 2);
  staff('Regular', -8.9, 12.4, Math.PI / 2); staff('Regular', -5.5, 12.4, -Math.PI / 2);
  staff('Regular', -24.6, -2.6, Math.PI / 2, { status: 'talking' }); staff('Regular', -23.4, -2.6, -Math.PI / 2);
  staff('Regular', -9.5, 18.5, Math.PI, { sit: true }); staff('Regular', 19.6, -15, Math.PI / 2); staff('Regular', 25.4, -15, -Math.PI / 2);
  staff('Regular', -32.5, 9.9, 0, { sit: true });
  const cleaner = staff('Cleaner', CLEANER_ROUND[0].x, CLEANER_ROUND[0].z, 0, { mop: true, look: uniform('#3f6e8a', '#26303d') });
  const roamers = [staff('Regular', -4, -7, 0), staff('Regular', 8, -7, 0)];
  let cleanerStop = 0;
  const staffStep = a => { if (a.path.length) return; const stop = CLEANER_ROUND[(cleanerStop = (cleanerStop + 1) % CLEANER_ROUND.length)]; a.path = findRoute(nav, a, stop) || []; };
  const roam = a => { const spot = BREAK_SPOTS[Math.floor(rnd() * BREAK_SPOTS.length)]; a.path = findRoute(nav, a, { x: spot.x + (rnd() - .5) * 1.2, z: spot.z + (rnd() - .5) * 1.2 }) || []; };

  /* ---------- labels over the canvas ---------- */
  const at = (el, x, y, how) => { el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) ${how}`; };
  const mkEl = (tag, cls) => { const d = document.createElement(tag); d.className = cls; d.style.left = '0'; d.style.top = '0'; d.hidden = true; labels.appendChild(d); return d; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const meetingLabel = mkEl('button', 'room-label meeting-table-label'); meetingLabel.type = 'button';
  meetingLabel.textContent = 'Meeting table'; meetingLabel.setAttribute('aria-label', 'Open meeting table');
  meetingLabel.onclick = () => { focusMeeting(); o.onMeetingClick?.(currentMeeting); };
  people.forEach(p => {
    p.tag = mkEl('button', 'tag' + (p.human ? ' human' : '')); p.tag.type = 'button'; p.tag.dataset.agentId = p.id; p.tag.setAttribute('aria-label', `Open ${p.name}`);
    p.tag.innerHTML = `<i aria-hidden="true"></i><b>${esc(p.name.replace(/ AI$/, ''))}</b><span class="tag-state"></span>`;
    p.tagState = p.tag.querySelector('.tag-state'); p.tag.onclick = () => select(p.id);
    p.tag.onpointerenter = () => { hovered = p; }; p.tag.onpointerleave = () => { if (hovered === p && document.activeElement !== p.tag) hovered = null; };
    p.tag.onfocus = () => { hovered = p; }; p.tag.onblur = () => { if (hovered === p) hovered = null; };
    p.bub = mkEl('div', 'bubble');
    p.workTag = mkEl('button', 'agent-work'); p.workTag.type = 'button'; p.workTag.dataset.agentId = p.id; p.workTag.onclick = () => select(p.id);
    p.workStem = mkEl('div', 'agent-work-stem'); p.workStem.setAttribute('aria-hidden', 'true');
  });
  const v3 = new THREE.Vector3();
  const project = (x, y, z) => { v3.set(x, y, z).project(camera); return { x: (v3.x + 1) / 2 * canvas.clientWidth, y: (1 - v3.y) / 2 * canvas.clientHeight, front: v3.z < 1 }; };
  const placed = []; let avoidRects = [], avoidAge = 99;
  const free = (x, y, w, h) => { if (placed.some(b => Math.abs(b.x - x) < (b.w + w) / 2 && Math.abs(b.y - y) < (b.h + h) / 2)) return false; placed.push({ x, y, w, h }); return true; };
  function hud() {
    placed.length = 0;
    // keep clear of the page's own overlays; their positions are re-read twice a second, not every frame
    if (o.avoid && ++avoidAge > 15) { avoidAge = 0; const hr = host.getBoundingClientRect(); avoidRects = []; for (const el of o.avoid()) { if (!el || el.hidden) continue; const r = el.getBoundingClientRect(); if (r.width) avoidRects.push({ x: r.left - hr.left + r.width / 2, y: r.top - hr.top + r.height / 2, w: r.width + 8, h: r.height + 8 }); } }
    placed.push(...avoidRects);
    const walking = mode === 'walk', W = canvas.clientWidth, H = canvas.clientHeight, dist = camera.position.distanceTo(controls.target);
    const near = p => !walking || (Math.hypot(p.x - player.x, p.z - player.z) < TALK_RANGE && !sightBlocked(player.x, player.z, p.x, p.z));
    const currentWork = new Map(people.map(p => [p, workStatus(p)]));
    const onScreen = s => s.front && s.x > 0 && s.x < W && s.y > 30 && s.y < H;
    const meetAt = project(meetingPoint.x, 1.6, meetingPoint.z);
    const meetShow = !walking && !fly && dist < 150 && onScreen(meetAt) && free(meetAt.x, meetAt.y - 10, currentMeeting ? 205 : 135, 28);
    meetingLabel.hidden = !meetShow;
    if (meetShow) at(meetingLabel, meetAt.x, meetAt.y - 10, 'translate(-50%,-100%)');
    // Current work and its dialogue share a card; every onscreen active agent is placed.
    const workCompact = walking || dist > 45 || W < 680;
    const working = people.map(p => ({ p, status: currentWork.get(p), s: project(p.x, p.sitting ? 1.5 : 2, p.z) }))
      .filter(item => item.status && near(item.p) && onScreen(item.s))
      .sort((a, b) => (b.p === sel) - (a.p === sel) || (b.p === hovered) - (a.p === hovered) || a.s.y - b.s.y || a.p.id.localeCompare(b.p.id));
    const workShown = new Set();
    const positions = layoutWorkStatuses(working.map(({ p, status, s }) => ({ id: p.id, p, status, x: s.x, y: s.y, anchorX: s.x, anchorY: s.y, w: workCompact ? 196 : 240, h: (workCompact ? 66 : 76) + (status.speech ? (workCompact ? 44 : 58) : 0) })), { width: W, height: H, obstacles: avoidRects });
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
    // Speech from anyone not already showing a work card.
    const maxBubbles = walking ? 6 : dist < 40 ? 10 : 7, cx = W / 2, cy = H / 2;
    const talk = people.filter(p => p.bubble && !workShown.has(p) && near(p)).map(p => ({ p, s: project(p.x, p.sitting ? 1.5 : 2, p.z) })).filter(q => onScreen(q.s))
      .sort((a, b) => (b.p === sel) - (a.p === sel) || (a.p.bubbleKind === 'thinking') - (b.p.bubbleKind === 'thinking') || Math.hypot(a.s.x - cx, a.s.y - cy) - Math.hypot(b.s.x - cx, b.s.y - cy));
    const shown = new Set();
    for (const { p, s } of talk) {
      if (shown.size >= maxBubbles) break;
      const compact = !walking && dist > 70 && p !== sel, w = compact ? 200 : 250, h = compact ? 46 : 70, bx = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, s.x));
      if (!free(bx, s.y - 14 - h / 2, w, h)) continue;
      shown.add(p);
      const key = (compact ? 'c' : 'f') + p.bubble;
      if (p.bub._t !== key) { p.bub.innerHTML = `<span class="who">${esc(p.name)}</span>${esc(compact && p.bubble.length > 60 ? p.bubble.slice(0, 57) + '…' : p.bubble)}`; p.bub._t = key; p.bub.className = 'bubble ' + p.bubbleKind + (compact ? ' compact' : ''); }
      at(p.bub, bx, s.y - 14, 'translate(-50%,-100%)'); p.bub.hidden = false;
    }
    for (const p of people) if (!shown.has(p)) { p.bub.hidden = true; if (p.bub._t) { p.bub.replaceChildren(); p.bub._t = null; } }
    // Small name tags: everyone close by when you are on foot, only who you point at when you are above.
    const candidates = people.filter(p => !shown.has(p) && !workShown.has(p) && (walking ? Math.hypot(p.x - player.x, p.z - player.z) < 12 && near(p) : p === hovered || p === sel))
      .map(p => ({ p, s: project(p.x, p.sitting ? 1.5 : 2, p.z) })).filter(({ s }) => onScreen(s)).sort((a, b) => (b.p === hovered) - (a.p === hovered) || Math.hypot(a.s.x - cx, a.s.y - cy) - Math.hypot(b.s.x - cx, b.s.y - cy));
    const named = new Set();
    for (const { p, s } of candidates) {
      if (named.size >= (walking ? 12 : 4)) break;
      const state = p.bubble ? 'talking' : p.breakToken ? 'on a break' : p.meetingId ? 'in a meeting' : p.human ? 'person' : 'idle';
      if (p.tag._state !== state) { p.tag._state = state; p.tagState.textContent = ` · ${state}`; p.tag.dataset.state = state; }
      const w = p.name.length * 7 + 76, h = 22, x = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, s.x)), y = s.y - 12;
      if (!free(x, y, w, h + 2)) continue;
      p.tag.classList.toggle('selected', p === sel); at(p.tag, x, y, 'translate(-50%,-50%)'); p.tag.hidden = false; named.add(p);
    }
    for (const p of people) if (!named.has(p)) p.tag.hidden = true;
  }

  /* ---------- picking from above ---------- */
  let down = null, hoverAt = 0, untouched = true;
  const nearestPerson = (x, y, within) => { let best = null, d = within; for (const p of people) { const s = project(p.x, p.sitting ? 1 : 1.3, p.z), dist = Math.hypot(s.x - x, s.y - y); if (s.front && dist < d) { best = p; d = dist; } } return best; };
  const onDown = e => { down = [e.clientX, e.clientY, performance.now()]; hovered = null; };
  const onUp = e => {
    const start = down; down = null; if (!start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return; if (mode !== 'overview') return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, p = nearestPerson(x, y, 26);
    if (p) { select(p.id); return; }
    const t = project(meetingPoint.x, .8, meetingPoint.z), s = project(meetingPoint.x + MEETING_TABLE.w / 2, .8, meetingPoint.z);
    if (Math.hypot(t.x - x, (t.y - y) * 1.6) < Math.abs(s.x - t.x)) { focusMeeting(); o.onMeetingClick?.(currentMeeting); }
  };
  const onMove = e => {
    if (mode === 'walk' && dragLook(e)) return;
    if (mode !== 'overview' || e.pointerType === 'touch' || e.buttons || down || performance.now() - hoverAt < 65) return;
    hoverAt = performance.now(); const r = canvas.getBoundingClientRect();
    hovered = nearestPerson(e.clientX - r.left, e.clientY - r.top, 20); canvas.style.cursor = hovered ? 'pointer' : '';
  };
  const onLeave = () => { down = null; hovered = null; lastDrag = null; canvas.style.cursor = ''; };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerleave', onLeave); canvas.addEventListener('pointercancel', onLeave);
  const onLabelWheel = e => forwardLabelWheel(e, canvas);
  labels.addEventListener('wheel', onLabelWheel, { passive: false, capture: true });
  controls.addEventListener('start', () => { fly = null; follow = null; untouched = false; });

  /* ---------- how people get around ---------- */
  function stopMoving(p) { const done = p.resolve; p.resolve = null; p.path = []; done?.(false); }
  function goTo(p, tx, tz, signal) {
    if (disposed || signal?.aborted) return Promise.resolve(false);
    const route = findRoute(nav, { x: p.x, z: p.z }, { x: tx, z: tz }); if (!route) return Promise.resolve(false);
    stopMoving(p);
    p.sitting = false; p.path = route;
    return new Promise(resolve => {
      const abort = () => { if (p.resolve === done) { p.resolve = null; p.path = []; } done(false); };
      const done = arrived => { signal?.removeEventListener('abort', abort); resolve(arrived); };
      p.resolve = done; signal?.addEventListener('abort', abort, { once: true });
    });
  }
  // A visitor stands in the aisle behind the person they came to see.
  const standBy = b => ({ x: b.home.x - Math.sin(b.homeHeading) * 1 + Math.cos(b.homeHeading) * .5, z: b.home.z - Math.cos(b.homeHeading) * 1 - Math.sin(b.homeHeading) * .5 });
  const rest = p => p.meetingId ? (p.path.length ? 'walking' : p.meetingSpeaking ? 'talking' : 'waiting') : p.visitId ? (p.path.length ? 'walking' : p.visitSpeaking ? 'talking' : 'waiting') : p.sitting ? (p.quest ? 'waiting' : 'idle') : 'walking';
  function step(p, dt) {
    if (!p.path.length) return; const t = p.path[0], dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz), v = (reduce ? 40 : 2.5) * dt;
    if (d > .001) p.heading = Math.atan2(dx, dz);
    if (d <= v) { p.x = t.x; p.z = t.z; p.path.shift(); if (!p.path.length && p.resolve) { const r = p.resolve; p.resolve = null; r(true); } } else { p.x += dx / d * v; p.z += dz / d * v; }
  }
  // Agents with nothing running take breaks: the kitchen is literally in their routine. This never counts as work.
  const busy = p => !!(p.meetingId || p.visitId);
  async function takeBreak(p) {
    const token = Symbol('break'), spot = BREAK_SPOTS[Math.floor(rnd() * BREAK_SPOTS.length)]; p.breakToken = token; p.task = 'On a break';
    const cancelled = () => p.breakToken !== token || disposed || busy(p), finish = () => { if (p.breakToken === token) p.breakToken = null; };
    const there = await goTo(p, spot.x + (rnd() - .5) * .8, spot.z + (rnd() - .5) * .8);
    if (!there || cancelled()) return finish();
    p.status = 'idle';
    for (let wait = 8 + rnd() * 16; wait > 0; wait--) { await sleep(1000); if (cancelled()) return finish(); if (isWorkingStatus(workStatuses[p.id], Date.now())) break; }
    p.status = 'walking';
    const home = await goTo(p, p.home.x, p.home.z);
    if (p.breakToken !== token) return; finish();
    if (home && !busy(p)) { p.room = p.homeRoom; p.sitting = true; p.status = rest(p); p.task = p.quest ? 'Waiting on an approval' : 'Waiting for the next job'; }
  }
  let nextBreak = 3;
  function routine(dt) {
    if (reduce) return;
    if ((nextBreak -= dt) > 0) return; nextBreak = 2.5 + rnd() * 5;
    if (people.filter(p => p.breakToken).length >= 7) return;
    const pool = people.filter(p => !p.human && p.sitting && !p.breakToken && !busy(p) && p !== sel && !p.bubble && !workStatus(p) && !visits.isReserved(p.id));
    const p = pool[Math.floor(rnd() * pool.length)]; if (p) void takeBreak(p);
  }

  function drawPerson(p, t) {
    const lease = workStatuses[p.id], work = lease?.expiresAt > Date.now() ? lease.state : null, motion = characterMotion(p, t, work, reduce), walking = !p.sitting && p.path.length;
    let heading;
    if (p.sitting) heading = p.meetingId ? p.seatHeading ?? p.homeHeading : p.visitId && p.faceTo ? Math.atan2(p.faceTo.x - p.x, p.faceTo.z - p.z) : p.homeHeading;
    else { const face = !walking && p.faceTo ? Math.atan2(p.faceTo.x - p.x, p.faceTo.z - p.z) : p.heading; p.turned = (p.turned ?? face) + ((((face - (p.turned ?? face)) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI) * .2; heading = p.turned; }
    if (p.sitting) p.turned = heading;
    crowd.drawFigure(p.x, 0, p.z, heading, motion, p.look, p.sitting, { folder: p.carry && !p.sitting, cap: p.extras?.cap, mop: p.extras?.mop && !p.sitting });
  }

  /* ---------- you, on foot ---------- */
  const player = createPlayer(SPAWN), doorStates = {}, keys = Object.create(null), touchMove = { forward: 0, strafe: 0 };
  const playerLook = { ...lookFor(5), shirt: '#ffd338', sleeve: '#ffd338', forearm: '#ffd338', pants: '#1d1c20' };
  let thirdPerson = false, inputOn = true, jumpQueued = false, locked = false, ignoreUnlock = false, lastDrag = null, lastPrompt = '', lastArea = null, lightsAge = 99, playerAge = 0;
  const lightSpots = [];
  const blockers = [];
  const camBack = new THREE.Vector3();
  const typing = e => !!e.target?.closest?.('input, textarea, select, [contenteditable="true"]');
  function dragLook(e) {
    if (locked || !inputOn) return false;
    if (!(e.buttons & 1)) { lastDrag = null; return false; }
    if (lastDrag) look(player, e.clientX - lastDrag[0], e.clientY - lastDrag[1], .0038);
    lastDrag = [e.clientX, e.clientY]; return true;
  }
  const onPointerLock = () => {
    locked = document.pointerLockElement === canvas;
    if (!locked && mode === 'walk' && !ignoreUnlock && inputOn) o.onMenu?.(true); // browsers swallow Esc while the pointer is captured
    ignoreUnlock = false;
  };
  const onMouseMove = e => { if (locked && inputOn) look(player, e.movementX, e.movementY); };
  const onCanvasClick = () => { if (mode === 'walk' && inputOn && !locked && matchMedia('(pointer: fine)').matches) canvas.requestPointerLock?.()?.catch?.(() => {}); };
  const release = () => { if (document.pointerLockElement === canvas) { ignoreUnlock = true; document.exitPointerLock(); } };
  function interact() {
    if (mode !== 'walk' || !inputOn) return;
    const prompt = promptFor(player, people, MEETING_CHAIRS, chairTaken);
    if (!prompt) return;
    if (prompt.kind === 'talk') { const p = P[prompt.target]; release(); keys.w = keys.a = keys.s = keys.d = keys.shift = false; o.onTalk?.(p); sel = p; }
    else if (prompt.kind === 'sit') sitDown(player, prompt.chair);
    else if (prompt.kind === 'stand') standUp(player);
  }
  const chairTaken = chair => people.some(p => p.meetingId && Math.hypot(p.x - chair.x, p.z - chair.z) < .5);
  const onKeyDown = e => {
    if (typing(e)) return;
    if (mode === 'overview') { const k = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key]; if (k && document.activeElement === canvas) { k(); e.preventDefault(); } return; }
    if (mode !== 'walk') return;
    if (e.key === 'Escape') { if (inputOn) o.onMenu?.(true); return; }
    if (!inputOn) return;
    const k = e.code === 'ShiftLeft' || e.code === 'ShiftRight' ? 'shift' : e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['w', 'a', 's', 'd', 'shift', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) { keys[k] = true; e.preventDefault(); }
    else if (e.code === 'Space') { jumpQueued = true; e.preventDefault(); }
    else if (k === 'e' && !e.repeat) { interact(); e.preventDefault(); }
    else if (k === 'v' && !e.repeat) { thirdPerson = !thirdPerson; e.preventDefault(); }
  };
  const onKeyUp = e => { const k = e.code === 'ShiftLeft' || e.code === 'ShiftRight' ? 'shift' : e.key.length === 1 ? e.key.toLowerCase() : e.key; keys[k] = false; };
  const clearKeys = () => { for (const k in keys) keys[k] = false; };
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', clearKeys);
  document.addEventListener('pointerlockchange', onPointerLock); document.addEventListener('mousemove', onMouseMove); canvas.addEventListener('click', onCanvasClick);

  function walkCamera() {
    const eye = (player.seat ? WALK.seatedEye : WALK.eye) + player.y;
    if (!thirdPerson || player.seat) { camera.position.set(player.x, eye, player.z); }
    else {
      camBack.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(-player.pitch) * .9 + .32, -Math.cos(player.yaw) * Math.cos(player.pitch));
      let d = .4; const headY = eye + .08;
      for (; d < 3.3; d += .15) { const x = player.x + camBack.x * d, z = player.z + camBack.z * d; if (colliders.some(b => x > b.x1 - .15 && x < b.x2 + .15 && z > b.z1 - .15 && z < b.z2 + .15) || headY + camBack.y * d > 2.85) break; }
      camera.position.set(player.x + camBack.x * d, headY + camBack.y * d, player.z + camBack.z * d);
    }
    camera.rotation.set(player.pitch, player.yaw + Math.PI, 0, 'YXZ');
  }
  function stepPlayer(dt) {
    const forward = inputOn ? (keys.w || keys.ArrowUp ? 1 : 0) - (keys.s || keys.ArrowDown ? 1 : 0) + touchMove.forward : 0, strafe = inputOn ? (keys.d || keys.ArrowRight ? 1 : 0) - (keys.a || keys.ArrowLeft ? 1 : 0) + touchMove.strafe : 0;
    blockers.length = 0; blockers.push(...stepDoors(AUTO_DOORS, doorStates, player, dt));
    for (const d of AUTO_DOORS) building.setDoor(d.id, doorStates[d.id] || 0);
    movePlayer(player, { forward, strafe, run: !!keys.shift, jump: jumpQueued }, dt, blockers.length ? [...colliders, ...blockers] : colliders, WORLD_BOUNDS); jumpQueued = false;
    const prompt = inputOn ? promptFor(player, people, MEETING_CHAIRS, chairTaken) : null, promptKey = prompt ? prompt.kind + (prompt.target || '') + prompt.text : '';
    if (promptKey !== lastPrompt) { lastPrompt = promptKey; o.onPrompt?.(prompt ? { kind: prompt.kind, text: prompt.text, target: prompt.target } : null); }
    const area = areaAt(player.x, player.z), id = area?.id || null;
    if (id !== lastArea) { lastArea = id; o.onArea?.(area); }
    if ((playerAge += dt) > .1) { playerAge = 0; o.onPlayer?.({ x: player.x, z: player.z, yaw: player.yaw }); }
  }
  /** Keep the few real lights on the lamps nearest to wherever you are looking from. */
  function placeLights() {
    const fx = mode === 'walk' ? player.x : controls.target.x, fz = mode === 'walk' ? player.z : controls.target.z;
    lightSpots.length = 0; for (const l of building.lamps) lightSpots.push([Math.hypot(l.x - fx, l.z - fz), l]);
    lightSpots.sort((a, b) => a[0] - b[0]);
    nearLights.forEach((l, i) => { const s = lightSpots[i]?.[1]; if (s) l.position.set(s.x, s.y, s.z); });
  }
  const showCeiling = on => { building.ceiling.visible = on; building.ceilingGlow.visible = on; };
  function setMode(next) {
    mode = next; showCeiling(next !== 'overview');
    controls.enabled = next === 'overview'; lightsAge = 99;
    camera.near = next === 'overview' ? .9 : .07; camera.fov = next === 'overview' ? MAP_FOV : camera.fov; camera.updateProjectionMatrix();
    scene.fog.near = next === 'overview' ? 90 : 34; scene.fog.far = next === 'overview' ? 210 : 120;
    if (next === 'overview') { o.onPrompt?.(null); lastPrompt = ''; lastArea = null; o.onArea?.(null); }
    o.onMode?.(next); renderer.shadowMap.needsUpdate = true;
  }
  /** Fly down to the street and hand over the controls. */
  function enterWalk(where) {
    if (mode === 'walk') return; follow = null; sel = null; clearKeys();
    const start = where || SPAWN; player.x = start.x; player.z = start.z; player.yaw = start.heading ?? SPAWN.heading; player.pitch = 0; player.y = 0; player.seat = null; inputOn = true;
    const from = camera.position.clone(), q0 = camera.quaternion.clone(), fov0 = camera.fov; controls.enabled = false; camera.near = .07;
    fly = { walk: true, t: 0, from, q0, fov0, to: new THREE.Vector3(player.x, WALK.eye, player.z), q1: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, player.yaw + Math.PI, 0, 'YXZ')) };
    if (reduce) fly.t = 1;
  }
  function exitWalk() {
    if (mode !== 'walk') return; release(); clearKeys(); standUp(player);
    setMode('overview'); camera.fov = MAP_FOV; camera.updateProjectionMatrix();
    camera.position.set(...fit(OVERVIEW)); controls.target.set(...OVERVIEW.target); camera.rotation.order = 'YXZ'; controls.update();
    AUTO_DOORS.forEach(d => { doorStates[d.id] = 0; building.setDoor(d.id, 0); });
  }

  /* ---------- loop ---------- */
  let last = performance.now(), T = 0, visible = true, frameNo = 0, slow = 0, timed = 0;
  const lastCam = new THREE.Matrix4(), _ring = new THREE.Matrix4(), _ringC = new THREE.Color();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const raw = (now - last) / 1000, dt = Math.min(.05, raw); last = now;
    if (!paused) {
      T += dt * speed; people.forEach(p => step(p, dt * speed)); ambient.forEach(a => step(a, dt * speed));
      if (!reduce) { staffStep(cleaner); for (const a of roamers) if (!a.path.length && rnd() < .004) roam(a); }
      routine(dt * speed);
    }
    if (!visible) return;
    frameNo++;
    if (mode === 'walk' && !paused) stepPlayer(Math.min(dt, .05));
    crowd.begin(); for (const p of people) drawPerson(p, T); for (const a of ambient) { if (a.path.length) a.sitting = false; else if (a.extras.sit) a.sitting = true; drawPerson(a, T); }
    if (mode === 'walk' && thirdPerson && !player.seat) { const moving = Math.hypot(player.vx, player.vz) > .1; const fig = { phase: 1, sitting: false, path: moving ? [{}] : [], status: 'idle' }; crowd.drawFigure(player.x, player.y, player.z, player.yaw, characterMotion(fig, T * (keys.shift ? 1.5 : 1), null, reduce), playerLook, false); }
    crowd.end();
    let ringN = 0; for (const p of people) { const show = p === sel || !!workStatus(p); if (!show) continue; _ring.makeTranslation(p.x, .05, p.z); rings.setMatrixAt(ringN, _ring); rings.setColorAt(ringN, _ringC.set(p === sel ? '#ffd338' : STATUS_COL[p.status] || '#ffd338')); ringN++; } rings.count = ringN; rings.instanceMatrix.needsUpdate = true; if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    if (fly?.walk) {
      fly.t = Math.min(1, fly.t + Math.min(raw, .4) / 1.5); const k = fly.t < .5 ? 4 * fly.t ** 3 : 1 - Math.pow(-2 * fly.t + 2, 3) / 2;
      camera.position.lerpVectors(fly.from, fly.to, k); camera.quaternion.slerpQuaternions(fly.q0, fly.q1, k); camera.fov = fly.fov0 + (WALK_FOV - fly.fov0) * k; camera.updateProjectionMatrix(); if (k > .72) showCeiling(true);
      if (fly.t >= 1) { fly = null; setMode('walk'); camera.fov = WALK_FOV; camera.updateProjectionMatrix(); }
    } else if (mode === 'walk') walkCamera();
    else {
      if (fly) { fly.t = Math.min(1, fly.t + Math.min(raw, .4) * 1.1); const k = 1 - Math.pow(1 - fly.t, 3); controls.target.lerpVectors(fly.ft, fly.tt, k); camera.position.lerpVectors(fly.fp, fly.tp, k); if (fly.t >= 1) fly = null; }
      else if (follow && !follow.sitting) { const d = new THREE.Vector3(follow.x, 0, follow.z).sub(controls.target).multiplyScalar(.06); controls.target.add(d); camera.position.add(d); }
      controls.update();
    }
    if (++lightsAge > 20) { lightsAge = 0; placeLights(); }
    if (shadowsOn && frameNo % 6 === 1) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    const moved = !lastCam.equals(camera.matrixWorld);
    if (moved) lastCam.copy(camera.matrixWorld);
    if (moved || frameNo % 2 === 0) hud();
    // if the device cannot keep up, lower the resolution, then switch shadows off
    if (quality > 0 && raw < .5) { timed++; if (raw > 1 / 32) slow++; if (timed >= 90) { if (slow > 60) degrade(); timed = slow = 0; } }
  }
  function degrade() {
    quality--;
    if (quality === 1 && pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); resize(); }
    else { quality = 0; shadowsOn = false; key.castShadow = false; crowd.setShadows(false); renderer.shadowMap.needsUpdate = true; }
  }
  let inset = 0;
  function resize() {
    const fs = document.fullscreenElement === host, w = host.clientWidth || 800;
    const h = fs || o.fill ? Math.max(320, host.clientHeight) : Math.max(460, Math.min(innerHeight - 150, w * .72));
    renderer.setSize(w, h, false); canvas.style.height = h + 'px'; camera.aspect = w / h;
    if (inset && w > 860 && mode === 'overview') camera.setViewOffset(w, h, inset / 2, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix(); avoidAge = 99;
  }
  // on narrow screens the view steps back so the whole building still fits across
  function fit(v) { const w = host.clientWidth || 800, a = (w - (inset && w > 860 ? inset : 0)) / Math.max(1, host.clientHeight || 600), k = Math.min(3.4, Math.max(1, 1.5 / a)); return v.pos.map((c, i) => v.target[i] + (c - v.target[i]) * k); }
  resize(); camera.position.set(...fit(OVERVIEW)); raf = requestAnimationFrame(frame);
  // the host can change size without the window doing so: a banner appearing, a stylesheet arriving
  const sizeWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!disposed) resize(); }) : null; sizeWatch?.observe(host);

  /* ---------- camera moves for buttons and keys ---------- */
  const sphere = new THREE.Spherical(), off = new THREE.Vector3();
  function orbit(dTheta, dPhi, scale = 1) {
    if (mode !== 'overview') return;
    fly = null; follow = null; off.copy(camera.position).sub(controls.target); sphere.setFromVector3(off);
    sphere.theta += dTheta; sphere.phi = Math.min(controls.maxPolarAngle, Math.max(controls.minPolarAngle, sphere.phi + dPhi));
    sphere.radius = Math.min(controls.maxDistance, Math.max(controls.minDistance, sphere.radius * scale));
    off.setFromSpherical(sphere); camera.position.copy(controls.target).add(off);
  }
  function pan(right, forward) {
    if (mode !== 'overview') return;
    fly = null; follow = null; const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x), k = camera.position.distanceTo(controls.target) * .08;
    const d = r.multiplyScalar(right * k).add(f.multiplyScalar(forward * k)); controls.target.add(d); camera.position.add(d);
  }
  const KEYS = { ArrowLeft: () => pan(-1, 0), ArrowRight: () => pan(1, 0), ArrowUp: () => pan(0, 1), ArrowDown: () => pan(0, -1), a: () => pan(-1, 0), d: () => pan(1, 0), w: () => pan(0, 1), s: () => pan(0, -1),
    q: () => orbit(.12, 0), e: () => orbit(-.12, 0), r: () => orbit(0, -.08), f: () => orbit(0, .08), '+': () => orbit(0, 0, .85), '=': () => orbit(0, 0, .85), '-': () => orbit(0, 0, 1.18) };
  canvas.tabIndex = 0;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  // keep the camera over the office
  controls.addEventListener('change', () => { const t = controls.target, cx = Math.max(-46, Math.min(46, t.x)), cz = Math.max(-34, Math.min(38, t.z)); if (cx !== t.x || cz !== t.z || t.y !== 0) { const d = new THREE.Vector3(cx - t.x, -t.y, cz - t.z); t.add(d); camera.position.add(d); } });
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
  }
  async function speak(p, text, kind, ms, signal, visitId) {
    const token = Symbol('speech'), meetingId = p.meetingId; p.speechToken = token; p.visitSpeaking = !!visitId;
    p.active = performance.now(); p.status = kind === 'thinking' ? 'thinking' : 'talking';
    p.bubble = text; p.bubbleKind = kind;
    if (!visitId) { p.log.unshift(text); p.log.length = Math.min(p.log.length, 3); }
    const finished = await sleep(ms, signal);
    if (p.speechToken === token) { clearSpeech(p); p.status = rest(p); }
    return finished && !disposed && (!visitId || p.visitId === visitId) && p.meetingId === meetingId;
  }
  const visits = createDirectDialogueController({
    hasAgent: id => typeof id === 'string' && Object.hasOwn(P, id),
    async arrive(session, signal) {
      const visitor = P[session.visitorId], recipient = P[session.recipientId];
      for (const p of [visitor, recipient]) {
        clearSpeech(p); stopMoving(p); p.breakToken = null; p.visitId = session.id; p.carry = p === visitor;
        p.faceTo = null; p.active = performance.now(); p.status = 'walking';
        p.task = p === visitor ? `Visiting ${recipient.name}` : `Conversation with ${visitor.name}`;
      }
      const point = standBy(recipient);
      // The recipient stays at their own desk. A prior animation may have
      // left them returning home, so finish that move before showing dialogue.
      const recipientHome = Math.hypot(recipient.x - recipient.home.x, recipient.z - recipient.home.z) < .05;
      if (recipientHome) { recipient.sitting = true; recipient.status = 'waiting'; }
      const [arrived, ready] = await Promise.all([goTo(visitor, point.x, point.z, signal), recipientHome ? Promise.resolve(true) : goTo(recipient, recipient.home.x, recipient.home.z, signal)]);
      if (!arrived || !ready || signal.aborted || disposed || visitor.meetingId || recipient.meetingId) return false;
      visitor.room = recipient.homeRoom; recipient.room = recipient.homeRoom; recipient.sitting = true;
      visitor.faceTo = recipient; recipient.faceTo = visitor;
      visitor.greetingAt = recipient.greetingAt = T;
      visitor.greetingSide = 1; recipient.greetingSide = 0;
      visitor.status = recipient.status = 'waiting';
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
        p.greetingAt = null;
        // Meeting movement has already replaced this visit's path. Never
        // cancel or overwrite it from a late visit completion.
        if (disposed || p.meetingId || isBlocked(id)) return;
        clearSpeech(p);
        stopMoving(p); p.faceTo = null; p.carry = false;
        p.status = 'walking'; p.task = 'Returning from the conversation';
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
        p.task = p.quest ? 'Waiting on an approval' : 'Waiting for the next job';
      }));
    },
  });
  function select(id) { sel = P[id] || null; follow = mode === 'overview' ? sel : null; if (sel) o.onSelect?.(sel); }
  /** Stand next to someone or in a room, on foot. Used by the floor plan and by Find. */
  function teleport(x, z, heading) { const spot = nearestOpen(nav, x, z); player.x = spot.x; player.z = spot.z; if (heading != null) player.yaw = heading; player.seat = null; player.pitch = 0; }
  function focusMeeting() {
    if (mode === 'walk') return teleport(meetingPoint.x - 5, meetingPoint.z + 3.6, Math.PI * .75);
    follow = null; untouched = false;
    const { x, z } = meetingPoint, pos = view === '2d' ? [x, 26, z + .01] : [x + 2, 13, z + 14];
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
    building.meetingScreen.update(active ? { title: next.title || 'Team meeting', status: next.status === 'planned' ? 'Everybody in. The team is gathering.' : `In progress · ${ids.length} agents`, lines: ids.map(id => P[id].name).slice(0, 4) } : {});
    for (const p of people) {
      if (p.meetingId && (!assigned.has(p.id) || p.meetingId !== next?.id)) {
        clearSpeech(p);
        p.meetingId = null; p.meetingSeatIndex = null; p.meetingSpeaking = false; p.seatHeading = null; p.faceTo = null; p.carry = false;
        p.status = 'walking'; p.task = 'Returning from the meeting';
        const returning = goTo(p, p.home.x, p.home.z);
        returning.then(arrived => {
          if (!arrived || disposed || p.meetingId) return;
          p.room = p.homeRoom; p.sitting = true; p.status = rest(p); p.task = p.quest ? 'Waiting on an approval' : 'Waiting for the next job';
        });
      }
    }
    if (!active) return;
    ids.forEach((id, index) => {
      const p = P[id], seat = meetingSeats[index];
      p.meetingSpeaking = next.speakerId === id || next.speaker_id === id;
      if (p.meetingId === next.id && p.meetingSeatIndex === index) { if (!p.path.length) { p.status = rest(p); } return; }
      clearSpeech(p); p.breakToken = null;
      p.meetingId = next.id; p.meetingSeatIndex = index; p.seatHeading = seat.heading; p.carry = false; p.faceTo = meetingPoint;
      p.active = performance.now(); p.status = 'walking'; p.task = `Meeting: ${next.title || 'Team discussion'}`;
      goTo(p, seat.x, seat.z).then(arrived => {
        if (!arrived || disposed || p.meetingId !== next.id || p.meetingSeatIndex !== index) return;
        p.room = meetingRoom; p.sitting = true; p.faceTo = meetingPoint; p.status = rest(p);
      });
    });
  }
  const anyArea = id => OFFICE_ROOMS.find(r => r.id === id) || OTHER_AREAS.find(r => r.id === id);
  function flyTo(id) {
    follow = null; let tgt, pos;
    const here = id && anyArea(id);
    if (mode === 'walk') {
      if (here) return teleport((here.x1 + here.x2) / 2, (here.z1 + here.z2) / 2);
      if (R[id]) return teleport(R[id].cx, R[id].cz);
      if (P[id]) return focus(id);
      return;
    }
    if (!id || B[id]) { const v = view === '2d' ? TOP_VIEW : OVERVIEW; tgt = v.target; pos = fit(v); }
    else if (id === 'meeting') return focusMeeting();
    else if (here) { const cx = (here.x1 + here.x2) / 2, cz = (here.z1 + here.z2) / 2, size = Math.max(here.x2 - here.x1, here.z2 - here.z1); tgt = [cx, 0, cz]; pos = view === '2d' ? [cx, size * 1.9 + 8, cz + .01] : [cx + 1, size * .9 + 6, cz + size * .95 + 6]; }
    else if (R[id]) { const r = R[id]; tgt = [r.cx, 0, r.cz]; pos = view === '2d' ? [r.cx, 24, r.cz + .01] : [r.cx + 2, 11, r.cz + 12]; }
    else if (P[id]) return focus(id);
    else return;
    fly = { t: 0, ft: controls.target.clone(), fp: camera.position.clone(), tt: new THREE.Vector3(...tgt), tp: new THREE.Vector3(...pos) };
  }
  function focus(id) {
    const p = P[id]; if (!p) return;
    if (mode === 'walk') { const standX = p.x - Math.sin(p.homeHeading) * 1.5, standZ = p.z - Math.cos(p.homeHeading) * 1.5; teleport(standX, standZ, Math.atan2(p.x - standX, p.z - standZ)); return; }
    if (p.meetingId) focusMeeting();
    else fly = { t: 0, ft: controls.target.clone(), fp: camera.position.clone(), tt: new THREE.Vector3(p.x, 0, p.z), tp: new THREE.Vector3(p.x + 2, view === '2d' ? 20 : 9, p.z + (view === '2d' ? .01 : 10)) };
    sel = p; o.onSelect?.(p);
  }
  function setView(v) {
    view = v === '2d' ? '2d' : '3d'; if (mode !== 'overview') return;
    controls.enableRotate = view === '3d'; controls.minPolarAngle = view === '2d' ? 0 : .02; controls.maxPolarAngle = view === '2d' ? .02 : 1.32;
    const vw = view === '2d' ? TOP_VIEW : OVERVIEW;
    fly = { t: 0, ft: controls.target.clone(), fp: camera.position.clone(), tt: new THREE.Vector3(...vw.target), tp: new THREE.Vector3(...fit(vw)) };
  }
  const api = {
    people, byId: P, rooms: R, buildings: B, sleep, staff: ambient,
    get paused() { return paused; }, setPaused(v) { paused = v; }, get speed() { return speed; }, setSpeed(v) { speed = v; },
    flyTo, focus, select, orbit, pan,
    setMeeting, focusMeeting, get meeting() { return currentMeeting; },
    directDialogue: value => visits.directDialogue(value),
    cancelDialogue: id => visits.cancelDialogue(id),
    /** Replace authoritative current work. It never changes movement or speech. */
    setWorkStatuses(snapshot) { if (!disposed) workStatuses = normalizeWorkStatuses(snapshot, people.map(p => p.id)); },
    // Locate the recipient's desk without selecting them or opening a drawer.
    locateDialogue(id) { if (P[id]) flyTo(P[id].homeRoom.id); },
    get view() { return view; }, setView,
    /** On foot or above. */
    get mode() { return mode; }, enterWalk, exitWalk, interact,
    get thirdPerson() { return thirdPerson; }, toggleThirdPerson() { thirdPerson = !thirdPerson; },
    /** While a chat or menu is open, keys go to it and you stop walking. */
    setInputEnabled(v) { inputOn = !!v; clearKeys(); if (!inputOn) { release(); lastPrompt = ''; o.onPrompt?.(null); } },
    /** Hand the mouse back to walking after a menu or chat closes. */
    capturePointer() { if (mode === 'walk' && matchMedia('(pointer: fine)').matches) canvas.requestPointerLock?.()?.catch?.(() => {}); },
    /** Joystick input on touch screens, each axis -1..1. */
    setTouchMove(forward, strafe) { touchMove.forward = forward; touchMove.strafe = strafe; },
    /** What the Project Board on the workspace wall shows. */
    setBoard(data) { building.projectBoard.update(data); },
    /** Where everyone is right now, for the floor plan. */
    positions() { return people.map(p => ({ id: p.id, x: p.x, z: p.z, working: !!workStatus(p) && isWorkingStatus(workStatuses[p.id], Date.now()), waiting: workStatuses[p.id]?.state === 'waiting' || workStatuses[p.id]?.state === 'blocked' })); },
    player: () => ({ x: player.x, z: player.z, yaw: player.yaw }),
    /** Stand somewhere else, on foot. */
    teleport,
    /** Width in pixels covered by a panel on the right; the scene centres itself in the rest. */
    setInset(px) { inset = px || 0; resize(); if (untouched && !fly && view === '3d' && mode === 'overview') camera.position.set(...fit(OVERVIEW)); },
    turn(deg) { orbit(deg * Math.PI / 180, 0); }, tilt(deg) { orbit(0, deg * Math.PI / 180); }, zoom(f) { orbit(0, 0, f); },
    fullscreen() { return document.fullscreenElement ? document.exitFullscreen() : host.requestFullscreen?.(); }, get selected() { return sel; }, resize,
    setVisible(v) { visible = v; labels.style.display = v ? '' : 'none'; if (v) resize(); },
    /**
     * Occupancy counts fresh execution leases only. Speech, walks and approval
     * waits stay visible overhead without claiming the agent is executing work.
     */
    stats() { const now = Date.now(), ai = l => l.filter(p => !p.human);
      const active = l => ai(l).filter(p => isWorkingStatus(workStatuses[p.id], now)).length;
      return { total: ai(people).length, active: active(people), buildings: Object.values(B).map(b => ({ id: b.id, name: b.short, total: ai(b.people).length, active: active(b.people), rooms: b.rooms })) }; },
    info() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, quality }; },
    async walkTo(id, toId) { const p = P[id], b = P[toId]; if (!p || !b || p.meetingId || b.meetingId || visits.isReserved(id) || visits.isReserved(toId)) return; p.active = performance.now(); p.status = 'walking'; p.task = `Walking to ${b.name}`; p.faceTo = null; const point = standBy(b); const arrived = await goTo(p, point.x, point.z); if (!arrived || disposed || p.meetingId || visits.isReserved(id)) return; p.room = b.homeRoom; p.faceTo = b; p.status = rest(p); },
    async walkHome(id) { const p = P[id]; if (!p || p.meetingId || visits.isReserved(id)) return; p.status = 'walking'; p.faceTo = null; const arrived = await goTo(p, p.home.x, p.home.z); if (!arrived || disposed || p.meetingId || visits.isReserved(id)) return; p.room = p.homeRoom; p.sitting = true; p.status = rest(p); p.task = p.quest ? 'Waiting on an approval' : 'Waiting for the next job'; },
    async say(id, text, kind = 'talking', ms = 2600) { const p = P[id]; if (!p || (visits.isReserved(id) && !p.meetingId)) return; return speak(p, dialogueBubble(text), kind, Math.min(8_000, ms + dialogueBubble(text).length * 20)); },
    async think(id, text, ms = 2600) { const p = P[id]; if (!p || p.meetingId || visits.isReserved(id)) return; p.task = text; return speak(p, dialogueBubble(text) + '…', 'thinking', Math.min(8_000, ms)); },
    setCarry(id, v) { if (P[id] && !P[id].meetingId && !visits.isReserved(id)) { P[id].carry = v; } },
    setQuest(id, v) { const p = P[id]; if (!p) return; p.quest = v; if (!p.meetingId && !visits.isReserved(id)) { if (p.sitting && !p.bubble) p.status = v ? 'waiting' : 'idle'; p.task = v ? 'Waiting on an approval' : 'Nothing waiting'; } },
    dispose() {
      disposed = true; sizeWatch?.disconnect(); visits.dispose(); people.forEach(stopMoving); release();
      cancelAnimationFrame(raf); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave); canvas.removeEventListener('pointercancel', onLeave); canvas.removeEventListener('click', onCanvasClick);
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', clearKeys);
      document.removeEventListener('pointerlockchange', onPointerLock); document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('fullscreenchange', onFs);
      labels.removeEventListener('wheel', onLabelWheel, { capture: true }); controls.dispose();
      const geos = new Set(), mats = new Set(), textures = new Set();
      scene.traverse(node => { if (node.geometry) geos.add(node.geometry); if (node.material) for (const m of Array.isArray(node.material) ? node.material : [node.material]) mats.add(m); });
      for (const m of mats) for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
      geos.forEach(g => g.dispose()); textures.forEach(t => t.dispose()); mats.forEach(m => m.dispose()); renderer.dispose(); labels.innerHTML = '';
    },
  };
  return api;
}
