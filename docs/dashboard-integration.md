# VORCE Web Dashboard — Firestore Integration Guide

Panduan lengkap untuk membaca data telemetry & analytics yang dihasilkan oleh Electron agent dari Firestore.

> **Audience**: Frontend developer yang membangun web dashboard VORCE.
> **Stack acuan**: Firebase Web SDK v9+ (modular). Snippet contoh pakai TypeScript, tapi bisa langsung dipakai di JavaScript.
> **Backend**: Firestore di project `hora-7394b` (asia-southeast2).

---

## 1. Arsitektur Data — Big Picture

```
DEVICE (Electron Agent)
        │
        ▼
LOCAL EDGE INTELLIGENCE (sessionization, semantic, anomaly)
        │
        ▼  (compressed writes only, no raw metric stream)
        │
FIRESTORE
├── companies/{companyId}/live_presence/{deviceId}            ← realtime, overwrite ~20s
├── companies/{companyId}/device_sessions/{sessionId}         ← finalized session
├── companies/{companyId}/activity_timeline/{sessionId}       ← compact recent feed
├── companies/{companyId}/anomaly_events/{eventId}            ← alerts
├── companies/{companyId}/analytics_snapshots/{snapshotId}    ← 20-min rollups
├── companies/{companyId}/employee_behavior/{userId}          ← rolling per-user counters
├── companies/{companyId}/employee_behavior_daily/{userId_YYYYMMDD}    ← daily aggregate
├── companies/{companyId}/employee_behavior_weekly/{userId_YYYY_Www}   ← weekly aggregate
└── companies/{companyId}/employee_behavior_monthly/{userId_YYYY_MM}   ← monthly aggregate
```

### Prinsip Penting

1. **Jangan scan `device_sessions` untuk analytics**. Selalu baca dari `employee_behavior_daily/weekly/monthly`.
2. **Aggregate doc menyimpan SUMS, dashboard menghitung RATIOS**. Contoh: `productivityScore = productivityWeightedSum / productivityTotalSeconds`.
3. **Realtime widget pakai `live_presence`** (subscribe per device atau per company).
4. **Historical chart pakai aggregate**, BUKAN sessions.

---

## 2. Setup Firebase Web Client

```bash
npm install firebase
```

```ts
// src/lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDcc3oP_lGYg9ikBn0mq--wdH27aQ5LFlc",
  authDomain: "hora-7394b.firebaseapp.com",
  projectId: "hora-7394b",
  storageBucket: "hora-7394b.firebasestorage.app",
  messagingSenderId: "544676101248",
  appId: "1:544676101248:web:708c651f6c3d20a5b1ba65",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
```

User dashboard harus login dengan akun Google yang sama yang ada di koleksi `users` (memiliki `companyId` yang sesuai). Firestore Rules akan reject query kalau tidak authenticated.

---

## 3. Collections Schema (Read-Side)

### 3.1. `live_presence/{deviceId}`

Realtime status tiap device. Overwrite ~tiap 20 detik.

```ts
type LivePresence = {
  deviceId: string;
  companyId: string;
  userId: string;
  userEmail: string;
  userName: string;

  currentApp: string;           // "Windsurf", "Chrome", dll
  currentCategory: string;      // "Productivity", "Communication", "Browsing", dll
  activeWindow: string;         // window title
  executable: string;

  cpuNow: number;               // 0-100
  ramNow: number;               // 0-100 (% pemakaian)
  state: "active" | "idle" | "away";
  healthScore: number;          // 0-100

  sessionId: string | null;
  sessionStartedAt: Timestamp | null;
  lastHeartbeat: Timestamp;
  updatedAt: Timestamp;
};
```

**Use case**: Live "who's online & what they're doing" widget.

### 3.2. `device_sessions/{sessionId}`

Satu doc per finalized session (saat user ganti app atau idle ≥3 menit).

```ts
type DeviceSession = {
  sessionId: string;
  companyId: string;
  userId: string;
  deviceId: string;

  app: string;
  category: string;
  windowTitle: string;
  executable: string;

  startedAt: Timestamp;
  endedAt: Timestamp;
  durationSeconds: number;
  switchCount: number;          // berapa kali user pindah window dalam session

  cpuAverage: number;           // 0-100
  cpuPeak: number;
  ramAverage: number;
  ramPeak: number;
  idleRatio: number;            // 0-1, fraksi waktu idle dalam session

  productivityType: "deep_focus" | "focused" | "fragmented" | "collaboration" | "exploration" | "leisure" | "general";
  focusScore: number;           // 0-100
  anomalyDetected: boolean;
  behaviorTag: string;          // "focused_work" | "high_switching" | dll

  createdAt: Timestamp;
};
```

