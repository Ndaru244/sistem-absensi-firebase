import {
  doc,
  setDoc,
  updateDoc,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { broadcast } from './tab-sync.js?v=fb1eddf';

const QUEUE_KEY = 'app_sync_queue';
const DEAD_LETTER_KEY = 'app_sync_dead_letter';
const MAX_RETRIES = 3;
const MAX_DEAD_LETTER = 50;
let flushing = false;

export function isOnline() {
  return navigator.onLine !== false;
}

function serializeData(data) {
  return JSON.parse(
    JSON.stringify(data, (_, v) => {
      if (v && typeof v === 'object' && typeof v.toMillis === 'function') {
        return { __ts: true, ms: v.toMillis() };
      }
      return v;
    })
  );
}

function deserializeData(data) {
  return JSON.parse(JSON.stringify(data), (_, v) => {
    if (v && v.__ts && v.ms != null) {
      return Timestamp.fromMillis(v.ms);
    }
    return v;
  });
}

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  try {
    if (queue.length === 0) {
      localStorage.removeItem(QUEUE_KEY);
    } else {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    }
  } catch (e) {
    console.warn('Sync queue write error:', e);
  }
}

function readDeadLetter() {
  try {
    const raw = localStorage.getItem(DEAD_LETTER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeDeadLetter(items) {
  try {
    if (!items.length) {
      localStorage.removeItem(DEAD_LETTER_KEY);
    } else {
      localStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(items.slice(-MAX_DEAD_LETTER)));
    }
  } catch (e) {
    console.warn('Dead letter write error:', e);
  }
}

function pushDeadLetter(op) {
  const items = readDeadLetter();
  items.push({
    ...op,
    failedAt: Date.now(),
  });
  writeDeadLetter(items);
  broadcast('sync:failed', { docId: op.docId, type: op.type, retries: op.retries });
}

function opKey(op) {
  return `${op.collection}:${op.docId}:${op.type}`;
}

function sortQueue(queue) {
  return [...queue].sort((a, b) => {
    if (a.type !== b.type) {
      if (a.type === 'setDoc') return -1;
      if (b.type === 'setDoc') return 1;
    }
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

export function enqueue(op) {
  const queue = readQueue().filter((item) => opKey(item) !== opKey(op));
  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    retries: 0,
    createdAt: Date.now(),
    uid: op.uid || null,
    ...op,
    data: op.data ? serializeData(op.data) : undefined,
  };
  queue.push(entry);
  writeQueue(queue);
  return entry.id;
}

async function executeOp(db, op) {
  const ref = doc(db, op.collection, op.docId);
  const data = op.data ? deserializeData(op.data) : null;

  if (op.type === 'setDoc') {
    await setDoc(ref, data, { merge: op.merge !== false });
  } else if (op.type === 'updateDoc') {
    await updateDoc(ref, data);
  } else {
    throw new Error(`Unknown sync op: ${op.type}`);
  }
}

export async function flushQueue(db, { uid = null } = {}) {
  if (flushing || !isOnline()) return;
  flushing = true;

  try {
    const initial = sortQueue(
      readQueue().filter((op) => !uid || !op.uid || op.uid === uid)
    );

    for (const op of initial) {
      const current = readQueue();
      const live = current.find((item) => item.id === op.id);
      if (!live) continue;

      try {
        await executeOp(db, live);
        writeQueue(readQueue().filter((item) => item.id !== live.id));
        broadcast('sync:completed', { docId: live.docId, type: live.type });
      } catch (e) {
        console.warn('Sync op failed:', live.docId, e);
        const next = readQueue();
        const idx = next.findIndex((item) => item.id === live.id);
        if (idx < 0) continue;

        next[idx].retries = (next[idx].retries || 0) + 1;
        if (next[idx].retries >= MAX_RETRIES) {
          const failed = next.splice(idx, 1)[0];
          pushDeadLetter(failed);
        }
        writeQueue(next);
      }
    }
  } finally {
    flushing = false;
  }
}

export function clearSyncQueue() {
  writeQueue([]);
  writeDeadLetter([]);
}

export function getDeadLetter() {
  return readDeadLetter();
}

export function initSyncQueue(db) {
  window.addEventListener('online', () => flushQueue(db));
  if (isOnline()) flushQueue(db);
}

export function hasPendingSync() {
  return readQueue().length > 0;
}
