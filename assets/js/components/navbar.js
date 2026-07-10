import { profileService } from '../firebase/profile-service.js';
import { authService } from '../firebase/auth-service.js';

// ===== HELPER: ROLE UI CONFIG =====
function getRoleMetadata(role) {
    switch (role) {
        case 'super_admin':
            return { label: 'Super Admin', badge: 'badge-danger', icon: 'shield-alert' };
        case 'admin':
            return { label: 'Guru Piket', badge: 'badge-primary', icon: 'shield-check' };
        case 'guru':
            return { label: 'Guru', badge: 'badge-info', icon: 'graduation-cap' };
        default:
            return { label: 'Viewer', badge: 'badge-neutral', icon: 'eye' };
    }
}

// ===== MAIN FUNCTION =====
export async function initNavbarProfile() {
    try {
        // TUNGGU: Jangan panggil profile sebelum Auth siap
        const user = await authService.waitForAuth();

        if (!user) return renderFallbackProfile();

        // Load profile dari cache/server
        const profile = await profileService.getCurrentUserProfile();
        
        renderProfileButton(profile);
        renderMobileProfile(profile);
        setupProfileDropdown();
    } catch (error) {
        console.error('Failed to load profile:', error);
        renderFallbackProfile();
    }
}

// 1. RENDER DESKTOP BUTTON
function renderProfileButton(profile) {
    const profileContainer = document.getElementById('navbar-profile');
    if (!profileContainer) return;

    const avatarUrl = profileService.getAvatarUrl(profile);
    const displayName = profileService.getDisplayName(profile);
    
    const { label, badge, icon } = getRoleMetadata(profile.role);

    profileContainer.innerHTML = `
        <div class="relative">
            <button id="profile-dropdown-btn"
                    class="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <img src="${avatarUrl}" alt="${displayName}"
                     class="w-8 h-8 rounded-full object-cover border border-slate-200 dark:border-slate-700">
                <div class="hidden md:flex flex-col items-start text-left">
                    <span class="text-sm font-medium text-slate-800 dark:text-slate-100 leading-tight">${displayName}</span>
                    <span class="${badge} mt-0.5">${label}</span>
                </div>
                <i data-lucide="chevron-down" class="hidden md:block w-4 h-4 text-slate-400"></i>
            </button>

            <div id="profile-dropdown"
                 class="hidden absolute right-0 mt-1.5 w-64 card py-1 z-50 transform opacity-0 scale-95 transition-all duration-100 origin-top-right">

                <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                    <div class="flex items-center gap-3">
                        <img src="${avatarUrl}" alt="${displayName}"
                             class="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700">
                        <div class="flex-1 min-w-0">
                            <p class="font-medium text-sm text-slate-900 dark:text-white truncate">${displayName}</p>
                            <p class="text-xs text-slate-500 dark:text-slate-400 truncate">${profile.email}</p>
                            <span class="${badge} mt-1">
                                <i data-lucide="${icon}" class="w-3 h-3"></i> ${label}
                            </span>
                        </div>
                    </div>
                </div>

                <div class="py-1 px-1">
                    <button onclick="window.refreshProfile()"
                            class="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md flex items-center gap-2.5 transition-colors">
                        <i data-lucide="refresh-cw" class="w-4 h-4"></i> Refresh Profile
                    </button>
                    <button onclick="window.toggleTheme()"
                            class="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md flex items-center gap-2.5 transition-colors">
                        <i data-lucide="sun-moon" class="w-4 h-4"></i> Ganti Tema
                    </button>
                    <div class="border-t border-slate-200 dark:border-slate-800 my-1"></div>
                    <button onclick="window.handleLogout()"
                            class="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md flex items-center gap-2.5 transition-colors">
                        <i data-lucide="log-out" class="w-4 h-4"></i> Keluar
                    </button>
                </div>
            </div>
        </div>
    `;

    if (window.lucide) window.lucide.createIcons({ root: profileContainer });
}

// 2. RENDER MOBILE PROFILE
function renderMobileProfile(profile) {
    const mobileContainer = document.getElementById('navbar-profile-mobile');
    if (!mobileContainer) return;

    const avatarUrl = profileService.getAvatarUrl(profile);
    const displayName = profileService.getDisplayName(profile);
    const { label, badge, icon } = getRoleMetadata(profile.role);

    mobileContainer.innerHTML = `
        <div class="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700">
            <img src="${avatarUrl}" alt="${displayName}"
                 class="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700">
            <div class="flex-1 min-w-0">
                <p class="font-medium text-slate-900 dark:text-white truncate text-sm">${displayName}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 truncate">${profile.email}</p>
                <span class="${badge} mt-1">
                    <i data-lucide="${icon}" class="w-3 h-3"></i> ${label}
                </span>
            </div>
        </div>
    `;

    if (window.lucide) window.lucide.createIcons({ root: mobileContainer });
}

// 3. SETUP DROPDOWN INTERACTION
let dropdownCloseHandler = null;

function bindProfileDropdownBtn() {
    const btn = document.getElementById('profile-dropdown-btn');
    const dropdown = document.getElementById('profile-dropdown');
    if (!btn || !dropdown) return;

    const closeDropdown = () => {
        dropdown.classList.remove('opacity-100', 'scale-100');
        dropdown.classList.add('opacity-0', 'scale-95');
        setTimeout(() => dropdown.classList.add('hidden'), 100);
    };

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dropdown.classList.contains('hidden')) {
            dropdown.classList.remove('hidden');
            setTimeout(() => {
                dropdown.classList.remove('opacity-0', 'scale-95');
                dropdown.classList.add('opacity-100', 'scale-100');
            }, 10);
        } else {
            closeDropdown();
        }
    });

    if (!dropdownCloseHandler) {
        dropdownCloseHandler = (e) => {
            const b = document.getElementById('profile-dropdown-btn');
            const d = document.getElementById('profile-dropdown');
            if (!b || !d) return;
            if (!d.contains(e.target) && !b.contains(e.target)) {
                d.classList.remove('opacity-100', 'scale-100');
                d.classList.add('opacity-0', 'scale-95');
                setTimeout(() => d.classList.add('hidden'), 100);
            }
        };
        document.addEventListener('click', dropdownCloseHandler);
    }
}

function setupProfileDropdown() {
    bindProfileDropdownBtn();
}

// 4. FALLBACK (ERROR STATE)
function renderFallbackProfile() {
    const profileContainer = document.getElementById('navbar-profile');
    if (profileContainer) {
        profileContainer.innerHTML = `
            <button onclick="window.handleLogout()" class="btn-secondary btn-sm">
                <i data-lucide="log-in" class="w-4 h-4"></i> Login Ulang
            </button>
        `;
        if (window.lucide) window.lucide.createIcons({ root: profileContainer });
    }
}

// ===== GLOBAL HANDLERS =====

window.refreshProfile = async () => {
    const btn = document.querySelector('#profile-dropdown-btn i[data-lucide="chevron-down"]');
    if(btn) btn.classList.add('animate-spin');
    
    try {
        const profile = await profileService.getCurrentUserProfile(true);
        renderProfileButton(profile);
        renderMobileProfile(profile);
        bindProfileDropdownBtn();

        if (window.showToast) window.showToast('Profile data diperbarui', 'success');
    } catch (error) {
        console.error('Refresh failed:', error);
    }
};

window.handleLogout = async () => {
    const action = async () => {
        profileService.clearCache();
        await authService.logout();
    };

    if (window.showConfirm) {
        window.showConfirm('Apakah Anda yakin ingin keluar dari aplikasi?', action);
    } else if (confirm('Keluar dari aplikasi?')) {
        action();
    }
};