**Use case**: Detail drill-down per session. **JANGAN** dipakai untuk hitung analytics (gunakan aggregate).

### 3.3. `activity_timeline/{sessionId}`

Compact feed — subset dari `device_sessions` yang dipakai untuk render activity feed cepat.

```ts
type ActivityTimelineEntry = {
  sessionId: string;
  deviceId: string;
  userId: string;
  app: string;
  category: string;
  startedAt: Timestamp;
  endedAt: Timestamp;
  durationSeconds: number;
  productivityType: string;
  focusScore: number;
  createdAt: Timestamp;
};
```

**Use case**: "Recent activity" feed di sidebar dashboard.

### 3.4. `anomaly_events/{eventId}`

Event-based, hanya muncul kalau anomali ter-detect (CPU spike, RAM pressure, switching tinggi, dll).

```ts
type AnomalyEvent = {
  eventId: string;
  deviceId: string;
  companyId: string;
  userId: string;
  type: "cpu_spike" | "ram_pressure" | "high_switching" | "prolonged_idle" | string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  metricSnapshot: { cpu?: number; ram?: number; switchCount?: number };
  detectedAt: Timestamp;
  createdAt: Timestamp;
};
```

**Use case**: Alert panel, security/health monitoring.

### 3.5. `analytics_snapshots/{snapshotId}`

Rollup setiap ~20 menit. Berisi snapshot kondisi window yang lebih granular dari daily aggregate.

```ts
type AnalyticsSnapshot = {
  snapshotId: string;
  companyId: string;
  userId: string;
  deviceId: string;
  windowStart: Timestamp;
  windowEnd: Timestamp;
  productivityScore: number;    // 0-100
  fatigueScore: number;
  totalActiveSeconds: number;
  totalIdleSeconds: number;
  switchCount: number;
  dominantCategory: string;
  dominantApp: string;
  createdAt: Timestamp;
};
```

**Use case**: Intra-day chart (granularity 20-menit).

### 3.6. `employee_behavior_daily/{userId_YYYYMMDD}`

**Aggregate doc untuk daily analytics** — incremented tiap session selesai.

```ts
type EmployeeBehaviorDaily = {
  userId: string;
  companyId: string;
  date: string;                 // "20260509"
  year: number;
  month: number;
  day: number;

  counters: {
    sessionCount: number;
    totalSeconds: number;
    totalActiveSeconds: number;
    totalIdleSeconds: number;
    switchCount: number;
    anomalyCount: number;
    focusedWorkSeconds: number;
    fragmentedWorkSeconds: number;
    productivityWeightedSum: number;   // Σ(focusScore × duration)
    productivityTotalSeconds: number;
    fatigueWeightedSum: number;
    healthWeightedSum: number;
  };

  categories: {
    development?: number;       // seconds
    productivity?: number;
    communication?: number;
    browser?: number;
    entertainment?: number;
    system?: number;
    other?: number;
  };

  appUsage: {
    [sanitizedAppName: string]: number;   // seconds, e.g. "windsurf": 1840
  };

  productivityDistribution: {
    deep_focus?: number;
    focused?: number;
    fragmented?: number;
    collaboration?: number;
    exploration?: number;
    leisure?: number;
    general?: number;
  };

  lastSessionId: string;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};
```

**Doc ID format**: `{userId}_YYYYMMDD` → contoh: `pRy5r5Oubdh6HOocdYB30O0QoKI2_20260509`.

**Use case**: SEMUA daily analytics widget (productivity score harian, app usage breakdown, category pie chart, dll).

### 3.7. `employee_behavior_weekly/{userId_YYYY_Www}`

Sama dengan daily, plus field tambahan:

```ts
type EmployeeBehaviorWeekly = EmployeeBehaviorDaily & {
  weekKey: string;              // "2026_W19"
  week: number;                 // ISO week number
  // year sudah ada dari daily
  dailyTrend: {
    [dayKey: string]: {         // "20260509"
      sessionCount: number;
      totalSeconds: number;
      totalActiveSeconds: number;
      productivityWeightedSum: number;
      productivityTotalSeconds: number;
    };
  };
};
```

**Doc ID**: `{userId}_2026_W19`.

