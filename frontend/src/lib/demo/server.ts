/**
 * DEVELOPMENT-ONLY in-browser mock of the Bizwoke Nova REST API (/api/v1).
 *
 * It mirrors the real backend contract — response envelopes, refresh-token
 * rotation, permission checks, data scoping and workflow rules — so the UI
 * can be built without a server. Only reachable under `next dev` with
 * NEXT_PUBLIC_DEMO_MODE=true.
 */
import {
  addDays,
  differenceInCalendarDays,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subWeeks,
} from "date-fns";
import type {
  ActivityEntity,
  CurrentUser,
  DashboardData,
  Employee,
  EmployeeInput,
  EmployeeUpdateInput,
  NotificationPreferences,
  NotificationType,
  Permission,
  Project,
  Role,
  Task,
  TaskCapabilities,
  TaskDetail,
  TaskInput,
  TaskPriority,
  TaskReport,
  TaskStatus,
} from "@/lib/types";
import { STATUS_ORDER, isClosed, priorityMeta, statusMeta } from "@/lib/task-meta";
import { grantableRoles } from "@/lib/roles";
import {
  activity,
  departments,
  organization,
  preferencesByUser,
  projects,
  seedNotifications,
  taskExtras,
  tasks,
  toRef,
  users,
  type DemoUser,
  type StoredTask,
} from "@/lib/demo/data";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    "dashboard.admin", "tasks.view_all", "tasks.view_team", "tasks.create", "tasks.assign",
    "tasks.review", "tasks.delete", "projects.view", "projects.manage", "departments.view",
    "departments.manage", "employees.view", "employees.manage", "employees.grant_privileged",
    "reports.view", "reports.export", "activity.view", "settings.org",
  ],
  admin: [
    "dashboard.admin", "tasks.view_all", "tasks.view_team", "tasks.create", "tasks.assign",
    "tasks.review", "tasks.delete", "projects.view", "projects.manage", "departments.view",
    "departments.manage", "employees.view", "employees.manage", "employees.grant_privileged",
    "reports.view", "reports.export", "activity.view", "settings.org",
  ],
  hr_manager: ["employees.view", "employees.manage", "departments.view", "projects.view", "activity.view"],
  manager: [
    "dashboard.manager", "tasks.view_team", "tasks.create", "tasks.assign", "tasks.review",
    "projects.view", "departments.view", "employees.view", "reports.view", "reports.export",
    "activity.view",
  ],
  employee: ["projects.view"],
};

const ACCESS_MS = 15 * 60 * 1000;
const REFRESH_KEY = "bn.demo.refresh"; // stands in for the HttpOnly cookie
const now = () => new Date();
const nowIso = () => now().toISOString();
let idSeq = 1;
const newId = (prefix: string) => `${prefix}_new${idSeq++}`;

class HttpError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, string[]>) {
    super(message);
  }
}

