# Spesifikasi Pembatasan Device (IAP) untuk Backend

Dokumen ini menjelaskan struktur database dan alur logika yang dibutuhkan dari sisi Backend untuk mengimplementasikan pembatasan perangkat (*device limit*) berdasarkan pembelian *In-App Purchase* (IAP).

## 1. Lokasi di Firestore

Penyimpanan kuota batas perangkat harus diletakkan di dalam *collection* **`companies`**.
**Path:** `companies/{companyId}`

Tambahkan minimal 2 *field* baru di dalam dokumen perusahaan:

*   **`max_devices`** (Tipe: `Number`): Menyimpan kuota maksimal perangkat/user yang boleh login berdasarkan paket langganan (IAP) yang sedang aktif.
*   **`total_active_devices`** (Tipe: `Number`): Menyimpan jumlah perangkat dari perusahaan tersebut yang **saat ini sedang aktif / terdaftar**.

### Contoh Struktur Data:
```json
{
  "companyName": "PT. Teknologi Maju",
  "max_devices": 10,
  "total_active_devices": 3
}
```

*(Catatan: Aplikasi desktop Vlinked Agent saat ini telah diprogram untuk membaca field `max_devices` dan `total_active_devices`. Jika menggunakan penamaan lain, mohon beritahu tim Frontend/Desktop agar bisa disesuaikan).*

## 2. Alur Pembelian (In-App Purchase / IAP)

Saat ada HR/Admin yang melakukan pembelian paket tambahan lewat *Mobile App*:

1. **Validasi Struk:** Mobile akan menembak API Backend dengan membawa struk (*receipt*) dari Apple App Store atau Google Play Store.
2. **Verifikasi Backend:** Backend memvalidasi *receipt* tersebut ke server Apple/Google.
3. **Update Kuota:** Jika valid, Backend melakukan operasi **UPDATE** ke dokumen `companies/{companyId}` di Firestore untuk menyesuaikan/menambah nilai `max_devices`.

## 3. Alur Pengelolaan `total_active_devices`

Untuk memastikan data `total_active_devices` selalu akurat:

1. **Saat Login / Binding Agent Baru:**
   * Backend mengecek apakah `total_active_devices < max_devices`.
   * Jika kuota belum penuh: Izinkan login dan lakukan operasi *Increment* (+1) pada field `total_active_devices`.
   * Jika kuota sudah penuh: Tolak permintaan login (kirimkan balasan error yang sesuai, dan aplikasi Vlinked Agent akan mendeteksinya sebagai limit tercapai).

2. **Saat Pencabutan Akses (Revoke):**
   * Jika HR/Admin menghapus perangkat dari Dashboard (Vorce Web), Backend harus mengeksekusi operasi *Decrement* (-1) pada field `total_active_devices`.
   * Ini akan membebaskan slot sehingga perangkat lain bisa masuk.
