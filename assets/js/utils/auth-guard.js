import { auth } from '../firebase/config.js?v=7d3aff6';
import { authService } from '../firebase/auth-service.js?v=7d3aff6';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

let isInitialized = false;

function canAccessApp(userData) {
  const role = userData?.role;
  const isAdmin = role === 'admin' || role === 'super_admin';
  const isGuru = role === 'guru';
  return userData?.isVerified === true || isAdmin || isGuru;
}

function getHomePath(userData) {
  const role = userData?.role;
  if (role === 'admin' || role === 'super_admin') return 'admin.html';
  return 'index.html';
}

async function resolveSessionUser(uid) {
  let userData = await authService.getUserDataReliable(uid);

  if (userData && !canAccessApp(userData)) {
    const fresh = await authService.getUserData(uid, false);
    if (fresh && canAccessApp(fresh)) userData = fresh;
  }

  return userData;
}

export function initAuthGuard(options = { requireAdmin: false, requireSuperAdmin: false, preventLoginAccess: false }) {
  if (isInitialized) return;
  isInitialized = true;

  onAuthStateChanged(auth, async (user) => {
    const path = window.location.pathname;
    const isLoginPage = path.includes('login');

    try {
      await auth.authStateReady();

      if (!user && !auth.currentUser) {
        if (!isLoginPage) window.location.replace('login.html');
        return;
      }

      const activeUser = user || auth.currentUser;
      if (!activeUser) return;

      let userData = await resolveSessionUser(activeUser.uid);

      if (!userData) {
        if (auth.currentUser && !isLoginPage) {
          console.warn('User doc belum tersedia, tunggu sync...');
          return;
        }
        if (!isLoginPage) window.location.replace('login.html');
        return;
      }

      const isAdmin = userData.role === 'admin' || userData.role === 'super_admin';
      const isSuperAdmin = userData.role === 'super_admin';

      if (isLoginPage && options.preventLoginAccess) {
        if (canAccessApp(userData)) {
          window.location.replace(getHomePath(userData));
        }
        return;
      }

      updateAdminUI(userData.role);

      if (!canAccessApp(userData)) {
        alert('Akun belum diverifikasi Admin.');
        await authService.logout();
        return;
      }

      if (options.requireAdmin && !isAdmin) {
        window.location.replace('index.html');
        return;
      }

      if (options.requireSuperAdmin && !isSuperAdmin) {
        window.location.replace('admin.html');
        return;
      }
    } catch (error) {
      console.error('Auth Guard Error:', error);
      if (!auth.currentUser && !isLoginPage) {
        window.location.replace('login.html');
      }
    }
  });
}

export function updateAdminUI(role) {
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

export async function checkAuthStatus() {
  const user = auth.currentUser;
  if (!user) return null;

  try {
    return await authService.getUserDataReliable(user.uid);
  } catch (error) {
    console.error('Check auth status error:', error);
    return null;
  }
}
