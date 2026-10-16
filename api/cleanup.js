import { Redis } from '@upstash/redis';

const HISTORY_KEY = 'cardiotemp:sensor-history';
const LATEST_KEY = 'cardiotemp:latest';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!redis) return res.status(503).json({ error: 'Konfigurasi Redis belum tersedia' });

  try {
    await Promise.all([redis.del(HISTORY_KEY), redis.del(LATEST_KEY)]);
    const [remainingHistory, remainingLatest] = await Promise.all([
      redis.llen(HISTORY_KEY),
      redis.get(LATEST_KEY),
    ]);

    if (remainingHistory !== 0 || remainingLatest !== null) {
      return res.status(500).json({ error: 'Data Redis belum berhasil dihapus' });
    }

    return res.status(200).json({ ok: true, deleted: true });
  } catch (error) {
    console.error('[CRON] Redis cleanup error:', error);
    return res.status(503).json({ error: 'Pembersihan data gagal' });
  }
}
