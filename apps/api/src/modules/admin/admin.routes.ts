import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { PaginationQuery } from '@fincore/contracts';
import { getDb } from '../../infrastructure/database/connection.js';
import { config } from '../../config/index.js';
import { getParam, parseCount } from '../../shared/utils/http.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors/index.js';
import { requireStepUp } from '../../middleware/step-up.middleware.js';
import { authorize } from '../../middleware/authorize.middleware.js';
import { sensitiveActionLimiter } from '../../middleware/rate-limit.middleware.js';
import { validateParams, UuidParamSchema } from '../../middleware/validate.middleware.js';
import { SYSTEM_USER_ID } from '../../infrastructure/database/migrations/004_system_accounts_and_hardening.js';
import { replayDeadLetterOutboxEvent } from '../../infrastructure/queue/outbox-dispatcher.js';

const router = Router();

const AuditQuerySchema = PaginationQuery.extend({
  action: z.string().max(100).optional(),
  resourceType: z.string().max(100).optional(),
  actorId: z.string().uuid().optional(),
});

const PatchRolesSchema = z.object({
  roles: z
    .array(z.enum(['CUSTOMER', 'SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN']))
    .min(1, 'At least one role must be assigned'),
});

const PatchUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
  reason: z.string().min(3).max(500).optional(),
});

