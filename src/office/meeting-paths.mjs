/** Keep the office's orthogonal corridor routes clear of the meeting tabletop. */
export function aroundMeetingTable(start, points, table) {
  const route = [], margin = .1;
  let from = start;
  for (const to of points) {
    const vertical = Math.abs(from.x - to.x) < .001;
    const horizontal = Math.abs(from.z - to.z) < .001;
    if (vertical && from.x > table.minX && from.x < table.maxX && Math.max(from.z, to.z) > table.minZ && Math.min(from.z, to.z) < table.maxZ) {
      const x = from.x - table.minX <= table.maxX - from.x ? table.minX - margin : table.maxX + margin;
      route.push({ x, z: from.z }, { x, z: to.z });
    } else if (horizontal && from.z > table.minZ && from.z < table.maxZ && Math.max(from.x, to.x) > table.minX && Math.min(from.x, to.x) < table.maxX) {
      const z = from.z - table.minZ <= table.maxZ - from.z ? table.minZ - margin : table.maxZ + margin;
      route.push({ x: from.x, z }, { x: to.x, z });
    }
    route.push(to); from = to;
  }
  return route.filter((p, i) => !i || Math.hypot(p.x - route[i - 1].x, p.z - route[i - 1].z) > .001);
}
