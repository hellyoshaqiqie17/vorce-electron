# Masalah Integrasi RTDB - Electron Agent

## Ringkasan
Dashboard web sudah berhasil connect ke RTDB dan menerima data real-time, namun ada beberapa masalah kritis yang perlu diperbaiki di sisi Electron agent agar data tampil dengan benar.

---

## Masalah 1: UserId Tidak Match

### Deskripsi
- **UserId di RTDB**: `pRy5r5Oubdh6HOocdYB3OOOQoKI2` (format Firebase Auth UID)
- **UserId di API Users**: Format berbeda atau field berbeda
- **Akibat**: Dashboard tidak bisa resolve nama user dari API

### Log Evidence
```
[Dashboard] Users loaded: 8 users: [...]
[Dashboard] Workforce mapping userId: pRy5r5Oubdh6HOocdYB3OOOQoKI2 
  -> resolvedName tetap userId (tidak ketemu di API)
```

### Solusi yang Diperlukan
**Electron harus kirim `userEmail` sebagai identifier utama**, bukan hanya `userId`:

```javascript
// SAAT INI (kurang lengkap):
{
  userId: "pRy5r5Oubdh6HOocdYB3OOOQoKI2",
  // userEmail tidak ada!
}

// HARUSNYA:
{
  userId: "pRy5r5Oubdh6HOocdYB3OOOQoKI2",
  userEmail: "hellyoshaqiqie9@gmail.com",  // <- TAMBAHKAN
  userName: "hellyoshaqiqie"               // <- TAMBAHKAN
}
```

---

## Masalah 2: UserName Kosong di RTDB

### Deskripsi
Field `userName` tidak terkirim ke RTDB, sehingga dashboard fallback ke `userId`.

### Current RTDB Payload
```json
{
  "deviceId": "desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb",
  "companyId": "CTD96L",
  "userId": "pRy5r5Oubdh6HOocdYB3OOOQoKI2",
  // userName: MISSING!
  // userEmail: MISSING!
  "state": "online",
  "currentApp": "Microsoft Edge",
  "currentCategory": "Browsing",
  "activeWindow": "Vorce | Platform Kolaborasi...",
  "cpuNow": 42.8,
  "ramNow": 89.9,
  "healthScore": 75,
  "lastSeen": 1779264992350,
  "updatedAt": 1779264992350
}
```

### Solusi yang Diperlukan
Tambahkan field berikut ke payload RTDB:

```javascript
// Pada saat publish ke RTDB /status/{companyId}/{deviceId}
const presencePayload = {
  deviceId: deviceInfo.deviceId,
  companyId: deviceInfo.companyId,
  
  // Identitas User - PENTING!
  userId: currentUser.uid,           // Firebase Auth UID
  userEmail: currentUser.email,      // <- WAJIB ADA
  userName: currentUser.displayName || currentUser.email?.split('@')[0], // <- WAJIB ADA
  
  // Status Device
  state: computeState(), // "online" | "idle" | "away"
  currentApp: appTracker.currentApp,
  currentCategory: categorizeApp(appTracker.currentApp),
  activeWindow: windowTracker.activeWindow,
  executable: appTracker.executablePath,
  
  // Performance
  cpuNow: systemMetrics.cpuPercent,
  ramNow: systemMetrics.ramPercent,
  healthScore: computeHealthScore(),
  
  // Timestamps
  sessionId: currentSession.id,
  sessionStartedAt: currentSession.startedAt,
  lastSeen: Date.now(),
  updatedAt: Date.now()
};
```

---

## Masalah 3: Path Stats Tidak Sesuai

### Current Path
```
/stats/{companyId}/{deviceId}   <- level device
```

### Masalah
Dashboard listen di level company untuk mendapatkan semua device:
```javascript
// Dashboard listen:
ref(rtdb, `stats/${companyId}`)  // level company
```

Tapi data hanya ada di:
```
/stats/CTD96L/desktop_hellyoshaqiqie_...
```

Ini sebenarnya OK karena Firebase RTDB `onValue` pada parent akan trigger dengan seluruh children.

### Solusi: Pastikan Data Structure Benar
```
/stats/{companyId}/{deviceId}/   <- object dengan field lengkap
```

