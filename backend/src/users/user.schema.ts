import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { EMAIL_PATTERN } from '../database/validators.js';
import { JOB_FUNCTIONS, ROLES, type JobFunction, type Role } from '../roles/permissions.js';

export const ACCOUNT_STATUSES = ['invited', 'active', 'deactivated'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

@Schema({ _id: false })
export class NotificationPreferences {
  @Prop({ type: Boolean, default: true }) emailAssignments: boolean;
  @Prop({ type: Boolean, default: true }) emailDueReminders: boolean;
  @Prop({ type: Boolean, default: true }) emailReviews: boolean;
  @Prop({ type: Boolean, default: true }) inAppComments: boolean;
  @Prop({ type: Boolean, default: false }) dailyDigest: boolean;
}

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  /** Never reused, even after soft deletion. */
  @Prop({ type: String, required: true, trim: true, maxlength: 30 })
  employeeId: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 60 })
  firstName: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 60 })
  lastName: string;

  /** Normalised to lower case; unique per organisation among non-deleted users. */
  @Prop({ type: String, required: true, lowercase: true, trim: true, maxlength: 254, match: EMAIL_PATTERN })
  email: string;

  /** Argon2id hash. Never selected by default; null until the invitation is accepted. */
  @Prop({ type: String, select: false, default: null })
  passwordHash: string | null;

  /** What the user may do. Independent of job function. */
  @Prop({ type: String, enum: ROLES, required: true, default: 'employee' })
  securityRole: Role;

  /** What the user does. Independent of security role. */
  @Prop({ type: String, enum: JOB_FUNCTIONS, required: true, default: 'other' })
  jobFunction: JobFunction;

  @Prop({ type: String, trim: true, maxlength: 100, default: null })
  title: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Department', default: null })
  departmentId: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  managerId: Types.ObjectId | null;

  /** HTTPS URL of the profile image (stored externally). */
  @Prop({ type: String, default: null, maxlength: 2000, match: /^https:\/\// })
  avatar: string | null;

  @Prop({ type: String, enum: ACCOUNT_STATUSES, required: true, default: 'invited' })
  status: AccountStatus;

  /** When the most recent invitation was issued. */
  @Prop({ type: Date, default: null })
  invitedAt: Date | null;

  /** Employment start date. */
  @Prop({ type: Date, required: true })
  joinedAt: Date;

  @Prop({ type: Date, default: null })
  lastLoginAt: Date | null;

  /** Administrator who created the account (null for the bootstrap admin). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  /** Soft delete — keeps historical integrity of tasks and audit logs. */
  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ type: SchemaFactory.createForClass(NotificationPreferences), default: () => ({}) })
  notificationPreferences: NotificationPreferences;

  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

// Email is unique per organisation among live accounts; a soft-deleted
// account releases its email so the person can be re-invited.
UserSchema.index(
  { organizationId: 1, email: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: 'null' } }, name: 'uniq_org_email_live' },
);
UserSchema.index({ email: 1 }, { name: 'login_email' });
UserSchema.index({ organizationId: 1, employeeId: 1 }, { unique: true, name: 'uniq_org_employee_id' });
// Directory listing / filters and team lookups.
UserSchema.index({ organizationId: 1, departmentId: 1, status: 1 });
UserSchema.index({ organizationId: 1, securityRole: 1, status: 1 });
UserSchema.index({ organizationId: 1, managerId: 1 });

export const fullName = (u: Pick<User, 'firstName' | 'lastName'>) => `${u.firstName} ${u.lastName}`.trim();
