import { db } from "../firebase/config.js";
import { doc, getDocs, getDoc, collection, setDoc } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { adminService } from "../firebase/admin-service.js";
import { showToast, showConfirm, initTheme, showCustomModal } from "../utils/ui.js";
import { clearKepalaSekolahCache } from "../utils/cache-utils.js";

const el = (id) => document.getElementById(id);
const state = {
  classes: new Set(),
  studentsCache: {},
  draft: [],
  selectedIds: new Set(),
};

// --- INIT ---
async function initAdmin() {
  initTheme();
  console.log("Init Admin Page...");
  await loadClasses(true);
  setupEvents();
  updateBatchUI();

  const currentFilter = el("filterKelasSiswa")?.value;
  if (currentFilter) loadStudentsByClass(currentFilter);
}

// --- 1. LOAD CLASSES ---
async function loadClasses(forceRefresh = false) {
  const selectNewStudent = el("selectKelasSiswa");
  const selectFilter = el("filterKelasSiswa");
  const selectTargetPromote = el("selectTargetPromote"); // Dropdown di Modal Promote

  if (selectNewStudent) selectNewStudent.innerHTML = '<option>Memuat...</option>';
  if (selectFilter) selectFilter.innerHTML = '<option>Memuat...</option>';

  try {
    const data = await adminService.getClasses(forceRefresh);
    state.classes.clear();

    if (data.length === 0) {
      if (selectNewStudent) selectNewStudent.innerHTML = '<option value="">-- Belum ada kelas --</option>';
      return;
    }

    const regularClasses = data.filter(c => !c.is_khusus);
    const sorter = (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true });
    regularClasses.sort(sorter);
    data.sort(sorter);

    // 1. Input Siswa
    if (selectNewStudent) {
      const opts = regularClasses.map(c => `<option value="${c.id}">${c.nama_kelas || c.id}</option>`).join("");
      selectNewStudent.innerHTML = '<option value="">-- Pilih Kelas Reguler --</option>' + opts;
    }

    const draftKelasFilter = el("filterDraftKelas");
    if (draftKelasFilter) {
      const draftOpts = regularClasses.map(c => `<option value="${c.id}">${c.nama_kelas || c.id}</option>`).join("");
      draftKelasFilter.innerHTML = '<option value="">Semua Kelas (Antrian)</option>' + draftOpts;
    }

    // 2. Filter Tabel
    if (selectFilter) {
      const opts = data.map(c => {
        state.classes.add(c.id);
        const label = c.is_khusus ? `★ ${c.nama_kelas} (Mapel)` : (c.nama_kelas || c.id);
        return `<option value="${c.id}">${label}</option>`;
      }).join("");
      selectFilter.innerHTML = '<option value="" disabled selected>-- Pilih Kelas Data --</option>' + opts;
    }

    // 3. Dropdown di Modal Promote (Hanya Kelas Reguler)
    if (selectTargetPromote) {
      const opts = regularClasses.map(c => `<option value="${c.id}">${c.nama_kelas || c.id}</option>`).join("");
      selectTargetPromote.innerHTML = '<option value="" disabled selected>-- Pilih Kelas Tujuan --</option>' + opts;
    }

  } catch (e) {
    console.error("Load Class Error:", e);
    showToast("Gagal memuat daftar kelas.", "error");
  }
}
window.openSchoolSettings = async function () {
  const docRef = doc(db, "settings", "kepala_sekolah");

  // Loading sementara
  let currentData = { nama: "", nip: "" };

  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      currentData = snap.data();
    }
  } catch (e) {
    console.error("Gagal ambil data settings", e);
  }

  // Form HTML
  const formHtml = `
        <div class="space-y-4 text-left">
            <div class="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-100 dark:border-blue-800">
                <p class="text-xs text-blue-600 dark:text-blue-300 flex items-center gap-2">
                    <i data-lucide="info" class="w-4 h-4"></i>
                    Data ini akan muncul di bagian Tanda Tangan PDF.
                </p>
            </div>

            <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nama Kepala Sekolah</label>
                <input type="text" id="set-nama" value="${currentData.nama}" 
                    placeholder="Contoh: Dr. H. Budi, M.Pd"
                    class="w-full rounded-lg border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2.5">
            </div>
            
            <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">NIP (Tanpa Spasi)</label>
                <input type="text" id="set-nip" value="${currentData.nip}" 
                    placeholder="Contoh: 198001012000121001"
                    class="w-full rounded-lg border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2.5">
            </div>
        </div>
    `;

  // Tampilkan Modal
  showCustomModal("Pengaturan Kepala Sekolah", formHtml, async () => {
    const nama = document.getElementById("set-nama").value.trim();
    const nip = document.getElementById("set-nip").value.trim();

    if (!nama) {
      showToast("Nama Kepala Sekolah wajib diisi!", "error");
      return;
    }

    try {
      // Simpan ke Firestore
      await setDoc(docRef, { nama, nip }, { merge: true });
      clearKepalaSekolahCache();
      showToast("Data Kepala Sekolah berhasil disimpan.", "success");
    } catch (error) {
      console.error(error);
      showToast("Gagal menyimpan: " + error.message, "error");
    }
  });
};

