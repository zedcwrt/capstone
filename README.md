# 🫀 IoT Health Monitor — ESP8266 + Vercel

Dashboard monitoring kesehatan real-time menggunakan ESP8266 sebagai pengirim data
dan Vercel sebagai backend + hosting dashboard.

---

## 📁 Struktur Project

```
health-monitor/
├── api/
│   └── input.js          ← Serverless function (backend Vercel)
├── public/
│   └── index.html        ← Dashboard web
├── kode_esp/
│   └── kode_esp.ino      ← Kode Arduino ESP8266
├── vercel.json           ← Konfigurasi routing Vercel
├── package.json
└── README.md
```

---

## 🚀 Cara Deploy ke Vercel (dari nol)

### 1. Buat akun Vercel
Daftar gratis di https://vercel.com — bisa pakai akun GitHub.

### 2. Install Vercel CLI
Buka terminal / Command Prompt, jalankan:
```bash
npm install -g vercel
```

### 3. Login ke Vercel
```bash
vercel login
```
Ikuti instruksi, pilih login via GitHub/email.

### 4. Upload project

Masuk ke folder project:
```bash
cd health-monitor
```

Deploy:
```bash
vercel
```

Jawab pertanyaan yang muncul:
- **Set up and deploy?** → `Y`
- **Which scope?** → pilih akun kamu
- **Link to existing project?** → `N`
- **What's your project's name?** → `health-monitor` (atau nama lain)
- **In which directory is your code located?** → `.` (titik, artinya folder ini)
- **Want to modify settings?** → `N`

Setelah selesai, Vercel akan memberikan URL seperti:
```
https://health-monitor-abc123.vercel.app
```

### 5. Deploy ke production
```bash
vercel --prod
```

---

## MQTT HiveMQ Cloud untuk ESP32

ESP32 pada `kode_esp/kode_esp.ino` mengirim CSV ke topic `health-monitor/sensors`. Backend Node membaca topic yang sama dan meneruskan data ke dashboard melalui SSE.

Set environment variable backend berikut sebelum menjalankan `npm start`:

```env
MQTT_HOST=a4f2e2e7a33540f88424719acae8eec4.s1.eu.hivemq.cloud
MQTT_PORT=8883
MQTT_TLS=true
MQTT_USERNAME=admin_cardiotemp
MQTT_PASSWORD=PASSWORD_HIVEMQ
MQTT_TOPIC=health-monitor/sensors
```

Backend otomatis memakai `mqtts://` untuk port 8883. Alternatifnya, gunakan `MQTT_BROKER_URL=mqtts://HOST:8883`. Jangan menaruh username/password di source code atau commit ke Git. Pastikan kredensial pada firmware ESP32 sama dengan environment backend, topic persis sama, dan setiap device memakai client ID unik.

Endpoint lokal:
- `GET /health` — status koneksi MQTT
- `GET /input` — data terbaru
- `GET /events` — stream data real-time dashboard

## ⚙️ Konfigurasi Setelah Deploy

### Update URL di kode ESP
Buka file `kode_esp/kode_esp.ino`, ubah baris ini:
```cpp
const char* server = "https://NAMA-PROJECT-KAMU.vercel.app/input";
```
Ganti dengan URL Vercel kamu, contoh:
```cpp
const char* server = "https://health-monitor-abc123.vercel.app/input";
```

Juga ubah WiFi:
```cpp
const char* ssid     = "NAMA_WIFI_KAMU";
const char* password = "PASSWORD_WIFI_KAMU";
```

### Upload kode ESP ke Arduino IDE
1. Buka Arduino IDE
2. Pastikan board ESP8266 sudah terinstall
   - File → Preferences → Additional Board Manager URLs:
     `http://arduino.esp8266.com/stable/package_esp8266com_index.json`
   - Tools → Board → Board Manager → cari "ESP8266" → Install
3. Pilih board: Tools → Board → **NodeMCU 1.0 (ESP-12E Module)**
4. Pilih port yang sesuai
5. Upload `kode_esp.ino`

---

## 🌐 Cara Akses Dashboard

Buka browser, akses URL Vercel kamu:
```
https://health-monitor-abc123.vercel.app
```

Dashboard akan otomatis polling data setiap 3 detik dari server.

---

## 📡 Cara Kerja Sistem

```
Arduino (sensor)
     │
     │  Serial (D5/D6)
     ▼
ESP8266
     │
     │  HTTPS POST JSON ke /input
     ▼
Vercel (api/input.js)
     │
     │  menyimpan data di memory
     ▼
Dashboard (public/index.html)
     │  polling GET /input?mode=latest setiap 3 detik
     └─ polling GET /input?mode=stats setiap 15 detik
```

### Format data dari Arduino ke ESP (Serial):
```
HR,SPO2,TEMP,heartStatus,tempStatus\n
Contoh: 72.0,98.5,36.7,Normal,Normal\n
```

### Format JSON yang dikirim ESP ke Vercel:
```json
{
  "hr": 72.0,
  "spo2": 98.5,
  "temp": 36.7,
  "heartStatus": "Normal",
  "tempStatus": "Normal"
}
```

### API Endpoints:
| Endpoint | Method | Deskripsi |
|---|---|---|
| `/input` | POST | Terima data dari ESP8266 |
| `/input?mode=latest` | GET | Data terbaru (untuk polling) |
| `/input?mode=history` | GET | 30 data terakhir (untuk chart) |
| `/input?mode=stats` | GET | Statistik min/max/avg |

---

## ⚠️ Catatan Penting

**Data hilang saat server restart** — Vercel serverless function menyimpan data
di memory. Jika ingin data permanen, sambungkan ke database seperti:
- **Vercel KV** (Redis) — termudah, gratis tier tersedia
- **Supabase** (PostgreSQL) — gratis, fitur lengkap
- **PlanetScale** (MySQL) — cocok untuk data banyak

**Cara tambah Vercel KV** (opsional):
1. Buka dashboard Vercel → Storage → Create KV Database
2. Copy environment variable `KV_REST_API_URL` dan `KV_REST_API_TOKEN`
3. Modifikasi `api/input.js` untuk menggunakan `@vercel/kv`

---

## 🔧 Troubleshooting

| Masalah | Solusi |
|---|---|
| Dashboard offline terus | Pastikan URL di HTML sudah benar dan vercel deploy berhasil |
| ESP gagal POST | Cek URL server di .ino, cek Serial Monitor untuk error |
| Data tidak update | Cek Serial Monitor ESP, pastikan format data Arduino benar |
| HTTP Code -1 | Masalah SSL/koneksi, pastikan `client.setInsecure()` ada |
| HTTP Code 400 | Format JSON salah, cek pemisah koma di data Arduino |
