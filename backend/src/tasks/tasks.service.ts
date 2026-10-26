import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type PipelineStage } from 'mongoose';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';
import { CommentsService } from '../comments/comments.module.js';
import { can, type AuthUser } from '../common/auth-user.js';
import { Counter, nextSequence } from '../common/counter.schema.js';
import { escapeRegex, Paginated, skipFor } from '../common/pagination.js';
import { OrgReferencesService } from '../core/org-references.service.js';
import { oid, ScopeService } from '../core/scope.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Project } from '../projects/project.schema.js';
import { Organization, OrganizationSettings } from '../settings/organization.schema.js';
import { fullName, User } from '../users/user.schema.js';
import type {
  AssignDto,
  AttachmentDto,
  CreateTaskDto,
  TaskQueryDto,
  TimeEntryDto,
  UpdateTaskDto,
} from './dto.js';
import { TaskContext } from './task-access.js';
import { TaskPresenter, type LeanTask } from './task.presenter.js';
import { Task, TASK_PRIORITIES, TASK_STATUSES, type TaskDocument, type TaskStatus } from './task.schema.js';
import { CLOSED, isValidProgress, parseTaskDate, progressFor } from './task-workflow.js';

const LABEL: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  in_review: 'In Review',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const DEFAULT_SETTINGS: OrganizationSettings = { dueSoonThresholdDays: 2, reviewRequired: true };

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Project.name) private readonly projects: Model<Project>,
    @InjectModel(Organization.name) private readonly orgs: Model<Organization>,
    @InjectModel(Counter.name) private readonly counters: Model<Counter>,
    private readonly scope: ScopeService,
    private readonly references: OrgReferencesService,
    private readonly presenter: TaskPresenter,
    private readonly comments: CommentsService,
    private readonly activity: ActivityLogsService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ---------------- Context & loading ---------------- */

  async context(user: AuthUser): Promise<TaskContext> {
    const [departments, org] = await Promise.all([
      this.scope.isOrgWide(user)
        ? Promise.resolve(null)
        : can(user, 'tasks.view_team')
          ? this.scope.authorizedDepartmentIds(user)
          : Promise.resolve([]),
      this.orgs.findById(user.organizationId).select('settings').lean(),
    ]);
    return new TaskContext(user, departments, {
      dueSoonThresholdDays: org?.settings?.dueSoonThresholdDays ?? DEFAULT_SETTINGS.dueSoonThresholdDays,
      reviewRequired: org?.settings?.reviewRequired ?? DEFAULT_SETTINGS.reviewRequired,
    });
  }

  /** Loads a task the user can see. Invisible tasks are reported as not found. */
  private async load(user: AuthUser, id: string) {
    const ctx = await this.context(user);
    const task = await this.tasks.findOne({ _id: oid(id), organizationId: oid(user.organizationId) });
    if (!task || !ctx.canView(task)) throw new NotFoundException('Task not found.');
    return { task, ctx };
  }

  private async respond(task: TaskDocument, ctx: TaskContext) {
    return this.presenter.detail(task.toObject() as LeanTask, ctx);
  }

  private async log(user: AuthUser, task: TaskDocument | LeanTask, action: string, description: string, changes?: Record<string, unknown>) {
    await this.activity.record({ actor: user, action, entityType: 'task', entityId: task._id, entityLabel: task.taskCode, description, changes });
  }

  /* ---------------- Assignment validation ---------------- */

  /**
   * Assignees must be active members of the organisation, belong to the
   * task's department or project team, and (unless the actor is org-wide)
   * sit within the actor's authorised departments.
   */
  private async validateAssignees(ctx: TaskContext, ids: string[], departmentId: Types.ObjectId, projectId: Types.ObjectId) {
    if (!can(ctx.user, 'tasks.assign')) throw new ForbiddenException("You don't have permission to assign tasks.");
    const unique = [...new Set(ids)];
    const [people, project] = await Promise.all([
      this.users
        .find({ _id: { $in: unique.map(oid) }, organizationId: oid(ctx.user.organizationId), status: 'active', deletedAt: null })
        .select('departmentId firstName lastName')
        .lean(),
      this.projects.findById(projectId).select('memberIds').lean(),
    ]);
    if (people.length !== unique.length) {
      throw new UnprocessableEntityException({
        message: 'One or more assignees are inactive or not part of your organisation.',
        details: { assigneeIds: ['Only active employees can be assigned.'] },
      });
    }
    if (ctx.departments !== null) {
      const outside = people.filter((p) => !p.departmentId || !ctx.departments!.some((d) => d.equals(p.departmentId!)));
      if (outside.length) throw new ForbiddenException('You can only assign tasks to employees in your teams.');
    }
    const members = new Set((project?.memberIds ?? []).map(String));
    const notMember = people.filter((p) => !p.departmentId?.equals(departmentId) && !members.has(String(p._id)));
    if (notMember.length) {
      throw new UnprocessableEntityException({
        message: `${notMember.map(fullName).join(', ')} ${notMember.length > 1 ? 'are' : 'is'} not in this task's department or project team.`,
        details: { assigneeIds: ['Assignees must belong to the task department or project team.'] },
      });
    }
    return unique.map(oid);
  }

  private async assertDepartmentAllowed(ctx: TaskContext, departmentId: Types.ObjectId) {
    if (ctx.departments !== null && !ctx.departments.some((d) => d.equals(departmentId))) {
      throw new ForbiddenException('You can only manage tasks for departments you are authorised for.');
    }
  }

  /** Project and department must be active and belong to the caller's organisation. */
  private async assertProject(orgId: string, projectId: string) {
    return (await this.references.project(orgId, projectId))._id;
  }

  /* ---------------- Queries ---------------- */

  async list(user: AuthUser, q: TaskQueryDto) {
    const ctx = await this.context(user);
    const org = oid(user.organizationId);
    const and: Record<string, unknown>[] = [];

    if (q.scope === 'all') {
      if (!can(user, 'tasks.view_all') && !can(user, 'tasks.view_team')) {
        throw new ForbiddenException("You don't have access to organisation tasks.");
      }
      if (ctx.departments !== null) {
        and.push({ $or: [{ departmentId: { $in: ctx.departments } }, { createdBy: oid(user.id) }] });
      }
    } else {
      and.push({ $or: [{ assignedTo: oid(user.id) }, { sharedWith: oid(user.id) }] });
    }

    const match: Record<string, unknown> = { organizationId: org, archivedAt: null };
    if (q.status?.length) match.status = { $in: q.status };
    if (q.priority?.length) match.priority = { $in: q.priority };
    if (q.departmentId) match.departmentId = oid(q.departmentId);
    if (q.projectId) match.projectId = oid(q.projectId);
    if (q.assigneeId) match.assignedTo = oid(q.assigneeId);
    if (q.tag) match.tags = q.tag.toLowerCase();
    const due: Record<string, Date> = {};
    if (q.dueFrom) due.$gte = parseTaskDate(q.dueFrom, 'start');
    if (q.dueTo) due.$lte = parseTaskDate(q.dueTo, 'end');
    if (q.overdue) {
      due.$lt = new Date();
      and.push({ status: { $nin: CLOSED } });
    }
    if (Object.keys(due).length) match.dueDate = due;
    if (q.search) {
      const re = new RegExp(escapeRegex(q.search), 'i');
      const people = await this.users
        .find({ organizationId: org, $or: [{ firstName: re }, { lastName: re }] })
        .select('_id')
        .limit(50)
        .lean();
      and.push({ $or: [{ title: re }, { taskCode: re }, { assignedTo: { $in: people.map((p) => p._id) } }] });
    }
    if (and.length) match.$and = and;

    const dir = q.order === 'desc' ? -1 : 1;
    const sortStage: Record<string, 1 | -1> =
      q.sort === 'priority' ? { _priority: dir, dueDate: 1 } :
      q.sort === 'status' ? { _status: dir, dueDate: 1 } :
      q.sort === 'key' ? { createdAt: dir } :
      { [q.sort]: dir };

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $addFields: {
          _priority: { $indexOfArray: [TASK_PRIORITIES as unknown as string[], '$priority'] },
          _status: { $indexOfArray: [TASK_STATUSES as unknown as string[], '$status'] },
        },
      },
      { $sort: { ...sortStage, _id: 1 } },
      {
        $facet: {
          items: [{ $skip: skipFor(q) }, { $limit: q.pageSize }, { $project: { _priority: 0, _status: 0 } }],
          total: [{ $count: 'n' }],
        },
      },
    ];
    const [result] = await this.tasks.aggregate<{ items: LeanTask[]; total: { n: number }[] }>(pipeline);
    const items = await this.presenter.many(result?.items ?? [], ctx);
    return new Paginated(items, result?.total[0]?.n ?? 0, q.page, q.pageSize);
  }

  async get(user: AuthUser, id: string) {
    const { task, ctx } = await this.load(user, id);
    return this.respond(task, ctx);
  }

  async activityFor(user: AuthUser, id: string) {
    const { task } = await this.load(user, id);
    return this.activity.forEntity(user.organizationId, 'task', String(task._id));
  }

  async assignableUsers(user: AuthUser) {
    if (!can(user, 'tasks.assign')) return [];
    const ctx = await this.context(user);
    const filter: Record<string, unknown> = { organizationId: oid(user.organizationId), status: 'active', deletedAt: null };
    if (ctx.departments !== null) filter.departmentId = { $in: ctx.departments };
    const list = await this.users.find(filter).select('firstName lastName email departmentId').sort({ firstName: 1 }).limit(500).lean();
    return list.map((u) => ({
      id: String(u._id),
      name: fullName(u),
      email: u.email,
      avatarUrl: null,
      departmentId: u.departmentId ? String(u.departmentId) : null,
    }));
  }

  /* ---------------- Mutations ---------------- */

  async create(user: AuthUser, dto: CreateTaskDto) {
    const ctx = await this.context(user);
    const departmentId = (await this.references.department(user.organizationId, dto.departmentId))._id;
    await this.assertDepartmentAllowed(ctx, departmentId);
    const projectId = await this.assertProject(user.organizationId, dto.projectId);
    const startDate = parseTaskDate(dto.startDate, 'start');
    const dueDate = parseTaskDate(dto.dueDate, 'end');
    if (dueDate < startDate) {
      throw new UnprocessableEntityException({ message: 'Due date must be on or after the start date.', details: { dueDate: ['Due date must be on or after the start date.'] } });
    }
    const assignedTo = await this.validateAssignees(ctx, dto.assigneeIds, departmentId, projectId);
    const seq = await nextSequence(this.counters, `${user.organizationId}:task`);

    const task = await this.tasks.create({
      organizationId: oid(user.organizationId),
      taskCode: `BN-${seq}`,
      title: dto.title,
      description: dto.description ?? '',
      projectId,
      departmentId,
      createdBy: oid(user.id),
      assignedTo,
      assignedBy: oid(user.id),
      reviewRequired: ctx.settings.reviewRequired,
      priority: dto.priority,
      status: 'todo',
      tags: dto.tags ?? [],
      startDate,
      dueDate,
      estimatedHours: dto.estimatedHours,
      checklist: (dto.checklist ?? []).map((c) => ({ label: c.label, done: false })),
    });

    await this.log(user, task, 'task.created', `created ${task.taskCode}`, { assignedTo: assignedTo.map(String), priority: task.priority });
    await this.notifications.notify({
      organizationId: user.organizationId,
      recipients: assignedTo,
      actorId: user.id,
      type: 'task_assigned',
      title: 'New task assigned',
      message: `${user.name} assigned you ${task.taskCode}: ${task.title}`,
      entity: { type: 'task', id: task._id },
    });
    return this.respond(task, ctx);
  }

  async update(user: AuthUser, id: string, dto: UpdateTaskDto) {
    const { task, ctx } = await this.load(user, id);
    if (!ctx.canEdit(task)) throw new ForbiddenException("You can't edit this task.");
    if (dto.departmentId) {
      await this.assertDepartmentAllowed(ctx, oid(dto.departmentId));
      task.departmentId = oid(dto.departmentId);
    }
    if (dto.projectId) task.projectId = await this.assertProject(user.organizationId, dto.projectId);
    if (dto.title !== undefined) task.title = dto.title;
    if (dto.description !== undefined) task.description = dto.description;
    if (dto.priority !== undefined) task.priority = dto.priority;
    if (dto.tags !== undefined) task.tags = dto.tags;
    if (dto.estimatedHours !== undefined) task.estimatedHours = dto.estimatedHours;
    if (dto.startDate) task.startDate = parseTaskDate(dto.startDate, 'start');
    if (dto.dueDate) task.dueDate = parseTaskDate(dto.dueDate, 'end');
    if (task.dueDate < task.startDate) {
      throw new UnprocessableEntityException({ message: 'Due date must be on or after the start date.', details: { dueDate: ['Due date must be on or after the start date.'] } });
    }
    const changed = task.modifiedPaths();
    await task.save();
    await this.log(user, task, 'task.updated', `updated ${task.taskCode}`, { fields: changed });
    return this.respond(task, ctx);
  }

  async assign(user: AuthUser, id: string, dto: AssignDto) {
    const { task, ctx } = await this.load(user, id);
    if (!ctx.capabilities(task).canReassign) throw new ForbiddenException("You can't reassign this task.");
    const next = await this.validateAssignees(ctx, dto.assigneeIds, task.departmentId, task.projectId);
    const before = task.assignedTo.map(String);
    task.assignedTo = next;
    task.assignedBy = oid(user.id);
    await task.save();
    const added = next.filter((n) => !before.includes(String(n)));
    await this.log(user, task, 'task.reassigned', `reassigned ${task.taskCode}`, { from: before, to: next.map(String) });
    await this.notifications.notify({
      organizationId: user.organizationId,
      recipients: added,
      actorId: user.id,
      type: 'task_reassigned',
      title: 'Task assigned to you',
      message: `${user.name} assigned you ${task.taskCode}: ${task.title}`,
      entity: { type: 'task', id: task._id },
    });
    return this.respond(task, ctx);
  }

  async updateStatus(user: AuthUser, id: string, status: TaskStatus, reason?: string) {
    const { task, ctx } = await this.load(user, id);
    if (status === 'in_review') {
      throw new UnprocessableEntityException('Use "submit for review" to send a task for review.');
    }
    const caps = ctx.capabilities(task);
    if (!caps.allowedStatuses.includes(status)) {
      if (!caps.canChangeStatus) throw new ForbiddenException("You can't change the status of this task.");
      throw new UnprocessableEntityException(
        status === 'completed' && task.reviewRequired
          ? 'Tasks must be submitted for review and approved before they are completed.'
          : `Moving a task from ${LABEL[task.status]} to ${LABEL[status]} isn't allowed.`,
      );
    }
    const from = task.status;
    task.status = status;
    if (status === 'completed') {
      task.progressPercentage = progressFor('completed', task.progressPercentage);
      task.completedAt = new Date();
    } else if (CLOSED.includes(from)) {
      task.completedAt = null;
    }
    await task.save();
    await this.log(user, task, 'task.status_changed', `moved ${task.taskCode} from ${LABEL[from]} to ${LABEL[status]}`, { from, to: status, reason });
    return this.respond(task, ctx);
  }

  async updateProgress(user: AuthUser, id: string, value: number) {
    const { task, ctx } = await this.load(user, id);
    if (!ctx.capabilities(task).canUpdateProgress) throw new ForbiddenException("You can't update progress on this task.");
    if (!isValidProgress(value)) throw new UnprocessableEntityException('Progress must be a whole number between 0 and 100.');
    const from = task.progressPercentage;
    task.progressPercentage = value;
    if (task.status === 'todo' && value > 0) task.status = 'in_progress';
    await task.save();
    await this.log(user, task, 'task.progress_updated', `updated progress on ${task.taskCode} to ${value}%`, { from, to: value });
    return this.respond(task, ctx);
  }

  async logTime(user: AuthUser, id: string, dto: TimeEntryDto) {
    const { task, ctx } = await this.load(user, id);
    if (!ctx.capabilities(task).canLogTime) throw new ForbiddenException("You can't log time on this task.");
    const date = parseTaskDate(dto.date, 'start');
    if (date.getTime() > Date.now() + 24 * 3600 * 1000) throw new UnprocessableEntityException("Time can't be logged for a future date.");
    task.timeEntries.push({ userId: oid(user.id), minutes: dto.minutes, note: dto.note || null, date } as never);
    const total = task.timeEntries.reduce((s, e) => s + e.minutes, 0);
    task.actualHours = Math.round((total / 60) * 10) / 10;
    await task.save();
    await this.log(user, task, 'task.time_logged', `logged ${dto.minutes} minutes on ${task.taskCode}`, { minutes: dto.minutes });
    return this.respond(task, ctx);
  }

  async addComment(user: AuthUser, id: string, body: string) {
    const { task, ctx } = await this.load(user, id);
    await this.comments.create(user, task, body);
    task.commentCount += 1;
    await task.save();
    await this.log(user, task, 'task.comment_added', `commented on ${task.taskCode}`);
    return this.respond(task, ctx);
  }

  async addAttachment(user: AuthUser, id: string, dto: AttachmentDto) {
    const { task, ctx } = await this.load(user, id);
    if (!ctx.capabilities(task).canAttach) throw new ForbiddenException('Attachments are disabled for this task.');
    if (task.attachments.length >= 50) throw new UnprocessableEntityException('A task can have at most 50 attachments.');
    task.attachments.push({ fileName: dto.fileName, url: dto.url, sizeBytes: dto.sizeBytes ?? null, contentType: dto.contentType ?? null, uploadedBy: oid(user.id) } as never);
    await task.save();
    await this.log(user, task, 'task.attachment_added', `attached ${dto.fileName} to ${task.taskCode}`);
    return this.respond(task, ctx);
  }

  async addChecklistItem(user: AuthUser, id: string, label: string) {
    const { task, ctx } = await this.load(user, id);
    if (!ctx.capabilities(task).canEditChecklist) throw new ForbiddenException("You can't edit this checklist.");
    if (task.checklist.length >= 50) throw new UnprocessableEntityException('A checklist can have at most 50 items.');
    task.checklist.push({ label, done: false } as never);
    await task.save();
    return this.respond(task, ctx);
  }

  async toggleChecklistItem(user: AuthUser, id: string, itemId: string, done: boolean) {
    const { task, ctx } = await this.load(user, id);
    if (!ctx.capabilities(task).canEditChecklist) throw new ForbiddenException("You can't edit this checklist.");
    const item = task.checklist.find((c) => String(c._id) === itemId);
    if (!item) throw new NotFoundException('Checklist item not found.');
    item.done = done;
    await task.save();
    return this.respond(task, ctx);
  }

  async submitForReview(user: AuthUser, id: string, note?: string) {
    const { task, ctx } = await this.load(user, id);
    if (!task.reviewRequired) {
      throw new UnprocessableEntityException("Reviews aren't required in this organisation — mark the task completed instead.");
    }
    if (!ctx.capabilities(task).canSubmitForReview) {
      throw new UnprocessableEntityException("This task can't be submitted for review right now.");
    }
    const from = task.status;
    task.status = 'in_review';
    task.progressPercentage = 100;
    task.review = { state: 'pending', submittedBy: oid(user.id), submittedAt: new Date(), submissionNote: note || null, reviewerId: null, reviewedAt: null, reviewNote: null };
    await task.save();
    await this.log(user, task, 'task.review_submitted', `submitted ${task.taskCode} for review`, { from, to: 'in_review' });
    await this.notifications.notify({
      organizationId: user.organizationId,
      recipients: [task.createdBy],
      actorId: user.id,
      type: 'review_requested',
      title: 'Review requested',
      message: `${user.name} submitted ${task.taskCode} for review`,
      entity: { type: 'task', id: task._id },
    });
    return this.respond(task, ctx);
  }

  async review(user: AuthUser, id: string, decision: 'approve' | 'request_changes', note?: string) {
    const { task, ctx } = await this.load(user, id);
    if (!ctx.capabilities(task).canReview) {
      if (task.status !== 'in_review') throw new UnprocessableEntityException('Only tasks in review can be approved or sent back.');
      throw new ForbiddenException("You can't review this task.");
    }
    const approve = decision === 'approve';
    const next: TaskStatus = approve ? 'completed' : 'in_progress';
    task.status = next;
    task.progressPercentage = progressFor(next, task.progressPercentage);
    task.completedAt = approve ? new Date() : null;
    task.review = {
      state: approve ? 'approved' : 'changes_requested',
      submittedBy: task.review?.submittedBy ?? task.assignedTo[0]!,
      submittedAt: task.review?.submittedAt ?? new Date(),
      submissionNote: task.review?.submissionNote ?? null,
      reviewerId: oid(user.id),
      reviewedAt: new Date(),
      reviewNote: note || null,
    };
    await task.save();
    await this.log(
      user,
      task,
      approve ? 'task.approved' : 'task.changes_requested',
      approve ? `approved ${task.taskCode}` : `requested changes on ${task.taskCode}`,
      { from: 'in_review', to: next },
    );
    await this.notifications.notify({
      organizationId: user.organizationId,
      recipients: task.assignedTo,
      actorId: user.id,
      type: approve ? 'review_approved' : 'changes_requested',
      title: approve ? 'Task approved' : 'Changes requested',
      message: approve ? `${user.name} approved ${task.taskCode}` : `${user.name} requested changes on ${task.taskCode}: ${note ?? ''}`.trim(),
      entity: { type: 'task', id: task._id },
    });
    return this.respond(task, ctx);
  }
}
