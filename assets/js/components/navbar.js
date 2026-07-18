import { profileService } from '../firebase/profile-service.js?v=e9d50df';
import { authService } from '../firebase/auth-service.js?v=e9d50df';
import { showConfirm, showToast } from '../utils/ui.js?v=e9d50df';

const PROFILE_MODAL_ID = 'modalProfile';
let activeProfileTab = 'info';
let profileModalBound = false;
let isSavingProfile = false;
let isSecurityBusy = false;
let profileModalCache = null;
let profileModalLoading = null;

function clearProfileModalCache() {
    profileModalCache = null;
    profileModalLoading = null;
}

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

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getPasswordStrength(password) {
    if (!password) return { score: 0, label: 'Kosong', color: 'bg-slate-300', text: 'text-slate-500' };

    const checks = [
        password.length >= 8,
        /[a-z]/.test(password),
        /[A-Z]/.test(password),
        /\d/.test(password),
        /[^A-Za-z0-9]/.test(password),
    ];

    const passed = checks.filter(Boolean).length;

    if (passed <= 2) {
        return { score: 1, label: 'Lemah', color: 'bg-red-500', text: 'text-red-600' };
    }
    if (passed <= 4) {
        return { score: 2, label: 'Sedang', color: 'bg-amber-500', text: 'text-amber-600' };
    }
    return { score: 3, label: 'Kuat', color: 'bg-emerald-500', text: 'text-emerald-600' };
}

function isStrongPassword(password) {
    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(password);
}

function providerLabels(providers = []) {
    const labels = [];
    if (providers.includes('google.com')) labels.push('Google');
    if (providers.includes('password')) labels.push('Email/Password');
    return labels.length ? labels.join(' · ') : 'Tidak diketahui';
}

function ensureProfileModal() {
    let modal = document.getElementById(PROFILE_MODAL_ID);
    if (modal) return modal;

    document.body.insertAdjacentHTML('beforeend', `
        <div id="${PROFILE_MODAL_ID}" class="fixed inset-0 z-[70] hidden flex flex-col bg-slate-50 dark:bg-slate-950">
            <header class="app-nav relative">
                <div class="max-w-4xl mx-auto px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3 py-3">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 bg-primary-600 rounded-md flex items-center justify-center text-white">
                            <i data-lucide="user-cog" class="w-4 h-4"></i>
                        </div>
                        <div>
                            <h3 class="text-sm font-semibold text-slate-900 dark:text-white">Pengaturan Profil</h3>
                            <p class="text-xs text-slate-500 dark:text-slate-400">Info akun dan keamanan</p>
                        </div>
                    </div>
                    <button type="button" id="profile-modal-close" class="btn-ghost btn-icon">
                        <i data-lucide="x" class="w-5 h-5"></i>
                    </button>
                </div>
            </header>

            <section class="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 sm:px-6">
                <div class="max-w-4xl mx-auto flex gap-2 py-3">
                    <button type="button" data-profile-tab="info" class="profile-tab-btn btn-secondary btn-sm">
                        <i data-lucide="user" class="w-4 h-4"></i> Info Akun
                    </button>
                    <button type="button" data-profile-tab="security" class="profile-tab-btn btn-secondary btn-sm">
                        <i data-lucide="shield" class="w-4 h-4"></i> Keamanan
                    </button>
                </div>
            </section>

            <div id="profile-modal-body" class="flex-1 overflow-auto custom-scrollbar bg-white dark:bg-slate-900">
                <div class="max-w-4xl mx-auto px-4 sm:px-6 py-6"></div>
            </div>

            <footer class="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2.5 text-xs text-slate-400 flex justify-between items-center">
                <span id="profile-modal-status">Siap</span>
                <span class="hidden sm:block">SDN Sunter Agung 12 PG</span>
            </footer>
        </div>
    `);

    modal = document.getElementById(PROFILE_MODAL_ID);
    bindProfileModalShell(modal);
    if (window.lucide) {
        window.lucide.createIcons({ root: modal.querySelector('header') });
        window.lucide.createIcons({ root: modal.querySelector('section') });
    }
    return modal;
}

function setProfileModalStatus(text) {
    const el = document.getElementById('profile-modal-status');
    if (el) el.textContent = text || 'Siap';
}

