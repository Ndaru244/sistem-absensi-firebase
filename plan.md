# Plan Implementasi Multi-Kelas untuk Guru

## Overview
Menambahkan fitur agar user dengan role `guru` hanya dapat mengakses kelas-kelas tertentu yang ditugaskan, sedangkan `admin` dan `super_admin` tetap dapat mengakses semua kelas.

## Requirement
- **Guru Piket (admin)**: Dapat select semua kelas
- **Super Admin**: Dapat select semua kelas  
- **Guru (guru)**: Hanya dapat select kelas yang ditugaskan (via `kelas_ids`)
- **Viewer**: Tidak ada perubahan (read-only)

## Database Schema Changes

### Collection: `users`
Tambah field baru:
```javascript
{
  kelas_ids: array  // Array of string - ID kelas yang dapat diakses
}
```

**Contoh:**
```javascript
{
  uid: "abc123",
  nama: "Budi Santoso",
  email: "budi@sekolah.id",
  role: "guru",
  kelas_ids: ["7A", "7B", "8A"],  // Hanya kelas ini yang bisa diakses
  isVerified: true
}
```

## Implementation Steps

### 1. Update `admin.html` - Tambah UI Kelola Akses Kelas Guru

**Lokasi:** `/var/www/absensi/admin.html`

**Perubahan:**
- Tambah section card "Akses Kelas Guru" di sidebar (sebelah Identitas Sekolah)
- Tambah button "Kelola Akses Kelas" yang memanggil `openGuruKelasAccess()`
- Tambah alert info untuk menjelaskan fungsi fitur

**Status:** ✅ SELESAI

### 2. Update `assets/js/pages/admin.js` - Implementasi Logic Kelola Akses Kelas

**Lokasi:** `/var/www/absensi/assets/js/pages/admin.js`

**Perubahan:**
- Import tambahan: `updateDoc, query, where` dari Firestore
- Import `userService` (opsional, untuk future use)
- Tambah function `window.openGuruKelasAccess()`:
  - Fetch semua user dengan role 'guru'
  - Fetch semua kelas (filter hanya kelas reguler, bukan khusus/mapel)
  - Render modal dengan list guru dan checkbox kelas
  - Load existing kelas_ids dari setiap guru
  - Tambah tombol "Semua" untuk toggle semua kelas per guru
  - Implement visual feedback saat checkbox berubah
- Tambah function `window.saveGuruKelasAccess()`:
  - Collect semua checkbox yang checked
  - Group by guru ID
  - Update Firestore dengan batch update
  - Clear cache (LoginCache dan ProfileCache)
  - Show toast success/error

**Status:** ✅ SELESAI

### 3. Update `assets/js/firebase/auth-service.js`

**Lokasi:** `/var/www/absensi/assets/js/firebase/auth-service.js`

**Perubahan:**
- Tambah helper method `getUserKelasIds(uid)` untuk mengambil kelas_ids user
- Tambah helper method `canAccessAllClasses(uid)` untuk cek apakah user akses semua kelas
- Update cache handling untuk field baru

**Detail:**
```javascript
// Helper methods baru:
getUserKelasIds(uid) {
  const cached = LoginCache.get(uid);
  return cached?.kelas_ids || [];
}

canAccessAllClasses(uid) {
  const cached = LoginCache.get(uid);
  const role = cached?.role;
  return role === 'admin' || role === 'super_admin';
}
```

**Status:** ⏳ PENDING

### 4. Update `assets/js/pages/index.js`

**Lokasi:** `/var/www/absensi/assets/js/pages/index.js`

**Perubahan:**
- Update `populateClassPickers()` untuk filter kelas berdasarkan role user
- Jika role = 'guru': Filter options berdasarkan `kelas_ids` dari user
- Jika role = 'admin'/'super_admin': Tampilkan semua kelas (no filter)
- Update semua SearchableSelect instances (kelas, chartKelas, monthKelas)
- Update `registerIndexAuthListener()` untuk load kelas_ids ke state.currentUser

**Detail:**
```javascript
async function populateClassPickers() {
  // ... existing code ...
  
  const classes = await adminService.getClasses(true);
  
  // Filter kelas berdasarkan role user
  let filteredClasses = classes;
  if (state.currentUser.role === 'guru' && state.currentUser.kelas_ids) {
    filteredClasses = classes.filter(c => 
      state.currentUser.kelas_ids.includes(c.id)
    );
  }
  
  // Sort dan convert ke options
  filteredClasses.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const options = optionsFromClasses(filteredClasses);
  
  // Set options ke semua SearchableSelect instances
  // ...
}
```

**Catatan Penting:**
- Pastikan `state.currentUser` sudah di-load dengan field `kelas_ids` sebelum `populateClassPickers()` dipanggil
- Update di `registerIndexAuthListener()` untuk load kelas_ids ke state.currentUser

**Status:** ⏳ PENDING

### 5. Update `assets/js/firebase/user-service.js`

**Lokasi:** `/var/www/absensi/assets/js/firebase/user-service.js`

**Perubahan:**
- Method `updateUser()` sudah support update field apapun (termasuk kelas_ids)
- Tidak perlu perubahan signifikan
- Pastikan cache invalidation berjalan proper

**Status:** ✅ TIDAK PERLU PERUBAHAN (sudah support generic update)

### 6. Update `assets/js/pages/users.js`

**Lokasi:** `/var/www/absensi/assets/js/pages/users.js`

**Perubahan:**
- **TIDAK PERLU** perubahan karena fitur kelola akses kelas sudah dipindah ke admin.html
- User management tetap untuk edit nama, NIP, dan role
- Kelola akses kelas dilakukan terpisah di admin panel

**Status:** ✅ TIDAK PERLU PERUBAHAN

