import { broadcast } from './tab-sync.js?v=6215fc9';

const APP_PREFIXES = ['login_session_', 'profile_', 'users_', 'attendance_', 'app_cache_'];
const APP_KEYS = ['settings_kepala_sekolah'];

// Firebase cache prefixes
const FIREBASE_CACHE_PREFIX = 'firebase_cache_';
const FIREBASE_CACHE_TTL = 1000 * 60 * 30; // 30 minutes

export function getDraftKey(uid) {
  return uid ? `absensi_draft_${uid}` : null;
}

export function readDraft(uid) {
  if (!uid) return null;
  const key = getDraftKey(uid);
  let raw = localStorage.getItem(key);
  if (!raw) {
    const legacy = localStorage.getItem('absensi_draft');
    if (legacy) {
      localStorage.setItem(key, legacy);
      localStorage.removeItem('absensi_draft');
      raw = legacy;
    }
  }
  return raw;
}

export function writeDraft(uid, data) {
  const key = getDraftKey(uid);
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(data));
  const docId = data?.tanggal && data?.kelas ? `${data.tanggal}_${data.kelas}` : null;
  broadcast('draft:changed', { uid, docId });
}

export function removeDraft(uid) {
  const key = getDraftKey(uid);
  if (key) localStorage.removeItem(key);
  localStorage.removeItem('absensi_draft');
  broadcast('draft:removed', { uid });
}

export function clearAllAppCaches() {
  broadcast('cache:cleared', {});
  Object.keys(localStorage).forEach((key) => {
    if (key === 'theme') return;
    if (key.startsWith('absensi_draft')) {
      localStorage.removeItem(key);
      return;
    }
    if (APP_KEYS.includes(key)) {
      localStorage.removeItem(key);
      return;
    }
    if (APP_PREFIXES.some((p) => key.startsWith(p))) {
      localStorage.removeItem(key);
    }
  });
}

const KEPSEK_KEY = 'settings_kepala_sekolah';
const KEPSEK_TTL = 1000 * 60 * 30;

export function getKepalaSekolahCache() {
  try {
    const raw = localStorage.getItem(KEPSEK_KEY);
    if (!raw) return null;
    const item = JSON.parse(raw);
    if (Date.now() - item.timestamp > KEPSEK_TTL) {
      localStorage.removeItem(KEPSEK_KEY);
      return null;
    }
    return item.data;
  } catch {
    return null;
  }
}

export function setKepalaSekolahCache(data) {
  try {
    localStorage.setItem(KEPSEK_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (e) {
    console.warn('Kepsek cache error:', e);
  }
}

export function clearKepalaSekolahCache() {
  localStorage.removeItem(KEPSEK_KEY);
}

// Firebase cache functions
export function getFirebaseCache(collection, docId = null) {
  try {
    const key = docId 
      ? `${FIREBASE_CACHE_PREFIX}${collection}_${docId}`
      : `${FIREBASE_CACHE_PREFIX}${collection}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const item = JSON.parse(raw);
    if (Date.now() - item.timestamp > FIREBASE_CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    return item.data;
  } catch {
    return null;
  }
}

export function setFirebaseCache(collection, data, docId = null) {
  try {
    const key = docId 
      ? `${FIREBASE_CACHE_PREFIX}${collection}_${docId}`
      : `${FIREBASE_CACHE_PREFIX}${collection}`;
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (e) {
    console.warn('Firebase cache error:', e);
  }
}

export function clearFirebaseCache(collection = null, docId = null) {
  try {
    if (collection && docId) {
      const key = `${FIREBASE_CACHE_PREFIX}${collection}_${docId}`;
      localStorage.removeItem(key);
    } else if (collection) {
      // Clear all cache for specific collection
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith(`${FIREBASE_CACHE_PREFIX}${collection}_`) || key === `${FIREBASE_CACHE_PREFIX}${collection}`) {
          localStorage.removeItem(key);
        }
      });
    } else {
      // Clear all firebase cache
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith(FIREBASE_CACHE_PREFIX)) {
          localStorage.removeItem(key);
        }
      });
    }
  } catch (e) {
    console.warn('Clear firebase cache error:', e);
  }
}
