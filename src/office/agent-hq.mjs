// Agent HQ: the whole AI team as one dark room. Each department is a station that sleeps until real work wakes it.
// Everything shown here comes from live work status and agent events, never a replay.

const ASLEEP_Z = ['z', 'z', 'z'];
export const HQ_STATES = { asleep: 'ASLEEP', working: 'WORKING', thinking: 'THINKING', waiting: 'WAITING', blocked: 'BLOCKED', ok: 'WAITING FOR OK' };

/** Sort departments into the rows of the room. */
export function hqLayout(departments, perRow = 7) {
  return departments.map((d, i) => { const row = Math.floor(i / perRow), inRow = Math.min(perRow, departments.length - row * perRow), col = i - row * perRow; return { ...d, row, col, x: (col - (inRow - 1) / 2) * 4.3, z: row * 4.9 - 3.2 }; });
}

export function createAgentHq({ THREE, canvas, labels, host, departments, onOpen, inset: startInset = 0 }) {
  THREE.ColorManagement.legacyMode = false;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#0c0a08'); scene.fog = new THREE.Fog('#0c0a08', 30, 62);
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 1, 200); camera.position.set(0, 25, 27); camera.lookAt(0, 1.6, -.2);
  scene.add(new THREE.HemisphereLight('#d9c7ad', '#1d1712', .55));
  const key = new THREE.DirectionalLight('#ffe7c7', .55); key.position.set(-8, 30, 18); scene.add(key);

  // floor and back wall, in long planks
  const planks = (w, h, a, b) => { const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d'); g.fillStyle = a; g.fillRect(0, 0, 512, 512); for (let i = 0; i < 8; i++) { g.fillStyle = b; g.fillRect(i * 64, 0, 2, 512); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / 12, h / 12); t.encoding = THREE.sRGBEncoding; return t; };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.MeshLambertMaterial({ map: planks(90, 70, '#2a1d13', '#1a110a') })); floor.rotation.x = -Math.PI / 2; floor.position.z = 6; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(90, 26), new THREE.MeshLambertMaterial({ map: planks(90, 26, '#231710', '#120b07') })); wall.position.set(0, 12, -10); scene.add(wall);

  // the orb at the head of the room: the AI CMO that every team reports to
  const orb = new THREE.Group(); orb.position.set(0, 6.6, -7.6); scene.add(orb);
  orb.add(new THREE.Mesh(new THREE.SphereGeometry(1.15, 32, 20), new THREE.MeshBasicMaterial({ color: '#f0a586', toneMapped: false })));
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.75, 1), new THREE.MeshBasicMaterial({ color: '#c88a63', wireframe: true, transparent: true, opacity: .45 })); orb.add(shell);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, .018, 6, 72), new THREE.MeshBasicMaterial({ color: '#f0c7a8', toneMapped: false })); ring.rotation.x = Math.PI / 2.25; orb.add(ring);
  const orbGlow = new THREE.PointLight('#f2a97c', .9, 18, 1.6); orbGlow.position.copy(orb.position); scene.add(orbGlow);

  // shared meshes for every station
  const layout = hqLayout(departments), N = layout.length;
  const bodyM = new THREE.MeshLambertMaterial({ color: '#ffffff' }), deskM = new THREE.MeshLambertMaterial({ color: '#4b2f1c' }), darkM = new THREE.MeshLambertMaterial({ color: '#141417' }), cupM = new THREE.MeshLambertMaterial({ color: '#e6e0d3' }), skin = new THREE.MeshLambertMaterial({ color: '#f1e8db' });
  const mk = (geo, mat, n = N) => { const m = new THREE.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); return m; };
  const bodies = mk(new THREE.CapsuleGeometry(.42, .62, 6, 14), bodyM), heads = mk(new THREE.SphereGeometry(.42, 18, 14), skin), hoods = mk(new THREE.SphereGeometry(.46, 18, 14, 0, Math.PI * 2, 0, Math.PI * .55), bodyM), desks = mk(new THREE.BoxGeometry(2.5, .12, 1.2), deskM), laptops = mk(new THREE.BoxGeometry(.72, .46, .05), darkM), cups = mk(new THREE.CylinderGeometry(.08, .07, .18, 8), cupM);
  bodies.setColorAt(0, new THREE.Color('#fff')); hoods.setColorAt(0, new THREE.Color('#fff'));
  const legs = mk(new THREE.BoxGeometry(.1, 1, 1), deskM, N * 2);
  const halo = mk(new THREE.RingGeometry(1.5, 1.72, 40), new THREE.MeshBasicMaterial({ color: '#ffd338', transparent: true, opacity: .9, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
  const pool = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,211,56,.5)'); r.addColorStop(.6, 'rgba(255,190,50,.12)'); r.addColorStop(1, 'rgba(255,190,50,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return mk(new THREE.PlaneGeometry(5.6, 5.6), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })); })();

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), hide = new THREE.Vector3(0, 0, 0), col = new THREE.Color();
  const put = (mesh, i, x, y, z, rx = 0, ry = 0, rz = 0, scale = s) => { m4.compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), scale); mesh.setMatrixAt(i, m4); };
  layout.forEach((d, i) => {
    put(desks, i, d.x, .82, d.z + .5); put(laptops, i, d.x, 1.12, d.z + .7, -.2); put(cups, i, d.x + .9, .97, d.z + .55);
    put(legs, i * 2, d.x - 1.1, .41, d.z + .5, 0, 0, 0, new THREE.Vector3(.8, .82, .9)); put(legs, i * 2 + 1, d.x + 1.1, .41, d.z + .5, 0, 0, 0, new THREE.Vector3(.8, .82, .9));
    bodies.setColorAt(i, col.set(d.color)); hoods.setColorAt(i, col.set(d.color));
  });

  // a card and sleeping Zs per station, over the canvas
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cards = layout.map(d => {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'hq-card'; el.style.setProperty('--dept', d.color); el.dataset.state = 'asleep';
    el.innerHTML = `<span class="hq-card-top"><b>${esc(d.short)}</b><em>ASLEEP</em></span><span class="hq-card-role">${esc(d.role || '')}</span><span class="hq-card-log"></span><span class="hq-card-foot"></span>`;
    el.setAttribute('aria-label', `${d.name}: asleep. Open ${d.lead || 'team lead'}.`); el.onclick = () => onOpen?.(d.id); labels.appendChild(el);
    const zs = document.createElement('div'); zs.className = 'hq-zs'; zs.setAttribute('aria-hidden', 'true'); zs.innerHTML = ASLEEP_Z.map(z => `<i>${z}</i>`).join(''); labels.appendChild(zs);
    return { d, el, zs, pill: el.querySelector('em'), log: el.querySelector('.hq-card-log'), foot: el.querySelector('.hq-card-foot'), state: 'asleep', wake: 0, key: '' };
  });
  const orbLabel = document.createElement('div'); orbLabel.className = 'hq-orb-label'; labels.appendChild(orbLabel);

  function update(data) {
    for (const c of cards) {
      const now = data.departments?.[c.d.id] || { state: 'asleep' }, key = JSON.stringify(now);
      if (key === c.key) continue; c.key = key; c.state = now.state;
      c.el.dataset.state = now.state; c.pill.textContent = HQ_STATES[now.state] || 'ASLEEP';
      c.log.replaceChildren(...(now.lines || []).slice(0, 3).map(l => { const row = document.createElement('i'); row.textContent = l; return row; }));
      c.foot.textContent = now.state === 'ok' ? 'WAITING FOR YOUR OK' : now.workers ? `${now.workers} of ${c.d.count} working` : '';
      c.el.setAttribute('aria-label', `${c.d.name}: ${(HQ_STATES[now.state] || 'asleep').toLowerCase()}. Open ${c.d.lead || 'team lead'}.`);
    }
    orbLabel.innerHTML = `<b>AI CMO</b><span>${esc(data.summary || '')}</span>`;
  }

  /* ---------- loop ---------- */
  let raf = 0, last = performance.now(), T = 0, disposed = false;
  const project = (x, y, z) => { v.set(x, y, z).project(camera); return { x: (v.x + 1) / 2 * canvas.clientWidth, y: (1 - v.y) / 2 * canvas.clientHeight }; };
  const scaled = new THREE.Vector3(), zero = new THREE.Vector3(1e-4, 1e-4, 1e-4);
  function frame(now) {
    raf = requestAnimationFrame(frame); const dt = Math.min(.05, (now - last) / 1000); last = now; T += dt;
    if (!reduce) { shell.rotation.y = T * .12; shell.rotation.x = T * .05; ring.rotation.z = T * .1; }
    const W = canvas.clientWidth, compact = W < 1000;
    cards.forEach((c, i) => {
      const awake = c.state !== 'asleep'; c.wake += ((awake ? 1 : 0) - c.wake) * Math.min(1, dt * 4); const k = c.wake, { x, z } = c.d;
      // asleep: slumped over the desk. awake: upright and looking up.
      const breathe = reduce ? 0 : Math.sin(T * 1.6 + i) * .02, slump = (1 - k) * .75, bodyY = .88 + k * .45 + breathe;
      put(bodies, i, x, bodyY, z - .25, slump); put(heads, i, x, bodyY + .86 - slump * .35, z - .25 + slump * .72); put(hoods, i, x, bodyY + .9 - slump * .35, z - .29 + slump * .72, -.25 + slump);
      if (k > .02) { put(halo, i, x, .05, z + .2, -Math.PI / 2); put(pool, i, x, .04, z + .2, -Math.PI / 2); halo.material.opacity = .9; }
      else { m4.compose(v.set(x, -5, z), q.identity(), zero); halo.setMatrixAt(i, m4); pool.setMatrixAt(i, m4); }
      const top = project(x, 2.75, z - .25), sz = project(x + .45, 2.4 - slump, z - .25);
      c.el.style.transform = `translate(${top.x.toFixed(1)}px,${top.y.toFixed(1)}px) translate(-50%,-100%)`;
      c.zs.style.transform = `translate(${sz.x.toFixed(1)}px,${sz.y.toFixed(1)}px)`; c.zs.hidden = c.state !== 'asleep' || compact;
    });
    for (const mesh of [bodies, heads, hoods, halo, pool]) mesh.instanceMatrix.needsUpdate = true;
    const o = project(orb.position.x + 2.8, orb.position.y + 1, orb.position.z); orbLabel.style.transform = `translate(${o.x.toFixed(1)}px,${o.y.toFixed(1)}px)`;
    renderer.render(scene, camera);
  }
  let inset = 0;
  function resize() {
    const w = host.clientWidth || 800, h = Math.max(320, host.clientHeight || 600); renderer.setSize(w, h, false); canvas.style.height = h + 'px'; camera.aspect = w / h;
    // step back on narrow screens so every station stays in view, and centre the room beside the log
    const room = inset && w > 760 ? w - inset : w, k = Math.max(1, 1.5 / (room / h));
    camera.position.set(0, 25 * k, 27 * k); camera.lookAt(0, 1.6, -.2);
    if (inset && w > 760) camera.setViewOffset(w, h, inset / 2, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  inset = startInset; resize(); bodies.instanceColor.needsUpdate = true; hoods.instanceColor.needsUpdate = true; raf = requestAnimationFrame(frame);
  const onResize = () => resize(); addEventListener('resize', onResize);
  const sizeWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null; sizeWatch?.observe(host);
  return { update, resize, setInset(px) { inset = px || 0; resize(); }, dispose() { if (disposed) return; disposed = true; sizeWatch?.disconnect(); cancelAnimationFrame(raf); removeEventListener('resize', onResize); for (const c of cards) { c.el.remove(); c.zs.remove(); } orbLabel.remove(); const geos = new Set(), mats = new Set(); scene.traverse(n => { if (n.geometry) geos.add(n.geometry); if (n.material) mats.add(n.material); }); for (const m of mats) { for (const val of Object.values(m)) if (val?.isTexture) val.dispose(); m.dispose(); } geos.forEach(g => g.dispose()); renderer.dispose(); } };
}