### 3.8. `employee_behavior_monthly/{userId_YYYY_MM}`

```ts
type EmployeeBehaviorMonthly = EmployeeBehaviorDaily & {
  monthKey: string;             // "2026_05"
  weeklyTrend: {
    [weekKey: string]: {        // "2026_W19"
      sessionCount: number;
      totalSeconds: number;
      productivityWeightedSum: number;
      productivityTotalSeconds: number;
    };
  };
};
```

**Doc ID**: `{userId}_2026_05`.

### 3.9. `employee_behavior/{userId}`

Lifetime rolling counter (sekedar info "all-time").

```ts
type EmployeeBehaviorRolling = {
  userId: string;
  companyId: string;
  totalSessions: number;
  totalActiveSeconds: number;
  lastSessionId: string;
  lastSessionAt: Timestamp;
  lastFocusScore: number;
  lastCategory: string;
  lastApp: string;
  updatedAt: Timestamp;
};
```

---

## 4. Derived Metrics — Formula

Aggregate doc menyimpan **counter mentah**. Frontend hitung metric jadi:

```ts
function deriveDailyMetrics(d: EmployeeBehaviorDaily) {
  const c = d.counters;
  return {
    productivityScore: safeDiv(c.productivityWeightedSum, c.productivityTotalSeconds),  // 0..100
    fatigueScore: safeDiv(c.fatigueWeightedSum, c.totalSeconds),
    healthScore: safeDiv(c.healthWeightedSum, c.totalSeconds),

    activeHours: c.totalActiveSeconds / 3600,
    idleHours: c.totalIdleSeconds / 3600,

    focusRatio: safeDiv(c.focusedWorkSeconds, c.totalSeconds),
    fragmentationRatio: safeDiv(c.fragmentedWorkSeconds, c.totalSeconds),

    dominantCategory: argmax(d.categories),
    dominantApps: topN(d.appUsage, 5),
    dominantWorkPattern: argmax(d.productivityDistribution),

    avgSwitchPerHour: c.switchCount / Math.max(1, c.totalSeconds / 3600),
    anomaliesPerHour: c.anomalyCount / Math.max(1, c.totalSeconds / 3600),
  };
}

function safeDiv(num: number, den: number, fallback = 0) {
  return den > 0 ? num / den : fallback;
}

function argmax<T extends Record<string, number>>(obj: T): keyof T | null {
  let max = -Infinity;
  let key: keyof T | null = null;
  for (const k in obj) {
    if (obj[k] > max) { max = obj[k]; key = k; }
  }
  return key;
}

function topN(obj: Record<string, number>, n: number) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, seconds]) => ({ key, seconds }));
}
```

### Burnout Risk (rule-based)

```ts
function computeBurnoutRisk(monthly: EmployeeBehaviorMonthly): "low" | "medium" | "high" {
  const c = monthly.counters;
  const fatigue = safeDiv(c.fatigueWeightedSum, c.totalSeconds);
  const fragmentationRatio = safeDiv(c.fragmentedWorkSeconds, c.totalSeconds);
  const anomalyDensity = c.anomalyCount / Math.max(1, c.sessionCount);

  if (fatigue > 70 || fragmentationRatio > 0.6 || anomalyDensity > 0.3) return "high";
  if (fatigue > 50 || fragmentationRatio > 0.4) return "medium";
  return "low";
}
```

### Workload Consistency (dari `dailyTrend`)

```ts
function workloadConsistency(weekly: EmployeeBehaviorWeekly): number {
  const days = Object.values(weekly.dailyTrend).map(d => d.totalSeconds);
  if (days.length < 2) return 1;
  const mean = days.reduce((a, b) => a + b, 0) / days.length;
  const variance = days.reduce((a, b) => a + (b - mean) ** 2, 0) / days.length;
  const stdev = Math.sqrt(variance);
  // 1 = perfectly consistent, 0 = highly variable
  return mean > 0 ? Math.max(0, 1 - stdev / mean) : 0;
}
```

---

## 5. Query Patterns

### 5.1. Realtime Presence — Per Company

```ts
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

function subscribeCompanyPresence(companyId: string, onUpdate: (devices: LivePresence[]) => void) {
  const q = collection(db, "companies", companyId, "live_presence");
  return onSnapshot(q, (snap) => {
    const devices = snap.docs.map((d) => d.data() as LivePresence);
    onUpdate(devices);
  });
}

// usage:
const unsub = subscribeCompanyPresence("CTD96L", (devices) => {
  console.log(`${devices.length} devices online`);
});
// remember to call unsub() on unmount
```

