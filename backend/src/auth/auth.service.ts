import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Organization } from '../settings/organization.schema.js';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { allowedOrigins, type EnvironmentVariables } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import { fullName, User } from '../users/user.schema.js';
import { UsersService } from '../users/users.service.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password.js';
import { TokenService } from './tokens/token.service.js';

const RESET_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly frontendUrl: string;

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Organization.name) private readonly orgs: Model<Organization>,
    private readonly tokens: TokenService,
    private readonly usersService: UsersService,
    private readonly activity: ActivityLogsService,
    private readonly mail: MailService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.frontendUrl = allowedOrigins({ FRONTEND_URL: config.get('FRONTEND_URL', { infer: true }) })[0]!;
  }

  private async session(userId: string, organizationId: string, refreshToken: string) {
    const access = await this.tokens.signAccess(userId, organizationId);
    return { ...access, refreshToken, user: await this.usersService.toCurrentUser(userId) };
  }

  /**
   * Emails are unique per organisation, so the same address may exist in
   * several organisations; the caller then has to name one (slug).
   */
  private async accountsFor(email: string, organization?: string) {
    const filter: Record<string, unknown> = { email, deletedAt: null };
    if (organization) {
      const org = await this.orgs.findOne({ slug: organization.toLowerCase() }).select('_id').lean();
      if (!org) return [];
      filter.organizationId = org._id;
    }
    return this.users.find(filter).select('+passwordHash').limit(10).lean();
  }

  async login(email: string, password: string, userAgent?: string, organization?: string) {
    const accounts = await this.accountsFor(email, organization);
    if (accounts.length > 1) {
      throw new ConflictException({
        message: 'This email belongs to more than one organisation. Specify the organisation to sign in to.',
        code: 'organization_required',
      });
    }
    const user = accounts[0];
    if (!user) {
      await burnPasswordCheck(password);
      throw new UnauthorizedException('Incorrect email or password.');
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw new UnauthorizedException('Incorrect email or password.');
    }
    if (user.status === 'invited') {
      throw new ForbiddenException("This account hasn't been activated yet. Use the link in your invitation.");
    }
    if (user.status !== 'active') {
      throw new ForbiddenException('This account is deactivated. Contact your administrator.');
    }
    await this.users.updateOne({ _id: user._id }, { lastLoginAt: new Date() });
    const actor = { id: String(user._id), organizationId: String(user.organizationId), name: fullName(user) };
    await this.activity.record({ actor, action: 'auth.login', entityType: 'auth', description: 'signed in' });
    const refresh = await this.tokens.issueRefresh(user._id, undefined, userAgent);
    return this.session(actor.id, actor.organizationId, refresh);
  }

  async refresh(rawRefresh: string | undefined, userAgent?: string) {
    if (!rawRefresh) throw new UnauthorizedException('No refresh token.');
    const { userId, refreshToken } = await this.tokens.rotate(rawRefresh, userAgent);
    const user = await this.users.findOne({ _id: userId, status: 'active', deletedAt: null }).lean();
    if (!user) {
      await this.tokens.revokeAllForUser(userId);
      throw new UnauthorizedException('Account is not active.');
    }
    return this.session(userId, String(user.organizationId), refreshToken);
  }

  async logout(rawRefresh: string | undefined) {
    if (rawRefresh) await this.tokens.revokeByRaw(rawRefresh);
  }

  /** Always succeeds from the caller's point of view to avoid account enumeration. */
  async forgotPassword(email: string) {
    // One reset link per organisation account using this email.
    const accounts = await this.users.find({ email, status: 'active', deletedAt: null }).limit(10).lean();
    for (const user of accounts) await this.sendReset(user);
  }

  private async sendReset(user: Pick<User, 'email' | 'firstName'> & { _id: Types.ObjectId }) {
    const token = await this.tokens.createOneTime(user._id, 'password_reset', RESET_TTL_MS);
    const link = `${this.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const sent = await this.mail.send(
      'password_reset',
      user.email,
      'Reset your Bizwoke Nova password',
      `Hi ${user.firstName},\n\nUse this link within 30 minutes to reset your password:\n${link}\n\nIf you didn't request this, you can ignore this email.`,
    );
    if (!sent) this.logger.warn('Password reset requested but email delivery is not configured or failed');
  }

  async resetPassword(token: string, password: string) {
    const userId = await this.tokens.consumeOneTime(token, 'password_reset');
    if (!userId) throw new BadRequestException('This reset link is invalid or has expired. Request a new one.');
    const user = await this.users.findOneAndUpdate(
      { _id: userId, status: 'active', deletedAt: null },
      { passwordHash: await hashPassword(password) },
    );
    if (!user) throw new BadRequestException('This reset link is invalid or has expired. Request a new one.');
    await this.tokens.revokeAllForUser(userId);
    await this.activity.record({
      actor: { id: userId, organizationId: String(user.organizationId), name: fullName(user) },
      action: 'auth.password_reset',
      entityType: 'auth',
      description: 'reset their password',
    });
  }

  async acceptInvitation(token: string, password: string) {
    const userId = await this.tokens.consumeOneTime(token, 'invitation');
    if (!userId) {
      throw new BadRequestException('This invitation link is invalid or has expired. Ask your administrator for a new one.');
    }
    const user = await this.users.findOneAndUpdate(
      { _id: userId, status: 'invited', deletedAt: null },
      { passwordHash: await hashPassword(password), status: 'active' },
    );
    if (!user) throw new BadRequestException('This invitation has already been used.');
    await this.activity.record({
      actor: { id: userId, organizationId: String(user.organizationId), name: fullName(user) },
      action: 'auth.invitation_accepted',
      entityType: 'auth',
      description: 'activated their account',
    });
  }

  /** Changes the password, revokes every other session and starts a fresh one. */
  async changePassword(actor: AuthUser, current: string, next: string, userAgent?: string) {
    const user = await this.users.findById(actor.id).select('+passwordHash').lean();
    if (!user || !(await verifyPassword(user.passwordHash, current))) {
      throw new UnprocessableEntityException({ message: 'Current password is incorrect.', details: { currentPassword: ['Current password is incorrect.'] } });
    }
    await this.users.updateOne({ _id: user._id }, { passwordHash: await hashPassword(next) });
    await this.tokens.revokeAllForUser(user._id);
    await this.activity.record({ actor, action: 'auth.password_changed', entityType: 'auth', description: 'changed their password' });
    return this.tokens.issueRefresh(user._id, undefined, userAgent);
  }
}
