import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The current request's ID (null outside an HTTP request, e.g. scripts or cron). */
export function currentRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}

/**
 * Assigns every request an ID (honouring a well-formed X-Request-Id) and makes
 * it available to services — e.g. to stamp audit log entries — and to the
 * HTTP logger, which reuses the same header.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);
  storage.run({ requestId }, next);
}
