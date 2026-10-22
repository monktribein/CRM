import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { Paginated } from '../pagination.js';

/**
 * Consistent success format:
 *   { data: T }                          — single resources
 *   { data: T[], meta: { total, ... } }  — paginated lists
 * Files (StreamableFile) and empty 204 responses pass through untouched.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body: unknown) => {
        if (body === undefined || body instanceof StreamableFile) return body;
        if (body instanceof Paginated) {
          return {
            data: body.items,
            meta: { total: body.total, page: body.page, pageSize: body.pageSize },
          };
        }
        return { data: body };
      }),
    );
  }
}