// --- 2. CLASS MANAGER ---
window.openClassManager = async (forceRefresh = false) => {
  let classes = [];
  try {
    classes = await adminService.getClasses(forceRefresh);
    classes.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  } catch (e) { return showToast("Gagal memuat data", "error"); }

  const renderList = () => classes.map(c => {
    const isKhusus = c.is_khusus;
    return `
        <div class="flex justify-between items-center p-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 last:border-0 transition-colors">
            <div>
                <div class="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                    ${c.nama_kelas || c.id}
                    ${isKhusus
        ? `<span class="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700 text-[10px] px-2 rounded-full border border-purple-200">MAPEL</span>`
        : `<span class="bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300 text-[10px] px-2 rounded-full border border-transparent dark:border-blue-800">REGULER</span>`}
                </div>
                <div class="text-xs text-gray-400 font-mono">ID: ${c.id}</div>
            </div>
            <div class="flex gap-2">
                ${isKhusus ? `<button onclick="openManageMembers('${c.id}')" class="text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded flex items-center gap-1 shadow-sm transition"><i data-lucide="users" class="w-3 h-3"></i> + Siswa</button>` : ''}
                <button onclick="handleDeleteClass('${c.id}')" class="text-red-400 hover:text-red-600 dark:hover:text-red-300 p-2 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            </div>
        </div>`;
  }).join('');

  const containerHtml = `
        <div class="space-y-4">
            <div class="border dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 max-h-[400px] overflow-y-auto shadow-inner custom-scrollbar">
                ${classes.length ? renderList() : '<div class="p-4 text-center text-gray-400 italic">Belum ada kelas.</div>'}
            </div>
            <div class="flex justify-end">
                <button onclick="openClassManager(true)" class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 transition">
                    <i data-lucide="refresh-cw" class="w-3 h-3"></i> Refresh Data Server
                </button>
            </div>
        </div>`;

  showCustomModal("Daftar Kelas Aktif", containerHtml);
  if (window.lucide) lucide.createIcons();
};

