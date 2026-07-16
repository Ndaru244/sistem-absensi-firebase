// assets/js/utils/ui.js
let modalCallback = null;
let promptCallback = null;
let htmlCallback = null;

// --- THEME ---
export const initTheme = () => {
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    }
};

export function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.classList.toggle('dark');
    localStorage.theme = isDark ? 'dark' : 'light';
    if (window.lucide) window.lucide.createIcons();
}

// --- MODALS ---
const _ensureModals = () => {
    if (!document.getElementById('custom-modal')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="custom-modal" class="modal-overlay hidden opacity-0 transition-opacity">
                <div class="modal-panel max-w-sm transform scale-95 transition-transform">
                    <div class="modal-header">
                        <h3 class="text-base font-semibold text-slate-900 dark:text-white">Konfirmasi</h3>
                    </div>
                    <div class="modal-body">
                        <p id="modal-msg" class="text-sm text-slate-600 dark:text-slate-400"></p>
                    </div>
                    <div class="modal-footer">
                        <button onclick="document.getElementById('custom-modal').classList.add('hidden')" class="btn-secondary btn-sm">Batal</button>
                        <button id="btn-modal-yes" class="btn-primary btn-sm">Ya, Lanjutkan</button>
                    </div>
                </div>
            </div>

            <div id="custom-prompt" class="modal-overlay hidden opacity-0 transition-opacity">
                <div class="modal-panel max-w-sm transform scale-95 transition-transform">
                    <div class="modal-header">
                        <h3 class="text-base font-semibold text-slate-900 dark:text-white">Input Data</h3>
                    </div>
                    <div class="modal-body space-y-3">
                        <p id="prompt-msg" class="text-sm text-slate-600 dark:text-slate-400"></p>
                        <input type="text" id="prompt-input" class="input">
                    </div>
                    <div class="modal-footer">
                        <button onclick="document.getElementById('custom-prompt').classList.add('hidden')" class="btn-secondary btn-sm">Batal</button>
                        <button id="btn-prompt-save" class="btn-primary btn-sm">Simpan</button>
                    </div>
                </div>
            </div>

            <div id="custom-html" class="modal-overlay hidden opacity-0 transition-opacity">
                <div class="modal-panel max-w-md transform scale-95 transition-transform">
                    <div class="modal-header">
                        <h3 id="html-title" class="text-base font-semibold text-slate-900 dark:text-white">Form</h3>
                    </div>
                    <div id="html-body" class="modal-body"></div>
                    <div class="modal-footer">
                        <button onclick="document.getElementById('custom-html').classList.add('hidden')" class="btn-secondary btn-sm">Batal</button>
                        <button id="btn-html-save" class="btn-primary btn-sm">Simpan</button>
                    </div>
                </div>
            </div>
        `);

        document.getElementById('btn-modal-yes').onclick = () => {
            if (modalCallback) modalCallback();
            document.getElementById('custom-modal').classList.add('hidden');
        };

        document.getElementById('btn-prompt-save').onclick = () => {
            const val = document.getElementById('prompt-input').value.trim() || '-';
            if (promptCallback) promptCallback(val);
            document.getElementById('custom-prompt').classList.add('hidden');
        };

        document.getElementById('btn-html-save').onclick = () => {
            if (htmlCallback) htmlCallback();
            document.getElementById('custom-html').classList.add('hidden');
        };
    }
};

const _open = (id, content, cb, title = '', sizeClass = null) => {
    _ensureModals();
    const el = document.getElementById(id);

    if (id === 'custom-html') {
        document.getElementById('html-title').innerText = title || 'Form Edit';
        document.getElementById('html-body').innerHTML = content;
        htmlCallback = cb;
        
        // Apply custom size if provided
        const panel = el.querySelector('.modal-panel');
        if (sizeClass) {
            panel.classList.remove('max-w-md');
            panel.classList.add(sizeClass);
        } else {
            panel.classList.remove('max-w-md', 'max-w-sm', 'max-w-lg', 'max-w-xl', 'max-w-2xl', 'max-w-3xl', 'max-w-4xl', 'max-w-5xl', 'max-w-6xl', 'max-w-full');
            panel.classList.add('max-w-md');
        }
    } else {
        const msgId = id === 'custom-modal' ? 'modal-msg' : 'prompt-msg';
        document.getElementById(msgId).innerText = content;

        if (id === 'custom-prompt') {
            const inp = document.getElementById('prompt-input');
            inp.value = '';
            setTimeout(() => inp.focus(), 50);
            promptCallback = cb;
        } else {
            modalCallback = cb;
        }
    }

    el.classList.remove('hidden');
    setTimeout(() => {
        el.classList.remove('opacity-0');
        el.querySelector('.modal-panel').classList.replace('scale-95', 'scale-100');
    }, 10);
};

export const showPrompt = (msg, cb) => _open('custom-prompt', msg, cb);

export function showConfirm(title, onConfirm, description = "") {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay animate-fade-in opacity-0 transition-opacity';

    modal.innerHTML = `
        <div class="modal-panel max-w-sm transform scale-95 transition-transform">
            <div class="modal-body text-center py-6">
                <div class="w-12 h-12 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 rounded-lg flex items-center justify-center mx-auto mb-4">
                    <i data-lucide="alert-triangle" class="w-6 h-6"></i>
                </div>
                <h3 class="text-base font-semibold text-slate-900 dark:text-white mb-2">${title || "Konfirmasi"}</h3>
                <p class="text-sm text-slate-500 dark:text-slate-400 mb-6">${description || "Apakah Anda yakin ingin melanjutkan tindakan ini?"}</p>
                <div class="flex gap-2">
                    <button id="btnCancelConfirm" class="btn-secondary flex-1">Batal</button>
                    <button id="btnYesConfirm" class="btn-danger flex-1">Ya, Lanjutkan</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('.modal-panel').classList.remove('scale-95');
        modal.querySelector('.modal-panel').classList.add('scale-100');
    });

    if (window.lucide) lucide.createIcons({ root: modal });

    const btnCancel = modal.querySelector('#btnCancelConfirm');
    const btnYes = modal.querySelector('#btnYesConfirm');

    btnCancel.focus();

    const closeModal = () => {
        modal.classList.add('opacity-0');
        setTimeout(() => modal.remove(), 200);
    };

    btnCancel.onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    btnYes.onclick = async () => {
        btnYes.innerHTML = `<span class="animate-spin inline-block">↻</span> Proses...`;
        btnYes.disabled = true;
        btnCancel.disabled = true;
        try {
            await onConfirm();
        } catch (e) {
            console.error(e);
        } finally {
            closeModal();
        }
    };
}

