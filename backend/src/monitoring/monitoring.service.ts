import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';
import { can, type AuthUser } from '../common/auth-user.js';
import { escapeRegex, Paginated, skipFor } from '../common/pagination.js';
import { oid, ScopeService } from '../core/scope.service.js';
import { MonitoringPolicy, Organization } from '../settings/organization.schema.js';
import { EmployeeMonitoring, fullName, User } from '../users/user.schema.js';
import type {
  ConsentDto,
  EmployeeMonitoringQueryDto,
  EndSessionDto,
  HeartbeatDto,
  ScreenshotQueryDto,
  StartSessionDto,
  UpdatePolicyDto,
  UploadScreenshotDto,
} from './dto.js';
import { AccessLogService, type AccessContext } from './access-log.service.js';
import { ScreenshotStorageService, StorageError } from './screenshot-storage.service.js';
import { imageDimensions } from './image-info.js';
import { displayStatus, MonitoringConsent, MonitoringSession, Screenshot, type SessionEndReason } from './monitoring.schemas.js';

/** Fixed by policy: one screenshot every five minutes. */
export const CAPTURE_INTERVAL_SECONDS = 5 * 60;
export const HEARTBEAT_INTERVAL_SECONDS = 60;
/** A session with no heartbeat for this long is treated as interrupted (closed, asleep, offline). */
export const HEARTBEAT_TIMEOUT_MS = 3 * 60_000;
/** An upload claim older than this is assumed abandoned and may be retried. */
const STALE_CLAIM_MS = 2 * 60_000;
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', magic: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
};

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

type LeanSession = MonitoringSession & { _id: Types.ObjectId };
type LeanShot = Screenshot & { _id: Types.ObjectId };

const policyOf = (org: { monitoring?: Partial<MonitoringPolicy> } | null): MonitoringPolicy => ({
  enabled: org?.monitoring?.enabled ?? false,
  policyVersion: org?.monitoring?.policyVersion ?? '1',
  policyText: org?.monitoring?.policyText ?? '',
  retentionDays: org?.monitoring?.retentionDays ?? 20,
  localRetentionHours: org?.monitoring?.localRetentionHours ?? 72,
});

const enrolmentOf = (u: { monitoring?: Partial<EmployeeMonitoring> } | null): EmployeeMonitoring => ({
  enabled: u?.monitoring?.enabled ?? false,
  consentPolicyVersion: u?.monitoring?.consentPolicyVersion ?? null,
  consentDecision: u?.monitoring?.consentDecision ?? null,
  consentAt: u?.monitoring?.consentAt ?? null,
});

const hasConsent = (policy: MonitoringPolicy, m: EmployeeMonitoring) =>
  m.consentDecision === 'granted' && m.consentPolicyVersion === policy.policyVersion;

