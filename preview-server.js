const http = require('http');
const fs = require('fs');
const path = require('path');

// The preview process is started directly with Node, so load the project env file
// before creating the Redis client. Vercel supplies these variables automatically
// in deployed serverless functions.
const envFiles = [
  path.join(__dirname, '.env.development.local'),
  '/vercel/share/.env.project',
];
for (const envFile of envFiles) {
  if (!fs.existsSync(envFile)) continue;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['\"])(.*)\1$/, '$2');
  }
}

const { Redis } = require('@upstash/redis');

const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');
const HISTORY_KEY = 'cardiotemp:sensor-history';
const LATEST_KEY = 'cardiotemp:latest';
const MAX_HISTORY = 100;
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

function validateRedisConfig() {
  if (!process.env.UPSTASH_REDIS_REST_URL && !process.env.KV_REST_API_URL) {
    throw new Error('UPSTASH_REDIS_REST_URL atau KV_REST_API_URL belum tersedia');
  }
  if (!process.env.UPSTASH_REDIS_REST_TOKEN && !process.env.KV_REST_API_TOKEN) {
    throw new Error('UPSTASH_REDIS_REST_TOKEN atau KV_REST_API_TOKEN belum tersedia');
  }
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

async function handleInput(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, {});

  try {
    validateRedisConfig();

    if (req.method === 'DELETE') {
      await Promise.all([
        redis.del(HISTORY_KEY),
        redis.del(LATEST_KEY),
      ]);

      const [remainingHistory, remainingLatest] = await Promise.all([
        redis.llen(HISTORY_KEY),
        redis.get(LATEST_KEY),
      ]);
      const deleted = remainingHistory === 0 && remainingLatest === null;
      if (!deleted) throw new Error('Redis masih berisi data sensor setelah reset');

      console.log('[v0] Sensor data permanently deleted from Redis');
      return json(res, 200, { ok: true, storage: 'upstash', deleted: true });
    }

    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', async () => {
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
          if (![record.heart_rate, record.spo2, record.body_temp].every(Number.isFinite)) {
            return json(res, 400, { error: 'Nilai sensor tidak valid' });
          }
          await redis.pipeline()
            .set(LATEST_KEY, record)
            .lpush(HISTORY_KEY, record)
            .ltrim(HISTORY_KEY, 0, MAX_HISTORY - 1)
            .exec();
          return json(res, 200, { ok: true, received: record, storage: 'upstash' });
        } catch (error) {
          console.error('[v0] Sensor input error:', error.message);
          return json(res, 503, { error: 'Penyimpanan data sedang tidak tersedia' });
        }
      });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const history = (await redis.lrange(HISTORY_KEY, 0, 29)).reverse();
    const latest = await redis.get(LATEST_KEY);
    if (url.searchParams.get('mode') === 'history') return json(res, 200, { history });
    if (url.searchParams.get('mode') === 'stats') {
      return json(res, 200, {
        stats: {
          temp: stats(history.map((item) => item.body_temp).filter(Number.isFinite)),
          hr: stats(history.map((item) => item.heart_rate).filter(Number.isFinite)),
          spo2: stats(history.map((item) => item.spo2).filter(Number.isFinite)),
        },
        total: history.length,
      });
    }
    return json(res, 200, { data: latest, total: await redis.llen(HISTORY_KEY), timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[v0] Redis unavailable:', error.message);
    return json(res, 503, { error: 'Penyimpanan data sedang tidak tersedia' });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/input') || req.url.startsWith('/api/input')) return handleInput(req, res);

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
