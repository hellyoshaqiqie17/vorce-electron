# Vlinked Mobile Developer Integration Guide — Metrics Consumption & Remote Control

Dokumentasi ini ditujukan untuk **Tim Mobile Developer** (dan Web Dashboard / VORCE Admin) yang ingin menampilkan seluruh metrik perangkat desktop (Windows & macOS) secara *real-time* maupun historis, serta mengeksekusi perintah kontrol jarak jauh (**Matikan Agent**, **Shutdown Perangkat**, **Lockscreen**, dan **Ganti Password Lockscreen + Lock**).

---

## 1. Arsitektur & Konfigurasi Firebase

Vlinked Electron Agent menggunakan arsitektur *dual-database* di Firebase untuk menyeimbangkan **latensi real-time** dan **biaya/skalabilitas kueri historis**:

1. **Firebase Realtime Database (RTDB)** — Digunakan untuk:
   - **Live Presence & Real-Time Metrics** (CPU, RAM, GPU, Aplikasi aktif, Window Title, Wi-Fi SSID, IP Lokal, Health Score).
   - **Remote Control Command Channel** (tempat Mobile App mengirim perintah `lockDevice`, `lockPassword`, `shutdownDevice`, `remoteQuit`).
   - **Daily Realtime Stats Summary** (akumulasi statistik harian per perangkat yang diperbarui berkala).
2. **Cloud Firestore** — Digunakan untuk:
   - **Spesifikasi Perangkat & Riwayat Pergantian Hardware** (`device_monitoring`).
   - **Sesi Aktivitas Aplikasi & Timeline** (`device_sessions`, `activity_timeline`).
   - **Agregasi Perilaku & Produktivitas Karyawan** (`employee_behavior`, `employee_behavior_daily`, `employee_behavior_weekly`, `employee_behavior_monthly`).
   - **Snapshot Analitik 20-Menitan & Deteksi Anomali** (`analytics_snapshots`, `anomaly_events`, `stats_summaries`).

### Konfigurasi Project Firebase
- **Project ID**: `hora-7394b`
- **Realtime Database URL**: `https://hora-7394b-default-rtdb.asia-southeast1.firebasedatabase.app`
- **Autentikasi**: Semua akses baca/tulis dari Mobile App wajib menggunakan sesi **Firebase Authentication** (`request.auth != null`).

> [!IMPORTANT]
> **Aturan Sanitasi Key pada Realtime Database (`safeKey`)**
> RTDB tidak mengizinkan karakter `.` `#` `$` `[` `]` `/` di dalam path key. Electron Agent men-sanitasi `companyId` dan `deviceId` pada RTDB dengan mengganti karakter terlarang tersebut menjadi underscore (`_`):
> ```javascript
> function safeKey(value) {
>   return String(value || "").replace(/[.#$\[\]\/]/g, "_").trim();
> }
> ```
> Pastikan Mobile App menggunakan fungsi `safeKey` yang sama saat membentuk path RTDB.

---

## 2. Remote Control Perangkat (RTDB Command Channel)

Electron Agent mendengarkan (*listen* via `onValue`) perubahan data pada path RTDB perangkatnya secara langsung:

**Path RTDB:**
```text
status/{companyId}/{deviceId}
```

Ketika Mobile App melakukan **`update()`** (bukan `set()`, agar tidak menghapus field presence lainnya) dengan flag perintah bernilai `true`, Electron Agent akan:
1. Membaca flag perintah tersebut seketika.
2. **Me-reset flag kembali ke `false` / `null`** di RTDB sebagai tanda perintah telah diterima (*acknowledged*).
3. Mengeksekusi perintah di OS perangkat (Windows/macOS/Linux).

> [!WARNING]
> **Cooldown Keamanan (30 Detik)**
> Perintah `lockDevice` dan `shutdownDevice` memiliki *cooldown* **30 detik (`30000 ms`)** di sisi Agent untuk mencegah eksekusi berulang akibat duplikasi sinyal jaringan.

### Ringkasan Perintah Kontrol

