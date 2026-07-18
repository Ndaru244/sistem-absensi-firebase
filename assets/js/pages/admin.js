import { db } from "../firebase/config.js?v=72ec519";
import { doc, getDocs, getDoc, collection, setDoc, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { adminService } from "../firebase/admin-service.js?v=72ec519";
import { userService } from "../firebase/user-service.js?v=72ec519";
import { showToast, showConfirm, initTheme, showCustomModal } from "../utils/ui.js?v=72ec519";
import { clearKepalaSekolahCache } from "../utils/cache-utils.js?v=72ec519";
import { SearchableSelect, optionsFromClasses } from "../utils/searchable-select.js?v=72ec519";

const el = (id) => document.getElementById(id);

// Registry SearchableSelect untuk admin
const ssAdmin = {
  filterKelas: null,  // filterKelasSiswa
};
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

  const currentFilter = ssAdmin.filterKelas ? ssAdmin.filterKelas.getValue() : "";
  if (currentFilter) loadStudentsByClass(currentFilter);
}

// --- 1. LOAD CLASSES ---
async function loadClasses(forceRefresh = false) {
  const selectNewStudent = el("selectKelasSiswa");
  const selectFilter = el("filterKelasSiswa");
  const selectTargetPromote = el("selectTargetPromote"); // Dropdown di Modal Promote

  if (selectNewStudent) selectNewStudent.innerHTML = '<option>Memuat...</option>';
  // filterKelasSiswa dihandle via SearchableSelect — tidak perlu innerHTML "Memuat"

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

    // 2. Filter Tabel — SearchableSelect
    if (selectFilter) {
      data.forEach(c => state.classes.add(c.id));
      const options = optionsFromClasses(data);

      if (!ssAdmin.filterKelas) {
        ssAdmin.filterKelas = new SearchableSelect(selectFilter, {
          placeholder: '-- Pilih Kelas --',
          allowEmpty: false,
          onChange: (value) => {
            if (el("filterNamaSiswa")) el("filterNamaSiswa").value = "";
            if (value) loadStudentsByClass(value);
            updateBatchUI();
          },
        });
      }
      const prevVal = ssAdmin.filterKelas.getValue();
      ssAdmin.filterKelas.setOptions(options);
      // Pertahankan nilai sebelumnya jika masih valid
      if (prevVal && data.find(c => c.id === prevVal)) {
        ssAdmin.filterKelas.setValue(prevVal);
      }
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
      showToast("Nama Kepala Sekolah wajib diisi!", "warning");
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
    
    // Group students by class
    const studentsByClass = {};
    allStudents.forEach(s => {
      const kelas = s.id_kelas || 'Tanpa Kelas';
      if (!studentsByClass[kelas]) studentsByClass[kelas] = [];
      studentsByClass[kelas].push(s);
    });
    
    const sortedKelas = Object.keys(studentsByClass).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const html = `
            <div class="space-y-4">
                <div class="bg-purple-50 dark:bg-purple-900/20 p-3 rounded-lg border border-purple-100 dark:border-purple-800 text-xs text-purple-800 dark:text-purple-200">
                    <div class="flex items-center gap-2">
                        <i data-lucide="info" class="w-4 h-4"></i>
                        <div>
                            <strong class="font-bold">Kelas: ${kelasId}</strong><br>
                            Pilih kelas dari dropdown, lalu tambahkan siswa ke panel kanan.
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
                    <!-- Left Panel: Class Selection & Available Students -->
                    <div class="flex flex-col min-w-0">
                        <div class="flex items-center justify-between mb-2">
                            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Siswa Tersedia</h3>
                            <span id="availableCount" class="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded-full text-gray-600 dark:text-gray-300">0</span>
                        </div>
                        
                        <div class="mb-2">
                            <select id="selectSourceClass" class="w-full">
                                <option value="">-- Pilih Kelas --</option>
                                ${sortedKelas.map(k => `<option value="${k}">${k}</option>`).join('')}
                            </select>
                        </div>

                        <div class="relative mb-2">
                            <input type="text" id="searchAvailable" placeholder="Cari siswa..."
                                class="w-full p-2 pl-9 border rounded-lg outline-none text-sm transition
                                       bg-white dark:bg-gray-800 
                                       border-gray-300 dark:border-gray-600 
                                       text-gray-900 dark:text-white
                                       focus:ring-2 focus:ring-purple-500 dark:focus:ring-purple-400">
                            <div class="absolute left-3 top-2.5 text-gray-400">🔍</div>
                        </div>

                        <button id="btnAddAllFromClass" disabled
                            class="w-full mb-2 h-[42px] bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg font-medium shadow-md transition active:scale-95 text-sm flex items-center justify-center gap-2">
                            <i data-lucide="plus-circle" class="w-4 h-4"></i> Tambah Semua dari Kelas
                        </button>

                        <div id="availableList" class="flex-1 min-h-[320px] max-h-[320px] overflow-y-auto border dark:border-gray-700 rounded-lg p-2 bg-gray-50 dark:bg-gray-900/50 space-y-1 custom-scrollbar">
                            <div class="text-center text-gray-400 dark:text-gray-500 text-sm py-4">Pilih kelas terlebih dahulu</div>
                        </div>
                    </div>

                    <!-- Center Controls -->
                    <div class="flex flex-col justify-center items-center gap-3 py-4 px-2">
                        <button onclick="moveSelected('available', 'selected')" 
                            class="w-12 h-12 rounded-lg bg-purple-600 hover:bg-purple-700 text-white flex items-center justify-center shadow-md transition active:scale-95"
                            title="Pindahkan ke Terpilih">
                            <i data-lucide="chevron-right" class="w-5 h-5"></i>
                        </button>
                        <button onclick="moveSelected('selected', 'available')" 
                            class="w-12 h-12 rounded-lg bg-white dark:bg-slate-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center justify-center shadow-md transition active:scale-95"
                            title="Kembalikan ke Tersedia">
                            <i data-lucide="chevron-left" class="w-5 h-5"></i>
                        </button>
                        <div class="w-px h-4 bg-gray-300 dark:bg-gray-600"></div>
                        <button onclick="moveAll('available', 'selected')" 
                            class="w-10 h-10 rounded-lg bg-purple-500 hover:bg-purple-600 text-white flex items-center justify-center shadow-md transition active:scale-95 text-sm font-medium"
                            title="Pindahkan Semua">
                            »
                        </button>
                        <button onclick="moveAll('selected', 'available')" 
                            class="w-10 h-10 rounded-lg bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 flex items-center justify-center shadow-md transition active:scale-95 text-sm font-medium"
                            title="Kembalikan Semua">
                            «
                        </button>
                    </div>

                    <!-- Right Panel: Selected Students -->
                    <div class="flex flex-col min-w-0">
                        <div class="flex items-center justify-between mb-2">
                            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Siswa Terpilih</h3>
                            <span id="selectedCount" class="text-xs bg-purple-200 dark:bg-purple-900/30 px-2 py-1 rounded-full text-purple-700 dark:text-purple-300">0</span>
                        </div>
                        
                        <div class="relative mb-2">
                            <input type="text" id="searchSelected" placeholder="Cari siswa..."
                                class="w-full p-2 pl-9 border rounded-lg outline-none text-sm transition
                                       bg-white dark:bg-gray-800 
                                       border-gray-300 dark:border-gray-600 
                                       text-gray-900 dark:text-white
                                       focus:ring-2 focus:ring-purple-500 dark:focus:ring-purple-400">
                            <div class="absolute left-3 top-2.5 text-gray-400">🔍</div>
                        </div>

                        <div class="mb-2 h-[42px]"></div>

                        <div id="selectedList" class="flex-1 min-h-[320px] max-h-[320px] overflow-y-auto border dark:border-gray-700 rounded-lg p-2 bg-purple-50 dark:bg-purple-900/20 space-y-1 custom-scrollbar">
                            <!-- Students will be rendered here -->
                        </div>
                    </div>
                </div>

                <div class="pt-3 border-t dark:border-gray-700 flex justify-end">
                     <button onclick="saveSpecialMembers('${kelasId}')" class="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg font-bold shadow-lg transition active:scale-95 text-sm">
                        <i data-lucide="save" class="w-4 h-4 inline mr-1"></i> Simpan Anggota
                     </button>
                </div>
            </div>`;

    showCustomModal(`Kelola Anggota: ${kelasId}`, html, null, 'max-w-5xl');

    // Initialize SearchableSelect for class selection
    const classSelectOptions = sortedKelas.map(k => ({ value: k, label: k, group: '' }));
    const classSelect = new SearchableSelect(el('selectSourceClass'), {
      placeholder: '-- Pilih Kelas --',
      searchPlaceholder: 'Cari kelas...',
      allowEmpty: true,
      onChange: (value) => {
        const btnAddAll = el('btnAddAllFromClass');
        
        if (value) {
          // Get students from selected class that are not already in selected list
          const selectedIds = new Set(window.selectedStudents.map(s => s.id));
          window.currentClassStudents = studentsByClass[value].filter(s => !selectedIds.has(s.id));
          btnAddAll.disabled = window.currentClassStudents.length === 0;
        } else {
          window.currentClassStudents = [];
          btnAddAll.disabled = true;
        }
        
        renderAvailableList();
        updateCounts();
      }
    });
    classSelect.setOptions(classSelectOptions);

    // Initialize state
    window.allStudentsData = allStudents;
    window.selectedStudents = allStudents.filter(s => memberIds.has(s.id));
    window.currentClassStudents = [];
    
    // Render initial selected list
    renderSelectedList();
    updateCounts();

    // Add all from class button
    el('btnAddAllFromClass')?.addEventListener('click', () => {
      const selectedClass = classSelect.getValue();
      if (!selectedClass) return;
      
      window.selectedStudents = [...window.selectedStudents, ...window.currentClassStudents];
      window.currentClassStudents = [];
      
      // Refresh available list for current class
      const selectedIds = new Set(window.selectedStudents.map(s => s.id));
      window.currentClassStudents = studentsByClass[selectedClass].filter(s => !selectedIds.has(s.id));
      
      el('btnAddAllFromClass').disabled = window.currentClassStudents.length === 0;
      
      renderAvailableList();
      renderSelectedList();
      updateCounts();
    });

    // Search functionality
    el('searchAvailable')?.addEventListener('input', renderAvailableList);
    el('searchSelected')?.addEventListener('input', renderSelectedList);

    // Move selected students
    window.moveSelected = (from, to) => {
      const checkboxes = document.querySelectorAll(`#${from}List input[type="checkbox"]:checked`);
      const idsToMove = Array.from(checkboxes).map(cb => cb.value);
      
      // Uncheck all checkboxes after getting values
      checkboxes.forEach(cb => cb.checked = false);
      
      if (from === 'available') {
        window.selectedStudents = [...window.selectedStudents, ...window.currentClassStudents.filter(s => idsToMove.includes(s.id))];
        window.currentClassStudents = window.currentClassStudents.filter(s => !idsToMove.includes(s.id));
        
        // Update add all button state
        el('btnAddAllFromClass').disabled = window.currentClassStudents.length === 0;
      } else {
        const selectedClass = classSelect.getValue();
        const movedStudents = window.selectedStudents.filter(s => idsToMove.includes(s.id));
        window.selectedStudents = window.selectedStudents.filter(s => !idsToMove.includes(s.id));
        
        // If moved students belong to currently selected class, add them back to available
        if (selectedClass) {
          const classStudents = movedStudents.filter(s => s.id_kelas === selectedClass);
          window.currentClassStudents = [...window.currentClassStudents, ...classStudents];
          el('btnAddAllFromClass').disabled = window.currentClassStudents.length === 0;
        }
      }
      
      renderAvailableList();
      renderSelectedList();
      updateCounts();
    };

    // Move all students
    window.moveAll = (from, to) => {
      if (from === 'available') {
        window.selectedStudents = [...window.selectedStudents, ...window.currentClassStudents];
        window.currentClassStudents = [];
        el('btnAddAllFromClass').disabled = true;
      } else {
        const selectedClass = classSelect.getValue();
        const movedStudents = [...window.selectedStudents];
        window.selectedStudents = [];
        
        // If there's a selected class, add back students from that class
        if (selectedClass) {
          const classStudents = movedStudents.filter(s => s.id_kelas === selectedClass);
          window.currentClassStudents = [...window.currentClassStudents, ...classStudents];
          el('btnAddAllFromClass').disabled = window.currentClassStudents.length === 0;
        }
      }
      
      renderAvailableList();
      renderSelectedList();
      updateCounts();
    };

    // Render available list
    function renderAvailableList() {
      const container = el('availableList');
      if (!container) return;
      
      const searchTerm = (el('searchAvailable')?.value || '').toLowerCase();
      const filtered = window.currentClassStudents.filter(s => 
        s.nama_siswa.toLowerCase().includes(searchTerm) || 
        String(s.nis || '').toLowerCase().includes(searchTerm)
      );
      
      if (!filtered.length) {
        container.innerHTML = '<div class="text-center text-gray-400 dark:text-gray-500 text-sm py-4">Tidak ada siswa tersedia</div>';
        return;
      }
      
      let html = filtered.map(s => `
        <label class="flex items-center gap-2 p-2 border border-transparent rounded cursor-pointer transition
                      bg-white dark:bg-gray-800 
                      hover:bg-indigo-50 dark:hover:bg-indigo-900/20 
                      hover:border-indigo-100 dark:hover:border-indigo-800 mb-1">
            <input type="checkbox" value="${s.id}" class="w-4 h-4 accent-purple-600 rounded cursor-pointer">
            <div class="flex-1 min-w-0">
                <div class="font-medium text-sm text-gray-800 dark:text-gray-200 truncate">${s.nama_siswa}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 font-mono">${s.nis}</div>
            </div>
        </label>
      `).join('');
      
      container.innerHTML = html;
    }

    // Render selected list
    function renderSelectedList() {
      const container = el('selectedList');
      if (!container) return;
      
      const searchTerm = (el('searchSelected')?.value || '').toLowerCase();
      const filtered = window.selectedStudents.filter(s => 
        s.nama_siswa.toLowerCase().includes(searchTerm) || 
        String(s.nis || '').toLowerCase().includes(searchTerm)
      );
      
      // Group by class for display
      const grouped = {};
      filtered.forEach(s => {
        const kelas = s.id_kelas || 'Tanpa Kelas';
        if (!grouped[kelas]) grouped[kelas] = [];
        grouped[kelas].push(s);
      });
      
      if (!filtered.length) {
        container.innerHTML = '<div class="text-center text-gray-400 dark:text-gray-500 text-sm py-4">Belum ada siswa terpilih</div>';
        return;
      }
      
      let html = '';
      Object.keys(grouped).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach(kelas => {
        html += `
          <div class="mb-2">
            <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 px-1">${kelas}</div>
            ${grouped[kelas].map(s => `
              <label class="flex items-center gap-2 p-2 border border-transparent rounded cursor-pointer transition
                            bg-white dark:bg-gray-800 
                            hover:bg-indigo-50 dark:hover:bg-indigo-900/20 
                            hover:border-indigo-100 dark:hover:border-indigo-800 mb-1">
                  <input type="checkbox" value="${s.id}" class="w-4 h-4 accent-purple-600 rounded cursor-pointer">
                  <div class="flex-1 min-w-0">
                      <div class="font-medium text-sm text-gray-800 dark:text-gray-200 truncate">${s.nama_siswa}</div>
                      <div class="text-xs text-gray-500 dark:text-gray-400 font-mono">${s.nis}</div>
                  </div>
              </label>
            `).join('')}
          </div>
        `;
      });
      
      container.innerHTML = html;
    }

    // Update counts
    function updateCounts() {
      el('availableCount').textContent = window.currentClassStudents.length;
      el('selectedCount').textContent = window.selectedStudents.length;
    }

    window.saveSpecialMembers = async (kId) => {
      const selectedIds = window.selectedStudents.map(s => s.id);
      if (!selectedIds.length) return showToast("Pilih minimal 1 siswa", "warning");

      const btn = document.querySelector('button[onclick^="saveSpecialMembers"]');
      if (btn) { btn.innerHTML = "Menyimpan..."; btn.disabled = true; }

      try {
        await adminService.addSiswaToSpecialClass(kId, selectedIds);
        delete state.studentsCache[kId];
        if (el("filterKelasSiswa")?.value === kId || ssAdmin.filterKelas?.getValue() === kId) loadStudentsByClass(kId, true);
        showToast("Siswa ditambahkan!", "success");
        if (btn) { btn.innerHTML = '<i data-lucide="save" class="w-4 h-4 inline mr-1"></i> Simpan Anggota'; btn.disabled = false; }
      } catch (e) {
        showToast(e.message, "error");
        if (btn) { btn.innerHTML = '<i data-lucide="save" class="w-4 h-4 inline mr-1"></i> Simpan Anggota'; btn.disabled = false; }
      }
    };
    
    if (window.lucide) lucide.createIcons();
  } catch (e) { showToast(e.message, "error"); }
};

