import { auth, db } from "../firebase/config.js?v=fb1eddf";
import { attendanceService } from "../firebase/attendance-service.js?v=fb1eddf";
import { adminService } from "../firebase/admin-service.js?v=fb1eddf";
import { authService } from "../firebase/auth-service.js?v=fb1eddf";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { showToast, showConfirm, showCustomModal } from "../utils/ui.js?v=fb1eddf";
import { exportToPDF, exportMonthlyPDF } from "../utils/pdf-helper.js?v=fb1eddf";
import { readDraft, writeDraft, removeDraft, getKepalaSekolahCache, setKepalaSekolahCache } from "../utils/cache-utils.js?v=fb1eddf";
import { onTabSync } from "../utils/tab-sync.js?v=fb1eddf";
import { SearchableSelect, optionsFromClasses } from "../utils/searchable-select.js?v=fb1eddf";

// Registry SearchableSelect instances — diakses lintas fungsi
const ss = {
  kelas: null,       // kelasPicker
  chartKelas: null,  // chartKelasPicker
  monthKelas: null,  // monthKelasPicker
};

// === DASHBOARD LOGIC ===
let attendanceChartInstance = null;
let dashboardInitialized = false;
let authReady = false;

function getStatusDateStr() {
  return document.getElementById("statusDatePicker")?.value || null;
}

const BULAN_LABELS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function fillYearSelect(el, selectedYear) {
  if (!el) return;
  const currentYear = new Date().getFullYear();
  const year = selectedYear ?? currentYear;
  el.innerHTML = "";
  for (let y = currentYear; y >= currentYear - 5; y--) {
    el.add(new Option(String(y), String(y), false, y === year));
  }
}

function fillMonthSelect(el, selectedMonth) {
  if (!el) return;
  const currentMonth = new Date().getMonth() + 1;
  const month = selectedMonth ?? currentMonth;
  el.innerHTML = "";
  BULAN_LABELS.forEach((nama, i) => {
    const m = i + 1;
    el.add(new Option(nama, String(m), false, m === month));
  });
}

function getMonthYearFromPickers(yearId, monthId) {
  const yearEl = document.getElementById(yearId);
  const monthEl = document.getElementById(monthId);
  if (!yearEl?.value || !monthEl?.value) return null;

  const year = parseInt(yearEl.value, 10);
  const month = parseInt(monthEl.value, 10);
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const lastDay = new Date(year, month, 0).getDate();
  return {
    monthStr,
    startVal: `${monthStr}-01`,
    endVal: `${monthStr}-${String(lastDay).padStart(2, "0")}`,
  };
}

function initMonthYearPickers(yearId, monthId, onChange) {
  const yearEl = document.getElementById(yearId);
  const monthEl = document.getElementById(monthId);
  if (!yearEl || !monthEl || yearEl.dataset.initialized === "1") return;

  fillYearSelect(yearEl);
  fillMonthSelect(monthEl);
  yearEl.dataset.initialized = "1";

  if (onChange) {
    yearEl.addEventListener("change", onChange);
    monthEl.addEventListener("change", onChange);
  }
}

function getChartMonthRange() {
  const picked = getMonthYearFromPickers("chartYearPicker", "chartMonthPicker");
  if (!picked) return null;
  return { startVal: picked.startVal, endVal: picked.endVal };
}

function initChartMonthYearPickers() {
  initMonthYearPickers("chartYearPicker", "chartMonthPicker", window.loadDashboardChart);
}

function initReportMonthYearPickers() {
  initMonthYearPickers("reportYearPicker", "reportMonthPicker");
}

function mergeMasterWithReports(master, reports) {
  const merged = { ...master };
  reports.forEach((r) => {
    if (!r.siswa) return;
    Object.entries(r.siswa).forEach(([id, s]) => {
      if (!merged[id]) {
        merged[id] = {
          nama: s.nama || "Siswa",
          nis: s.nis || "-",
        };
      }
    });
  });
  return merged;
}

function tryRefreshDashboard() {
  if (!dashboardInitialized || !authReady) return;
  populateClassPickers();
  const dateStr = getStatusDateStr();
  if (dateStr) window.loadDashboardStatus(dateStr);
  window.loadDashboardChart();
}

async function populateClassPickers() {
  const pickerEl    = document.getElementById("kelasPicker");
  const chartKelasEl = document.getElementById("chartKelasPicker");
  const monthKelasEl = document.getElementById("monthKelasPicker");
  if (!pickerEl || pickerEl.dataset.loaded === "1") return;

  try {
    const classes = await adminService.getClasses(true);
    classes.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    const options = optionsFromClasses(classes);

    // kelasPicker — untuk input absensi harian
    if (!ss.kelas) {
      ss.kelas = new SearchableSelect(pickerEl, {
        placeholder: '-- Pilih Kelas --',
        onChange: () => {},
      });
    }
    ss.kelas.setOptions(options);

    // chartKelasPicker — untuk filter grafik (boleh kosong = semua kelas)
    if (chartKelasEl && !ss.chartKelas) {
      ss.chartKelas = new SearchableSelect(chartKelasEl, {
        placeholder: 'Semua Kelas',
        allowEmpty: true,
        emptyLabel: 'Semua Kelas',
        onChange: () => window.loadDashboardChart(),
      });
    }
    if (ss.chartKelas) ss.chartKelas.setOptions(options);

    // monthKelasPicker — untuk rekap bulanan (dihandle ulang di openMonthlyModal)
    if (monthKelasEl && !ss.monthKelas) {
      ss.monthKelas = new SearchableSelect(monthKelasEl, {
        placeholder: '-- Pilih Kelas --',
        onChange: () => {},
      });
    }
    if (ss.monthKelas) ss.monthKelas.setOptions(options);

    pickerEl.dataset.loaded = "1";
  } catch (e) {
    console.error("Gagal memuat daftar kelas:", e);
  }
}

