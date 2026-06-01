# Panduan Integrasi Web: Spesifikasi Perangkat, Beban GPU, dan Histori Perangkat Keras

Dokumen ini menjelaskan skema database lengkap dan cara mengonsumsi (*consume*) data terbaru dari Electron Agent ke dalam Dashboard Web Vorce (misal React/Next.js).

---

## 1. Ringkasan Data Baru & Lokasi Penyimpanan

Data yang dikirimkan oleh Electron Agent dibagi ke dalam dua database utama: **Realtime Database (RTDB)** untuk data metrik langsung (*live telemetry*) dan **Cloud Firestore** untuk spesifikasi perangkat serta histori perubahan *hardware*.

| Data / Metrik | Jenis | Database | Lokasi Path / Koleksi |
|---|---|---|---|
| **Beban GPU (`gpuNow`)** | Live (5s) | RTDB | `/status/{companyId}/{deviceId}` |
| **IP Lokal (`localIp`)** | Live (5s) | RTDB | `/status/{companyId}/{deviceId}` |
| **GPU Rata-rata (`gpuAverage`)** | Rolling (5m) | RTDB | `/stats/{companyId}/{deviceId}` |
| **GPU Peak (`gpuPeak`)** | Rolling (5m) | RTDB | `/stats/{companyId}/{deviceId}` |
| **Spesifikasi Lengkap (CPU, RAM, GPU, SSD, IP, MAC)** | Statis | Firestore | `companies/{companyId}/device_monitoring/{deviceId}` |
| **Histori Perubahan Hardware (`cpuHistory`, `ramHistory`, etc.)** | Histori | Firestore | `companies/{companyId}/device_monitoring/{deviceId}` |

---

## 2. Skema Database Lengkap

### A. Realtime Database (RTDB)

#### 1. Node Status/Presence (Update Setiap 5 Detik)
**Path:** `/status/{companyId}/{deviceId}`
```json
{
  "deviceId": "desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb",
  "companyId": "CTD96L",
  "userId": "USER_ID",
  "userName": "Hellyoshaqiqie",
  "userEmail": "hellyoshaqiqie9@gmail.com",
  "state": "online",
  "currentApp": "Code.exe",
  "currentCategory": "Productivity",
  "cpuNow": 12.5,
  "ramNow": 68.4,
  "gpuNow": 3.5,
  "localIp": "192.168.1.13",
  "wifi": "Vorce_Office_5G",
  "location": "Surabaya, East Java, Indonesia",
  "lastSeen": 1779180000000,
  "updatedAt": 1779180000000
}
```

#### 2. Node Stats Summary (Update Setiap 5 Menit)
**Path:** `/stats/{companyId}/{deviceId}`
```json
{
  "summaryId": "USER_ID_desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb_2026-05-30",
  "companyId": "CTD96L",
  "userId": "USER_ID",
  "deviceId": "desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb",
  "date": "2026-05-30",
  "final": false,
  "performance": {
    "cpuAverage": 15.4,
    "cpuPeak": 91.2,
    "ramAverage": 64.3,
    "ramPeak": 82.8,
    "gpuAverage": 5.2,
    "gpuPeak": 35.8
  },
  "updatedAt": 1779180000000
}
```

---

### B. Cloud Firestore (Spesifikasi & Histori)

**Koleksi:** `companies/{companyId}/device_monitoring/{deviceId}`

Setiap kali Electron Agent dinyalakan, ia akan membandingkan spesifikasi perangkat keras saat ini dengan riwayat terakhir yang tercatat di dokumen Firestore. Jika terdeteksi adanya perbedaan (misalnya RAM ditambah, SSD diganti, atau GPU di-upgrade), entri baru akan otomatis dimasukkan ke dalam array histori masing-masing komponen.

```json
{
  "deviceId": "desktop_hellyoshaqiqie_6ea921462f7cfeb9470e90fb",
  "companyId": "CTD96L",
  "userId": "USER_ID",
  "userName": "Hellyoshaqiqie",
  "userEmail": "hellyoshaqiqie9@gmail.com",
  "hostname": "Hellyoshaqiqie",
  "platform": "win32",
  "arch": "x64",
  "os": "Microsoft Windows 11 Home Single Language 10.0.26200",
  "osVersion": "25H2",
  "osRelease": "10.0.26200",
  "kernel": "10.0.26200",
  
  "cpu": {
    "manufacturer": "Intel",
    "brand": "Gen Intel® Core™ i5-1235U",
    "physicalCores": 10,
    "logicalCores": 12,
    "speedGHz": 1.3
  },
  
  "ram": {
    "totalGB": 7.71,
    "type": "DDR4",
    "clockSpeed": 3200,
    "manufacturer": "Samsung Electronics Inc."
  },
  
  "gpu": {
    "vendor": "Intel Corporation",
    "model": "Intel(R) Iris(R) Xe Graphics",
    "vramMB": 1024
  },
  
  "disk": {
    "type": "SSD",
    "name": "NVMe KINGSTON OM8PGP4512Q-AI",
    "vendor": "Kingston Technology",
    "sizeGB": 476.94,
    "interfaceType": "NVMe"
  },
  
  "network": {
    "localIp": "192.168.1.13",
    "macAddress": "04:ec:d8:8d:bf:8a"
  },
  
  "cpuHistory": [
    {
      "timestamp": "2026-05-30T09:27:03.000Z",
      "value": "Intel Gen Intel® Core™ i5-1235U"
    }
  ],
  
  "ramHistory": [
    {
      "timestamp": "2026-05-30T09:27:03.000Z",
      "value": "7.71 GB DDR4 (Samsung Electronics Inc.)"
    }
  ],
  
  "gpuHistory": [
    {
      "timestamp": "2026-05-30T09:27:03.000Z",
      "value": "Intel Corporation Intel(R) Iris(R) Xe Graphics"
    }
  ],
  
  "ssdHistory": [
    {
      "timestamp": "2026-05-30T09:27:03.000Z",
      "value": "Kingston Technology NVMe KINGSTON OM8PGP4512Q-AI (476.94 GB) SSD"
    }
  ],
  
  "status": "online",
  "lastSeen": "Timestamp",
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp"
}
```

