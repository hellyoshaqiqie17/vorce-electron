# Dashboard Data Integration Guide

## Overview

Dashboard Vorce sekarang mengambil data dari **dua sumber** yang berbeda:

| Sumber | Lokasi | Data | Update Frequency |
|--------|--------|------|------------------|
| **Firebase Realtime Database (RTDB)** | `/stats/{companyId}/{deviceId}` | Live accumulated stats, current app, real-time metrics | Setiap 5 menit (rolling) |
| **Cloud Firestore** | `companies/{companyId}/stats_summaries/{summaryId}` | Final summary, historical report, end-of-day data | Hanya saat Electron close/stop |

---

## 1. Realtime Database (RTDB) - Live Accumulated Stats

### Path
```
/stats/{companyId}/{deviceId}
```

Contoh:
```
/stats/CTD96L/desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb
```

### Karakteristik
- **Rolling summary**: Data terus diakumulasi selama device online
- **`final: false`**: Menandakan ini adalah data sementara/live
- **Overwrite**: Setiap update menimpa data sebelumnya
- **Real-time**: Update setiap 5 menit (bisa diubah via config)

### Struktur Data
```json
{
  "summaryId": "pRy5r5Oubdh6HOocdYB3OOOQoKI2_desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb_2026-05-20",
  "companyId": "CTD96L",
  "userId": "pRy5r5Oubdh6HOocdYB3OOOQoKI2",
  "deviceId": "desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb",
  "date": "2026-05-20",
  "final": false,
  
  "totalOnlineSeconds": 2416,
  "totalActiveSeconds": 2201,
  "totalIdleSeconds": 215,
  "sampleCount": 464,
  "switchCount": 89,
  "anomalyCount": 11,
  
  "currentApp": "Microsoft Edge",
  "currentCategory": "Browsing",
  
  "apps": {
    "Microsoft Edge": {
      "durationSeconds": 7200,
      "sessions": 8,
      "category": "Browsing",
      "cpuAverage": 13.2,
      "ramAverage": 61.8
    }
  },
  
  "categories": {
    "Browsing": 7200,
    "Productivity": 4200
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
  
  "startedAt": 1779163200,
  "lastSampleAt": 1779170400,
  "generatedAt": 1779170427,
  "updatedAt": 1779170427000
}
```

### Field Penting untuk Dashboard Live

| Field | Kegunaan |
|-------|----------|
| `currentApp` | Aplikasi yang sedang aktif |
| `currentCategory` | Kategori aplikasi (Productivity, Browsing, dll) |
| `totalOnlineSeconds` | Total waktu online hari ini |
| `totalActiveSeconds` | Total waktu aktif (tidak idle) |
| `totalIdleSeconds` | Total waktu idle |
| `apps` | Breakdown per aplikasi |
| `categories` | Breakdown per kategori |
| `productivity` | Metrics produktivitas |
| `performance` | Metrics CPU/RAM |
| `final` | Selalu `false` untuk live data |

---

## 2. Cloud Firestore - Final Summary

### Path
```
companies/{companyId}/stats_summaries/{summaryId}
```

Contoh document ID:
```
pRy5r5Oubdh6HOocdYB3OOOQoKI2_desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb_2026-05-20
```

Format: `{userId}_{deviceId}_{YYYY-MM-DD}`

### Karakteristik
- **Final summary**: Data final setelah user menutup Electron
- **`final: true`**: Menandakan ini adalah data final
- **Immutable**: Tidak berubah setelah ditulis
- **Historical**: Dipakai untuk laporan harian/mingguan/bulanan

### Kapan Ditulis?
- Saat Electron **benar-benar ditutup** (bukan minimize)
- Saat user **logout** atau **stop monitoring**
- Tidak ditulis saat minimize ke tray

### Struktur Data
Mirip RTDB, tapi dengan perbedaan:
```json
{
  "final": true,
  "startedAt": "Timestamp",      // Firestore Timestamp
  "lastSampleAt": "Timestamp",     // Firestore Timestamp
  "generatedAt": "Timestamp",      // Firestore Timestamp
  "updatedAt": "Timestamp"         // Firestore Timestamp
}
```

---

## 3. Dashboard Integration Strategy

### A. Live View (Real-time)

**Source**: RTDB `/stats/{companyId}/{deviceId}`