**Cost**: Realtime listener berbiaya per-document-update. Filter di server kalau ada banyak device:

```ts
import { query, where, orderBy } from "firebase/firestore";

const q = query(
  collection(db, "companies", companyId, "live_presence"),
  where("state", "==", "active"),
  orderBy("updatedAt", "desc")
);
```

### 5.2. Daily Analytics — Single User, Single Day

```ts
import { doc, getDoc } from "firebase/firestore";

async function getDailyAnalytics(companyId: string, userId: string, date: Date) {
  const dayKey = formatDayKey(date);  // "20260509"
  const ref = doc(db, "companies", companyId, "employee_behavior_daily", `${userId}_${dayKey}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return deriveDailyMetrics(snap.data() as EmployeeBehaviorDaily);
}

function formatDayKey(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
```

**Cost**: 1 read per call.

### 5.3. Weekly Trend — 7-day Bar Chart

Gunakan `dailyTrend` di doc weekly untuk **1 read** total.

```ts
async function getWeeklyTrend(companyId: string, userId: string, isoYear: number, isoWeek: number) {
  const weekKey = `${isoYear}_W${String(isoWeek).padStart(2, "0")}`;
  const ref = doc(db, "companies", companyId, "employee_behavior_weekly", `${userId}_${weekKey}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return [];
  const data = snap.data() as EmployeeBehaviorWeekly;

  return Object.entries(data.dailyTrend)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dayKey, d]) => ({
      date: dayKey,
      activeHours: d.totalActiveSeconds / 3600,
      productivityScore: safeDiv(d.productivityWeightedSum, d.productivityTotalSeconds),
    }));
}
```

### 5.4. Monthly Overview — 1 Read per User per Month

```ts
async function getMonthlyOverview(companyId: string, userId: string, year: number, month: number) {
  const monthKey = `${year}_${String(month).padStart(2, "0")}`;
  const ref = doc(db, "companies", companyId, "employee_behavior_monthly", `${userId}_${monthKey}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data() as EmployeeBehaviorMonthly;

  return {
    ...deriveDailyMetrics(data),
    burnoutRisk: computeBurnoutRisk(data),
    weeklyTrend: Object.entries(data.weeklyTrend)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([weekKey, w]) => ({
        week: weekKey,
        totalHours: w.totalSeconds / 3600,
        productivityScore: safeDiv(w.productivityWeightedSum, w.productivityTotalSeconds),
      })),
  };
}
```

### 5.5. Multi-User Department Comparison

```ts
import { collection, query, where, getDocs } from "firebase/firestore";

async function compareUsersToday(companyId: string, userIds: string[], date: Date) {
  const dayKey = formatDayKey(date);
  const targetIds = userIds.map(uid => `${uid}_${dayKey}`);

  // Firestore "in" max 30. Chunk if needed.
  const results = [];
  for (let i = 0; i < targetIds.length; i += 30) {
    const chunk = targetIds.slice(i, i + 30);
    const q = query(
      collection(db, "companies", companyId, "employee_behavior_daily"),
      where("__name__", "in", chunk)
    );
    const snap = await getDocs(q);
    results.push(...snap.docs.map(d => d.data() as EmployeeBehaviorDaily));
  }
  return results.map(d => ({
    userId: d.userId,
    ...deriveDailyMetrics(d),
  }));
}
```

**Cost**: 1 read per user per day. Untuk 50 user → 50 reads.

### 5.6. Activity Feed — Recent Sessions

```ts
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";

async function getRecentActivity(companyId: string, count = 50) {
  const q = query(
    collection(db, "companies", companyId, "activity_timeline"),
    orderBy("endedAt", "desc"),
    limit(count)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as ActivityTimelineEntry);
}
```

### 5.7. Anomaly Alerts — Last 24 Hours

```ts
import { Timestamp } from "firebase/firestore";

async function getRecentAnomalies(companyId: string, hours = 24) {
  const since = Timestamp.fromMillis(Date.now() - hours * 3600 * 1000);
  const q = query(
    collection(db, "companies", companyId, "anomaly_events"),
    where("detectedAt", ">=", since),
    orderBy("detectedAt", "desc"),
    limit(100)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as AnomalyEvent);
}
```

### 5.8. Drill-Down Session Detail

```ts
async function getSessionDetail(companyId: string, sessionId: string) {
  const ref = doc(db, "companies", companyId, "device_sessions", sessionId);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as DeviceSession) : null;
}
```

---

## 6. Required Firestore Indexes

Beberapa query butuh composite index. Tambahkan di **Firebase Console → Firestore → Indexes**:

| Collection | Fields |
|---|---|
| `live_presence` | `state` ASC + `updatedAt` DESC |
| `activity_timeline` | `endedAt` DESC (auto-indexed by Firestore) |
| `anomaly_events` | `detectedAt` DESC |
| `device_sessions` (drilldown) | `userId` ASC + `endedAt` DESC |
| `employee_behavior_daily` | `userId` ASC + `date` DESC (kalau pakai range query alih-alih `__name__`) |

Firestore akan otomatis kasih error link untuk membuat index saat pertama kali query gagal — klik link tersebut dan create.

---

## 7. Best Practices

### Cost Optimization

| Tujuan | Lakukan | Hindari |
|---|---|---|
| Daily analytics | 1× `getDoc` ke `employee_behavior_daily/{userId_YYYYMMDD}` | Query `device_sessions` lalu sum manual |
| Weekly chart | 1× `getDoc` ke `employee_behavior_weekly` lalu iterate `dailyTrend` | 7× getDoc daily docs |
| Monthly trend | 1× `getDoc` ke `employee_behavior_monthly` | 30× daily atau 4× weekly docs |
| Realtime presence | `onSnapshot` di `live_presence` | Polling `device_sessions` |
| Detail drilldown | `getDoc(device_sessions/{sessionId})` saat user klik row di feed | Fetch full sessions di awal |

### Pagination

Untuk feed yang panjang, pakai cursor:

```ts
import { startAfter } from "firebase/firestore";

