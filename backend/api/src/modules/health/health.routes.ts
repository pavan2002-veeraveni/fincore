import { Router, type Request, type Response } from 'express';
import { getDb } from '../../infrastructure/database/connection.js';
import { config } from '../../config/index.js';

const router = Router();

router.get('/live', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'fincore-api',
  });
});

router.get('/ready', async (_req: Request, res: Response) => {
  let dbStatus: 'ok' | 'error' = 'error';
  let riskStatus: 'ok' | 'degraded' = 'degraded';

  try {
    await getDb().raw('SELECT 1');
    dbStatus = 'ok';
  } catch {
    dbStatus = 'error';
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const resp = await fetch(`${config.RISK_SERVICE_URL}/health/ready`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (resp.ok) riskStatus = 'ok';
  } catch {
    riskStatus = 'degraded';
  }

  if (dbStatus !== 'ok') {
    res.status(503).json({
      status: 'unavailable',
      checks: { database: dbStatus, riskService: riskStatus },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.json({
    status: 'ok',
    checks: { database: dbStatus, riskService: riskStatus },
    timestamp: new Date().toISOString(),
  });
});

export const healthRoutes = router;
