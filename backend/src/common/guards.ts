import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import type { Request } from 'express';
import { isValidObjectId, Model } from 'mongoose';
import { TokenService } from '../auth/tokens/token.service.js';
import { permissionsFor, type Permission } from '../roles/permissions.js';
import { fullName, User } from '../users/user.schema.js';
import type { AuthUser } from './auth-user.js';
import { IS_PUBLIC, PERMISSIONS_KEY } from './decorators.js';

/**
 * Global authentication guard. The JWT only identifies the user; role,
 * department and status are re-read from the database on every request so
 * deactivation or a role change takes effect immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Authentication required.');

    const payload = await this.tokens.verifyAccess(token);
    if (!isValidObjectId(payload.sub) || !isValidObjectId(payload.org)) {
      throw new UnauthorizedException('Invalid access token.');
    }
    const user = await this.users
      .findOne({ _id: payload.sub, organizationId: payload.org, status: 'active', deletedAt: null })
      .select('firstName lastName email securityRole departmentId organizationId')
      .lean();
    if (!user) throw new UnauthorizedException('Account is not active.');

    req.user = {
      id: String(user._id),
      organizationId: String(user.organizationId),
      role: user.securityRole,
      departmentId: user.departmentId ? String(user.departmentId) : null,
      name: fullName(user),
      email: user.email,
      permissions: permissionsFor(user.securityRole),
    };
    return true;
  }
}

/** Enforces @RequirePermissions(...) — the user needs at least one. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;
    const user = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (!user || !required.some((p) => user.permissions.includes(p))) {
      throw new ForbiddenException("You don't have permission to perform this action.");
    }
    return true;
  }
}
