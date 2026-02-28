import { auth, db } from "../firebase/config.js";
import { attendanceService } from "../firebase/attendance-service.js";
import { adminService } from "../firebase/admin-service.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { showToast, showConfirm, showCustomModal } from "../utils/ui.js";
import { exportToPDF, exportMonthlyPDF } from "../utils/pdf-helper.js";

// === DASHBOARD LOGIC ===
let attendanceChartInstance = null;

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
  const rangeInp = document.getElementById("chartDateRange");
  const kelasInp = document.getElementById("chartKelasPicker");

  if (!rangeInp || !rangeInp.value) return;

  // split by default Flatpickr range separator " - " (if using localized separator, it might differ but default is " to " but we use altFormat which is visually " to " or " - " let's fetch value from db format YYYY-MM-DD -> raw value not altValue)
  const rangeRaw = rangeInp._flatpickr ? rangeInp._flatpickr.selectedDates : [];
  if (rangeRaw.length !== 2) return;

  // Format to standard YYYY-MM-DD for backend
  const startVal = flatpickr.formatDate(rangeRaw[0], "Y-m-d");
  const endVal = flatpickr.formatDate(rangeRaw[1], "Y-m-d");

  const selectedKelas = kelasInp && kelasInp.value ? kelasInp.value : null;

  const canvas = document.getElementById("attendanceChart");
  if (!canvas) return; // Safeguard

  const loading = document.getElementById("chartLoadingText");
  if (loading) loading.classList.remove("hidden");

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
          info.innerHTML = `<em>Tidak ada data absensi untuk rentang tanggal ini.</em>`;
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
    if (loading) loading.classList.add("hidden");
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

onAuthStateChanged(auth, async (user) => {
  if (user) {
    console.log("🔐 Auth Detected:", user.email);
    try {
      const [userSnap, kepsekSnap] = await Promise.all([
        getDoc(doc(db, "users", user.uid)),
        getDoc(doc(db, "settings", "kepala_sekolah")),
      ]);

      // Set Role
      if (userSnap.exists()) {
        const uData = userSnap.data();
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

      // Set Kepsek
      if (kepsekSnap.exists()) {
        state.kepalaSekolah = kepsekSnap.data();
      }

      // Refresh UI jika data absensi sudah terbuka
      if (state.localData) {
        console.log("🔄 Refreshing UI Lock State...");
        handleLockState();
      }

    } catch (e) {
      console.error("Auth Error:", e);
    }
  } else {
    console.log("User Logged Out");
  }
});

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

  const kelasId = document.getElementById("kelasPicker")?.value;
  exportToPDF(payload, kelasId);
};

// --- INIT ---
(async () => {
  const datePicker = document.getElementById("datePicker");
  const picker = document.getElementById("kelasPicker");

  const todayStr = new Date().toLocaleDateString('en-CA'); // 'YYYY-MM-DD' w/ local parsing fallback

  const flatpickrConfig = {
    locale: "id",
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "d M Y",
    defaultDate: "today"
  };

  if (datePicker) {
    const fpMain = flatpickr(datePicker, {
      ...flatpickrConfig,
      onChange: function (selectedDates, dateStr, instance) {
        if (dateStr) {
          const statusDatePicker = document.getElementById("statusDatePicker");
          if (statusDatePicker && statusDatePicker._flatpickr) {
            statusDatePicker._flatpickr.setDate(dateStr, false); // false = jangan trigger event
          }
          window.loadDashboardStatus(dateStr);
        }
      }
    });
  }

  // Dashboard Status Date Picker
  const statusDatePicker = document.getElementById("statusDatePicker");
  if (statusDatePicker) {
    const fpStatus = flatpickr(statusDatePicker, {
      ...flatpickrConfig,
      onChange: function (selectedDates, dateStr, instance) {
        if (dateStr) {
          window.loadDashboardStatus(dateStr);
        }
      }
    });
  }

  // Dashboard Chart Init
  const cRange = document.getElementById("chartDateRange");

  if (cRange) {
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);

    const fpChartRange = flatpickr(cRange, {
      ...flatpickrConfig,
      mode: "range",
      showMonths: window.innerWidth > 768 ? 2 : 1,
      defaultDate: [lastWeek, todayStr],
      onChange: function (selectedDates) {
        if (selectedDates.length === 2) window.loadDashboardChart();
      }
    });
  }

  if (picker) {
    try {
      const classes = await adminService.getClasses();
      classes
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
        .forEach((c) => {
          picker.add(new Option(c.id, c.id));
          const chartKelas = document.getElementById("chartKelasPicker");
          if (chartKelas) chartKelas.add(new Option(c.id, c.id));
        });
    } catch (e) {
      console.error(e);
    }
  }

  const chartKelasInp = document.getElementById("chartKelasPicker");
  if (chartKelasInp) {
    chartKelasInp.addEventListener('change', window.loadDashboardChart);
  }

  const saved = localStorage.getItem("absensi_draft");
  if (saved) {
    try {
      state.localData = JSON.parse(saved);
      if (datePicker) datePicker.value = state.localData.tanggal;
      if (picker) picker.value = state.localData.kelas;
      state.currentDocId = `${state.localData.tanggal}_${state.localData.kelas}`;

      const tabelAbsensi = document.getElementById("tabelAbsensi");
      const actionButtons = document.getElementById("actionButtons");
      const loadingText = document.getElementById("loadingText");

      if (tabelAbsensi) tabelAbsensi.classList.remove("hidden");
      if (actionButtons) actionButtons.classList.remove("hidden");
      if (loadingText) loadingText.style.display = "none";

      renderTable();
      setDirty(true);
      showToast("Draft dipulihkan", "info");
    } catch (e) {
      console.error("Failed to restore draft:", e);
      localStorage.removeItem("absensi_draft");
    }
  }

  // First Load Dashboard Status & Chart
  setTimeout(() => {
    const statusDatePicker = document.getElementById("statusDatePicker");
    if (statusDatePicker && statusDatePicker.value) window.loadDashboardStatus(statusDatePicker.value);

    // Auto-load if we have a range date
    const cRange = document.getElementById("chartDateRange");
    if (cRange && cRange.value) window.loadDashboardChart();
  }, 500);

})();

