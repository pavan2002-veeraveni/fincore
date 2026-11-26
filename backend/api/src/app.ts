import express, { type Express, type Request, type Response, type NextFunction, Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';

import { config } from './config/index.js';
import { metrics, metricsMiddleware } from './infrastructure/metrics/index.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { authenticate } from './middleware/auth.middleware.js';
import { authorize } from './middleware/authorize.middleware.js';
import { generalLimiter } from './middleware/rate-limit.middleware.js';
import { logger } from './infrastructure/logger/index.js';

// Route imports
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { customersRoutes } from './modules/customers/customers.routes.js';
import { walletsRoutes } from './modules/wallets/wallets.routes.js';
import { beneficiariesRoutes } from './modules/beneficiaries/beneficiaries.routes.js';
import { transfersRoutes } from './modules/transfers/transfers.routes.js';
import { paymentsRoutes } from './modules/payments/payments.routes.js';
import { refundsRoutes, reversalsRoutes } from './modules/refunds/refunds.routes.js';
import { disputesRoutes } from './modules/disputes/disputes.routes.js';
import { webhooksRoutes } from './modules/webhooks/webhooks.routes.js';
import { reconciliationRoutes } from './modules/reconciliation/reconciliation.routes.js';
import { riskRoutes } from './modules/risk/risk.routes.js';
import { statementsRoutes } from './modules/statements/statements.routes.js';
import { operationsRoutes } from './modules/operations/operations.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { ledgerRoutes } from './modules/ledger/ledger.routes.js';

const app: Express = express();

// 1. Security headers & trust proxy
app.set('trust proxy', 1);
app.use(helmet());

// 2. CORS
app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));

// 3. Compression
app.use(compression());

// 4. Request ID (before parsers so malformed JSON errors carry correlation ID)
app.use(requestIdMiddleware);

// 5. Raw body for webhook routes (HMAC verification requires unparsed bytes)
app.use(
  '/api/v1/webhooks',
  express.raw({ type: '*/*', limit: '1mb' }),
  (req: Request, _res: Response, next: NextFunction) => {
    if (Buffer.isBuffer(req.body)) {
      req.rawBody = req.body;
    }
    next();
  },
);

// 6. Standard JSON parser for all non-webhook routes
app.use(express.json({ limit: '1mb' }));

// 7. Metrics & request logging
app.use(metricsMiddleware);
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info({
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });
  next();
});

// 8. API Routes
const v1 = Router();
v1.use(generalLimiter);

// Public routes
v1.use('/health', healthRoutes);
v1.use('/auth', authRoutes);
v1.use('/webhooks', webhooksRoutes); // Authenticated via HMAC signature over raw body
v1.get('/openapi.yaml', (req: Request, res: Response) => {
  const candidates = [
    path.resolve(process.cwd(), 'docs/openapi.yaml'),
    path.resolve(process.cwd(), '../../docs/openapi.yaml'),
  ];
  const specPath = candidates.find((p) => fs.existsSync(p));
  if (!specPath) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'OpenAPI specification not found', requestId: req.requestId } });
    return;
  }
  res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
  res.send(fs.readFileSync(specPath, 'utf-8'));
});

// Protected operational metrics endpoint
v1.get(
  '/metrics',
  authenticate,
  authorize('OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const snapshot = await metrics.getSnapshot();
      res.json({ data: snapshot, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },
);

// Customer & shared authenticated routes
v1.use('/customers', authenticate, customersRoutes);
v1.use('/wallets', authenticate, authorize('CUSTOMER', 'PLATFORM_ADMIN', 'OPERATIONS_ANALYST', 'FINANCE_ADMIN'), walletsRoutes);
v1.use('/beneficiaries', authenticate, authorize('CUSTOMER'), beneficiariesRoutes);
v1.use('/transfers', authenticate, authorize('CUSTOMER', 'OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'), transfersRoutes);
v1.use('/payment-intents', authenticate, authorize('CUSTOMER', 'OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'), paymentsRoutes);
v1.use('/statements', authenticate, authorize('CUSTOMER'), statementsRoutes);
v1.use('/disputes', authenticate, authorize('CUSTOMER', 'SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'), disputesRoutes);

// Refunds & Reversals
v1.use('/refunds', authenticate, authorize('CUSTOMER', 'SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'), refundsRoutes);
v1.use('/reversals', authenticate, authorize('FINANCE_ADMIN', 'OPERATIONS_ANALYST', 'PLATFORM_ADMIN'), reversalsRoutes);

// Operations, Risk, Reconciliation, Admin & Ledger routes
v1.use('/reconciliation', authenticate, authorize('OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'), reconciliationRoutes);
v1.use('/risk', authenticate, authorize('OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'), riskRoutes);
v1.use('/operations', authenticate, authorize('OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_AGENT'), operationsRoutes);
v1.use('/admin', authenticate, authorize('PLATFORM_ADMIN', 'FINANCE_ADMIN'), adminRoutes);
v1.use('/ledger', authenticate, authorize('OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'), ledgerRoutes);

app.use('/api/v1', v1);

// 9. JSON 404 catch-all before error handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
      requestId: req.requestId,
    },
  });
});

// 10. Error handling (must be last)
app.use(errorMiddleware);

export { app };
