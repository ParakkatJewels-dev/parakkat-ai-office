// Own both participants for a desk visit. This is presentation state only: every
// turn must come from a real event; waiting never invents a recipient's reply.
export function createDirectDialogueController(adapter, options = {}) {
  const now = options.now || Date.now;
  const schedule = options.setTimeout || setTimeout, unschedule = options.clearTimeout || clearTimeout;
  const maxAgeMs = options.maxAgeMs ?? 120_000, queueMs = options.queueMs ?? 90_000;
  const holdMs = options.holdMs ?? 120_000, activeMs = options.activeMs ?? 180_000;
  const returnMs = options.returnMs ?? 60_000;
  const sessions = new Map(), reservations = new Map(), closed = new Map();
  let blocked = new Set(), disposed = false;

  function emit(session, state) {
    session.state = state;
    for (const listener of session.listeners) { try { listener(state); } catch { /* UI callbacks cannot strand a reservation. */ } }
  }
  function timer(fn, ms) { const id = schedule(fn, ms); id?.unref?.(); return id; }
  function settle(turn, value) { if (!turn.settled) { turn.settled = true; turn.resolve(value); } }
  function wake(session) { session.wake?.(); session.wake = null; }
  function owns(session) { return !disposed && !session.abort.signal.aborted; }
  function release(session) {
    unschedule(session.timer); unschedule(session.deadline);
    for (const id of [session.visitorId, session.recipientId]) if (reservations.get(id) === session.id) reservations.delete(id);
    if (sessions.get(session.id) === session) sessions.delete(session.id);
    closed.set(session.id, now());
    // Retain a bounded replay window rather than growing with every realtime event.
    for (const [id, at] of closed) if (now() - at > 600_000 || closed.size > 512) closed.delete(id);
    pump();
  }
  function cancel(session) {
    if (session.abort.signal.aborted || session.finished) return;
    session.abort.abort(); wake(session);
    emit(session, 'interrupted');
    for (const turn of session.turns) settle(turn, false);
    if (!session.started) release(session);
  }
  async function run(session) {
    let completed = false, finalTurn = null;
    try {
      emit(session, 'walking');
      if (!await adapter.arrive(session, session.abort.signal) || !owns(session)) return;
      while (owns(session)) {
        const turn = session.turns.find(t => !t.settled);
        if (!turn) {
          emit(session, 'waiting');
          unschedule(session.timer); session.timer = timer(() => cancel(session), holdMs);
          await new Promise(resolve => { session.wake = resolve; });
          unschedule(session.timer);
          continue;
        }
        emit(session, 'talking');
        if (!await adapter.speak(session, turn, session.abort.signal) || !owns(session)) return;
        if (turn.phase === 'response' || turn.phase === 'single') { completed = true; finalTurn = turn; break; }
        settle(turn, true);
      }
    } catch { /* A canceled/failed animation does not affect the real agent job. */ }
    finally {
      session.finishing = true; unschedule(session.timer); unschedule(session.deadline);
      if (!completed && !session.abort.signal.aborted) cancel(session);
      if (completed) emit(session, 'returning');
      const cleanup = new AbortController(); let cleanupTimer;
      try {
        const deadline = new Promise(resolve => { cleanupTimer = timer(() => { cleanup.abort(); resolve(false); }, returnMs); });
        const returned = await Promise.race([
          Promise.resolve(adapter.leave(session, { interrupted: !completed, isBlocked: id => disposed || blocked.has(id), signal: cleanup.signal })).then(() => true),
          deadline,
        ]);
        if (!returned) completed = false;
      } catch { completed = false; }
      finally { unschedule(cleanupTimer); cleanup.abort(); }
      session.finished = true;
      if (completed && owns(session)) { emit(session, 'complete'); settle(finalTurn, true); }
      else if (!session.abort.signal.aborted) emit(session, 'interrupted');
      for (const turn of session.turns) settle(turn, false);
      release(session);
    }
  }
  function pump() {
    if (disposed) return;
    for (const session of sessions.values()) {
      if (session.started || session.abort.signal.aborted) continue;
      const ids = [session.visitorId, session.recipientId];
      if (ids.some(id => blocked.has(id))) { cancel(session); continue; }
      if (ids.some(id => reservations.has(id))) continue;
      session.started = true;
      ids.forEach(id => reservations.set(id, session.id));
      unschedule(session.timer);
      session.deadline = timer(() => cancel(session), activeMs);
      void run(session);
    }
  }

  return {
    directDialogue(value) {
      const { id, visitorId, recipientId, speakerId, text, phase, onState } = value || {};
      const at = value?.createdAt == null ? now() : typeof value.createdAt === 'number' ? value.createdAt : Date.parse(value.createdAt);
      if (disposed || typeof id !== 'string' || !id || id.length > 200 || visitorId === recipientId ||
          !adapter.hasAgent(visitorId) || !adapter.hasAgent(recipientId) || ![visitorId, recipientId].includes(speakerId) ||
          !['request', 'response', 'single'].includes(phase) || typeof text !== 'string' || !text.trim() ||
          !Number.isFinite(at) || now() - at > maxAgeMs || at - now() > 30_000 || closed.has(id) ||
          blocked.has(visitorId) || blocked.has(recipientId)) return Promise.resolve(false);
      let session = sessions.get(id);
      if (session && (session.visitorId !== visitorId || session.recipientId !== recipientId || session.finishing || session.abort.signal.aborted)) return Promise.resolve(false);
      if (!session) {
        if (sessions.size >= 32) return Promise.resolve(false);
        session = { id, visitorId, recipientId, turns: [], listeners: new Set(), abort: new AbortController(), started: false, state: 'queued' };
        sessions.set(id, session);
        session.timer = timer(() => cancel(session), queueMs);
      }
      // A late request must never play after its response, and a one-shot visit
      // cannot be extended by an unrelated event reusing its ID.
      const duplicate = session.turns.find(t => t.phase === phase);
      if (duplicate) return duplicate.promise;
      if (session.turns.some(t => t.phase === 'single' || t.phase === 'response') || (phase === 'single' && session.turns.length)) return Promise.resolve(false);
      if (typeof onState === 'function') session.listeners.add(onState);
      const turn = { speakerId, text: text.trim(), phase, settled: false };
      turn.promise = new Promise(resolve => { turn.resolve = resolve; });
      session.turns.push(turn);
      if (session.started) { unschedule(session.timer); wake(session); }
      else emit(session, 'queued');
      pump();
      return turn.promise;
    },
    isReserved(id) { return reservations.has(id); },
    cancelDialogue(id) {
      const session = sessions.get(id);
      if (!session) return false;
      // Access revocation/unmount callers have already removed the dialogue.
      // No later animation callback may repopulate its private text.
      session.listeners.clear(); cancel(session); return true;
    },
    setMeetingParticipants(ids) {
      blocked = new Set(ids);
      for (const session of [...sessions.values()]) if (blocked.has(session.visitorId) || blocked.has(session.recipientId)) cancel(session);
      pump();
    },
    dispose() {
      disposed = true;
      for (const session of [...sessions.values()]) cancel(session);
    },
  };
}

export function dialogueBubble(text) {
  const chars = Array.from(String(text).replace(/\s+/g, ' ').trim());
  return chars.length > 240 ? `${chars.slice(0, 237).join('')}…` : chars.join('');
}

export function dialogueDuration(text) { return Math.min(8_000, Math.max(4_000, Array.from(dialogueBubble(text)).length * 35)); }
