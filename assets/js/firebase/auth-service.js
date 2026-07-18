import { auth, db, storage } from "./config.js?v=e9d50df";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  updateProfile as updateAuthProfile,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  updatePassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  deleteUser,
  reload,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {
  ref,
  uploadString,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-storage.js";
import {
  doc,
  getDoc,
  deleteDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { clearAllAppCaches } from "../utils/cache-utils.js?v=e9d50df";

const provider = new GoogleAuthProvider();
const STRONG_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const GENERIC_RESET_MESSAGE = 'Jika email terdaftar, tautan reset password telah dikirim. Periksa kotak masuk atau folder spam.';

function mapAuthError(error, fallback = 'Terjadi kesalahan autentikasi.') {
  const code = error?.code || '';
  if (code === 'auth/weak-password') {
    return 'Password terlalu lemah. Minimal 8 karakter, huruf besar, huruf kecil, angka, dan karakter unik.';
  }
  if (['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(code)) {
    return 'Password lama tidak sesuai.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Terlalu banyak percobaan. Silakan tunggu beberapa saat lalu coba lagi.';
  }
  if (code === 'auth/requires-recent-login') {
    return 'Sesi login sudah lama. Silakan autentikasi ulang lalu coba lagi.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Autentikasi dibatalkan.';
  }
  if (code === 'auth/user-mismatch') {
    return 'Akun Google yang dipilih tidak cocok dengan sesi saat ini.';
  }
  if (code === 'auth/email-already-in-use' || code === 'auth/credential-already-in-use' || code === 'auth/provider-already-linked') {
    return 'Metode login ini sudah terhubung ke akun lain.';
  }
  if (error?.message && !String(error.message).startsWith('Firebase:')) {
    return error.message;
  }
  return fallback;
}

function assertStrongPassword(password) {
  if (!password || !STRONG_PASSWORD_RE.test(password)) {
    throw new Error('Password minimal 8 karakter, wajib ada huruf besar, huruf kecil, angka, dan karakter unik.');
  }
}

function sanitizePhotoUrl(photo) {
  if (photo == null || photo === '') return null;
  const value = String(photo).trim();
  if (value.startsWith('data:image/')) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      throw new Error('URL foto harus memakai HTTPS.');
    }
    return url.toString();
  } catch (error) {
    if (error?.message === 'URL foto harus memakai HTTPS.') throw error;
    throw new Error('URL foto tidak valid.');
  }
}

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

  async registerWithEmailPassword(email, password, additionalData = {}) {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      const userRef = doc(db, "users", user.uid);
      const newUserData = {
        uid: user.uid,
        nama: additionalData.nama || user.email?.split('@')[0] || 'User',
        email: user.email,
        photo: user.photoURL || null,
        role: additionalData.role || 'viewer',
        isVerified: false,
        createdAt: new Date().toISOString(),
        ...additionalData,
      };

      await setDoc(userRef, newUserData);
      LoginCache.set(user.uid, newUserData);
      return newUserData;
    } catch (error) {
      console.error("Register Error:", error);
      throw error;
    }
  },

  async loginWithEmailPassword(email, password) {
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const user = result.user;
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      let userData = userSnap.exists() ? userSnap.data() : null;

      if (!userData) {
        userData = {
          uid: user.uid,
          nama: user.displayName || user.email?.split('@')[0] || 'User',
          email: user.email,
          photo: user.photoURL || null,
          role: 'viewer',
          isVerified: false,
          createdAt: new Date().toISOString(),
        };
        await setDoc(userRef, userData);
      }

      LoginCache.set(user.uid, userData);
      return userData;
    } catch (error) {
      console.error("Email login Error:", error);
      console.error("Email login code:", error?.code);
      console.error("Email login message:", error?.message);
      if (
        error?.code === 'auth/invalid-credential' ||
        error?.code === 'auth/user-not-found' ||
        error?.code === 'auth/wrong-password' ||
        error?.code === 'auth/invalid-login-credentials'
      ) {
        throw new Error('Email atau password salah. Jika akun Anda memakai Google, gunakan tombol “Masuk dengan Google”.');
      }
      if (error?.code === 'auth/too-many-requests') {
        throw new Error('Terlalu banyak percobaan login. Silakan tunggu beberapa saat lalu coba lagi.');
      }
      throw error;
    }
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
        ...(data.nama !== undefined ? { nama: data.nama } : {}),
        ...(data.nip !== undefined ? { nip: data.nip || "-" } : {}),
        updatedAt: new Date().toISOString(),
      };

      if (data.photo !== undefined) {
        try {
          if (data.photo && String(data.photo).startsWith("data:image")) {
            const photoRef = ref(storage, `users/${uid}/profile-photo.jpg`);
            await uploadString(photoRef, data.photo, "data_url");
            const photoUrl = await getDownloadURL(photoRef);
            safeData.photo = photoUrl;
          } else if (data.photo) {
            safeData.photo = sanitizePhotoUrl(data.photo);
          } else {
            safeData.photo = null;
          }
        } catch (photoError) {
          if (photoError?.message?.includes('URL foto')) {
            throw photoError;
          }
          console.warn("Photo upload skipped due to storage error:", photoError);
        }
      }

      await setDoc(userRef, safeData, { merge: true });

      if (data.nama && auth.currentUser?.uid === uid) {
        try {
          await updateAuthProfile(auth.currentUser, { displayName: data.nama });
        } catch (profileError) {
          console.warn("Could not update Firebase auth display name:", profileError);
        }
      }

      LoginCache.remove(uid);
      localStorage.removeItem(`profile_${uid}`);

      return { success: true };
    } catch (error) {
      console.error("Update Profile Error:", error);
      throw error;
    }
  },

  getAuthProviders(user = auth.currentUser) {
    return user?.providerData?.map((item) => item.providerId) || [];
  },

  hasPasswordProvider(user = auth.currentUser) {
    return this.getAuthProviders(user).includes('password');
  },

  hasGoogleProvider(user = auth.currentUser) {
    return this.getAuthProviders(user).includes('google.com');
  },

  async refreshAuthUser() {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Sesi tidak aktif.');
    }
    await reload(user);
    return auth.currentUser;
  },

  getEmailVerificationStatus(user = auth.currentUser) {
    return {
      email: user?.email || null,
      emailVerified: Boolean(user?.emailVerified),
      providers: this.getAuthProviders(user),
      hasPassword: this.hasPasswordProvider(user),
      hasGoogle: this.hasGoogleProvider(user),
    };
  },

  async sendCurrentEmailVerification() {
    try {
      const user = await this.refreshAuthUser();
      if (!user?.email) {
        throw new Error('Email akun tidak tersedia.');
      }
      if (user.emailVerified) {
        return { success: true, alreadyVerified: true };
      }
      await sendEmailVerification(user);
      return { success: true, alreadyVerified: false };
    } catch (error) {
      console.error('Send email verification error:', error);
      throw new Error(mapAuthError(error, 'Gagal mengirim email verifikasi.'));
    }
  },

  async sendPasswordReset(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) {
      throw new Error('Email wajib diisi.');
    }

    try {
      await sendPasswordResetEmail(auth, normalized);
    } catch (error) {
      console.error('Send password reset error:', error);
      const code = error?.code || '';
      if (!['auth/user-not-found', 'auth/invalid-email'].includes(code)) {
        if (code === 'auth/too-many-requests') {
          throw new Error('Terlalu banyak percobaan. Silakan tunggu beberapa saat lalu coba lagi.');
        }
        throw new Error(mapAuthError(error, 'Gagal mengirim tautan reset password.'));
      }
    }

    return { success: true, message: GENERIC_RESET_MESSAGE };
  },

  async reauthenticateWithPassword(password) {
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Sesi tidak aktif.');
      }
      if (!user.email) {
        throw new Error('Email akun tidak tersedia.');
      }
      if (!password) {
        throw new Error('Password wajib diisi untuk autentikasi ulang.');
      }

      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);
      return { success: true };
    } catch (error) {
      console.error('Reauthenticate password error:', error);
      throw new Error(mapAuthError(error, 'Autentikasi ulang gagal.'));
    }
  },

  async reauthenticateWithGoogle() {
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Sesi tidak aktif.');
      }

      const googleProvider = new GoogleAuthProvider();
      if (user.email) {
        googleProvider.setCustomParameters({ login_hint: user.email });
      }
      await reauthenticateWithPopup(user, googleProvider);
      return { success: true };
    } catch (error) {
      console.error('Reauthenticate Google error:', error);
      throw new Error(mapAuthError(error, 'Autentikasi ulang Google gagal.'));
    }
  },

  async reauthenticateCurrentUser({ password = '', preferGoogle = false } = {}) {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Sesi tidak aktif.');
    }

    const hasPassword = this.hasPasswordProvider(user);
    const hasGoogle = this.hasGoogleProvider(user);

    if (preferGoogle && hasGoogle) {
      return this.reauthenticateWithGoogle();
    }
    if (hasPassword && password) {
      return this.reauthenticateWithPassword(password);
    }
    if (hasGoogle) {
      return this.reauthenticateWithGoogle();
    }
    if (hasPassword) {
      throw new Error('Masukkan password saat ini untuk autentikasi ulang.');
    }
    throw new Error('Tidak ada metode autentikasi ulang yang tersedia.');
  },

  async linkGoogleUserWithEmailPassword(email, password) {
    try {
      let user = auth.currentUser;

      if (!user || user.email?.toLowerCase() !== email.toLowerCase()) {
        const googleProvider = new GoogleAuthProvider();
        googleProvider.setCustomParameters({ login_hint: email });
        const result = await signInWithPopup(auth, googleProvider);
        user = result.user;
      }

      if (!user) {
        throw new Error('Login Google dibatalkan.');
      }

      assertStrongPassword(password);

      const providers = this.getAuthProviders(user);
      if (providers.includes('password')) {
        await updatePassword(user, password);
      } else {
        const credential = EmailAuthProvider.credential(email, password);
        await linkWithCredential(user, credential);
      }

      return { success: true };
    } catch (error) {
      console.error('Link google account to email password error:', error);
      throw new Error(mapAuthError(error, 'Gagal menautkan password ke akun Google.'));
    }
  },

  async changeCurrentUserPassword(oldPassword, newPassword) {
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Sesi tidak aktif.');
      }

      assertStrongPassword(newPassword);

      const email = user.email;
      if (!email) {
        throw new Error('Email akun tidak tersedia.');
      }

      if (!this.hasPasswordProvider(user)) {
        return this.linkCurrentUserWithEmailPassword(newPassword);
      }

      await this.reauthenticateWithPassword(oldPassword);
      await updatePassword(auth.currentUser, newPassword);

      return { success: true };
    } catch (error) {
      console.error('Change password error:', error);
      throw new Error(mapAuthError(error, 'Gagal mengubah password.'));
    }
  },

  async linkCurrentUserWithEmailPassword(password) {
    try {
      let user = auth.currentUser;
      if (!user) {
        throw new Error('Sesi tidak aktif.');
      }

      assertStrongPassword(password);

      const email = user.email;
      if (!email) {
        throw new Error('Email akun tidak tersedia.');
      }

      if (this.hasPasswordProvider(user)) {
        throw new Error('Akun sudah memiliki password. Gunakan form ubah password.');
      }

      if (this.hasGoogleProvider(user)) {
        await this.reauthenticateWithGoogle();
        user = auth.currentUser;
        if (!user) {
          throw new Error('Sesi tidak aktif.');
        }
      }

      const credential = EmailAuthProvider.credential(email, password);
      await linkWithCredential(user, credential);

      return { success: true };
    } catch (error) {
      console.error('Link email password error:', error);
      throw new Error(mapAuthError(error, 'Gagal menautkan password.'));
    }
  },

  async deleteCurrentAccount({ password = '', preferGoogle = false } = {}) {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Sesi tidak aktif.');
    }

    const uid = user.uid;
    const photoPath = `users/${uid}/profile-photo.jpg`;
    const userRef = doc(db, 'users', uid);
    let profileBackup = null;
    let profileDeleted = false;
    let photoDeleted = false;

    try {
      await this.reauthenticateCurrentUser({ password, preferGoogle });

      try {
        const profileSnap = await getDoc(userRef);
        if (profileSnap.exists()) {
          profileBackup = profileSnap.data();
        }
      } catch (backupError) {
        console.warn('Profile backup skipped:', backupError);
      }

      try {
        await deleteObject(ref(storage, photoPath));
        photoDeleted = true;
      } catch (photoError) {
        if (photoError?.code !== 'storage/object-not-found') {
          console.warn('Profile photo delete skipped:', photoError);
        } else {
          photoDeleted = true;
        }
      }

      try {
        await deleteDoc(userRef);
        profileDeleted = true;
      } catch (profileError) {
        console.error('Delete profile doc error:', profileError);
        throw new Error('Gagal menghapus data profil. Akun Auth belum dihapus.');
      }

      try {
        await deleteUser(auth.currentUser || user);
      } catch (authDeleteError) {
        if (profileDeleted && profileBackup) {
          try {
            await setDoc(userRef, {
              ...profileBackup,
              updatedAt: new Date().toISOString(),
              deleteRollbackAt: new Date().toISOString(),
            });
            profileDeleted = false;
          } catch (rollbackError) {
            console.error('Profile rollback failed:', rollbackError);
            throw new Error('Penghapusan Auth gagal dan rollback profil juga gagal. Hubungi admin.');
          }
        }
        throw authDeleteError;
      }

      clearAllAppCaches();
      window.location.href = '/login.html';
      return { success: true, profileDeleted: true, photoDeleted };
    } catch (error) {
      console.error('Delete current account error:', error);
      throw new Error(mapAuthError(error, 'Gagal menghapus akun.'));
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

export default authService;