export const showCustomModal = (title, htmlContent, onSave, sizeClass = null) => _open('custom-html', htmlContent, onSave, title, sizeClass);

export const showToast = (msg, type = 'info') => {
    const div = document.createElement('div');
    div.className = `fixed top-4 right-4 z-[100] px-4 py-3 rounded-md text-sm font-medium text-white transform transition-all duration-200 translate-y-[-8px] opacity-0 ${type === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`;
    div.innerText = msg;
    document.body.appendChild(div);
    requestAnimationFrame(() => { div.classList.remove('translate-y-[-8px]', 'opacity-0'); });
    setTimeout(() => { div.classList.add('opacity-0'); setTimeout(() => div.remove(), 200); }, 3000);
};

import { SCHOOL_NAME } from './constants.js?v=dd5a477';
export function renderNavbar(activePage = 'index') {
    const nav = document.createElement('nav');
    nav.className = 'app-nav';

    const isIndex = activePage === 'index';
    const isAdmin = activePage === 'admin';
    const isUsers = activePage === 'users';

    const linkClass = (active) => active ? 'nav-link nav-link-active' : 'nav-link';

    nav.innerHTML = `
        <div class="max-w-6xl mx-auto px-4 sm:px-6">
            <div class="flex h-14 items-center justify-between">
                <a href="index.html" class="flex items-center gap-2.5">
                    <div class="w-8 h-8 bg-primary-600 rounded-md flex items-center justify-center">
                        <i data-lucide="clipboard-check" class="w-4 h-4 text-white"></i>
                    </div>
                    <div>
                        <span class="text-sm font-semibold text-slate-900 dark:text-white leading-none">E-Absensi</span>
                        <span class="block text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">${SCHOOL_NAME}</span>
                    </div>
                </a>

                <div class="hidden md:flex items-center gap-1">
                    <a href="index.html" class="${linkClass(isIndex)}">
                        <i data-lucide="layout-dashboard" class="w-4 h-4"></i> Beranda
                    </a>

                    ${isIndex ? `
                    <button onclick="window.openMonthlyModal()" class="nav-link">
                        <i data-lucide="bar-chart-3" class="w-4 h-4"></i> Laporan Bulanan
                    </button>
                    ` : ''}

                    <a href="admin.html" class="admin-only hidden ${linkClass(isAdmin)}">
                        <i data-lucide="database" class="w-4 h-4"></i> Master Data
                    </a>

                    <a href="users.html" class="super-admin-only hidden ${linkClass(isUsers)}">
                        <i data-lucide="users" class="w-4 h-4"></i> Pengguna
                    </a>

                    <div class="h-5 w-px bg-slate-200 dark:bg-slate-700 mx-2"></div>
                    <div id="navbar-profile"></div>
                </div>

                <button id="mobile-menu-btn" class="md:hidden btn-ghost btn-icon">
                    <i data-lucide="menu" class="w-5 h-5"></i>
                </button>
            </div>
        </div>

        <div id="mobile-menu" class="hidden md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div class="px-4 py-4 space-y-1">
                <div id="navbar-profile-mobile" class="mb-3"></div>

                <a href="index.html" class="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium ${isIndex ? 'text-primary-600 bg-primary-50 dark:text-primary-400 dark:bg-primary-950/50' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}">
                    <i data-lucide="layout-dashboard" class="w-4 h-4"></i> Beranda
                </a>

                ${isIndex ? `
                <button onclick="window.openMonthlyModal()" class="flex w-full items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
                    <i data-lucide="bar-chart-3" class="w-4 h-4"></i> Laporan Bulanan
                </button>
                ` : ''}

                <a href="admin.html" class="admin-only hidden flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium ${isAdmin ? 'text-primary-600 bg-primary-50 dark:text-primary-400 dark:bg-primary-950/50' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}">
                    <i data-lucide="database" class="w-4 h-4"></i> Master Data
                </a>

                <a href="users.html" class="super-admin-only hidden flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium ${isUsers ? 'text-primary-600 bg-primary-50 dark:text-primary-400 dark:bg-primary-950/50' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}">
                    <i data-lucide="users" class="w-4 h-4"></i> Pengguna
                </a>

                <div class="pt-3 mt-3 border-t border-slate-200 dark:border-slate-800 space-y-1">
                    <button onclick="window.toggleTheme()" class="flex w-full items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <i data-lucide="sun-moon" class="w-4 h-4"></i> Ganti Tema
                    </button>
                    <button onclick="window.handleLogout()" class="flex w-full items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                        <i data-lucide="log-out" class="w-4 h-4"></i> Keluar
                    </button>
                </div>
            </div>
        </div>
    `;
    return nav;
}

