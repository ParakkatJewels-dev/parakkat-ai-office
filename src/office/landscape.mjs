// Architectural planting, built once and included in the campus's material batches.
// Shared foliage textures and reusable geometry keep dense planting inexpensive.
export function createLandscape({ THREE, stat, M, tex, rnd, sh = m => m }) {
  const TAU = Math.PI * 2;
  const barkMap = tex((g, w, h) => {
    g.fillStyle = '#aa9b83'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) {
      const x = rnd() * w;
      g.strokeStyle = i % 3 ? 'rgba(65,49,31,.28)' : 'rgba(235,220,190,.25)';
      g.lineWidth = .5 + rnd() * 2; g.beginPath(); g.moveTo(x, 0);
      for (let y = 16; y <= h; y += 16) g.lineTo(x + Math.sin(y / 24 + i) * 2, y);
      g.stroke();
    }
  }, 128, 256);
  const leafMap = tex((g, w, h) => {
    g.fillStyle = '#4d6738'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1900; i++) {
      const x = rnd() * w, y = rnd() * h, l = 2 + rnd() * 5, angle = rnd() * TAU;
      g.fillStyle = ['#729451', '#93ab63', '#405b31', '#abc177', '#567b3f'][i % 5];
      g.beginPath(); g.ellipse(x, y, l, l * .42, angle, 0, TAU); g.fill();
      if (i % 5 === 0) {
        g.strokeStyle = 'rgba(215,223,156,.35)'; g.lineWidth = .5;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(angle) * l, y + Math.sin(angle) * l); g.stroke();
      }
    }
  }, 256, 256, [2, 1]);
  const branchM = M('#897962', { map: barkMap, roughness: .96 });
  const palmM = M('#b5a18b', { map: barkMap, roughness: .9 });
  const foliage = ['#658058', '#789462', '#91a873', '#56764f', '#a2ac70'].map(color =>
    M(color, { map: leafMap, roughness: .88 }));
  // Keep the procedural crowns available until the image arrives. The cutouts
  // never draw an opaque loading rectangle, and a failed image leaves full trees.
  const fallbackFoliage = foliage.map(material => material.clone());
  const cutoutFoliage = ['#d4dfc8', '#e2e5cc', '#b8cba8'].map(color =>
    new THREE.MeshStandardMaterial({ color, roughness: .9, envMapIntensity: .14,
      alphaTest: .45, depthWrite: true, transparent: false, side: THREE.DoubleSide,
      visible: false }));
  let disposed = false;
  cutoutFoliage[0].addEventListener('dispose', () => { disposed = true; });
  const cutoutMap = new THREE.TextureLoader().load('/office/foliage-cluster.png', loaded => {
    if (disposed) { loaded.dispose(); return; }
    loaded.encoding = THREE.sRGBEncoding;
    loaded.wrapS = loaded.wrapT = THREE.ClampToEdgeWrapping;
    loaded.anisotropy = 4;
    loaded.needsUpdate = true;
    cutoutFoliage.forEach(material => { material.visible = true; material.needsUpdate = true; });
    fallbackFoliage.forEach(material => { material.visible = false; });
  }, undefined, () => { /* The complete procedural crowns remain visible. */ });
  // Retain the pending texture on scene-owned materials so disposal can collect
  // it even when navigation happens before TextureLoader finishes.
  cutoutFoliage.forEach(material => { material.map = cutoutMap; });
  const frondM = ['#31512a', '#486f30', '#718647'].map(color => M(color, { roughness: .78, side: THREE.DoubleSide }));
  const stemM = M('#9d9a58', { roughness: .87 });
  const coconutM = M('#736d3c', { roughness: .95 });
  const cluster = new THREE.SphereGeometry(1, 10, 7);
  // Surface variation is continuous at the texture seam, unlike per-vertex random offsets.
  const p = cluster.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = 1 + .08 * Math.sin(x * 10 + y * 6) * Math.cos(z * 8 - y * 4);
    p.setXYZ(i, x * r, y * r, z * r);
  }
  cluster.computeVertexNormals();
  const crownCore = new THREE.SphereGeometry(1, 8, 5);
  const leafCard = new THREE.PlaneGeometry(1, 1);
  const twigGeo = new THREE.CylinderGeometry(.48, 1, 1, 7);
  const coconutGeo = new THREE.SphereGeometry(.16, 7, 5);
  const up = new THREE.Vector3(0, 1, 0);
  const add = (geo, mat, x, y, z, sx = 1, sy = sx, sz = sx, shadow = true) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    if (shadow) sh(m); else m.receiveShadow = true;
    stat.add(m); return m;
  };
  const branch = (a, b, radius, mat = branchM, shadow = true) => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), d = vb.clone().sub(va);
    const m = add(twigGeo, mat, ...(va.add(vb).multiplyScalar(.5)).toArray(), radius, d.length(), radius, shadow);
    m.quaternion.setFromUnitVectors(up, d.normalize()); return m;
  };

  function tree(x, z, s = 1) {
    // Keep both road avenues clear, including their pavement.
    if (Math.abs(x) > 101 && Math.abs(x) < 119) return;
    const shadow = Math.abs(x) < 97 && z < 61 && z > -50;
    const h = (5.5 + rnd() * 1.5) * s, crown = (1.85 + rnd() * .45) * s;
    const leanX = (rnd() - .5) * .5 * s, leanZ = (rnd() - .5) * .5 * s;
    branch([x, -.3, z], [x + leanX, h * .7, z + leanZ], .23 * s, branchM, shadow);
    // Slightly different heights and silhouettes prevent a row of identical trees.
    const style = (rnd() * 3) | 0, stretch = style === 1 ? 1.22 : style === 2 ? .83 : 1;
    for (let k = 0; k < 7; k++) {
      const angle = k * 2.39996 + rnd() * .4, outer = k < 5;
      const r = outer ? crown * (.6 + rnd() * .3) : crown * .32;
      const cy = h * (outer ? .64 + rnd() * .19 : .9), cx = x + Math.cos(angle) * r, cz = z + Math.sin(angle) * r;
      if (outer) branch([x + leanX * .5, h * .35, z + leanZ * .5], [cx, cy, cz], .07 * s, branchM, shadow);
      const size = crown * (.63 + rnd() * .19);
      const depth = .8 + rnd() * .3;
      const m = add(cluster, fallbackFoliage[(k + style) % foliage.length], cx, cy, cz, size, size * stretch, size * depth, shadow);
      m.rotation.y = angle; m.rotation.z = (rnd() - .5) * .4;
      // A smaller dark centre gives depth between leaf layers. Three crossed
      // upright planes and a tilted top plane maintain the foliage silhouette
      // as the user orbits or switches to the overhead view.
      add(crownCore, foliage[3], cx, cy, cz, size * .56, size * stretch * .58, size * depth * .56, shadow);
      for (let card = 0; card < 4; card++) {
        const f = add(leafCard, cutoutFoliage[(k + card) % 3], cx, cy, cz,
          size * 2.35, size * 2.35 * (card === 3 ? depth : stretch), 1, shadow);
        f.rotation.set(card === 3 ? -Math.PI / 2 + .18 : .1 * Math.sin(k + card), angle + card * Math.PI / 3, (card % 2 ? 1 : -1) * .13);
      }
    }
    add(cluster, foliage[3], x + leanX, h * .64, z + leanZ, crown * .68, crown * .59, crown * .68, shadow);
    // Tree pits ground the trunk rather than leaving it floating on a flat lawn.
    if (z > -40 && z < 61) {
      const mulch = M('#4e4931', { roughness: 1 });
      const pit = add(new THREE.CircleGeometry(.65 * s, 16), mulch, x, -.305, z, 1, 1, 1, false);
      pit.rotation.x = -Math.PI / 2;
    }
  }

  // A gently arching frond with individual tapered leaflets. These read as palm
  // leaves from every camera angle, rather than as triangular cones or billboards.
  function frondGeometry(length, droop) {
    const vertices = [], uvs = [];
    const center = t => new THREE.Vector3(t * length, Math.sin(t * Math.PI) * length * .23 - t * t * droop, 0);
    const tri = (a, b, c) => { vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray()); uvs.push(0, 0, 1, 0, .5, 1); };
    for (let i = 0; i < 14; i++) {
      const t = .08 + i * .061, a = center(t), b = center(Math.min(.99, t + .045));
      const width = Math.sin(t * Math.PI) * length * .23;
      for (const side of [-1, 1]) {
        const tip = new THREE.Vector3(a.x + length * .12, a.y - width * .28, side * width);
        const fold = new THREE.Vector3(a.x + length * .05, a.y + .035, side * width * .35);
        tri(a, fold, tip); tri(fold, b, tip);
      }
      const ca = center(i / 14), cb = center((i + 1) / 14);
      tri(new THREE.Vector3(ca.x, ca.y, -.025), new THREE.Vector3(ca.x, ca.y, .025), new THREE.Vector3(cb.x, cb.y, 0));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals(); return geo;
  }
  const fronds = [frondGeometry(3.8, 1.1), frondGeometry(3.35, .6), frondGeometry(2.7, -.2)];
  function palm(x, z, s = 1) {
    const yaw = rnd() * TAU, dx = Math.cos(yaw) * .75 * s, dz = Math.sin(yaw) * .75 * s, h = 6.3 * s;
    let previous = [x, -.3, z];
    for (let i = 1; i <= 9; i++) {
      const t = i / 9, next = [x + dx * t * t, -.3 + h * t, z + dz * t * t];
      branch(previous, next, (.19 - t * .07) * s, palmM); previous = next;
    }
    const [cx, cy, cz] = previous;
    for (let k = 0; k < 11; k++) {
      const tier = k < 6 ? 0 : k < 9 ? 1 : 2;
      const m = add(fronds[tier], frondM[k % 3], cx, cy + tier * .09 * s, cz, s);
      m.rotation.y = yaw + k * 2.39996; m.rotation.z = tier === 2 ? .6 : .08;
    }
    for (let k = 0; k < 5; k++) add(coconutGeo, coconutM, cx + Math.cos(k * TAU / 5) * .22 * s, cy - .23 * s, cz + Math.sin(k * TAU / 5) * .22 * s, s);
    branch([cx, cy - .2 * s, cz], [cx, cy + .55 * s, cz], .13 * s, stemM);
  }

  function hedge(width, depth, x, z, height = .75) {
    // Rounded overlapping shrubs preserve the clipped hedge shape without the
    // solid green cuboid silhouette of the previous planting.
    const count = Math.max(1, Math.ceil(width / .8)), spacing = width / count;
    for (let i = 0; i < count; i++) {
      const cx = x - width / 2 + spacing * (i + .5);
      const m = add(cluster, foliage[i % 3], cx, height * .5 - .2, z + (rnd() - .5) * depth * .1,
        spacing * .72, height * (.57 + rnd() * .08), depth * .55);
      m.rotation.y = rnd() * TAU;
    }
  }
  return { tree, palm, hedge };
}