---

## 3. Integrasi & Konsumsi di Dashboard Web

### A. Mendengarkan Beban GPU Dinamis dan IP Lokal secara Real-time
Gunakan listener Realtime Database untuk memperbarui UI live monitoring di dashboard web:

```typescript
import { getDatabase, ref, onValue } from "firebase/database";

const db = getDatabase();
const presenceRef = ref(db, `status/${companyId}/${deviceId}`);

onValue(presenceRef, (snapshot) => {
  const presence = snapshot.val();
  if (presence) {
    console.log("Live GPU Load:", presence.gpuNow); // e.g. 14.5
    console.log("Local IP Address:", presence.localIp); // e.g. "192.168.1.13"
    
    // Perbarui state dashboard Anda
    updateUI({
      gpuUsage: presence.gpuNow || 0,
      localIp: presence.localIp || "N/A",
      cpuUsage: presence.cpuNow || 0,
      ramUsage: presence.ramNow || 0,
    });
  }
});
```

---

### B. Menampilkan Spesifikasi dan Histori Perubahan di Web
Ambil dokumen spesifikasi perangkat dari Firestore untuk di-render di halaman detail *Device*:

```typescript
import { doc, getDoc } from "firebase/firestore";
import { firestore } from "./firebase"; // firebase config Anda

async function fetchDeviceSpecs(companyId: string, deviceId: string) {
  const docRef = doc(firestore, "companies", companyId, "device_monitoring", deviceId);
  const snap = await getDoc(docRef);
  
  if (snap.exists()) {
    const data = snap.data();
    
    // Data Spesifikasi Utama
    const specs = {
      cpuBrand: data.cpu?.brand || "Unknown",
      ramType: `${data.ram?.totalGB} GB ${data.ram?.type || ""} @ ${data.ram?.clockSpeed} MHz`,
      gpuModel: data.gpu?.model || "Unknown",
      ssdModel: `${data.disk?.name} (${data.disk?.sizeGB} GB) ${data.disk?.interfaceType}`,
      localIp: data.network?.localIp || "N/A",
      macAddress: data.network?.macAddress || "N/A",
    };
    
    // Gabungkan Histori Penggantian Hardware
    const historyTimeline = [
      ...(data.cpuHistory || []).map((h: any) => ({ type: "CPU Upgrade", ...h })),
      ...(data.ramHistory || []).map((h: any) => ({ type: "RAM Upgrade", ...h })),
      ...(data.gpuHistory || []).map((h: any) => ({ type: "GPU Upgrade", ...h })),
      ...(data.ssdHistory || []).map((h: any) => ({ type: "SSD Replacement", ...h })),
    ];
    
    // Urutkan berdasarkan tanggal terbaru
    historyTimeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return { specs, historyTimeline };
  }
  
  return null;
}
```

---

### C. Contoh Komponen Tampilan Histori (React / TSX)
Berikut adalah contoh komponen sederhana untuk merender timeline perubahan hardware di web:

```tsx
import React from 'react';

interface HistoryItem {
  type: string;
  value: string;
  timestamp: string | { seconds: number };
}

export function HardwareHistoryTimeline({ timeline }: { timeline: HistoryItem[] }) {
  if (!timeline || timeline.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 bg-gray-50 rounded-lg">
        Tidak ada riwayat penggantian perangkat keras pada workstation ini.
      </div>
    );
  }

  return (
    <div className="flow-root">
      <ul className="-mb-8">
        {timeline.map((item, index) => {
          const date = item.timestamp instanceof Object && 'seconds' in item.timestamp
            ? new Date(item.timestamp.seconds * 1000)
            : new Date(item.timestamp);
            
          return (
            <li key={index}>
              <div className="relative pb-8">
                {index !== timeline.length - 1 && (
                  <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true" />
                )}
                <div className="relative flex space-x-3">
                  <div>
                    <span className="h-8 w-8 rounded-full bg-indigo-50 flex items-center justify-center ring-8 ring-white">
                      ⚙️
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 pt-1.5 flex justify-between space-x-4">
                    <div>
                      <p className="text-sm font-semibold text-indigo-600 uppercase tracking-wider">{item.type}</p>
                      <p className="text-sm text-gray-800 font-medium mt-0.5">{item.value}</p>
                    </div>
                    <div className="text-right text-xs whitespace-nowrap text-gray-400">
                      {date.toLocaleDateString('id-ID')} {date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```