window.loadDashboardStatus = async (dateStr) => {
  const listSudah = document.getElementById("listSudahAbsen");
  const listBelum = document.getElementById("listBelumAbsen");
  if (!listSudah || !listBelum) return; // Safeguard

  const countSudah = document.getElementById("countSudah");
  const countBelum = document.getElementById("countBelum");

  listSudah.innerHTML = '<span class="text-xs text-gray-400">Memuat...</span>';
  listBelum.innerHTML = '<span class="text-xs text-gray-400">Memuat...</span>';

  try {
    const [allClasses, rekapHariIni] = await Promise.all([
      adminService.getClasses(),
      attendanceService.getRekapByDate(dateStr)
    ]);

    const kelasSudah = rekapHariIni.map(r => r.kelas);
    const kelasAll = allClasses.map(c => c.id);

    const sudah = kelasAll.filter(k => kelasSudah.includes(k));
    const belum = kelasAll.filter(k => !kelasSudah.includes(k));

    countSudah.innerText = sudah.length;
    countBelum.innerText = belum.length;

    listSudah.innerHTML = sudah.length ? sudah.map(k => `<span class="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded font-medium shadow-sm text-xs">${k}</span>`).join('') : '<span class="italic text-gray-400 text-xs">Belum ada kelas yang absen</span>';
    listBelum.innerHTML = belum.length ? belum.map(k => `<span class="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 px-2 py-1 rounded font-medium shadow-sm text-xs">${k}</span>`).join('') : '<span class="italic text-gray-400 text-xs text-emerald-500">✨ Semua kelas sudah absen!</span>';
  } catch (e) {
    console.error("Gagal memuat status kelas:", e);
    listSudah.innerHTML = '<span class="text-red-500 text-xs">Error memuat</span>';
    listBelum.innerHTML = '<span class="text-red-500 text-xs">Error memuat</span>';
  }
};

window.loadDashboardChart = async () => {
  const range = getChartMonthRange();
  if (!range) return;

  const { startVal, endVal } = range;
  const selectedKelas = ss.chartKelas ? ss.chartKelas.getValue() : null;

  const canvas = document.getElementById("attendanceChart");
  if (!canvas) return; // Safeguard

  const loading = document.getElementById("chartLoadingText");
  if (loading) {
    loading.classList.remove("hidden");
    loading.classList.add("flex");
  }

  try {
    const rekaps = await attendanceService.getRekapByDateRange(startVal, endVal, selectedKelas);

    let H = 0, S = 0, I = 0, A = 0;
    let includedClasses = new Set();

    rekaps.forEach(r => {
      if (r.kelas) includedClasses.add(r.kelas);
      if (r.siswa) {
        Object.values(r.siswa).forEach(s => {
          if (s.status === 'Hadir') H++;
          else if (s.status === 'Sakit') S++;
          else if (s.status === 'Izin') I++;
          else if (s.status === 'Alpa') A++;
        });
      }
    });

    // Update Stats UI
    const elH = document.getElementById("statHadir");
    const elS = document.getElementById("statSakit");
    const elI = document.getElementById("statIzin");
    const elA = document.getElementById("statAlpa");

    if (elH) elH.innerText = H;
    if (elS) elS.innerText = S;
    if (elI) elI.innerText = I;
    if (elA) elA.innerText = A;

    // Render classes info if "Semua Kelas"
    const info = document.getElementById("chartClassesInfo");
    if (info) {
      if (!selectedKelas) {
        info.classList.remove("hidden");
        const arrKelas = Array.from(includedClasses);
        if (arrKelas.length > 0) {
          info.innerHTML = `<strong>${arrKelas.length}</strong> Kelas terekap data:<br><span class="text-indigo-500 font-medium">${arrKelas.join(', ')}</span>`;
        } else {
          info.innerHTML = `<em>Tidak ada data absensi untuk bulan ini.</em>`;
        }
      } else {
        info.classList.add("hidden");
      }
    }

    const ctx = canvas.getContext("2d");

    if (attendanceChartInstance) {
      attendanceChartInstance.destroy();
    }

    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#e2e8f0' : '#475569';
    const gridColor = isDark ? '#334155' : '#e2e8f0';

    attendanceChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Hadir', 'Sakit', 'Izin', 'Alpa'],
        datasets: [{
          label: 'Total Siswa',
          data: [H, S, I, A],
          backgroundColor: [
            'rgba(16, 185, 129, 0.8)', // Emerald
            'rgba(245, 158, 11, 0.8)', // Amber/Yellow
            'rgba(59, 130, 246, 0.8)', // Blue
            'rgba(239, 68, 68, 0.8)'   // Red
          ],
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: textColor },
            grid: { color: gridColor }
          },
          x: {
            ticks: { color: textColor },
            grid: { display: false }
          }
        }
      }
    });

  } catch (e) {
    console.error("Gagal memuat chart:", e);
    showToast("Gagal memuat statistik", "error");
  } finally {
    if (loading) {
      loading.classList.add("hidden");
      loading.classList.remove("flex");
    }
  }
};


