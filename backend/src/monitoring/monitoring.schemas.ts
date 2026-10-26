import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const SESSION_STATUSES = ['active', 'ended', 'expired'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Why a session stopped. "heartbeat_timeout" is set server-side (browser closed, sleep, network loss). */
export const SESSION_END_REASONS = [
  'logout',
  'user_stopped',
  'stream_ended',
  'page_closed',
  'session_expired',
  'heartbeat_timeout',
  'superseded',
  'monitoring_disabled',
] as const;
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

@Schema({ _id: false })
export class ClientQueueReport {
  @Prop({ type: Number, required: true, min: 0 }) pending: number;
  @Prop({ type: Date, default: null }) oldestCapturedAt: Date | null;
  @Prop({ type: Date, required: true }) reportedAt: Date;
}

/**
 * One screen-sharing grant. A new session (and a fresh browser permission
 * prompt) is required after every sign-in, reload or interruption.
 */
@Schema({ timestamps: true, collection: 'monitoringSessions' })
export class MonitoringSession {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true, immutable: true })
  organizationId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, immutable: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: SESSION_STATUSES, required: true, default: 'active' })
  status: SessionStatus;

  /** Policy version the employee had consented to when the session started. */
  @Prop({ type: String, required: true, immutable: true })
  policyVersion: string;

  @Prop({ type: Date, required: true, immutable: true })
  startedAt: Date;

  @Prop({ type: Date, required: true })
  lastHeartbeatAt: Date;

  @Prop({ type: Date, default: null })
  endedAt: Date | null;

  @Prop({ type: String, enum: SESSION_END_REASONS, default: null })
  endReason: SessionEndReason | null;

  /** What the employee chose to share, as reported by the browser ("monitor", "window"…). */
  @Prop({ type: String, default: null, maxlength: 20 })
  displaySurface: string | null;

  @Prop({ type: String, default: null, maxlength: 300 })
  userAgent: string | null;

  /** The employee's sign-in time (users.lastLoginAt) when the session started. */
  @Prop({ type: Date, default: null, immutable: true })
  loginAt: Date | null;

  @Prop({ type: Number, default: 0 })
  captureCount: number;

  @Prop({ type: Date, default: null })
  lastCaptureAt: Date | null;

  /** When the most recent screenshot of this session was confirmed in storage. */
  @Prop({ type: Date, default: null })
  lastUploadAt: Date | null;

  /** Screenshots waiting in the browser's queue, as last reported by the heartbeat. */
  @Prop({ type: SchemaFactory.createForClass(ClientQueueReport), default: null })
  clientQueue: ClientQueueReport | null;

  createdAt: Date;
  updatedAt: Date;
}

export type MonitoringSessionDocument = HydratedDocument<MonitoringSession>;
export const MonitoringSessionSchema = SchemaFactory.createForClass(MonitoringSession);
MonitoringSessionSchema.index({ organizationId: 1, userId: 1, startedAt: -1 }, { name: 'user_sessions' });
// At most one active session per employee; starting another supersedes it.
MonitoringSessionSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' }, name: 'uniq_active_session' },
);
MonitoringSessionSchema.index({ status: 1, lastHeartbeatAt: 1 }, { name: 'heartbeat_expiry' });
// Super Admin login-activity table: org-wide, newest first, filterable by status.
MonitoringSessionSchema.index({ organizationId: 1, startedAt: -1 }, { name: 'org_sessions' });
MonitoringSessionSchema.index({ organizationId: 1, status: 1, startedAt: -1 }, { name: 'org_sessions_status' });

export const UPLOAD_STATUSES = ['pending', 'uploading', 'uploaded', 'failed', 'deleted'] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

/**
 * Screenshot metadata and upload state. The image itself lives only in
 * MongoDB GridFS (and, until confirmed, in the employee's encrypted browser
 * queue); this record doubles as the server-side upload ledger.
 */
@Schema({ timestamps: true, collection: 'screenshots' })
export class Screenshot {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true, immutable: true })
  organizationId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, immutable: true })
  userId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'MonitoringSession', required: true, immutable: true })
  sessionId: Types.ObjectId;

  /** Client-generated UUID; makes retried uploads idempotent. */
  @Prop({ type: String, required: true, immutable: true, maxlength: 64 })
  captureId: string;

  @Prop({ type: Date, required: true, immutable: true })
  capturedAt: Date;

  @Prop({ type: String, enum: UPLOAD_STATUSES, required: true, default: 'pending' })
  status: UploadStatus;

  @Prop({ type: Number, default: 0 })
  attempts: number;

  @Prop({ type: String, default: null, maxlength: 500 })
  lastError: string | null;

  /** When the current upload attempt was claimed (stale claims can be retried). */
  @Prop({ type: Date, default: null })
  claimedAt: Date | null;

  @Prop({ type: String, default: null })
  fileId: string | null;

  @Prop({ type: String, default: null, maxlength: 200 })
  fileName: string | null;

  @Prop({ type: String, default: null, maxlength: 40 })
  mimeType: string | null;

  @Prop({ type: Number, default: null })
  sizeBytes: number | null;

  @Prop({ type: String, default: null, maxlength: 64 })
  sha256: string | null;

  /** Pixel dimensions, read from the image header on the server. */
  @Prop({ type: Number, default: null })
  width: number | null;

  @Prop({ type: Number, default: null })
  height: number | null;

  /** Set when the stored file was found missing (removed outside the CRM). */
  @Prop({ type: Date, default: null })
  fileMissingAt: Date | null;

  @Prop({ type: Date, default: null })
  uploadedAt: Date | null;

  /** Retention deadline; the purge job deletes the stored file after this. */
  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type ScreenshotDocument = HydratedDocument<Screenshot>;