| Aksi Kontrol | Field yang Di-update di `status/{companyId}/{deviceId}` | Reset Otomatis oleh Agent | Perilaku di Perangkat (Windows & macOS) |
|---|---|---|---|
| **1. Lockscreen Saja** | `{ "lockDevice": true }` | `{ "lockDevice": false, "lockPassword": null, "newPassword": null }` | Mengunci layar komputer seketika tanpa mengubah password. |
| **2. Ganti Password Lockscreen & Lock** | `{ "lockDevice": true, "lockPassword": "PasswordBaru123!" }` *(atau field `"newPassword"`)* | `{ "lockDevice": false, "lockPassword": null, "newPassword": null }` | Mengubah password akun OS user yang sedang login, lalu langsung mengunci layar komputer. |
| **3. Shutdown Perangkat** | `{ "shutdownDevice": true }` | `{ "shutdownDevice": false }` | Mematikan (*power off*) komputer secara paksa/langsung. |
| **4. Matikan Agent (Quit App)** | `{ "remoteQuit": true }` *(atau `"quitAgent": true`)* | `{ "remoteQuit": false, "quitAgent": false }` | Menghentikan monitoring, menandai perangkat `offline`, menutup proses Vlinked Agent sepenuhnya. |

---

### Detail Payload & Contoh Implementasi Mobile

#### A. Lockscreen Perangkat
Mengunci layar kerja karyawan saat ini:
- **Windows**: Menjalankan `rundll32.exe user32.dll,LockWorkStation`.
- **macOS**: Menjalankan `pmset displaysleepnow || open -a ScreenSaverEngine` (atau fallback AppleScript `Ctrl+Cmd+Q`).

**Payload Update RTDB (`status/{companyId}/{deviceId}`):**
```json
{
  "lockDevice": true
}
```

#### B. Ganti Password Lockscreen + Lockscreen
Mengganti password akun OS lokal pada perangkat karyawan kemudian langsung mengunci layar:
- **Windows**: Menjalankan `net user "%USERNAME%" "<newPassword>"` (dengan fallback PowerShell ADSI `WinNT://`), lalu memanggil `LockWorkStation`.
- **macOS**: Menjalankan `dscl . -passwd "/Users/$USER" "<newPassword>" || sysadminctl -resetPasswordFor "$USER" -newPassword "<newPassword>"`, lalu mengunci layar.

**Payload Update RTDB (`status/{companyId}/{deviceId}`):**
```json
{
  "lockDevice": true,
  "lockPassword": "NewSecurePassword2026!"
}
```
*(Catatan: Agent menerima key `lockPassword` maupun `newPassword`. Begitu diterima, Agent langsung menghapus nilai password dari RTDB menjadi `null` demi keamanan).*

#### C. Shutdown Perangkat (Matikan Komputer)
Mematikan sistem operasi perangkat karyawan:
- **Windows**: Menjalankan `shutdown /s /f /t 0`.
- **macOS**: Menjalankan AppleScript `System Events` / `Finder` `shut down` atau `shutdown -h now`.

**Payload Update RTDB (`status/{companyId}/{deviceId}`):**
```json
{
  "shutdownDevice": true
}
```

#### D. Matikan Agent (Remote Quit Vlinked App)
Mematikan aplikasi Vlinked Electron Agent dari jarak jauh (keluar dari System Tray dan menghentikan background process):

**Payload Update RTDB (`status/{companyId}/{deviceId}`):**
```json
{
  "remoteQuit": true
}
```

#### Contoh Kode Mobile (Flutter / Dart & React Native / JS)

**Contoh React Native / TypeScript (Firebase JS SDK):**
```typescript
import { getDatabase, ref, update } from "firebase/database";

const db = getDatabase();

function safeKey(val: string) {
  return String(val || "").replace(/[.#$\[\]\/]/g, "_").trim();
}

// 1. Lock Screen
export async function remoteLockDevice(companyId: string, deviceId: string) {
  const targetRef = ref(db, `status/${safeKey(companyId)}/${safeKey(deviceId)}`);
  await update(targetRef, { lockDevice: true });
}

// 2. Ganti Password OS & Lock Screen
export async function remoteChangePasswordAndLock(
  companyId: string,
  deviceId: string,
  newPassword: string
) {
  const targetRef = ref(db, `status/${safeKey(companyId)}/${safeKey(deviceId)}`);
  await update(targetRef, {
    lockDevice: true,
    lockPassword: newPassword,
  });
}

// 3. Shutdown Komputer
export async function remoteShutdownDevice(companyId: string, deviceId: string) {
  const targetRef = ref(db, `status/${safeKey(companyId)}/${safeKey(deviceId)}`);
  await update(targetRef, { shutdownDevice: true });
}

// 4. Matikan Aplikasi Agent
export async function remoteQuitAgent(companyId: string, deviceId: string) {
  const targetRef = ref(db, `status/${safeKey(companyId)}/${safeKey(deviceId)}`);
  await update(targetRef, { remoteQuit: true });
}
```

