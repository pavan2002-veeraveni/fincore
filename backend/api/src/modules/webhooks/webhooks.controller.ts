import { type Request, type Response, type NextFunction } from 'express';
import { webhooksService } from './webhooks.service.js';
import { getParam } from '../../shared/utils/http.js';

export const webhooksController = {
  async handleWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const provider = getParam(req, 'provider');
      const sigHeader = req.headers['x-webhook-signature'];
      const signature = Array.isArray(sigHeader) ? (sigHeader[0] ?? '') : (sigHeader ?? '');
      const rawBody = req.rawBody;

      if (!rawBody) {
        return res.status(400).json({
          error: {
            code: 'MISSING_RAW_BODY',
            message: 'Raw body required for webhook verification',
            requestId: req.requestId,
          },
        });
      }

      const result = await webhooksService.processWebhook(provider, rawBody, signature);
      res.json({ data: result, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },
};
