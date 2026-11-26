import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../database/connection.js';

interface RouteCounter {
  count: number;
  errors: number;
  totalDurationMs: number;
}

class MetricsCollector {
  private httpRoutes = new Map<string, RouteCounter>();
  public counters = {
    transfersCompleted: 0,
    transfersPending: 0,
    transfersFailed: 0,
    webhooksProcessed: 0,
    webhooksDeduplicated: 0,
    webhooksRejected: 0,
    riskAssessments: 0,
    riskFallbacks: 0,
    notificationsSent: 0,
    notificationsFailed: 0,
  };
  private startedAt = new Date();

  recordHttp(method: string, routeKey: string, statusCode: number, durationMs: number): void {
    const key = `${method} ${routeKey}`;
    const existing = this.httpRoutes.get(key) ?? { count: 0, errors: 0, totalDurationMs: 0 };
    existing.count += 1;
    if (statusCode >= 500) existing.errors += 1;
    existing.totalDurationMs += durationMs;
    this.httpRoutes.set(key, existing);
  }

  async getSnapshot() {
    let outboxPending = 0;
    let outboxFailed = 0;
    let openExceptions = 0;

    try {
      const db = getDb();
      const [pendingRow, failedRow, excRow] = await Promise.all([
        db('outbox_events').whereIn('status', ['PENDING', 'PROCESSING']).count('id as count').first(),
        db('outbox_events').where({ status: 'FAILED' }).count('id as count').first(),
        db('reconciliation_exceptions').where({ status: 'OPEN' }).count('id as count').first(),
      ]);
      outboxPending = Number((pendingRow as Record<string, unknown> | undefined)?.['count'] ?? 0);
      outboxFailed = Number((failedRow as Record<string, unknown> | undefined)?.['count'] ?? 0);
      openExceptions = Number((excRow as Record<string, unknown> | undefined)?.['count'] ?? 0);
    } catch {
      // Non-fatal if DB unreachable when scraping metrics
    }

    const routes: Record<string, { count: number; errors: number; avgDurationMs: number }> = {};
    for (const [k, v] of this.httpRoutes.entries()) {
      routes[k] = {
        count: v.count,
        errors: v.errors,
        avgDurationMs: v.count > 0 ? Math.round((v.totalDurationMs / v.count) * 100) / 100 : 0,
      };
    }

    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt.getTime()) / 1000),
      counters: this.counters,
      gauges: {
        outboxPending,
        outboxFailed,
        openReconciliationExceptions: openExceptions,
      },
      routes,
    };
  }
}

export const metrics = new MetricsCollector();

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();
  res.on('finish', () => {
    const duration = performance.now() - start;
    const base = req.baseUrl || '';
    const path = req.route?.path ? String(req.route.path) : req.path;
    metrics.recordHttp(req.method, `${base}${path}`, res.statusCode, duration);
  });
  next();
}
