// Walking through the office: movement, collisions, automatic doors and what the person in front of you can do.
// No three.js here, so every rule below runs in Node tests.

export const WALK = { radius: .28, walk: 3.4, run: 6.2, eye: 1.62, seatedEye: 1.16, jump: 4.6, gravity: 12, reach: 2.7, doorRange: 5.5, doorSpeed: 3.2 };

export const createPlayer = (spawn) => ({ x: spawn.x, z: spawn.z, y: 0, vy: 0, vx: 0, vz: 0, yaw: spawn.heading, pitch: 0, grounded: true, seat: null });

/** Push a circle out of one box. Returns true when they touched. */
function resolve(player, b, radius) {
  const nx = Math.max(b.x1, Math.min(player.x, b.x2)), nz = Math.max(b.z1, Math.min(player.z, b.z2));
  const dx = player.x - nx, dz = player.z - nz, d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return false;
  if (d2 > 1e-9) { const d = Math.sqrt(d2), push = radius - d; player.x += dx / d * push; player.z += dz / d * push; return true; }
  // the centre is inside the box: leave by the nearest edge
  const left = player.x - b.x1, right = b.x2 - player.x, back = player.z - b.z1, front = b.z2 - player.z, m = Math.min(left, right, back, front);
  if (m === left) player.x = b.x1 - radius; else if (m === right) player.x = b.x2 + radius; else if (m === back) player.z = b.z1 - radius; else player.z = b.z2 + radius;
  return true;
}

/**
 * Advance the player one frame. Input is { forward, strafe, run, jump } with forward and strafe in -1..1.
 * Long frames are split, so a slow frame cannot carry someone through a wall.
 */
export function movePlayer(player, input, dt, colliders, bounds) {
  if (player.seat) { player.vx = player.vz = 0; return player; }
  const speed = input.run ? WALK.run : WALK.walk;
  let f = input.forward || 0, s = input.strafe || 0; const len = Math.hypot(f, s); if (len > 1) { f /= len; s /= len; }
  // yaw 0 faces +z, matching the heading people use everywhere else in the building
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  player.vx = (sin * f - cos * s) * speed; player.vz = (cos * f + sin * s) * speed;
  if (input.jump && player.grounded) { player.vy = WALK.jump; player.grounded = false; }
  const steps = Math.max(1, Math.ceil(Math.hypot(player.vx, player.vz) * dt / (WALK.radius * .8))), h = dt / steps;
  for (let i = 0; i < steps; i++) {
    player.x += player.vx * h; player.z += player.vz * h;
    for (let pass = 0; pass < 2; pass++) for (const b of colliders) resolve(player, b, WALK.radius);
  }
  if (bounds) { player.x = Math.max(bounds.x1, Math.min(bounds.x2, player.x)); player.z = Math.max(bounds.z1, Math.min(bounds.z2, player.z)); }
  if (!player.grounded) { player.vy -= WALK.gravity * dt; player.y += player.vy * dt; if (player.y <= 0) { player.y = 0; player.vy = 0; player.grounded = true; } }
  return player;
}

const doorCentre = d => d.axis === 'x' ? { x: (d.a + d.b) / 2, z: d.at } : { x: d.at, z: (d.a + d.b) / 2 };
/** A door opens for someone close and walking at it, stays open while they are in the doorway, and ignores people walking past. */
export function doorWantsOpen(door, player) {
  const c = doorCentre(door), d = Math.hypot(c.x - player.x, c.z - player.z);
  if (d > WALK.doorRange) return false;
  if (d < 1.15) return true;
  const speed = Math.hypot(player.vx, player.vz); if (speed < .2) return false;
  // measured against the line through the doorway, so walking parallel to the front of the building never counts
  const across = door.axis === 'x' ? door.at - player.z : door.at - player.x, along = door.axis === 'x' ? player.x - c.x : player.z - c.z;
  if (Math.abs(along) > (door.b - door.a) / 2 + 1.6) return false;
  const towards = door.axis === 'x' ? player.vz * Math.sign(across) : player.vx * Math.sign(across);
  return towards / speed > .5;
}
/** Update how far each door has slid (0 closed, 1 open) and return the leaves that still block the way. */
export function stepDoors(doors, states, player, dt) {
  const solid = [];
  for (const d of doors) {
    const target = doorWantsOpen(d, player) ? 1 : 0; let s = states[d.id] ?? 0;
    s = target > s ? Math.min(1, s + dt * WALK.doorSpeed) : Math.max(0, s - dt * WALK.doorSpeed); states[d.id] = s;
    if (s < .85) solid.push(d.axis === 'x' ? { x1: d.a, x2: d.b, z1: d.at - .1, z2: d.at + .1 } : { x1: d.at - .1, x2: d.at + .1, z1: d.a, z2: d.b });
  }
  return solid;
}

const facing = (player, x, z) => { const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz) || 1; return (Math.sin(player.yaw) * dx + Math.cos(player.yaw) * dz) / d; };
/** Whoever you are close to and looking towards. */
export function agentInReach(player, people) {
  let best = null, score = -Infinity;
  for (const p of people) {
    if (p.ambient) continue;
    const d = Math.hypot(p.x - player.x, p.z - player.z); if (d > WALK.reach) continue;
    const look = facing(player, p.x, p.z); if (look < .35) continue;
    const s = look * 2 - d; if (s > score) { score = s; best = p; }
  }
  return best;
}
/** The free chair you are nearest and looking towards. */
export function chairInReach(player, chairs, taken = () => false) {
  let best = null, score = -Infinity;
  for (const chair of chairs) {
    const d = Math.hypot(chair.x - player.x, chair.z - player.z); if (d > 1.9 || taken(chair)) continue;
    const look = facing(player, chair.x, chair.z); if (look < .15 && d > .7) continue;
    const s = look - d; if (s > score) { score = s; best = chair; }
  }
  return best;
}
/** What pressing E would do right now. A person always comes before a chair. */
export function promptFor(player, people, chairs, taken) {
  if (player.seat) return { kind: 'stand', text: 'to stand up' };
  const agent = agentInReach(player, people);
  if (agent) return { kind: 'talk', target: agent.id, text: `to talk to ${agent.name}${agent.role ? ` (${agent.role})` : ''}` };
  const chair = chairInReach(player, chairs, taken);
  if (chair) return { kind: 'sit', chair, text: 'to take a seat' };
  return null;
}
export function sitDown(player, chair) { player.seat = { ...chair, leftX: player.x, leftZ: player.z }; player.x = chair.x; player.z = chair.z; player.yaw = chair.heading; player.pitch = 0; player.vx = player.vz = 0; }
export function standUp(player) { if (!player.seat) return; player.x = player.seat.leftX; player.z = player.seat.leftZ; player.seat = null; }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Mouse or touch movement to where you are looking. */
export function look(player, dx, dy, sensitivity = .0024) { player.yaw -= dx * sensitivity; player.pitch = clamp(player.pitch - dy * sensitivity, -1.25, 1.25); }
