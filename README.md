
---

# Sistem Absensi Digital (Secure & Role-Based)

Sistem absensi berbasis web modern untuk pendataan kehadiran siswa harian dan bulanan. Aplikasi ini menggunakan **Firebase v12+ (Modular SDK)** dengan arsitektur **Offline First**, sistem keamanan bertingkat, dan deployment otomatis via GitHub Actions.

**URL Aplikasi:** [https://absensi-internal.web.app/](https://absensi-internal.web.app/)

---

## Tech Stack

| Layer | Teknologi |
| ----- | --------- |
| **Frontend** | HTML5, Tailwind CSS (build lokal), Lucide Icons, Chart.js |
| **Backend** | Firebase Firestore (NoSQL) + Firebase Storage |
| **Auth** | Firebase Authentication (Google dan Email/Password) |
| **Export** | jsPDF & AutoTable (laporan harian & bulanan) |
| **Hosting** | Firebase Hosting + Service Worker |
| **CI/CD** | GitHub Actions → `firebase deploy` |

### Fitur Utama

* **Offline First** — LocalStorage sebagai sumber data utama; Firebase hanya untuk sinkronisasi.
* **Cache Manager** — TTL per-layer (rekap, master siswa, login session, dashboard query).
* **Draft Absensi** — Per-user (`absensi_draft_{uid}`), auto-restore saat reload.
* **Sync Queue** — Write absensi di-queue saat offline, retry otomatis saat online.
* **Multi-tab Sync** — `BroadcastChannel` untuk sinkronisasi draft antar tab.
* **Service Worker** — Precache shell aplikasi agar tetap bisa dibuka offline.
* **Firestore Persistence** — IndexedDB cache untuk fallback read Firestore.
* **Secure Guards** — Proteksi rute berdasarkan role dan status verifikasi.

---

## Manajemen Akses (RBAC)

Sistem menggunakan **Role-Based Access Control (RBAC)**. Pendaftar baru **tidak langsung** bisa mengakses data (`isVerified: false`).

### Role & Hak Akses

| Role | Deskripsi | Hak Akses |
| ---- | --------- | --------- |
| **Viewer** | User standar setelah verifikasi | Lihat laporan, tidak bisa input absensi |
| **Guru** | Guru piket | Input & simpan absensi harian, kunci data |
| **Admin** | Pengelola sistem | CRUD siswa/kelas, verifikasi user, buka kunci absensi |
| **Super Admin** | Administrator tertinggi | Semua hak admin + manajemen user & role |
| **Pending** | `isVerified: false` | Diblokir dari dashboard |

---

## Arsitektur Database (Firestore)

### 1. Koleksi `users`

* **Doc ID:** UID (Google Auth)
* **Fields:** `nama`, `email`, `nip`, `role` (`viewer` \| `guru` \| `admin` \| `super_admin`), `isVerified`, `photo`, `createdAt`, `updatedAt`

### 2. Koleksi `kelas`

* **Doc ID:** Kode kelas (mis. `6B`, `X RPL 1`)
* **Fields:** `nama_kelas`, `is_khusus` (boolean — kelas mapel/khusus)

### 3. Koleksi `siswa`

* **Doc ID:** Auto-generated
* **Fields:** `nis`, `nama_siswa`, `id_kelas`, `status_aktif`

### 4. Koleksi `anggota_kelas`

Relasi siswa ↔ kelas khusus (`is_khusus: true`).

* **Doc ID:** `{kelasId}_{siswaId}`
* **Fields:** `kelasId`, `siswaId`, `assignedAt`

### 5. Koleksi `rekap_absensi`

Satu dokumen per kelas per tanggal.

* **Doc ID:** `{TANGGAL}_{KELAS}` — contoh: `2025-12-28_6B`
* **Fields:** `tanggal`, `kelas`, `is_locked`, `locked_at`, `created_at`, `updated_at`, `siswa` (map status per siswa)

### 6. Koleksi `settings`

* **Doc ID:** `kepala_sekolah`
* **Fields:** `nama`, `nip` — digunakan saat export PDF

---

## Struktur Folder

```text
absensi/
├── .github/workflows/              # CI/CD deploy ke Firebase Hosting
├── assets/
│   ├── css/
│   │   ├── tailwind.input.css      # Source Tailwind
│   │   └── tailwind.css            # Output build (minified)
│   ├── images/
│   │   └── logo.png
│   └── js/
│       ├── components/
│       │   └── navbar.js
│       ├── firebase/
│       │   ├── admin-service.js    # CRUD kelas & siswa
│       │   ├── attendance-service.js
│       │   ├── auth-service.js
│       │   ├── config.example.js   # Template konfigurasi (commit)
│       │   ├── config.js           # Konfigurasi aktif (gitignored)
│       │   ├── profile-service.js
│       │   └── user-service.js
│       ├── pages/
│       │   ├── index.js            # Dashboard & input absensi
│       │   ├── admin.js            # Manajemen kelas & siswa
│       │   └── users.js            # Manajemen user (super admin)
│       └── utils/
│           ├── auth-guard.js
│           ├── cache-utils.js      # Draft, clear cache, kepsek cache
│           ├── sync-queue.js       # Offline write queue & retry
│           ├── tab-sync.js         # BroadcastChannel multi-tab
│           ├── pdf-helper.js
│           └── ui.js
├── scripts/
│   └── inject-cache-version.js     # Cache-bust + generate sw.js
├── index.html                      # Dashboard absensi
├── admin.html                      # Master data kelas & siswa
├── users.html                      # Manajemen pengguna
├── login.html
├── 404.html
├── firebase.json
├── tailwind.config.js
├── package.json
└── sw.js                           # Service Worker (generated, gitignored)
```

---

## Cara Install & Setup

### Prasyarat

* Node.js 20+
* Akun Firebase dengan project aktif
* Firebase CLI (`npx firebase-tools@latest login`)

### 1. Clone & Install

```bash
git clone <repo-url>
cd absensi
npm install
```

### 2. Setup Firebase Console

1. Buat proyek di [Firebase Console](https://console.firebase.google.com/)
2. Aktifkan **Authentication → Google** dan **Email/Password**
3. Aktifkan **Firestore Database** (Production Mode)
4. Aktifkan **Firebase Storage**
5. Daftarkan Web App, salin konfigurasi Firebase

### 3. Konfigurasi Lokal

Salin template konfigurasi:

```bash
cp assets/js/firebase/config.example.js assets/js/firebase/config.js
```

Edit `assets/js/firebase/config.js` — isi `firebaseConfig` dengan kredensial project Anda.

> `config.js` di-gitignore agar konfigurasi project tidak ter-commit. Di CI, file ini di-generate otomatis dari GitHub Secret `FIREBASE_CONFIG`.

### 4. Build

```bash
npm run build
```

| Script | Fungsi |
| ------ | ------ |
| `npm run build:css` | Compile Tailwind → `assets/css/tailwind.css` |
| `npm run build:cache` | Inject cache-bust version + generate `sw.js` |
| `npm run build` | Keduanya sekaligus |
| `npm run deploy:local` | Build lalu `firebase deploy --only hosting` |

### 5. Setup Admin Pertama

1. Login via `login.html`
2. Buka **Firestore Console → collection `users`**
3. Edit dokumen user Anda:
   * `role` → `super_admin` (atau `admin`)
   * `isVerified` → `true`
4. Refresh halaman — siap mengelola sistem

---

## Deployment

### Lokal

```bash
npm run deploy:local
```

### CI/CD (Otomatis)

Push ke branch `master` memicu workflow `.github/workflows/firebase-hosting-merge.yml`:

1. `npm ci` + `npm run build:css`
2. Inject `config.js` dari secret
3. `node scripts/inject-cache-version.js`
4. Deploy ke Firebase Hosting

Pull request memicu preview deploy via `firebase-hosting-pull-request.yml`.

GitHub Actions memerlukan secret berikut:

* `FIREBASE_CONFIG` — JSON konfigurasi Web App Firebase, termasuk `storageBucket`
* `FIREBASE_SERVICE_ACCOUNT_ABSENSI_INTERNAL` — JSON service account untuk deploy

Konfigurasi yang dihasilkan CI harus mempertahankan export `db`, `auth`, `app`, dan `storage` seperti `assets/js/firebase/config.example.js`. Jika bentuknya berbeda, import Firebase dapat gagal dan data Firestore tidak dimuat meskipun deployment lokal berjalan normal.

---

## Arsitektur Offline First

Prioritas baca data (dari tertinggi):

```text
Draft absensi (localStorage)
    ↓ miss
Cache aplikasi (localStorage, dengan TTL)
    ↓ miss
Firestore (IndexedDB persistence)
    ↓ miss
Network (Firebase server)
```

Prioritas tulis data:

```text
Update cache lokal → coba Firestore
    ↓ gagal / offline
Enqueue ke sync queue → flush saat online
```

| Komponen | File | Fungsi |
| -------- | ---- | ------ |
| Cache terpusat | `cache-utils.js` | Draft per-user, clear cache, kepsek cache |
| Sync queue | `sync-queue.js` | Retry write absensi (save/lock/unlock) |
| Multi-tab | `tab-sync.js` | Sinkronisasi draft & invalidasi antar tab |
| Service Worker | `sw.js` | Precache HTML, CSS, JS lokal |
| Firestore cache | `config.js` | `persistentLocalCache` + multi-tab manager |

---

## Halaman Aplikasi

| Halaman | Akses | Fungsi |
| ------- | ----- | ------ |
| `login.html` | Publik | Google Sign-In, Email/Password, dan reset password |
| `index.html` | Guru+ | Input absensi harian, dashboard, export PDF |
| `admin.html` | Admin+ | CRUD kelas & siswa |
| `users.html` | Super Admin | Manajemen user, role, verifikasi |

---

## File yang Di-gitignore

| File / Folder | Alasan |
| ------------- | ------ |
| `assets/js/firebase/config.js` | Berisi API key |
| `sw.js` | Generated saat build |
| `node_modules/` | Dependencies |
| `.firebase/` | Cache Firebase CLI |
| `service-account.json` | Credential deploy |
| `.env*` | Environment lokal |

---
