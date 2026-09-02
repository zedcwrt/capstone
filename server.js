const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const bridge = require('./mqtt-bridge')

const port = Number(process.env.PORT || 3000)
const publicDir = path.join(__dirname, 'public')
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(value)) }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  if (url.pathname === '/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' }); bridge.addClient(res); return }
  if (url.pathname === '/input') {
    const snapshot = bridge.snapshot()
    if (url.searchParams.get('mode') === 'history') return json(res, 200, { history: snapshot.history })
    if (url.searchParams.get('mode') === 'stats') {
      const stats = values => { const valid = values.filter(Number.isFinite); if (!valid.length) return { min: null, max: null, avg: null }; return { min: Math.min(...valid).toFixed(1), max: Math.max(...valid).toFixed(1), avg: (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1) } }
      return json(res, 200, { stats: { temp: stats(snapshot.history.map(d => d.body_temp)), hr: stats(snapshot.history.map(d => d.heart_rate)), spo2: stats(snapshot.history.map(d => d.spo2)) }, total: snapshot.total })
    }
    return json(res, 200, snapshot)
  }
  if (url.pathname === '/health') return json(res, 200, { ok: true, mqtt: bridge.connected, topic: bridge.topic })
  const requested = decodeURIComponent(url.pathname)
  const filePath = path.join(publicDir, requested === '/' ? 'index.html' : requested)
  if (!filePath.startsWith(publicDir)) return res.writeHead(403).end('Forbidden')
  fs.readFile(filePath, (error, content) => { if (error) return res.writeHead(404).end('Not found'); const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }; res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' }); res.end(content) })
})
server.listen(port, '0.0.0.0', () => console.log(`Preview server running on http://localhost:${port}`))
