import { type Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      rawBody?: Buffer;
      userId?: string;
      userRoles?: string[];
      sessionId?: string;
    }
  }
}

export {};