let state = {
  localData: null,
  currentDocId: null,
  isDirty: false,
  monthlyCache: null,
  currentUser: {
    nama: "Memuat...",
    nip: "-",
    role: "viewer"
  },
  kepalaSekolah: {
    nama: "..........................",
    nip: "..........................",
  },
};

function restoreDraftForUser(uid) {
  const saved = readDraft(uid);
  if (!saved) return;

  try {
    state.localData = JSON.parse(saved);
    const picker = document.getElementById("kelasPicker");
    const datePicker = document.getElementById("datePicker");
    const statusDatePicker = document.getElementById("statusDatePicker");

    if (datePicker) datePicker.value = state.localData.tanggal;
    if (statusDatePicker) statusDatePicker.value = state.localData.tanggal;
    if (ss.kelas) ss.kelas.setValue(state.localData.kelas);
    state.currentDocId = `${state.localData.tanggal}_${state.localData.kelas}`;

    document.getElementById("tabelAbsensi")?.classList.remove("hidden");
    document.getElementById("actionButtons")?.classList.remove("hidden");
    const loadingText = document.getElementById("loadingText");
    if (loadingText) loadingText.style.display = "none";

    renderTable();
    setDirty(true);
    showToast("Draft dipulihkan", "info");
  } catch (e) {
    console.error("Failed to restore draft:", e);
    removeDraft(uid);
  }
}

let indexBootstrapped = false;

function registerIndexAuthListener() {
  onAuthStateChanged(auth, async (user) => {
  if (user) {
    console.log("🔐 Auth Detected:", user.email);
    try {
      const uData = await authService.getUserData(user.uid, true);

      if (uData) {
        state.currentUser = {
          nama: uData.nama || user.displayName || "Guru Piket",
          nip: uData.nip || "-",
          role: uData.role || "viewer"
        };
        console.log(`✅ User Role Loaded: ${state.currentUser.role}`);
      } else {
        console.warn("⚠️ Data User tidak ditemukan di Firestore, set default viewer.");
        state.currentUser.role = "viewer";
      }

      authReady = true;
      tryRefreshDashboard();

      try {
        const cachedKepsek = getKepalaSekolahCache();
        if (cachedKepsek) {
          state.kepalaSekolah = cachedKepsek;
        } else {
          const kepsekSnap = await getDoc(doc(db, "settings", "kepala_sekolah"));
          if (kepsekSnap.exists()) {
            state.kepalaSekolah = kepsekSnap.data();
            setKepalaSekolahCache(state.kepalaSekolah);
          }
        }
      } catch (kepsekError) {
        console.warn("Kepala sekolah load skipped:", kepsekError);
      }

      if (state.localData) {
        console.log("🔄 Refreshing UI Lock State...");
        handleLockState();
      } else {
        restoreDraftForUser(user.uid);
      }

    } catch (e) {
      console.error("Auth Error:", e);
      authReady = true;
      tryRefreshDashboard();
    }
  } else {
    console.log("User Logged Out");
    authReady = false;
  }
  });
}

window.exportToPDF = () => {
  if (!state.localData)
    return showToast("Data absensi belum dimuat!", "warning");

  if (!state.localData.is_locked)
    return showToast("Kunci data dulu!", "warning");

  const payload = {
    tanggal: state.localData.tanggal,
    siswa: state.localData.siswa,
    guruPiket: state.currentUser,
    kepalaSekolah: state.kepalaSekolah,
  };

  const kelasId = ss.kelas ? ss.kelas.getValue() : (document.getElementById("kelasPicker")?.value ?? "");
  exportToPDF(payload, kelasId);
};

// --- INIT ---
function bootstrapIndexPage() {
  if (indexBootstrapped) return;
  indexBootstrapped = true;

  const datePicker = document.getElementById("datePicker");
  const statusDatePicker = document.getElementById("statusDatePicker");
  const today = new Date().toLocaleDateString("en-CA");

  if (datePicker) {
    if (!datePicker.value) datePicker.value = today;
    datePicker.addEventListener("change", () => {
      if (statusDatePicker) statusDatePicker.value = datePicker.value;
      if (datePicker.value) window.loadDashboardStatus(datePicker.value);
    });
  }

  if (statusDatePicker) {
    if (!statusDatePicker.value) statusDatePicker.value = today;
    statusDatePicker.addEventListener("change", () => {
      if (statusDatePicker.value) window.loadDashboardStatus(statusDatePicker.value);
    });
  }

  initChartMonthYearPickers();
  initReportMonthYearPickers();

  // chartKelasPicker onChange sudah ditangani di SearchableSelect constructor (populateClassPickers)

  dashboardInitialized = true;

  initTabSync();

  document.getElementById("studentSearch")?.addEventListener("input", (e) => {
    const val = e.target.value.toLowerCase();
    const rows = document.querySelectorAll("#tbodySiswa tr");
    rows.forEach((row) => {
      const name = row.querySelector("span.text-base")?.innerText.toLowerCase() || "";
      const nis = row.querySelector("span.font-black")?.innerText.toLowerCase() || "";
      const matches = name.includes(val) || nis.includes(val);
      if (matches) {
        row.classList.remove("hidden");
        row.style.display = "";
      } else {
        row.classList.add("hidden");
        row.style.display = "none";
      }
    });
  });

  const btnLock = document.getElementById("btnLock");
  if (btnLock && !btnLock.dataset.bound) {
    btnLock.dataset.bound = "1";
    btnLock.onclick = () => {
      if (!state.localData || !state.currentDocId) return;
      if (state.isDirty) return showToast("Simpan perubahan dulu!", "warning");
      showConfirm("Kunci data permanen?", async () => {
        await attendanceService.lockRekap(state.currentDocId);
        state.localData.is_locked = true;
        state.monthlyCache = null;
        handleLockState();
        showToast("Data terkunci", "success");
      });
    };
  }

  registerIndexAuthListener();
}

