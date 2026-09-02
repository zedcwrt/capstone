// =============================================================
// api/input.js  —  Vercel Serverless Function
// Menerima HTTP POST dari ESP8266 & melayani GET polling dashboard
// =============================================================

// Penyimpanan data sementara (in-memory, reset setiap cold-start)
// Untuk persistensi nyata, ganti dengan Vercel KV / PlanetScale / Supabase
let history = [];        // maks 100 data terakhir
let lastData = null;     // data terbaru

const MAX_HISTORY = 100;

// Helper CORS agar dashboard di domain Vercel bisa fetch
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Hitung statistik min/max/avg dari array angka
function calcStats(arr) {
  if (!arr.length) return { min: null, max: null, avg: null };
  const min  = Math.min(...arr).toFixed(1);
  const max  = Math.max(...arr).toFixed(1);
  const avg  = (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1);
  return { min, max, avg };
}

export default function handler(req, res) {
  cors(res);

  // Preflight OPTIONS (CORS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── POST: ESP8266 mengirim data sensor ──────────────────────
  if (req.method === 'POST') {
    const body = req.body;

    // Validasi field wajib
    if (
      body.hr        === undefined ||
      body.spo2      === undefined ||
      body.temp      === undefined ||
      body.heartStatus === undefined ||
      body.tempStatus  === undefined
    ) {
      return res.status(400).json({ error: 'Field tidak lengkap' });
    }

    const record = {
      heart_rate:   parseFloat(body.hr),
      spo2:         parseFloat(body.spo2),
      body_temp:    parseFloat(body.temp),
      heartStatus:  body.heartStatus,
      tempStatus:   body.tempStatus,
      health_status: body.heartStatus === 'Normal' && body.tempStatus === 'Normal'
                      ? 'Normal'
                      : `${body.heartStatus} / ${body.tempStatus}`,
      timestamp:    new Date().toISOString(),
    };

    lastData = record;
    history.push(record);
    if (history.length > MAX_HISTORY) history.shift();

    console.log('[POST] Data diterima:', record);
    return res.status(200).json({ ok: true, received: record });
  }

  // ── GET: Dashboard polling data terbaru ─────────────────────
  if (req.method === 'GET') {
    const mode = req.query.mode || 'latest';

    if (mode === 'history') {
      // Kirim 30 data terakhir untuk chart
      return res.status(200).json({ history: history.slice(-30) });
    }

    if (mode === 'stats') {
      const temps = history.map(d => d.body_temp).filter(Boolean);
      const hrs   = history.map(d => d.heart_rate).filter(Boolean);
      const spo2s = history.map(d => d.spo2).filter(Boolean);
      return res.status(200).json({
        stats: {
          temp: calcStats(temps),
          hr:   calcStats(hrs),
          spo2: calcStats(spo2s),
        },
        total: history.length,
      });
    }

    // Default: data terbaru saja
    return res.status(200).json({
      data:      lastData,
      total:     history.length,
      timestamp: new Date().toISOString(),
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
