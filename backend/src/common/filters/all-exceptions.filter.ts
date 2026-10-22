import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import mongoose from 'mongoose';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  code?: string;
  details?: Record<string, string[]>;
  requestId?: string;
  timestamp: string;
  path: string;
}

/**
 * Centralised error handling with one response shape. Internal errors are
 * logged with their stack but never leak details to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected error occurred.';
    let details: Record<string, string[]> | undefined;
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object') {
        const r = response as { message?: string | string[]; details?: Record<string, string[]>; code?: string };
        message = Array.isArray(r.message) ? r.message.join('; ') : (r.message ?? exception.message);
        details = r.details;
        code = r.code;
      }
    } else if (isDuplicateKeyError(exception)) {
      status = HttpStatus.CONFLICT;
      message = 'A record with these details already exists.';
    } else if (exception instanceof mongoose.Error.CastError) {
      status = HttpStatus.BAD_REQUEST;
      message = `Invalid value for ${exception.path}.`;
    } else if (exception instanceof mongoose.Error.ValidationError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      message = 'Validation failed.';
      details = Object.fromEntries(Object.entries(exception.errors).map(([k, v]) => [k, [v.message]]));
    }

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId: req.id, path: req.path },
        exception instanceof Error ? exception.message : 'Unhandled exception',
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      message,
      ...(code ? { code } : {}),
      ...(details ? { details } : {}),
      requestId: req.id,
      timestamp: new Date().toISOString(),
      path: req.originalUrl?.split('?')[0] ?? req.url,
    };
    res.status(status).json(body);
  }
}

function isDuplicateKeyError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === 11000;
}