**Contoh Flutter / Dart (`firebase_database`):**
```dart
import 'package:firebase_database/firebase_database.dart';

String safeKey(String value) =>
    value.replaceAll(RegExp(r'[.#$\[\]\/]'), '_').trim();

DatabaseReference deviceStatusRef(String companyId, String deviceId) {
  return FirebaseDatabase.instance
      .ref('status/${safeKey(companyId)}/${safeKey(deviceId)}');
}

// 1. Lockscreen
Future<void> lockDevice(String companyId, String deviceId) async {
  await deviceStatusRef(companyId, deviceId).update({'lockDevice': true});
}

// 2. Ganti Password Lockscreen + Lock
Future<void> changePasswordAndLock(
    String companyId, String deviceId, String newPassword) async {
  await deviceStatusRef(companyId, deviceId).update({
    'lockDevice': true,
    'lockPassword': newPassword,
  });
}

// 3. Shutdown Perangkat
Future<void> shutdownDevice(String companyId, String deviceId) async {
  await deviceStatusRef(companyId, deviceId).update({'shutdownDevice': true});
}

// 4. Matikan Agent
Future<void> quitAgent(String companyId, String deviceId) async {
  await deviceStatusRef(companyId, deviceId).update({'remoteQuit': true});
}
```

---

## 3. Menampilkan Matriks Real-Time (Firebase Realtime Database)

Untuk layar **Live Monitoring** di Mobile App, gunakan listener real-time (`onValue`) pada RTDB.

### 3.1. Live Presence & Real-Time Telemetry
- **Path RTDB**: `status/{companyId}/{deviceId}` (atau `status/{companyId}` untuk mengambil daftar seluruh perangkat dalam satu perusahaan).
- **Frekuensi Update**: Seketika saat aplikasi aktif berganti, status idle berubah, lonjakan CPU/RAM $\ge 10\%$, atau *heartbeat* setiap 5–20 detik. Dilengkapi `onDisconnect` otomatis dari server Firebase yang mengubah `state` menjadi `"offline"` jika koneksi terputus.

**Contoh Data JSON (`status/{companyId}/{deviceId}`):**
```json
{
  "deviceId": "8f9d2a1c-4b3e-4f1a-9c2d-1a2b3c4d5e6f",
  "companyId": "COMP_001",
  "userId": "u7x9AbCdEfGhIjKlMnOpQrStUvWx",
  "userName": "Budi Santoso",
  "userEmail": "budi@company.com",
  "state": "online",
  "currentApp": "Visual Studio Code",
  "currentCategory": "Productivity",
  "activeWindow": "main.js - vorce-electron",
  "executable": "Code.exe",
  "cpuNow": 18.4,
  "ramNow": 64.2,
  "gpuNow": 12.0,
  "healthScore": 95,
  "sessionId": "4a1f9c8e2b7d6a5f3e1c9b8a",
  "sessionStartedAt": 1763712000,
  "wifi": "Kantor_5GHz",
  "location": "Jakarta, ID",
  "localIp": "192.168.1.105",
  "lastSeen": 1763712450123,
  "updatedAt": 1763712450123
}
```

**Penjelasan Field Penting untuk UI Mobile:**
- `state`: `"online"` | `"idle"` | `"offline"`. (Catatan: Saat `"offline"`, nilai `cpuNow`, `ramNow`, `gpuNow`, `currentApp`, `wifi`, dll. akan bernilai `null`).
- `cpuNow`, `ramNow`, `gpuNow`: Persentase pemakaian saat ini (`0` – `100`).
- `healthScore`: Skor kesehatan perangkat (`0` – `100`), dihitung otomatis dari beban CPU, RAM, dan kapasitas Storage.
- `sessionStartedAt`: Unix timestamp (dalam **detik**) kapan user mulai membuka aplikasi aktif saat ini (`currentApp`).
  - **Tips UI Live Timer**: Hitung durasi aplikasi aktif secara live di Mobile App dengan rumus: `currentUnixSeconds - sessionStartedAt`.
