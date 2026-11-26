import { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const headerId = req.headers['x-request-id'];
  const requestId = typeof headerId === 'string' && headerId.trim() ? headerId.trim() : randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  next();
}
