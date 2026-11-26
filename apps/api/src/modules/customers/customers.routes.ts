import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { PaginationQuery } from '@fincore/contracts';
import { getDb } from '../../infrastructure/database/connection.js';
import { authorize } from '../../middleware/authorize.middleware.js';
import { validateParams, UuidParamSchema } from '../../middleware/validate.middleware.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { getParam, parseCount } from '../../shared/utils/http.js';

const router = Router();

const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  phoneNumber: z.string().max(20).regex(/^\+?[0-9\s\-()]+$/).optional(),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
});

router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const user = await db('users')
      .where({ id: req.userId })
      .select('id', 'email', 'first_name', 'last_name', 'phone_number', 'status', 'created_at')
      .first();
    if (!user) throw new NotFoundError('User not found');

    const profile = await db('customer_profiles').where({ user_id: req.userId }).first();
    const roles = await db('user_roles')
      .join('roles', 'user_roles.role_id', 'roles.id')
      .where({ user_id: req.userId })
      .pluck<string[]>('roles.name');

    res.json({ data: { ...user, profile, roles }, meta: { requestId: req.requestId } });
  } catch (err) {
    next(err);
  }
});

router.patch('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const data = UpdateProfileSchema.parse(req.body);

    const updated = await db.transaction(async (trx) => {
      const profile = await trx('customer_profiles').where({ user_id: req.userId }).first();
      if (!profile) throw new NotFoundError('Profile not found');

      if (data.phoneNumber !== undefined) {
        await trx('users').where({ id: req.userId }).update({ phone_number: data.phoneNumber });
      }

      const profileUpdate: Record<string, unknown> = {};
      if (data.displayName !== undefined) profileUpdate['display_name'] = data.displayName;
      if (data.addressLine1 !== undefined) profileUpdate['address_line1'] = data.addressLine1;
      if (data.addressLine2 !== undefined) profileUpdate['address_line2'] = data.addressLine2;
      if (data.city !== undefined) profileUpdate['city'] = data.city;
      if (data.state !== undefined) profileUpdate['state'] = data.state;
      if (data.postalCode !== undefined) profileUpdate['postal_code'] = data.postalCode;

      const updatedProfile =
        Object.keys(profileUpdate).length > 0
          ? (await trx('customer_profiles').where({ id: profile.id }).update(profileUpdate).returning('*'))[0]
          : profile;

      await trx('audit_events').insert({
        actor_id: req.userId,
        action: 'PROFILE_UPDATED',
        resource_type: 'CUSTOMER_PROFILE',
        resource_id: profile.id,
        request_id: req.requestId,
      });

      return updatedProfile;
    });

    res.json({ data: updated, meta: { requestId: req.requestId } });
  } catch (err) {
    next(err);
  }
});

// Operations/Support customer directory (safe non-sensitive fields only)
router.get(
  '/',
  authorize('SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getDb();
      const { page, pageSize } = PaginationQuery.parse(req.query);
      const offset = (page - 1) * pageSize;

      const [customers, countRows] = await Promise.all([
        db('customer_profiles as cp')
          .join('users as u', 'cp.user_id', 'u.id')
          .whereNot({ 'u.email': 'system@fincore.internal' })
          .select(
            'cp.id as customer_id',
            'u.id as user_id',
            'u.email',
            'u.first_name',
            'u.last_name',
            'cp.display_name',
            'cp.identity_status',
            'u.status as account_status',
            'cp.created_at',
          )
          .orderBy('cp.created_at', 'desc')
          .offset(offset)
          .limit(pageSize),
        db('customer_profiles as cp')
          .join('users as u', 'cp.user_id', 'u.id')
          .whereNot({ 'u.email': 'system@fincore.internal' })
          .count('cp.id as count'),
      ]);

      res.json({
        data: customers,
        meta: { requestId: req.requestId, page, pageSize, total: parseCount(countRows) },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:id',
  authorize('SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'),
  validateParams(UuidParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getDb();
      const customerId = getParam(req, 'id');
      const customer = await db('customer_profiles as cp')
        .join('users as u', 'cp.user_id', 'u.id')
        .where({ 'cp.id': customerId })
        .whereNot({ 'u.email': 'system@fincore.internal' })
        .select(
          'cp.id as customer_id',
          'u.id as user_id',
          'u.email',
          'u.first_name',
          'u.last_name',
          'cp.display_name',
          'cp.identity_status',
          'u.status as account_status',
          'cp.created_at',
        )
        .first();
      if (!customer) throw new NotFoundError('Customer profile not found');
      res.json({ data: customer, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },
);

export const customersRoutes = router;
