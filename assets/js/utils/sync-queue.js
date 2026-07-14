import {
  doc,
  setDoc,
  updateDoc,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { broadcast } from './tab-sync.js?v=e2de285';

const QUEUE_KEY = 'app_sync_queue';
const MAX_RETRIES = 3;
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

export function enqueue(op) {
  const queue = readQueue();
  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    retries: 0,
    createdAt: Date.now(),
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

export async function flushQueue(db) {
  if (flushing || !isOnline()) return;
  const queue = readQueue();
  if (!queue.length) return;

  flushing = true;
  const remaining = [];

  try {
    for (const op of queue) {
      try {
        await executeOp(db, op);
        broadcast('sync:completed', { docId: op.docId, type: op.type });
      } catch (e) {
        console.warn('Sync op failed:', op.docId, e);
        op.retries = (op.retries || 0) + 1;
        if (op.retries < MAX_RETRIES) remaining.push(op);
      }
    }
    writeQueue(remaining);
  } finally {
    flushing = false;
  }
}

export function initSyncQueue(db) {
  window.addEventListener('online', () => flushQueue(db));
  if (isOnline()) flushQueue(db);
}

export function hasPendingSync() {
  return readQueue().length > 0;
}
