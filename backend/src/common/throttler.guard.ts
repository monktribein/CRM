import { Inject, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { TokenService } from '../auth/tokens/token.service.js';

/**
 * Rate-limit buckets that work behind shared office IPs (NAT):
 *   • authenticated requests → per user (only for a *verified* access token,
 *     so forged tokens can neither escape the IP limit nor drain someone else's quota)
 *   • login / forgot-password → per IP + email (brute force on one account)
 *   • everything else → per client IP
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  @Inject(TokenService) private readonly tokens!: TokenService;

  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const ip: string = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const path: string = req.path ?? req.url ?? '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : null;
    if (email && /\/auth\/(login|forgot-password)$/.test(path)) return `ip:${ip}:email:${email}`;

    const [scheme, token] = String(req.headers?.authorization ?? '').split(' ');
    if (scheme === 'Bearer' && token) {
      try {
        const payload = await this.tokens.verifyAccess(token);
        if (payload?.sub) return `user:${payload.sub}`;
      } catch {
        /* invalid or expired token: fall back to the IP bucket */
      }
    }
    return `ip:${ip}`;
  }
}