function setActiveTabStyles() {
    document.querySelectorAll('.profile-tab-btn').forEach((btn) => {
        const active = btn.getAttribute('data-profile-tab') === activeProfileTab;
        btn.classList.toggle('btn-primary', active);
        btn.classList.toggle('btn-secondary', !active);
    });
}

function bindProfileModalShell(modal) {
    if (profileModalBound || !modal) return;
    profileModalBound = true;

    modal.querySelector('#profile-modal-close')?.addEventListener('click', closeProfileModal);

    modal.querySelectorAll('.profile-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const nextTab = btn.getAttribute('data-profile-tab') || 'info';
            if (nextTab === activeProfileTab) return;
            activeProfileTab = nextTab;
            renderActiveProfileTab({ forceRefresh: false, showLoading: false });
        });
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeProfileModal();
        }
    });
}

function closeProfileModal() {
    const modal = document.getElementById(PROFILE_MODAL_ID);
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    setProfileModalStatus('Siap');
    clearProfileModalCache();
}

async function refreshNavbarProfile() {
    const updatedProfile = await profileService.getCurrentUserProfile(true);
    renderProfileButton(updatedProfile);
    renderMobileProfile(updatedProfile);
    bindProfileDropdownBtn();
    return updatedProfile;
}

async function loadProfileModalData(forceRefresh = false) {
    if (!forceRefresh && profileModalCache) {
        return profileModalCache;
    }

    if (!forceRefresh && profileModalLoading) {
        return profileModalLoading;
    }

    profileModalLoading = (async () => {
        const [profile, authStatus] = await Promise.all([
            profileService.getCurrentUserProfile(forceRefresh),
            getAuthStatus(forceRefresh),
        ]);
        profileModalCache = { profile, authStatus };
        return profileModalCache;
    })();

    try {
        return await profileModalLoading;
    } finally {
        profileModalLoading = null;
    }
}

function renderInfoTab(profile, authStatus) {
    const avatarUrl = profileService.getAvatarUrl(profile);
    const displayName = profileService.getDisplayName(profile);
    const { label } = getRoleMetadata(profile.role);
    const photoValue = profile.photo || '';

    return `
        <div class="space-y-5">
            <div class="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
                <img id="profile-preview-img" src="${escapeHtml(avatarUrl)}" alt="Preview foto" class="h-24 w-24 rounded-full object-cover border border-slate-200 dark:border-slate-700">
                <label class="w-full text-sm font-medium text-slate-700 dark:text-slate-300">
                    <span class="mb-1 block">Link Foto Profil</span>
                    <input id="profile-photo-link" type="url" value="${escapeHtml(photoValue)}" class="input w-full" placeholder="https://example.com/foto.jpg">
                </label>
                <p class="text-center text-xs text-slate-500 dark:text-slate-400">Masukkan URL gambar yang bisa diakses publik.</p>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
                <label class="text-sm font-medium text-slate-700 dark:text-slate-300">
                    <span class="mb-1 block">Nama Lengkap</span>
                    <input id="profile-name" type="text" value="${escapeHtml(displayName)}" class="input w-full">
                </label>

                <label class="text-sm font-medium text-slate-700 dark:text-slate-300">
                    <span class="mb-1 block">NIP</span>
                    <input id="profile-nip" type="text" value="${escapeHtml(profile.nip || '')}" class="input w-full" placeholder="Masukkan NIP">
                </label>

                <label class="text-sm font-medium text-slate-700 dark:text-slate-300 md:col-span-2">
                    <span class="mb-1 block">Email</span>
                    <input id="profile-email" type="text" value="${escapeHtml(profile.email || authStatus.email || '')}" class="input w-full bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400" disabled>
                    <span class="mt-1 block text-xs text-slate-500 dark:text-slate-400">Email tidak dapat diganti dari aplikasi.</span>
                </label>

                <label class="text-sm font-medium text-slate-700 dark:text-slate-300">
                    <span class="mb-1 block">Role</span>
                    <input type="text" value="${escapeHtml(label)}" class="input w-full bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400" disabled>
                </label>

                <label class="text-sm font-medium text-slate-700 dark:text-slate-300">
                    <span class="mb-1 block">Metode Login</span>
                    <input type="text" value="${escapeHtml(providerLabels(authStatus.providers))}" class="input w-full bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400" disabled>
                </label>
            </div>

            <div class="flex justify-end gap-2">
                <button type="button" id="profile-save-btn" class="btn-primary btn-sm">
                    <i data-lucide="save" class="w-4 h-4"></i> Simpan Profil
                </button>
            </div>
        </div>
    `;
}