function respond(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
const ok = (data: unknown, status = 200) => respond(status, { data });
const noContent = () => respond(204);

const isAdmin = (u: DemoUser) => u.role === "admin" || u.role === "super_admin";
const can = (u: DemoUser, p: Permission) => ROLE_PERMISSIONS[u.role].includes(p);
function requirePerm(u: DemoUser, p: Permission) {
  if (!can(u, p)) throw new HttpError(403, "You don't have permission to perform this action.");
}

function toCurrentUser(u: DemoUser): CurrentUser {
  return {
    id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl ?? null,
    employeeId: u.employeeId, role: u.role, jobFunction: u.jobFunction, title: u.title,
    departmentId: u.departmentId, departmentName: u.departmentName,
    organizationName: organization.name, permissions: ROLE_PERMISSIONS[u.role],
  };
}

function issueSession(user: DemoUser) {
  const expires = Date.now() + ACCESS_MS;
  try {
    sessionStorage.setItem(REFRESH_KEY, JSON.stringify({ userId: user.id, rotation: crypto.randomUUID() }));
  } catch {
    /* ignore */
  }
  return { accessToken: `demo.${user.id}.${expires}`, expiresAt: new Date(expires).toISOString(), user: toCurrentUser(user) };
}

function authenticate(init: RequestInit): DemoUser {
  const header = (init.headers as Record<string, string> | undefined)?.Authorization ?? "";
  const match = /^Bearer demo\.(usr_\d+)\.(\d+)$/.exec(header);
  if (!match || Number(match[2]) < Date.now()) throw new HttpError(401, "Not authenticated.");
  const user = users.find((u) => u.id === match[1]);
  if (!user || user.status !== "active") throw new HttpError(401, "Not authenticated.");
  return user;
}

/* ---------------- Task scoping & workflow ---------------- */

const isAssignee = (u: DemoUser, t: StoredTask) => t.assignedTo.some((a) => a.id === u.id);
const isMine = (u: DemoUser, t: StoredTask) => isAssignee(u, t) || t.sharedWith.some((s) => s.id === u.id);
const inTeamScope = (u: DemoUser, t: StoredTask) =>
  can(u, "tasks.view_all") || (can(u, "tasks.view_team") && (t.departmentId === u.departmentId || t.createdBy.id === u.id));
const canSee = (u: DemoUser, t: StoredTask) => isMine(u, t) || inTeamScope(u, t);
const isTaskManager = (u: DemoUser, t: StoredTask) => can(u, "tasks.review") && inTeamScope(u, t);

const overdue = (t: StoredTask) => !isClosed(t.status) && isBefore(parseISO(t.dueDate), now());
const dueSoon = (t: StoredTask) =>
  !isClosed(t.status) && !overdue(t) && differenceInCalendarDays(parseISO(t.dueDate), now()) <= organization.dueSoonThresholdDays;
const completedOnTime = (t: StoredTask) => t.status === "completed" && !isAfter(parseISO(t.updatedAt), parseISO(t.dueDate));
const withFlags = (t: StoredTask): Task => ({ ...t, isOverdue: overdue(t), isDueSoon: dueSoon(t) });

/** Mirrors backend/src/tasks/task-workflow.ts. */
function allowedStatuses(u: DemoUser, t: StoredTask): TaskStatus[] {
  const set = new Set<TaskStatus>();
  if (isAssignee(u, t) && ["todo", "in_progress", "blocked"].includes(t.status)) {
    set.add("in_progress").add("blocked");
  }
  if (isTaskManager(u, t)) {
    const map: Record<TaskStatus, TaskStatus[]> = {
      todo: ["in_progress", "blocked", "cancelled"],
      in_progress: ["todo", "blocked", "cancelled"],
      blocked: ["todo", "in_progress", "cancelled"],
      in_review: ["cancelled"],
      completed: ["in_progress"],
      cancelled: ["todo"],
    };
    map[t.status].forEach((s) => set.add(s));
    if (!organization.reviewRequired && ["in_progress", "blocked"].includes(t.status)) set.add("completed");
  }
  set.delete(t.status);
  return STATUS_ORDER.filter((s) => set.has(s));
}

function capabilities(u: DemoUser, t: StoredTask): TaskCapabilities {
  const assignee = isAssignee(u, t);
  const manager = can(u, "tasks.create") && inTeamScope(u, t);
  const closed = isClosed(t.status);
  const allowed = allowedStatuses(u, t);
  return {
    canEdit: manager && !closed,
    canReassign: manager && can(u, "tasks.assign") && !closed,
    canChangeStatus: allowed.length > 0,
    allowedStatuses: allowed,
    canUpdateProgress: assignee && ["in_progress", "blocked", "todo"].includes(t.status),
    canLogTime: assignee && t.status !== "cancelled",
    canComment: true,
    canAttach: t.status !== "cancelled",
    canEditChecklist: (assignee || manager) && !closed,
    canSubmitForReview: assignee && organization.reviewRequired && ["in_progress", "blocked", "todo"].includes(t.status),
    canReview: isTaskManager(u, t) && t.status === "in_review",
  };
}

function detail(u: DemoUser, t: StoredTask): TaskDetail {
  const x = taskExtras.get(t.id)!;
  return {
    ...withFlags(t),
    checklist: x.checklist,
    comments: [...x.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    attachments: x.attachments,
    timeEntries: [...x.timeEntries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    review: x.review,
    capabilities: capabilities(u, t),
  };
}

function getTaskFor(u: DemoUser, id: string) {
  const t = tasks.find((x) => x.id === id || x.key === id);
  if (!t || !canSee(u, t)) throw new HttpError(404, "Task not found.");
  return t;
}

function record(t: StoredTask, u: DemoUser, action: string, description: string) {
  taskExtras.get(t.id)!.history.push({ id: newId("his"), action, actor: toRef(u), description, createdAt: nowIso() });
  t.updatedAt = nowIso();
  logActivity(u, action, "task", t.id, t.key, `${description} (${t.key})`);
}

function logActivity(u: DemoUser, action: string, entityType: ActivityEntity, entityId: string | null, entityLabel: string | null, description: string) {
  activity.unshift({ id: newId("act"), actor: toRef(u), action, entityType, entityId, entityLabel, description, createdAt: nowIso() });
}

function notify(userId: string, type: NotificationType, title: string, body: string, link: string | null) {
  seedNotifications(userId).unshift({ id: newId("ntf"), type, title, body, read: false, link, createdAt: nowIso() });
}

function assignableFor(u: DemoUser) {
  if (!can(u, "tasks.assign")) return [];
  return users.filter((x) => x.status === "active" && (can(u, "tasks.view_all") || x.departmentId === u.departmentId));
}

function validateAssignees(u: DemoUser, ids: string[] | undefined) {
  if (!ids?.length) throw new HttpError(422, "Assign at least one employee.", { assigneeIds: ["Assign at least one employee."] });
  const allowed = new Set(assignableFor(u).map((x) => x.id));
  if (ids.some((id) => !allowed.has(id))) {
    throw new HttpError(403, "You can only assign tasks to active employees in your teams.");
  }
}

/* ---------------- Aggregates ---------------- */

function refreshAggregates() {
  for (const d of departments) {
    const dTasks = tasks.filter((t) => t.departmentId === d.id && t.status !== "cancelled");
    d.employeeCount = users.filter((u) => u.departmentId === d.id && u.status !== "deactivated").length;
    d.activeTaskCount = dTasks.filter((t) => !isClosed(t.status)).length;
    d.completionRate = dTasks.length ? Math.round((dTasks.filter((t) => t.status === "completed").length / dTasks.length) * 100) : 0;
  }
  for (const p of projects) {
    const pTasks = tasks.filter((t) => t.projectId === p.id && t.status !== "cancelled");
    p.taskCount = pTasks.length;
    p.completedTaskCount = pTasks.filter((t) => t.status === "completed").length;
  }
  for (const u of users) u.assignedTaskCount = tasks.filter((t) => isAssignee(u, t) && !isClosed(t.status)).length;
}

function publicEmployee(u: DemoUser): Employee {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, ...rest } = u;
  return rest;
}

/* ---------------- Dashboards ---------------- */

function teamOf(u: DemoUser) {
  return users.filter((x) => x.status === "active" && x.id !== u.id && (isAdmin(u) ? x.role === "employee" : x.managerId === u.id || (x.departmentId === u.departmentId && x.role === "employee")));
}

function summary(u: DemoUser): DashboardData {
  refreshAggregates();
  if (can(u, "dashboard.admin")) {
    const days = Array.from({ length: 14 }, (_, i) => subDays(startOfDay(now()), 13 - i));
    return {
      role: "admin",
      stats: {
        totalEmployees: users.filter((x) => x.status !== "deactivated").length,
        activeTasks: tasks.filter((t) => !isClosed(t.status)).length,
        completedTasks: tasks.filter((t) => t.status === "completed").length,
        overdueTasks: tasks.filter(overdue).length,
      },
      departmentPerformance: departments.filter((d) => !d.archived).map((d) => {
        const dt = tasks.filter((t) => t.departmentId === d.id);
        const done = dt.filter((t) => t.status === "completed");
        return {
          departmentId: d.id, department: d.name, completed: done.length,
          active: dt.filter((t) => !isClosed(t.status)).length, overdue: dt.filter(overdue).length,
          onTimeRate: done.length ? Math.round((done.filter(completedOnTime).length / done.length) * 100) : 0,
        };
      }),
      completionTrend: days.map((d) => {
        const key = format(d, "yyyy-MM-dd");
        const sameDay = (s: string) => format(parseISO(s), "yyyy-MM-dd") === key;
        return {
          date: key,
          created: tasks.filter((t) => sameDay(t.createdAt)).length,
          completed: tasks.filter((t) => t.status === "completed" && sameDay(t.updatedAt)).length,
        };
      }),
      recentActivity: activity.slice(0, 8),
      attentionEmployees: users
        .filter((x) => x.role === "employee" && x.status === "active")
        .map((x) => {
          const mine = tasks.filter((t) => isAssignee(x, t));
          return { employee: { ...toRef(x), departmentName: x.departmentName }, overdueCount: mine.filter(overdue).length, blockedCount: mine.filter((t) => t.status === "blocked").length };
        })
        .filter((x) => x.overdueCount + x.blockedCount > 0)
        .sort((a, b) => b.overdueCount * 2 + b.blockedCount - (a.overdueCount * 2 + a.blockedCount))
        .slice(0, 6),
    };
  }
  if (can(u, "dashboard.manager")) {
    const scope = tasks.filter((t) => inTeamScope(u, t));
    const dept = departments.find((d) => d.id === u.departmentId);
    const deptTasks = tasks.filter((t) => t.departmentId === dept?.id && t.status !== "cancelled");
    const byDue = (a: StoredTask, b: StoredTask) => a.dueDate.localeCompare(b.dueDate);
    refreshAggregates();
    return {
      role: "manager",
      stats: {
        assignedByMe: tasks.filter((t) => t.createdBy.id === u.id && !isClosed(t.status)).length,
        overdue: scope.filter(overdue).length,
        atRisk: scope.filter((t) => dueSoon(t) || t.status === "blocked").length,
        pendingReviews: scope.filter((t) => t.status === "in_review").length,
      },
      riskTasks: scope.filter((t) => overdue(t) || dueSoon(t) || t.status === "blocked").sort(byDue).slice(0, 8).map(withFlags),
      departmentProgress: dept
        ? {
            department: dept.name,
            completed: deptTasks.filter((t) => t.status === "completed").length,
            total: deptTasks.length,
            projects: projects.filter((p) => p.departmentId === dept.id).map((p) => ({ projectId: p.id, project: p.name, completed: p.completedTaskCount, total: p.taskCount })),
          }
        : null,
      pendingReviews: scope.filter((t) => t.status === "in_review").sort(byDue).slice(0, 6).map(withFlags),
    };
  }
  const mine = tasks.filter((t) => isMine(u, t));
  const n = (s: TaskStatus) => mine.filter((t) => t.status === s).length;
  return {
    role: "employee",
    stats: { total: mine.length, todo: n("todo"), inProgress: n("in_progress"), inReview: n("in_review"), completed: n("completed"), overdue: mine.filter(overdue).length },
    upcoming: mine.filter((t) => !isClosed(t.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6).map(withFlags),
    productivity: Array.from({ length: 8 }, (_, i) => {
      const start = startOfWeek(subWeeks(now(), 7 - i), { weekStartsOn: 1 });
      const end = endOfWeek(start, { weekStartsOn: 1 });
      const done = mine.filter((t) => t.status === "completed" && !isBefore(parseISO(t.updatedAt), start) && !isAfter(parseISO(t.updatedAt), end));
      return { label: format(start, "MMM d"), completed: done.length, hours: done.reduce((s, t) => s + t.actualHours, 0) };
    }),
  };
}

/* ---------------- Reports ---------------- */

function reportScope(u: DemoUser, q: URLSearchParams) {
  requirePerm(u, "reports.view");
  const from = q.get("from") ?? format(subDays(now(), 30), "yyyy-MM-dd");
  const to = q.get("to") ?? format(now(), "yyyy-MM-dd");
  const dep = q.get("departmentId");
  const prj = q.get("projectId");
  const scope = tasks.filter(
    (t) => inTeamScope(u, t) && t.createdAt.slice(0, 10) <= to && t.dueDate.slice(0, 10) >= from &&
      (!dep || t.departmentId === dep) && (!prj || t.projectId === prj)
  );
  return { from, to, scope };
}

function taskReport(u: DemoUser, q: URLSearchParams): TaskReport {
  const { from, to, scope } = reportScope(u, q);
  const fromD = parseISO(from);
  const toD = parseISO(to);
  const doneIn = (s: Date, e: Date) => scope.filter((t) => t.status === "completed" && !isBefore(parseISO(t.updatedAt), s) && !isAfter(parseISO(t.updatedAt), e));
  const weekly: TaskReport["productivity"]["weekly"] = [];
  for (let w = startOfWeek(fromD, { weekStartsOn: 1 }); !isAfter(w, toD) && weekly.length < 16; w = addDays(w, 7)) {
    const done = doneIn(w, endOfWeek(w, { weekStartsOn: 1 }));
    weekly.push({ label: format(w, "MMM d"), completed: done.length, hours: done.reduce((s, t) => s + t.actualHours, 0) });
  }
  const monthly: TaskReport["productivity"]["monthly"] = [];
  for (let m = startOfMonth(fromD); !isAfter(m, toD) && monthly.length < 12; m = startOfMonth(addDays(m, 32))) {
    const done = doneIn(m, addDays(startOfMonth(addDays(m, 32)), -1));
    monthly.push({ label: format(m, "MMM yyyy"), completed: done.length, hours: done.reduce((s, t) => s + t.actualHours, 0) });
  }
  const completed = scope.filter((t) => t.status === "completed");
  return {
    range: { from, to },
    totals: { total: scope.length, completed: completed.length, overdue: scope.filter(overdue).length, open: scope.filter((t) => !isClosed(t.status)).length },
    onTime: { onTime: completed.filter(completedOnTime).length, late: completed.filter((t) => !completedOnTime(t)).length },
    statusDistribution: STATUS_ORDER.map((status) => ({ status, count: scope.filter((t) => t.status === status).length })),
    productivity: { weekly, monthly },
    projectProgress: projects.filter((p) => scope.some((t) => t.projectId === p.id)).map((p) => {
      const pt = scope.filter((t) => t.projectId === p.id && t.status !== "cancelled");
      return { projectId: p.id, project: p.name, completed: pt.filter((t) => t.status === "completed").length, total: pt.length };
    }),
    overdue: scope.filter(overdue).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(({ id, key, title, dueDate, priority, status, assignedTo, departmentName }) => ({ id, key, title, dueDate, priority, status, assignedTo, departmentName })),
  };
}

function employeeReport(u: DemoUser, q: URLSearchParams) {
  const { scope } = reportScope(u, q);
  return users
    .filter((x) => scope.some((t) => isAssignee(x, t)))
    .map((x) => {
      const mt = scope.filter((t) => isAssignee(x, t));
      const done = mt.filter((t) => t.status === "completed");
      const open = mt.filter((t) => !isClosed(t.status));
      return {
        userId: x.id, name: x.name, departmentName: x.departmentName, open: open.length, completed: done.length,
        overdue: mt.filter(overdue).length, estimatedOpenHours: open.reduce((s, t) => s + t.estimatedHours, 0),
        loggedHours: Math.round(mt.reduce((s, t) => s + t.actualHours, 0) * 10) / 10,
        onTimeRate: done.length ? Math.round((done.filter(completedOnTime).length / done.length) * 100) : 0,
      };
    })
    .sort((a, b) => b.open - a.open);
}

function departmentReport(u: DemoUser, q: URLSearchParams) {
  const { scope } = reportScope(u, q);
  return departments.filter((d) => scope.some((t) => t.departmentId === d.id)).map((d) => {
    const dt = scope.filter((t) => t.departmentId === d.id && t.status !== "cancelled");
    const done = dt.filter((t) => t.status === "completed");
    return {
      departmentId: d.id, department: d.name, total: dt.length, completed: done.length, overdue: dt.filter(overdue).length,
      onTimeRate: done.length ? Math.round((done.filter(completedOnTime).length / done.length) * 100) : 0,
    };
  });
}

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]!);
  const cell = (v: unknown) => {
    const s = Array.isArray(v) ? v.map((x) => (typeof x === "object" && x && "name" in x ? (x as { name: string }).name : String(x))).join("; ") : String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => cell(r[h])).join(","))].join("\n");
}