// --- 3. KELOLA ANGGOTA KELAS KHUSUS ---
window.openManageMembers = async (kelasId) => {
  showCustomModal("Memuat Data...", `<div class="text-center p-8 text-gray-500 dark:text-gray-400"><span class="animate-spin inline-block text-2xl mb-2">↻</span><br>Mengambil data siswa...</div>`);
  try {
    const [snap, existingMembers] = await Promise.all([
      getDocs(collection(db, "siswa")),
      adminService.getSiswaByKelas(kelasId),
    ]);
    const memberIds = new Set(existingMembers.map(s => s.id));
    const allStudents = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.status_aktif === 'Aktif');
    allStudents.sort((a, b) => (a.id_kelas || '').localeCompare(b.id_kelas || '') || a.nama_siswa.localeCompare(b.nama_siswa));
    const kelasList = [...new Set(allStudents.map(s => s.id_kelas).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const html = `
            <div class="space-y-3">
                <div class="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-100 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-200">
                    <strong class="font-bold">Kelas: ${kelasId}</strong><br>
                    Centang siswa di bawah ini untuk dimasukkan ke kelas mapel ini.
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div class="relative">
                        <input type="text" id="searchMember" placeholder="Cari nama / NIS..."
                            class="w-full p-2.5 pl-9 border rounded-lg outline-none text-sm transition
                                   bg-white dark:bg-gray-800 
                                   border-gray-300 dark:border-gray-600 
                                   text-gray-900 dark:text-white
                                   focus:ring-2 focus:ring-purple-500 dark:focus:ring-purple-400">
                        <div class="absolute left-3 top-2.5 text-gray-400">🔍</div>
                    </div>
                    <select id="filterMemberKelas"
                        class="p-2.5 border rounded-lg outline-none text-sm transition
                               bg-white dark:bg-gray-800 
                               border-gray-300 dark:border-gray-600 
                               text-gray-900 dark:text-white
                               focus:ring-2 focus:ring-purple-500 dark:focus:ring-purple-400">
                        <option value="">Semua Kelas</option>
                        ${kelasList.map(k => `<option value="${k}">${k}</option>`).join('')}
                    </select>
                </div>

                <div class="max-h-[300px] overflow-y-auto border dark:border-gray-700 rounded-lg p-1 bg-gray-50 dark:bg-gray-900/50 space-y-1 custom-scrollbar" id="listMember">
                    ${allStudents.map(s => `
                    <label class="flex items-center gap-3 p-2 border border-transparent rounded cursor-pointer item-member transition-colors
                                  bg-white dark:bg-gray-800 
                                  hover:bg-indigo-50 dark:hover:bg-indigo-900/20 
                                  hover:border-indigo-100 dark:hover:border-indigo-800"
                        data-kelas="${s.id_kelas || ''}">
                        <input type="checkbox" value="${s.id}" ${memberIds.has(s.id) ? 'checked' : ''} class="w-5 h-5 accent-purple-600 form-checkbox rounded cursor-pointer">
                        <div class="flex-1">
                            <div class="font-bold text-sm search-name text-gray-800 dark:text-gray-200">${s.nama_siswa}</div>
                            <div class="text-xs text-gray-500 dark:text-gray-400 search-class font-mono">
                                <span class="bg-gray-100 dark:bg-gray-700 px-1 rounded text-[10px]">${s.id_kelas || '?'}</span> | ${s.nis}
                            </div>
                        </div>
                    </label>`).join('')}
                </div>

                <div class="pt-3 border-t dark:border-gray-700 flex justify-end">
                     <button onclick="saveSpecialMembers('${kelasId}')" class="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg font-bold shadow-lg transition active:scale-95 text-sm">
                        Simpan Anggota
                     </button>
                </div>
            </div>`;

    showCustomModal(`Kelola Anggota: ${kelasId}`, html);

    window.filterMember = () => {
      const term = (el('searchMember')?.value || '').toLowerCase();
      const kelas = el('filterMemberKelas')?.value || '';
      document.querySelectorAll('.item-member').forEach(row => {
        const matchName = !term || row.innerText.toLowerCase().includes(term);
        const matchKelas = !kelas || row.dataset.kelas === kelas;
        row.style.display = matchName && matchKelas ? 'flex' : 'none';
      });
    };
    el('searchMember')?.addEventListener('input', window.filterMember);
    el('filterMemberKelas')?.addEventListener('change', window.filterMember);
    window.saveSpecialMembers = async (kId) => {
      const selectedIds = Array.from(document.querySelectorAll('#listMember input:checked')).map(cb => cb.value);
      if (!selectedIds.length) return showToast("Pilih minimal 1 siswa", "info");

      const btn = document.querySelector('button[onclick^="saveSpecialMembers"]');
      if (btn) { btn.innerHTML = "Menyimpan..."; btn.disabled = true; }

      try {
        await adminService.addSiswaToSpecialClass(kId, selectedIds);
        delete state.studentsCache[kId];
        if (el("filterKelasSiswa")?.value === kId) loadStudentsByClass(kId, true);
        showToast("Siswa ditambahkan!", "success");
      } catch (e) {
        showToast(e.message, "error");
        if (btn) { btn.innerHTML = "Simpan Anggota"; btn.disabled = false; }
      }
    };
  } catch (e) { showToast(e.message, "error"); }
};

// --- 4. CREATE CLASS ---
window.handleCreateClass = async () => {
  const nameInput = el('inputNamaKelas');
  const checkInput = el('isKhususCheck');
  const nama = nameInput?.value.trim();
  if (!nama) return showToast("Nama Kelas wajib diisi!", "warning");
  const id = nama.toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '');
  try {
    await adminService.createClass(id, nama, checkInput?.checked);
    showToast(`Kelas ${nama} berhasil dibuat!`, "success");
    nameInput.value = '';
    if (checkInput) checkInput.checked = false;
    await loadClasses(true);
  } catch (e) { showToast(e.message, "error"); }
};

