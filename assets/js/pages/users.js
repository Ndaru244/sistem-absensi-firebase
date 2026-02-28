import { userService } from '../firebase/user-service.js';
import { showToast, showConfirm, showCustomModal, initTheme } from '../utils/ui.js';
import { initNavbarProfile } from '../components/navbar.js';
import { initAuthGuard } from '../utils/auth-guard.js';

let allUsers = [];

// --- INITIALIZATION ---
async function initPage() {
    initTheme();
    await initAuthGuard({ requireSuperAdmin: true });
    initNavbarProfile();
    setupEventListeners();
    await loadUsers();
}

// --- LOAD DATA ---
async function loadUsers(forceRefresh = false) {
    const tbody = document.getElementById('userTableBody');
    updateRefreshButton('loading');

    // UI Loading
    if (!forceRefresh && allUsers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="p-12 text-center text-gray-500 animate-pulse">
                    <div class="flex flex-col items-center gap-3">
                        <i data-lucide="loader-2" class="w-8 h-8 animate-spin text-indigo-500"></i>
                        <span>Sedang memuat database...</span>
                    </div>
                </td>
            </tr>`;
        if (window.lucide) window.lucide.createIcons();
    }

    try {
        allUsers = await userService.getAllUsers(forceRefresh);
        renderTable(allUsers);
        updateRefreshButton('success');
    } catch (error) {
        console.error("Load Error:", error);
        showToast("Gagal memuat data", "error");
        updateRefreshButton('idle');

        if (allUsers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-red-500">Gagal terhubung ke server.</td></tr>`;
        }
    }
}

// --- UI HELPERS ---
function updateRefreshButton(state) {
    const btn = document.getElementById("btnRefreshUsers");
    const icon = btn?.querySelector("i");
    const text = document.getElementById("refreshText");
    if (!btn) return;

    btn.className = "inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg shadow transition-all active:scale-95 text-white transition-colors duration-300";

    if (state === 'loading') {
        btn.classList.add("bg-indigo-400", "cursor-not-allowed");
        btn.disabled = true;
        if (icon) { icon.setAttribute("data-lucide", "loader-2"); icon.classList.add("animate-spin"); }
        if (text) text.textContent = "Memuat...";
    } else if (state === 'success') {
        btn.classList.add("bg-emerald-600");
        btn.disabled = false;
        if (icon) { icon.setAttribute("data-lucide", "check"); icon.classList.remove("animate-spin"); }
        if (text) text.textContent = "Sukses!";
        setTimeout(() => updateRefreshButton('idle'), 2000);
    } else {
        btn.classList.add("bg-indigo-600", "hover:bg-indigo-700");
        btn.disabled = false;
        if (icon) { icon.setAttribute("data-lucide", "refresh-cw"); icon.classList.remove("animate-spin"); }
        if (text) text.textContent = "Refresh Data";
    }
    if (window.lucide) window.lucide.createIcons();
}

