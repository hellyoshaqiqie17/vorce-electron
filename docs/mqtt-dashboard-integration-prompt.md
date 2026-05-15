# Prompt: Implementasi MQTT Dashboard untuk VORCE

## Status
MQTT di Electron agent sudah **berhasil connect dan subscribe**.

Log konfirmasi:
```
[mqttPresence] connected {"brokerUrl":"wss://...", "clientId":"vorce_electron_..."}
[mqttPresence] subscribed {"topics":["vorce/CTD96L/devices/{deviceId}/commands","vorce/CTD96L/alerts"]}
```

## Apa yang Sudah Diimplementasikan di Electron

### MQTT Client Setup
- ✅ **Library**: `mqtt` v5.14.1
- ✅ **Protocol**: WebSocket Secure (WSS) ke HiveMQ Cloud
- ✅ **Auto-reconnect**: 5 detik interval
- ✅ **QoS**: Level 1 (at least once delivery)

### Publisher (Electron → Broker)
| Fungsi | Topic | Frekuensi |
|--------|-------|-----------|
| **Presence** | `vorce/{companyId}/devices/{deviceId}/presence` | Setiap ada perubahan (app, CPU, RAM, state) atau minimal setiap 20 detik (heartbeat) |
| **Offline Status** | `vorce/{companyId}/devices/{deviceId}/presence` | Saat Electron quit/shutdown (state: "offline") |

**Payload yang dipublish:**
```json
{
  "deviceId": "desktop_hellyoshaqiqie_...",
  "userId": "pRy5r5Oubdh6HOocdYB30O0QoKI2",
  "userEmail": "helly@company.com",
  "userName": "Helly",
  "companyId": "CTD96L",
  "currentApp": "vscode",
  "currentCategory": "development",
  "activeWindow": "main.js - electron-agent",
  "executable": "Code.exe",
  "cpuNow": 45,
  "ramNow": 62,
  "state": "active",
  "healthScore": 85,
  "sessionId": "session_12345",
  "timestamp": 1778857995608
}
```

### Subscriber (Broker → Electron)
| Topic | Handler |
|-------|---------|
| `vorce/{companyId}/devices/{deviceId}/commands` | Log ke console + bisa trigger action |
| `vorce/{companyId}/alerts` | Log ke console |

**Command yang bisa diterima Electron:**
- `LOCK_SCREEN` - Lock device screen
- `TAKE_SNAPSHOT` - Trigger screenshot
- `LOGOUT` - Logout agent
- `NOTIFY` - Show notification popup
- `CUSTOM_MESSAGE` - Display custom message

### Fallback Mechanism
Jika MQTT gagal publish (offline/auth error), Electron otomatis:
1. Tetap publish ke Firestore `live_presence` (fallback)
2. Lanjutkan collect metrics & sessions (tidak terpengaruh)
3. Retry connect MQTT setiap 5 detik

### Firestore Tetap Aktif
MQTT hanya menggantikan **presence real-time**. Firestore tetap digunakan untuk:
- ✅ Session analytics (daily/weekly/monthly aggregates)
- ✅ Finalized session storage
- ✅ Anomaly events
- ✅ Snapshots (compressed metrics)
- ✅ Device registration

---

## Task Tim Web/Dashboard

Implementasi MQTT client di dashboard untuk:
1. **Real-time device presence** (subscribe)
2. **Kirim command ke device** (publish)
3. **Broadcast alerts** (subscribe)

---

## 1. Konfigurasi MQTT Dashboard

### Broker HiveMQ Cloud
```javascript
const MQTT_BROKER_URL = 'wss://e7ba5537e0b8465cad8d146ee6868d84.s1.eu.hivemq.cloud:8884/mqtt';
const MQTT_USERNAME = 'vorce';  // credential sama dengan Electron
const MQTT_PASSWORD = '12#@sawah3G';
const MQTT_QOS = 1;
```

### Library
Gunakan `mqtt` package (sama dengan Electron):
```bash
npm install mqtt
```

---

## 2. Topic Structure

### Subscribe (Dashboard menerima data)
| Topic | Deskripsi |
|-------|-----------|
| `vorce/{companyId}/devices/{deviceId}/presence` | Real-time status device |
| `vorce/{companyId}/alerts` | Broadcast alert dari system |

### Publish (Dashboard kirim command)
| Topic | Deskripsi |
|-------|-----------|
| `vorce/{companyId}/devices/{deviceId}/commands` | Kirim command ke specific device |

---

## 3. Payload Format

### Presence Payload (diterima dari Electron)
```typescript
interface PresencePayload {
  deviceId: string;           // "desktop_hellyoshaqiqie_6ea921..."
  userId: string;             // Firebase UID
  userEmail: string;
  userName: string;
  companyId: string;          // "CTD96L"
  currentApp: string;         // "chrome", "vscode", "slack"
  currentCategory: string;    // "work", "entertainment", "communication"
  activeWindow: string;       // Window title (optional)
  executable: string;         // Executable path/name
  cpuNow: number;             // 0-100
  ramNow: number;             // 0-100
  state: "active" | "idle" | "away" | "offline";
  healthScore: number;        // 0-100
  sessionId: string | null;   // Current session ID
  timestamp: number;          // Unix timestamp ms
}
```

