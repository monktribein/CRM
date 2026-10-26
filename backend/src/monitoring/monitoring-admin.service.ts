import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../common/auth-user.js';
import { escapeRegex, Paginated, skipFor } from '../common/pagination.js';
import { zonedDayRange } from '../common/timezone.js';
import { oid } from '../core/scope.service.js';
import { Department } from '../departments/department.schema.js';
import { Organization } from '../settings/organization.schema.js';
import { fullName, User } from '../users/user.schema.js';
import { AccessLogService, type AccessContext } from './access-log.service.js';
import type { AccessAuditQueryDto, AdminScreenshotQueryDto, AdminSessionQueryDto } from './admin.dto.js';
import { MonitoringSession, Screenshot, ScreenshotAccessLog, type DisplayStatus } from './monitoring.schemas.js';
import { MonitoringService } from './monitoring.service.js';

const STATUS_FILTERS: Record<DisplayStatus, Record<string, unknown>> = {
  active: { status: 'active' },
  expired: { status: 'expired' },
  ended: { status: 'ended', endReason: { $in: ['logout', 'user_stopped'] } },
  interrupted: { status: 'ended', endReason: { $nin: ['logout', 'user_stopped'] } },
};

const AVAILABILITY_FILTERS: Record<string, Record<string, unknown>> = {
  available: { status: 'uploaded', fileMissingAt: null },
  missing: { status: 'uploaded', fileMissingAt: { $ne: null } },
  pending: { status: { $in: ['pending', 'uploading'] } },
  failed: { status: 'failed' },
  deleted: { status: 'deleted' },
};

type LeanUser = User & { _id: Types.ObjectId };

/**
 * Organisation-wide monitoring dashboard for Super Admins. Every query is
 * bounded by the caller's organisation, taken from the verified session; the
 * controller requires the Super-Admin-only `monitoring.super` permission.
 */
