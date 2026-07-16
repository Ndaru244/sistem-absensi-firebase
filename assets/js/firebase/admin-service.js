import { db } from './config.js?v=dd5a477';
import { AttendanceCache } from './attendance-service.js?v=dd5a477';
import {
    collection, getDocs, doc, writeBatch, deleteDoc, setDoc, query, where, limit, getDoc
    // Hapus 'orderBy' dari import jika tidak dipakai lagi, atau biarkan saja tidak masalah
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

// ... (CacheManager Tetap Sama) ...
const CacheManager = {
    PREFIX: 'app_cache_',
    TTL: 1000 * 60 * 30, // 30 menit

    set(key, data) {
        try { 
            const item = { data, timestamp: Date.now() };
            localStorage.setItem(this.PREFIX + key, JSON.stringify(item));
        } catch (e) { console.warn('Cache Full/Error', e); }
    },

    get(key) {
        try {
            const raw = localStorage.getItem(this.PREFIX + key);
            if (!raw) return null;
            const item = JSON.parse(raw);
            if (Date.now() - item.timestamp > this.TTL) {
                this.remove(key);
                return null;
            }
            return item.data;
        } catch (e) { return null; }
    },

    remove(key) { localStorage.removeItem(this.PREFIX + key); },
    clear() {
        Object.keys(localStorage)
            .filter((k) => k.startsWith(this.PREFIX))
            .forEach((k) => localStorage.removeItem(k));
    }
};

export const adminService = {

    // 1. DATA KELAS
    async getClasses(forceRefresh = false) {
        const cacheKey = 'classes';
        
        if (!forceRefresh) {
            const cached = CacheManager.get(cacheKey);
            if (cached && Array.isArray(cached) && cached.length > 0) {
                return cached;
            }
        }

        console.log("Mengambil Data Kelas dari Firebase...");
        try {
            const q = query(collection(db, "kelas")); 
            const snap = await getDocs(q);
            
            if (snap.empty) {
                console.warn("Data Kelas Kosong di Firebase!");
                return []; 
            }

            const data = snap.docs.map(d => ({ 
                id: d.id, // ID Dokumen Firestore
                ...d.data(),
                nama_kelas: d.data().nama_kelas || d.id,
                is_khusus: d.data().is_khusus === true
            }));

            data.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

            CacheManager.set(cacheKey, data);
            return data;
        } catch (e) {
            console.error("Gagal ambil kelas:", e);
            throw e;
        }
    },

    async getKelasList(forceRefresh = false) {
        const classes = await this.getClasses(forceRefresh);
        return classes.map(c => ({ id: c.id, nama: c.nama_kelas }));
    },

    async createClass(id, nama, isKhusus = false) {
        const docRef = doc(db, "kelas", id);
        const snap = await getDoc(docRef);
        if (snap.exists()) throw new Error("ID Kelas sudah digunakan!");

        await setDoc(docRef, { 
            nama_kelas: nama || id, 
            is_khusus: isKhusus 
        });
        CacheManager.remove('classes'); 
    },

    async deleteClass(id) {
        const q = query(collection(db, "anggota_kelas"), where("kelasId", "==", id));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const batch = writeBatch(db);
            snap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
        await deleteDoc(doc(db, "kelas", id));
        CacheManager.remove('classes');
    },

    // 2. DATA SISWA
    async getSiswaByKelas(kelasId) {
        const allClasses = await this.getClasses();
        const targetClass = allClasses.find(c => c.id === kelasId);
        const isSpecial = targetClass ? targetClass.is_khusus : false;

        if (isSpecial) {
            // === KELAS KHUSUS (Mapel) ===
            console.log(`Fetch Siswa Khusus: ${kelasId}`);
            
            const q = query(collection(db, "anggota_kelas"), where("kelasId", "==", kelasId));
            const snap = await getDocs(q);
            const siswaIds = snap.docs.map(d => d.data().siswaId);

            if (siswaIds.length === 0) return [];

            // Fetch Detail Siswa
            const promises = siswaIds.map(id => getDoc(doc(db, "siswa", id)));
            const docs = await Promise.all(promises);

            return docs.filter(d => d.exists())
                .map(d => ({
                    id: d.id,
                    nama: d.data().nama_siswa || "Tanpa Nama",
                    nis: d.data().nis || "-",
                    id_kelas: d.data().id_kelas
                }))
                .sort((a, b) => a.nama.localeCompare(b.nama));

        } else {
            // === KELAS REGULER ===
            console.log(`Fetch Siswa Reguler: ${kelasId}`);
            const q = query(collection(db, "siswa"), where("id_kelas", "==", kelasId));
            const snap = await getDocs(q);
            
            return snap.docs
                .map(d => ({
                    id: d.id,
                    nama: d.data().nama_siswa || "Tanpa Nama",
                    nis: d.data().nis || "-",
                    id_kelas: d.data().id_kelas,
                    status_aktif: d.data().status_aktif
                }))
                .filter(s => s.status_aktif === 'Aktif')
                .sort((a, b) => a.nama.localeCompare(b.nama));
        }
    },

    async checkNISExists(nis) {
        const q = query(collection(db, "siswa"), where("nis", "==", nis), limit(1));
        const snap = await getDocs(q);
        return !snap.empty;
    },

    async uploadDraftBatch(draftData) {
        if (!draftData || draftData.length === 0) return;
        const batch = writeBatch(db);

        draftData.forEach((student) => {
            const newDocRef = doc(collection(db, "siswa"));
            batch.set(newDocRef, {
                id_kelas: student.id_kelas,
                nama_siswa: student.nama_siswa,
                nis: student.nis,
                status_aktif: 'Aktif'
            });
        });

        await batch.commit();
        draftData.forEach((student) => {
            AttendanceCache.removeMaster(student.id_kelas);
        });
    },

    async addSiswaToSpecialClass(kelasId, siswaIds) {
        const batch = writeBatch(db);
        siswaIds.forEach(siswaId => {
            const ref = doc(db, "anggota_kelas", `${kelasId}_${siswaId}`);
            batch.set(ref, { 
                kelasId: kelasId, 
                siswaId: siswaId,
                assignedAt: Date.now()
            });
        });
        await batch.commit();
        AttendanceCache.removeMaster(kelasId);
    },

    async moveStudentBatch(studentIds, newClassId) {
        if (!studentIds || studentIds.length === 0) return;
        
        const batch = writeBatch(db);
        const timestamp = Date.now();

        studentIds.forEach(id => {
            const ref = doc(db, "siswa", id);
            batch.update(ref, { 
                id_kelas: newClassId,
                updated_at: timestamp 
            });
        });

        await batch.commit();

        CacheManager.clear();
        AttendanceCache.clearAll();
    },

    async deleteStudent(id, kelasId) {
        const kelasRef = doc(db, "kelas", kelasId);
        const snap = await getDoc(kelasRef);
        const isKhusus = snap.exists() && snap.data().is_khusus === true;

        if (isKhusus) {
            console.log(`Menghapus siswa ${id} dari kelas khusus ${kelasId}`);
            await deleteDoc(doc(db, "anggota_kelas", `${kelasId}_${id}`));
        } else {
            console.log(`Menghapus siswa ${id} secara permanen`);
            await deleteDoc(doc(db, "siswa", id));
        }
        if (kelasId) {
            AttendanceCache.removeMaster(kelasId);
            CacheManager.remove('classes');
        }
    }
};