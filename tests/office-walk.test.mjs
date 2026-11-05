import test from 'node:test';
import assert from 'node:assert/strict';
import { PEOPLE, ROOMS } from '../src/office/roster.mjs';
import { AUTO_DOORS, BREAK_SPOTS, BUILDING, CLEANER_ROUND, MEETING_CHAIRS, OFFICE_ROOMS, SPAWN, WORLD_BOUNDS, areaAt, buildColliders, createNavGrid, findRoute, floorMapShapes, seatsFor, sightBlocked, teamCentres, wallPieces } from '../src/office/floorplan.mjs';
import { hqLayout } from '../src/office/agent-hq.mjs';
import { WALK, agentInReach, createPlayer, doorWantsOpen, look, movePlayer, promptFor, sitDown, standUp, stepDoors } from '../src/office/walk.mjs';

const colliders = buildColliders(), grid = createNavGrid(colliders), seats = seatsFor(PEOPLE);
const walk = (player, frames, input = { forward: 1 }, extra = []) => { for (let i = 0; i < frames; i++) movePlayer(player, input, 1 / 60, [...colliders, ...extra], WORLD_BOUNDS); return player; };

test('the building has exactly ten numbered rooms', () => {
  assert.equal(OFFICE_ROOMS.length, 10);
  assert.deepEqual(OFFICE_ROOMS.map(r => r.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('every person has their own chair, inside the building', () => {
  assert.equal(Object.keys(seats).length, PEOPLE.length);
  const taken = new Set();
  for (const p of PEOPLE) {
    const s = seats[p.id]; assert.ok(s, `${p.id} has no chair`);
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.heading));
    assert.ok(s.x > BUILDING.x1 && s.x < BUILDING.x2 && s.z > BUILDING.z1 && s.z < BUILDING.z2, `${p.id} sits outside`);
    const key = `${s.x}:${s.z}`; assert.equal(taken.has(key), false, `${p.id} shares a chair`); taken.add(key);
  }
});

test('every department can still be found on the map', () => {
  const centres = teamCentres(PEOPLE, seats);
  for (const room of ROOMS) assert.ok(centres[room.id], `${room.id} has no place on the map`);
});

test('anyone can walk from their desk to the meeting table and back', () => {
  for (const p of PEOPLE) {
    const s = seats[p.id];
    assert.ok(findRoute(grid, s, MEETING_CHAIRS[0]), `${p.id} cannot reach the meeting room`);
    assert.ok(findRoute(grid, MEETING_CHAIRS[1], s), `${p.id} cannot get back to their desk`);
  }
});

test('colleagues can visit each other, take breaks, and the cleaner can finish the round', () => {
  assert.ok(findRoute(grid, seats.cmo, seats.copywriter));
  assert.ok(findRoute(grid, seats.dataLead, seats.photoLead || seats.designer));
  for (const spot of BREAK_SPOTS) assert.ok(findRoute(grid, seats.sales, spot), `no way to ${spot.area}`);
  CLEANER_ROUND.forEach((stop, i) => assert.ok(findRoute(grid, stop, CLEANER_ROUND[(i + 1) % CLEANER_ROUND.length]), `cleaner stuck at stop ${i}`));
});

test('routes use doors: they never pass through a wall', () => {
  const route = findRoute(grid, seats.sales, MEETING_CHAIRS[0]);
  const hits = (a, b) => wallPieces().some(w => { // a straight leg crossing a solid wall piece
    if (w.alongX) { if ((a.z - w.line) * (b.z - w.line) > 0) return false; const t = (w.line - a.z) / ((b.z - a.z) || 1e-9), x = a.x + (b.x - a.x) * t; return x > w.from + .05 && x < w.to - .05; }
    if ((a.x - w.line) * (b.x - w.line) > 0) return false; const t = (w.line - a.x) / ((b.x - a.x) || 1e-9), z = a.z + (b.z - a.z) * t; return z > w.from + .05 && z < w.to - .05;
  });
  let from = seats.sales; for (const to of route) { assert.equal(hits(from, to), false, `leg to ${to.x},${to.z} crosses a wall`); from = to; }
});

test('you start on the street, outside the front door, looking at it', () => {
  const player = createPlayer(SPAWN);
  assert.equal(areaAt(player.x, player.z), null);
  assert.ok(player.z > BUILDING.z2);
  const door = AUTO_DOORS.find(d => d.id === 'front');
  assert.ok(player.x > door.a && player.x < door.b);
  assert.ok(Math.cos(player.yaw) < -.99, 'should face the building');
});

test('walls stop you, and you slide along them', () => {
  const player = createPlayer({ x: 10, z: 26, heading: Math.PI });
  walk(player, 180);
  assert.ok(player.z > BUILDING.z2, `walked through the front wall to z=${player.z}`);
  const diagonal = createPlayer({ x: 10, z: 22, heading: Math.PI * .75 });
  const startX = diagonal.x; walk(diagonal, 60);
  assert.ok(diagonal.z > BUILDING.z2);
  assert.notEqual(diagonal.x, startX, 'should keep moving along the wall');
});

test('a very slow frame cannot carry you through a wall', () => {
  const player = createPlayer({ x: 10, z: 21.6, heading: Math.PI });
  movePlayer(player, { forward: 1, run: true }, 1.5, colliders, WORLD_BOUNDS);
  assert.ok(player.z > BUILDING.z2, `tunnelled to z=${player.z}`);
});

test('running is faster than walking, and diagonal movement is not', () => {
  const a = walk(createPlayer({ x: 0, z: 25, heading: Math.PI / 2 }), 30), b = walk(createPlayer({ x: 0, z: 25, heading: Math.PI / 2 }), 30, { forward: 1, run: true });
  assert.ok(b.x - 0 > (a.x - 0) * 1.5);
  const diag = createPlayer({ x: 0, z: 27, heading: Math.PI / 2 }); movePlayer(diag, { forward: 1, strafe: 1 }, 1 / 60, [], null);
  assert.ok(Math.abs(Math.hypot(diag.vx, diag.vz) - WALK.walk) < 1e-6);
});

test('the front door opens when you walk towards it, not when you walk past', () => {
  const door = AUTO_DOORS.find(d => d.id === 'front');
  const towards = createPlayer({ x: -22, z: 24, heading: Math.PI }); movePlayer(towards, { forward: 1 }, 1 / 60, [], null);
  assert.equal(doorWantsOpen(door, towards), true);
  const past = createPlayer({ x: -26, z: 23.5, heading: Math.PI / 2 }); movePlayer(past, { forward: 1 }, 1 / 60, [], null);
  assert.equal(doorWantsOpen(door, past), false);
  const standing = createPlayer({ x: -22, z: 24, heading: Math.PI });
  assert.equal(doorWantsOpen(door, standing), false);
  const away = createPlayer({ x: -22, z: 24, heading: 0 }); movePlayer(away, { forward: 1 }, 1 / 60, [], null);
  assert.equal(doorWantsOpen(door, away), false);
});

test('you can walk in through the front door once it has opened, and it blocks you until then', () => {
  const states = {}, player = createPlayer(SPAWN);
  let enteredAt = -1;
  for (let i = 0; i < 600 && enteredAt < 0; i++) {
    const solid = stepDoors(AUTO_DOORS, states, player, 1 / 60);
    movePlayer(player, { forward: 1 }, 1 / 60, [...colliders, ...solid], WORLD_BOUNDS);
    if (player.z < BUILDING.z2 - 1) enteredAt = i;
  }
  assert.ok(enteredAt > 0, 'never got inside');
  assert.equal(areaAt(player.x, player.z).id, 'reception');
  const shut = createPlayer({ x: -22, z: 21.5, heading: Math.PI }), closedLeaves = [{ x1: -23.5, x2: -20.5, z1: 20.9, z2: 21.1 }];
  for (let i = 0; i < 30; i++) movePlayer(shut, { forward: 1 }, 1 / 60, [...colliders, ...closedLeaves], WORLD_BOUNDS);
  assert.ok(shut.z > 21, 'a closed door should stop you');
});

test('you can walk from the street all the way to the workspace', () => {
  // reception, lounge and workspace are joined by doors, so a route exists for a person on foot too
  assert.ok(findRoute(grid, { x: -22, z: 16 }, { x: 16.8, z: 2.8 }));
});

test('E talks to the agent you are looking at, only when close enough', () => {
  const agent = { id: 'sales', name: 'Sales Analyst', role: 'Shopify and GA4 results', x: 0, z: 2 };
  const near = createPlayer({ x: 0, z: 0, heading: 0 });
  assert.equal(agentInReach(near, [agent]).id, 'sales');
  assert.equal(promptFor(near, [agent], []).kind, 'talk');
  assert.match(promptFor(near, [agent], []).text, /Sales Analyst/);
  assert.equal(agentInReach(createPlayer({ x: 0, z: 0, heading: Math.PI }), [agent]), null, 'looking the other way');
  assert.equal(agentInReach(createPlayer({ x: 0, z: -3, heading: 0 }), [agent]), null, 'too far');
  assert.equal(agentInReach(near, [{ ...agent, ambient: true }]), null, 'staff such as the cleaner are not agents');
});

test('you can take a free seat at the meeting table and stand up again', () => {
  const chair = MEETING_CHAIRS[0], player = createPlayer({ x: chair.x, z: chair.z - 1, heading: 0 });
  const prompt = promptFor(player, [], MEETING_CHAIRS);
  assert.equal(prompt.kind, 'sit');
  assert.equal(promptFor(player, [], MEETING_CHAIRS, () => true), null, 'a taken chair is not offered');
  sitDown(player, prompt.chair);
  assert.equal(promptFor(player, [], MEETING_CHAIRS).kind, 'stand');
  const seatedAt = { x: player.x, z: player.z }; walk(player, 30);
  assert.deepEqual({ x: player.x, z: player.z }, seatedAt, 'sitting people do not move');
  standUp(player);
  assert.equal(player.seat, null); assert.equal(player.z, chair.z - 1);
});

test('looking up and down stops short of flipping over', () => {
  const player = createPlayer(SPAWN); look(player, 0, -99999); assert.ok(player.pitch <= 1.25); look(player, 0, 99999); assert.ok(player.pitch >= -1.25);
});

test('every spot on the floor plan belongs to the right room', () => {
  assert.equal(areaAt(-22, 15).id, 'reception'); assert.equal(areaAt(16, 8).id, 'workspace'); assert.equal(areaAt(1, 18).id, 'restrooms');
  assert.equal(areaAt(-4, 5).id, 'lounge'); assert.equal(areaAt(0, -7).id, 'hallway'); assert.equal(areaAt(-33, 8).id, 'terrace');
  for (const p of PEOPLE) assert.ok(areaAt(seats[p.id].x, seats[p.id].z), `${p.id} sits nowhere`);
});

test('glass lets you see into a room; solid walls do not', () => {
  assert.equal(sightBlocked(0, -7, 3, -12), false, 'hallway glass');
  assert.equal(sightBlocked(-9, -12, 3, -12), true, 'wall between leadership and the studio');
});

test('the floor plan shows every room inside its own bounds', () => {
  const map = floorMapShapes();
  assert.equal(map.rooms.length, 10);
  for (const r of [...map.rooms, ...map.areas]) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= map.width + 1e-6 && r.y + r.h <= map.height + 1e-6, `${r.id} is off the map`);
});

test('Agent HQ gives every department its own station', () => {
  const layout = hqLayout(ROOMS.filter(r => r.id !== 'lead' && r.id !== 'board'));
  assert.equal(new Set(layout.map(d => `${d.x}:${d.z}`)).size, layout.length);
  assert.ok(layout.every(d => Number.isFinite(d.x) && Number.isFinite(d.z)));
});