```typescript
import { getDatabase, ref, onValue } from "firebase/database";

const db = getDatabase();

// Listen satu device
const deviceStatsRef = ref(
  db, 
  `stats/${companyId}/${deviceId}`
);

onValue(deviceStatsRef, (snapshot) => {
  const liveStats = snapshot.val();
  
  if (!liveStats) {
    // Device belum ada data atau offline
    return;
  }
  
  // Update UI live
  updateDashboard({
    currentApp: liveStats.currentApp,
    currentCategory: liveStats.currentCategory,
    totalOnlineSeconds: liveStats.totalOnlineSeconds,
    totalActiveSeconds: liveStats.totalActiveSeconds,
    apps: liveStats.apps,
    categories: liveStats.categories,
    productivity: liveStats.productivity,
    performance: liveStats.performance,
    isLive: true,  // Indikasi ini data live
    isFinal: liveStats.final || false
  });
});
```

### B. Company Overview (Semua Device)

**Source**: RTDB `/stats/{companyId}`

```typescript
const companyStatsRef = ref(db, `stats/${companyId}`);

onValue(companyStatsRef, (snapshot) => {
  const allDevices = snapshot.val() || {};
  
  const deviceList = Object.entries(allDevices).map(([deviceId, stats]) => ({
    deviceId,
    ...stats,
    isLive: true,
    isOnline: stats.state !== "offline" && 
              Date.now() - stats.updatedAt < 300000 // 5 menit
  }));
  
  updateDeviceList(deviceList);
});
```

### C. Historical Report (End-of-Day)

**Source**: Firestore `stats_summaries`

```typescript
import { 
  collection, 
  query, 
  where, 
  getDocs,
  orderBy 
} from "firebase/firestore";

// Query untuk tanggal tertentu
const summariesRef = collection(
  firestore, 
  "companies", 
  companyId, 
  "stats_summaries"
);

const q = query(
  summariesRef,
  where("date", "==", "2026-05-20"),
  where("final", "==", true)
);

const snapshot = await getDocs(q);
const finalSummaries = snapshot.docs.map(doc => ({
  id: doc.id,
  ...doc.data(),
  isLive: false,
  isFinal: true
}));

// Tampilkan laporan harian
updateHistoricalReport(finalSummaries);
```

### D. Hybrid Approach (Recommended)

Gabungkan live + final untuk UX terbaik:

```typescript
function useDeviceStats(companyId: string, deviceId: string) {
  const [liveStats, setLiveStats] = useState(null);
  const [finalStats, setFinalStats] = useState(null);
  
  // 1. Subscribe ke RTDB (live)
  useEffect(() => {
    const statsRef = ref(rtdb, `stats/${companyId}/${deviceId}`);
    return onValue(statsRef, (snap) => {
      setLiveStats(snap.val());
    });
  }, [companyId, deviceId]);
  
  // 2. Fetch final dari Firestore (sekali saat load)
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const summaryId = `${userId}_${deviceId}_${today}`;
    
    const docRef = doc(firestore, 
      "companies", companyId, 
      "stats_summaries", summaryId
    );
    
    getDoc(docRef).then((snap) => {
      if (snap.exists()) {
        setFinalStats(snap.data());
      }
    });
  }, [companyId, deviceId, userId]);
  
  // 3. Return yang lebih fresh
  return {
    // Prioritaskan live stats jika ada dan fresh
    stats: liveStats || finalStats,
    isLive: !!liveStats,
    isFinal: !!finalStats,
    hasLiveData: !!liveStats,
    hasFinalData: !!finalStats
  };
}
```

---

## 4. Presence Status (Online/Offline)

**Source**: RTDB `/status/{companyId}/{deviceId}`

```typescript
const presenceRef = ref(rtdb, `status/${companyId}/${deviceId}`);

onValue(presenceRef, (snapshot) => {
  const presence = snapshot.val();
  
  const isOnline = presence && 
    presence.state !== "offline" &&
    Date.now() - presence.updatedAt < 30000; // 30 detik
  
  updatePresenceIndicator({
    isOnline,
    state: presence?.state || "offline",
    currentApp: presence?.currentApp,
    cpuNow: presence?.cpuNow,
    ramNow: presence?.ramNow,
    lastSeen: presence?.lastSeen
  });
});
```

---

## 5. Complete Dashboard Data Flow

```
┌─────────────────┐     ┌──────────────────┐
│  Electron Agent │     │   Dashboard Web  │
│   (Desktop App) │     │   (React/Next)   │
└────────┬────────┘     └────────┬─────────┘
         │                       │
         │ 1. Realtime presence  │
         │    (setiap 5 detik)   │
         │──────────────────────>│
         │                       │
         │ 2. Stats summary      │
         │    (setiap 5 menit)   │
         │──────────────────────>│
         │                       │
         │                       │ Listen RTDB
         │                       │ /status/...  ───┐
         │                       │ /stats/...    │ Real-time
         │                       │                 │ updates
         │                       │<────────────────┘
         │                       │
         │                       │ Display live data
         │                       │ - Current app
         │                       │ - Active time
         │                       │ - CPU/RAM
         │                       │
         │                       │
         │ 3. Close Electron     │
         │    (user exit app)    │
         │                       │
         │ 4. Final summary      │ Fetch from Firestore
         │    ───────────────>   │ (if needed for report)
         │    Firestore          │
         │    stats_summaries    │
         │                       │
         │                       │ Display historical
         │                       │ - Daily report
         │                       │ - Weekly report
         │                       │ - Monthly report
```

