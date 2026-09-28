// =====================================================
// server.js — Backend untuk di-deploy ke RENDER
// Menerima HTTP POST langsung dari ESP32 (tanpa MQTT/HiveMQ)
// dan push real-time ke dashboard lewat SSE (/events)
// =====================================================
const http = require('node:http')

const port = Number(process.env.PORT || 3000)
const MAX_HISTORY = 100

const history = []
const clients = new Set()
let lastData = null

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function json(res, status, value) {
  cors(res)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

function calcStats(arr) {
  const valid = arr.filter(Number.isFinite)
  if (!valid.length) return { min: null, max: null, avg: null }
  return {
    min: Math.min(...valid).toFixed(1),
    max: Math.max(...valid).toFixed(1),
    avg: (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1),
  }
}

// Validasi & normalisasi payload dari ESP32 (JSON)
function parseBody(body) {
  const hr = Number(body.hr)
  const spo2 = Number(body.spo2)
  const temp = Number(body.temp)
  const heartStatus = String(body.heartStatus ?? 'Normal').trim()
  const tempStatus = String(body.tempStatus ?? 'Normal').trim()

  const values = [hr, spo2, temp]
  if (!values.every(Number.isFinite)) throw new Error('Nilai sensor tidak valid / NaN')
  if (values[0] < 0 || values[0] > 250 || values[1] < 0 || values[1] > 100 || values[2] < -40 || values[2] > 125) {
    throw new Error('Nilai sensor di luar rentang wajar')
  }

  return {
    heart_rate: values[0],
    spo2: values[1],
    body_temp: values[2],
    heartStatus,
    tempStatus,
    health_status: heartStatus === 'Normal' && tempStatus === 'Normal' ? 'Normal' : `${heartStatus} / ${tempStatus}`,
    timestamp: new Date().toISOString(),
  }
}

function publish(record) {
  lastData = record
  history.push(record)
  if (history.length > MAX_HISTORY) history.shift()

  const message = `data: ${JSON.stringify(record)}\n\n`
  for (const client of clients) {
    try { client.write(message) } catch { clients.delete(client) }
  }
}

function snapshot() {
  return {
    data: lastData,
    history: history.slice(-30),
    total: history.length,
    timestamp: new Date().toISOString(),
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch (e) { reject(new Error('Body bukan JSON valid')) }
    })
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end() }

  // SSE: push real-time ke dashboard
  if (url.pathname === '/events') {
    cors(res)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  // Endpoint utama: ESP32 POST data ke sini, dashboard GET data dari sini
  if (url.pathname === '/input') {
    if (req.method === 'POST') {
      try {
        const body = await readBody(req)
        const record = parseBody(body)
        publish(record)
        console.log('[POST] Data diterima:', record)
        return json(res, 200, { ok: true, received: record })
      } catch (err) {
        console.error('[POST] Ditolak:', err.message)
        return json(res, 400, { error: err.message })
      }
    }

    if (req.method === 'GET') {
      const mode = url.searchParams.get('mode') || 'latest'
      const snap = snapshot()
      if (mode === 'history') return json(res, 200, { history: snap.history })
      if (mode === 'stats') {
        return json(res, 200, {
          stats: {
            temp: calcStats(snap.history.map(d => d.body_temp)),
            hr: calcStats(snap.history.map(d => d.heart_rate)),
            spo2: calcStats(snap.history.map(d => d.spo2)),
          },
          total: snap.total,
        })
      }
      return json(res, 200, snap)
    }
  }

  if (url.pathname === '/health') return json(res, 200, { ok: true })

  cors(res)
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(port, '0.0.0.0', () => console.log(`Backend jalan di http://localhost:${port}`))
