import { db } from "./config.js?v=fb1eddf";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { LoginCache } from "./auth-service.js?v=fb1eddf";

// ===== USER CACHE MANAGER =====
const UserCache = {
  PREFIX: "users_",
  CACHE_KEY: "users_list",
  TTL: 1000 * 60 * 5, // 5 menit

  set(data) {
    try {
      localStorage.setItem(
        this.PREFIX + this.CACHE_KEY,
        JSON.stringify({ data, timestamp: Date.now() })
      );
    } catch (e) { console.warn("Cache error:", e); }
  },

  get() {
    try {
      const raw = localStorage.getItem(this.PREFIX + this.CACHE_KEY);
      if (!raw) return null;
      const item = JSON.parse(raw);
      if (Date.now() - item.timestamp > this.TTL) {
        this.clear();
        return null;
      }
      return item.data;
    } catch { return null; }
  },

  clear() {
    localStorage.removeItem(this.PREFIX + this.CACHE_KEY);
  },
};

export const userService = {
  // 1. GET ALL USERS (Cache First)
  async getAllUsers(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = UserCache.get();
      if (cached) return cached;
    }

    const snap = await getDocs(collection(db, "users"));
    const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const roleOrder = {
      'super_admin': 4,
      'admin': 3,
      'guru': 2,
      'viewer': 1
    };
    data.sort((a, b) => {
      const roleDiff = (roleOrder[b.role] || 1) - (roleOrder[a.role] || 1);
      if (roleDiff !== 0) return roleDiff;
      return a.nama.localeCompare(b.nama);
    });

    UserCache.set(data);
    return data;
  },

  // 2. TOGGLE VERIFIED
  async toggleVerified(userId, currentStatus) {
    await updateDoc(doc(db, "users", userId), { isVerified: !currentStatus });
    UserCache.clear();
    LoginCache.remove(userId);
    localStorage.removeItem(`profile_${userId}`);
  },

  // 3. UPDATE USER
  async updateUser(userId, updateData) {
    await updateDoc(doc(db, "users", userId), updateData);
    UserCache.clear();
    LoginCache.remove(userId);
    localStorage.removeItem(`profile_${userId}`);
  },

  // 4. DELETE USER
  async deleteUserDoc(userId) {
    await deleteDoc(doc(db, "users", userId));
    UserCache.clear();
    LoginCache.remove(userId);
    localStorage.removeItem(`profile_${userId}`);
  }
};