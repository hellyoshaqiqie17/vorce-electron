# VORCE Electron Agent

Desktop monitoring agent for VORCE. Runs on user devices, collects light-weight
device + activity telemetry, and ships it to the VORCE backend (which is the
single source of truth and the only thing that talks to Firestore).

## Architecture

```
Electron Agent  ──►  VORCE Backend API  ──►  Firestore
```

The agent **never** talks to Firestore. All persistence (devices, stats) is
written by the backend after it validates the bearer token and resolves the
authenticated `userId` / `companyId` on its own. The agent only sends the
`deviceId` it received during registration plus the metrics payload.

## Project layout

```
electron-agent/
├── main.js                  # Electron main process (window + IPC)
├── preload.js               # contextBridge → safe API for renderer
├── core/
│   ├── config.js            # Backend URL, intervals, endpoint paths
│   └── monitor.js           # Periodic collector + sender loop
├── services/
│   ├── apiClient.js         # fetch wrapper, attaches Bearer token
│   ├── authService.js       # /auth/login, logout
│   ├── deviceService.js     # /device/register
│   ├── metricsService.js    # /device/metrics
│   └── tokenStore.js        # Encrypted token persistence (safeStorage)
├── collectors/
│   ├── deviceInfo.js        # hostname, OS, CPU model, total RAM
│   ├── cpu.js               # CPU usage %
│   ├── memory.js            # RAM usage %
│   ├── activity.js          # active-win (app + window title)
│   └── idle.js              # System idle (powerMonitor)
├── utils/
│   ├── logger.js
│   └── retry.js
└── renderer/
    ├── index.html
    ├── styles.css
    └── app.js
```

## Getting started

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

### Endpoints used

The agent only consumes these routes; no Firestore SDK is bundled.

| Method | Path                | Purpose                                |
|--------|---------------------|----------------------------------------|
| POST   | `/auth/login`       | Email + password login (existing API)  |
| POST   | `/device/register`  | Register this machine, returns deviceId|
| POST   | `/device/metrics`   | Periodic metrics push                  |

`userId` and `companyId` are **never** sent by the client. The backend extracts
them from the bearer token and writes to
`companies/{companyId}/users/{userId}/devices/{deviceId}/stats/{timestamp}`.

## Security

- Token is persisted via Electron `safeStorage` (OS keychain / DPAPI). When
  unavailable (older Linux, no key ring), it falls back to a per-user file in
  `app.getPath('userData')` and logs a warning.
- Renderer is sandboxed: `contextIsolation: true`, `nodeIntegration: false`.
  The renderer can only call the explicit IPC handlers exposed by `preload.js`.
- Collectors never capture screenshots, never read keystrokes, never read file
  contents. Only the foreground window title and process name are sent (per
  the spec) — disable in `core/config.js` if your policy forbids titles.

## Idle tracking

The spec calls out `desktop-idle` as a reference. We use Electron's built-in
`powerMonitor.getSystemIdleTime()` instead — same data, no native build step,
works on Windows / macOS / Linux out of the box. Swap implementations in
`collectors/idle.js` if you prefer the original library.

## Restrictions enforced by code

- No `firebase` / `firestore` SDK is imported.
- No `userId` / `companyId` is ever placed in any outgoing request body.
- No screen capture, no keylogger, no clipboard scraping.
