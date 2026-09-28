const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');
let history = [];

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

function stats(values) {
  if (!values.length) return { min: null, max: null, avg: null };
  return {
    min: Math.min(...values).toFixed(1),
    max: Math.max(...values).toFixed(1),
    avg: (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1),
  };
}

function handleInput(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, {});

  if (req.method === 'POST') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        const required = ['hr', 'spo2', 'temp', 'heartStatus', 'tempStatus'];
        if (required.some((key) => body[key] === undefined)) {
          return json(res, 400, { error: 'Field tidak lengkap' });
        }
        const record = {
          heart_rate: Number(body.hr),
          spo2: Number(body.spo2),
          body_temp: Number(body.temp),
          heartStatus: String(body.heartStatus),
          tempStatus: String(body.tempStatus),
          health_status: body.heartStatus === 'Normal' && body.tempStatus === 'Normal'
            ? 'Normal' : `${body.heartStatus} / ${body.tempStatus}`,
          timestamp: new Date().toISOString(),
        };
        history.push(record);
        history = history.slice(-100);
        return json(res, 200, { ok: true, received: record });
      } catch {
        return json(res, 400, { error: 'JSON tidak valid' });
      }
    });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const latest = history.at(-1) || null;
  if (url.searchParams.get('mode') === 'history') return json(res, 200, { history: history.slice(-30) });
  if (url.searchParams.get('mode') === 'stats') {
    return json(res, 200, {
      stats: {
        temp: stats(history.map((item) => item.body_temp)),
        hr: stats(history.map((item) => item.heart_rate)),
        spo2: stats(history.map((item) => item.spo2)),
      },
      total: history.length,
    });
  }
  return json(res, 200, { data: latest, total: history.length, timestamp: new Date().toISOString() });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/input')) return handleInput(req, res);

  const requested = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const filePath = path.normalize(path.join(publicDir, requested === '/' ? 'index.html' : requested));
  if (!filePath.startsWith(publicDir)) return res.writeHead(403).end();
  fs.readFile(filePath, (error, content) => {
    if (error) return res.writeHead(404).end('Not found');
    const type = filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[v0] Preview available at http://localhost:${port}`);
});

server.on('error', (error) => {
  console.error('[v0] Preview server error:', error.message);
  process.exitCode = 1;
});
