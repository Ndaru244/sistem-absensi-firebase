import { auth, db } from "./config.js?v=7d3aff6";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { clearAllAppCaches } from "../utils/cache-utils.js?v=7d3aff6";

const provider = new GoogleAuthProvider();

// ===== LOGIN SESSION CACHE =====
const LoginCache = {
  PREFIX: "login_session_",
  TTL: 1000 * 60 * 60 * 24, // 24 jam

  set(uid, userData) {
    try {
      localStorage.setItem(
        this.PREFIX + uid,
        JSON.stringify({
          data: userData,
          timestamp: Date.now(),
        })
      );
    } catch (e) {
      console.warn("Failed to cache login session:", e);
    }
  },

  get(uid) {
    try {
      const raw = localStorage.getItem(this.PREFIX + uid);
      if (!raw) return null;

      const item = JSON.parse(raw);
      const age = Date.now() - item.timestamp;

      if (age > this.TTL) {
        this.remove(uid);
        return null;
      }

      return item.data;
    } catch {
      return null;
    }
  },

  remove(uid) {
    localStorage.removeItem(this.PREFIX + uid);
  },

  clear() {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith(this.PREFIX)) {
        localStorage.removeItem(key);
      }
    });
  },
};

export const authService = {
  waitForAuth() {
    return new Promise((resolve) => {
      const unsubscribe = auth.onAuthStateChanged((user) => {
        unsubscribe();
        resolve(user);
      });
    });
  },

  getCurrentUser() {
    return auth.currentUser;
  },

  // OPTIMIZED: Check cache first untuk user data
  async getUserData(uid, useCache = true) {
    try {
      if (useCache) {
        const cached = LoginCache.get(uid);
        if (cached) {
          console.log("User data from cache");
          return cached;
        }
      }

      console.log("Fetching user data from Firebase...");
      const userRef = doc(db, "users", uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        return null;
      }

      const userData = userSnap.data();
      LoginCache.set(uid, userData);
      return userData;
    } catch (error) {
      console.error("getUserData error:", error);
      const cached = LoginCache.get(uid);
      return cached || null;
    }
  },

  /** Network-first + retry; fallback cache saat offline */
  async getUserDataReliable(uid, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      const data = await this.getUserData(uid, false);
      if (data) return data;
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
    return this.getUserData(uid, true);
  },

  // OPTIMIZED: Login dengan parallel operations
  async loginWithGoogle() {
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        // New user - create profile
        const newUserData = {
          uid: user.uid,
          nama: user.displayName,
          email: user.email,
          photo: user.photoURL,
          role: "viewer",
          isVerified: false,
          createdAt: new Date().toISOString(),
        };

        // CRITICAL FIX: Wait for Firestore write to complete
        await setDoc(userRef, newUserData);

        // ADDED: Verify write succeeded with retry logic
        let retries = 3;
        while (retries > 0) {
          const verifySnap = await getDoc(userRef);
          if (verifySnap.exists()) {
            console.log("User document created successfully");
            break;
          }
          console.warn(`Retrying document verification (${3 - retries + 1}/3)...`);
          await new Promise(resolve => setTimeout(resolve, 200));
          retries--;
        }

        if (retries === 0) {
          throw new Error("Failed to create user document after retries");
        }

        // Cache immediately
        LoginCache.set(user.uid, newUserData);

        return newUserData;
      }

      const userData = userSnap.data();

      // Cache user data for future use
      LoginCache.set(user.uid, userData);

      return userData;
    } catch (error) {
      console.error("Login Error:", error);
      throw error;
    }
  },

  async updateProfileData(uid, data) {
    try {
      const userRef = doc(db, "users", uid);

      const safeData = {
        nama: data.nama,
        nip: data.nip || "-",
        updatedAt: new Date().toISOString(),
      };

      await updateDoc(userRef, safeData);

      LoginCache.remove(uid);
      localStorage.removeItem(`profile_${uid}`);

      return { success: true };
    } catch (error) {
      console.error("Update Profile Error:", error);
      throw error;
    }
  },

  async logout() {
    clearAllAppCaches();
    await signOut(auth);
    window.location.href = "/login.html";
  },

  // Helper: Quick check if user is admin (from cache)
  isAdmin(uid) {
    const cached = LoginCache.get(uid);
    return cached?.role === "admin" || cached?.role === "super_admin";
  },

  // Helper: Quick check if user is verified (from cache)
  isVerified(uid) {
    const cached = LoginCache.get(uid);
    const isAdmin = cached?.role === "admin" || cached?.role === "super_admin";
    return cached?.isVerified === true || isAdmin;
  },
};

export { LoginCache };