### 7. Update `assets/js/utils/auth-guard.js`

**Lokasi:** `/var/www/absensi/assets/js/utils/auth-guard.js`

**Perubahan:**
- Tidak ada perubahan signifikan
- Pastikan `canAccessApp()` tetap mengizinkan role 'guru' (sudah ada)

**Status:** ✅ TIDAK PERLU PERUBAHAN

## Testing Checklist

### 1. Kelola Akses Kelas Guru (admin.html)
- [ ] Modal "Kelola Akses Kelas Guru" berhasil dibuka
- [ ] List semua user role 'guru' berhasil ditampilkan
- [ ] List semua kelas reguler berhasil ditampilkan
- [ ] Checkbox kelas menampilkan status existing kelas_ids dengan benar
- [ ] Tombol "Semua" berhasil toggle semua checkbox per guru
- [ ] Visual feedback saat checkbox berubah berfungsi
- [ ] Save berhasil menyimpan kelas_ids ke Firestore
- [ ] Cache berhasil di-clear setelah save
- [ ] Toast success/error muncul dengan benar

### 2. Attendance Input (index.html)
- [ ] User role 'guru' hanya melihat kelas yang ditugaskan di dropdown
- [ ] User role 'admin' melihat semua kelas di dropdown
- [ ] User role 'super_admin' melihat semua kelas di dropdown
- [ ] Chart kelas picker juga ter-filter untuk guru
- [ ] Monthly report kelas picker juga ter-filter untuk guru

### 3. Dashboard Status
- [ ] Status absensi hanya menampilkan kelas yang dapat diakses user
- [ ] Chart statistik hanya menghitung kelas yang dapat diakses user

### 4. Cache & Performance
- [ ] Cache berfungsi dengan field kelas_ids baru
- [ ] Cache di-clear saat user data di-update
- [ ] Tidak ada error di console saat load page

### 5. Edge Cases
- [ ] Guru dengan kelas_ids kosong (array kosong) - tidak ada kelas yang tampil
- [ ] Guru dengan kelas_ids null/undefined - fallback ke semua kelas atau none?
- [ ] User role berubah dari guru ke admin - kelas_ids tetap tersimpan tapi tidak dipakai
- [ ] User role berubah dari admin ke guru - perlu set kelas_ids

## Migration Strategy

### Existing Data
- User yang sudah ada dengan role 'guru' akan memiliki `kelas_ids: undefined`
- **Solusi:** Default behavior saat `kelas_ids` undefined:
  - Jika role = 'guru' dan kelas_ids undefined: Tampilkan semua kelas (backward compatibility)
  - Atau: Tampilkan warning di admin panel untuk set kelas_ids

### Recommended Approach
```javascript
// Di index.js populateClassPickers():
if (state.currentUser.role === 'guru') {
  if (state.currentUser.kelas_ids && state.currentUser.kelas_ids.length > 0) {
    // Filter by kelas_ids
    filteredClasses = classes.filter(c => 
      state.currentUser.kelas_ids.includes(c.id)
    );
  } else {
    // Backward compatibility: show all if not set
    // Tambah warning/toast untuk admin agar set kelas_ids
    console.warn('User guru belum memiliki kelas_ids ditugaskan');
  }
}
```

## Files Summary

### Files Modified:
1. ✅ `admin.html` - Added "Akses Kelas Guru" section
2. ✅ `assets/js/pages/admin.js` - Added `openGuruKelasAccess()` and `saveGuruKelasAccess()` functions

### Files to Modify (Pending):
3. ⏳ `assets/js/firebase/auth-service.js` - Add helper methods for kelas access
4. ⏳ `assets/js/pages/index.js` - Filter kelas based on user role and kelas_ids

### Files No Changes Needed:
- ✅ `assets/js/firebase/user-service.js` - Already supports generic update
- ✅ `assets/js/pages/users.js` - Kelola akses kelas moved to admin panel
- ✅ `assets/js/utils/auth-guard.js` - Already handles role checks correctly
- ✅ `assets/js/firebase/admin-service.js` - getClasses() already returns all classes
- ✅ `assets/js/utils/searchable-select.js` - Already supports multi-select pattern

## Implementation Order

1. **Phase 1: Admin UI (COMPLETED) ✅**
   - Update `admin.html` - Add "Akses Kelas Guru" section
   - Update `admin.js` - Implement `openGuruKelasAccess()` and `saveGuruKelasAccess()`
   - Test: Open admin panel, verify modal opens, test save functionality

2. **Phase 2: Backend/Foundation (PENDING) ⏳**
   - Update `auth-service.js` - Add helper methods `getUserKelasIds()` and `canAccessAllClasses()`
   - Test: Verify helper methods return correct values

3. **Phase 3: Attendance Filter (PENDING) ⏳**
   - Update `index.js` - populateClassPickers filter logic
   - Update `index.js` - load kelas_ids to state.currentUser in registerIndexAuthListener()
   - Test: Login as guru, verify filtered kelas in dropdown

4. **Phase 4: Testing & Polish (PENDING) ⏳**
   - Full integration testing
   - Edge case handling
   - Cache invalidation verification

## Rollback Plan

Jika ada masalah:
1. Revert code changes di 4 files yang di-modify
2. Data di Firestore tetap aman (field kelas_ids baru akan di-ignore oleh old code)
3. System akan tetap berjalan dengan backward compatibility

## Notes

- **Security:** Pastikan hanya super_admin yang dapat mengubah kelas_ids user lain
- **Performance:** Cache kelas_ids di LoginCache untuk mengurangi Firestore reads
- **UX:** Tampilkan indikator visual di user table berapa kelas yang diakses guru
- **Validation:** Pastikan kelas_ids hanya berisi ID kelas yang valid (exists di collection kelas)