router.get('/audit-events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { page, pageSize, action, resourceType, actorId } = AuditQuerySchema.parse(req.query);
    const offset = (page - 1) * pageSize;

    let query = db('audit_events');
    if (action) query = query.where({ action });
    if (resourceType) query = query.where({ resource_type: resourceType });
    if (actorId) query = query.where({ actor_id: actorId });

    const [events, countRows] = await Promise.all([
      query.clone().orderBy('created_at', 'desc').offset(offset).limit(pageSize),
      query.clone().count('id as count'),
    ]);

    res.json({
      data: events,
      meta: { requestId: req.requestId, page, pageSize, total: parseCount(countRows) },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { page, pageSize } = PaginationQuery.parse(req.query);
    const offset = (page - 1) * pageSize;

    const [users, countRows] = await Promise.all([
      db('users')
        .whereNot({ email: 'system@fincore.internal' })
        .select('id', 'email', 'first_name', 'last_name', 'status', 'created_at')
        .orderBy('created_at', 'desc')
        .offset(offset)
        .limit(pageSize),
      db('users').whereNot({ email: 'system@fincore.internal' }).count('id as count'),
    ]);

    const userIds = users.map((u: { id: string }) => u.id);
    const roleRows = userIds.length
      ? await db('user_roles as ur')
          .join('roles as r', 'ur.role_id', 'r.id')
          .whereIn('ur.user_id', userIds)
          .select<{ user_id: string; name: string }[]>('ur.user_id', 'r.name')
      : [];

    const rolesByUser = new Map<string, string[]>();
    for (const row of roleRows) {
      const list = rolesByUser.get(row.user_id) ?? [];
      list.push(row.name);
      rolesByUser.set(row.user_id, list);
    }

    const enriched = users.map((u: { id: string }) => ({
      ...u,
      roles: rolesByUser.get(u.id) ?? [],
    }));

    res.json({
      data: enriched,
      meta: { requestId: req.requestId, page, pageSize, total: parseCount(countRows) },
    });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/users/:id/roles',
  authorize('PLATFORM_ADMIN'),
  validateParams(UuidParamSchema),
  sensitiveActionLimiter,
  requireStepUp('ROLE_CHANGE', 'ALL'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getDb();
      const userId = getParam(req, 'id');
      if (userId === SYSTEM_USER_ID) {
        throw new ForbiddenError('System service account roles cannot be modified');
      }
      if (userId === req.userId) {
        throw new ForbiddenError('Administrators cannot modify their own roles');
      }
      const { roles } = PatchRolesSchema.parse(req.body);
      const uniqueRoles = [...new Set(roles)];

      await db.transaction(async (trx) => {
        const user = await trx('users').where({ id: userId }).first();
        if (!user) throw new NotFoundError('User not found');

        const roleRows = await trx('roles').whereIn('name', uniqueRoles);
        if (roleRows.length !== uniqueRoles.length) {
          throw new ValidationError('One or more roles do not exist');
        }

        await trx('user_roles').where({ user_id: userId }).del();
        await trx('user_roles').insert(
          roleRows.map((r: { id: string }) => ({
            user_id: userId,
            role_id: r.id,
            granted_by: req.userId,
          })),
        );

        await trx('audit_events').insert({
          actor_id: req.userId,
          action: 'ROLE_CHANGED',
          resource_type: 'USER',
          resource_id: userId,
          details: JSON.stringify({ newRoles: uniqueRoles }),
          request_id: req.requestId,
        });
      });

      res.json({ data: { userId, roles: uniqueRoles }, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  '/users/:id/status',
  authorize('PLATFORM_ADMIN'),
  validateParams(UuidParamSchema),
  sensitiveActionLimiter,
  requireStepUp('ROLE_CHANGE', 'ALL'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getDb();
      const userId = getParam(req, 'id');
      if (userId === SYSTEM_USER_ID) {
        throw new ForbiddenError('System service account status cannot be modified');
      }
      if (userId === req.userId) {
        throw new ForbiddenError('Administrators cannot suspend or deactivate their own account');
      }
      const body = PatchUserStatusSchema.parse(req.body);

      const updated = await db.transaction(async (trx) => {
        const [user] = await trx('users')
          .where({ id: userId })
          .update({
            status: body.status,
            deactivated_at: body.status === 'DEACTIVATED' ? new Date() : null,
          })
          .returning(['id', 'email', 'status']);

        if (!user) throw new NotFoundError('User not found');

        if (body.status !== 'ACTIVE') {
          const now = new Date();
          await trx('sessions').where({ user_id: userId, is_active: true }).update({ is_active: false, revoked_at: now });
          await trx('refresh_tokens').where({ user_id: userId }).whereNull('revoked_at').update({ revoked_at: now });
        }

        await trx('audit_events').insert({
          actor_id: req.userId,
          action: 'ADMIN_ACTION',
          resource_type: 'USER',
          resource_id: userId,
          details: JSON.stringify({ newStatus: body.status, reason: body.reason }),
          request_id: req.requestId,
        });

        return user;
      });

      res.json({ data: updated, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/config', (_req: Request, res: Response) => {
  res.json({
    data: {
      environment: config.NODE_ENV,
      supportedCurrency: 'INR',
      monetaryRepresentation: 'INTEGER_MINOR_UNITS_PAISE',
      simulatedMode: true,
      riskTimeoutMs: 3000,
      riskTransferFallback: 'FAIL_OPEN',
      emailSandboxEnabled: process.env['EMAIL_SANDBOX_ENABLED'] !== 'false',
      smsSandboxEnabled: process.env['SMS_SANDBOX_ENABLED'] !== 'false',
      mfaMode: 'SIMULATED_EDUCATIONAL_ONLY',
    },
    meta: { requestId: _req.requestId },
  });
});

router.get('/outbox/failed', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { page, pageSize } = PaginationQuery.parse(req.query);
    const offset = (page - 1) * pageSize;

    const [events, countRows] = await Promise.all([
      db('outbox_events').where({ status: 'FAILED' }).orderBy('created_at', 'desc').offset(offset).limit(pageSize),
      db('outbox_events').where({ status: 'FAILED' }).count('id as count'),
    ]);

    res.json({
      data: events,
      meta: { requestId: req.requestId, page, pageSize, total: parseCount(countRows) },
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/outbox/:id/replay',
  validateParams(UuidParamSchema),
  sensitiveActionLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getParam(req, 'id');
    const replayed = await replayDeadLetterOutboxEvent(id);
    if (!replayed) {
      throw new NotFoundError('Failed outbox event not found');
    }
    await getDb()('audit_events').insert({
      actor_id: req.userId,
      action: 'ADMIN_ACTION',
      resource_type: 'OUTBOX_EVENT',
      resource_id: id,
      details: JSON.stringify({ action: 'REPLAY_DEAD_LETTER' }),
      request_id: req.requestId,
    });
    res.json({ data: { replayed: true, outboxEventId: id }, meta: { requestId: req.requestId } });
  } catch (err) {
    next(err);
  }
});

export const adminRoutes = router;
