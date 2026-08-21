/**
 * Typed application errors — every failure mode on the backend core is a
 * member of this union (plan §3: "errors are typed unions"). API routes map
 * these to structured JSON responses; nothing throws a bare string.
 */

export type AppErrorCode =
  | 'INVALID_SIGNATURE'
  | 'STALE_TIMESTAMP'
  | 'MALFORMED_PAYLOAD'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'UNSUPPORTED_EVENT_TYPE'
  | 'DUPLICATE_EVENT'
  | 'CONFIG_MISSING'
  | 'SCORING_UNAVAILABLE'
  | 'SCORING_INVALID_RESPONSE'
  | 'STREAM_NOT_FOUND'
  | 'INTERNAL';

const HTTP_STATUS: Record<AppErrorCode, number> = {
  INVALID_SIGNATURE: 400,
  STALE_TIMESTAMP: 400,
  MALFORMED_PAYLOAD: 400,
  SCHEMA_VALIDATION_FAILED: 422,
  UNSUPPORTED_EVENT_TYPE: 422,
  DUPLICATE_EVENT: 409,
  CONFIG_MISSING: 503,
  SCORING_UNAVAILABLE: 503,
  SCORING_INVALID_RESPONSE: 502,
  STREAM_NOT_FOUND: 404,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly httpStatus: number;

  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.httpStatus = HTTP_STATUS[code];
  }
}

/** Structured error body emitted by every API route. */
export interface ErrorBody {
  error: { code: AppErrorCode; message: string; details?: unknown };
}

export function toErrorBody(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof AppError) {
    return {
      status: err.httpStatus,
      body: { error: { code: err.code, message: err.message, details: err.details } },
    };
  }
  return {
    status: HTTP_STATUS.INTERNAL,
    body: { error: { code: 'INTERNAL', message: 'unexpected internal error' } },
  };
}

/** Wraps a route handler so every thrown error becomes a typed JSON response. */
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      const { status, body } = toErrorBody(err);
      return Response.json(body, { status });
    }
  };
}