Contoh data yang lengkap:
```json
{
  "summaryId": "USER_ID_desktop_hellyoshaqiqie_..._2026-05-20",
  "companyId": "CTD96L",
  "userId": "pRy5r5Oubdh6HOocdYB3OOOQoKI2",
  "deviceId": "desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb",
  "date": "2026-05-20",
  "final": false,
  
  // User Info
  "userEmail": "hellyoshaqiqie9@gmail.com",
  "userName": "hellyoshaqiqie",
  
  // Aggregates
  "totalOnlineSeconds": 18000,
  "totalActiveSeconds": 14400,
  "totalIdleSeconds": 3600,
  "sampleCount": 3600,
  "switchCount": 42,
  "anomalyCount": 1,
  
  // Current
  "currentApp": "Microsoft Edge",
  "currentCategory": "Browsing",
  
  // App breakdown
  "apps": {
    "Microsoft Edge": {
      "durationSeconds": 7200,
      "sessions": 8,
      "category": "Browsing",
      "cpuAverage": 13.2,
      "ramAverage": 61.8
    }
  },
  
  // Categories breakdown
  "categories": {
    "Browsing": 7200,
    "Productivity": 4200
  },
  
  // Productivity
  "productivity": {
    "productiveSeconds": 7200,
    "neutralSeconds": 6000,
    "unproductiveSeconds": 1200
  },
  
  // Performance
  "performance": {
    "cpuAverage": 15.4,
    "cpuPeak": 91.2,
    "ramAverage": 64.3,
    "ramPeak": 82.8
  },
  
  // Timestamps (gunakan Unix timestamp dalam milisecond)
  "startedAt": 1779174000000,
  "lastSampleAt": 1779180000000,
  "generatedAt": 1779180000000,
  "updatedAt": 1779264992350
}
```

---

## Masalah 4: Status Online/Offline

### Deskripsi
Meskipun data RTDB ada, status di dashboard tetap "OFFLINE".

### Penyebab
Dashboard menggunakan `effectivePresenceState()` yang cek staleness berdasarkan `lastHeartbeat`:

```javascript
// Dashboard logic:
if (Date.now() - lastHeartbeatMs > staleAfterMs) {
  return "offline";
}
```

### Solusi: Pastikan Update Frekuensi
Electron harus update RTDB **minimal setiap 5 detik**:

```javascript
// Electron side
const UPDATE_INTERVAL = 5000; // 5 detik

setInterval(() => {
  updatePresenceRTDB({
    ...currentData,
    lastSeen: Date.now(),  // <- UPDATE TIMESTAMP!
    updatedAt: Date.now()
  });
}, UPDATE_INTERVAL);
```

---

## Checklist Perubahan Electron

### [ ] 1. Tambahkan userEmail dan userName ke RTDB payload
```javascript
presencePayload.userEmail = currentUser.email;
presencePayload.userName = currentUser.displayName || extractNameFromEmail(currentUser.email);
```

### [ ] 2. Tambahkan userEmail dan userName ke Stats payload
```javascript
statsPayload.userEmail = currentUser.email;
statsPayload.userName = currentUser.displayName || extractNameFromEmail(currentUser.email);
```

### [ ] 3. Pastikan Update Interval 5 detik
```javascript
setInterval(publishToRTDB, 5000);
```

### [ ] 4. Pastikan Field Lengkap
Ceklist field yang WAJIB ada:
- [ ] `userId` - Firebase Auth UID
- [ ] `userEmail` - Email user
- [ ] `userName` - Display name
- [ ] `companyId` - Company ID
- [ ] `deviceId` - Unique device identifier
- [ ] `state` - online/idle/away/offline
- [ ] `lastSeen` - Timestamp (ms)
- [ ] `updatedAt` - Timestamp (ms)

---

## Testing

Setelah perubahan, cek di Firebase Console RTDB:

1. Buka `/status/{companyId}/{deviceId}`
2. Pastikan field `userEmail` dan `userName` terisi
3. Pastikan `lastSeen` terupdate setiap 5 detik

Dashboard seharusnya otomatis menampilkan:
- Nama user (bukan userId)
- Status Online (bukan Offline)
- Data stats lengkap

---

## Catatan Penting

### UserId Matching
Dashboard menggunakan `resolveUserName(users, userId)` yang akan:
1. Cari user di API berdasarkan `userId`
2. Kalau tidak ketemu, fallback ke `userEmail`
3. Kalau tetap tidak ketemu, fallback ke `userName` dari RTDB

**Jadi jika Electron kirim `userEmail` yang benar, nama akan tampil meskipun userId tidak match.**

### Timestamp Format
Gunakan **miliseconds** (Date.now()), bukan seconds:
```javascript
// BENAR
lastSeen: Date.now()  // 1779264992350

// SALAH
lastSeen: Math.floor(Date.now() / 1000)  // 1779264992
```

---

## Referensi

- Dashboard RTDB Service: `src/services/rtdbIntelligenceService.ts`
- Dashboard Page: `src/app/admin/intelligence/page.tsx`
- RTDB Rules: `rtdb-rules.json`