export function initNavbar(activePage = 'index') {
    const existingNav = document.querySelector('nav.app-nav');
    if (existingNav) existingNav.remove();

    const nav = renderNavbar(activePage);
    const container = document.getElementById('navbar-container');
    if (container) {
        container.replaceChildren(nav);
    } else {
        document.body.prepend(nav);
    }

    const mobileBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileBtn && mobileMenu) {
        mobileBtn.onclick = () => mobileMenu.classList.toggle('hidden');
    }

    if (window.lucide) window.lucide.createIcons();
}

export function updateNavbarActive(activePage = 'index') {
    document.querySelectorAll('[data-nav]').forEach((link) => {
        const page = link.dataset.nav;
        const active = page === activePage;
        if (link.classList.contains('nav-link') || link.classList.contains('nav-link-active')) {
            link.classList.toggle('nav-link-active', active);
            link.classList.toggle('nav-link', !active);
            return;
        }
        const activeCls = ['text-primary-600', 'bg-primary-50', 'dark:text-primary-400', 'dark:bg-primary-950/50'];
        const idleCls = ['text-slate-700', 'dark:text-slate-200', 'hover:bg-slate-100', 'dark:hover:bg-slate-800'];
        if (active) {
            link.classList.add(...activeCls);
            idleCls.forEach((c) => link.classList.remove(c));
        } else {
            link.classList.remove(...activeCls);
            idleCls.forEach((c) => link.classList.add(c));
        }
    });
}
