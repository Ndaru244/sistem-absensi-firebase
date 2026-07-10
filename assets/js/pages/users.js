import { userService } from '../firebase/user-service.js';
import { showToast, showConfirm, showCustomModal, initTheme } from '../utils/ui.js';

let allUsers = [];

// --- INITIALIZATION ---
async function initPage() {
    initTheme();
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

    btn.className = "btn btn-sm";

    if (state === 'loading') {
        btn.classList.add("btn-primary", "opacity-60", "cursor-not-allowed");
        btn.disabled = true;
        if (icon) { icon.setAttribute("data-lucide", "loader-2"); icon.classList.add("animate-spin"); }
        if (text) text.textContent = "Memuat...";
    } else if (state === 'success') {
        btn.classList.add("btn-success");
        btn.disabled = false;
        if (icon) { icon.setAttribute("data-lucide", "check"); icon.classList.remove("animate-spin"); }
        if (text) text.textContent = "Sukses!";
        setTimeout(() => updateRefreshButton('idle'), 2000);
    } else {
        btn.classList.add("btn-primary");
        btn.disabled = false;
        if (icon) { icon.setAttribute("data-lucide", "refresh-cw"); icon.classList.remove("animate-spin"); }
        if (text) text.textContent = "Refresh";
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
        let badgeClass = 'badge-neutral';
        let roleLabel = 'Viewer';

        if (user.role === 'super_admin') {
            badgeClass = 'badge-danger';
            roleLabel = 'Super Admin';
        } else if (user.role === 'admin') {
            badgeClass = 'badge-primary';
            roleLabel = 'Guru Piket';
        } else if (user.role === 'guru') {
            badgeClass = 'badge-info';
            roleLabel = 'Guru Kelas';
        }

        const photoUrl = user.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.nama)}&background=random`;

        return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
            <td>
                <div class="flex items-center cursor-pointer gap-3" onclick="window.handleEditUser('${user.id}')">
                    <img class="h-9 w-9 rounded-full object-cover border border-slate-200 dark:border-slate-700" src="${photoUrl}" alt="">
                    <div>
                        <div class="text-sm font-medium text-slate-900 dark:text-white">${user.nama || 'Tanpa Nama'}</div>
                        <div class="text-xs text-slate-500 break-all">${user.email}</div>
                    </div>
                </div>
            </td>
            <td><span class="${badgeClass}">${roleLabel}</span></td>
            <td class="text-center">
                ${user.isVerified
                ? `<button onclick="window.handleVerify('${user.id}', true)" class="badge-success"><i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> Terverifikasi</button>`
                : `<button onclick="window.handleVerify('${user.id}', false)" class="badge-neutral"><i data-lucide="circle" class="w-3.5 h-3.5"></i> Belum Aktif</button>`
            }
            </td>
            <td class="text-right">
                <div class="flex items-center justify-end gap-1">
                    <button onclick="window.handleEditUser('${user.id}')" class="btn-ghost btn-sm btn-icon" title="Edit">
                        <i data-lucide="pencil" class="w-4 h-4"></i>
                    </button>
                    <button onclick="window.handleDeleteUser('${user.id}', '${user.nama}')" class="btn-ghost btn-sm btn-icon text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30" title="Hapus">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
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