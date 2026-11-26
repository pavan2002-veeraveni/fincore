// ---------------------------------------------------------------------------
// FinCore API – Shared Error Classes
// ---------------------------------------------------------------------------

/**
 * Base application error.
 *
 * Every domain / infrastructure error should extend this class so the error
 * middleware can map it to a consistent HTTP response envelope.
 */
export class AppError extends Error {
  /** Machine-readable error code, e.g. `NOT_FOUND`, `VALIDATION_ERROR`. */
  public readonly code: string;

  /** HTTP status code to return to the client. */
  public readonly statusCode: number;

  /** Optional structured details (field errors, context, etc.). */
  public readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    statusCode: number,
    details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // Maintains proper prototype chain in TS when extending builtins.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// 4xx errors
// ---------------------------------------------------------------------------

/** 400 – Generic validation error. */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

/** 401 – Missing or invalid authentication credentials. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
  }
}

/** 403 – Authenticated but not allowed. */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, 403);
  }
}

/** 404 – Resource not found. */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message, 404);
  }
}

/** 409 – Generic conflict (duplicate resource, concurrent mutation, etc.). */
export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super('CONFLICT', message, 409, details);
  }
}

/** 409 – A request with the same idempotency key was already processed. */
export class IdempotencyConflictError extends AppError {
  constructor(message = 'Idempotency key has already been used') {
    super('IDEMPOTENCY_KEY_REUSED', message, 409);
  }
}

/** 422 – Business-rule violation: insufficient funds for the operation. */
export class InsufficientFundsError extends AppError {
  constructor(message = 'Insufficient funds', details?: unknown) {
    super('INSUFFICIENT_FUNDS', message, 422, details);
  }
}

/** 429 – Too many requests. */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please try again later') {
    super('RATE_LIMIT_EXCEEDED', message, 429);
  }
}

// ---------------------------------------------------------------------------
// 5xx errors
// ---------------------------------------------------------------------------

/** 500 – Catch-all internal / unexpected error. */
export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super('INTERNAL_ERROR', message, 500);
  }
}