bootstrapIndexPage();

function initTabSync() {
  onTabSync(({ type, payload }) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    if (type === 'draft:changed' && payload.uid === uid) {
      if (!payload.docId || payload.docId !== state.currentDocId) return;
      const saved = readDraft(uid);
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved);
        if (state.isDirty) {
          showToast('Draft diperbarui di tab lain', 'info');
          return;
        }
        state.localData = parsed;
        renderTable();
        handleLockState();
      } catch (e) {
        console.warn('Tab sync draft error:', e);
      }
    }

    if (type === 'rekap:updated' && payload.docId === state.currentDocId && !state.isDirty) {
      window.loadRekapData(true);
    }

    if (type === 'sync:completed' && payload.docId === state.currentDocId) {
      const dateStr = getStatusDateStr();
      if (dateStr) window.loadDashboardStatus(dateStr);
      window.loadDashboardChart();
    }
  });
}

// --- LOGIC UTAMA ---
window.loadRekapData = async (forceRefresh = false) => {
  const datePicker = document.getElementById("datePicker");
  if (!datePicker) return;
  const tgl = datePicker.value;
  const kls = ss.kelas ? ss.kelas.getValue() : (document.getElementById("kelasPicker")?.value ?? "");
  if (!tgl || !kls) return showToast("Pilih Tanggal & Kelas!", "warning");

  // Cek apakah hari libur (Sabtu/Minggu)
  const [y, m, d] = tgl.split("-");
  const dateObj = new Date(y, m - 1, d);
  const day = dateObj.getDay();
  if (day === 0 || day === 6) {
    const namaHari = dateObj.toLocaleDateString("id-ID", { weekday: "long" });
    showToast(`Perhatian: Hari ini adalah hari ${namaHari}.`, "info");
  }

  const newDocId = `${tgl}_${kls}`;
  if (state.localData && state.currentDocId === newDocId && !forceRefresh) return;
  state.currentDocId = newDocId;
  const loading = document.getElementById("loadingText");
  const tabelAbsensi = document.getElementById("tabelAbsensi");
  if (loading) { loading.style.display = "block"; loading.innerText = "⏳ Mengambil data..."; }
  if (tabelAbsensi) tabelAbsensi.classList.add("hidden");
  try {
    if (forceRefresh || !(state.isDirty && state.localData?.tanggal === tgl && state.localData?.kelas === kls)) {
      let data = await attendanceService.getRekap(state.currentDocId, forceRefresh);
      if (!data) {
        const master = await attendanceService.getMasterSiswa(kls, forceRefresh);
        if (!Object.keys(master).length) throw new Error("Kelas Kosong / Belum ada Siswa");
        data = { tanggal: tgl, kelas: kls, siswa: master, is_locked: false };
        showToast("Lembar absensi baru dibuat", "info");
      }
      state.localData = data;
      state.isDirty = false; // Reset dirty saat load baru
    }
    if (loading) loading.style.display = "none";
    if (tabelAbsensi) tabelAbsensi.classList.remove("hidden");
    document.getElementById("actionButtons")?.classList.remove("hidden");
    document.getElementById("searchContainer")?.classList.remove("hidden");
    document.getElementById("tableLegend")?.classList.remove("hidden");

    // Reset Search
    const searchInp = document.getElementById("studentSearch");
    if (searchInp) searchInp.value = "";

    renderTable();
    handleLockState(); // Cek status kunci
    if (forceRefresh) showToast("Data berhasil diperbarui!", "success");
  } catch (e) {
    if (loading) loading.innerText = "Error: " + e.message;
    showToast(e.message, "error");
  }
};

