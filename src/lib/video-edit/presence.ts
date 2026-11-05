// The office deployment has one app process. The Windows channel checks in
// every 10 seconds while idle and sends heartbeats while editing.
declare global {
  var __videoWorkerLastSeenAt: number | undefined;
}

export function markVideoWorkerConnected() {
  globalThis.__videoWorkerLastSeenAt = Date.now();
}

export function videoWorkerPresence() {
  const lastSeen = globalThis.__videoWorkerLastSeenAt;
  return {
    connected: typeof lastSeen === 'number' && Date.now() - lastSeen < 75_000,
    lastSeenAt: typeof lastSeen === 'number' ? new Date(lastSeen).toISOString() : null,
  };
}
