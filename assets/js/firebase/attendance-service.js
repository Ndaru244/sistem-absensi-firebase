import { db, auth } from './config.js?v=69b2699';
import {
    collection, getDocs, doc, getDoc, setDoc, query, where, updateDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { readDraft, removeDraft } from '../utils/cache-utils.js?v=69b2699';
import { broadcast } from '../utils/tab-sync.js?v=69b2699';
import { enqueue, isOnline, flushQueue } from '../utils/sync-queue.js?v=69b2699';

const queryMemCache = new Map();
const QUERY_CACHE_TTL = 1000 * 60 * 3;

function getQueryMemCache(key) {
    const item = queryMemCache.get(key);
    if (!item) return null;
    if (Date.now() - item.timestamp > QUERY_CACHE_TTL) {
        queryMemCache.delete(key);
        return null;
    }
    return item.data;
}

function setQueryMemCache(key, data) {
    queryMemCache.set(key, { data, timestamp: Date.now() });
}

function clearQueryMemCache() {
    queryMemCache.clear();
}

// ===== ATTENDANCE CACHE MANAGER =====
const AttendanceCache = {
    PREFIX: 'attendance_',
    REKAP_TTL: 1000 * 60 * 10,
    REKAP_LOCKED_TTL: 1000 * 60 * 60,

    setRekap(docId, data) {
        try { localStorage.setItem(this.PREFIX + docId, JSON.stringify({ data, timestamp: Date.now() })); } catch (e) { }
    },
    getRekap(docId) {
        try {
            const raw = localStorage.getItem(this.PREFIX + docId);
            if (!raw) return null;
            const item = JSON.parse(raw);
            const ttl = item.data?.is_locked ? this.REKAP_LOCKED_TTL : this.REKAP_TTL;
            if (Date.now() - item.timestamp > ttl) {
                this.removeRekap(docId);
                return null;
            }
            return item.data;
        } catch { return null; }
    },
    setMaster(kelasId, data) {
        try { localStorage.setItem(this.PREFIX + 'master_' + kelasId, JSON.stringify({ data, timestamp: Date.now() })); } catch (e) { }
    },
    getMaster(kelasId) {
        try {
            const raw = localStorage.getItem(this.PREFIX + 'master_' + kelasId);
            if (!raw) return null;
            const item = JSON.parse(raw);
            if (Date.now() - item.timestamp > 1000 * 60 * 60) {
                this.removeMaster(kelasId);
                return null;
            }
            return item.data;
        } catch { return null; }
    },
    removeMaster(kelasId) { localStorage.removeItem(this.PREFIX + 'master_' + kelasId); },
    removeRekap(docId) { localStorage.removeItem(this.PREFIX + docId); },
    removeMonthlyReport(kelasId, monthStr) {
        localStorage.removeItem(this.PREFIX + `monthly_${kelasId}_${monthStr}`);
    },
    setMonthlyReport(kelasId, monthStr, data) {
        try {
            const key = `monthly_${kelasId}_${monthStr}`;
            localStorage.setItem(this.PREFIX + key, JSON.stringify({ data, timestamp: Date.now() }));
        } catch (e) { }
    },
    getMonthlyReport(kelasId, monthStr) {
        try {
            const key = `monthly_${kelasId}_${monthStr}`;
            const raw = localStorage.getItem(this.PREFIX + key);
            if (!raw) return null;
            const item = JSON.parse(raw);
            if (Date.now() - item.timestamp > 1000 * 60 * 10) {
                localStorage.removeItem(this.PREFIX + key);
                return null;
            }
            return item.data;
        } catch { return null; }
    },
    clearAll() {
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(this.PREFIX)) localStorage.removeItem(key);
        });
    }
};

