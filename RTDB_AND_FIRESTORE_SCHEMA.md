# Skema Baru Electron Agent - RTDB & Firestore

## 1. Presence Realtime: Online / Idle / Offline

### Path RTDB
```
/status/{companyId}/{deviceId}
```

Contoh:
```
/status/CTD96L/desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb
```

### Struktur Data
```json
{
  "deviceId": "desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb",
  "companyId": "CTD96L",
  "userId": "USER_ID",
  "userEmail": "user@example.com",
  "userName": "User Name",
  "state": "online",
  "currentApp": "Code.exe",
  "currentCategory": "Productivity",
  "activeWindow": "project - Visual Studio Code",
  "executable": "Code.exe",
  "cpuNow": 12.3,
  "ramNow": 68.4,
  "healthScore": 92,
  "sessionId": "SESSION_ID_OR_NULL",
  "sessionStartedAt": 1710000000,
  "lastSeen": 1710000000000,
  "updatedAt": 1710000000000
}
```

### Nilai `state`
- `online`
- `idle`
- `away`
- `offline`

### Interval Update
- **5 detik sekali** (default)

### Dashboard Logic
```js
const isOnline =
  presence?.state !== "offline" &&
  Date.now() - presence?.lastSeen < 15000;
```
Rekomendasi: anggap offline/stale jika `lastSeen` lebih dari 15-30 detik.

---

## 2. RTDB Stats Summary Sementara

### Path RTDB
```
/stats/{companyId}/{deviceId}
```

Contoh:
```
/stats/CTD96L/desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb
```

### Interval Update
- **5 menit sekali** (default)

### Struktur Data
```json
{
  "summaryId": "USER_ID_desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb_2026-05-19",
  "companyId": "CTD96L",
  "userId": "USER_ID",
  "deviceId": "desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb",
  "date": "2026-05-19",
  "final": false,
  "totalOnlineSeconds": 18000,
  "totalActiveSeconds": 14400,
  "totalIdleSeconds": 3600,
  "sampleCount": 3600,
  "switchCount": 42,
  "anomalyCount": 1,
  "currentApp": "Code.exe",
  "currentCategory": "Productivity",
  "apps": {
    "Code.exe": {
      "durationSeconds": 7200,
      "sessions": 8,
      "category": "Productivity",
      "cpuAverage": 13.2,
      "ramAverage": 61.8
    }
  },
  "categories": {
    "Productivity": 7200,
    "Browsing": 4200
  },
  "productivity": {
    "productiveSeconds": 7200,
    "neutralSeconds": 6000,
    "unproductiveSeconds": 1200
  },
  "performance": {
    "cpuAverage": 15.4,
    "cpuPeak": 91.2,
    "ramAverage": 64.3,
    "ramPeak": 82.8
  },
  "startedAt": 1779174000,
  "lastSampleAt": 1779180000,
  "generatedAt": 1779180000,
  "updatedAt": 1779180000000
}
```

---

## 3. Firestore Final Summary

### Path Firestore
```
companies/{companyId}/stats_summaries/{summaryId}
```

Contoh:
```
companies/CTD96L/stats_summaries/USER_ID_desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb_2026-05-19
```

### Kapan Ditulis?
- **Saat Electron stop / close** (default)
- Bukan tiap 5 menit

### Struktur Data
Mirip RTDB stats summary, tapi field waktu disimpan sebagai Firestore Timestamp:
- `startedAt`
- `lastSampleAt`
- `generatedAt`
- `updatedAt`

---

## 4. Dashboard Web Integration

### Firebase Config
Pastikan dashboard punya `databaseURL`:
```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "vorceagent",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
  databaseURL: "https://vorceagent-default-rtdb.asia-southeast1.firebasedatabase.app"
};
```

### Listen Presence (RTDB)
```js
import { getDatabase, ref, onValue } from "firebase/database";

const db = getDatabase();
const presenceRef = ref(db, `status/${companyId}/${deviceId}`);

onValue(presenceRef, (snapshot) => {
  const presence = snapshot.val();
  // Update UI
});
```

### Listen Stats (RTDB)
```js
const statsRef = ref(db, `stats/${companyId}/${deviceId}`);

onValue(statsRef, (snapshot) => {
  const stats = snapshot.val();
  // Update UI
});
```

### Listen Final Summary (Firestore)
```js
import { collection, query, where, onSnapshot } from "firebase/firestore";

const summariesRef = collection(firestore, "companies", companyId, "stats_summaries");
const q = query(summariesRef, where("date", "==", selectedDate));

onSnapshot(q, (snapshot) => {
  const summaries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  // Update UI
});
```

---

## 5. Mapping Dashboard Baru

| Fitur Dashboard | Source | Path |
|---|---|---|
| Device Online/Offline | RTDB | `/status/{companyId}/{deviceId}` |
| Live Current App / CPU / RAM | RTDB | `/status/{companyId}/{deviceId}` |
| Live Accumulated Stats | RTDB | `/stats/{companyId}/{deviceId}` |
| Daily / Final Report | Firestore | `companies/{companyId}/stats_summaries` |

---

## 6. Summary Skema Lengkap

```
Electron sample tiap 5 detik
        |
        |-- RTDB /status/{companyId}/{deviceId}
        |      realtime online/offline/current app
        |
        |-- Local buffer file
        |      checkpoint tiap 1 menit
        |
        |-- RTDB /stats/{companyId}/{deviceId}
        |      rolling summary tiap 5 menit
        |
        |-- Firestore companies/{companyId}/stats_summaries/{summaryId}
               final summary saat Electron close/stop
```

---

## 7. Yang Harus Diubah di Web Dashboard

1. **Online/offline**: pindah dari Firestore ke RTDB `/status/{companyId}`
2. **Live current app / CPU / RAM**: ambil dari RTDB `/status/{companyId}/{deviceId}`
3. **Live accumulated stats**: ambil dari RTDB `/stats/{companyId}/{deviceId}`
4. **Historical/final report**: ambil dari Firestore `companies/{companyId}/stats_summaries`
5. **Pastikan Firebase dashboard config punya `databaseURL`**
