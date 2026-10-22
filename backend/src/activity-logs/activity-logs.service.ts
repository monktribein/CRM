import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { can, type AuthUser } from '../common/auth-user.js';
import { escapeRegex, Paginated, skipFor } from '../common/pagination.js';
import { refOf, RefsService } from '../core/refs.service.js';
import { oid, ScopeService } from '../core/scope.service.js';
import { User } from '../users/user.schema.js';
import { currentRequestId } from '../common/request-context.js';
import { ActivityLog, type ActivityEntity } from './activity-log.schema.js';
import type { ActivityQueryDto } from './activity-query.dto.js';

export interface RecordInput {
  actor: Pick<AuthUser, 'id' | 'organizationId' | 'name'>;
  action: string;
  entityType: ActivityEntity;
  entityId?: string | Types.ObjectId | null;
  entityLabel?: string | null;
  description: string;
  /** Safe change details, e.g. { from, to }. Secret-like keys are stripped. */
  changes?: Record<string, unknown>;
}

const SECRET_KEY = /pass|token|secret|hash|cookie|authorization/i;

/** Removes anything that looks like a secret before it is persisted. */
export function sanitizeMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Types.ObjectId) && !(v instanceof Date)
      ? sanitizeMetadata(v as Record<string, unknown>)
      : v;
  }
  return out;
}

@Injectable()
export class ActivityLogsService {
  constructor(
    @InjectModel(ActivityLog.name) private readonly logs: Model<ActivityLog>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly scope: ScopeService,
    private readonly refs: RefsService,
  ) {}

  async record(input: RecordInput) {
    await this.logs.create({
      organizationId: oid(input.actor.organizationId),
      actorId: oid(input.actor.id),
      actorName: input.actor.name,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ? oid(input.entityId) : null,
      entityLabel: input.entityLabel ?? null,
      description: input.description,
      changes: sanitizeMetadata(input.changes),
      requestId: currentRequestId(),
    });
  }

  async list(user: AuthUser, q: ActivityQueryDto) {
    const filter: Record<string, unknown> = { organizationId: oid(user.organizationId) };
    // Org-wide for admins and HR; managers see activity by people in their teams.
    if (!can(user, 'tasks.view_all') && user.role !== 'hr_manager') {
      const depts = await this.scope.authorizedDepartmentIds(user);
      const actors = await this.users.find({ departmentId: { $in: depts } }).select('_id').lean();
      filter.actorId = { $in: [...actors.map((a) => a._id), oid(user.id)] };
    }
    if (q.entityType) filter.entityType = q.entityType;
    if (q.search) {
      const re = new RegExp(escapeRegex(q.search), 'i');
      filter.$or = [{ description: re }, { actorName: re }, { entityLabel: re }];
    }
    const [items, total] = await Promise.all([
      this.logs.find(filter).sort({ createdAt: -1 }).skip(skipFor(q)).limit(q.pageSize).lean(),
      this.logs.countDocuments(filter),
    ]);
    const refs = await this.refs.userRefs(items.map((i) => i.actorId));
    return new Paginated(
      items.map((l) => ({
        id: String(l._id),
        actor: { ...refOf(refs, l.actorId), name: refs.get(String(l.actorId))?.name ?? l.actorName },
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId ? String(l.entityId) : null,
        entityLabel: l.entityLabel,
        description: l.description,
        createdAt: l.createdAt,
      })),
      total,
      q.page,
      q.pageSize,
    );
  }

  async forEntity(organizationId: string, entityType: ActivityEntity, entityId: string) {
    const items = await this.logs
      .find({ organizationId: oid(organizationId), entityType, entityId: oid(entityId) })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    const refs = await this.refs.userRefs(items.map((i) => i.actorId));
    return items.map((l) => ({
      id: String(l._id),
      action: l.action,
      actor: refOf(refs, l.actorId),
      description: l.description,
      createdAt: l.createdAt,
    }));
  }
}
