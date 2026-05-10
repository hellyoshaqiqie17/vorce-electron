# VORCE Local Intelligence Pipeline

Electron is now a local **workforce intelligence engine**, not a raw telemetry sender.
Raw telemetry stays on-device. Only compressed intelligence is shipped to Firestore.

## Pipeline

```
collectors → core/monitor.takeSample()
                ↓
         renderer (UI, unchanged)
                ↓
   services/intelligence (orchestrator)
       ├── sessionEngine    → device_sessions (1 write per finalized session)
       ├── presenceEngine   → live_presence  (overwrite, debounced)
       ├── anomalyEngine    → anomaly_events (event only, with cooldown)
       └── snapshotEngine   → analytics_snapshots (every ~20 min)
```

## Write rules (aggressively reduced)

| Collection | When | Strategy |
|---|---|---|
| `live_presence/{deviceId}` | app change · state change · ≥10% CPU/RAM delta · 20s heartbeat | **overwrite** |
| `device_sessions/{sessionId}` | session ends (app switch, idle ≥90s, shutdown) | **once** per session |
| `analytics_snapshots/{snapshotId}` | every 20 min | rolling aggregate |
| `anomaly_events/{eventId}` | sustained anomaly + 5 min cooldown | event only |
| `activity_timeline/{sessionId}` | mirror of finalized sessions, compact | once |
| `employee_behavior/{userId}` | mirror of finalized sessions, rolling counters | merge increment |

## What is no longer written

- `device_monitoring/{deviceId}/live_metrics/*` (raw 5s metrics) — **deprecated**.
  The legacy `metricsService` and `activitySessionService` are no longer invoked by `core/monitor.js`.
- Periodic session upserts every 30s — **removed**. Sessions write once at end.

## Realtime UX without realtime writes

Future web dashboard reads `live_presence.sessionStartedAt` and computes
`now - startedAt` client-side for live duration. No durations are streamed.

## Required Firestore rules (production)

```js
match /companies/{companyId} {
  match /live_presence/{deviceId}     { allow read, write: if isCompanyMember(companyId); }
  match /device_sessions/{sessionId}  { allow read, write: if isCompanyMember(companyId); }
  match /analytics_snapshots/{id}     { allow read, write: if isCompanyMember(companyId); }
  match /anomaly_events/{id}          { allow read, write: if isCompanyMember(companyId); }
  match /activity_timeline/{id}       { allow read, write: if isCompanyMember(companyId); }
  match /employee_behavior/{userId}   { allow read, write: if isCompanyMember(companyId); }
}
```

## Aggregation Architecture (daily / weekly / monthly)

The dashboard reads aggregate documents, not raw sessions.

```
device_sessions (finalized)
       │
       ▼
aggregationEngine.onSessionFinalized()
       │
       ├──► employee_behavior_daily/{userId_YYYYMMDD}
       ├──► employee_behavior_weekly/{userId_YYYY_WWW}
       └──► employee_behavior_monthly/{userId_YYYY_MM}
```

Every finalized session triggers **3 increment-only writes**. Weekly and
monthly are NOT recomputed by scanning daily; they are incremented on the
same write path. Result: zero raw-session scans, ever.

### Numeric counters (all written via `increment()`)

```
counters.{
  sessionCount, totalSeconds, totalActiveSeconds, totalIdleSeconds,
  switchCount, anomalyCount,
  focusedWorkSeconds, fragmentedWorkSeconds,
  productivityWeightedSum, productivityTotalSeconds,
  fatigueWeightedSum, healthWeightedSum,
}
categories.{development|productivity|communication|browser|entertainment|system|other}
appUsage.{sanitizedAppName}
productivityDistribution.{deep_focus|focused|fragmented|collaboration|exploration|leisure|general}
dailyTrend.{YYYYMMDD}.{sessionCount|totalSeconds|productivityWeightedSum|productivityTotalSeconds}    // weekly only
weeklyTrend.{YYYY_WWW}.{sessionCount|totalSeconds|productivityWeightedSum|productivityTotalSeconds}    // monthly only
```

### Derived metrics (computed at read-time by the dashboard)

The dashboard derives the following from the embedded counters in **one read**:

| Field | Formula |
|---|---|
| `productivityScore` | `productivityWeightedSum / productivityTotalSeconds` |
| `fatigueScore` | `fatigueWeightedSum / totalSeconds` |
| `healthScore` | `healthWeightedSum / totalSeconds` |
| `dominantCategory` | `argmax(categories)` |
| `dominantApps` | top-N from `appUsage` map |
| `dominantWorkPattern` | `argmax(productivityDistribution)` |
| `engagementTrend` | per-day productivity from `dailyTrend` |
| `workloadConsistency` | stdev/mean of `dailyTrend.totalSeconds` |
| `burnoutRisk` | rule from `fatigueWeightedSum/totalSeconds` + idle ratio + anomalyCount |

This is the standard scalable analytics pattern: **store sums, derive ratios at read.**

## Retention strategy (apply via Firestore TTL policies)

| Collection | TTL field | Recommended TTL |
|---|---|---|
| `live_presence/{deviceId}` | `updatedAt` | 3 days |
| `device_sessions/{sessionId}` | `endedAt` | 60–90 days |
| `analytics_snapshots/{id}` | `windowEnd` | 60 days |
| `anomaly_events/{id}` | `detectedAt` | 90 days |
| `activity_timeline/{id}` | `endedAt` | 30 days |
| `employee_behavior_daily/{id}` | `updatedAt` | 400 days |
| `employee_behavior_weekly/{id}` | `updatedAt` | 2 years |
| `employee_behavior_monthly/{id}` | (no TTL) | permanent |

Apply these as Firestore **TTL policies** in the GCP console. The Electron
agent does not delete data; lifecycle is enforced server-side.

## Semantic outputs

`semanticAnalyzer.js` is pure (no I/O):

- `classifyApp(appName, windowTitle)` → Productivity | Communication | Browsing | Entertainment | System | Application
- `classifyProductivityType(category, durationSeconds, switchCount)` → deep_focus | focused | fragmented | collaboration | leisure | exploration | general
- `computeFocusScore({ durationSeconds, switchCount, category, idleRatio })` → 0..100
- `classifyBehavior(stats)` → focused_work | fragmented_focus | high_switching | prolonged_idle | memory_pressure | multitasking | unstable_workload | balanced
