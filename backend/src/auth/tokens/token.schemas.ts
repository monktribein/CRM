import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

/**
 * Refresh tokens are opaque random values; only an HMAC of the token is
 * stored. Tokens are grouped in a rotation 'family' so reuse of an already
 * rotated token revokes the whole chain.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'refreshTokens' })
export class RefreshToken {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, match: /^[a-f0-9]{64}$/ })
  tokenHash: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  revokedAt: Date | null;

  @Prop({ type: String, required: true })
  family: string;

  @Prop({ type: String, default: null })
  replacedByHash: string | null;

  @Prop({ type: String, default: null, maxlength: 300 })
  userAgent: string | null;

  createdAt: Date;
}
export type RefreshTokenDocument = HydratedDocument<RefreshToken>;
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
RefreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
RefreshTokenSchema.index({ userId: 1, revokedAt: 1 });
RefreshTokenSchema.index({ family: 1 });
// MongoDB removes expired tokens automatically.
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expires_at' });

/** Single-use, hashed, expiring token for password resets. */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'passwordResetTokens' })
export class PasswordResetToken {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, match: /^[a-f0-9]{64}$/ })
  tokenHash: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  /** Set when consumed; a used token can never be consumed again. */
  @Prop({ type: Date, default: null })
  usedAt: Date | null;

  createdAt: Date;
}

/** Single-use, hashed, expiring token for account invitations. */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'invitationTokens' })
export class InvitationToken {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, match: /^[a-f0-9]{64}$/ })
  tokenHash: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  /** Set when consumed; a used token can never be consumed again. */
  @Prop({ type: Date, default: null })
  usedAt: Date | null;

  createdAt: Date;
}

function singleUseSchema<T>(cls: new () => T) {
  const schema = SchemaFactory.createForClass(cls);
  schema.index({ tokenHash: 1 }, { unique: true });
  schema.index({ userId: 1, usedAt: 1 });
  schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expires_at' });
  return schema;
}

export const PasswordResetTokenSchema = singleUseSchema(PasswordResetToken);
export const InvitationTokenSchema = singleUseSchema(InvitationToken);

export type OneTimeTokenType = 'invitation' | 'password_reset';