/** Whether an image can be shown, and if not, why. */
export function availabilityOf(s: Pick<Screenshot, 'status' | 'fileId' | 'fileMissingAt'>) {
  if (s.status === 'deleted') return 'deleted' as const;
  if (s.status === 'failed') return 'failed' as const;
  if (s.status !== 'uploaded' || !s.fileId) return 'pending' as const;
  return s.fileMissingAt ? ('missing' as const) : ('available' as const);
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    @InjectModel(Organization.name) private readonly orgs: Model<Organization>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(MonitoringSession.name) private readonly sessions: Model<MonitoringSession>,
    @InjectModel(Screenshot.name) private readonly shots: Model<Screenshot>,
    @InjectModel(MonitoringConsent.name) private readonly consents: Model<MonitoringConsent>,
    private readonly storage: ScreenshotStorageService,
    private readonly scope: ScopeService,
    private readonly activity: ActivityLogsService,
    private readonly access: AccessLogService,
  ) {}

  /* ---------------- Employee (self) ---------------- */

  /** Identity always comes from the verified server-side session, never the request body. */
  private async context(user: AuthUser) {
    const [org, me] = await Promise.all([
      this.orgs.findById(user.organizationId).select('monitoring').lean(),
      this.users.findById(user.id).select('monitoring employeeId firstName lastName lastLoginAt').lean(),
    ]);
    if (!me) throw new NotFoundException('Account not found.');
    return { policy: policyOf(org), enrolment: enrolmentOf(me), me };
  }

  async myStatus(user: AuthUser) {
    const { policy, enrolment } = await this.context(user);
    const required = policy.enabled && enrolment.enabled;
    return {
      required,
      policy: required ? { version: policy.policyVersion, text: policy.policyText } : null,
      consent: { decision: enrolment.consentDecision, policyVersion: enrolment.consentPolicyVersion, at: enrolment.consentAt },
      needsConsent: required && !hasConsent(policy, enrolment),
      captureIntervalSeconds: CAPTURE_INTERVAL_SECONDS,
      heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
      localRetentionHours: policy.localRetentionHours,
    };
  }

  async recordConsent(user: AuthUser, dto: ConsentDto, userAgent?: string) {
    const { policy, enrolment } = await this.context(user);
    if (!policy.enabled || !enrolment.enabled) throw new ConflictException({ message: 'Monitoring is not enabled for your account.', code: 'monitoring_disabled' });
    if (dto.policyVersion !== policy.policyVersion) {
      throw new ConflictException({ message: 'The monitoring policy has changed. Please review the current version.', code: 'policy_changed' });
    }
    await this.consents.create({
      organizationId: oid(user.organizationId),
      userId: oid(user.id),
      policyVersion: policy.policyVersion,
      decision: dto.decision,
      userAgent: userAgent?.slice(0, 300) ?? null,
    });
    await this.users.updateOne(
      { _id: oid(user.id) },
      { $set: { 'monitoring.consentDecision': dto.decision, 'monitoring.consentPolicyVersion': policy.policyVersion, 'monitoring.consentAt': new Date() } },
    );
    await this.activity.record({
      actor: user,
      action: `monitoring.consent_${dto.decision}`,
      entityType: 'monitoring',
      entityId: user.id,
      entityLabel: user.name,
      description: `${dto.decision === 'granted' ? 'consented to' : 'declined'} screen monitoring (policy v${policy.policyVersion})`,
      changes: { policyVersion: policy.policyVersion },
    });
    if (dto.decision === 'declined') await this.endActiveSessions(user.id, 'monitoring_disabled');
    return this.myStatus(user);
  }

  /** Called after the browser has granted a fresh screen-sharing stream. */
  async startSession(user: AuthUser, dto: StartSessionDto, userAgent?: string) {
    const { policy, enrolment, me } = await this.context(user);
    if (!policy.enabled || !enrolment.enabled) throw new ConflictException({ message: 'Monitoring is not enabled for your account.', code: 'monitoring_disabled' });
    if (!hasConsent(policy, enrolment)) throw new ForbiddenException({ message: 'Consent to the current monitoring policy is required first.', code: 'consent_required' });

    // A new tab or sign-in replaces any session still marked active.
    await this.endActiveSessions(user.id, 'superseded');
    const now = new Date();
    const session = await this.sessions.create({
      organizationId: oid(user.organizationId),
      userId: oid(user.id),
      status: 'active',
      policyVersion: policy.policyVersion,
      startedAt: now,
      lastHeartbeatAt: now,
      displaySurface: dto.displaySurface ?? null,
      loginAt: me.lastLoginAt ?? null,
      userAgent: userAgent?.slice(0, 300) ?? null,
    });
    await this.activity.record({
      actor: user,
      action: 'monitoring.session_started',
      entityType: 'monitoring',
      entityId: session._id,
      entityLabel: user.name,
      description: 'started a screen-monitoring session',
      changes: { displaySurface: dto.displaySurface ?? null },
    });
    return this.presentSession(session.toObject());
  }

  async heartbeat(user: AuthUser, sessionId: string, dto: HeartbeatDto = {}) {
    const now = new Date();
    const session = await this.sessions.findOne({ _id: oid(sessionId), userId: oid(user.id) }).lean();
    if (!session) throw new NotFoundException('Session not found.');
    if (session.status !== 'active') {
      throw new ConflictException({ message: 'This monitoring session has ended.', code: 'session_inactive', details: { endReason: [session.endReason ?? 'ended'] } });
    }
    // A heartbeat arriving after the timeout (e.g. after the computer slept) cannot revive the session.
    if (now.getTime() - session.lastHeartbeatAt.getTime() > HEARTBEAT_TIMEOUT_MS) {
      await this.close(session._id, 'expired', 'heartbeat_timeout', session.lastHeartbeatAt);
      throw new ConflictException({ message: 'This monitoring session was interrupted.', code: 'session_inactive', details: { endReason: ['heartbeat_timeout'] } });
    }
    const { policy, enrolment } = await this.context(user);
    if (!policy.enabled || !enrolment.enabled || !hasConsent(policy, enrolment)) {
      await this.close(session._id, 'ended', 'monitoring_disabled', now);
      throw new ConflictException({ message: 'Monitoring is no longer required for your account.', code: 'session_inactive', details: { endReason: ['monitoring_disabled'] } });
    }
    const set: Record<string, unknown> = { lastHeartbeatAt: now };
    if (dto.pendingUploads !== undefined) {
      set.clientQueue = { pending: dto.pendingUploads, oldestCapturedAt: dto.oldestPendingAt ? new Date(dto.oldestPendingAt) : null, reportedAt: now };
    }
    await this.sessions.updateOne({ _id: session._id, status: 'active' }, { $set: set });
    return { status: 'active' as const, lastHeartbeatAt: now };
  }

  async endSession(user: AuthUser, sessionId: string, dto: EndSessionDto) {
    const session = await this.sessions.findOne({ _id: oid(sessionId), userId: oid(user.id) }).lean();
    if (!session) throw new NotFoundException('Session not found.');
    if (session.status === 'active') {
      await this.close(session._id, 'ended', dto.reason, new Date());
      await this.activity.record({
        actor: user,
        action: 'monitoring.session_ended',
        entityType: 'monitoring',
        entityId: session._id,
        entityLabel: user.name,
        description: `ended a screen-monitoring session (${dto.reason.replace('_', ' ')})`,
        changes: { reason: dto.reason, captures: session.captureCount },
      });
    }
    return this.presentSession((await this.sessions.findById(session._id).lean())!);
  }

  async reportPermissionDenied(user: AuthUser) {
    await this.activity.record({
      actor: user,
      action: 'monitoring.permission_denied',
      entityType: 'monitoring',
      entityId: user.id,
      entityLabel: user.name,
      description: 'declined or cancelled the browser screen-sharing prompt',
    });
  }

  private async close(id: Types.ObjectId, status: 'ended' | 'expired', reason: SessionEndReason, at: Date) {
    await this.sessions.updateOne({ _id: id, status: 'active' }, { $set: { status, endReason: reason, endedAt: at } });
  }

  private async endActiveSessions(userId: string | Types.ObjectId, reason: SessionEndReason) {
    await this.sessions.updateMany({ userId: oid(userId), status: 'active' }, { $set: { status: 'ended', endReason: reason, endedAt: new Date() } });
  }

  /* ---------------- Upload ---------------- */

  async uploadScreenshot(user: AuthUser, dto: UploadScreenshotDto, file: UploadedImage | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('A screenshot file is required.');
    const type = IMAGE_TYPES[file.mimetype];
    if (!type || !type.magic(file.buffer)) throw new BadRequestException({ message: 'Screenshots must be JPEG, PNG or WebP images.', code: 'invalid_image' });

    const session = await this.sessions.findOne({ _id: oid(dto.sessionId), userId: oid(user.id), organizationId: oid(user.organizationId) }).lean();
    if (!session) throw new NotFoundException({ message: 'Session not found.', code: 'session_not_found' });

    const capturedAt = new Date(dto.capturedAt);
    const now = Date.now();
    const windowEnd = (session.endedAt ?? new Date(now)).getTime() + 60_000;
    if (capturedAt.getTime() < session.startedAt.getTime() - 60_000 || capturedAt.getTime() > Math.min(windowEnd, now + 60_000)) {
      throw new BadRequestException({ message: 'The capture time is outside its monitoring session.', code: 'capture_outside_session' });
    }

    const { policy, enrolment } = await this.context(user);
    if (!policy.enabled || !enrolment.enabled) throw new GoneException({ message: 'Monitoring is no longer enabled for your account.', code: 'monitoring_disabled' });

    const orgId = oid(user.organizationId);
    const shot = await this.shots
      .findOneAndUpdate(
        { organizationId: orgId, captureId: dto.captureId },
        {
          $setOnInsert: {
            userId: oid(user.id),
            sessionId: session._id,
            capturedAt,
            status: 'pending',
            expiresAt: new Date(capturedAt.getTime() + policy.retentionDays * DAY),
          },
        },
        { upsert: true, returnDocument: 'after' },
      )
      .lean();
    if (!shot!.userId.equals(user.id) || !shot!.sessionId.equals(session._id)) {
      throw new ConflictException({ message: 'This capture ID is already in use.', code: 'capture_conflict' });
    }
    // Idempotent: a retry of a confirmed upload is a success, not a duplicate.
    if (shot!.status === 'uploaded') return this.presentShot(shot!);
    if (shot!.status === 'deleted') throw new GoneException({ message: 'This screenshot has been deleted.', code: 'screenshot_deleted' });

    const claimed = await this.shots
      .findOneAndUpdate(
        {
          _id: shot!._id,
          $or: [{ status: { $in: ['pending', 'failed'] } }, { status: 'uploading', claimedAt: { $lt: new Date(now - STALE_CLAIM_MS) } }],
        },
        { $set: { status: 'uploading', claimedAt: new Date() }, $inc: { attempts: 1 } },
        { returnDocument: 'after' },
      )
      .lean();
    if (!claimed) throw new ConflictException({ message: 'This screenshot is already being uploaded.', code: 'upload_in_progress' });

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const dims = imageDimensions(file.buffer);
    const fileName = `${capturedAt.toISOString().replace(/[:.]/g, '-')}_${String(session._id)}_${dto.captureId}.${type.ext}`;
    try {
      // A previous attempt may have stored the file before failing to record it.
      const fileId =
        (await this.storage.findByCapture(orgId, dto.captureId)) ??
        (await this.storage.store({
          organizationId: orgId,
          userId: oid(user.id),
          sessionId: session._id,
          captureId: dto.captureId,
          fileName,
          mimeType: file.mimetype,
          data: file.buffer,
        }));
      const uploaded = await this.shots
        .findByIdAndUpdate(
          claimed._id,
          {
            $set: {
              status: 'uploaded',
              fileId,
              fileName,
              mimeType: file.mimetype,
              sizeBytes: file.size,
              sha256,
              width: dims?.width ?? null,
              height: dims?.height ?? null,
              fileMissingAt: null,
              uploadedAt: new Date(),
              claimedAt: null,
              lastError: null,
            },
          },
          { returnDocument: 'after' },
        )
        .lean();
      await this.sessions.updateOne({ _id: session._id }, { $inc: { captureCount: 1 }, $max: { lastCaptureAt: capturedAt, lastUploadAt: uploaded!.uploadedAt } });
      return this.presentShot(uploaded!);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.shots.updateOne({ _id: claimed._id }, { $set: { status: 'failed', lastError: message.slice(0, 500), claimedAt: null } });
      this.logger.warn(`Screenshot upload failed (capture ${dto.captureId}): ${message}`);
      throw new HttpException(
        { message: 'The screenshot could not be stored. It will be retried.', code: 'storage_failed' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /* ---------------- Administration ---------------- */

  async policy(user: AuthUser) {
    const org = await this.orgs.findById(user.organizationId).select('monitoring').lean();
    const p = policyOf(org);
    return {
      enabled: p.enabled,
      policyVersion: p.policyVersion,
      policyText: p.policyText,
      retentionDays: p.retentionDays,
      localRetentionHours: p.localRetentionHours,
      storageConfigured: true,
      captureIntervalSeconds: CAPTURE_INTERVAL_SECONDS,
    };
  }

  async updatePolicy(user: AuthUser, dto: UpdatePolicyDto) {
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) if (v !== undefined) set[`monitoring.${k}`] = v;
    await this.orgs.updateOne({ _id: oid(user.organizationId) }, { $set: set });
    if (dto.enabled === false) {
      await this.sessions.updateMany(
        { organizationId: oid(user.organizationId), status: 'active' },
        { $set: { status: 'ended', endReason: 'monitoring_disabled', endedAt: new Date() } },
      );
    }
    await this.activity.record({
      actor: user,
      action: 'monitoring.policy_updated',
      entityType: 'monitoring',
      description: 'updated the screen-monitoring policy',
      changes: {
        enabled: dto.enabled,
        policyVersion: dto.policyVersion,
        retentionDays: dto.retentionDays,
        localRetentionHours: dto.localRetentionHours,
        policyText: dto.policyText === undefined ? undefined : '(updated)',
      },
    });
    return this.policy(user);
  }

  /** Same visibility as the employee directory: org-wide for admins, own teams for managers. */
  private async visibleUsers(actor: AuthUser): Promise<Record<string, unknown>> {
    const base = { organizationId: oid(actor.organizationId), deletedAt: null };
    if (can(actor, 'tasks.view_all')) return base;
    const depts = await this.scope.authorizedDepartmentIds(actor);
    return { ...base, $or: [{ departmentId: { $in: depts } }, { managerId: oid(actor.id) }] };
  }

  private async findVisibleUser(actor: AuthUser, userId: string) {
    const user = await this.users.findOne({ ...(await this.visibleUsers(actor)), _id: oid(userId) }).lean();
    if (!user) throw new NotFoundException('Employee not found.');
    return user;
  }

  async listEmployees(actor: AuthUser, q: EmployeeMonitoringQueryDto) {
    const filter: Record<string, unknown> = { ...(await this.visibleUsers(actor)), status: { $ne: 'invited' } };
    if (q.search) {
      const re = new RegExp(escapeRegex(q.search), 'i');
      filter.$and = [{ $or: [{ firstName: re }, { lastName: re }, { email: re }, { employeeId: re }] }];
    }
    const [users, total, org] = await Promise.all([
      this.users.find(filter).sort({ firstName: 1, lastName: 1 }).skip(skipFor(q)).limit(q.pageSize).lean(),
      this.users.countDocuments(filter),
      this.orgs.findById(actor.organizationId).select('monitoring').lean(),
    ]);
    const rows = await this.statusRows(users, policyOf(org));
    return new Paginated(rows, total, q.page, q.pageSize);
  }

  async employeeStatus(actor: AuthUser, userId: string) {
    const user = await this.findVisibleUser(actor, userId);
    const org = await this.orgs.findById(actor.organizationId).select('monitoring').lean();
    return (await this.statusRows([user], policyOf(org)))[0]!;
  }

  private async statusRows(users: (User & { _id: Types.ObjectId })[], policy: MonitoringPolicy) {
    const ids = users.map((u) => u._id);
    const [latest, captures] = await Promise.all([
      this.sessions.aggregate<{ _id: Types.ObjectId; session: LeanSession }>([
        { $match: { userId: { $in: ids } } },
        { $sort: { startedAt: -1 } },
        { $group: { _id: '$userId', session: { $first: '$$ROOT' } } },
      ]),
      this.shots.aggregate<{ _id: Types.ObjectId; lastCaptureAt: Date | null; failed: number }>([
        { $match: { userId: { $in: ids }, status: { $ne: 'deleted' } } },
        {
          $group: {
            _id: '$userId',
            lastCaptureAt: { $max: { $cond: [{ $eq: ['$status', 'uploaded'] }, '$capturedAt', null] } },
            failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          },
        },
      ]),
    ]);
    const sessionBy = new Map(latest.map((l) => [String(l._id), l.session]));
    const captureBy = new Map(captures.map((c) => [String(c._id), c]));
    return users.map((u) => {
      const m = enrolmentOf(u);
      const s = sessionBy.get(String(u._id));
      return {
        userId: String(u._id),
        employeeId: u.employeeId,
        name: fullName(u),
        email: u.email,
        enabled: m.enabled,
        required: policy.enabled && m.enabled,
        consent: {
          decision: m.consentDecision,
          policyVersion: m.consentPolicyVersion,
          at: m.consentAt,
          current: hasConsent(policy, m),
        },
        latestSession: s ? this.presentSession(s) : null,
        lastCaptureAt: captureBy.get(String(u._id))?.lastCaptureAt ?? null,
        failedUploads: captureBy.get(String(u._id))?.failed ?? 0,
      };
    });
  }

  async setEnrollment(actor: AuthUser, userId: string, enabled: boolean) {
    const user = await this.findVisibleUser(actor, userId);
    await this.users.updateOne({ _id: user._id }, { $set: { 'monitoring.enabled': enabled } });
    if (!enabled) await this.endActiveSessions(user._id, 'monitoring_disabled');
    await this.activity.record({
      actor,
      action: enabled ? 'monitoring.enrolled' : 'monitoring.unenrolled',
      entityType: 'monitoring',
      entityId: user._id,
      entityLabel: fullName(user),
      description: `${enabled ? 'enabled' : 'disabled'} screen monitoring for ${fullName(user)}`,
    });
    return this.employeeStatus(actor, userId);
  }

  async listSessions(actor: AuthUser, userId: string) {
    const user = await this.findVisibleUser(actor, userId);
    const items = await this.sessions.find({ organizationId: oid(actor.organizationId), userId: user._id }).sort({ startedAt: -1 }).limit(100).lean();
    return items.map((s) => this.presentSession(s));
  }

  async listScreenshots(actor: AuthUser, q: ScreenshotQueryDto) {
    const user = await this.findVisibleUser(actor, q.userId);
    const filter: Record<string, unknown> = { organizationId: oid(actor.organizationId), userId: user._id, status: { $ne: 'deleted' } };
    if (q.sessionId) filter.sessionId = oid(q.sessionId);
    if (q.from || q.to) filter.capturedAt = { ...(q.from ? { $gte: new Date(q.from) } : {}), ...(q.to ? { $lte: new Date(q.to) } : {}) };
    const [items, total] = await Promise.all([
      this.shots.find(filter).sort({ capturedAt: -1 }).skip(skipFor(q)).limit(q.pageSize).lean(),
      this.shots.countDocuments(filter),
    ]);
    return new Paginated(items.map((s) => this.presentShot(s)), total, q.page, q.pageSize);
  }

  private async findVisibleShot(actor: AuthUser, id: string) {
    const shot = await this.shots.findOne({ _id: oid(id), organizationId: oid(actor.organizationId), status: { $ne: 'deleted' } }).lean();
    if (!shot) throw new NotFoundException('Screenshot not found.');
    const user = await this.findVisibleUser(actor, String(shot.userId)).catch(() => null);
    if (!user) throw new NotFoundException('Screenshot not found.');
    return { shot, user };
  }

  /** Streams the image from MongoDB. Every view is recorded in the access audit log. */
  async screenshotContent(actor: AuthUser, id: string, ctx: AccessContext = {}) {
    const { shot } = await this.findVisibleShot(actor, id);
    const file = await this.fetchImage(shot);
    await this.access.record(actor, 'previewed', shot, ctx);
    return file;
  }

  /**
   * Downloads a screenshot's bytes, distinguishing "not uploaded yet",
   * "deleted" and "missing from storage" so callers can show an honest state.
   */
  async fetchImage(shot: LeanShot) {
    if (shot.status === 'deleted') throw new GoneException({ message: 'This screenshot was deleted under the retention policy.', code: 'screenshot_deleted' });
    if (shot.status !== 'uploaded' || !shot.fileId) {
      throw new ConflictException({ message: `This screenshot is not available yet (upload ${shot.status}).`, code: 'not_uploaded' });
    }
    try {
      const data = await this.storage.read(shot.fileId);
      if (shot.fileMissingAt) await this.shots.updateOne({ _id: shot._id }, { $set: { fileMissingAt: null } });
      return { data, mimeType: shot.mimeType ?? 'image/jpeg', fileName: shot.fileName ?? `${shot.captureId}.jpg` };
    } catch (err) {
      if (err instanceof StorageError && err.status === 404) {
        await this.shots.updateOne({ _id: shot._id }, { $set: { fileMissingAt: new Date() } });
        throw new NotFoundException({ message: 'The screenshot file is missing from storage.', code: 'file_missing' });
      }
      this.logger.warn(`Screenshot download failed (${String(shot._id)}): ${(err as Error).message}`);
      throw new HttpException({ message: 'The screenshot could not be retrieved from storage.', code: 'storage_failed' }, HttpStatus.BAD_GATEWAY);
    }
  }

  async deleteScreenshot(actor: AuthUser, id: string, ctx: AccessContext = {}) {
    const { shot, user } = await this.findVisibleShot(actor, id);
    await this.purge(shot);
    await this.access.record(actor, 'deleted', shot, ctx);
    await this.activity.record({
      actor,
      action: 'monitoring.screenshot_deleted',
      entityType: 'monitoring',
      entityId: shot._id,
      entityLabel: fullName(user),
      description: `deleted a screenshot of ${fullName(user)} captured ${shot.capturedAt.toISOString()}`,
    });
  }

  /** Permanently removes the stored file, then clears the file metadata (the audit record stays). */
  async purge(shot: LeanShot) {
    if (shot.fileId) await this.storage.delete(shot.fileId);
    await this.shots.updateOne(
      { _id: shot._id },
      { $set: { status: 'deleted', deletedAt: new Date(), fileId: null, sha256: null, lastError: null, claimedAt: null } },
    );
  }

  /* ---------------- Background jobs ---------------- */

  /** Marks sessions without a recent heartbeat as expired (browser closed, sleep, network loss). */
  async expireStaleSessions(now = new Date()) {
    const cutoff = new Date(now.getTime() - HEARTBEAT_TIMEOUT_MS);
    const stale = await this.sessions.find({ status: 'active', lastHeartbeatAt: { $lt: cutoff } }).select('_id lastHeartbeatAt').lean();
    for (const s of stale) await this.close(s._id, 'expired', 'heartbeat_timeout', s.lastHeartbeatAt);
    return stale.length;
  }

  /** Applies the retention policy. Failures are retried on the next run. */
  async purgeExpiredScreenshots(now = new Date(), batch = 200) {
    const due = await this.shots.find({ status: { $ne: 'deleted' }, expiresAt: { $lte: now } }).limit(batch).lean();
    let purged = 0;
    for (const shot of due) {
      try {
        await this.purge(shot);
        await this.access.record(null, 'retention_purged', shot);
        purged++;
      } catch (err) {
        this.logger.warn(`Retention purge failed for screenshot ${String(shot._id)}: ${(err as Error).message}`);
      }
    }
    return purged;
  }

  /* ---------------- Presenters ---------------- */

  presentSession(s: LeanSession) {
    return {
      id: String(s._id),
      userId: String(s.userId),
      status: s.status,
      displayStatus: displayStatus(s),
      loginAt: s.loginAt ?? null,
      /** Only a confirmed logout has a logout time; timeouts and interruptions don't. */
      logoutAt: s.endReason === 'logout' ? s.endedAt : null,
      lastUploadAt: s.lastUploadAt ?? null,
      clientQueue: s.clientQueue ?? null,
      startedAt: s.startedAt,
      lastHeartbeatAt: s.lastHeartbeatAt,
      endedAt: s.endedAt,
      endReason: s.endReason,
      displaySurface: s.displaySurface,
      captureCount: s.captureCount,
      lastCaptureAt: s.lastCaptureAt,
      policyVersion: s.policyVersion,
    };
  }

  presentShot(s: LeanShot) {
    return {
      width: s.width ?? null,
      height: s.height ?? null,
      lastError: s.status === 'failed' ? s.lastError : null,
      availability: availabilityOf(s),
      id: String(s._id),
      userId: String(s.userId),
      sessionId: String(s.sessionId),
      captureId: s.captureId,
      capturedAt: s.capturedAt,
      status: s.status,
      attempts: s.attempts,
      uploadedAt: s.uploadedAt,
      sizeBytes: s.sizeBytes,
      mimeType: s.mimeType,
      expiresAt: s.expiresAt,
    };
  }
}
