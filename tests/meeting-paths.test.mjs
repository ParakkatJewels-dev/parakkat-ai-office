import test from 'node:test';
import assert from 'node:assert/strict';
import { aroundMeetingTable } from '../src/office/meeting-paths.mjs';

const table = { minX: -3.8, maxX: 3.8, minZ: -1.45, maxZ: 1.45 };
const inside = ({ x, z }) => x > table.minX && x < table.maxX && z > table.minZ && z < table.maxZ;

test('agents reaching either side of the table never cross its top', () => {
  for (const start of [{ x: 0, z: 5 }, { x: 0, z: -5 }, { x: -6, z: 0 }, { x: 6, z: 0 }]) {
    const end = { x: -start.x, z: -start.z };
    const path = aroundMeetingTable(start, [end], table);
    assert.deepEqual(path.at(-1), end);
    let previous = start;
    for (const point of path) {
      for (let t = 0; t <= 1; t += .01) assert.equal(inside({ x: previous.x + (point.x - previous.x) * t, z: previous.z + (point.z - previous.z) * t }), false);
      previous = point;
    }
  }
});

test('ordinary corridor movement stays direct and input waypoints are not changed', () => {
  const points = [{ x: 10, z: 7 }, { x: 10, z: -7 }];
  const before = structuredClone(points);
  assert.deepEqual(aroundMeetingTable({ x: -10, z: 7 }, points, table), points);
  assert.deepEqual(points, before);
});
