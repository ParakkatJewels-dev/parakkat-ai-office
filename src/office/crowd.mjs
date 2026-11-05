// Everyone in the building, drawn with instancing. Each body part is one draw call for all people together,
// so a full office costs about a dozen draws instead of eight per person.
// The figures are faceted on purpose: few polygons, flat shading.

const LIMB = { upperArm: .29, foreArm: .27, thigh: .44, shin: .44 };
const HIP = .92;
export const FIGURE_HEIGHT = 1.76;

export function createCrowd({ THREE, scene, count }) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const _c = new THREE.Color();
  const paint = (g, hex) => { // a flat colour written per vertex, so one part can hold several colours
    const geo = g.index ? g.toNonIndexed() : g, n = geo.attributes.position.count, a = new Float32Array(n * 3); _c.set(hex);
    for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo;
  };
  const merge = (parts) => {
    let n = 0; for (const p of parts) n += p.attributes.position.count;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
    for (const p of parts) { pos.set(p.attributes.position.array, o * 3); col.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
  };
  const icosa = (r, detail, sx = 1, sy = 1, sz = 1, x = 0, y = 0, z = 0, hex = '#ffffff') => { const g = new THREE.IcosahedronGeometry(r, detail); g.scale(sx, sy, sz); g.translate(x, y, z); return paint(g, hex); };
  const boxy = (w, h, d, x = 0, y = 0, z = 0, hex = '#ffffff') => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return paint(g, hex); };
  // a tapered limb hanging down from its joint
  const limb = (rTop, rBottom, len, sides = 5) => { const g = new THREE.CylinderGeometry(rTop, rBottom, len, sides, 1); g.translate(0, -len / 2, 0); return paint(g, '#ffffff'); };

  const head = merge([
    icosa(.122, 1, .92, 1.08, .98, 0, .13, 0),
    boxy(.024, .05, .03, 0, .118, .118),                    // nose
    icosa(.016, 0, 1, 1, .6, -.044, .15, .106, '#17120f'),  // eyes
    icosa(.016, 0, 1, 1, .6, .044, .15, .106, '#17120f'),
    boxy(.05, .009, .012, -.044, .178, .108, '#3a2a20'),    // brows
    boxy(.05, .009, .012, .044, .178, .108, '#3a2a20'),
    boxy(.07, .08, .07, 0, -.01, 0),                        // neck
  ]);
  const hairShort = merge([icosa(.128, 1, .98, .72, 1.04, 0, .19, -.022)]);
  const hairBob = merge([icosa(.145, 1, .98, .98, 1.04, 0, .15, -.034), icosa(.1, 0, 1.2, 1.1, .9, 0, .055, -.075)]);
  const hairBun = merge([icosa(.13, 1, .98, .78, 1.03, 0, .185, -.024), icosa(.058, 0, 1, 1, 1, 0, .285, -.075)]);
  const torsoGeo = new THREE.CylinderGeometry(.215, .155, .5, 6, 1); torsoGeo.scale(1, 1, .68); torsoGeo.translate(0, .25, 0);
  const collar = new THREE.CylinderGeometry(.075, .115, .05, 6, 1); collar.translate(0, .505, .004);
  const torso = merge([paint(torsoGeo, '#ffffff'), paint(collar, '#e9e3d6')]);
  const pelvisGeo = new THREE.CylinderGeometry(.155, .15, .14, 6, 1); pelvisGeo.scale(1, 1, .72);
  const pelvis = merge([paint(pelvisGeo, '#ffffff'), boxy(.3, .03, .2, 0, .07, 0, '#2a2622')]);
  const shoeGeo = merge([boxy(.1, .075, .24, 0, -.04, .045)]);
  const folder = merge([boxy(.22, .03, .3, 0, 0, 0, '#d8c3a5')]);
  const mop = merge([boxy(.03, 1.5, .03, 0, -.1, 0, '#b7b2a6'), boxy(.3, .05, .14, 0, -.86, 0, '#d9d4c7')]);
  const cap = merge([icosa(.128, 1, 1, .46, 1.04, 0, .21, -.006, '#ffffff'), boxy(.17, .012, .1, 0, .2, .12, '#ffffff')]);

  const PARTS = {
    head: [head, count], hairShort: [hairShort, count], hairBob: [hairBob, count], hairBun: [hairBun, count], cap: [cap, count],
    torso: [torso, count], pelvis: [pelvis, count],
    upperArm: [limb(.058, .05, LIMB.upperArm), count * 2], foreArm: [limb(.05, .038, LIMB.foreArm), count * 2], hand: [merge([icosa(.044, 0, .85, 1.25, .7, 0, -.045, 0)]), count * 2],
    thigh: [limb(.082, .062, LIMB.thigh), count * 2], shin: [limb(.062, .044, LIMB.shin), count * 2], shoe: [shoeGeo, count * 2],
    folder: [folder, count], mop: [mop, count],
  };
  const meshes = {}, used = {};
  for (const [key, [geo, n]] of Object.entries(PARTS)) {
    const m = new THREE.InstancedMesh(geo, material, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
    m.setColorAt(0, _c.set('#ffffff')); m.instanceColor.setUsage(THREE.DynamicDrawUsage); scene.add(m); meshes[key] = m; used[key] = 0;
  }

  const M = THREE.Matrix4, root = new M(), body = new M(), joint = new M(), elbow = new M(), m = new M(), e = new THREE.Euler(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const rot = (x, y, z, px, py, pz) => m.compose(v.set(px, py, pz), q.setFromEuler(e.set(x, y, z, 'YXZ')), s);
  const color = new THREE.Color();
  // Colours only change when someone new appears, so they are written once per person and reused.
  const place = (key, matrix, hex) => { const mesh = meshes[key], i = used[key]++; mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, color.set(hex)); };

  /**
   * Draw one figure. `pose` comes from characterMotion. `look` is { skin, hair, hairStyle, shirt, sleeve, pants, shoes }.
   * `sit` lowers the figure onto a chair with its knees bent.
   */
  function drawFigure(x, y, z, heading, pose, look, sit, extras = {}) {
    root.compose(v.set(x, y + (sit ? -.42 : pose.lift), z), q.setFromEuler(e.set(0, heading, 0, 'YXZ')), s);
    place('pelvis', joint.copy(root).multiply(rot(0, 0, 0, 0, HIP + .02, 0)), look.pants);
    body.copy(root).multiply(rot(pose.bodyX, 0, pose.bodyZ, 0, HIP + .08, 0));
    place('torso', body, look.shirt);
    const headM = joint.copy(body).multiply(rot(pose.headX, pose.headY, pose.headZ, 0, .54, 0)).clone();
    place('head', headM, look.skin);
    if (extras.cap) place('cap', headM, extras.cap); else place(look.hairStyle, headM, look.hair);
    for (let i = 0; i < 2; i++) {
      const sd = i ? 1 : -1;
      // arm
      joint.copy(body).multiply(rot(pose.armsX[i], 0, pose.armsZ[i] + sd * .06, sd * .245, .46, 0));
      place('upperArm', joint, look.sleeve);
      elbow.copy(joint).multiply(rot(pose.elbowsX[i], 0, 0, 0, -LIMB.upperArm, 0));
      place('foreArm', elbow, look.forearm);
      place('hand', joint.copy(elbow).multiply(rot(0, 0, 0, 0, -LIMB.foreArm, 0)), look.skin);
      // leg
      joint.copy(root).multiply(rot(pose.legsX[i], 0, 0, sd * .092, HIP, 0));
      place('thigh', joint, look.pants);
      const knee = sit ? Math.PI / 2 - .12 : Math.max(0, -pose.legsX[i]) * 1.05;
      elbow.copy(joint).multiply(rot(knee, 0, 0, 0, -LIMB.thigh, 0));
      place('shin', elbow, look.pants);
      place('shoe', joint.copy(elbow).multiply(rot(sit ? -.05 : 0, 0, 0, 0, -LIMB.shin, 0)), look.shoes);
    }
    if (extras.folder) place('folder', joint.copy(body).multiply(rot(.2, 0, 0, .18, .2, .17)), '#ffffff');
    if (extras.mop) place('mop', joint.copy(root).multiply(rot(.34, 0, 0, .3, 1.1, .46)), '#ffffff');
  }
  function begin() { for (const k in used) used[k] = 0; }
  function end() {
    for (const k in meshes) { const mesh = meshes[k]; mesh.count = used[k]; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.visible = used[k] > 0; }
  }
  /** Drop shadows from the crowd when the renderer has to save time. */
  function setShadows(on) { for (const k in meshes) meshes[k].castShadow = on; }
  return { begin, end, drawFigure, setShadows, material };
}