// --- LOGIC UTAMA ---
window.loadRekapData = async () => {
  const datePicker = document.getElementById("datePicker");
  const kelasPicker = document.getElementById("kelasPicker");
  if (!datePicker || !kelasPicker) return;
  const tgl = datePicker.value;
  const kls = kelasPicker.value;
  if (!tgl || !kls) return showToast("Pilih Tanggal & Kelas!", "warning");
  const newDocId = `${tgl}_${kls}`;
  if (state.localData && state.currentDocId === newDocId) return;
  state.currentDocId = newDocId;
  const loading = document.getElementById("loadingText");
  const tabelAbsensi = document.getElementById("tabelAbsensi");
  if (loading) { loading.style.display = "block"; loading.innerText = "⏳ Mengambil data..."; }
  if (tabelAbsensi) tabelAbsensi.classList.add("hidden");
  try {
    if (!(state.isDirty && state.localData?.tanggal === tgl && state.localData?.kelas === kls)) {
      let data = await attendanceService.getRekap(state.currentDocId);
      if (!data) {
        const master = await attendanceService.getMasterSiswa(kls);
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

    renderTable();
    handleLockState(); // Cek status kunci
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
          ? `<span class="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
                    <i data-lucide="sticky-note" class="w-3 h-3"></i> ${s.keterangan}
                   </span>`
          : "";

      return `
            <tr class="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition group">
                <td class="p-4 align-top">
                    <div class="font-bold text-gray-800 dark:text-gray-200">${s.nama
        }</div>
                    <div class="text-xs text-gray-500 font-mono">${s.nis || "-"
        }</div>
                    ${ketBadge}
                </td>
                <td class="p-4 align-top">
                    <div class="flex flex-wrap gap-2">
                        ${["Hadir", "Sakit", "Izin", "Alpa"]
          .map(
            (st) => `
                                <button onclick="updateStatus('${id}', '${st}')" 
                                    class="px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm transition-all transform active:scale-95 flex items-center gap-1 
                                    ${s.status === st
                ? _getColor(st)
                : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-600 dark:hover:text-gray-200"
              }">
                                    ${st === "Hadir" && s.status === "Hadir"
                ? '<i data-lucide="check" class="w-3 h-3"></i>'
                : ""
              } 
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

  if (window.lucide) window.lucide.createIcons({ root: tbody });
}

function _getColor(st) {
  const c = {
    Hadir:
      "bg-green-600 text-white border-green-700 ring-2 ring-green-200 dark:ring-green-900",
    Sakit:
      "bg-yellow-500 text-white border-yellow-600 ring-2 ring-yellow-200 dark:ring-yellow-900",
    Izin: "bg-blue-600 text-white border-blue-700 ring-2 ring-blue-200 dark:ring-blue-900",
    Alpa: "bg-red-600 text-white border-red-700 ring-2 ring-red-200 dark:ring-red-900",
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
    renderTable();
    localStorage.setItem("absensi_draft", JSON.stringify(state.localData));
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

window.saveDataToFirestore = () =>
  showConfirm("Simpan data ke server?", async () => {
    const btn = document.getElementById("btnSave");
    if (!btn || !state.localData || !state.currentDocId) return;

    try {
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Saving...`;
      if (window.lucide) window.lucide.createIcons({ root: btn });
      btn.disabled = true;

      // PENTING: Pass data kelas untuk invalidate monthly cache
      await attendanceService.saveRekap(state.currentDocId, state.localData);

      showToast("Data berhasil disimpan!", "success");
      setDirty(false);

      // Reload dashboard class status because of fresh save
      const statusDatePicker = document.getElementById("statusDatePicker");
      if (statusDatePicker && statusDatePicker.value) {
        window.loadDashboardStatus(statusDatePicker.value);
      }
      window.loadDashboardChart();

      // Clear monthly cache state (force reload next time)
      state.monthlyCache = null;

    } catch (e) {
      showToast(e.message, "error");
    } finally {
      btn.innerHTML = `<i data-lucide="save" class="w-5 h-5"></i> SIMPAN`;
      btn.disabled = false;
      if (window.lucide) window.lucide.createIcons({ root: btn });
    }
  });

function setDirty(val) {
  state.isDirty = val;
  const unsavedMsg = document.getElementById("unsavedMsg");
  if (unsavedMsg) unsavedMsg.classList.toggle("hidden", !val);
}

function handleLockState() {
  // Jika belum ada data absensi, tidak perlu cek kunci
  if (!state.localData) return;

  const isLocked = state.localData.is_locked;

  const btnSave = document.getElementById("btnSave");
  const btnLock = document.getElementById("btnLock");
  const btnUnlock = document.getElementById("btnUnlock");
  const btnPdf = document.getElementById("btnExport");
  const lockedMsg = document.getElementById("lockedMessage");

  // Tampilkan Pesan Terkunci
  if (lockedMsg) lockedMsg.classList.toggle("hidden", !isLocked);

  // 1. Logika Tombol SIMPAN & KUNCI
  if (btnSave) btnSave.style.display = isLocked ? "none" : "flex";
  if (btnLock) btnLock.style.display = isLocked ? "none" : "flex";

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

const btnUnlock = document.getElementById("btnUnlock");
if (btnUnlock) {
  btnUnlock.onclick = () => {
    showConfirm("Buka Kunci Data? Guru akan bisa mengedit kembali.", async () => {
      try {
        await attendanceService.unlockRekap(state.currentDocId);
        state.localData.is_locked = false;
        handleLockState();
        showToast("Data berhasil dibuka kembali", "success");
      } catch (e) {
        showToast("Gagal membuka kunci: " + e.message, "error");
      }
    });
  };
}

const btnLock = document.getElementById("btnLock");
if (btnLock) {
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

// --- MONTHLY REPORT ---
window.openMonthlyModal = () => {
  const modal = document.getElementById("modalMonthly");
  const monthPicker = document.getElementById("monthPickerReport");

  if (!modal) return;

  modal.classList.remove("hidden");
  if (monthPicker && !monthPicker.value) {
    monthPicker.value = new Date().toISOString().slice(0, 7);
  }
};

window.closeMonthlyModal = () => {
  const modal = document.getElementById("modalMonthly");
  if (modal) modal.classList.add("hidden");
};

window.loadMonthlyReport = async () => {
  const kelasPicker = document.getElementById("kelasPicker");
  const monthPicker = document.getElementById("monthPickerReport");
  const tbody = document.getElementById("tbodyBulanan");

  if (!kelasPicker || !monthPicker || !tbody) return;

  const kls = kelasPicker.value;
  const month = monthPicker.value;

  if (!kls || !month) return showToast("Pilih Kelas & Bulan!", "warning");

  tbody.innerHTML =
    '<tr><td colspan="40" class="p-8 text-center"><div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div> Memproses data...</td></tr>';

  const btnPrint = document.getElementById("btnPrintMonthly");
  if (btnPrint) btnPrint.style.display = "none";

  try {
    // FORCE REFRESH: Pass forceRefresh = true untuk bypass cache
    const [master, reports] = await Promise.all([
      attendanceService.getMasterSiswa(kls),
      attendanceService.getMonthlyReport(kls, month, true), // Force refresh!
    ]);

    state.monthlyCache = { master, reports, monthStr: month };

    const [year, monthNum] = month.split("-");
    const days = new Date(year, monthNum, 0).getDate();

    // Header
    const headerRow = document.getElementById("headerRowBulanan");
    if (headerRow) {
      let headHtml =
        '<th class="p-3 sticky left-0 bg-gray-100 dark:bg-gray-700 z-30 border dark:border-gray-600 min-w-[150px] shadow-sm">Nama Siswa</th>';
      for (let i = 1; i <= days; i++) {
        headHtml += `<th class="p-1 text-center min-w-[30px] border dark:border-gray-600 text-[10px] text-gray-500">${i}</th>`;
      }
      headHtml += `
            <th class="p-2 border bg-green-100 text-green-800 text-xs">H</th>
            <th class="p-2 border bg-yellow-100 text-yellow-800 text-xs">S</th>
            <th class="p-2 border bg-blue-100 text-blue-800 text-xs">I</th>
            <th class="p-2 border bg-red-100 text-red-800 text-xs">A</th>
        `;
      headerRow.innerHTML = headHtml;
    }

    // Mapping Data
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

    // Body
    tbody.innerHTML = Object.keys(master)
      .sort((a, b) => master[a].nama.localeCompare(master[b].nama))
      .map((id) => {
        let rowHtml = `<td class="p-2 font-medium sticky left-0 bg-white dark:bg-darkcard border-r border-b dark:border-gray-700 z-20 shadow-sm text-xs md:text-sm max-w-[100px] md:max-w-none break-words leading-tight" title="${master[id].nama}">${master[id].nama}</td>`;
        let st = { H: 0, S: 0, I: 0, A: 0 };

        for (let i = 1; i <= days; i++) {
          const dataHari = map[id][i];
          const s = dataHari.status;

          if (s === "Hadir") st.H++;
          else if (s === "Sakit") st.S++;
          else if (s === "Izin") st.I++;
          else if (s === "Alpa") st.A++;

          const badge =
            {
              Hadir: '<span class="text-green-600 font-bold">H</span>',
              Sakit: '<span class="text-yellow-600 font-bold text-lg">S</span>',
              Izin: '<span class="text-blue-600 font-bold text-lg">I</span>',
              Alpa: '<span class="text-red-600 font-bold text-lg">A</span>',
              "-": '<span class="text-gray-200 dark:text-gray-700">.</span>',
            }[s] || '<span class="text-gray-200">.</span>';

          const title =
            dataHari.keterangan !== "-"
              ? `Tgl ${i}: ${dataHari.keterangan}`
              : "";
          rowHtml += `<td class="p-0 text-center border dark:border-gray-700 bg-white dark:bg-darkcard h-8 text-[10px] font-mono cursor-default hover:bg-gray-50" title="${title}">${badge}</td>`;
        }

        return `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                    ${rowHtml}
                    <td class="text-center font-bold text-xs text-green-700 border bg-green-50/30">${st.H}</td>
                    <td class="text-center font-bold text-xs text-yellow-700 border bg-yellow-50/30">${st.S}</td>
                    <td class="text-center font-bold text-xs text-blue-700 border bg-blue-50/30">${st.I}</td>
                    <td class="text-center font-bold text-xs text-red-700 border bg-red-50/30">${st.A}</td>
                </tr>`;
      })
      .join("");

    if (btnPrint) btnPrint.style.display = "flex";

    showToast("Data monthly berhasil dimuat", "success");
  } catch (e) {
    console.error("Monthly Load Error:", e);
    tbody.innerHTML = `<tr><td colspan="40" class="p-4 text-center text-red-500"> ${e.message}</td></tr>`;
    showToast("Gagal memuat data monthly", "error");
  }
};

window.printMonthlyData = () => {
  if (state.monthlyCache?.master) {
    const kelasPicker = document.getElementById("kelasPicker");
    if (!kelasPicker) return;

    exportMonthlyPDF(
      state.monthlyCache.master,
      state.monthlyCache.reports,
      state.monthlyCache.monthStr,
      kelasPicker.value,
      {
        guruPiket: state.currentUser,
        kepalaSekolah: state.kepalaSekolah,
      }
    );
  } else {
    showToast("Data belum siap!", "error");
  }
};