// --- 5. TABEL SISWA ---
async function loadStudentsByClass(kelasId, forceRefresh = false) {
  if (!kelasId) return;
  state.selectedIds.clear();
  updateBatchUI();

  const tbody = el("tbodySiswa");
  if (!tbody) return;

  if (!forceRefresh && state.studentsCache[kelasId]) {
    renderTable();
    return;
  }
  tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-400"><span class="animate-spin inline-block">↻</span> Memuat...</td></tr>`;
  try {
    const data = await adminService.getSiswaByKelas(kelasId);
    state.studentsCache[kelasId] = data;
    renderTable();
    if (forceRefresh) showToast("Data diperbarui", "success");
  } catch (err) { tbody.innerHTML = `<tr><td colspan="5" class="text-center text-red-500 p-4">Error: ${err.message}</td></tr>`; }
}

function getFilteredStudents() {
  const kelasId = el("filterKelasSiswa")?.value;
  if (!kelasId || !state.studentsCache[kelasId]) return [];
  const term = (el("filterNamaSiswa")?.value || "").trim().toLowerCase();
  const list = state.studentsCache[kelasId];
  if (!term) return list;
  return list.filter(s =>
    s.nama.toLowerCase().includes(term) ||
    String(s.nis || "").toLowerCase().includes(term)
  );
}

function renderTable(listSiswa = null) {
  const list = listSiswa ?? getFilteredStudents();
  const tbody = el("tbodySiswa");
  if (!list.length) {
    const hasCache = el("filterKelasSiswa")?.value && state.studentsCache[el("filterKelasSiswa").value]?.length;
    const msg = hasCache ? "Tidak ada siswa cocok filter." : "Tidak ada siswa.";
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-gray-400 p-8 italic">${msg}</td></tr>`;
    return;
  }
  const kelasFilter = el("filterKelasSiswa")?.value || "";
  tbody.innerHTML = list.map(s => `
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-800 border-b dark:border-gray-700">
            <td class="p-4 text-center"><input type="checkbox" class="student-checkbox w-4 h-4 rounded" data-id="${s.id}" ${state.selectedIds.has(s.id) ? "checked" : ""}></td>
            <td class="p-4 font-medium text-gray-800 dark:text-gray-200">${s.nama}</td>
            <td class="p-4 text-xs font-mono text-gray-500">${s.nis}</td>
            <td class="p-4"><span class="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold">${s.id_kelas || '-'}</span></td>
            <td class="p-4 text-center"><button onclick="deleteStudent('${s.id}', '${kelasFilter}')" class="text-red-400 hover:text-red-600 p-2"><i data-lucide="trash-2" class="w-4 h-4"></i></button></td>
        </tr>`).join("");
  if (window.lucide) lucide.createIcons({ root: tbody });
}

// --- 6. BATCH LOGIC  ---
async function handleBatchDelete() {
  const ids = Array.from(state.selectedIds);
  if (ids.length === 0) return;

  const currentClass = el("filterKelasSiswa").value;
  const isKhusus = isFilterKelasKhusus();
  const msg = isKhusus ? "Keluarkan siswa terpilih dari kelas mapel ini?" : `Hapus PERMANEN ${ids.length} siswa terpilih?`;

  showConfirm("Konfirmasi Batch", async () => {
    try {
      const promises = ids.map(id => adminService.deleteStudent(id, currentClass));
      await Promise.all(promises);
      showToast("Berhasil dihapus", "success");
      state.selectedIds.clear();
      loadStudentsByClass(currentClass, true);
    } catch (e) { showToast(e.message, "error"); }
  }, msg);
}