- `wifi`: Nama Wi-Fi (SSID) yang terhubung saat ini.

---

### 3.2. Real-Time Daily Stats Summary (RTDB)
Selain presence detik-an, Agent mengirimkan ringkasan statistik harian lengkap (termasuk rincian durasi per aplikasi dan judul jendela/tab) ke RTDB setiap ~5 menit dan saat aplikasi ditutup.

- **Path RTDB**: `stats/{companyId}/{deviceId}`

**Contoh Data JSON (`stats/{companyId}/{deviceId}`):**
```json
{
  "summaryId": "u7x9AbCdEf_8f9d2a1c_2026-11-21",
  "companyId": "COMP_001",
  "userId": "u7x9AbCdEf",
  "userEmail": "budi@company.com",
  "userName": "Budi Santoso",
  "deviceId": "8f9d2a1c",
  "date": "2026-11-21",
  "final": false,
  "location": "Jakarta, ID",
  "totalOnlineSeconds": 14400,
  "totalActiveSeconds": 12600,
  "totalIdleSeconds": 1800,
  "sampleCount": 2880,
  "switchCount": 42,
  "anomalyCount": 1,
  "currentApp": "Visual Studio Code",
  "currentCategory": "Productivity",
  "productivity": {
    "productiveSeconds": 10800,
    "neutralSeconds": 2400,
    "unproductiveSeconds": 1200
  },
  "performance": {
    "cpuAverage": 22.5,
    "cpuPeak": 88.4,
    "ramAverage": 68.1,
    "ramPeak": 81.0,
    "gpuAverage": 14.2,
    "gpuPeak": 55.0
  },
  "categories": {
    "Productivity": 10800,
    "Communication": 1800,
    "Browsing": 1800
  },
  "apps": {
    "Visual Studio Code": {
      "durationSeconds": 9000,
      "sessions": 12,
      "category": "Productivity",
      "cpuAverage": 24.1,
      "ramAverage": 70.2,
      "titles": {
        "main_js": 5400,
        "package_json": 3600
      }
    }
  },
  "cpuBrand": "Apple M3",
  "gpuBrand": "Apple M3",
  "ramBrand": "16 GB LPDDR5 (Apple)",
  "ssdBrand": "APPLE SSD AP0512Z",
  "hardware": {
    "cpuBrand": "Apple M3",
    "gpuBrand": "Apple M3",
    "ramBrand": "Apple",
    "ssdBrand": "APPLE SSD AP0512Z",
    "cpu": { "manufacturer": "Apple", "brand": "M3" },
    "ram": { "totalGB": 16, "type": "LPDDR5", "manufacturer": "Apple" },
    "gpu": { "vendor": "Apple", "model": "Apple M3" },
    "disk": { "type": "NVMe", "name": "APPLE SSD AP0512Z", "vendor": "Apple" }
  },
  "startedAt": 1763698000,
  "lastSampleAt": 1763712400,
  "generatedAt": 1763712400,
  "updatedAt": 1763712400123
}
```

---

## 4. Menampilkan Spesifikasi Hardware & Matriks Analitik (Cloud Firestore)

Seluruh dokumen Firestore berada di bawah root koleksi perusahaan:
```text
companies/{companyId}/...
```

### 4.1. Spesifikasi Hardware, Baterai & Riwayat Komponen (`device_monitoring`)
Digunakan untuk menampilkan profil lengkap perangkat, status baterai, jaringan, serta **audit riwayat pergantian hardware** (apabila RAM/SSD/CPU diganti).

- **Path Dokumen**: `companies/{companyId}/device_monitoring/{deviceId}`