function renderSecurityTab(profile, authStatus) {
    const verified = authStatus.emailVerified;
    const hasPassword = authStatus.hasPassword;
    const hasGoogle = authStatus.hasGoogle;

    const oldPasswordField = hasPassword ? `
        <label class="text-sm font-medium text-slate-700 dark:text-slate-300">
            <span class="mb-1 block">Password Saat Ini</span>
            <div class="relative">
                <input id="security-old-password" type="password" class="input w-full pr-10" placeholder="Password saat ini">
                <button type="button" class="toggle-password absolute inset-y-0 right-0 flex items-center px-3 text-slate-500" data-target="security-old-password">
                    <i data-lucide="eye" class="w-4 h-4"></i>
                </button>
            </div>
            <p id="security-old-password-error" class="mt-1 hidden text-sm text-red-600 dark:text-red-400"></p>
        </label>
    ` : '';

    return `
        <div class="space-y-5">
            <div class="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <h4 class="text-sm font-semibold text-slate-900 dark:text-white">Verifikasi Email</h4>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Status terpisah dari verifikasi Admin aplikasi.</p>
                    </div>
                    <span class="${verified ? 'badge-success' : 'badge-warning'}">${verified ? 'Terverifikasi' : 'Belum diverifikasi'}</span>
                </div>
                <p class="text-sm text-slate-600 dark:text-slate-300">${escapeHtml(authStatus.email || profile.email || '-')}</p>
                <div class="flex flex-wrap gap-2">
                    <button type="button" id="security-send-verification" class="btn-secondary btn-sm" ${verified ? 'disabled' : ''}>
                        <i data-lucide="mail" class="w-4 h-4"></i> Kirim Verifikasi
                    </button>
                    <button type="button" id="security-refresh-verification" class="btn-ghost btn-sm">
                        <i data-lucide="refresh-cw" class="w-4 h-4"></i> Refresh Status
                    </button>
                </div>
            </div>

            <div class="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <div>
                    <h4 class="text-sm font-semibold text-slate-900 dark:text-white">${hasPassword ? 'Ubah Password' : 'Tambah Password Login'}</h4>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        ${hasPassword
                            ? 'Masukkan password lama untuk mengganti password.'
                            : 'Password akan ditautkan ke akun Firebase Anda. Akun Google akan diminta konfirmasi ulang sebelum ditautkan.'}
                        Minimal 8 karakter, huruf besar, huruf kecil, angka, dan karakter unik.
                    </p>
                </div>

                <div class="grid gap-3 md:grid-cols-2">
                    ${oldPasswordField}

                    <label class="text-sm font-medium text-slate-700 dark:text-slate-300 ${hasPassword ? '' : 'md:col-span-2'}">
                        <span class="mb-1 block">Password Baru</span>
                        <div class="relative">
                            <input id="security-password" type="password" class="input w-full pr-10" placeholder="Password baru">
                            <button type="button" class="toggle-password absolute inset-y-0 right-0 flex items-center px-3 text-slate-500" data-target="security-password">
                                <i data-lucide="eye" class="w-4 h-4"></i>
                            </button>
                        </div>
                        <div class="mt-2">
                            <div class="flex gap-1">
                                <span id="security-password-strength-1" class="h-1.5 flex-1 rounded-full bg-slate-300"></span>
                                <span id="security-password-strength-2" class="h-1.5 flex-1 rounded-full bg-slate-300"></span>
                                <span id="security-password-strength-3" class="h-1.5 flex-1 rounded-full bg-slate-300"></span>
                            </div>
                            <p id="security-password-strength-text" class="mt-1 text-xs text-slate-500 dark:text-slate-400">Kekuatan password</p>
                        </div>
                    </label>

                    <label class="text-sm font-medium text-slate-700 dark:text-slate-300 ${hasPassword ? '' : 'md:col-span-2'}">
                        <span class="mb-1 block">Konfirmasi Password Baru</span>
                        <div class="relative">
                            <input id="security-confirm-password" type="password" class="input w-full pr-10" placeholder="Ulangi password baru">
                            <button type="button" class="toggle-password absolute inset-y-0 right-0 flex items-center px-3 text-slate-500" data-target="security-confirm-password">
                                <i data-lucide="eye" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </label>
                </div>

                <div class="flex flex-wrap gap-2">
                    <button type="button" id="security-save-password" class="btn-primary btn-sm">
                        <i data-lucide="key-round" class="w-4 h-4"></i> ${hasPassword ? 'Simpan Password' : 'Tautkan Password'}
                    </button>
                    <button type="button" id="security-send-reset" class="btn-secondary btn-sm">
                        <i data-lucide="mail-check" class="w-4 h-4"></i> Kirim Reset Password
                    </button>
                </div>
            </div>

            <div class="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3 dark:border-red-900/50 dark:bg-red-950/20">
                <div>
                    <h4 class="text-sm font-semibold text-red-700 dark:text-red-300">Zona Bahaya</h4>
                    <p class="text-xs text-red-600/80 dark:text-red-300/80 mt-1">
                        Menghapus akun akan menghapus Firebase Auth, data profil Firestore, dan foto profil Storage milik aplikasi. Tindakan ini tidak dapat dibatalkan.
                    </p>
                </div>

                ${hasPassword ? `
                    <label class="text-sm font-medium text-red-800 dark:text-red-200">
                        <span class="mb-1 block">Konfirmasi Password</span>
                        <input id="security-delete-password" type="password" class="input w-full" placeholder="Password saat ini">
                    </label>
                ` : ''}

                <div class="flex flex-wrap gap-2">
                    ${hasGoogle ? `
                        <button type="button" id="security-delete-google" class="btn-danger btn-sm">
                            <i data-lucide="trash-2" class="w-4 h-4"></i> Hapus Akun (Google)
                        </button>
                    ` : ''}
                    ${hasPassword ? `
                        <button type="button" id="security-delete-password-btn" class="btn-danger btn-sm">
                            <i data-lucide="trash-2" class="w-4 h-4"></i> Hapus Akun
                        </button>
                    ` : ''}
                    ${!hasGoogle && !hasPassword ? `
                        <button type="button" id="security-delete-password-btn" class="btn-danger btn-sm" disabled>
                            Hapus Akun tidak tersedia
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

async function getAuthStatus(forceRefresh = false) {
    if (forceRefresh) {
        await authService.refreshAuthUser();
    }
    return authService.getEmailVerificationStatus();
}

async function renderActiveProfileTab({ forceRefresh = false, showLoading = false } = {}) {
    const modal = ensureProfileModal();
    const bodyRoot = modal.querySelector('#profile-modal-body');
    const container = bodyRoot?.querySelector(':scope > div');
    if (!container) return;

    setActiveTabStyles();

    const needsFetch = forceRefresh || !profileModalCache;
    if (needsFetch && showLoading) {
        setProfileModalStatus('Memuat...');
        container.innerHTML = `
            <div class="text-center py-16 text-slate-400">
                <span class="animate-spin inline-block text-2xl mb-2">↻</span>
                <p class="text-sm">Memuat data profil...</p>
            </div>
        `;
    }

    try {
        const { profile, authStatus } = await loadProfileModalData(forceRefresh);

        container.innerHTML = activeProfileTab === 'security'
            ? renderSecurityTab(profile, authStatus)
            : renderInfoTab(profile, authStatus);

        bindActiveTabHandlers(profile, authStatus);
        if (window.lucide) window.lucide.createIcons({ root: container });
        setProfileModalStatus(activeProfileTab === 'security' ? 'Tab keamanan' : 'Tab info akun');
    } catch (error) {
        console.error('Failed to render profile tab:', error);
        container.innerHTML = `
            <div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                Gagal memuat data profil.
            </div>
        `;
        setProfileModalStatus('Gagal memuat');
    }
}

function bindPasswordToggles(root) {
    root.querySelectorAll('.toggle-password').forEach((button) => {
        button.addEventListener('click', () => {
            const targetId = button.getAttribute('data-target');
            const targetInput = document.getElementById(targetId);
            if (!targetInput) return;

            const isPassword = targetInput.type === 'password';
            targetInput.type = isPassword ? 'text' : 'password';
            const icon = button.querySelector('i');
            if (icon) {
                icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
                if (window.lucide) window.lucide.createIcons({ root: button });
            }
        });
    });
}

function bindPasswordStrength() {
    const passwordInput = document.getElementById('security-password');
    const strengthText = document.getElementById('security-password-strength-text');
    const strengthBars = [
        document.getElementById('security-password-strength-1'),
        document.getElementById('security-password-strength-2'),
        document.getElementById('security-password-strength-3'),
    ];

    const update = () => {
        if (!passwordInput || !strengthText) return;
        const strength = getPasswordStrength(passwordInput.value);
        strengthBars.forEach((bar, index) => {
            if (!bar) return;
            const active = strength.score > index;
            bar.className = `h-1.5 flex-1 rounded-full ${active ? strength.color : 'bg-slate-300 dark:bg-slate-700'}`;
        });
        strengthText.className = `mt-1 text-xs ${strength.text}`;
        strengthText.textContent = strength.label === 'Kosong'
            ? 'Kekuatan password'
            : `Kekuatan password: ${strength.label}`;
    };

    if (passwordInput) {
        passwordInput.addEventListener('input', update);
        update();
    }
}

function bindActiveTabHandlers(profile, authStatus) {
    const bodyRoot = document.querySelector('#profile-modal-body');
    if (!bodyRoot) return;

    bindPasswordToggles(bodyRoot);

    if (activeProfileTab === 'info') {
        const photoLinkInput = document.getElementById('profile-photo-link');
        const previewImg = document.getElementById('profile-preview-img');
        const saveBtn = document.getElementById('profile-save-btn');

        if (photoLinkInput && previewImg) {
            photoLinkInput.addEventListener('input', () => {
                const value = photoLinkInput.value.trim();
                if (value) previewImg.src = value;
            });
        }

        saveBtn?.addEventListener('click', saveInfoProfile);
        return;
    }

    bindPasswordStrength();

    document.getElementById('security-send-verification')?.addEventListener('click', async () => {
        if (isSecurityBusy) return;
        isSecurityBusy = true;
        setProfileModalStatus('Mengirim verifikasi...');
        try {
            const result = await authService.sendCurrentEmailVerification();
            showToast(result.alreadyVerified ? 'Email sudah terverifikasi.' : 'Email verifikasi dikirim.', 'success');
            clearProfileModalCache();
            await renderActiveProfileTab({ forceRefresh: true, showLoading: false });
        } catch (error) {
            showToast(error.message || 'Gagal mengirim verifikasi.', 'error');
            setProfileModalStatus('Gagal kirim verifikasi');
        } finally {
            isSecurityBusy = false;
        }
    });

    document.getElementById('security-refresh-verification')?.addEventListener('click', async () => {
        if (isSecurityBusy) return;
        isSecurityBusy = true;
        try {
            clearProfileModalCache();
            await renderActiveProfileTab({ forceRefresh: true, showLoading: false });
            showToast('Status keamanan diperbarui.', 'success');
        } catch (error) {
            showToast(error.message || 'Gagal refresh status.', 'error');
        } finally {
            isSecurityBusy = false;
        }
    });

    document.getElementById('security-save-password')?.addEventListener('click', saveSecurityPassword);

    document.getElementById('security-send-reset')?.addEventListener('click', async () => {
        if (isSecurityBusy) return;
        const email = authStatus.email || profile.email;
        if (!email) {
            showToast('Email akun tidak tersedia.', 'error');
            return;
        }

        isSecurityBusy = true;
        setProfileModalStatus('Mengirim reset password...');
        try {
            const result = await authService.sendPasswordReset(email);
            showToast(result.message, 'success');
            setProfileModalStatus('Reset password dikirim');
        } catch (error) {
            showToast(error.message || 'Gagal mengirim reset password.', 'error');
            setProfileModalStatus('Gagal kirim reset');
        } finally {
            isSecurityBusy = false;
        }
    });

    const deleteWithGoogle = document.getElementById('security-delete-google');
    const deleteWithPassword = document.getElementById('security-delete-password-btn');

    deleteWithGoogle?.addEventListener('click', () => confirmDeleteAccount({ preferGoogle: true }));
    deleteWithPassword?.addEventListener('click', () => {
        const password = document.getElementById('security-delete-password')?.value || '';
        confirmDeleteAccount({ password, preferGoogle: false });
    });
}

async function saveInfoProfile() {
    if (isSavingProfile) return;
    isSavingProfile = true;
    setProfileModalStatus('Menyimpan profil...');

    try {
        const currentUser = authService.getCurrentUser();
        if (!currentUser) {
            showToast('Sesi tidak aktif.', 'error');
            return;
        }

        const name = document.getElementById('profile-name')?.value.trim();
        const nip = document.getElementById('profile-nip')?.value.trim() || '-';
        const photoUrl = document.getElementById('profile-photo-link')?.value.trim() || '';

        if (!name) {
            showToast('Nama wajib diisi.', 'error');
            return;
        }

        const payload = { nama: name, nip };
        if (photoUrl) {
            try {
                const url = new URL(photoUrl);
                if (url.protocol !== 'https:') {
                    showToast('URL foto harus memakai HTTPS.', 'error');
                    return;
                }
                payload.photo = url.toString();
            } catch {
                showToast('URL foto tidak valid.', 'error');
                return;
            }
        }

        const result = await authService.updateProfileData(currentUser.uid, payload);
        if (!result?.success) {
            showToast('Gagal menyimpan data profil.', 'error');
            return;
        }

        profileService.clearCache();
        clearProfileModalCache();
        await refreshNavbarProfile();
        showToast('Profil berhasil diperbarui.', 'success');
        setProfileModalStatus('Profil tersimpan');
        await renderActiveProfileTab({ forceRefresh: true, showLoading: false });
    } catch (error) {
        console.error('Save profile error:', error);
        showToast(error.message || 'Gagal menyimpan profil.', 'error');
        setProfileModalStatus('Gagal menyimpan');
    } finally {
        isSavingProfile = false;
    }
}

async function saveSecurityPassword() {
    if (isSecurityBusy) return;
    isSecurityBusy = true;
    setProfileModalStatus('Menyimpan password...');

    try {
        const oldPassword = document.getElementById('security-old-password')?.value || '';
        const password = document.getElementById('security-password')?.value || '';
        const confirmPassword = document.getElementById('security-confirm-password')?.value || '';
        const oldPasswordError = document.getElementById('security-old-password-error');
        const hasPassword = authService.hasPasswordProvider();

        if (oldPasswordError) {
            oldPasswordError.textContent = '';
            oldPasswordError.classList.add('hidden');
        }

        if (!password) {
            showToast('Password baru wajib diisi.', 'error');
            return;
        }
        if (password !== confirmPassword) {
            showToast('Konfirmasi password tidak cocok.', 'error');
            return;
        }
        if (!isStrongPassword(password)) {
            showToast('Password minimal 8 karakter, wajib ada huruf besar, huruf kecil, angka, dan karakter unik.', 'error');
            return;
        }
        if (hasPassword && !oldPassword) {
            showToast('Untuk mengubah password, masukkan password lama terlebih dahulu.', 'error');
            return;
        }

        if (hasPassword) {
            await authService.changeCurrentUserPassword(oldPassword, password);
        } else {
            await authService.linkCurrentUserWithEmailPassword(password);
        }

        showToast(hasPassword ? 'Password berhasil diubah.' : 'Password berhasil ditautkan.', 'success');
        clearProfileModalCache();
        await renderActiveProfileTab({ forceRefresh: true, showLoading: false });
    } catch (error) {
        const message = error?.message || 'Gagal menyimpan password.';
        const oldPasswordError = document.getElementById('security-old-password-error');
        if (oldPasswordError) {
            oldPasswordError.textContent = message;
            oldPasswordError.classList.remove('hidden');
        }
        showToast(message, 'error');
        setProfileModalStatus('Gagal simpan password');
    } finally {
        isSecurityBusy = false;
    }
}

function confirmDeleteAccount({ password = '', preferGoogle = false } = {}) {
    showConfirm(
        'Hapus akun secara permanen?',
        async () => {
            if (isSecurityBusy) return;
            isSecurityBusy = true;
            setProfileModalStatus('Menghapus akun...');
            try {
                await authService.deleteCurrentAccount({ password, preferGoogle });
            } catch (error) {
                showToast(error.message || 'Gagal menghapus akun.', 'error');
                setProfileModalStatus('Gagal hapus akun');
                isSecurityBusy = false;
            }
        },
        'Akun Auth, profil Firestore, dan foto Storage akan dihapus. Tindakan ini tidak dapat dibatalkan.'
    );
}

export async function initNavbarProfile() {
    try {
        const user = await authService.waitForAuth();

        if (!user) return renderFallbackProfile();

        const profile = await profileService.getCurrentUserProfile();

        renderProfileButton(profile);
        renderMobileProfile(profile);
        setupProfileDropdown();
        ensureProfileModal();
    } catch (error) {
        console.error('Failed to load profile:', error);
        renderFallbackProfile();
    }
}

function renderProfileButton(profile) {
    const profileContainer = document.getElementById('navbar-profile');
    if (!profileContainer) return;

    const avatarUrl = escapeHtml(profileService.getAvatarUrl(profile));
    const displayName = escapeHtml(profileService.getDisplayName(profile));
    const email = escapeHtml(profile.email || '');
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

                <button type="button" onclick="window.openProfileEditor()" class="w-full text-left px-4 py-3 border-b border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors">
                    <div class="flex items-center gap-3">
                        <img src="${avatarUrl}" alt="${displayName}"
                             class="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700">
                        <div class="flex-1 min-w-0">
                            <p class="font-medium text-sm text-slate-900 dark:text-white truncate">${displayName}</p>
                            <p class="text-xs text-slate-500 dark:text-slate-400 truncate">${email}</p>
                            <span class="${badge} mt-1">
                                <i data-lucide="${icon}" class="w-3 h-3"></i> ${label}
                            </span>
                        </div>
                    </div>
                </button>

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

function renderMobileProfile(profile) {
    const mobileContainer = document.getElementById('navbar-profile-mobile');
    if (!mobileContainer) return;

    const avatarUrl = escapeHtml(profileService.getAvatarUrl(profile));
    const displayName = escapeHtml(profileService.getDisplayName(profile));
    const email = escapeHtml(profile.email || '');
    const { label, badge, icon } = getRoleMetadata(profile.role);

    mobileContainer.innerHTML = `
        <button type="button" onclick="window.openProfileEditor()" class="w-full flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700 text-left hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <img src="${avatarUrl}" alt="${displayName}"
                 class="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700">
            <div class="flex-1 min-w-0">
                <p class="font-medium text-slate-900 dark:text-white truncate text-sm">${displayName}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 truncate">${email}</p>
                <span class="${badge} mt-1">
                    <i data-lucide="${icon}" class="w-3 h-3"></i> ${label}
                </span>
            </div>
        </button>
    `;

    if (window.lucide) window.lucide.createIcons({ root: mobileContainer });
}

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

window.refreshProfile = async () => {
    const btn = document.querySelector('#profile-dropdown [data-lucide="refresh-cw"]');
    if (btn) btn.classList.add('animate-spin');

    try {
        await refreshNavbarProfile();
        showToast('Profile data diperbarui', 'success');
    } catch (error) {
        console.error('Refresh failed:', error);
        showToast('Gagal memperbarui profil.', 'error');
    }
};

window.openProfileEditor = async () => {
    try {
        activeProfileTab = 'info';
        clearProfileModalCache();
        const modal = ensureProfileModal();
        modal.classList.remove('hidden');
        document.body.classList.add('overflow-hidden');
        if (window.lucide) {
            window.lucide.createIcons({ root: modal.querySelector('header') });
            window.lucide.createIcons({ root: modal.querySelector('section') });
        }
        await renderActiveProfileTab({ forceRefresh: true, showLoading: true });
    } catch (error) {
        console.error('Failed to open profile editor:', error);
        showToast('Tidak dapat memuat profil.', 'error');
    }
};

window.closeProfileModal = closeProfileModal;

window.handleLogout = async () => {
    const action = async () => {
        profileService.clearCache();
        await authService.logout();
    };

    showConfirm('Apakah Anda yakin ingin keluar dari aplikasi?', action, 'Anda akan keluar dari sesi saat ini.');
};