async function getActivityPage(companyId: string, lastCursor?: any) {
  let q = query(
    collection(db, "companies", companyId, "activity_timeline"),
    orderBy("endedAt", "desc"),
    limit(50)
  );
  if (lastCursor) q = query(q, startAfter(lastCursor));
  const snap = await getDocs(q);
  const items = snap.docs.map(d => d.data() as ActivityTimelineEntry);
  const cursor = snap.docs[snap.docs.length - 1];
  return { items, cursor };
}
```

### Caching

Firestore SDK punya **persistence cache** built-in. Aktifkan di setup:

```ts
import { initializeFirestore, persistentLocalCache } from "firebase/firestore";

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({}),
});
```

Membaca daily/weekly/monthly aggregate doc berulang dalam satu sesi browser hanya hit-server sekali.

### Realtime vs Static

| Widget | Pattern |
|---|---|
| "Who's online now" | `onSnapshot(live_presence)` |
| "Today productivity" | `getDoc(daily)` + manual refresh tiap 5 menit |
| "Weekly chart" | `getDoc(weekly)` 1× saat halaman load |
| "Monthly report" | `getDoc(monthly)` 1× saat halaman load |
| "Anomaly alerts" | `onSnapshot(anomaly_events)` dengan `where(detectedAt >= last24h)` |

---

## 8. Contoh Komplit — Dashboard Page Skeleton

```tsx
// pages/employee/[userId].tsx
import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc, onSnapshot } from "firebase/firestore";

export default function EmployeeDashboard({ companyId, userId }: Props) {
  const [presence, setPresence] = useState<LivePresence | null>(null);
  const [daily, setDaily] = useState<any>(null);
  const [weekly, setWeekly] = useState<any[]>([]);

  // Realtime presence (subscribe per device — assumes 1 device per user)
  useEffect(() => {
    const q = query(
      collection(db, "companies", companyId, "live_presence"),
      where("userId", "==", userId),
      limit(1)
    );
    return onSnapshot(q, (snap) => {
      setPresence(snap.docs[0]?.data() as LivePresence ?? null);
    });
  }, [companyId, userId]);

  // Daily aggregate (1 read)
  useEffect(() => {
    const today = formatDayKey(new Date());
    getDoc(doc(db, "companies", companyId, "employee_behavior_daily", `${userId}_${today}`))
      .then(snap => snap.exists() && setDaily(deriveDailyMetrics(snap.data() as any)));
  }, [companyId, userId]);

  // Weekly trend (1 read)
  useEffect(() => {
    const { isoYear, isoWeek } = getISOWeek(new Date());
    const weekKey = `${isoYear}_W${String(isoWeek).padStart(2, "0")}`;
    getDoc(doc(db, "companies", companyId, "employee_behavior_weekly", `${userId}_${weekKey}`))
      .then(snap => {
        if (!snap.exists()) return;
        const w = snap.data() as EmployeeBehaviorWeekly;
        setWeekly(Object.entries(w.dailyTrend).sort().map(([day, d]) => ({
          date: day,
          hours: d.totalActiveSeconds / 3600,
          score: safeDiv(d.productivityWeightedSum, d.productivityTotalSeconds),
        })));
      });
  }, [companyId, userId]);

  return (
    <div>
      <PresenceCard presence={presence} />
      <DailyMetricsCard metrics={daily} />
      <WeeklyTrendChart data={weekly} />
    </div>
  );
}
```

**Total reads per page load**: 2 (daily + weekly) + realtime presence (1 listener).

---

## 9. Reference — Period Key Format

Generator yang sama dengan agent — pastikan dashboard pakai format identik:

```ts
function pad2(n: number) { return String(n).padStart(2, "0"); }