// ===== ATTENDANCE SERVICE =====
export const attendanceService = {

    // 1. GET REKAP (Draft > Cache > Firebase)
    async getRekap(docId, forceRefresh = false) {
        try {
            const uid = auth.currentUser?.uid;
            const draftRaw = uid ? readDraft(uid) : null;
            if (draftRaw && !forceRefresh) {
                const parsed = JSON.parse(draftRaw);
                if (`${parsed.tanggal}_${parsed.kelas}` === docId) return parsed;
            }
            
            if (!forceRefresh) {
                const cached = AttendanceCache.getRekap(docId);
                if (cached && !cached.is_locked) return cached;
            }

            const ref = doc(db, "rekap_absensi", docId);
            const snap = await getDoc(ref);
            if (snap.exists()) {
                const data = snap.data();
                AttendanceCache.setRekap(docId, data);
                return data;
            }
            return null;
        } catch (error) { console.error(error); throw error; }
    },

    // 2. GET MASTER SISWA
    async getMasterSiswa(kelasId, forceRefresh = false) {
        try {
            if (!forceRefresh) {
                const cached = AttendanceCache.getMaster(kelasId);
                if (cached) return cached;
            }
            const kelasRef = doc(db, "kelas", kelasId);
            const kelasSnap = await getDoc(kelasRef);
            const isKhusus = kelasSnap.exists() && kelasSnap.data().is_khusus === true;

            let siswaDocs = [];
            if (isKhusus) {
                const q = query(collection(db, "anggota_kelas"), where("kelasId", "==", kelasId));
                const snap = await getDocs(q);
                const ids = snap.docs.map(d => d.data().siswaId);
                if (ids.length > 0) {
                    const promises = ids.map(id => getDoc(doc(db, "siswa", id)));
                    const results = await Promise.all(promises);
                    siswaDocs = results.filter(d => d.exists()).map(d => ({ id: d.id, ...d.data() }));
                }
            } else {
                const q = query(collection(db, "siswa"), where("id_kelas", "==", kelasId), where("status_aktif", "==", "Aktif"));
                const snap = await getDocs(q);
                siswaDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            }
            let mapSiswa = {};
            siswaDocs.forEach(s => {
                mapSiswa[s.id] = { nama: s.nama_siswa, nis: s.nis || "-", status: "Hadir", keterangan: "-" };
            });
            if (Object.keys(mapSiswa).length > 0) AttendanceCache.setMaster(kelasId, mapSiswa);
            return mapSiswa;
        } catch (error) { throw error; }
    },

    // 3. SAVE REKAP
    async saveRekap(docId, data) {
        try {
            if (!data.created_at) data.created_at = Timestamp.now();
            data.updated_at = Timestamp.now();
            AttendanceCache.setRekap(docId, data);
            AttendanceCache.removeMonthlyReport(data.kelas, data.tanggal.slice(0, 7));
            clearQueryMemCache();
            if (auth.currentUser?.uid) removeDraft(auth.currentUser.uid);

            const writeOp = { type: 'setDoc', collection: 'rekap_absensi', docId, data, merge: true };
            if (!isOnline()) {
                enqueue(writeOp);
                broadcast('rekap:updated', { docId });
                return;
            }

            try {
                const ref = doc(db, "rekap_absensi", docId);
                await setDoc(ref, data, { merge: true });
                broadcast('rekap:updated', { docId });
            } catch (error) {
                enqueue(writeOp);
                broadcast('rekap:updated', { docId });
                flushQueue(db).catch(() => {});
            }
        } catch (error) { throw error; }
    },

    // 4. LOCK REKAP
    async lockRekap(docId) {
        try {
            const lockData = { is_locked: true, locked_at: Timestamp.now() };
            const cached = AttendanceCache.getRekap(docId);
            if (cached) {
                cached.is_locked = true;
                cached.locked_at = lockData.locked_at;
                AttendanceCache.setRekap(docId, cached);
            }
            clearQueryMemCache();

            const writeOp = { type: 'updateDoc', collection: 'rekap_absensi', docId, data: lockData };
            if (!isOnline()) {
                enqueue(writeOp);
                broadcast('rekap:updated', { docId });
                return;
            }

            try {
                const ref = doc(db, "rekap_absensi", docId);
                await updateDoc(ref, lockData);
                broadcast('rekap:updated', { docId });
            } catch (error) {
                enqueue(writeOp);
                broadcast('rekap:updated', { docId });
                flushQueue(db).catch(() => {});
            }
        } catch (error) { throw error; }
    },
    async unlockRekap(docId) {
        try {
            const unlockData = { is_locked: false };
            const cached = AttendanceCache.getRekap(docId);
            if (cached) {
                cached.is_locked = false;
                AttendanceCache.setRekap(docId, cached);
            }
            clearQueryMemCache();

            const writeOp = { type: 'updateDoc', collection: 'rekap_absensi', docId, data: unlockData };
            if (!isOnline()) {
                enqueue(writeOp);
                broadcast('rekap:updated', { docId });
                return;
            }

            try {
                const ref = doc(db, "rekap_absensi", docId);
                await updateDoc(ref, unlockData);
                broadcast('rekap:updated', { docId });
            } catch (error) {
                enqueue(writeOp);
                broadcast('rekap:updated', { docId });
                flushQueue(db).catch(() => {});
            }
        } catch (error) {
            console.error("Error unlocking rekap:", error);
            throw error;
        }
    },

    // 5. GET MONTHLY REPORT
    async getMonthlyReport(kelasId, monthStr, forceRefresh = false) {
        try {
            if (!forceRefresh) {
                const cached = AttendanceCache.getMonthlyReport(kelasId, monthStr);
                if (cached) return cached;
            }
            const startStr = `${monthStr}-01`;
            const [y, m] = monthStr.split("-").map(Number);
            const lastDay = new Date(y, m, 0).getDate();
            const endStr = `${monthStr}-${String(lastDay).padStart(2, "0")}`;
            const q = query(
                collection(db, "rekap_absensi"),
                where("kelas", "==", kelasId),
                where("tanggal", ">=", startStr),
                where("tanggal", "<=", endStr)
            );
            const snap = await getDocs(q);
            const data = snap.docs.map(d => d.data());
            AttendanceCache.setMonthlyReport(kelasId, monthStr, data);
            return data;
        } catch (error) { throw error; }
    },

    // 6. GET REKAP BY DATE (Untuk Dashboard Status Kelas)
    async getRekapByDate(dateStr) {
        try {
            const cacheKey = `date_${dateStr}`;
            const cached = getQueryMemCache(cacheKey);
            if (cached) return cached;

            const q = query(collection(db, "rekap_absensi"), where("tanggal", "==", dateStr));
            const snap = await getDocs(q);
            const data = snap.docs.map(d => d.data());
            setQueryMemCache(cacheKey, data);
            return data;
        } catch (error) { throw error; }
    },

    // 7. GET REKAP BY DATE RANGE (Untuk Grafik Dashboard)
    async getRekapByDateRange(startStr, endStr, kelasId = null) {
        try {
            const cacheKey = `range_${startStr}_${endStr}_${kelasId || 'all'}`;
            const cached = getQueryMemCache(cacheKey);
            if (cached) return cached;

            let q;
            if (kelasId) {
                q = query(
                    collection(db, "rekap_absensi"),
                    where("kelas", "==", kelasId),
                    where("tanggal", ">=", startStr),
                    where("tanggal", "<=", endStr)
                );
            } else {
                q = query(
                    collection(db, "rekap_absensi"),
                    where("tanggal", ">=", startStr),
                    where("tanggal", "<=", endStr)
                );
            }
            const snap = await getDocs(q);
            const data = snap.docs.map(d => d.data());
            setQueryMemCache(cacheKey, data);
            return data;
        } catch (error) { throw error; }
    },

    invalidateRekap(docId) { AttendanceCache.removeRekap(docId); },
    invalidateMonthlyReport(kelasId, monthStr) {
        AttendanceCache.removeMonthlyReport(kelasId, monthStr);
    },
    invalidateMaster(kelasId) { AttendanceCache.removeMaster(kelasId); },
    clearAllCaches() { AttendanceCache.clearAll(); clearQueryMemCache(); }
};

export { AttendanceCache };