import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';
import { hashPassword } from '../auth/password.js';
import { TokenService } from '../auth/tokens/token.service.js';
import { can, type AuthUser } from '../common/auth-user.js';
import { Counter, nextSequence } from '../common/counter.schema.js';
import { escapeRegex, Paginated, skipFor } from '../common/pagination.js';
import { allowedOrigins, type EnvironmentVariables } from '../config/env.js';
import { RefsService } from '../core/refs.service.js';
import { OrgReferencesService } from '../core/org-references.service.js';
import { oid, ScopeService } from '../core/scope.service.js';
import { Department } from '../departments/department.schema.js';
import { MailService } from '../mail/mail.service.js';
import { grantableRoles, MANAGERIAL_ROLES, permissionsFor } from '../roles/permissions.js';
import { Organization } from '../settings/organization.schema.js';
import { Task } from '../tasks/task.schema.js';
import type { CreateUserDto, UpdateProfileDto, UpdateUserDto, UserQueryDto } from './dto.js';
import { fullName, User } from './user.schema.js';

const INVITATION_TTL_MS = 72 * 3600 * 1000;
type LeanUser = User & { _id: Types.ObjectId };

@Injectable()
export class UsersService {
  private readonly frontendUrl: string;

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Department.name) private readonly departments: Model<Department>,
    @InjectModel(Organization.name) private readonly orgs: Model<Organization>,
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    @InjectModel(Counter.name) private readonly counters: Model<Counter>,
    private readonly scope: ScopeService,
    private readonly references: OrgReferencesService,
    private readonly refs: RefsService,
    private readonly tokenService: TokenService,
    private readonly activity: ActivityLogsService,
    private readonly mail: MailService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.frontendUrl = allowedOrigins({ FRONTEND_URL: config.get('FRONTEND_URL', { infer: true }) })[0]!;
  }

  /* ---------------- Mapping ---------------- */

  async toCurrentUser(userId: string) {
    const u = await this.users.findById(userId).lean();
    if (!u) throw new NotFoundException('User not found.');
    const [dept, org] = await Promise.all([
      u.departmentId ? this.departments.findById(u.departmentId).select('name').lean() : null,
      this.orgs.findById(u.organizationId).select('name').lean(),
    ]);
    return {
      id: String(u._id),
      name: fullName(u),
      email: u.email,
      avatarUrl: u.avatar,
      employeeId: u.employeeId,
      role: u.securityRole,
      jobFunction: u.jobFunction,
      title: u.title,
      departmentId: u.departmentId ? String(u.departmentId) : null,
      departmentName: dept?.name ?? null,
      organizationName: org?.name ?? '',
      permissions: permissionsFor(u.securityRole),
    };
  }

  private async toEmployees(list: LeanUser[]) {
    const ids = list.map((u) => u._id);
    const [depts, managers, counts] = await Promise.all([
      this.refs.departmentNames(list.map((u) => u.departmentId)),
      this.refs.userRefs(list.map((u) => u.managerId)),
      this.tasks.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { assignedTo: { $in: ids }, status: { $nin: ['completed', 'cancelled'] } } },
        { $unwind: '$assignedTo' },
        { $match: { assignedTo: { $in: ids } } },
        { $group: { _id: '$assignedTo', n: { $sum: 1 } } },
      ]),
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.n]));
    return list.map((u) => ({
      id: String(u._id),
      employeeId: u.employeeId,
      name: fullName(u),
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      avatarUrl: u.avatar,
      title: u.title,
      departmentId: u.departmentId ? String(u.departmentId) : null,
      departmentName: u.departmentId ? (depts.get(String(u.departmentId)) ?? null) : null,
      role: u.securityRole,
      jobFunction: u.jobFunction,
      managerId: u.managerId ? String(u.managerId) : null,
      managerName: u.managerId ? (managers.get(String(u.managerId))?.name ?? null) : null,
      status: u.status,
      joinDate: u.joinedAt,
      assignedTaskCount: countMap.get(String(u._id)) ?? 0,
      invitationSentAt: u.invitedAt,
      lastLoginAt: u.lastLoginAt,
    }));
  }

  /* ---------------- Scope ---------------- */

  /** Admins and HR see the organisation; managers see their departments. */
  private async visibilityFilter(actor: AuthUser): Promise<Record<string, unknown>> {
    const base = { organizationId: oid(actor.organizationId), deletedAt: null };
    if (can(actor, 'tasks.view_all') || actor.role === 'hr_manager') return base;
    const depts = await this.scope.authorizedDepartmentIds(actor);
    return { ...base, $or: [{ departmentId: { $in: depts } }, { managerId: oid(actor.id) }] };
  }

  private async findVisible(actor: AuthUser, id: string) {
    const user = await this.users.findOne({ ...(await this.visibilityFilter(actor)), _id: oid(id) }).lean();
    if (!user) throw new NotFoundException('Employee not found.');
    return user;
  }

  /** The actor may only modify accounts whose role they could grant, never their own. */
  private assertCanModify(actor: AuthUser, target: LeanUser) {
    if (String(target._id) === actor.id) {
      throw new ForbiddenException("You can't change your own role or account status.");
    }
    if (!grantableRoles(actor.role).includes(target.securityRole)) {
      throw new ForbiddenException("You can't modify an account with this privilege level.");
    }
  }

  private async validatePlacement(orgId: string, departmentId?: string, managerId?: string | null, selfId?: string) {
    if (departmentId) await this.references.department(orgId, departmentId);
    if (managerId) {
      if (managerId === selfId) throw new UnprocessableEntityException("An employee can't report to themselves.");
      await this.references.user(orgId, managerId, { field: 'managerId', roles: MANAGERIAL_ROLES, message: 'Select an active manager.' });
    }
  }

  /** Keeps departments.memberIds in step with users.departmentId (the source of truth). */
  private async syncMembership(userId: Types.ObjectId, from: Types.ObjectId | null, to: Types.ObjectId | null) {
    if (from && (!to || !from.equals(to))) await this.departments.updateOne({ _id: from }, { $pull: { memberIds: userId } });
    if (to) await this.departments.updateOne({ _id: to }, { $addToSet: { memberIds: userId } });
  }

  /* ---------------- Queries ---------------- */

  async list(actor: AuthUser, q: UserQueryDto) {
    const filter: Record<string, unknown> = await this.visibilityFilter(actor);
    const and: Record<string, unknown>[] = [];
    if (q.search) {
      const re = new RegExp(escapeRegex(q.search), 'i');
      and.push({ $or: [{ firstName: re }, { lastName: re }, { email: re }, { employeeId: re }] });
    }
    if (q.departmentId) filter.departmentId = oid(q.departmentId);
    if (q.role?.length) filter.securityRole = { $in: q.role };
    if (q.status) filter.status = q.status;
    if (q.managerId) filter.managerId = oid(q.managerId);
    if (and.length) filter.$and = and;

    const [list, total] = await Promise.all([
      this.users.find(filter).sort({ firstName: 1, lastName: 1 }).skip(skipFor(q)).limit(q.pageSize).lean(),
      this.users.countDocuments(filter),
    ]);
    return new Paginated(await this.toEmployees(list), total, q.page, q.pageSize);
  }

  async get(actor: AuthUser, id: string) {
    const [employee] = await this.toEmployees([await this.findVisible(actor, id)]);
    return employee;
  }

  /* ---------------- Mutations ---------------- */

  async create(actor: AuthUser, dto: CreateUserDto) {
    if (!grantableRoles(actor.role).includes(dto.role)) {
      throw new ForbiddenException("You can't create accounts with this role.");
    }
    await this.validatePlacement(actor.organizationId, dto.departmentId, dto.managerId);
    if (await this.users.exists({ organizationId: oid(actor.organizationId), email: dto.email, deletedAt: null })) {
      throw new ConflictException({ message: 'An account with this email already exists.', details: { email: ['An account with this email already exists.'] } });
    }
    const seq = await nextSequence(this.counters, `${actor.organizationId}:employee`);
    const user = await this.users.create({
      organizationId: oid(actor.organizationId),
      employeeId: `BN-E${seq}`,
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      title: dto.title || null,
      securityRole: dto.role,
      jobFunction: dto.jobFunction,
      departmentId: oid(dto.departmentId),
      managerId: dto.managerId ? oid(dto.managerId) : null,
      status: dto.password ? 'active' : 'invited',
      passwordHash: dto.password ? await hashPassword(dto.password) : null,
      joinedAt: new Date(dto.joinDate),
      createdBy: oid(actor.id),
    });
    await this.syncMembership(user._id, null, user.departmentId);
    // An admin-set password activates the account immediately; otherwise it waits on the invitation.
    const invite = dto.password
      ? { emailSent: false, invitationUrl: null }
      : await this.issueInvitation(user._id, user.email, fullName(user), dto.sendInvitation);
    await this.activity.record({
      actor,
      action: 'user.created',
      entityType: 'user',
      entityId: user._id,
      entityLabel: fullName(user),
      description: `created an account for ${fullName(user)}`,
      changes: { securityRole: dto.role, departmentId: dto.departmentId, emailSent: invite.emailSent, passwordSet: !!dto.password },
    });
    const [employee] = await this.toEmployees([user.toObject()]);
    return { user: employee, ...invite };
  }

  private async issueInvitation(userId: Types.ObjectId, email: string, name: string, send: boolean) {
    const token = await this.tokenService.createOneTime(userId, 'invitation', INVITATION_TTL_MS);
    const invitationUrl = `${this.frontendUrl}/accept-invitation?token=${encodeURIComponent(token)}`;
    let emailSent = false;
    if (send && this.mail.enabled) {
      emailSent = await this.mail.send(
        'invitation',
        email,
        'You have been invited to Bizwoke Nova',
        `Hi ${name},\n\nAn account has been created for you. Activate it within 72 hours:\n${invitationUrl}\n`,
      );
    }
    await this.users.updateOne({ _id: userId }, { invitedAt: new Date() });
    // The raw link is only returned when it wasn't emailed, so the admin can share it.
    return { emailSent, invitationUrl: emailSent ? null : invitationUrl };
  }

  async resendInvitation(actor: AuthUser, id: string) {
    const target = await this.findVisible(actor, id);
    if (!grantableRoles(actor.role).includes(target.securityRole)) throw new ForbiddenException("You can't manage this account.");
    if (target.status !== 'invited') throw new ConflictException('This account is already activated.');
    const invite = await this.issueInvitation(target._id, target.email, fullName(target), true);
    await this.activity.record({ actor, action: 'user.invitation_reissued', entityType: 'user', entityId: target._id, entityLabel: fullName(target), description: `re-issued the invitation for ${fullName(target)}` });
    const [employee] = await this.toEmployees([(await this.users.findById(target._id).lean())!]);
    return { user: employee, ...invite };
  }

  async update(actor: AuthUser, id: string, dto: UpdateUserDto) {
    const target = await this.findVisible(actor, id);
    const changingRole = dto.role !== undefined && dto.role !== target.securityRole;
    if (String(target._id) !== actor.id || changingRole) this.assertCanModify(actor, target);
    if (changingRole && !grantableRoles(actor.role).includes(dto.role!)) {
      throw new ForbiddenException("You can't grant this role.");
    }
    await this.validatePlacement(actor.organizationId, dto.departmentId, dto.managerId, id);

    const update: Partial<User> = {};
    if (dto.firstName !== undefined) update.firstName = dto.firstName;
    if (dto.lastName !== undefined) update.lastName = dto.lastName;
    if (dto.title !== undefined) update.title = dto.title || null;
    if (dto.role !== undefined) update.securityRole = dto.role;
    if (dto.jobFunction !== undefined) update.jobFunction = dto.jobFunction;
    if (dto.departmentId !== undefined) update.departmentId = oid(dto.departmentId);
    if (dto.managerId !== undefined) update.managerId = dto.managerId ? oid(dto.managerId) : null;
    const updated = (await this.users.findByIdAndUpdate(target._id, update, { returnDocument: 'after' }).lean())!;
    if (dto.departmentId !== undefined) await this.syncMembership(target._id, target.departmentId, updated.departmentId);

    await this.activity.record({
      actor,
      action: changingRole ? 'user.role_changed' : 'user.updated',
      entityType: 'user',
      entityId: target._id,
      entityLabel: fullName(updated),
      description: changingRole ? `changed the role of ${fullName(updated)} from ${target.securityRole} to ${dto.role}` : `updated ${fullName(updated)}`,
      changes: { fields: Object.keys(update) },
    });
    const [employee] = await this.toEmployees([updated]);
    return employee;
  }

  async setStatus(actor: AuthUser, id: string, status: 'active' | 'deactivated') {
    const target = await this.findVisible(actor, id);
    this.assertCanModify(actor, target);
    if (status === 'active' && target.status === 'invited') {
      throw new UnprocessableEntityException('Invited users activate their own account from the invitation link.');
    }
    const updated = (await this.users.findByIdAndUpdate(target._id, { status }, { returnDocument: 'after' }).lean())!;
    if (status === 'deactivated') await this.tokenService.revokeAllForUser(target._id);
    await this.activity.record({
      actor,
      action: status === 'active' ? 'user.reactivated' : 'user.deactivated',
      entityType: 'user',
      entityId: target._id,
      entityLabel: fullName(target),
      description: `${status === 'active' ? 'reactivated' : 'deactivated'} ${fullName(target)}`,
    });
    const [employee] = await this.toEmployees([updated]);
    return employee;
  }

  /** Soft delete: deactivates and hides the account, keeping history intact. */
  async remove(actor: AuthUser, id: string) {
    const target = await this.findVisible(actor, id);
    this.assertCanModify(actor, target);
    await this.users.updateOne({ _id: target._id }, { status: 'deactivated', deletedAt: new Date() });
    await this.syncMembership(target._id, target.departmentId, null);
    await this.tokenService.revokeAllForUser(target._id);
    await this.activity.record({ actor, action: 'user.deleted', entityType: 'user', entityId: target._id, entityLabel: fullName(target), description: `removed ${fullName(target)} (soft delete)` });
  }

  async updateProfile(actor: AuthUser, dto: UpdateProfileDto) {
    await this.users.updateOne(
      { _id: oid(actor.id) },
      { firstName: dto.firstName, lastName: dto.lastName, ...(dto.title !== undefined ? { title: dto.title || null } : {}) },
    );
    return this.toCurrentUser(actor.id);
  }
}