---

## 6. Best Practices

### A. Optimistic UI Updates
```typescript
// Tampilkan data sebelumnya sementara fetch baru
const { data, isLoading } = useDeviceStats(companyId, deviceId);

if (isLoading && !data) {
  return <Skeleton />;  // Loading state
}

// Tampilkan data (bisa jadi stale sementara)
return <StatsCard stats={data} />;
```

### B. Stale Data Detection
```typescript
function isStatsStale(stats: any, maxAgeMs: number = 600000): boolean {
  if (!stats?.updatedAt) return true;
  return Date.now() - stats.updatedAt > maxAgeMs;
}

// Gunakan
if (isStatsStale(liveStats, 10 * 60 * 1000)) {
  showWarning("Data mungkin tidak update. User offline?");
}
```

### C. Error Handling
```typescript
onValue(statsRef, (snapshot) => {
  // Success
}, (error) => {
  console.error("RTDB error:", error);
  // Fallback ke Firestore final summary
  fetchFinalSummary().then(setStats);
});
```

---

## 7. Query Patterns

### A. Get Today's Stats for User
```typescript
const today = new Date().toISOString().slice(0, 10);

// Try RTDB first (live)
const liveRef = ref(rtdb, `stats/${companyId}/${deviceId}`);
const liveSnap = await get(liveRef);

if (liveSnap.exists() && liveSnap.val()?.date === today) {
  return liveSnap.val();  // Return live data
}

// Fallback to Firestore (final)
const finalRef = doc(firestore, 
  "companies", companyId, 
  "stats_summaries", 
  `${userId}_${deviceId}_${today}`
);
const finalSnap = await getDoc(finalRef);

return finalSnap.exists() ? finalSnap.data() : null;
```

### B. Get All Active Users Today
```typescript
const today = new Date().toISOString().slice(0, 10);

const q = query(
  collection(firestore, "companies", companyId, "stats_summaries"),
  where("date", "==", today),
  where("final", "==", true)
);

// Plus RTDB live listener untuk update real-time
const companyStatsRef = ref(rtdb, `stats/${companyId}`);
onValue(companyStatsRef, (snap) => {
  const liveData = snap.val() || {};
  // Merge dengan Firestore data
});
```

---

## 8. Firebase Config Dashboard

Pastikan dashboard web punya kedua konfigurasi:

```typescript
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "vorceagent",
  databaseURL: "https://vorceagent-default-rtdb.asia-southeast1.firebasedatabase.app",
  // ... other config
};

const app = initializeApp(firebaseConfig);

export const firestore = getFirestore(app);
export const rtdb = getDatabase(app);
```

**CATATAN**: `databaseURL` wajib ada untuk RTDB!

---

## 9. Troubleshooting

### Dashboard menunjukkan data lama
- Cek `updatedAt` timestamp
- Pastikan RTDB listener aktif
- Cek console log untuk error permission

### stats_summaries tidak muncul di Firestore
- Pastikan Electron benar-benar ditutup (bukan minimize)
- Cek console log Electron saat close
- Verifikasi Firestore rules sudah deploy
- Pastikan user sudah login saat Electron ditutup

### RTDB data tidak update
- Cek RTDB rules di Firebase Console
- Pastikan `databaseURL` benar di config dashboard
- Cek network tab untuk WebSocket connection

---

## 10. Summary

| Kebutuhan | Source | Path |
|-----------|--------|------|
| Live current app | RTDB | `/status/{companyId}/{deviceId}` |
| Live accumulated stats | RTDB | `/stats/{companyId}/{deviceId}` |
| All company devices live | RTDB | `/stats/{companyId}` |
| Final daily report | Firestore | `stats_summaries/{summaryId}` |
| Historical reports | Firestore | `stats_summaries` dengan filter date |

**Rule of thumb**:
- Untuk **real-time/live view**: Gunakan RTDB
- Untuk **laporan/historical**: Gunakan Firestore final summary
- Untuk **UX terbaik**: Gabungkan keduanya (live untuk now, final untuk past)