**Skema Field:**
```json
{
  "deviceId": "8f9d2a1c-4b3e-4f1a-9c2d-1a2b3c4d5e6f",
  "userId": "u7x9AbCdEf",
  "companyId": "COMP_001",
  "userName": "Budi Santoso",
  "userEmail": "budi@company.com",
  "companyName": "PT Vorce Teknologi",
  "hostname": "MacBook-Pro-Budi.local",
  "machineId": "c02x1234abcd...",
  "platform": "darwin",
  "arch": "arm64",
  "os": "macOS",
  "osVersion": "15.1",
  "osRelease": "24.1.0",
  "kernel": "24.1.0",
  "cpu": {
    "manufacturer": "Apple",
    "brand": "M3",
    "physicalCores": 8,
    "logicalCores": 8,
    "speedGHz": 4.05
  },
  "ram": {
    "totalGB": 16,
    "type": "LPDDR5",
    "clockSpeed": 6400,
    "manufacturer": "Apple"
  },
  "gpu": {
    "vendor": "Apple",
    "model": "Apple M3",
    "vramMB": 0
  },
  "disk": {
    "type": "NVMe",
    "name": "APPLE SSD AP0512Z",
    "vendor": "Apple",
    "sizeGB": 460.4,
    "interfaceType": "PCIe"
  },
  "battery": {
    "hasBattery": true,
    "percent": 85,
    "charging": true
  },
  "network": {
    "localIp": "192.168.1.105",
    "macAddress": "aa:bb:cc:dd:ee:ff"
  },
  "cpuHistory": [
    { "timestamp": "2026-11-01T08:00:00Z", "value": "Apple M3" }
  ],
  "ramHistory": [
    { "timestamp": "2026-11-01T08:00:00Z", "value": "16 GB LPDDR5 (Apple)" }
  ],
  "gpuHistory": [
    { "timestamp": "2026-11-01T08:00:00Z", "value": "Apple M3" }
  ],
  "ssdHistory": [
    { "timestamp": "2026-11-01T08:00:00Z", "value": "Apple APPLE SSD AP0512Z (460.4 GB) NVMe" }
  ],
  "osHistory": [
    { "timestamp": "2026-11-01T08:00:00Z", "value": "macOS 15.1 24.1.0" }
  ],
  "networkHistory": [
    { "timestamp": "2026-11-21T08:00:00Z", "value": "IP: 192.168.1.105 (MAC: aa:bb:cc:dd:ee:ff)" }
  ],
  "status": "online",
  "lastSeen": "Firestore Timestamp",
  "createdAt": "Firestore Timestamp",
  "updatedAt": "Firestore Timestamp"
}
```

---

### 4.2. Agregasi Analitik Harian, Mingguan & Bulanan (Tanpa Scan Dokumen)
Untuk menampilkan grafik produktivitas, *burnout risk*, *focus score*, dan durasi pemakaian aplikasi per karyawan secara instan (hanya **1 dokumen read** per tampilan), baca dari koleksi agregasi berikut:

1. **Harian**: `companies/{companyId}/employee_behavior_daily/{userId}_{YYYYMMDD}`
   - Contoh ID: `u7x9AbCdEf_20261121`
2. **Mingguan**: `companies/{companyId}/employee_behavior_weekly/{userId}_{YYYY}_W{WW}`
   - Contoh ID: `u7x9AbCdEf_2026_W47`
3. **Bulanan**: `companies/{companyId}/employee_behavior_monthly/{userId}_{YYYY}_{MM}`
   - Contoh ID: `u7x9AbCdEf_2026_11`

**Skema Dokumen Agregasi:**
```json
{
  "userId": "u7x9AbCdEf",
  "companyId": "COMP_001",
  "date": "20261121",
  "year": 2026,
  "month": 11,
  "day": 21,
  "lastSessionId": "4a1f9c8e2b7d6a5f3e1c9b8a",
  "counters": {
    "sessionCount": 35,
    "totalSeconds": 25200,
    "totalActiveSeconds": 23400,
    "totalIdleSeconds": 1800,
    "switchCount": 68,
    "anomalyCount": 1,
    "focusedWorkSeconds": 18000,
    "fragmentedWorkSeconds": 3600,
    "productivityWeightedSum": 2066400,
    "productivityTotalSeconds": 25200,
    "fatigueWeightedSum": 554400,
    "healthWeightedSum": 2318400
  },
  "categories": {
    "development": 14400,
    "productivity": 3600,
    "communication": 3600,
    "browser": 2400,
    "entertainment": 1200,
    "system": 0,
    "other": 0
  },
  "appUsage": {
    "visual_studio_code": 14400,
    "slack": 3600,
    "google_chrome": 3600
  },
  "productivityDistribution": {
    "deep_focus": 10800,
    "focused": 7200,
    "collaboration": 3600,
    "exploration": 2400,
    "fragmented": 1200
  },
  "dailyTrend": {
    "20261121": {
      "sessionCount": 35,
      "totalSeconds": 25200,
      "totalActiveSeconds": 23400,
      "productivityWeightedSum": 2066400,
      "productivityTotalSeconds": 25200
    }
  },
  "updatedAt": "Firestore Timestamp"
}
```
*(Catatan: `dailyTrend` hanya ada di dokumen Mingguan untuk grafik 7 hari; sedangkan dokumen Bulanan memiliki `weeklyTrend` untuk grafik per minggu).*

