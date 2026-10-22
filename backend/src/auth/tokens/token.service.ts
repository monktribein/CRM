import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';
import type { EnvironmentVariables } from '../../config/env.js';
import { InvitationToken, PasswordResetToken, RefreshToken, type OneTimeTokenType } from './token.schemas.js';

export interface AccessTokenPayload {
  sub: string;
  org: string;
}

/**
 * Issues short-lived access JWTs and opaque, rotating refresh tokens.
 * Raw refresh / one-time tokens are only ever returned to the caller; the
 * database stores an HMAC-SHA256 so a database leak can't be replayed.
 */
@Injectable()
export class TokenService {
  private readonly pepper: string;
  private readonly accessTtl: number;
  private readonly refreshTtlMs: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<EnvironmentVariables, true>,
    @InjectModel(RefreshToken.name) private readonly refreshTokens: Model<RefreshToken>,
    @InjectModel(PasswordResetToken.name) private readonly resetTokens: Model<PasswordResetToken>,
    @InjectModel(InvitationToken.name) private readonly invitationTokens: Model<InvitationToken>,
  ) {
    this.pepper = config.get('JWT_REFRESH_SECRET', { infer: true });
    this.accessTtl = config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
    this.refreshTtlMs = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24 * 3600 * 1000;
  }

  get refreshTtlMilliseconds() {
    return this.refreshTtlMs;
  }

  hash(raw: string) {
    return createHmac('sha256', this.pepper).update(raw).digest('hex');
  }

  async signAccess(userId: string, organizationId: string) {
    const payload: AccessTokenPayload = { sub: userId, org: organizationId };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.accessTtl });
    return { accessToken, expiresAt: new Date(Date.now() + this.accessTtl * 1000).toISOString() };
  }

  async verifyAccess(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
  }

  async issueRefresh(userId: string | Types.ObjectId, family: string = randomUUID(), userAgent?: string) {
    const raw = randomBytes(48).toString('base64url');
    await this.refreshTokens.create({
      userId,
      family,
      tokenHash: this.hash(raw),
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
      userAgent: userAgent?.slice(0, 300) ?? null,
    });
    return raw;
  }

  /**
   * Rotates a refresh token. Presenting a token that was already rotated or
   * revoked is treated as theft: the whole family is revoked.
   */
  async rotate(raw: string, userAgent?: string): Promise<{ userId: string; refreshToken: string }> {
    const tokenHash = this.hash(raw);
    const now = new Date();
    // Atomically claim the token so two concurrent refreshes can't both succeed.
    const claimed = await this.refreshTokens.findOneAndUpdate(
      { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
      { revokedAt: now },
      { returnDocument: 'before' },
    );
    if (!claimed) {
      const existing = await this.refreshTokens.findOne({ tokenHash }).lean();
      if (existing?.revokedAt) await this.revokeFamily(existing.family);
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
    const refreshToken = await this.issueRefresh(claimed.userId, claimed.family, userAgent);
    await this.refreshTokens.updateOne({ _id: claimed._id }, { replacedByHash: this.hash(refreshToken) });
    return { userId: String(claimed.userId), refreshToken };
  }

  async revokeFamily(family: string) {
    await this.refreshTokens.updateMany({ family, revokedAt: null }, { revokedAt: new Date() });
  }

  async revokeByRaw(raw: string) {
    const token = await this.refreshTokens.findOne({ tokenHash: this.hash(raw) }).lean();
    if (token) await this.revokeFamily(token.family);
  }

  async revokeAllForUser(userId: string | Types.ObjectId) {
    await this.refreshTokens.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
  }

  private store(type: OneTimeTokenType): Model<PasswordResetToken | InvitationToken> {
    return (type === 'password_reset' ? this.resetTokens : this.invitationTokens) as Model<PasswordResetToken | InvitationToken>;
  }

  /** Creates a single-use token, invalidating earlier unused tokens of the same type. */
  async createOneTime(userId: string | Types.ObjectId, type: OneTimeTokenType, ttlMs: number) {
    const model = this.store(type);
    await model.updateMany({ userId, usedAt: null }, { usedAt: new Date() });
    const raw = randomBytes(32).toString('base64url');
    await model.create({ userId, tokenHash: this.hash(raw), expiresAt: new Date(Date.now() + ttlMs) });
    return raw;
  }

  /** Consumes a single-use token atomically; returns the user ID or null. */
  async consumeOneTime(raw: string, type: OneTimeTokenType): Promise<string | null> {
    const doc = await this.store(type).findOneAndUpdate(
      { tokenHash: this.hash(raw), usedAt: null, expiresAt: { $gt: new Date() } },
      { usedAt: new Date() },
    );
    return doc ? String(doc.userId) : null;
  }
}