/* ---------------- Router ---------------- */

type Body = Record<string, unknown>;

function paginated<T>(items: T[], q: URLSearchParams) {
  const page = Math.max(1, Number(q.get("page") ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(q.get("pageSize") ?? 20)));
  return respond(200, { data: items.slice((page - 1) * pageSize, page * pageSize), meta: { total: items.length, page, pageSize } });
}

async function route(method: string, path: string, q: URLSearchParams, body: Body, init: RequestInit): Promise<Response> {
  const seg = path.split("/").filter(Boolean);

  /* ----- auth (public) ----- */
  if (method === "POST" && path === "/auth/login") {
    const email = String(body.email ?? "").toLowerCase().trim();
    const user = users.find((u) => u.email === email);
    if (!user || user.password !== body.password) throw new HttpError(401, "Incorrect email or password.");
    if (user.status === "invited") throw new HttpError(403, "This account hasn't been activated yet. Use the link in your invitation.");
    if (user.status !== "active") throw new HttpError(403, "This account is deactivated. Contact your administrator.");
    user.lastLoginAt = nowIso();
    logActivity(user, "auth.login", "auth", null, null, "signed in");
    return ok(issueSession(user));
  }
  if (method === "POST" && path === "/auth/refresh") {
    let stored: { userId: string } | null = null;
    try {
      stored = JSON.parse(sessionStorage.getItem(REFRESH_KEY) ?? "null");
    } catch {
      stored = null;
    }
    const user = users.find((u) => u.id === stored?.userId && u.status === "active");
    if (!user) throw new HttpError(401, "Refresh token invalid or expired.");
    return ok(issueSession(user));
  }
  if (method === "POST" && path === "/auth/logout") {
    try {
      sessionStorage.removeItem(REFRESH_KEY);
    } catch {
      /* ignore */
    }
    return noContent();
  }
  if (method === "POST" && path === "/auth/forgot-password") return noContent();
  if (method === "POST" && (path === "/auth/reset-password" || path === "/auth/accept-invitation")) {
    const token = String(body.token ?? "");
    if (String(body.password ?? "").length < 10) throw new HttpError(422, "Password must be at least 10 characters.");
    if (path === "/auth/accept-invitation") {
      const user = users.find((u) => `demo-invite-${u.id}` === token && u.status === "invited");
      if (!user) throw new HttpError(400, "This invitation link is invalid or has expired. Ask your administrator for a new one.");
      user.password = String(body.password);
      user.status = "active";
      return noContent();
    }
    if (!token || token === "expired") throw new HttpError(400, "This reset link is invalid or has expired. Request a new one.");
    return noContent();
  }

  const me = authenticate(init);

  if (method === "GET" && path === "/auth/me") return ok(toCurrentUser(me));
  if (method === "POST" && path === "/auth/change-password") {
    if (body.currentPassword !== me.password) throw new HttpError(422, "Current password is incorrect.", { currentPassword: ["Current password is incorrect."] });
    me.password = String(body.newPassword);
    return noContent();
  }

  /* ----- settings ----- */
  if (path === "/settings/notifications") {
    const defaults: NotificationPreferences = { emailAssignments: true, emailDueReminders: true, emailReviews: true, inAppComments: true, dailyDigest: false };
    if (method === "PUT") preferencesByUser.set(me.id, body as unknown as NotificationPreferences);
    return ok(preferencesByUser.get(me.id) ?? defaults);
  }
  if (path === "/settings/organization") {
    if (method === "PATCH") {
      requirePerm(me, "settings.org");
      const days = body.dueSoonThresholdDays;
      if (days !== undefined && (typeof days !== "number" || days < 0 || days > 30)) throw new HttpError(422, "Threshold must be between 0 and 30 days.");
      Object.assign(organization, body);
      logActivity(me, "settings.updated", "settings", null, null, "updated organisation settings");
    }
    return ok(organization);
  }

  /* ----- dashboard ----- */
  if (method === "GET" && path === "/dashboard/summary") return ok(summary(me));
  if (method === "GET" && path === "/dashboard/workload") {
    if (!can(me, "dashboard.manager") && !can(me, "dashboard.admin")) throw new HttpError(403, "You don't have access to team workload.");
    return ok(teamOf(me).map((m) => {
      const mt = tasks.filter((t) => isAssignee(m, t));
      const n = (s: TaskStatus) => mt.filter((t) => t.status === s).length;
      return { member: toRef(m), todo: n("todo"), inProgress: n("in_progress"), inReview: n("in_review"), blocked: n("blocked") };
    }));
  }
  if (method === "GET" && path === "/dashboard/team-performance") {
    if (!can(me, "dashboard.manager") && !can(me, "dashboard.admin")) throw new HttpError(403, "You don't have access to team performance.");
    return ok(teamOf(me).map((m) => {
      const mt = tasks.filter((t) => isAssignee(m, t));
      const done = mt.filter((t) => t.status === "completed");
      return { member: toRef(m), completed: done.length, overdue: mt.filter(overdue).length, onTimeRate: done.length ? Math.round((done.filter(completedOnTime).length / done.length) * 100) : 0 };
    }));
  }

  /* ----- tasks ----- */
  if (seg[0] === "tasks") {
    if (seg.length === 1 && method === "GET") {
      const scope = q.get("scope") ?? "mine";
      if (scope === "all" && !can(me, "tasks.view_all") && !can(me, "tasks.view_team")) throw new HttpError(403, "You don't have access to organisation tasks.");
      let list = tasks.filter((t) => (scope === "all" ? inTeamScope(me, t) : isMine(me, t)));
      const search = q.get("search")?.toLowerCase();
      if (search) list = list.filter((t) => t.title.toLowerCase().includes(search) || t.key.toLowerCase().includes(search) || t.assignedTo.some((a) => a.name.toLowerCase().includes(search)));
      const statuses = q.get("status")?.split(",") as TaskStatus[] | undefined;
      if (statuses?.length) list = list.filter((t) => statuses.includes(t.status));
      const priorities = q.get("priority")?.split(",") as TaskPriority[] | undefined;
      if (priorities?.length) list = list.filter((t) => priorities.includes(t.priority));
      for (const key of ["departmentId", "projectId"] as const) {
        const v = q.get(key);
        if (v) list = list.filter((t) => t[key] === v);
      }
      const assigneeId = q.get("assigneeId");
      if (assigneeId) list = list.filter((t) => t.assignedTo.some((a) => a.id === assigneeId));
      const tag = q.get("tag");
      if (tag) list = list.filter((t) => t.tags.includes(tag));
      const dueFrom = q.get("dueFrom");
      const dueTo = q.get("dueTo");
      if (dueFrom) list = list.filter((t) => t.dueDate.slice(0, 10) >= dueFrom);
      if (dueTo) list = list.filter((t) => t.dueDate.slice(0, 10) <= dueTo);
      if (q.get("overdue") === "true") list = list.filter(overdue);
      const sort = q.get("sort") ?? "dueDate";
      const dir = q.get("order") === "desc" ? -1 : 1;
      const cmp: Record<string, (a: StoredTask, b: StoredTask) => number> = {
        dueDate: (a, b) => a.dueDate.localeCompare(b.dueDate),
        updatedAt: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
        title: (a, b) => a.title.localeCompare(b.title),
        key: (a, b) => Number(a.key.slice(3)) - Number(b.key.slice(3)),
        priority: (a, b) => priorityMeta[a.priority].rank - priorityMeta[b.priority].rank,
        status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
      };
      list = [...list].sort((a, b) => (cmp[sort] ?? cmp.dueDate!)(a, b) * dir);
      return paginated(list.map(withFlags), q);
    }

    if (seg[1] === "assignable-users" && method === "GET") {
      return ok(assignableFor(me).map((u) => ({ ...toRef(u), departmentId: u.departmentId })));
    }

    if (seg.length === 1 && method === "POST") {
      requirePerm(me, "tasks.create");
      const input = body as unknown as TaskInput;
      const errors: Record<string, string[]> = {};
      if (!input.title || input.title.trim().length < 3) errors.title = ["Title must be at least 3 characters."];
      if (input.dueDate < input.startDate) errors.dueDate = ["Due date must be on or after the start date."];
      if (Object.keys(errors).length) throw new HttpError(422, "Some fields need attention.", errors);
      validateAssignees(me, input.assigneeIds);
      const project = projects.find((p) => p.id === input.projectId && !p.archived);
      const dept = departments.find((d) => d.id === input.departmentId && !d.archived);
      if (!project || !dept) throw new HttpError(422, "Select an active project and department.");
      if (!can(me, "tasks.view_all") && dept.id !== me.departmentId) throw new HttpError(403, "You can only create tasks for your own department.");
      const assignees = users.filter((u) => input.assigneeIds.includes(u.id));
      const t: StoredTask = {
        id: newId("tsk"), key: `BN-${2000 + tasks.length}`, title: input.title.trim(), description: input.description ?? "",
        projectId: project.id, projectName: project.name, departmentId: dept.id, departmentName: dept.name,
        assignedTo: assignees.map(toRef), createdBy: toRef(me), sharedWith: [], priority: input.priority,
        status: "todo", tags: input.tags ?? [], startDate: new Date(input.startDate).toISOString(), dueDate: new Date(`${input.dueDate}T23:59:59.999Z`).toISOString(),
        estimatedHours: input.estimatedHours, actualHours: 0, progressPercentage: 0,
        checklistTotal: input.checklist?.length ?? 0, checklistDone: 0, commentCount: 0, attachmentCount: 0,
        createdAt: nowIso(), updatedAt: nowIso(),
      };
      tasks.push(t);
      taskExtras.set(t.id, {
        checklist: (input.checklist ?? []).map((c) => ({ id: newId("chk"), label: c.label, done: false })),
        comments: [], attachments: [], timeEntries: [], history: [], review: null,
      });
      record(t, me, "task.created", `created the task and assigned it to ${assignees.map((a) => a.name).join(", ")}`);
      assignees.forEach((a) => notify(a.id, "task_assigned", "New task assigned", `${me.name} assigned you ${t.key}: ${t.title}`, `/tasks/${t.id}`));
      return ok(detail(me, t), 201);
    }

    const t = getTaskFor(me, seg[1]!);
    const caps = capabilities(me, t);
    const x = taskExtras.get(t.id)!;
    const action = seg[2];

    if (!action && method === "GET") return ok(detail(me, t));
    if (action === "activity" && method === "GET") return ok([...x.history].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

    if (!action && method === "PATCH") {
      if (!caps.canEdit) throw new HttpError(403, "You can't edit this task.");
      const input = body as Partial<TaskInput>;
      if (input.title !== undefined && input.title.trim().length < 3) throw new HttpError(422, "Title must be at least 3 characters.", { title: ["Title must be at least 3 characters."] });
      if (input.title) t.title = input.title.trim();
      if (input.description !== undefined) t.description = input.description;
      if (input.priority) t.priority = input.priority;
      if (input.tags) t.tags = input.tags;
      if (input.startDate) t.startDate = new Date(input.startDate).toISOString();
      if (input.dueDate) t.dueDate = new Date(`${input.dueDate.slice(0, 10)}T23:59:59.999Z`).toISOString();
      if (input.estimatedHours !== undefined) t.estimatedHours = input.estimatedHours;
      if (input.projectId) {
        const p = projects.find((pp) => pp.id === input.projectId);
        if (p) { t.projectId = p.id; t.projectName = p.name; }
      }
      record(t, me, "task.updated", "updated task details");
      return ok(detail(me, t));
    }

    if (action === "assignments" && method === "POST") {
      if (!caps.canReassign) throw new HttpError(403, "You can't reassign this task.");
      const ids = body.assigneeIds as string[];
      validateAssignees(me, ids);
      const before = new Set(t.assignedTo.map((a) => a.id));
      t.assignedTo = users.filter((u) => ids.includes(u.id)).map(toRef);
      record(t, me, "task.reassigned", `reassigned the task to ${t.assignedTo.map((a) => a.name).join(", ")}`);
      t.assignedTo.filter((a) => !before.has(a.id)).forEach((a) => notify(a.id, "task_reassigned", "Task assigned to you", `${me.name} assigned you ${t.key}`, `/tasks/${t.id}`));
      return ok(detail(me, t));
    }

    if (action === "status" && method === "PATCH") {
      const status = body.status as TaskStatus;
      if (!STATUS_ORDER.includes(status)) throw new HttpError(422, "Invalid status.");
      if (status === "in_review") throw new HttpError(422, "Use “Submit for review” to send this task for review.");
      if (!caps.allowedStatuses.includes(status)) {
        throw new HttpError(422, status === "completed" && organization.reviewRequired
          ? "Tasks must be submitted for review and approved before they're completed."
          : `You can't move this task from ${statusMeta[t.status].label} to ${statusMeta[status].label}.`);
      }
      const before = t.status;
      t.status = status;
      if (status === "completed") t.progressPercentage = 100;
      record(t, me, "task.status_changed", `changed status from ${statusMeta[before].label} to ${statusMeta[status].label}`);
      return ok(detail(me, t));
    }

    if (action === "progress" && method === "PATCH") {
      if (!caps.canUpdateProgress) throw new HttpError(403, "You can't update progress on this task.");
      const pct = Number(body.progressPercentage);
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new HttpError(422, "Progress must be a whole number between 0 and 100.");
      t.progressPercentage = pct;
      if (t.status === "todo" && pct > 0) t.status = "in_progress";
      record(t, me, "task.progress_updated", `updated progress to ${pct}%`);
      return ok(detail(me, t));
    }

    if (action === "time-entries" && method === "POST") {
      if (!caps.canLogTime) throw new HttpError(403, "You can't log time on this task.");
      const minutes = Number(body.minutes);
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) throw new HttpError(422, "Enter a duration between 1 minute and 24 hours.");
      x.timeEntries.push({ id: newId("tim"), user: toRef(me), minutes, note: (body.note as string) || null, date: String(body.date), createdAt: nowIso() });
      t.actualHours = Math.round((x.timeEntries.reduce((s, e) => s + e.minutes, 0) / 60) * 10) / 10;
      record(t, me, "task.time_logged", `logged ${Math.floor(minutes / 60)}h ${minutes % 60}m`);
      return ok(detail(me, t), 201);
    }

    if (action === "comments" && method === "POST") {
      const text = String(body.body ?? "").trim();
      if (!text) throw new HttpError(422, "Comment can't be empty.");
      const mentioned = users.filter((u) => text.includes(`@${u.email}`));
      x.comments.push({ id: newId("cmt"), author: toRef(me), body: text, mentions: mentioned.map((u) => u.id), createdAt: nowIso() });
      t.commentCount = x.comments.length;
      record(t, me, "task.comment_added", "added a comment");
      mentioned.forEach((u) => notify(u.id, "mention", "You were mentioned", `${me.name} mentioned you on ${t.key}`, `/tasks/${t.id}`));
      [...t.assignedTo, t.createdBy].filter((p) => p.id !== me.id && !mentioned.some((m) => m.id === p.id))
        .forEach((p) => notify(p.id, "comment", "New comment", `${me.name} commented on ${t.key}`, `/tasks/${t.id}`));
      return ok(detail(me, t), 201);
    }

    if (action === "attachments" && method === "POST") {
      if (!caps.canAttach) throw new HttpError(403, "Attachments are disabled for this task.");
      const url = String(body.url ?? "");
      if (!/^https:\/\//.test(url)) throw new HttpError(422, "Attachment URL must start with https://", { url: ["Attachment URL must start with https://"] });
      x.attachments.push({ id: newId("att"), fileName: String(body.fileName), url, sizeBytes: null, contentType: null, uploadedBy: toRef(me), createdAt: nowIso() });
      t.attachmentCount = x.attachments.length;
      record(t, me, "task.attachment_added", `attached ${String(body.fileName)}`);
      return ok(detail(me, t), 201);
    }

    if (action === "checklist") {
      if (!caps.canEdit && !isAssignee(me, t)) throw new HttpError(403, "You can't edit this checklist.");
      if (method === "POST") {
        const label = String(body.label ?? "").trim();
        if (!label) throw new HttpError(422, "Checklist item can't be empty.");
        x.checklist.push({ id: newId("chk"), label, done: false });
      } else if (method === "PATCH" && seg[3]) {
        const item = x.checklist.find((c) => c.id === seg[3]);
        if (!item) throw new HttpError(404, "Checklist item not found.");
        item.done = Boolean(body.done);
      }
      t.checklistTotal = x.checklist.length;
      t.checklistDone = x.checklist.filter((c) => c.done).length;
      t.updatedAt = nowIso();
      return ok(detail(me, t));
    }

    if (action === "submit-review" && method === "POST") {
      if (!caps.canSubmitForReview) throw new HttpError(422, "This task can't be submitted for review right now.");
      t.status = "in_review";
      t.progressPercentage = 100;
      x.review = { state: "pending", submittedBy: toRef(me), submittedAt: nowIso(), submissionNote: (body.note as string) || null, reviewer: null, reviewedAt: null, reviewNote: null };
      record(t, me, "task.review_submitted", "submitted the task for review");
      notify(t.createdBy.id, "review_requested", "Review requested", `${me.name} submitted ${t.key} for review`, `/tasks/${t.id}`);
      return ok(detail(me, t));
    }

    if ((action === "approve" || action === "request-changes") && method === "POST") {
      if (!caps.canReview) throw new HttpError(403, "You can't review this task.");
      const approve = action === "approve";
      const note = String(body.note ?? "").trim();
      if (!approve && !note) throw new HttpError(422, "Explain what needs to change.", { note: ["Explain what needs to change."] });
      t.status = approve ? "completed" : "in_progress";
      t.progressPercentage = approve ? 100 : Math.min(t.progressPercentage, 90);
      x.review = { ...(x.review ?? { submittedBy: t.assignedTo[0]!, submittedAt: nowIso() }), state: approve ? "approved" : "changes_requested", reviewer: toRef(me), reviewedAt: nowIso(), reviewNote: note || null };
      record(t, me, approve ? "task.approved" : "task.changes_requested", approve ? "approved the task" : "requested changes");
      t.assignedTo.forEach((a) => notify(a.id, approve ? "review_approved" : "changes_requested", approve ? "Task approved" : "Changes requested", `${me.name} ${approve ? "approved" : "requested changes on"} ${t.key}`, `/tasks/${t.id}`));
      return ok(detail(me, t));
    }
  }

  /* ----- users ----- */
  if (seg[0] === "users") {
    if (seg[1] === "me" && method === "PATCH") {
      const first = String(body.firstName ?? "").trim();
      const last = String(body.lastName ?? "").trim();
      if (!first || !last) throw new HttpError(422, "First and last name are required.");
      me.firstName = first;
      me.lastName = last;
      me.name = `${first} ${last}`;
      if (typeof body.title === "string") me.title = body.title;
      return ok(toCurrentUser(me));
    }

    requirePerm(me, "employees.view");
    refreshAggregates();
    const visible = users.filter((u) => can(me, "tasks.view_all") || me.role === "hr_manager" || u.departmentId === me.departmentId);

    if (seg.length === 1 && method === "GET") {
      let list = visible;
      const search = q.get("search")?.toLowerCase();
      if (search) list = list.filter((u) => u.name.toLowerCase().includes(search) || u.email.includes(search) || u.employeeId.toLowerCase().includes(search));
      const dep = q.get("departmentId");
      if (dep) list = list.filter((u) => u.departmentId === dep);
      const roles = q.get("role")?.split(",");
      if (roles?.length) list = list.filter((u) => roles.includes(u.role));
      const status = q.get("status");
      if (status) list = list.filter((u) => u.status === status);
      return paginated([...list].sort((a, b) => a.name.localeCompare(b.name)).map(publicEmployee), q);
    }

    if (seg.length === 1 && method === "POST") {
      requirePerm(me, "employees.manage");
      const input = body as unknown as EmployeeInput;
      if (!grantableRoles(me.role).includes(input.role)) throw new HttpError(403, "You can't grant this role.");
      const email = String(input.email).toLowerCase().trim();
      if (users.some((u) => u.email === email)) throw new HttpError(409, "An account with this email already exists.", { email: ["An account with this email already exists."] });
      const dept = departments.find((d) => d.id === input.departmentId && !d.archived);
      if (!dept) throw new HttpError(422, "Select an active department.");
      const manager = users.find((u) => u.id === input.managerId && u.status === "active");
      const created: DemoUser = {
        id: `usr_${users.length + 1}`, employeeId: `BN-E${1001 + users.length}`,
        name: `${input.firstName.trim()} ${input.lastName.trim()}`, firstName: input.firstName.trim(), lastName: input.lastName.trim(),
        email, avatarUrl: null, title: input.title || null, departmentId: dept.id, departmentName: dept.name,
        role: input.role, jobFunction: input.jobFunction, managerId: manager?.id ?? null, managerName: manager?.name ?? null,
        status: "invited", joinDate: input.joinDate, assignedTaskCount: 0, invitationSentAt: nowIso(), lastLoginAt: null,
        password: crypto.randomUUID(),
      };
      users.push(created);
      logActivity(me, "user.created", "user", created.id, created.name, `created an account for ${created.name}`);
      // Demo mode has no mail transport, so the one-time link is returned.
      return ok({ user: publicEmployee(created), emailSent: false, invitationUrl: `${location.origin}/accept-invitation?token=demo-invite-${created.id}` }, 201);
    }

    const target = visible.find((u) => u.id === seg[1]);
    if (!target) throw new HttpError(404, "Employee not found.");
    const guardPrivileged = () => {
      requirePerm(me, "employees.manage");
      if (!grantableRoles(me.role).includes(target.role)) throw new HttpError(403, "You can't modify an account with a higher privilege level.");
      if (target.id === me.id) throw new HttpError(422, "You can't change your own role or account status here.");
    };

    if (seg.length === 2 && method === "GET") return ok(publicEmployee(target));

    if (seg.length === 2 && method === "PATCH") {
      requirePerm(me, "employees.manage");
      const input = body as EmployeeUpdateInput;
      if (input.role && input.role !== target.role) {
        guardPrivileged();
        if (!grantableRoles(me.role).includes(input.role)) throw new HttpError(403, "You can't grant this role.");
        target.role = input.role;
        logActivity(me, "user.role_changed", "user", target.id, target.name, `changed the role of ${target.name} to ${input.role}`);
      }
      if (input.jobFunction) target.jobFunction = input.jobFunction;
      if (input.departmentId) {
        const d = departments.find((dd) => dd.id === input.departmentId);
        if (d) { target.departmentId = d.id; target.departmentName = d.name; }
      }
      if (input.managerId !== undefined) {
        const m = users.find((u) => u.id === input.managerId);
        if (m?.id === target.id) throw new HttpError(422, "An employee can't report to themselves.");
        target.managerId = m?.id ?? null;
        target.managerName = m?.name ?? null;
      }
      if (input.title !== undefined) target.title = input.title;
      return ok(publicEmployee(target));
    }

    if (seg[2] === "status" && method === "PATCH") {
      guardPrivileged();
      const status = body.status as "active" | "deactivated";
      if (status === "active" && target.status === "invited") throw new HttpError(422, "Invited users activate their own account from the invitation link.");
      target.status = status;
      logActivity(me, `user.${status === "active" ? "reactivated" : "deactivated"}`, "user", target.id, target.name, `${status === "active" ? "reactivated" : "deactivated"} ${target.name}`);
      return ok(publicEmployee(target));
    }

    if (seg.length === 2 && method === "DELETE") {
      guardPrivileged();
      target.status = "deactivated";
      logActivity(me, "user.deleted", "user", target.id, target.name, `removed ${target.name} (soft delete)`);
      return noContent();
    }

    if (seg[2] === "invitation" && method === "POST") {
      requirePerm(me, "employees.manage");
      if (target.status !== "invited") throw new HttpError(409, "This account is already activated.");
      target.invitationSentAt = nowIso();
      return ok({ user: publicEmployee(target), emailSent: false, invitationUrl: `${location.origin}/accept-invitation?token=demo-invite-${target.id}` });
    }
  }

  /* ----- departments ----- */
  if (seg[0] === "departments") {
    refreshAggregates();
    if (seg.length === 1 && method === "GET") {
      requirePerm(me, "departments.view");
      return ok(departments.filter((d) => q.get("includeArchived") === "true" || !d.archived));
    }
    requirePerm(me, "departments.manage");
    const validateName = (name: string, exceptId?: string) => {
      if (name.length < 2) throw new HttpError(422, "Department name is required.", { name: ["Department name is required."] });
      if (departments.some((d) => d.id !== exceptId && d.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, "A department with this name already exists.", { name: ["A department with this name already exists."] });
    };
    if (seg.length === 1 && method === "POST") {
      const name = String(body.name ?? "").trim();
      validateName(name);
      const head = users.find((u) => u.id === body.managerId);
      const d = { id: newId("dep"), name, description: (body.description as string) || null, managerId: head?.id ?? null, managerName: head?.name ?? null, employeeCount: 0, activeTaskCount: 0, completionRate: 0, archived: false, createdAt: nowIso() };
      departments.push(d);
      logActivity(me, "department.created", "department", d.id, d.name, `created department ${d.name}`);
      return ok(d, 201);
    }
    const d = departments.find((dd) => dd.id === seg[1]);
    if (!d) throw new HttpError(404, "Department not found.");
    if (seg[2] === "archive" && method === "PATCH") {
      if (d.activeTaskCount > 0) throw new HttpError(409, "Close or move this department's open tasks before archiving it.");
      d.archived = true;
      return ok(d);
    }
    if (seg.length === 2 && method === "PATCH") {
      if (typeof body.name === "string") { validateName(body.name.trim(), d.id); d.name = body.name.trim(); }
      if (typeof body.description === "string") d.description = body.description;
      if (body.managerId !== undefined) { const m = users.find((u) => u.id === body.managerId); d.managerId = m?.id ?? null; d.managerName = m?.name ?? null; }
      return ok(d);
    }
  }

  /* ----- projects ----- */
  if (seg[0] === "projects") {
    refreshAggregates();
    if (seg.length === 1 && method === "GET") {
      requirePerm(me, "projects.view");
      const list = projects.filter((p) => q.get("includeArchived") === "true" || !p.archived);
      return ok(can(me, "tasks.view_team") || can(me, "projects.manage") ? list : list.filter((p) => p.memberIds.includes(me.id) || tasks.some((t) => t.projectId === p.id && isMine(me, t))));
    }
    requirePerm(me, "projects.manage");
    if (seg.length === 1 && method === "POST") {
      const dept = departments.find((d) => d.id === body.departmentId && !d.archived);
      if (!dept) throw new HttpError(422, "Select an active department.");
      const key = String(body.key ?? "").toUpperCase();
      if (projects.some((p) => p.key === key)) throw new HttpError(409, "Project key is already in use.", { key: ["Project key is already in use."] });
      const manager = users.find((u) => u.id === body.managerId) ?? me;
      const p: Project = { id: newId("prj"), key, name: String(body.name), description: (body.description as string) || null, departmentId: dept.id, departmentName: dept.name, manager: toRef(manager), memberIds: [], status: body.status as Project["status"], startDate: String(body.startDate), dueDate: String(body.dueDate), taskCount: 0, completedTaskCount: 0, archived: false };
      projects.push(p);
      logActivity(me, "project.created", "project", p.id, p.name, `created project ${p.name}`);
      return ok(p, 201);
    }
    const p = projects.find((pp) => pp.id === seg[1]);
    if (!p) throw new HttpError(404, "Project not found.");
    if (seg[2] === "archive" && method === "PATCH") { p.archived = true; return ok(p); }
    if (seg.length === 2 && method === "PATCH") { Object.assign(p, body); return ok(p); }
  }

  /* ----- reports ----- */
  if (seg[0] === "reports" && method === "GET") {
    const kind = seg[1];
    const data = kind === "tasks" ? taskReport(me, q) : kind === "employees" ? employeeReport(me, q) : kind === "departments" ? departmentReport(me, q) : null;
    if (data === null) throw new HttpError(404, "Unknown report.");
    if (q.get("format") === "csv") {
      requirePerm(me, "reports.export");
      const rows = kind === "tasks"
        ? reportScope(me, q).scope.map((t) => ({ key: t.key, title: t.title, status: t.status, priority: t.priority, department: t.departmentName, project: t.projectName, assignedTo: t.assignedTo, dueDate: t.dueDate, progress: t.progressPercentage, overdue: overdue(t) }))
        : (data as Record<string, unknown>[]);
      return new Response(toCsv(rows as Record<string, unknown>[]), {
        status: 200,
        headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="bizwoke-${kind}-report.csv"` },
      });
    }
    return ok(data);
  }

  /* ----- notifications ----- */
  if (seg[0] === "notifications") {
    const list = seedNotifications(me.id);
    if (method === "GET" && seg.length === 1) return paginated(q.get("unreadOnly") === "true" ? list.filter((n) => !n.read) : list, q);
    if (method === "GET" && seg[1] === "unread-count") return ok({ count: list.filter((n) => !n.read).length });
    if (method === "POST" && seg[1] === "read-all") { list.forEach((n) => (n.read = true)); return noContent(); }
    if (method === "PATCH" && seg[2] === "read") {
      const n = list.find((nn) => nn.id === seg[1]);
      if (!n) throw new HttpError(404, "Notification not found.");
      n.read = true;
      return noContent();
    }
  }

  /* ----- activity ----- */
  if (path === "/activity-logs" && method === "GET") {
    requirePerm(me, "activity.view");
    let list = can(me, "tasks.view_all") ? activity : activity.filter((a) => users.find((u) => u.id === a.actor.id)?.departmentId === me.departmentId);
    const type = q.get("entityType");
    if (type) list = list.filter((a) => a.entityType === type);
    const search = q.get("search")?.toLowerCase();
    if (search) list = list.filter((a) => a.description.toLowerCase().includes(search) || a.actor.name.toLowerCase().includes(search));
    return paginated(list, q);
  }

  /* ----- search ----- */
  if (path === "/search" && method === "GET") {
    const term = (q.get("q") ?? "").toLowerCase().trim();
    if (term.length < 2) return ok({ tasks: [], employees: [], projects: [] });
    return ok({
      tasks: tasks.filter((t) => canSee(me, t) && (t.title.toLowerCase().includes(term) || t.key.toLowerCase().includes(term))).slice(0, 6).map(({ id, key, title, status }) => ({ id, key, title, status })),
      employees: can(me, "employees.view") ? users.filter((u) => u.name.toLowerCase().includes(term) || u.email.includes(term)).slice(0, 5).map(({ id, name, email, departmentName }) => ({ id, name, email, departmentName })) : [],
      projects: projects.filter((p) => p.name.toLowerCase().includes(term) || p.key.toLowerCase().includes(term)).slice(0, 4).map(({ id, key, name }) => ({ id, key, name })),
    });
  }

  throw new HttpError(404, `No demo handler for ${method} ${path}`);
}

export async function handleDemoRequest(url: string, init: RequestInit): Promise<Response> {
  await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));
  const parsed = new URL(url, "http://demo.local");
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" ? (JSON.parse(init.body) as Body) : {};
  try {
    return await route(method, parsed.pathname, parsed.searchParams, body, init);
  } catch (error) {
    if (error instanceof HttpError) {
      return respond(error.status, { statusCode: error.status, message: error.message, details: error.details, timestamp: nowIso(), path: parsed.pathname });
    }
    console.error("[demo] handler error", error);
    return respond(500, { statusCode: 500, message: "Demo server error." });
  }
}
