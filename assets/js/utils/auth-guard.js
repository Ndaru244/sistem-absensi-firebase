import { auth } from '../firebase/config.js';
import { authService } from '../firebase/auth-service.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

// Track if guard already initialized to prevent duplicate checks
let isInitialized = false;

export function initAuthGuard(options = { requireAdmin: false, requireSuperAdmin: false, preventLoginAccess: false }) {
    // Prevent duplicate initialization
    if (isInitialized) {
        console.log('Auth guard already initialized');
        return;
    }
    isInitialized = true;

    onAuthStateChanged(auth, async (user) => {
        // Handle clean URLs (could be /login or /login.html)
        const path = window.location.pathname;
        const isLoginPage = path.includes('login');
        
        // Not logged in
        if (!user) {
            if (!isLoginPage) {
                window.location.href = 'login.html';
            }
            return;
        }

        // OPTIMIZED: Use cached user data instead of Firestore query
        try {
            let userData = await authService.getUserData(user.uid, true); // useCache = true
            
            if (!userData) {
                console.warn('User data not found, waiting for Firestore sync...');
                await new Promise(resolve => setTimeout(resolve, 500));
                userData = await authService.getUserData(user.uid, false); // Force fresh read
            }
            if (!userData) {
                console.error('User data still not found after retry, logging out...');
                await auth.signOut();
                if (!isLoginPage) window.location.href = 'login.html';
                return;
            }

            const isAdmin = userData.role === 'admin' || userData.role === 'super_admin';
            const isSuperAdmin = userData.role === 'super_admin';

            // Handle login page access for authenticated users
            if (isLoginPage && options.preventLoginAccess) {
                if (userData.isVerified || isAdmin) {
                    window.location.replace(isAdmin ? 'admin.html' : 'index.html');
                }
                return;
            }

            // --- UPDATE UI BASED ON ROLE ---
            updateAdminUI(userData.role);

            // Redirect if on login page but already authenticated
            if (options.preventLoginAccess) {
                window.location.href = isAdmin ? 'admin.html' : 'index.html';
                return;
            }

            // Block unverified users (except admins)
            if (!userData.isVerified && !isAdmin) {
                alert("Akun belum diverifikasi Admin.");
                await auth.signOut();
                window.location.href = 'login.html';
                return;
            }

            // Block non-admin access to admin pages
            if (options.requireAdmin && !isAdmin) {
                window.location.href = 'index.html';
                return;
            }

            // Block non-super-admin access to restricted pages
            if (options.requireSuperAdmin && !isSuperAdmin) {
                window.location.href = 'admin.html';
                return;
            }

        } catch (error) {
            console.error("Auth Guard Error:", error);
            // On error, fallback to logout for security
            await auth.signOut();
            window.location.href = 'login.html';
        }
    });
}

// Helper: admin link visibility
function updateAdminUI(role) {
    const adminElements = document.querySelectorAll('.admin-only');
    const superAdminElements = document.querySelectorAll('.super-admin-only');

    adminElements.forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('flex');
    });
    superAdminElements.forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('flex');
    });

    if (role === 'admin' || role === 'super_admin') {
        adminElements.forEach(el => {
            el.classList.remove('hidden');
            el.classList.add('flex');
        });
    }
    if (role === 'super_admin') {
        superAdminElements.forEach(el => {
            el.classList.remove('hidden');
            el.classList.add('flex');
        });
    }
}

// Export helper to check auth status without redirect
export async function checkAuthStatus() {
    const user = auth.currentUser;
    if (!user) return null;

    try {
        const userData = await authService.getUserData(user.uid, true);
        return userData;
    } catch (error) {
        console.error('Check auth status error:', error);
        return null;
    }
}