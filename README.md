# 📊 Sistem Absensi Digital (Guru & Admin)

Sistem absensi berbasis web menggunakan **Firebase Firestore** untuk penyimpanan data real-time dan **Tailwind CSS** untuk antarmuka yang responsif dan modern.

---

## 🏗️ Arsitektur Data Firestore

Penyimpanan data diatur dalam model *flat collection* untuk memaksimalkan kecepatan akses dan efisiensi biaya (minimizing Reads/Writes).

### 1. Koleksi `kelas`
Menyimpan daftar kelas yang tersedia.
- **Document ID**: `[NAMA_KELAS]` (Contoh: `X-RPL-1`)
- **Fields**:
  - `nama_kelas`: String

### 2. Koleksi `siswa`
Menyimpan master data siswa secara global.
- **Document ID**: Auto-generated
- **Fields**:
  - `nama_siswa`: String
  - `nis`: String (Unique ID)
  - `id_kelas`: String (Relasi ke `kelas.id`)
  - `status_aktif`: String ("Aktif")

### 3. Koleksi `absensi`
Menyimpan rekap kehadiran harian.
- **Document ID**: `[TANGGAL]_[ID_KELAS]` (Contoh: `2025-12-26_X-RPL-1`)
- **Fields**:
  - `tanggal`: String (YYYY-MM-DD)
  - `kelas`: String
  - `is_locked`: Boolean
  - `siswa`: Map (Object)
    - `[SISWA_ID]`: 
      - `nama`: String
      - `nis`: String
      - `status`: String (H/S/I/A/-)
      - `keterangan`: String

---

## ⚙️ Konfigurasi Firebase Console

Ikuti langkah-langkah berikut untuk menyiapkan backend:

### 1. Buat Proyek Firebase
1. Buka [Firebase Console](https://console.firebase.google.com/).
2. Klik **Add Project** dan beri nama proyek Anda.
3. Di menu **Build**, pilih **Firestore Database** dan klik **Create Database**.
4. Pilih lokasi server terdekat (Contoh: `asia-southeast2` untuk Jakarta).

### 2. Security Rules
Buka tab **Rules** di Firestore dan gunakan pengaturan berikut (Development Mode):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}