// Logic Modal Promote
function openPromoteModal() {
  const ids = Array.from(state.selectedIds);
  if (ids.length === 0) return;

  const modal = el("modalPromote");
  const countSpan = el("promoteCount");

  if (countSpan) countSpan.innerText = ids.length;
  if (modal) {
    modal.classList.remove("hidden");
    setTimeout(() => {
      modal.classList.remove("opacity-0");
      modal.querySelector(".modal-panel").classList.remove("scale-95");
      modal.querySelector("div").classList.add("scale-100");
    }, 10);
  }
}

function closePromoteModal() {
  const modal = el("modalPromote");
  if (modal) {
    modal.classList.add("opacity-0");
    modal.querySelector("div").classList.remove("scale-100");
    modal.querySelector(".modal-panel").classList.add("scale-95");
    setTimeout(() => modal.classList.add("hidden"), 300);
  }
}

async function executePromote() {
  const targetClass = el("selectTargetPromote").value;
  const ids = Array.from(state.selectedIds);

  if (!targetClass) return showToast("Pilih kelas tujuan!", "warning");

  const btn = el("btnConfirmPromote");
  const ori = btn.innerHTML;
  btn.innerHTML = "Processing..."; btn.disabled = true;

  try {
    await adminService.moveStudentBatch(ids, targetClass);
    showToast(`Berhasil memindahkan ${ids.length} siswa!`, "success");
    state.selectedIds.clear();
    closePromoteModal();
    loadStudentsByClass(el("filterKelasSiswa").value, true);
  } catch (e) {
    showToast("Gagal: " + e.message, "error");
  } finally {
    btn.innerHTML = ori; btn.disabled = false;
  }
}

// --- EVENTS ---
function setupEvents() {
  el("btnSaveKelas")?.addEventListener("click", handleCreateClass);
  el("filterKelasSiswa")?.addEventListener("change", (e) => {
    if (el("filterNamaSiswa")) el("filterNamaSiswa").value = "";
    loadStudentsByClass(e.target.value);
    updateBatchUI();
  });
  el("filterNamaSiswa")?.addEventListener("input", () => {
    const kelasId = el("filterKelasSiswa")?.value;
    if (kelasId && state.studentsCache[kelasId]) renderTable();
  });
  el("btnRefreshStudents")?.addEventListener("click", () => loadStudentsByClass(el("filterKelasSiswa").value, true));

  // Batch Buttons
  el("btnTambahSiswaMapel")?.addEventListener("click", () => {
    const kelasId = el("filterKelasSiswa")?.value;
    if (kelasId && isFilterKelasKhusus()) openManageMembers(kelasId);
  });
  el("btnDeleteSelected")?.addEventListener("click", handleBatchDelete);
  el("btnPromoteClass")?.addEventListener("click", openPromoteModal);

  // Modal Promote Events
  el("btnClosePromote")?.addEventListener("click", closePromoteModal);
  el("btnCancelPromote")?.addEventListener("click", closePromoteModal);
  el("btnConfirmPromote")?.addEventListener("click", executePromote);

  // Checkbox Logic
  el("checkAll")?.addEventListener("change", (e) => {
    const visibleIds = new Set(getFilteredStudents().map(s => s.id));
    document.querySelectorAll(".student-checkbox").forEach(cb => {
      if (!visibleIds.has(cb.dataset.id)) return;
      cb.checked = e.target.checked;
      e.target.checked ? state.selectedIds.add(cb.dataset.id) : state.selectedIds.delete(cb.dataset.id);
    });
    updateBatchUI();
  });

  el("tbodySiswa")?.addEventListener("click", (e) => {
    if (e.target.classList.contains("student-checkbox")) {
      e.target.checked ? state.selectedIds.add(e.target.dataset.id) : state.selectedIds.delete(e.target.dataset.id);
      updateBatchUI();
    }
  });

  // Draft Logic 
  el("btnAddToDraft")?.addEventListener("click", handleAddToDraft);
  el("filterDraftNama")?.addEventListener("input", renderDraftTable);
  el("filterDraftKelas")?.addEventListener("change", renderDraftTable);
  el("btnUploadBatch")?.addEventListener("click", async () => {
    if (!state.draft.length) return;
    try { await adminService.uploadDraftBatch(state.draft); state.draft = []; renderDraftTable(); showToast("Sukses upload", "success"); }
    catch (e) { showToast(e.message, "error"); }
  });

  // Global
  window.deleteStudent = async (id, kls) => {
    const isKhusus = isFilterKelasKhusus();
    showConfirm(isKhusus ? "Keluarkan?" : "Hapus?", async () => {
      await adminService.deleteStudent(id, kls);
      loadStudentsByClass(kls, true);
    }, isKhusus ? "Hanya keluar kelas." : "Data hilang permanen.");
  };
  window.handleDeleteClass = async (id) => {
    if (confirm("Hapus Kelas?")) { await adminService.deleteClass(id); loadClasses(true); window.openClassManager(true); }
  };
  window.removeDraft = (i) => { state.draft.splice(i, 1); renderDraftTable(); };
}