export function formatDayKey(d: Date) {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

export function formatMonthKey(d: Date) {
  return `${d.getUTCFullYear()}_${pad2(d.getUTCMonth() + 1)}`;
}

export function getISOWeek(d: Date) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fdn = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fdn + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { isoYear: date.getUTCFullYear(), isoWeek: week };
}

export function formatWeekKey(d: Date) {
  const { isoYear, isoWeek } = getISOWeek(d);
  return `${isoYear}_W${pad2(isoWeek)}`;
}
```

---

## 10. Troubleshooting

### "PERMISSION_DENIED" saat read

- Pastikan user sudah login via Firebase Auth (`auth.currentUser !== null`).
- Pastikan rules di Firebase Console sudah ter-publish (lihat `firestore.rules`).
- User harus punya doc di `users/` (key bisa email atau uid).

### Aggregate doc tidak ada

- Doc baru terbuat setelah session pertama yang valid (≥1 detik). Tunggu agent generate session.
- Cek log Electron — harus ada `aggregate incremented` debug line.

### "productivityScore" hasilnya 0 atau NaN

- Pastikan `counters.productivityTotalSeconds > 0`. Kalau 0, return fallback (0 atau "—").
- Pakai helper `safeDiv()` di section 4.

### Field `appUsage` punya key aneh seperti `code_exe`

- Itu hasil sanitization Firestore (key tidak boleh ada `.`, `/`, `[`, dll).
- Map kembali ke display name di UI:
  ```ts
  const APP_DISPLAY: Record<string, string> = {
    code_exe: "VS Code",
    windsurf: "Windsurf",
    chrome: "Chrome",
    discord: "Discord",
  };
  function appDisplayName(key: string) {
    return APP_DISPLAY[key] || key.replace(/_/g, " ");
  }
  ```

---

## 11. Deployment Checklist

- [ ] Firebase Web SDK ter-install di project dashboard
- [ ] Firebase config benar (project `hora-7394b`)
- [ ] Login flow pakai akun yang ada di koleksi `users`
- [ ] Composite indexes di Firestore Console sudah dibuat
- [ ] Persistence cache di-enable
- [ ] Realtime listener di-cleanup di unmount (`unsub()`)
- [ ] Pagination cursor di-handle untuk feed panjang
- [ ] Error boundary untuk handle PERMISSION_DENIED dan missing docs
- [ ] Helper period-key (`formatDayKey`, `formatWeekKey`, `formatMonthKey`) di-share antara agent & dashboard
- [ ] Map app key → display name (lihat troubleshooting)

---

## Appendix — Cost Estimate

Asumsi 50 device × 8 jam kerja:

| Operasi | Reads/day per dashboard user |
|---|---|
| Live presence widget (subscribe) | ~50 (initial) + per-update |
| Daily summary (1 user) | 1 |
| Weekly chart (1 user) | 1 |
| Monthly report (1 user) | 1 |
| Department comparison (50 users daily) | 50 |
| Recent activity feed (50 items) | 50 |
| Anomaly alerts (24h) | 0–10 (event-driven) |
| Drilldown 1 session | 1 |

Total per dashboard user per session: ~150–200 reads. Untuk 100 active dashboard users → ~20K reads/day.

Bandingkan dengan naive approach (scan `device_sessions`): 50 device × 100 sessions/day × 100 dashboard users = 500K reads/day. **Aggregate architecture menghemat ~25× cost**.
