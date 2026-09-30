// =============================================================
// api/input.js — Vercel Serverless Function
// Menerima data sensor ESP8266 dan menyimpannya ke Upstash Redis.
// =============================================================

import { Redis } from '@upstash/redis';

const HISTORY_KEY = 'cardiotemp:sensor-history';
const LATEST_KEY = 'cardiotemp:latest';
const MAX_HISTORY = 100;

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken
  ? new Redis({ url: redisUrl, token: redisToken })
  : null;

function requireRedis() {
  if (!redis) {
    const error = new Error('Konfigurasi Upstash Redis belum tersedia');
    error.code = 'REDIS_NOT_CONFIGURED';
    throw error;
  }
  return redis;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function calcStats(values) {
  if (!values.length) return { min: null, max: null, avg: null };
  const min = Math.min(...values).toFixed(1);
  const max = Math.max(...values).toFixed(1);
  const avg = (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1);
  return { min, max, avg };
}

function parseRecord(body) {
  if (!body || body.hr === undefined || body.spo2 === undefined || body.temp === undefined ||
      body.heartStatus === undefined || body.tempStatus === undefined) {
    return null;
  }

  const heartRate = Number.parseFloat(body.hr);
  const spo2 = Number.parseFloat(body.spo2);
  const bodyTemp = Number.parseFloat(body.temp);
  if (![heartRate, spo2, bodyTemp].every(Number.isFinite)) return null;

  return {
    heart_rate: heartRate,
    spo2,
    body_temp: bodyTemp,
    heartStatus: String(body.heartStatus),
    tempStatus: String(body.tempStatus),
    health_status: body.heartStatus === 'Normal' && body.tempStatus === 'Normal'
      ? 'Normal'
      : `${body.heartStatus} / ${body.tempStatus}`,
    timestamp: new Date().toISOString(),
  };
}

async function saveRecord(record) {
  await requireRedis().pipeline()
    .set(LATEST_KEY, record)
    .lpush(HISTORY_KEY, record)
    .ltrim(HISTORY_KEY, 0, MAX_HISTORY - 1)
    .exec();
}

async function getHistory() {
  const records = await requireRedis().lrange(HISTORY_KEY, 0, 29);
  return records.reverse();
}

async function getLatest() {
  return requireRedis().get(LATEST_KEY);
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'POST') {
      const record = parseRecord(req.body);
      if (!record) return res.status(400).json({ error: 'Field tidak lengkap atau angka sensor tidak valid' });

      await saveRecord(record);
      console.log('[POST] Data sensor tersimpan:', record.timestamp);
      return res.status(200).json({ ok: true, received: record, storage: 'upstash' });
    }

    if (req.method === 'GET') {
      const mode = req.query?.mode || 'latest';

      if (mode === 'history') return res.status(200).json({ history: await getHistory() });

      if (mode === 'stats') {
        const history = await getHistory();
        return res.status(200).json({
          stats: {
            temp: calcStats(history.map((item) => item.body_temp).filter(Number.isFinite)),
            hr: calcStats(history.map((item) => item.heart_rate).filter(Number.isFinite)),
            spo2: calcStats(history.map((item) => item.spo2).filter(Number.isFinite)),
          },
          total: history.length,
        });
      }

      return res.status(200).json({ data: await getLatest(), total: await requireRedis().llen(HISTORY_KEY), timestamp: new Date().toISOString() });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[MQTT/API] Redis error:', error);
    return res.status(503).json({ error: 'Penyimpanan data sedang tidak tersedia' });
  }
}