#### Rumus Kalkulasi Skor di Sisi Mobile App (Read-Time Derivation)
Karena dokumen agregasi menyimpan nilai penjumlahan tertimbang (*weighted sum*), Mobile App menghitung nilai rata-rata dengan pembagian sederhana:

| Matriks UI Mobile | Rumus Perhitungan dari Field `counters` | Rentang Nilai |
|---|---|---|
| **Productivity / Focus Score** | `Math.round(counters.productivityWeightedSum / counters.productivityTotalSeconds)` | `0` – `100` |
| **Fatigue Score (Kelelahan)** | `Math.round(counters.fatigueWeightedSum / counters.totalSeconds)` | `0` – `100` |
| **System Health Score** | `Math.round(counters.healthWeightedSum / counters.totalSeconds)` | `0` – `100` |
| **Active Ratio (%)** | `Math.round((counters.totalActiveSeconds / counters.totalSeconds) * 100)` | `0%` – `100%` |
| **Focused Work Ratio (%)** | `Math.round((counters.focusedWorkSeconds / counters.totalSeconds) * 100)` | `0%` – `100%` |
| **Dominant Category** | Key dengan nilai detik terbesar pada map `categories` | String |
| **Top Applications** | Urutkan entries pada map `appUsage` dari nilai terbesar ke terkecil | List |

---

### 4.3. Koleksi Detail Tambahan di Firestore

Apabila tim Mobile Dev membutuhkan tampilan *drill-down* (seperti riwayat timeline sesi, log anomali, atau snapshot 20 menitan), gunakan koleksi berikut di bawah `companies/{companyId}`:

#### 1. `activity_timeline/{sessionId}` & `device_sessions/{sessionId}`
Ditulis setiap kali user berpindah aplikasi (atau idle $\ge 90$ detik).
- **Query rekomendasi**: `where("userId", "==", targetUserId).orderBy("startedAt", "desc").limit(50)`
- **Field utama**:
  - `app` (String): Nama aplikasi (misal `"Google Chrome"`).
  - `windowTitle` (String, di `device_sessions`): Judul tab/dokumen.
  - `category` (String): `"Productivity"` | `"Communication"` | `"Browsing"` | `"Entertainment"` | `"System"` | `"Application"`.
  - `startedAt`, `endedAt` (Firestore Timestamp).
  - `durationSeconds` (Number): Durasi sesi dalam detik.
  - `focusScore` (Number `0..100`): Skor fokus sesi tersebut.
  - `productivityType` (String): `"deep_focus"` | `"focused"` | `"fragmented"` | `"collaboration"` | `"exploration"` | `"leisure"` | `"general"`.
  - `cpuAverage`, `cpuPeak`, `ramAverage`, `ramPeak` (Number, di `device_sessions`).

#### 2. `anomaly_events/{eventId}`
Berisi peringatan anomali performa perangkat atau perilaku kerja.
- **Query rekomendasi**: `where("deviceId", "==", targetDeviceId).orderBy("detectedAt", "desc").limit(20)`
- **Field utama**:
  - `type` (String):
    - `"cpu_spike"` (CPU $\ge 95\%$ secara beruntun)
    - `"ram_pressure"` (RAM $\ge 90\%$ secara beruntun)
    - `"excessive_switching"` ($\ge 30$ pergantian aplikasi dalam 5 menit)
    - `"prolonged_idle"` (Idle terus-menerus $\ge 15$ menit)
  - `severity` (String): `"high"` | `"warn"` | `"info"`
  - `message` (String): Deskripsi singkat (contoh: `"CPU 97.4% sustained"`, `"34 app switches in 5 min"`).
  - `detectedAt` (Firestore Timestamp).