export const ScreenshotSchema = SchemaFactory.createForClass(Screenshot);
ScreenshotSchema.index({ organizationId: 1, captureId: 1 }, { unique: true, name: 'uniq_org_capture' });
ScreenshotSchema.index({ organizationId: 1, userId: 1, capturedAt: -1 }, { name: 'user_history' });
ScreenshotSchema.index({ sessionId: 1, capturedAt: 1 }, { name: 'session_history' });
ScreenshotSchema.index({ status: 1, expiresAt: 1 }, { name: 'retention' });
ScreenshotSchema.index({ organizationId: 1, capturedAt: -1 }, { name: 'org_gallery' });
ScreenshotSchema.index({ organizationId: 1, status: 1, updatedAt: -1 }, { name: 'org_upload_status' });

export const ACCESS_ACTIONS = ['previewed', 'downloaded', 'deleted', 'retention_purged'] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

/** Append-only record of who viewed, downloaded or deleted a screenshot. */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'screenshotAccessLogs', versionKey: false })
export class ScreenshotAccessLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true, immutable: true })
  organizationId: Types.ObjectId;

  /** Null for system actions (retention purge). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null, immutable: true })
  actorId: Types.ObjectId | null;

  @Prop({ type: String, required: true, immutable: true })
  actorName: string;

  @Prop({ type: String, default: null, immutable: true })
  actorRole: string | null;

  @Prop({ type: String, enum: ACCESS_ACTIONS, required: true, immutable: true })
  action: AccessAction;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Screenshot', required: true, immutable: true })
  screenshotId: Types.ObjectId;

  /** The monitored employee. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, immutable: true })
  employeeUserId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'MonitoringSession', required: true, immutable: true })
  sessionId: Types.ObjectId;

  @Prop({ type: Date, required: true, immutable: true })
  capturedAt: Date;

  @Prop({ type: String, default: null, immutable: true, maxlength: 64 })
  ip: string | null;

  @Prop({ type: String, default: null, immutable: true, maxlength: 300 })
  userAgent: string | null;

  createdAt: Date;
}

export const ScreenshotAccessLogSchema = SchemaFactory.createForClass(ScreenshotAccessLog);
ScreenshotAccessLogSchema.index({ organizationId: 1, createdAt: -1 }, { name: 'org_recent' });
ScreenshotAccessLogSchema.index({ organizationId: 1, employeeUserId: 1, createdAt: -1 }, { name: 'employee_access' });
ScreenshotAccessLogSchema.index({ organizationId: 1, actorId: 1, createdAt: -1 }, { name: 'actor_access' });
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  ScreenshotAccessLogSchema.pre(op, () => {
    throw new Error('Screenshot access logs are append-only');
  });
}

/** Status as shown to administrators; never invents a logout that wasn't recorded. */
export type DisplayStatus = 'active' | 'ended' | 'expired' | 'interrupted';

export function displayStatus(s: Pick<MonitoringSession, 'status' | 'endReason'>): DisplayStatus {
  if (s.status === 'active') return 'active';
  if (s.status === 'expired') return 'expired';
  return s.endReason === 'logout' || s.endReason === 'user_stopped' ? 'ended' : 'interrupted';
}

export const CONSENT_DECISIONS = ['granted', 'declined'] as const;
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number];

/** Append-only record of every consent decision, per policy version. */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'monitoringConsents', versionKey: false })
export class MonitoringConsent {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true, immutable: true })
  organizationId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, immutable: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, immutable: true })
  policyVersion: string;

  @Prop({ type: String, enum: CONSENT_DECISIONS, required: true, immutable: true })
  decision: ConsentDecision;

  @Prop({ type: String, default: null, immutable: true, maxlength: 300 })
  userAgent: string | null;

  createdAt: Date;
}

export const MonitoringConsentSchema = SchemaFactory.createForClass(MonitoringConsent);
MonitoringConsentSchema.index({ organizationId: 1, userId: 1, createdAt: -1 }, { name: 'user_consents' });
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'] as const) {
  MonitoringConsentSchema.pre(op, () => {
    throw new Error('Consent records are append-only');
  });
}