// --- 4. KELOLA AKSES KELAS GURU ---
window.openGuruKelasAccess = async () => {
  showCustomModal("Memuat Data...", `<div class="text-center p-8 text-gray-500 dark:text-gray-400"><span class="animate-spin inline-block text-2xl mb-2">↻</span><br>Mengambil data guru & kelas...</div>`);
  
  try {
    const [guruSnap, classes] = await Promise.all([
      getDocs(query(collection(db, "users"), where("role", "==", "guru"))),
      adminService.getClasses()
    ]);
    
    const gurus = guruSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    gurus.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
    
    if (gurus.length === 0) {
      showCustomModal("Kelola Akses Kelas Guru", `<div class="text-center p-8 text-gray-500 dark:text-gray-400">Belum ada user dengan role guru.</div>`);
      return;
    }
    
    const regularClasses = classes.filter(c => !c.is_khusus);
    regularClasses.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    
    const html = `
      <div class="space-y-4">
        <div class="alert-info">
          <i data-lucide="info" class="w-4 h-4 flex-shrink-0 mt-0.5"></i>
          <p>Centang kelas yang dapat diakses oleh setiap guru untuk input absensi. Guru Piket & Super Admin otomatis akses semua kelas.</p>
        </div>
        
        <div class="max-h-[400px] overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg p-2 bg-slate-50 dark:bg-slate-900/50 space-y-2 custom-scrollbar" id="guruList">
          ${gurus.map(guru => `
            <div class="card p-3">
              <div class="flex items-center gap-3 mb-2">
                <img class="h-8 w-8 rounded-full object-cover border border-slate-200 dark:border-slate-700" src="${guru.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(guru.nama || 'Guru')}&background=random`}" alt="">
                <div class="flex-1">
                  <div class="font-semibold text-sm text-slate-900 dark:text-white">${guru.nama || 'Tanpa Nama'}</div>
                  <div class="text-xs text-slate-500 dark:text-slate-400">${guru.email || ''}</div>
                </div>
                <button onclick="toggleAllKelas('${guru.id}')" class="btn-ghost btn-sm text-xs">
                  <i data-lucide="check-square" class="w-3 h-3"></i> Semua
                </button>
              </div>
              <div class="flex flex-wrap gap-1.5" id="kelas-${guru.id}">
                ${regularClasses.map(kelas => {
                  const isChecked = (guru.kelas_ids || []).includes(kelas.id);
                  return `
                    <label class="flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer transition
                      ${isChecked 
                        ? 'bg-primary-50 dark:bg-primary-950/30 border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300' 
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}">
                      <input type="checkbox" value="${kelas.id}" ${isChecked ? 'checked' : ''} 
                        class="w-3.5 h-3.5 accent-primary-600 cursor-pointer guru-kelas-checkbox"
                        data-guru-id="${guru.id}">
                      <span class="text-xs font-medium">${kelas.nama_kelas || kelas.id}</span>
                    </label>
                  `;
                }).join('')}
              </div>
            </div>
          `).join('')}
        </div>
        
        <div class="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-end">
          <button onclick="saveGuruKelasAccess()" class="btn-primary">
            <i data-lucide="save" class="w-4 h-4"></i> Simpan Akses Kelas
          </button>
        </div>
      </div>
    `;
    
    showCustomModal("Kelola Akses Kelas Guru", html);
    
    // Toggle all kelas for a guru
    window.toggleAllKelas = (guruId) => {
      const container = document.getElementById(`kelas-${guruId}`);
      const checkboxes = container.querySelectorAll('.guru-kelas-checkbox');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      checkboxes.forEach(cb => cb.checked = !allChecked);
      checkboxes.forEach(cb => {
        const label = cb.closest('label');
        if (cb.checked) {
          label.className = 'flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer transition bg-primary-50 dark:bg-primary-950/30 border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300';
        } else {
          label.className = 'flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer transition bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700';
        }
      });
    };
    
    // Handle checkbox change visual
    document.querySelectorAll('.guru-kelas-checkbox').forEach(cb => {
      cb.addEventListener('change', function() {
        const label = this.closest('label');
        if (this.checked) {
          label.className = 'flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer transition bg-primary-50 dark:bg-primary-950/30 border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300';
        } else {
          label.className = 'flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer transition bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700';
        }
      });
    });
    
    // Save function
    window.saveGuruKelasAccess = async () => {
      const guruData = {};
      
      // Collect data from UI
      document.querySelectorAll('.guru-kelas-checkbox').forEach(cb => {
        const guruId = cb.dataset.guruId;
        if (!guruData[guruId]) guruData[guruId] = [];
        if (cb.checked) guruData[guruId].push(cb.value);
      });
      
      const btn = document.querySelector('button[onclick="saveGuruKelasAccess()"]');
      if (btn) { btn.innerHTML = 'Menyimpan...'; btn.disabled = true; }
      
      try {
        const updates = [];
        gurus.forEach(guru => {
          const kelasIds = guruData[guru.id] || [];
          updates.push(
            updateDoc(doc(db, "users", guru.id), { kelas_ids: kelasIds })
          );
        });
        
        await Promise.all(updates);
        
        // Clear caches
        gurus.forEach(guru => {
          localStorage.removeItem(`profile_${guru.id}`);
        });
        const { LoginCache } = await import('../firebase/auth-service.js?v=72ec519');
        gurus.forEach(guru => LoginCache.remove(guru.id));
        
        showToast("Akses kelas guru berhasil diperbarui!", "success");
      } catch (e) {
        console.error(e);
        showToast("Gagal menyimpan: " + e.message, "error");
        if (btn) { btn.innerHTML = '<i data-lucide="save" class="w-4 h-4 inline mr-1"></i> Simpan Akses Kelas'; btn.disabled = false; }
      }
    };
    
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error(e);
    showToast("Gagal memuat data: " + e.message, "error");
  }
};