function renderTable() {
  const tbody = document.getElementById("tbodySiswa");
  if (!tbody || !state.localData) return;

  const { siswa } = state.localData;
  tbody.innerHTML = Object.keys(siswa)
    .sort((a, b) => siswa[a].nama.localeCompare(siswa[b].nama))
    .map((id) => {
      const s = siswa[id];
      const ketBadge =
        s.keterangan && s.keterangan !== "-"
          ? `<div class="siswa-ket mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 border border-amber-100 dark:border-amber-800/50 w-fit">
                    <i data-lucide="message-square" class="w-3 h-3"></i> <span class="siswa-ket-text"></span>
                   </div>`
          : `<div class="siswa-ket hidden"></div>`;

      return `
            <tr data-siswa-id="${id}" class="group hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-all duration-200">
                <td class="p-3 md:p-5">
                    <div class="flex flex-col">
                        <span class="text-[10px] font-black text-indigo-500 dark:text-indigo-400 mb-0.5 tracking-tighter">${s.nis || "-"}</span>
                        <span class="font-bold text-gray-800 dark:text-white text-sm md:text-lg tracking-tight group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">${s.nama}</span>
                        ${ketBadge}
                    </div>
                </td>
                <td class="p-3 md:p-5">
                    <div class="flex flex-wrap gap-1.5 sm:gap-2">
                        ${["Hadir", "Sakit", "Izin", "Alpa"]
          .map(
            (st) => `
                                <button type="button" data-status-btn="${st}" onclick="updateStatus('${id}', '${st}')" 
                                    class="px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest border shadow-sm transition-all transform active:scale-90 flex items-center gap-1 sm:gap-1.5 
                                    ${s.status === st
                ? _getModernColor(st)
                : "bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 text-gray-400 hover:border-gray-300 dark:hover:border-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              }">
                                    <span class="status-check">${st === "Hadir" && s.status === "Hadir"
                ? '<i data-lucide="check" class="w-3 h-3"></i>'
                : ""
              }</span>
                                    ${st}
                                </button>
                            `
          )
          .join("")}
                    </div>
                </td>
            </tr>`;
    })
    .join("");

  tbody.querySelectorAll("tr[data-siswa-id]").forEach((row) => {
    const sid = row.getAttribute("data-siswa-id");
    const ketText = row.querySelector(".siswa-ket-text");
    if (ketText && siswa[sid]?.keterangan && siswa[sid].keterangan !== "-") {
      ketText.textContent = siswa[sid].keterangan;
    }
  });

  if (window.lucide) window.lucide.createIcons({ root: tbody });
}

function _inactiveStatusClass() {
  return "bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 text-gray-400 hover:border-gray-300 dark:hover:border-gray-500 hover:text-gray-600 dark:hover:text-gray-300";
}

function patchSiswaRow(id) {
  const s = state.localData?.siswa?.[id];
  if (!s) return;

  const row = document.querySelector(`#tbodySiswa tr[data-siswa-id="${CSS.escape(id)}"]`);
  if (!row) {
    renderTable();
    return;
  }

  const baseBtn =
    "px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest border shadow-sm transition-all transform active:scale-90 flex items-center gap-1 sm:gap-1.5";

  row.querySelectorAll("[data-status-btn]").forEach((btn) => {
    const st = btn.getAttribute("data-status-btn");
    const active = s.status === st;
    btn.className = `${baseBtn} ${active ? _getModernColor(st) : _inactiveStatusClass()}`;
    const check = btn.querySelector(".status-check");
    if (check) {
      check.innerHTML = st === "Hadir" && active ? '<i data-lucide="check" class="w-3 h-3"></i>' : "";
    }
  });

  let ketEl = row.querySelector(".siswa-ket");
  const nameCell = row.querySelector("td .flex.flex-col");
  if (s.keterangan && s.keterangan !== "-") {
    if (!ketEl || ketEl.classList.contains("hidden")) {
      if (ketEl) ketEl.remove();
      const badge = document.createElement("div");
      badge.className =
        "siswa-ket mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 border border-amber-100 dark:border-amber-800/50 w-fit";
      badge.innerHTML = '<i data-lucide="message-square" class="w-3 h-3"></i> <span class="siswa-ket-text"></span>';
      nameCell?.appendChild(badge);
      ketEl = badge;
    }
    const text = ketEl.querySelector(".siswa-ket-text");
    if (text) text.textContent = s.keterangan;
    ketEl.classList.remove("hidden");
  } else if (ketEl) {
    ketEl.remove();
  }

  if (window.lucide) window.lucide.createIcons({ root: row });
}

function _getModernColor(st) {
  const c = {
    Hadir: "bg-emerald-600 text-white border-emerald-700 ring-4 ring-emerald-500/10",
    Sakit: "bg-amber-500 text-white border-amber-600 ring-4 ring-amber-500/10",
    Izin: "bg-blue-600 text-white border-blue-700 ring-4 ring-blue-500/10",
    Alpa: "bg-red-600 text-white border-red-700 ring-4 ring-red-500/10",
  };
  return c[st];
}

window.updateStatus = (id, newStatus) => {
  if (!state.localData) return;
  if (state.localData.is_locked) return showToast("Data terkunci!", "warning");

  const s = state.localData.siswa[id];
  if (!s) return;

  const executeUpdate = (ket = "-") => {
    s.status = newStatus;
    s.keterangan = ket;
    setDirty(true);
    patchSiswaRow(id);
    if (auth.currentUser?.uid) writeDraft(auth.currentUser.uid, state.localData);
  };

  if (["Sakit", "Izin", "Alpa"].includes(newStatus)) {
    const oldKet = s.keterangan !== "-" ? s.keterangan : "";

    const htmlContent = `
            <div class="space-y-3 text-left">
                <div class="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg text-xs text-blue-700 dark:text-blue-300 flex gap-2">
                    <i data-lucide="info" class="w-4 h-4 shrink-0"></i>
                    <span>Masukkan alasan untuk status <strong>${newStatus}</strong>.</span>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Keterangan / Alasan</label>
                    <textarea id="input-keterangan" rows="3" 
                        class="w-full rounded-lg border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white p-3 focus:ring-blue-500 focus:border-blue-500 text-sm" 
                        placeholder="Contoh: Demam tinggi, Acara keluarga, Tanpa keterangan...">${oldKet}</textarea>
                </div>
            </div>
        `;

    showCustomModal(`Update Status: ${newStatus}`, htmlContent, () => {
      const val = document.getElementById("input-keterangan")?.value.trim();
      executeUpdate(val || "-");
    });

    setTimeout(() => lucide.createIcons(), 50);
  } else {
    executeUpdate("-");
  }
};

window.saveDataToFirestore = () => {
  if (!state.localData) return;
  
  const [yS, mS, dS] = state.localData.tanggal.split("-");
  const dateObj = new Date(yS, mS - 1, dS);
  const day = dateObj.getDay();
  const namaHari = dateObj.toLocaleDateString("id-ID", { weekday: "long" });

  const _saveProcess = async () => {
    const btn = document.getElementById("btnSave");
    if (!btn || !state.localData || !state.currentDocId) return;

    try {
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Saving...`;
      if (window.lucide) window.lucide.createIcons({ root: btn });
      btn.disabled = true;

      await attendanceService.saveRekap(state.currentDocId, state.localData);

      showToast("Data berhasil disimpan!", "success");
      setDirty(false);

      // Reload dashboard class status because of fresh save
      const statusDatePicker = document.getElementById("statusDatePicker");
      const dateStr = getStatusDateStr();
      if (dateStr) window.loadDashboardStatus(dateStr);
      window.loadDashboardChart();

      state.monthlyCache = null;

    } catch (e) {
      showToast(e.message, "error");
    } finally {
      btn.innerHTML = `<i data-lucide="save" class="w-5 h-5"></i> SIMPAN`;
      btn.disabled = false;
      if (window.lucide) window.lucide.createIcons({ root: btn });
    }
  };

  if (day === 0 || day === 6) {
    showConfirm(
      "Absensi Hari Libur",
      async () => {
        await _saveProcess();
      },
      `Hari ini adalah hari ${namaHari}. Apakah Anda yakin ingin tetap menyimpan data absensi ini?`
    );
  } else {
    _saveProcess();
  }
};

function setDirty(val) {
  state.isDirty = val;
  const unsavedMsg = document.getElementById("unsavedMsg");
  if (unsavedMsg) unsavedMsg.classList.toggle("hidden", !val);
}

function handleLockState() {
  // Jika belum ada data absensi, tidak perlu cek kunci
  if (!state.localData) return;

  const isLocked = state.localData.is_locked;

  // Cek Weekend
  const [yW, mW, dW] = state.localData.tanggal.split("-");
  const dateObj = new Date(yW, mW - 1, dW);
  const day = dateObj.getDay();
  const isWeekend = (day === 0 || day === 6);

  const btnSave = document.getElementById("btnSave");
  const btnLock = document.getElementById("btnLock");
  const btnUnlock = document.getElementById("btnUnlock");
  const btnPdf = document.getElementById("btnExport");
  const lockedMsg = document.getElementById("lockedMessage");

  // Tampilkan Pesan Terkunci / Weekend
  if (lockedMsg) {
    if (isWeekend) {
      lockedMsg.classList.remove("hidden");
      lockedMsg.innerHTML = `<div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 rounded-xl flex items-center gap-3 text-amber-700 dark:text-amber-300 shadow-sm">
                        <i data-lucide="info" class="w-6 h-6"></i>
                        <div class="text-sm">
                            <p class="font-bold">Hari Libur</p>
                            <p class="opacity-80">Tidak ada jadwal absensi pada hari Sabtu dan Minggu.</p>
                        </div>
                    </div>`;
      if (window.lucide) window.lucide.createIcons({ root: lockedMsg });
    } else {
      lockedMsg.classList.toggle("hidden", !isLocked);
      lockedMsg.innerHTML = `<div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 rounded-xl flex items-center gap-3 text-amber-700 dark:text-amber-300 shadow-sm">
                        <i data-lucide="lock" class="w-6 h-6"></i>
                        <div class="text-sm">
                            <p class="font-bold">Data Terkunci</p>
                            <p class="opacity-80">Data sudah dipatenkan dan tidak dapat diubah lagi oleh guru piket.</p>
                        </div>
                    </div>`;
      if (window.lucide) window.lucide.createIcons({ root: lockedMsg });
    }
  }

  // Logika Hak Akses (Guru/Admin vs Orang Tua/Viewer)
  const myRole = state.currentUser.role;
  const canEdit = ['admin', 'super_admin', 'guru'].includes(myRole);

  // 1. Logika Tombol SIMPAN & KUNCI
  if (btnSave) btnSave.style.display = (isLocked || !canEdit) ? "none" : "flex";
  if (btnLock) btnLock.style.display = (isLocked || !canEdit) ? "none" : "flex";

  // 2. Logika Tombol BUKA KUNCI (Super Admin & Admin Only)
  if (btnUnlock) {
    const myRole = state.currentUser.role;
    const isAuthorized = ['admin', 'super_admin'].includes(myRole);

    // LOG DEBUGGING PENTING (Cek Console F12)
    console.log(`🔍 DEBUG LOCK: Locked=${isLocked} | Role=${myRole} | Allow=${isAuthorized}`);

    if (isLocked && isAuthorized) {
      btnUnlock.style.display = "flex"; // TAMPILKAN
      btnUnlock.onclick = () => {
        showConfirm("Buka Kunci Data? Guru akan bisa mengedit kembali.", async () => {
          try {
            await attendanceService.unlockRekap(state.currentDocId);
            state.localData.is_locked = false;
            handleLockState();
            showToast("Data berhasil dibuka kembali", "success");
          } catch (e) {
            showToast("Gagal: " + e.message, "error");
          }
        });
      };
    } else {
      btnUnlock.style.display = "none";
    }
  } else {
    console.error("HTML Error: Button id='btnUnlock' tidak ditemukan!");
  }

  // 3. Logika Tombol PDF
  if (btnPdf) {
    if (isLocked) {
      btnPdf.classList.remove("opacity-50", "cursor-not-allowed");
      btnPdf.disabled = false;
    } else {
      btnPdf.classList.add("opacity-50", "cursor-not-allowed");
      btnPdf.disabled = true;
    }
  }
}

// --- MONTHLY REPORT ---
window.openMonthlyModal = () => {
  const modal = document.getElementById("modalMonthly");
  const monthKelasEl = document.getElementById("monthKelasPicker");
  const reportYear = document.getElementById("reportYearPicker");
  const chartYear = document.getElementById("chartYearPicker");
  const chartMonth = document.getElementById("chartMonthPicker");
  const reportMonth = document.getElementById("reportMonthPicker");

  if (!modal) return;

  if (!reportYear?.dataset.initialized) initReportMonthYearPickers();

  // Inisialisasi atau update SearchableSelect untuk monthKelasPicker
  if (monthKelasEl) {
    const currentVal = ss.kelas?.getValue() || "";

    if (!ss.monthKelas) {
      ss.monthKelas = new SearchableSelect(monthKelasEl, {
        placeholder: '-- Pilih Kelas --',
        onChange: () => {},
      });
    }

    if (ss.kelas && document.getElementById("kelasPicker")?.dataset.loaded === "1") {
      // Salin options dari ss.kelas (sudah ada, reuse)
      ss.monthKelas.setOptions(ss.kelas._options);
      if (currentVal) ss.monthKelas.setValue(currentVal);
    } else {
      // Fetch langsung jika ss.kelas belum siap
      adminService.getClasses(true).then(classes => {
        classes.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
        ss.monthKelas.setOptions(optionsFromClasses(classes));
        if (window.lucide) window.lucide.createIcons();
      }).catch(e => console.error("Gagal memuat kelas rekap bulanan:", e));
    }
  }

  if (chartYear?.value && chartMonth?.value && reportYear && reportMonth) {
    reportYear.value = chartYear.value;
    reportMonth.value = chartMonth.value;
  }

  modal.classList.remove("hidden");
  if (window.lucide) window.lucide.createIcons();
};

window.closeMonthlyModal = () => {
  const modal = document.getElementById("modalMonthly");
  if (modal) modal.classList.add("hidden");
};

window.loadMonthlyReport = async () => {
  const tbody = document.getElementById("tbodyBulanan");
  const picked = getMonthYearFromPickers("reportYearPicker", "reportMonthPicker");

  if (!tbody) return;

  const kls = ss.monthKelas ? ss.monthKelas.getValue() : (document.getElementById("monthKelasPicker")?.value ?? "");
  const month = picked?.monthStr;

  if (!kls || !month) return showToast("Pilih kelas, bulan, dan tahun!", "warning");

  tbody.innerHTML = `
    <tr>
        <td colspan="40" class="p-20 text-center">
            <div class="flex flex-col items-center gap-4">
                <div class="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                <div class="flex flex-col gap-1">
                    <p class="text-sm font-black text-gray-900 dark:text-white uppercase tracking-widest">Menyusun Laporan</p>
                    <p class="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Mohon tunggu sejenak...</p>
                </div>
            </div>
        </td>
    </tr>`;

  const btnPrint = document.getElementById("btnPrintMonthly");
  if (btnPrint) btnPrint.style.display = "none";

  try {
    const [masterRaw, reports] = await Promise.all([
      attendanceService.getMasterSiswa(kls, false),
      attendanceService.getMonthlyReport(kls, month, false),
    ]);

    const master = mergeMasterWithReports(masterRaw, reports);
    state.monthlyCache = { master, reports, monthStr: month, kelas: kls };

    const [year, monthNum] = month.split("-").map(Number);
    const days = new Date(year, monthNum, 0).getDate();

    const headerRow = document.getElementById("headerRowBulanan");
    if (headerRow) {
      let headHtml =
        '<th class="p-3 sm:p-4 sticky left-0 bg-gray-50 dark:bg-gray-800 z-30 border-b border-r dark:border-gray-700 w-[120px] sm:w-[200px] text-left text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400">Nama Siswa</th>';
      for (let i = 1; i <= days; i++) {
        headHtml += `<th class="p-1 sm:p-2 text-center min-w-[28px] sm:min-w-[35px] border-b border-r dark:border-gray-700 text-[8px] sm:text-[9px] font-bold text-gray-400">${i}</th>`;
      }
      headHtml += `
            <th class="p-1 sm:p-2 border-b border-r bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-[9px] sm:text-[10px] font-black">H</th>
            <th class="p-1 sm:p-2 border-b border-r bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-[9px] sm:text-[10px] font-black">S</th>
            <th class="p-1 sm:p-2 border-b border-r bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 text-[9px] sm:text-[10px] font-black">I</th>
            <th class="p-1 sm:p-2 border-b bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-[9px] sm:text-[10px] font-black">A</th>
        `;
      headerRow.innerHTML = headHtml;
    }

    let map = {};
    Object.keys(master).forEach((id) => {
      map[id] = Array.from({ length: days + 1 }, () => ({
        status: "-",
        keterangan: "-",
      }));
    });

    reports.forEach((r) => {
      const d = parseInt(r.tanggal.split("-")[2]);
      if (r.siswa) {
        Object.keys(r.siswa).forEach((id) => {
          if (map[id]) {
            map[id][d] = {
              status: r.siswa[id].status || "-",
              keterangan: r.siswa[id].keterangan || "-",
            };
          }
        });
      }
    });

    const ids = Object.keys(master).sort((a, b) => master[a].nama.localeCompare(master[b].nama));
    const statusBadge = {
      Hadir: '<div class="w-3.5 h-3.5 sm:w-5 sm:h-5 rounded-full bg-emerald-500 text-white text-[7px] sm:text-[9px] font-black flex items-center justify-center mx-auto shadow-sm">H</div>',
      Sakit: '<div class="w-3.5 h-3.5 sm:w-5 sm:h-5 rounded-full bg-amber-500 text-white text-[7px] sm:text-[9px] font-black flex items-center justify-center mx-auto shadow-sm">S</div>',
      Izin: '<div class="w-3.5 h-3.5 sm:w-5 sm:h-5 rounded-full bg-blue-500 text-white text-[7px] sm:text-[9px] font-black flex items-center justify-center mx-auto shadow-sm">I</div>',
      Alpa: '<div class="w-3.5 h-3.5 sm:w-5 sm:h-5 rounded-full bg-red-500 text-white text-[7px] sm:text-[9px] font-black flex items-center justify-center mx-auto shadow-sm">A</div>',
      "-": '<div class="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 mx-auto"></div>',
    };

    const buildRowHtml = (id) => {
      let rowHtml = `<td class="p-1.5 sm:p-2 font-medium sticky left-0 bg-white dark:bg-darkcard border-r border-b dark:border-gray-700 z-20 shadow-sm text-[10px] sm:text-sm w-[120px] sm:w-[200px] break-words leading-tight"></td>`;
      let st = { H: 0, S: 0, I: 0, A: 0 };

      for (let i = 1; i <= days; i++) {
        const dataHari = map[id][i];
        const s = dataHari.status;

        if (s === "Hadir") st.H++;
        else if (s === "Sakit") st.S++;
        else if (s === "Izin") st.I++;
        else if (s === "Alpa") st.A++;

        const badge = statusBadge[s] || '<div class="w-1 h-1 rounded-full bg-gray-100 mx-auto"></div>';
        const title =
          dataHari.keterangan !== "-"
            ? `Tgl ${i}: ${dataHari.keterangan}`
            : "";
        rowHtml += `<td class="p-0.5 sm:p-1 text-center border-b border-r dark:border-gray-800 bg-white dark:bg-darkcard h-8 sm:h-10 cursor-default hover:bg-indigo-50/50 transition-colors" title="${title.replace(/"/g, "&quot;")}">${badge}</td>`;
      }

      return {
        html: `
                <tr class="hover:bg-indigo-50/20 dark:hover:bg-indigo-900/10 transition-colors">
                    ${rowHtml}
                    <td class="text-center font-black text-[10px] text-emerald-600 border-b border-r bg-emerald-50/30 dark:bg-emerald-900/5">${st.H}</td>
                    <td class="text-center font-black text-[10px] text-amber-600 border-b border-r bg-amber-50/30 dark:bg-amber-900/5">${st.S}</td>
                    <td class="text-center font-black text-[10px] text-blue-600 border-b border-r bg-blue-50/30 dark:bg-blue-900/5">${st.I}</td>
                    <td class="text-center font-black text-[10px] text-red-600 border-b bg-red-50/30 dark:bg-red-900/5">${st.A}</td>
                </tr>`,
        nama: master[id].nama,
      };
    };

    tbody.innerHTML = "";
    const CHUNK = 20;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const parts = chunk.map((id) => buildRowHtml(id));
      tbody.insertAdjacentHTML("beforeend", parts.map((p) => p.html).join(""));
      const rows = tbody.querySelectorAll("tr");
      parts.forEach((part, offset) => {
        const row = rows[i + offset];
        const nameCell = row?.querySelector("td");
        if (nameCell) {
          nameCell.textContent = part.nama;
          nameCell.title = part.nama;
        }
      });
      if (i + CHUNK < ids.length) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }

    if (btnPrint) btnPrint.style.display = "flex";

    showToast("Data monthly berhasil dimuat", "success");
  } catch (e) {
    console.error("Monthly Load Error:", e);
    tbody.innerHTML = `<tr><td colspan="40" class="p-4 text-center text-red-500"> ${e.message}</td></tr>`;
    showToast("Gagal memuat data monthly", "error");
  }
};

window.printMonthlyData = () => {
  const picked = getMonthYearFromPickers("reportYearPicker", "reportMonthPicker");
  if (!picked) return showToast("Pilih periode dan kelas!", "warning");

  const kls = ss.monthKelas ? ss.monthKelas.getValue() : (document.getElementById("monthKelasPicker")?.value ?? "");
  if (!kls) return showToast("Pilih kelas!", "warning");

  if (
    !state.monthlyCache?.master ||
    state.monthlyCache.monthStr !== picked.monthStr ||
    state.monthlyCache.kelas !== kls
  ) {
    return showToast("Data tidak sinkron. Klik Tampilkan dulu.", "warning");
  }

  exportMonthlyPDF(
    state.monthlyCache.master,
    state.monthlyCache.reports,
    state.monthlyCache.monthStr,
    kls,
    {
      guruPiket: state.currentUser,
      kepalaSekolah: state.kepalaSekolah,
    }
  );
};
