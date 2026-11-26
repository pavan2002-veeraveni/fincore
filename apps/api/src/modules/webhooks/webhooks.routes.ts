import { Router } from 'express';
import { webhooksController } from './webhooks.controller.js';
import { webhookLimiter } from '../../middleware/rate-limit.middleware.js';

const router = Router();
router.post('/:provider', webhookLimiter, webhooksController.handleWebhook);

export const webhooksRoutes = router;
