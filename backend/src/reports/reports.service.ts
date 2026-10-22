import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ActivityLogsService } from '../activity-logs/activity-logs.service.js';
import { can, type AuthUser } from '../common/auth-user.js';
import { refOf, RefsService } from '../core/refs.service.js';
import { oid, ScopeService } from '../core/scope.service.js';
import { Task } from '../tasks/task.schema.js';
import { TaskPresenter, type LeanTask } from '../tasks/task.presenter.js';
import { TasksService } from '../tasks/tasks.service.js';
import { CLOSED, parseTaskDate } from '../tasks/task-workflow.js';
import { fullName, User } from '../users/user.schema.js';
import type { ReportQueryDto } from './report-query.dto.js';

const DAY = 24 * 3600 * 1000;
const OPEN = { $nin: CLOSED };
const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Monday 00:00 UTC of the week containing `d`. */
function weekStart(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}
const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly scope: ScopeService,
    private readonly refs: RefsService,
    private readonly tasksService: TasksService,
    private readonly presenter: TaskPresenter,
    private readonly activity: ActivityLogsService,
  ) {}

  /* ---------------- Scope helpers ---------------- */

  private async teamFilter(user: AuthUser) {
    if (!can(user, 'tasks.view_all') && !can(user, 'tasks.view_team')) {
      throw new ForbiddenException("You don't have access to team reports.");
    }
    return this.scope.teamTaskFilter(user);
  }

  private range(q: ReportQueryDto) {
    const to = q.to ? parseTaskDate(q.to, 'end') : new Date();
    const from = q.from ? parseTaskDate(q.from, 'start') : new Date(to.getTime() - 30 * DAY);
    return { from, to };
  }

  /** Tasks active within the window (created before it ends, due after it starts). */
  private async reportFilter(user: AuthUser, q: ReportQueryDto) {
    const { from, to } = this.range(q);
    const team = await this.teamFilter(user);
    const dimensions: Record<string, unknown> = {};
    if (q.departmentId) dimensions.departmentId = oid(q.departmentId);
    if (q.projectId) dimensions.projectId = oid(q.projectId);
    const filter: Record<string, unknown> = {
      ...dimensions,
      $and: [team, { createdAt: { $lte: to } }, { dueDate: { $gte: from } }],
    };
    return { filter, team, dimensions, from, to };
  }

  /** People whose workload a manager (or admin) may see. */
  private async team(user: AuthUser) {
    const base = { organizationId: oid(user.organizationId), status: 'active' as const, deletedAt: null, _id: { $ne: oid(user.id) } };
    if (can(user, 'tasks.view_all')) return this.users.find({ ...base, role: { $in: ['employee', 'manager'] } }).limit(100).lean();
    const depts = await this.scope.authorizedDepartmentIds(user);
    return this.users.find({ ...base, $or: [{ departmentId: { $in: depts } }, { managerId: oid(user.id) }] }).limit(100).lean();
  }

  /* ---------------- Reports ---------------- */

  async taskReport(user: AuthUser, q: ReportQueryDto) {
    const { filter, team, dimensions, from, to } = await this.reportFilter(user, q);
    const now = new Date();
    const [facets] = await this.tasks.aggregate<{
      status: { _id: string; n: number }[];
      totals: { total: number; completed: number; open: number; overdue: number; onTime: number; late: number }[];
      projects: { _id: Types.ObjectId; total: number; completed: number }[];
    }>([
      { $match: filter },
      {
        $facet: {
          status: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
                open: { $sum: { $cond: [{ $in: ['$status', ['completed', 'cancelled']] }, 0, 1] } },
                overdue: {
                  $sum: { $cond: [{ $and: [{ $lt: ['$dueDate', now] }, { $not: [{ $in: ['$status', ['completed', 'cancelled']] }] }] }, 1, 0] },
                },
                onTime: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'completed'] }, { $lte: ['$completedAt', '$dueDate'] }] }, 1, 0] } },
                late: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'completed'] }, { $gt: ['$completedAt', '$dueDate'] }] }, 1, 0] } },
              },
            },
          ],
          projects: [
            { $match: { status: { $ne: 'cancelled' } } },
            { $group: { _id: '$projectId', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } },
          ],
        },
      },
    ]);

    // Productivity: tasks completed inside the window, bucketed by week and month (UTC).
    const completedInWindow = { ...dimensions, $and: [team], status: 'completed', completedAt: { $gte: from, $lte: to } };
    const bucket = (unit: 'week' | 'month') =>
      this.tasks.aggregate<{ _id: Date; completed: number; hours: number }>([
        { $match: completedInWindow },
        {
          $group: {
            _id: { $dateTrunc: { date: '$completedAt', unit, ...(unit === 'week' ? { startOfWeek: 'monday' } : {}), timezone: 'UTC' } },
            completed: { $sum: 1 },
            hours: { $sum: '$actualHours' },
          },
        },
      ]);
    const [weeklyRaw, monthlyRaw] = await Promise.all([bucket('week'), bucket('month')]);
    const weekly: { label: string; completed: number; hours: number }[] = [];
    for (let w = weekStart(from); w <= to && weekly.length < 26; w = new Date(w.getTime() + 7 * DAY)) {
      const hit = weeklyRaw.find((r) => r._id.getTime() === w.getTime());
      weekly.push({ label: shortDate.format(w), completed: hit?.completed ?? 0, hours: Math.round((hit?.hours ?? 0) * 10) / 10 });
    }
    const monthly: { label: string; completed: number; hours: number }[] = [];
    for (let m = monthStart(from); m <= to && monthly.length < 24; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
      const hit = monthlyRaw.find((r) => r._id.getTime() === m.getTime());
      monthly.push({ label: monthLabel.format(m), completed: hit?.completed ?? 0, hours: Math.round((hit?.hours ?? 0) * 10) / 10 });
    }

    const overdueDocs = await this.tasks
      .find({ ...filter, status: OPEN, $and: [...(filter.$and as object[]), { dueDate: { $lt: now } }] })
      .sort({ dueDate: 1 })
      .limit(100)
      .lean();
    const [people, depts, projectNames] = await Promise.all([
      this.refs.userRefs(overdueDocs.flatMap((t) => t.assignedTo)),
      this.refs.departmentNames(overdueDocs.map((t) => t.departmentId)),
      this.refs.projectNames(facets!.projects.map((p) => p._id)),
    ]);
    const totals = facets!.totals[0] ?? { total: 0, completed: 0, open: 0, overdue: 0, onTime: 0, late: 0 };
    const statuses = ['todo', 'in_progress', 'blocked', 'in_review', 'completed', 'cancelled'];

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: { total: totals.total, completed: totals.completed, overdue: totals.overdue, open: totals.open },
      onTime: { onTime: totals.onTime, late: totals.late },
      statusDistribution: statuses.map((s) => ({ status: s, count: facets!.status.find((x) => x._id === s)?.n ?? 0 })),
      productivity: { weekly, monthly },
      projectProgress: facets!.projects.map((p) => ({ projectId: String(p._id), project: projectNames.get(String(p._id)) ?? '', completed: p.completed, total: p.total })),
      overdue: overdueDocs.map((t) => ({
        id: String(t._id),
        key: t.taskCode,
        title: t.title,
        dueDate: t.dueDate,
        priority: t.priority,
        status: t.status,
        assignedTo: t.assignedTo.map((a) => refOf(people, a)),
        departmentName: depts.get(String(t.departmentId)) ?? '',
      })),
    };
  }

  async employeeReport(user: AuthUser, q: ReportQueryDto) {
    const { filter, team, from, to } = await this.reportFilter(user, q);
    const now = new Date();
    const [work, logged] = await Promise.all([
      this.tasks.aggregate<{ _id: Types.ObjectId; open: number; completed: number; overdue: number; estimatedOpenHours: number; onTime: number }>([
        { $match: filter },
        { $unwind: '$assignedTo' },
        {
          $group: {
            _id: '$assignedTo',
            open: { $sum: { $cond: [{ $in: ['$status', ['completed', 'cancelled']] }, 0, 1] } },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            overdue: { $sum: { $cond: [{ $and: [{ $lt: ['$dueDate', now] }, { $not: [{ $in: ['$status', ['completed', 'cancelled']] }] }] }, 1, 0] } },
            estimatedOpenHours: { $sum: { $cond: [{ $in: ['$status', ['completed', 'cancelled']] }, 0, '$estimatedHours'] } },
            onTime: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'completed'] }, { $lte: ['$completedAt', '$dueDate'] }] }, 1, 0] } },
          },
        },
      ]),
      this.tasks.aggregate<{ _id: Types.ObjectId; minutes: number }>([
        { $match: team },
        { $unwind: '$timeEntries' },
        { $match: { 'timeEntries.date': { $gte: from, $lte: to } } },
        { $group: { _id: '$timeEntries.userId', minutes: { $sum: '$timeEntries.minutes' } } },
      ]),
    ]);
    const ids = work.map((w) => w._id);
    const people = await this.users.find({ _id: { $in: ids } }).select('firstName lastName departmentId').lean();
    const depts = await this.refs.departmentNames(people.map((p) => p.departmentId));
    const loggedMap = new Map(logged.map((l) => [String(l._id), l.minutes]));
    return work
      .map((w) => {
        const p = people.find((x) => x._id.equals(w._id));
        return {
          userId: String(w._id),
          name: p ? fullName(p) : 'Unknown user',
          departmentName: p?.departmentId ? (depts.get(String(p.departmentId)) ?? null) : null,
          open: w.open,
          completed: w.completed,
          overdue: w.overdue,
          estimatedOpenHours: Math.round(w.estimatedOpenHours * 10) / 10,
          loggedHours: Math.round(((loggedMap.get(String(w._id)) ?? 0) / 60) * 10) / 10,
          onTimeRate: pct(w.onTime, w.completed),
        };
      })
      .sort((a, b) => b.open - a.open);
  }

  async departmentReport(user: AuthUser, q: ReportQueryDto) {
    const { filter } = await this.reportFilter(user, q);
    const now = new Date();
    const rows = await this.tasks.aggregate<{ _id: Types.ObjectId; total: number; completed: number; overdue: number; onTime: number }>([
      { $match: { ...filter, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$departmentId',
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $and: [{ $lt: ['$dueDate', now] }, { $ne: ['$status', 'completed'] }] }, 1, 0] } },
          onTime: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'completed'] }, { $lte: ['$completedAt', '$dueDate'] }] }, 1, 0] } },
        },
      },
    ]);
    const names = await this.refs.departmentNames(rows.map((r) => r._id));
    return rows
      .map((r) => ({
        departmentId: String(r._id),
        department: names.get(String(r._id)) ?? 'Unknown',
        total: r.total,
        completed: r.completed,
        overdue: r.overdue,
        onTimeRate: pct(r.onTime, r.completed),
      }))
      .sort((a, b) => a.department.localeCompare(b.department));
  }

  /** Flat task rows for the CSV export of the task report. */
  async taskRows(user: AuthUser, q: ReportQueryDto) {
    const { filter } = await this.reportFilter(user, q);
    const list = await this.tasks.find(filter).sort({ dueDate: 1 }).limit(10_000).lean();
    const [people, depts, projects] = await Promise.all([
      this.refs.userRefs(list.flatMap((t) => [...t.assignedTo, t.createdBy])),
      this.refs.departmentNames(list.map((t) => t.departmentId)),
      this.refs.projectNames(list.map((t) => t.projectId)),
    ]);
    const now = Date.now();
    return list.map((t) => ({
      key: t.taskCode,
      title: t.title,
      status: t.status,
      priority: t.priority,
      department: depts.get(String(t.departmentId)) ?? '',
      project: projects.get(String(t.projectId)) ?? '',
      assignedTo: t.assignedTo.map((a) => refOf(people, a).name),
      assignedBy: refOf(people, t.createdBy).name,
      startDate: t.startDate,
      dueDate: t.dueDate,
      estimatedHours: t.estimatedHours,
      actualHours: t.actualHours,
      progressPercentage: t.progressPercentage,
      overdue: t.dueDate.getTime() < now && !['completed', 'cancelled'].includes(t.status),
      completedAt: t.completedAt,
    }));
  }

  /* ---------------- Dashboards ---------------- */

  async workload(user: AuthUser) {
    const team = await this.team(user);
    const counts = await this.tasks.aggregate<{ _id: { u: Types.ObjectId; s: string }; n: number }>([
      { $match: { organizationId: oid(user.organizationId), assignedTo: { $in: team.map((t) => t._id) }, status: { $in: ['todo', 'in_progress', 'in_review', 'blocked'] } } },
      { $unwind: '$assignedTo' },
      { $group: { _id: { u: '$assignedTo', s: '$status' }, n: { $sum: 1 } } },
    ]);
    const n = (id: Types.ObjectId, s: string) => counts.find((c) => c._id.u.equals(id) && c._id.s === s)?.n ?? 0;
    return team.map((m) => ({
      member: { id: String(m._id), name: fullName(m), email: m.email, avatarUrl: null },
      todo: n(m._id, 'todo'),
      inProgress: n(m._id, 'in_progress'),
      inReview: n(m._id, 'in_review'),
      blocked: n(m._id, 'blocked'),
    }));
  }

  async teamPerformance(user: AuthUser) {
    const team = await this.team(user);
    const now = new Date();
    const stats = await this.tasks.aggregate<{ _id: Types.ObjectId; completed: number; overdue: number; onTime: number }>([
      { $match: { organizationId: oid(user.organizationId), assignedTo: { $in: team.map((t) => t._id) } } },
      { $unwind: '$assignedTo' },
      {
        $group: {
          _id: '$assignedTo',
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $and: [{ $lt: ['$dueDate', now] }, { $not: [{ $in: ['$status', ['completed', 'cancelled']] }] }] }, 1, 0] } },
          onTime: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'completed'] }, { $lte: ['$completedAt', '$dueDate'] }] }, 1, 0] } },
        },
      },
    ]);
    return team.map((m) => {
      const s = stats.find((x) => x._id.equals(m._id));
      return {
        member: { id: String(m._id), name: fullName(m), email: m.email, avatarUrl: null },
        completed: s?.completed ?? 0,
        overdue: s?.overdue ?? 0,
        onTimeRate: pct(s?.onTime ?? 0, s?.completed ?? 0),
      };
    });
  }

  async summary(user: AuthUser) {
    const ctx = await this.tasksService.context(user);
    const now = new Date();
    const org = oid(user.organizationId);
    const overdueCond = { dueDate: { $lt: now }, status: OPEN };

    if (can(user, 'dashboard.admin')) {
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 13 * DAY);
      const [totalEmployees, activeTasks, completedTasks, overdueTasks, perDept, created, completed, recent, attention] = await Promise.all([
        this.users.countDocuments({ organizationId: org, deletedAt: null, status: { $ne: 'deactivated' } }),
        this.tasks.countDocuments({ organizationId: org, archivedAt: null, status: OPEN }),
        this.tasks.countDocuments({ organizationId: org, archivedAt: null, status: 'completed' }),
        this.tasks.countDocuments({ organizationId: org, archivedAt: null, ...overdueCond }),
        this.departmentReport(user, { from: '1970-01-01', to: now.toISOString() } as ReportQueryDto),
        this.tasks.aggregate<{ _id: string; n: number }>([
          { $match: { organizationId: org, archivedAt: null, createdAt: { $gte: since } } },
          { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: 'UTC' } }, n: { $sum: 1 } } },
        ]),
        this.tasks.aggregate<{ _id: string; n: number }>([
          { $match: { organizationId: org, archivedAt: null, status: 'completed', completedAt: { $gte: since } } },
          { $group: { _id: { $dateToString: { date: '$completedAt', format: '%Y-%m-%d', timezone: 'UTC' } }, n: { $sum: 1 } } },
        ]),
        this.activity.list(user, { page: 1, pageSize: 8 }),
        this.tasks.aggregate<{ _id: Types.ObjectId; overdue: number; blocked: number }>([
          { $match: { organizationId: org, archivedAt: null, status: OPEN, $or: [{ dueDate: { $lt: now } }, { status: 'blocked' }] } },
          { $unwind: '$assignedTo' },
          {
            $group: {
              _id: '$assignedTo',
              overdue: { $sum: { $cond: [{ $lt: ['$dueDate', now] }, 1, 0] } },
              blocked: { $sum: { $cond: [{ $eq: ['$status', 'blocked'] }, 1, 0] } },
            },
          },
          { $addFields: { score: { $add: [{ $multiply: ['$overdue', 2] }, '$blocked'] } } },
          { $sort: { score: -1 } },
          { $limit: 6 },
        ]),
      ]);
      const deptActive = await this.tasks.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { organizationId: org, archivedAt: null, status: OPEN } },
        { $group: { _id: '$departmentId', n: { $sum: 1 } } },
      ]);
      const attentionUsers = await this.users.find({ _id: { $in: attention.map((a) => a._id) } }).select('firstName lastName email departmentId').lean();
      const attentionDepts = await this.refs.departmentNames(attentionUsers.map((u) => u.departmentId));
      const days = Array.from({ length: 14 }, (_, i) => new Date(since.getTime() + i * DAY).toISOString().slice(0, 10));
      return {
        role: 'admin' as const,
        stats: { totalEmployees, activeTasks, completedTasks, overdueTasks },
        departmentPerformance: perDept.map((d) => ({
          departmentId: d.departmentId,
          department: d.department,
          completed: d.completed,
          active: deptActive.find((x) => String(x._id) === d.departmentId)?.n ?? 0,
          overdue: d.overdue,
          onTimeRate: d.onTimeRate,
        })),
        completionTrend: days.map((date) => ({
          date,
          created: created.find((c) => c._id === date)?.n ?? 0,
          completed: completed.find((c) => c._id === date)?.n ?? 0,
        })),
        recentActivity: recent.items,
        attentionEmployees: attention.flatMap((a) => {
          const u = attentionUsers.find((x) => x._id.equals(a._id));
          if (!u) return [];
          return [{
            employee: { id: String(u._id), name: fullName(u), email: u.email, avatarUrl: null, departmentName: u.departmentId ? (attentionDepts.get(String(u.departmentId)) ?? null) : null },
            overdueCount: a.overdue,
            blockedCount: a.blocked,
          }];
        }),
      };
    }

    if (can(user, 'dashboard.manager')) {
      const scope = await this.scope.teamTaskFilter(user);
      const soon = new Date(now.getTime() + ctx.settings.dueSoonThresholdDays * DAY);
      const [assignedByMe, overdue, atRisk, pendingReviews, riskDocs, reviewDocs] = await Promise.all([
        this.tasks.countDocuments({ organizationId: org, archivedAt: null, createdBy: oid(user.id), status: OPEN }),
        this.tasks.countDocuments({ $and: [scope, overdueCond] }),
        this.tasks.countDocuments({ $and: [scope, { status: OPEN }, { $or: [{ status: 'blocked' }, { dueDate: { $gte: now, $lte: soon } }] }] }),
        this.tasks.countDocuments({ $and: [scope, { status: 'in_review' }] }),
        this.tasks.find({ $and: [scope, { status: OPEN }, { $or: [{ status: 'blocked' }, { dueDate: { $lte: soon } }] }] }).sort({ dueDate: 1 }).limit(8).lean(),
        this.tasks.find({ $and: [scope, { status: 'in_review' }] }).sort({ dueDate: 1 }).limit(6).lean(),
      ]);
      let departmentProgress = null;
      if (user.departmentId) {
        const deptRows = await this.tasks.aggregate<{ _id: Types.ObjectId; total: number; completed: number }>([
          { $match: { organizationId: org, archivedAt: null, departmentId: oid(user.departmentId), status: { $ne: 'cancelled' } } },
          { $group: { _id: '$projectId', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } },
        ]);
        const [names, deptNames] = await Promise.all([this.refs.projectNames(deptRows.map((r) => r._id)), this.refs.departmentNames([user.departmentId])]);
        departmentProgress = {
          department: deptNames.get(user.departmentId) ?? '',
          completed: deptRows.reduce((s, r) => s + r.completed, 0),
          total: deptRows.reduce((s, r) => s + r.total, 0),
          projects: deptRows.map((r) => ({ projectId: String(r._id), project: names.get(String(r._id)) ?? '', completed: r.completed, total: r.total })),
        };
      }
      return {
        role: 'manager' as const,
        stats: { assignedByMe, overdue, atRisk, pendingReviews },
        riskTasks: await this.presenter.many(riskDocs as LeanTask[], ctx),
        departmentProgress,
        pendingReviews: await this.presenter.many(reviewDocs as LeanTask[], ctx),
      };
    }

    const mine = { organizationId: org, archivedAt: null, $or: [{ assignedTo: oid(user.id) }, { sharedWith: oid(user.id) }] };
    const [byStatus, overdue, upcoming, productivity] = await Promise.all([
      this.tasks.aggregate<{ _id: string; n: number }>([{ $match: mine }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      this.tasks.countDocuments({ ...mine, ...overdueCond }),
      this.tasks.find({ ...mine, status: OPEN }).sort({ dueDate: 1 }).limit(6).lean(),
      this.tasks.aggregate<{ _id: Date; completed: number; hours: number }>([
        { $match: { ...mine, status: 'completed', completedAt: { $gte: new Date(weekStart(now).getTime() - 7 * 7 * DAY) } } },
        { $group: { _id: { $dateTrunc: { date: '$completedAt', unit: 'week', startOfWeek: 'monday', timezone: 'UTC' } }, completed: { $sum: 1 }, hours: { $sum: '$actualHours' } } },
      ]),
    ]);
    const n = (s: string) => byStatus.find((b) => b._id === s)?.n ?? 0;
    return {
      role: 'employee' as const,
      stats: {
        total: byStatus.reduce((s, b) => s + b.n, 0),
        todo: n('todo'),
        inProgress: n('in_progress'),
        inReview: n('in_review'),
        completed: n('completed'),
        overdue,
      },
      upcoming: await this.presenter.many(upcoming as LeanTask[], ctx),
      productivity: Array.from({ length: 8 }, (_, i) => {
        const w = new Date(weekStart(now).getTime() - (7 - i) * 7 * DAY);
        const hit = productivity.find((p) => p._id.getTime() === w.getTime());
        return { label: shortDate.format(w), completed: hit?.completed ?? 0, hours: Math.round((hit?.hours ?? 0) * 10) / 10 };
      }),
    };
  }
}
