# VORCE Electron Agent

Desktop monitoring agent for VORCE. Runs on user devices, collects lightweight
device and activity telemetry, and ships it to the VORCE backend (which is the
single source of truth and the only thing that talks to Firestore).

## Architecture

```
Electron Agent  -->  VORCE Backend API  -->  Firestore
```

The agent **never** talks to Firestore. All persistence (devices, stats) is
written by the backend after it validates the bearer token and resolves the
authenticated `userId` / `companyId` on its own. The agent only sends the
`deviceId` it received during registration plus the metrics payload.

## Project Layout

```
electron-agent/
├── main.js                  # Electron main process (window + IPC)
├── preload.js               # contextBridge - safe API for renderer
├── core/
│   ├── config.js            # Backend URL, intervals, endpoint paths
│   └── monitor.js           # Periodic collector + sender loop
├── services/
│   ├── apiClient.js         # fetch wrapper, attaches Bearer token
│   ├── authService.js       # /auth/login, logout (existing VORCE API)
│   ├── deviceService.js     # /device/register
│   ├── metricsService.js    # /device/metrics
│   └── tokenStore.js        # Encrypted token persistence (safeStorage)
├── collectors/
│   ├── deviceInfo.js        # hostname, OS, CPU model, total RAM
│   ├── cpu.js               # CPU usage % (systeminformation)
│   ├── memory.js            # RAM usage % (systeminformation)
│   ├── activity.js          # active-win (app + window title)
│   └── idle.js              # System idle (powerMonitor)
├── utils/
│   ├── logger.js            # Structured logger
│   └── retry.js             # Exponential backoff helper
└── renderer/
    ├── index.html           # Login + dashboard UI
    ├── styles.css           # Dark theme styles
    └── app.js               # Renderer logic (IPC only)
```

## Getting Started

```bash
cd electron-agent
npm install
npm start
```

### Configuration

Defaults match the existing VORCE Cloud Functions deployment. Override per-env
without code changes:

```
VORCE_API_BASE_URL=https://asia-southeast2-hora-7394b.cloudfunctions.net/api
VORCE_METRICS_INTERVAL_MS=5000
```

### Endpoints Used

The agent only consumes these routes; no Firestore SDK is bundled.

| Method | Path                | Purpose                                |
|--------|---------------------|----------------------------------------|
| POST   | `/auth/login`       | Email + password login (existing API)  |
| POST   | `/device/register`  | Register this machine, returns deviceId|
| POST   | `/device/metrics`   | Periodic metrics push                  |

`userId` and `companyId` are **never** sent by the client. The backend extracts
them from the bearer token and writes to
`companies/{companyId}/users/{userId}/devices/{deviceId}/stats/{timestamp}`.

## Auth Flow

1. User launches the agent and sees a login form.
2. Agent calls `POST /auth/login` with `{ email, password }`.
3. Backend authenticates and returns `{ token, userId, companyId }`.
4. Token is stored securely via Electron `safeStorage` (OS keychain / DPAPI).
5. All subsequent API requests include `Authorization: Bearer <token>`.
6. `userId` and `companyId` are NEVER manually input or transmitted by the agent.

## Device Registration

After login, the agent automatically calls `POST /device/register` with:
```json
{
  "hostname": "...",
  "os": "...",
  "cpuModel": "...",
  "totalRam": 16
}
```
The backend extracts user context from the token and returns a `deviceId`.

## Monitoring Data

Every 5 seconds (configurable), the agent collects and sends:
```json
{
  "deviceId": "...",
  "timestamp": 1710000000,
  "cpu": 45,
  "ram": 60,
  "activeApp": {
    "name": "chrome.exe",
    "title": "YouTube"
  },
  "idle": {
    "isIdle": false,
    "seconds": 0
  }
}
```

## Security

- Token is persisted via Electron `safeStorage` (OS keychain / DPAPI). When
  unavailable, falls back to per-user file with a logged warning.
- Renderer is sandboxed: `contextIsolation: true`, `nodeIntegration: false`.
  Only explicit IPC handlers exposed by `preload.js` are accessible.
- Collectors never capture screenshots, never read keystrokes, never read file
  contents. Only foreground window title and process name are sent.

## Idle Tracking

Uses Electron's built-in `powerMonitor.getSystemIdleTime()` instead of
`desktop-idle` — same OS-level signal, no native build step, works on
Windows / macOS / Linux out of the box.

## Restrictions

- No `firebase` / `firestore` SDK imported.
- No `userId` / `companyId` placed in any outgoing request body.
- No screen capture, no keylogger, no clipboard scraping.