function renderTable(users) {
    const tbody = document.getElementById('userTableBody');
    const countEl = document.getElementById('totalUsersCount');
    if (countEl) countEl.innerText = users.length;

    if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-400 italic">Belum ada user terdaftar.</td></tr>`;
        return;
    }

    const roleOrder = { 'super_admin': 3, 'admin': 2, 'viewer': 1 };
    const sortedUsers = [...users].sort((a, b) => {
        const scoreA = roleOrder[a.role] || 1;
        const scoreB = roleOrder[b.role] || 1;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return (a.nama || '').localeCompare(b.nama || '');
    });

    tbody.innerHTML = sortedUsers.map(user => {
        let badgeClass = 'bg-gray-100 text-gray-600 border-gray-200'; // Default: Viewer
        let roleLabel = 'VIEWER';

        if (user.role === 'super_admin') {
            badgeClass = 'bg-rose-100 text-rose-700 border-rose-200';
            roleLabel = 'SUPER ADMIN';
        } else if (user.role === 'admin') {
            badgeClass = 'bg-indigo-100 text-indigo-700 border-indigo-200';
            roleLabel = 'GURU PIKET';
        } else if (user.role === 'guru') {
            // WARNA BARU UNTUK GURU
            badgeClass = 'bg-blue-50 text-blue-700 border-blue-200';
            roleLabel = 'GURU KELAS';
        }

        const photoUrl = user.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.nama)}&background=random`;

        return `
        <tr class="flex flex-col md:table-row bg-white dark:bg-darkcard mb-4 md:mb-0 rounded-xl md:rounded-none shadow-sm md:shadow-none border border-gray-200 md:border-b dark:border-gray-700 transition hover:bg-gray-50 dark:hover:bg-gray-800/50">
            
            <td class="block md:table-cell px-4 py-3 md:px-6 md:py-4 border-b md:border-none border-gray-100 dark:border-gray-700">
                <div class="flex items-center cursor-pointer" onclick="window.handleEditUser('${user.id}')">
                    <img class="h-10 w-10 md:h-10 md:w-10 rounded-full object-cover border border-gray-200" src="${photoUrl}" alt="">
                    <div class="ml-3 md:ml-4">
                        <div class="text-sm font-bold text-gray-900 dark:text-white">${user.nama || 'Tanpa Nama'}</div>
                        <div class="text-xs text-gray-500 font-mono break-all">${user.email}</div>
                    </div>
                </div>
            </td>

            <td class="block md:table-cell px-4 py-2 md:px-6 md:py-4">
                <span class="md:hidden text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 block">Role Akses</span>
                <span class="px-2.5 py-1 inline-flex text-xs leading-5 font-bold rounded-full border ${badgeClass}">
                    ${roleLabel}
                </span>
            </td>

            <td class="block md:table-cell px-4 py-2 md:px-6 md:py-4">
                <div class="flex items-center justify-between md:justify-center w-full">
                    <span class="md:hidden text-xs font-semibold text-gray-400 uppercase tracking-wider">Status Verifikasi</span>
                    
                    ${user.isVerified
                ? `<button onclick="window.handleVerify('${user.id}', true)" class="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-3 py-1 md:p-1.5 rounded-full md:rounded-full transition active:scale-95 border border-emerald-100">
                            <i data-lucide="check-circle-2" class="w-4 h-4 md:w-5 md:h-5"></i>
                            <span class="md:hidden text-xs font-bold">Terverifikasi</span>
                        </button>`
                : `<button onclick="window.handleVerify('${user.id}', false)" class="flex items-center gap-2 text-gray-500 bg-gray-100 px-3 py-1 md:p-1.5 rounded-full md:rounded-full transition active:scale-95 border border-gray-200">
                            <i data-lucide="circle" class="w-4 h-4 md:w-5 md:h-5"></i>
                            <span class="md:hidden text-xs font-bold">Belum Aktif</span>
                        </button>`
            }
                </div>
            </td>

            <td class="block md:table-cell px-4 py-3 md:px-6 md:py-4 border-t md:border-none border-gray-100 dark:border-gray-700">
                <div class="flex items-center justify-end gap-3 md:gap-2">
                    <span class="md:hidden text-xs font-semibold text-gray-400 uppercase mr-auto">Tindakan</span>
                    
                    <button onclick="window.handleEditUser('${user.id}')" 
                        class="flex-1 md:flex-none flex items-center justify-center gap-2 text-blue-600 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-4 py-2 md:p-2 rounded-lg transition active:scale-95 border border-blue-100 shadow-sm md:shadow-none" 
                        title="Edit Data">
                        <i data-lucide="pencil" class="w-4 h-4"></i>
                        <span class="md:hidden text-xs font-bold">Edit</span>
                    </button>
                    
                    <button onclick="window.handleDeleteUser('${user.id}', '${user.nama}')" 
                        class="flex-1 md:flex-none flex items-center justify-center gap-2 text-red-600 hover:text-red-900 bg-red-50 hover:bg-red-100 px-4 py-2 md:p-2 rounded-lg transition active:scale-95 border border-red-100 shadow-sm md:shadow-none" 
                        title="Hapus User">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                        <span class="md:hidden text-xs font-bold">Hapus</span>
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
}

// --- WINDOW HANDLERS ---