@Injectable()
export class MonitoringAdminService {
  constructor(
    @InjectModel(Organization.name) private readonly orgs: Model<Organization>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Department.name) private readonly departments: Model<Department>,
    @InjectModel(MonitoringSession.name) private readonly sessions: Model<MonitoringSession>,
    @InjectModel(Screenshot.name) private readonly shots: Model<Screenshot>,
    @InjectModel(ScreenshotAccessLog.name) private readonly logs: Model<ScreenshotAccessLog>,
    private readonly monitoring: MonitoringService,
    private readonly access: AccessLogService,
  ) {}

  private async org(actor: AuthUser) {
    const org = await this.orgs.findById(actor.organizationId).select('timezone monitoring').lean();
    return { timezone: org?.timezone ?? 'UTC', policyVersion: org?.monitoring?.policyVersion ?? '1' };
  }

  /** Employee IDs matching a name/email/employee-ID search and/or department, within the org. */
  private async matchingUserIds(actor: AuthUser, search?: string, departmentId?: string) {
    if (!search && !departmentId) return null;
    const filter: Record<string, unknown> = { organizationId: oid(actor.organizationId) };
    if (departmentId) filter.departmentId = oid(departmentId);
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ firstName: re }, { lastName: re }, { email: re }, { employeeId: re }];
    }
    return this.users.find(filter).distinct('_id');
  }

  private async employees(ids: Types.ObjectId[]) {
    const users = (await this.users
      .find({ _id: { $in: ids } })
      .select('employeeId firstName lastName email departmentId jobFunction monitoring')
      .lean()) as LeanUser[];
    const depts = await this.departments
      .find({ _id: { $in: users.map((u) => u.departmentId).filter(Boolean) } })
      .select('name')
      .lean();
    const deptName = new Map(depts.map((d) => [String(d._id), d.name]));
    return new Map(users.map((u) => [String(u._id), { user: u, departmentName: u.departmentId ? (deptName.get(String(u.departmentId)) ?? null) : null }]));
  }

  private employeeRef(entry: { user: LeanUser; departmentName: string | null } | undefined, policyVersion: string) {
    if (!entry) return null;
    const { user: u, departmentName } = entry;
    const m = u.monitoring ?? { consentDecision: null, consentPolicyVersion: null, consentAt: null };
    return {
      id: String(u._id),
      employeeId: u.employeeId,
      name: fullName(u),
      email: u.email,
      departmentId: u.departmentId ? String(u.departmentId) : null,
      departmentName,
      jobFunction: u.jobFunction,
      consent: {
        decision: m.consentDecision ?? null,
        policyVersion: m.consentPolicyVersion ?? null,
        at: m.consentAt ?? null,
        current: m.consentDecision === 'granted' && m.consentPolicyVersion === policyVersion,
      },
    };
  }

  /* ---------------- Login activity / sessions ---------------- */

  async listSessions(actor: AuthUser, q: AdminSessionQueryDto) {
    const { timezone, policyVersion } = await this.org(actor);
    const filter: Record<string, unknown> = { organizationId: oid(actor.organizationId) };
    const ids = await this.matchingUserIds(actor, q.search, q.departmentId);
    if (ids) filter.userId = { $in: q.userId ? ids.filter((i) => i.equals(q.userId!)) : ids };
    else if (q.userId) filter.userId = oid(q.userId);
    const range = zonedDayRange(timezone, q.from, q.to);
    if (range) filter.startedAt = range;
    if (q.status) Object.assign(filter, STATUS_FILTERS[q.status]);

    const sortField = q.sort ?? 'startedAt';
    const dir = q.order === 'asc' ? 1 : -1;
    const [items, total] = await Promise.all([
      this.sessions.find(filter).sort({ [sortField]: dir, _id: dir }).skip(skipFor(q)).limit(q.pageSize).lean(),
      this.sessions.countDocuments(filter),
    ]);
    const people = await this.employees([...new Set(items.map((s) => String(s.userId)))].map((i) => oid(i)));
    return new Paginated(
      items.map((s) => ({ ...this.monitoring.presentSession(s), employee: this.employeeRef(people.get(String(s.userId)), policyVersion) })),
      total,
      q.page,
      q.pageSize,
    );
  }

  async getSession(actor: AuthUser, id: string) {
    const { policyVersion, timezone } = await this.org(actor);
    const s = await this.sessions.findOne({ _id: oid(id), organizationId: oid(actor.organizationId) }).lean();
    if (!s) throw new NotFoundException('Session not found.');
    const people = await this.employees([s.userId]);
    const counts = await this.shots.aggregate<{ _id: string; n: number }>([
      { $match: { sessionId: s._id } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    return {
      ...this.monitoring.presentSession(s),
      employee: this.employeeRef(people.get(String(s.userId)), policyVersion),
      screenshotCounts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
      timezone,
    };
  }

  /* ---------------- Screenshots ---------------- */

  async listScreenshots(actor: AuthUser, q: AdminScreenshotQueryDto) {
    const { timezone } = await this.org(actor);
    const filter: Record<string, unknown> = { organizationId: oid(actor.organizationId) };
    if (q.sessionId) filter.sessionId = oid(q.sessionId);
    const ids = await this.matchingUserIds(actor, undefined, q.departmentId);
    if (ids) filter.userId = { $in: q.userId ? ids.filter((i) => i.equals(q.userId!)) : ids };
    else if (q.userId) filter.userId = oid(q.userId);
    const range = zonedDayRange(timezone, q.from, q.to);
    if (range) filter.capturedAt = range;
    if (q.availability) Object.assign(filter, AVAILABILITY_FILTERS[q.availability]);

    // A session reads chronologically; the gallery shows newest first.
    const dir = (q.order ?? (q.sessionId ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
    const [items, total] = await Promise.all([
      this.shots.find(filter).sort({ capturedAt: dir, _id: dir }).skip(skipFor(q)).limit(q.pageSize).lean(),
      this.shots.countDocuments(filter),
    ]);
    const people = await this.employees([...new Set(items.map((s) => String(s.userId)))].map((i) => oid(i)));
    return new Paginated(
      items.map((s) => {
        const p = people.get(String(s.userId));
        return {
          ...this.monitoring.presentShot(s),
          employee: p ? { id: String(p.user._id), employeeId: p.user.employeeId, name: fullName(p.user) } : null,
        };
      }),
      total,
      q.page,
      q.pageSize,
    );
  }

  /** Authorised image bytes, streamed through the API (storage is never exposed directly). */
  async preview(actor: AuthUser, id: string, download: boolean, ctx: AccessContext) {
    const shot = await this.shots.findOne({ _id: oid(id), organizationId: oid(actor.organizationId) }).lean();
    if (!shot) throw new NotFoundException('Screenshot not found.');
    const file = await this.monitoring.fetchImage(shot);
    await this.access.record(actor, download ? 'downloaded' : 'previewed', shot, ctx);
    return file;
  }

  /* ---------------- Upload & sync ---------------- */

  async uploadStatus(actor: AuthUser) {
    const orgId = oid(actor.organizationId);
    const [byStatus, missing, problems, backlog] = await Promise.all([
      this.shots.aggregate<{ _id: string; n: number; oldest: Date }>([
        { $match: { organizationId: orgId } },
        { $group: { _id: '$status', n: { $sum: 1 }, oldest: { $min: '$capturedAt' } } },
      ]),
      this.shots.countDocuments({ organizationId: orgId, status: 'uploaded', fileMissingAt: { $ne: null } }),
      this.shots.find({ organizationId: orgId, status: { $in: ['failed', 'pending', 'uploading'] } }).sort({ updatedAt: -1 }).limit(50).lean(),
      this.sessions.find({ organizationId: orgId, status: 'active', 'clientQueue.pending': { $gt: 0 } }).sort({ 'clientQueue.pending': -1 }).limit(50).lean(),
    ]);
    const people = await this.employees([...new Set([...problems, ...backlog].map((x) => String(x.userId)))].map((i) => oid(i)));
    const who = (userId: Types.ObjectId) => {
      const p = people.get(String(userId));
      return p ? { id: String(p.user._id), employeeId: p.user.employeeId, name: fullName(p.user) } : null;
    };
    return {
      storageConfigured: true,
      counts: {
        ...Object.fromEntries(['uploaded', 'pending', 'uploading', 'failed', 'deleted'].map((k) => [k, 0])),
        ...Object.fromEntries(byStatus.map((s) => [s._id, s.n])),
        missing,
      },
      oldestUnsentCapturedAt:
        byStatus.filter((s) => ['pending', 'uploading', 'failed'].includes(s._id)).map((s) => s.oldest).sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
      problems: problems.map((s) => ({ ...this.monitoring.presentShot(s), lastError: s.lastError, updatedAt: s.updatedAt, employee: who(s.userId) })),
      /** Screenshots still in employees' browsers, as reported by heartbeats (server can't see them until upload). */
      browserBacklog: backlog.map((s) => ({ sessionId: String(s._id), employee: who(s.userId), clientQueue: s.clientQueue })),
    };
  }

  /* ---------------- Access audit ---------------- */

  async accessAudit(actor: AuthUser, q: AccessAuditQueryDto) {
    const { timezone } = await this.org(actor);
    const filter: Record<string, unknown> = { organizationId: oid(actor.organizationId) };
    if (q.action) filter.action = q.action;
    const range = zonedDayRange(timezone, q.from, q.to);
    if (range) filter.createdAt = range;
    if (q.search) {
      const re = new RegExp(escapeRegex(q.search), 'i');
      const employees = await this.matchingUserIds(actor, q.search);
      filter.$or = [{ actorName: re }, { employeeUserId: { $in: employees ?? [] } }];
    }
    const [items, total] = await Promise.all([
      this.logs.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skipFor(q)).limit(q.pageSize).lean(),
      this.logs.countDocuments(filter),
    ]);
    const people = await this.employees([...new Set(items.map((l) => String(l.employeeUserId)))].map((i) => oid(i)));
    return new Paginated(
      items.map((l) => {
        const p = people.get(String(l.employeeUserId));
        return {
          id: String(l._id),
          action: l.action,
          actor: { id: l.actorId ? String(l.actorId) : null, name: l.actorName, role: l.actorRole },
          employee: p ? { id: String(p.user._id), employeeId: p.user.employeeId, name: fullName(p.user) } : { id: String(l.employeeUserId), employeeId: null, name: 'Removed employee' },
          screenshotId: String(l.screenshotId),
          sessionId: String(l.sessionId),
          capturedAt: l.capturedAt,
          ip: l.ip,
          createdAt: l.createdAt,
        };
      }),
      total,
      q.page,
      q.pageSize,
    );
  }
}