/* ---------- how each person looks ---------- */
const SKIN = ['#f0c9a4', '#d9a77f', '#b77d57', '#8c5a3c', '#e3b58f', '#a06a45'];
const HAIR = ['#231812', '#4a2f1e', '#7b5434', '#1d1d24', '#b9b2a8', '#c98a3e', '#8f3f22', '#d7c08a'];
const OUTFIT = ['#7a3b86', '#b23a3a', '#2f5d8a', '#3f6e55', '#c98a3e', '#e6e0d3', '#3a3f4a', '#8a4b2d', '#5d6b78', '#a3475e', '#2c2c30', '#d8cfbd'];
const PANTS = ['#1d1c20', '#26303d', '#3a3028', '#20241f', '#2c2c30'];
const STYLES = ['hairShort', 'hairBob', 'hairBun', 'hairShort'];
/** A stable look for a person, the same on every visit. */
export function lookFor(i, deptColor, human) {
  const shirt = human ? '#2a2622' : i % 3 === 0 && deptColor ? deptColor : OUTFIT[(i * 7) % OUTFIT.length];
  return { skin: SKIN[(i * 5) % SKIN.length], hair: HAIR[(i * 3) % HAIR.length], hairStyle: STYLES[(i * 11) % STYLES.length], shirt, sleeve: shirt, forearm: i % 2 ? shirt : '#ece6da', pants: PANTS[(i * 3) % PANTS.length], shoes: '#15130f' };
}