// 1. EDIT MODAL
window.handleEditUser = (uid) => {
    const user = allUsers.find(u => u.id === uid);
    if (!user) return;

    const formHtml = `
        <div class="space-y-5 text-left">
            <div>
                <label class="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                    Nama Lengkap
                </label>
                <div class="relative">
                    <i data-lucide="user" class="absolute left-3 top-3.5 w-5 h-5 text-gray-400"></i>
                    <input type="text" id="edit-nama" value="${user.nama || ''}" 
                        class="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition shadow-sm"
                        placeholder="Contoh: Budi Santoso">
                </div>
            </div>

            <div>
                <label class="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                    NIP <span class="text-xs font-normal text-gray-500">(Opsional)</span>
                </label>
                <div class="relative">
                    <i data-lucide="badge-check" class="absolute left-3 top-3.5 w-5 h-5 text-gray-400"></i>
                    <input type="number" id="edit-nip" value="${user.nip === '-' ? '' : user.nip || ''}" 
                        class="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-base focus:ring-2 focus:ring-blue-500 outline-none transition shadow-sm"
                        placeholder="Nomor Induk Pegawai">
                </div>
            </div>

            <div class="bg-indigo-50/50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800">
                <label class="block text-sm font-bold text-indigo-900 dark:text-indigo-300 mb-2 flex items-center gap-2">
                    <i data-lucide="shield" class="w-4 h-4"></i> Tingkat Akses (Role)
                </label>
                
                <div class="relative">
                    <select id="edit-role" 
                        class="w-full appearance-none pl-4 pr-10 py-3 rounded-lg border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-base focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer">
                        
                        <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>
                            Viewer (Hanya Lihat / Tamu)
                        </option>
                        
                        <option value="guru" ${user.role === 'guru' || (!user.role && user.role !== 'viewer') ? 'selected' : ''}>
                            Guru Mata Pelajaran
                        </option>
                        
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>
                            Guru Piket (Admin)
                        </option>
                        
                        <option value="super_admin" ${user.role === 'super_admin' ? 'selected' : ''}>
                            Super Admin
                        </option>

                    </select>
                    <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-indigo-600 dark:text-indigo-400">
                        <i data-lucide="chevron-down" class="w-5 h-5"></i>
                    </div>
                </div>
                <p class="text-xs text-indigo-600/70 dark:text-indigo-400/70 mt-2 ml-1">
                    *Role 'Guru' diperlukan agar user bisa melakukan input absensi.
                </p>
            </div>
        </div>
    `;

    showCustomModal("Edit Data Pengguna", formHtml, async () => {
        const newNama = document.getElementById("edit-nama").value.trim();
        const newNip = document.getElementById("edit-nip").value.trim() || "-";
        const newRole = document.getElementById("edit-role").value;

        if (!newNama) return showToast("Nama wajib diisi", "error");

        try {
            await userService.updateUser(uid, {
                nama: newNama,
                nip: newNip,
                role: newRole
            });

            showToast("Data user diperbarui", "success");
            loadUsers(true);
        } catch (e) {
            console.error(e);
            showToast("Gagal update: " + e.message, "error");
        }
    });
};

// 2. VERIFY
window.handleVerify = async (uid, status) => {
    try {
        await userService.toggleVerified(uid, status);
        const u = allUsers.find(x => x.id === uid);
        if (u) u.isVerified = !status;
        renderTable(allUsers);
        showToast(status ? "Verifikasi dicabut" : "User diverifikasi", "success");
    } catch (e) { showToast(e.message, "error"); }
};

// 3. DELETE
window.handleDeleteUser = (uid, nama) => {
    showConfirm(`Hapus user <b>${nama}</b> selamanya?`, async () => {
        try {
            await userService.deleteUserDoc(uid);
            allUsers = allUsers.filter(u => u.id !== uid);
            renderTable(allUsers);
            showToast("User dihapus", "success");
        } catch (e) { showToast(e.message, "error"); }
    });
};

function setupEventListeners() {
    const searchInput = document.getElementById('searchUser');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = allUsers.filter(u =>
                (u.nama || '').toLowerCase().includes(term) ||
                (u.email || '').toLowerCase().includes(term)
            );
            renderTable(filtered);
        });
    }

    const refreshBtn = document.getElementById('btnRefreshUsers');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => loadUsers(true));
    }
}

initPage();