// --- 5. CREATE CLASS ---
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
  const kelasId = ssAdmin.filterKelas ? ssAdmin.filterKelas.getValue() : (el("filterKelasSiswa")?.value || "");
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
    const hasCache = ssAdmin.filterKelas?.getValue() && state.studentsCache[ssAdmin.filterKelas.getValue()]?.length;
    const msg = hasCache ? "Tidak ada siswa cocok filter." : "Tidak ada siswa.";
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-gray-400 p-8 italic">${msg}</td></tr>`;
    return;
  }
  const kelasFilter = ssAdmin.filterKelas ? ssAdmin.filterKelas.getValue() : (el("filterKelasSiswa")?.value || "");
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

  const currentClass = ssAdmin.filterKelas ? ssAdmin.filterKelas.getValue() : (el("filterKelasSiswa")?.value || "");
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
    loadStudentsByClass(ssAdmin.filterKelas ? ssAdmin.filterKelas.getValue() : (el("filterKelasSiswa")?.value || ""), true);
  } catch (e) {
    showToast("Gagal: " + e.message, "error");
  } finally {
    btn.innerHTML = ori; btn.disabled = false;
  }
}

// --- EVENTS ---
function setupEvents() {
  el("btnSaveKelas")?.addEventListener("click", handleCreateClass);
  // filterKelasSiswa onChange ditangani di SearchableSelect (loadClasses)
  el("filterNamaSiswa")?.addEventListener("input", () => {
    const kelasId = ssAdmin.filterKelas ? ssAdmin.filterKelas.getValue() : "";
    if (kelasId && state.studentsCache[kelasId]) renderTable();
  });
  el("btnRefreshStudents")?.addEventListener("click", () => {
    const kelasId = ssAdmin.filterKelas ? ssAdmin.filterKelas.getValue() : "";
    if (kelasId) loadStudentsByClass(kelasId, true);
  });

  // Batch Buttons
  el("btnTambahSiswaMapel")?.addEventListener("click", () => {
    const kelasId = ssAdmin.filterKelas ? ssAdmin.filterKelas.getValue() : "";
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
    showConfirm("Hapus Kelas?", async () => {
      await adminService.deleteClass(id);
      loadClasses(true);
      window.openClassManager(true);
    }, "Data kelas dan relasinya akan dihapus.");
  };
  window.removeDraft = (i) => { state.draft.splice(i, 1); renderDraftTable(); };
}

// Helpers
function isFilterKelasKhusus() {
  const val = ssAdmin.filterKelas ? ssAdmin.filterKelas.getValue() : (el("filterKelasSiswa")?.value || "");
  if (!val) return false;
  // Cek berdasarkan data kelas di state — is_khusus lebih reliable dari label teks
  const found = ssAdmin.filterKelas?._options?.find(o => o.value === val);
  return found ? found.group === "Kelas Khusus" : false;
}

function updateBatchUI() {
  const cnt = state.selectedIds.size;
  const isKhusus = isFilterKelasKhusus();
  const kelasId = ssAdmin.filterKelas ? ssAdmin.filterKelas.getValue() : (el("filterKelasSiswa")?.value || "");
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
