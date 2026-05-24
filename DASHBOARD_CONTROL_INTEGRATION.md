# Panduan Integrasi Dashboard Web: Remote Control, Wifi, dan Lokasi

Dokumen ini menjelaskan bagaimana dashboard web (misal menggunakan React, Next.js, atau Vanilla JS) dapat menggunakan data baru dari Electron Agent untuk:
1. Membaca Wifi SSID yang sedang terhubung.
2. Membaca lokasi device saat ini (real-time) dan historinya.
3. Mengirim perintah Lock Device (Mengunci Layar) ke device.
4. Mengirim perintah Shutdown Device (Mematikan Komputer) ke device.

---

## 1. Schema Database & Path

### A. Realtime Database (RTDB) - Status/Presence
Path: `/status/{companyId}/{deviceId}`

Field baru yang ditambahkan/diupdate pada node status:
- **`wifi`** (`string`): SSID wifi yang sedang terhubung (contoh: `"Vorce_Office_5G"` atau `""` jika tidak terhubung wifi).
- **`location`** (`string`): Lokasi saat ini berdasarkan IP publik (contoh: `"Surabaya, East Java, Indonesia"`).
- **`lockDevice`** (`boolean`): Control flag untuk mengunci layar (default tidak ada, web menulis `true` untuk mentrigger).
- **`shutdownDevice`** (`boolean`): Control flag untuk mematikan komputer (default tidak ada, web menulis `true` untuk mentrigger).

### B. Realtime Database (RTDB) - Stats Summary Sementara
Path: `/stats/{companyId}/{deviceId}`

Field baru yang ditambahkan:
- **`location`** (`string`): Lokasi device hari ini (contoh: `"Surabaya, East Java, Indonesia"`).

### C. Cloud Firestore - Stats Final Summary
Path: `companies/{companyId}/stats_summaries/{summaryId}`

Field baru yang ditambahkan:
- **`location`** (`string`): Lokasi device yang terekam pada laporan final hari ini (contoh: `"Surabaya, East Java, Indonesia"`).

---

## 2. Membaca Wifi dan Lokasi

### A. Real-time Status (Halaman Monitoring Live)
Untuk menampilkan Wifi dan lokasi live dari user di dashboard:

```typescript
import { getDatabase, ref, onValue } from "firebase/database";

const db = getDatabase();
const presenceRef = ref(db, `status/${companyId}/${deviceId}`);

onValue(presenceRef, (snapshot) => {
  const presence = snapshot.val();
  if (presence) {
    console.log("Wifi SSID:", presence.wifi || "Tidak terhubung Wifi / Ethernet");
    console.log("Lokasi saat ini:", presence.location || "Unknown");
    
    // Update State UI Anda
    updateUI({
      connectedWifi: presence.wifi,
      currentLocation: presence.location,
      state: presence.state, // "online" | "idle" | "away" | "offline"
    });
  }
});
```

### B. Membaca Histori Lokasi (Laporan / Laporan Harian)
Karena lokasi disimpan di RTDB stats dan Firestore final summary, Anda dapat melacak di kota mana device tersebut bekerja pada hari tersebut:

```typescript
import { getDoc, doc } from "firebase/firestore";
import { firestore } from "./firebase"; // firebase config Anda

// Ambil laporan final hari ini
const today = new Date().toISOString().slice(0, 10);
const summaryId = `${userId}_${deviceId}_${today}`;
const summaryDocRef = doc(firestore, "companies", companyId, "stats_summaries", summaryId);

const snap = await getDoc(summaryDocRef);
if (snap.exists()) {
  const data = snap.data();
  console.log("Histori Lokasi Kerja Hari Ini:", data.location); // "Surabaya, East Java, Indonesia"
}
```

---

## 3. Remote Control (Lock & Shutdown)

Untuk mengirim perintah Lock atau Shutdown dari dashboard web ke Electron Agent, kita cukup melakukan **`update`** pada field `lockDevice` atau `shutdownDevice` di RTDB path `/status/{companyId}/{deviceId}`.

> [!IMPORTANT]
> - Electron Agent secara real-time mendengarkan perubahan pada node statusnya.
> - Begitu perintah dibaca oleh Agent, Agent akan langsung menulis kembali `lockDevice: false` atau `shutdownDevice: false` ke RTDB **sebelum** mengeksekusi perintah. Hal ini untuk mencegah looping perintah ketika komputer dinyalakan kembali.
> - Tombol di web cukup mengirim `true` secara optimistic.

