/**
 * Unified error hierarchy for ThinkTS.
 *
 * Every framework-level error carries:
 * - errno    → business error code (exposed to client)
 * - status   → HTTP status code
 * - traceId  → request correlation id
 * - data     → optional extra payload
 * - cause    → original Error (development only)
 */

export class ThinkError extends Error {
  errno: number;
  status: number;
  traceId: string;
  data?: unknown;
  cause?: Error;

  constructor(
    message: string,
    opts?: {
      errno?: number;
      status?: number;
      traceId?: string;
      data?: unknown;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = this.constructor.name;
    this.errno = opts?.errno ?? 500;
    this.status = opts?.status ?? 500;
    this.traceId = opts?.traceId ?? generateTraceId();
    this.data = opts?.data;
    this.cause = opts?.cause;
  }
}

export class ValidationError extends ThinkError {
  constructor(message: string, opts?: { field?: string; traceId?: string }) {
    super(message, { errno: 422, status: 422, traceId: opts?.traceId });
    this.data = opts?.field ? { field: opts.field } : undefined;
  }
}

export class AuthError extends ThinkError {
  constructor(message = "Unauthorized", opts?: { traceId?: string; status?: number }) {
    super(message, { errno: opts?.status ?? 401, status: opts?.status ?? 401, traceId: opts?.traceId });
  }
}

export class ForbiddenError extends ThinkError {
  constructor(message = "Forbidden", opts?: { traceId?: string }) {
    super(message, { errno: 403, status: 403, traceId: opts?.traceId });
  }
}

export class NotFoundError extends ThinkError {
  constructor(message = "Not Found", opts?: { traceId?: string }) {
    super(message, { errno: 404, status: 404, traceId: opts?.traceId });
  }
}

export class AclError extends ThinkError {
  constructor(message = "Access denied", opts?: { traceId?: string }) {
    super(message, { errno: 403, status: 403, traceId: opts?.traceId });
  }
}

export class DbError extends ThinkError {
  constructor(message: string, opts?: { traceId?: string; cause?: Error }) {
    super(message, { errno: 500, status: 500, traceId: opts?.traceId, cause: opts?.cause });
  }
}

export class RateLimitError extends ThinkError {
  constructor(message = "Too many requests", opts?: { traceId?: string; retryAfter?: number }) {
    super(message, { errno: 429, status: 429, traceId: opts?.traceId });
    this.data = opts?.retryAfter ? { retryAfter: opts.retryAfter } : undefined;
  }
}

/** Fast trace-id: base36 timestamp + 6-char random suffix. No crypto needed. */
export function generateTraceId(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${now}-${rand}`;
}
function isThinkErrorLike(err: unknown): err is ThinkError {
  if (err instanceof ThinkError) return true;
  if (!err || typeof err !== "object") return false;
  const maybe = err as Partial<ThinkError>;
  return typeof maybe.message === "string"
    && typeof maybe.errno === "number"
    && typeof maybe.status === "number";
}

/** Convert any thrown value into a ThinkError, preserving traceId. */
export function toThinkError(err: unknown, traceId?: string): ThinkError {
  if (isThinkErrorLike(err)) {
    const thinkErr = err as ThinkError;
    if (traceId && !thinkErr.traceId) thinkErr.traceId = traceId;
    return thinkErr;
  }
  if (err instanceof Error) {
    return new ThinkError(err.message, { errno: 500, status: 500, traceId, cause: err });
  }
  return new ThinkError(String(err), { errno: 500, status: 500, traceId });
}
