const SERVER_STATES = new Set(['working', 'thinking', 'waiting', 'blocked']);
const clean = (value, limit = 160) => Array.from(String(value || '').replace(/\s+/g, ' ').trim()).slice(0, limit).join('');

/** A complete, short-lived snapshot. Omissions clear work; old task strings never revive it. */
export function normalizeWorkStatuses(snapshot, agentIds, now = Date.now()) {
  const valid = new Set(agentIds), result = Object.create(null);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return result;
  for (const [id, value] of Object.entries(snapshot)) {
    if (!valid.has(id) || !value || !SERVER_STATES.has(value.state)) continue;
    const label = clean(value.label);
    const expiresAt = value.expiresAt == null ? now + 60_000 : typeof value.expiresAt === 'number' ? value.expiresAt : Date.parse(value.expiresAt);
    if (!label || !Number.isFinite(expiresAt) || expiresAt <= now) continue;
    result[id] = { state: value.state, label, expiresAt: Math.min(expiresAt, now + 300_000) };
  }
  return result;
}

/** Derive only current activity; speech can end while independently tracked work continues. */
export function agentWorkStatus(person, source, now = Date.now()) {
  const work = source && source.expiresAt > now ? source : null;
  const speech = person.bubble ? clean(person.bubble, 240) : '';
  let local = null;
  if (person.path?.length) local = { state: 'walking', label: clean(person.task) || 'Walking to the next task', source: 'movement' };
  else if (person.meetingId) local = { state: person.status === 'talking' ? 'talking' : 'waiting', label: clean(person.task) || 'In a team meeting', source: 'meeting' };
  else if (person.visitId) local = { state: person.status === 'talking' ? 'talking' : 'waiting', label: clean(person.task) || 'Waiting in a conversation', source: 'visit' };
  else if (speech) local = { state: person.bubbleKind === 'thinking' ? 'thinking' : 'talking', label: person.bubbleKind === 'thinking' ? 'Thinking' : 'Speaking', source: 'speech' };
  else if (person.quest) local = { state: 'waiting', label: 'Waiting for approval', source: 'approval' };
  if (local) return { ...local, speech, workLabel: work?.label && work.label !== local.label ? work.label : '' };
  return work ? { state: work.state, label: work.label, source: 'server', speech: '', workLabel: '' } : null;
}

const overlap = (a, b) => Math.max(0, (a.w + b.w) / 2 - Math.abs(a.x - b.x)) * Math.max(0, (a.h + b.h) / 2 - Math.abs(a.y - b.y));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Place every projected active label. Dense views use the least-overlapping
 * bounded position instead of silently dropping agents after a fixed count. */
export function layoutWorkStatuses(items, { width, height, obstacles = [] } = {}) {
  const placed = obstacles.map(r => ({ ...r, obstacle: true })), result = [];
  for (const item of items) {
    const w = Math.min(item.w, Math.max(32, width - 12)), h = Math.min(item.h, Math.max(20, height - 12));
    let best = null, bestScore = Infinity;
    for (let row = 0; row < 9; row++) {
      for (const side of [0, -1, 1, -2, 2]) {
        const x = clamp(item.x + side * (w + 6), w / 2 + 6, width - w / 2 - 6);
        const y = clamp(item.y - 10 - h / 2 - row * (h + 5), h / 2 + 6, height - h / 2 - 6);
        const candidate = { x, y, w, h };
        const collision = placed.reduce((sum, other) => sum + overlap(candidate, other) * (other.obstacle ? 8 : 1), 0);
        const distance = Math.abs(x - item.x) + Math.abs(y + h / 2 + 10 - item.y);
        const score = collision * 100 + distance;
        if (score < bestScore) { bestScore = score; best = candidate; }
        if (score === 0) break;
      }
      if (bestScore === 0) break;
    }
    result.push({ ...item, ...best }); placed.push(best);
  }
  return result;
}