// Helpers
function isFilterKelasKhusus() {
  const sel = el("filterKelasSiswa");
  if (!sel?.selectedOptions?.length) return false;
  return sel.selectedOptions[0].text.includes("(Mapel)");
}

function updateBatchUI() {
  const cnt = state.selectedIds.size;
  const isKhusus = isFilterKelasKhusus();
  const kelasId = el("filterKelasSiswa")?.value;
  el("countSelected").innerText = cnt;
  if (el("btnDeleteSelected")) el("btnDeleteSelected").disabled = cnt === 0;
  if (el("btnPromoteClass")) {
    el("btnPromoteClass").style.display = isKhusus ? "none" : "flex";
    el("btnPromoteClass").disabled = cnt === 0;
  }
  if (el("btnTambahSiswaMapel")) {
    el("btnTambahSiswaMapel").style.display = isKhusus && kelasId ? "flex" : "none";
  }
  const delLabel = el("btnDeleteSelectedLabel");
  if (delLabel) delLabel.textContent = isKhusus ? "KELUARKAN" : "HAPUS";
}
function handleAddToDraft() {
  const n = el("inputNamaSiswa").value, i = el("inputNISSiswa").value, k = el("selectKelasSiswa").value;
  if (!n || !i || !k) return showToast("Lengkapi data", "warning");
  state.draft.push({ nama_siswa: n, nis: i, id_kelas: k, status_aktif: "Aktif" });
  el("inputNamaSiswa").value = ""; el("inputNISSiswa").value = ""; renderDraftTable();
}
function getFilteredDraft() {
  const term = (el("filterDraftNama")?.value || "").trim().toLowerCase();
  const kelas = el("filterDraftKelas")?.value || "";
  return state.draft
    .map((d, i) => ({ ...d, _idx: i }))
    .filter(d => {
      const matchKelas = !kelas || d.id_kelas === kelas;
      const matchName = !term || d.nama_siswa.toLowerCase().includes(term) || String(d.nis).toLowerCase().includes(term);
      return matchKelas && matchName;
    });
}

function renderDraftTable() {
  const filtered = getFilteredDraft();
  const tbody = el("tbodyDraft");
  if (!filtered.length) {
    const msg = state.draft.length ? "Tidak ada data cocok filter." : "Antrian kosong.";
    tbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-xs text-gray-400 italic">${msg}</td></tr>`;
  } else {
    tbody.innerHTML = filtered.map(d => `<tr class="border-b dark:border-gray-700"><td class="p-2 text-xs">${d.nama_siswa}</td><td class="p-2 text-xs">${d.id_kelas}</td><td class="p-2"><button onclick="removeDraft(${d._idx})" class="text-red-500"><i data-lucide="trash-2" class="w-4 h-4"></i></button></td></tr>`).join("");
    if (window.lucide) lucide.createIcons({ root: tbody });
  }
  el("btnUploadBatch").style.display = state.draft.length ? "flex" : "none";
  el("countDraft").innerText = `Antrian: ${state.draft.length}`;
}

initAdmin();