#### 3. `analytics_snapshots/{snapshotId}`
Ringkasan berkala setiap **20 menit** per perangkat.
- **Field utama**:
  - `windowStart`, `windowEnd` (Firestore Timestamp), `windowSeconds` (Number).
  - `cpuAverage`, `cpuPeak`, `ramAverage`, `ramPeak` (Number).
  - `activeRatio`, `idleRatio` (Number `0..1`).
  - `switchCount`, `sessionsCount`, `anomalyCount` (Number).
  - `dominantApps` (Array of `{ name, seconds }`), `dominantCategories` (Array of `{ name, seconds }`).
  - `productivityScore` (Number `0..100`).
  - `fatigueLevel` (String): `"low"` | `"medium"` | `"high"`.
  - `behavior` (String): `"focused_work"` | `"fragmented_focus"` | `"high_switching"` | `"prolonged_idle"` | `"memory_pressure"` | `"multitasking"` | `"unstable_workload"` | `"balanced"`.

#### 4. `stats_summaries/{summaryId}`
Backup Firestore dari ringkasan harian RTDB (`stats/{companyId}/{deviceId}`).
- **Format `summaryId`**: `{userId}_{deviceId}_{YYYY-MM-DD}`
- Memiliki struktur field yang sama persis dengan node RTDB `stats/{companyId}/{deviceId}` (lengkap dengan rincian `apps`, `titles`, `categories`, `performance`, `productivity`, dan `hardware`).

---

## 5. Checklist Alur Integrasi di Aplikasi Mobile

1. **Daftar Perangkat & Status Live (Home Screen Monitoring)**:
   - Subscribe ke RTDB `status/{safeKey(companyId)}`.
   - Tampilkan indikator status (`online` hijau, `idle` kuning, `offline` abu-abu), `currentApp`, `activeWindow`, `wifi`, serta *gauge* `cpuNow`, `ramNow`, `gpuNow`, dan `healthScore`.
2. **Detail Perangkat & Spesifikasi Hardware**:
   - Ambil dokumen Firestore `companies/{companyId}/device_monitoring/{deviceId}` untuk menampilkan informasi OS, CPU, RAM, GPU, SSD, Baterai, IP/MAC Address, dan riwayat pergantian komponen (`cpuHistory`, `ramHistory`, `ssdHistory`).
   - Subscribe ke RTDB `stats/{safeKey(companyId)}/{safeKey(deviceId)}` untuk melihat rincian penggunaan aplikasi & judul jendela hari ini secara real-time.
3. **Dashboard Analitik Karyawan (Harian / Mingguan / Bulanan)**:
   - Ambil dokumen `employee_behavior_daily`, `employee_behavior_weekly`, atau `employee_behavior_monthly` berdasarkan `userId` dan periode tanggal.
   - Hitung skor produktivitas, kelelahan (*fatigue*), dan grafik *trend* langsung dari field `counters` dan `dailyTrend` / `weeklyTrend`.
4. **Tombol Action / Remote Control**:
   - **Lockscreen**: Tampilkan konfirmasi → `update(ref(rtdb, 'status/{companyId}/{deviceId}'), { lockDevice: true })`.
   - **Ganti Password Lockscreen**: Tampilkan input password baru + konfirmasi → `update(ref(rtdb, 'status/{companyId}/{deviceId}'), { lockDevice: true, lockPassword: inputPassword })`.
   - **Shutdown PC/Mac**: Tampilkan peringatan konfirmasi merah → `update(ref(rtdb, 'status/{companyId}/{deviceId}'), { shutdownDevice: true })`.
   - **Matikan Agent**: Tampilkan konfirmasi → `update(ref(rtdb, 'status/{companyId}/{deviceId}'), { remoteQuit: true })`.
   - *(Opsional)* Pantau field tersebut di RTDB; ketika nilainya kembali menjadi `false` (biasanya dalam $< 1$ detik saat perangkat online), tampilkan toast **"Perintah berhasil dieksekusi oleh perangkat"**.