### Command Payload (dikirim dari Dashboard)
```typescript
interface CommandPayload {
  type: "LOCK_SCREEN" | "TAKE_SNAPSHOT" | "LOGOUT" | "NOTIFY" | "CUSTOM_MESSAGE";
  timestamp: number;
  payload?: {
    message?: string;         // Untuk NOTIFY atau CUSTOM_MESSAGE
    duration?: number;        // Duration in ms
    severity?: "info" | "warning" | "critical";
  };
  issuedBy: string;           // Admin user ID yang kirim
}
```

**Example command:**
```json
{
  "type": "NOTIFY",
  "timestamp": 1778857995608,
  "payload": {
    "message": "Meeting in 5 minutes",
    "duration": 10000,
    "severity": "info"
  },
  "issuedBy": "admin_user_id"
}
```

---

## 4. Implementation Guide

### Setup MQTT Client
```javascript
import mqtt from 'mqtt';

const client = mqtt.connect(MQTT_BROKER_URL, {
  clientId: `vorce_dashboard_${userId}_${Date.now()}`,
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  reconnectPeriod: 5000,
  connectTimeout: 10000,
  clean: true,
});

client.on('connect', () => {
  console.log('Dashboard connected to MQTT');
  
  // Subscribe ke presence semua device di company
  const devices = getUserDevices(); // dari Firestore
  devices.forEach(device => {
    const topic = `vorce/${companyId}/devices/${device.deviceId}/presence`;
    client.subscribe(topic, { qos: 1 });
  });
  
  // Subscribe ke broadcast alerts
  client.subscribe(`vorce/${companyId}/alerts`, { qos: 1 });
});
```

### Handle Incoming Presence
```javascript
client.on('message', (topic, message) => {
  const payload = JSON.parse(message.toString());
  
  if (topic.includes('/presence')) {
    // Update UI real-time
    updateDevicePresenceUI({
      deviceId: payload.deviceId,
      status: payload.state,        // "active", "idle", "offline"
      currentApp: payload.currentApp,
      cpu: payload.cpuNow,
      ram: payload.ramNow,
      lastSeen: payload.timestamp,
    });
  }
  
  if (topic.includes('/alerts')) {
    showAlertNotification(payload);
  }
});
```

### Kirim Command ke Device
```javascript
function sendCommandToDevice(deviceId, commandType, payload = {}) {
  const topic = `vorce/${companyId}/devices/${deviceId}/commands`;
  
  const command = {
    type: commandType,
    timestamp: Date.now(),
    payload,
    issuedBy: currentUser.uid,
  };
  
  client.publish(topic, JSON.stringify(command), { qos: 1 }, (err) => {
    if (err) {
      console.error('Failed to send command:', err);
      // Fallback ke Firestore/Firebase Function
    } else {
      console.log('Command sent to', deviceId);
    }
  });
}

// Usage examples:
sendCommandToDevice(deviceId, 'LOCK_SCREEN');
sendCommandToDevice(deviceId, 'NOTIFY', { 
  message: 'Please focus on your task',
  severity: 'warning' 
});
```

---

## 5. Reconnection & Error Handling

```javascript
client.on('offline', () => {
  console.warn('MQTT offline - showing cached data');
  // Show last known status from Firestore
  showOfflineBanner();
});

client.on('error', (err) => {
  console.error('MQTT error:', err);
});

client.on('reconnect', () => {
  console.log('Reconnecting to MQTT...');
});

// Cleanup saat user logout/unmount
function disconnect() {
  if (client) {
    client.end(true);
  }
}
```

---

## 6. UI/UX Recommendations

### Real-time Device Card
```
┌─────────────────────────────┐
│ 🟢 Desktop-Helly            │  ← Status: active/idle/offline
│ User: helly@company.com     │
│                             │
│ App: VS Code (development)  │  ← Real-time dari MQTT
│ CPU: 45%  RAM: 62%          │  ← Real-time dari MQTT
│                             │
│ [Lock] [Notify] [Snapshot]  │  ← Kirim command
└─────────────────────────────┘
Last update: 2 seconds ago
```

### Connection Status Indicator
- 🟢 MQTT Connected (real-time)
- 🟡 Reconnecting...
- 🔴 Offline (showing cached data)

---

## 7. Security Considerations

⚠️ **JANGAN commit credential MQTT ke repo!**

Gunakan environment variables:
```javascript
// .env.local (jangan commit!)
NEXT_PUBLIC_MQTT_BROKER_URL=wss://...
NEXT_PUBLIC_MQTT_USERNAME=vorce
MQTT_PASSWORD=12#@sawah3G  // Server-side only
```

Atau lebih baik: **Proxy via backend API** supaya password MQTT tidak expose ke client browser.

### Recommended Architecture
```
Browser Dashboard → Your Backend API → HiveMQ MQTT
                          ↑
                   (password di server)
```

---

## 8. Testing Checklist

- [ ] Dashboard connect ke MQTT broker
- [ ] Subscribe ke presence topic berhasil
- [ ] Presence data muncul real-time saat Electron agent update
- [ ] Kirim command dari dashboard sampai ke Electron (cek log)
- [ ] Handle device offline (MQTT disconnect) dengan baik
- [ ] Reconnect otomatis saat network kembali
- [ ] Multiple device di dashboard bisa ditampilkan simultaneously

---

## 9. Fallback Strategy

Jika MQTT gagal, dashboard tetap bisa pakai:
1. **Firestore live_presence** collection (sudah ada)
2. **Polling API** setiap 30 detik
3. **Show cached data** dengan timestamp

---

## Questions?

Tanya ke: @helly (backend/Electron) untuk detail payload atau command handler.
