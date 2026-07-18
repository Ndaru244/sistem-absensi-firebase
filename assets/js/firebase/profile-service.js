import { db } from './config.js?v=72ec519';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { authService } from './auth-service.js?v=72ec519';

// ===== PROFILE CACHE =====
const ProfileCache = {
    PREFIX: 'profile_',
    TTL: 1000 * 60 * 10, // 10 menit

    set(uid, data) {
        try {
            localStorage.setItem(this.PREFIX + uid, JSON.stringify({
                data,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.warn('Failed to cache profile:', e);
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
        keys.forEach(key => {
            if (key.startsWith(this.PREFIX)) {
                localStorage.removeItem(key);
            }
        });
    }
};

// ===== PROFILE SERVICE =====
export const profileService = {

    // Get Current User Profile
    async getCurrentUserProfile(forceRefresh = false) {

        try {
            const currentUser = authService.getCurrentUser();
            if (!currentUser) {
                throw new Error('User not authenticated');
            }

            const uid = currentUser.uid;

            // Check cache first
            if (!forceRefresh) {
                const cached = ProfileCache.get(uid);
                if (cached) {
                    console.log('Profile loaded from cache');
                    return cached;
                }
            }

            // Fetch from Firestore
            console.log('Fetching profile from Firebase...');
            const userDoc = await getDoc(doc(db, "users", uid));

            if (!userDoc.exists()) {
                throw new Error('User profile not found');
            }

            const profile = {
                uid,
                ...userDoc.data()
            };

            // Cache the profile
            ProfileCache.set(uid, profile);

            return profile;
        } catch (error) {
            console.error('Error getting profile:', error);
            throw error;
        }
    },

    // Get Avatar URL with fallback
    getAvatarUrl(profile) {
        if (profile?.photo) {
            return profile.photo;
        }

        const name = profile?.nama || profile?.email || 'User';
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff&bold=true`;
    },

    // Get Display Name
    getDisplayName(profile) {
        return profile?.nama || profile?.email?.split('@')[0] || 'User';
    },

    // Check if admin
    isAdmin(profile) {
        return profile?.role === 'admin' || profile?.role === 'super_admin';
    },

    // Clear profile cache (for logout)
    clearCache() {
        ProfileCache.clear();
    }
};

export { ProfileCache };