### A. Menerapkan Lock Device (Kunci Layar)
Buat fungsi klik di dashboard:

```typescript
import { getDatabase, ref, update } from "firebase/database";

async function handleLockDevice(companyId: string, deviceId: string) {
  const db = getDatabase();
  const presenceRef = ref(db, `status/${companyId}/${deviceId}`);
  
  try {
    // Tulis lockDevice: true ke RTDB
    await update(presenceRef, {
      lockDevice: true
    });
    console.log("Perintah Lock berhasil dikirim!");
  } catch (err) {
    console.error("Gagal mengirim perintah Lock:", err);
  }
}
```

### B. Menerapkan Shutdown Device (Matikan Komputer)
Buat fungsi klik di dashboard:

```typescript
import { getDatabase, ref, update } from "firebase/database";

async function handleShutdownDevice(companyId: string, deviceId: string) {
  const db = getDatabase();
  const presenceRef = ref(db, `status/${companyId}/${deviceId}`);
  
  // Tampilkan konfirmasi dialog ke Admin/User sebelum melakukan ini
  const confirm = window.confirm("Apakah Anda yakin ingin mematikan device ini secara remote?");
  if (!confirm) return;

  try {
    // Tulis shutdownDevice: true ke RTDB
    await update(presenceRef, {
      shutdownDevice: true
    });
    console.log("Perintah Shutdown berhasil dikirim!");
  } catch (err) {
    console.error("Gagal mengirim perintah Shutdown:", err);
  }
}
```

---

## 4. UI/UX Dashboard Recomended Design

### A. Tampilan Device List (Live Indicator)
Tambahkan badge koneksi wifi dan lokasi di samping status online:
- **Wifi**: Tampilkan icon Wifi dengan tooltip berisi nama SSID (misal: `📶 Vorce_Office`). Jika tidak terhubung, tampilkan icon kabel Ethernet (`🔌 Wired`).
- **Lokasi**: Tampilkan icon Map Marker (`📍 Surabaya, ID`).

### B. Tombol Remote Action (Di Detail Device)
Buat panel khusus "Remote Actions" dengan tombol berdesain premium:
- **Lock Screen**: Tombol dengan icon gembok (`🔒 Lock Device`). Beri warna netral/kuning.
- **Shutdown**: Tombol dengan icon power (`🔴 Shutdown Device`). Beri warna merah menyala dengan konfirmasi ganda (double confirmation modal) untuk mencegah salah klik yang fatal.

Contoh tampilan komponen React sederhana:

```tsx
import React, { useState } from 'react';

export function RemoteControlPanel({ companyId, deviceId, isOnline }) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const triggerAction = async (action: 'lock' | 'shutdown') => {
    setLoadingAction(action);
    if (action === 'lock') {
      await handleLockDevice(companyId, deviceId);
    } else {
      await handleShutdownDevice(companyId, deviceId);
    }
    // Timeout untuk mengembalikan state tombol ke normal setelah dikirim
    setTimeout(() => setLoadingAction(null), 2000);
  };

  return (
    <div className="p-6 bg-white rounded-xl shadow-md border border-gray-100">
      <h3 className="text-lg font-bold text-gray-800 mb-4">Device Remote Control</h3>
      
      {!isOnline && (
        <p className="text-sm text-yellow-600 bg-yellow-50 p-3 rounded-lg mb-4">
          ⚠️ Device sedang offline. Perintah akan disimpan dan dijalankan otomatis begitu device kembali online.
        </p>
      )}

      <div className="flex gap-4">
        <button
          onClick={() => triggerAction('lock')}
          disabled={loadingAction !== null}
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white font-semibold rounded-lg transition-colors"
        >
          {loadingAction === 'lock' ? 'Mengirim...' : '🔒 Lock Workstation'}
        </button>

        <button
          onClick={() => triggerAction('shutdown')}
          disabled={loadingAction !== null}
          className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-semibold rounded-lg transition-colors"
        >
          {loadingAction === 'shutdown' ? 'Mengirim...' : '🔴 Shutdown Device'}
        </button>
      </div>
    </div>
  );
}
```
