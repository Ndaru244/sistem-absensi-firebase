const CHANNEL_NAME = 'absensi-sync';
let channel = null;

function getChannel() {
  if (channel) return channel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
  return channel;
}

export function broadcast(type, payload = {}) {
  const ch = getChannel();
  if (!ch) return;
  ch.postMessage({ type, payload, ts: Date.now() });
}

export function onTabSync(handler) {
  const ch = getChannel();
  if (!ch) return;
  ch.onmessage = (e) => handler(e.data);
}
