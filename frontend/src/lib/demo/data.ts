/**
 * DEVELOPMENT-ONLY demo dataset. Never included in production builds — see
 * `transport()` in src/lib/api/client.ts. Data is generated deterministically
 * from a seed, relative to today, and lives in memory for the browser tab.
 */
import { addDays, formatISO, startOfDay, subDays, subHours, subMinutes } from "date-fns";
import type {
  AccountStatus,
  ActivityLog,
  AppNotification,
  Attachment,
  ChecklistItem,
  Department,
  Employee,
  JobFunction,
  NotificationPreferences,
  OrganizationSettings,
  Project,
  ProjectStatus,
  Role,
  Task,
  TaskComment,
  TaskPriority,
  TaskReview,
  TaskStatus,
  TimeEntry,
  UserRef,
} from "@/lib/types";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261022);
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
function weighted<T>(entries: [T, number][]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, w] of entries) {
    if ((r -= w) <= 0) return value;
  }
  return entries[0]![0];
}

const today = startOfDay(new Date());
const iso = (d: Date) => d.toISOString();
const dateOnly = (d: Date) => formatISO(d, { representation: "date" });

export const DEMO_PASSWORD = "Demo@1234";

export const organization: OrganizationSettings = {
  name: "Bizwoke Nova (Demo)",
  dueSoonThresholdDays: 2,
  reviewRequired: true,
  timezone: "UTC",
};

export interface DemoUser extends Employee {
  password: string;
}

export interface DemoHistory {
  id: string;
  action: string;
  actor: UserRef;
  description: string;
  createdAt: string;
}

export interface DemoTaskExtras {
  checklist: ChecklistItem[];
  comments: TaskComment[];
  attachments: Attachment[];
  timeEntries: TimeEntry[];
  history: DemoHistory[];
  review: TaskReview | null;
}

/** Stored task: everything except the flags computed at response time. */
export type StoredTask = Omit<Task, "isOverdue" | "isDueSoon">;

const DEPARTMENTS: [string, string, JobFunction][] = [
  ["Development", "Product engineering, platform and QA.", "developer"],
  ["HR", "People operations, hiring and employee experience.", "hr"],
  ["Marketing", "Brand, content, campaigns and growth.", "marketing"],
  ["Sales", "New business, account management and partnerships.", "sales"],
  ["Operations", "Finance, facilities, IT and internal tooling.", "operations"],
  ["Design", "Product design, research and design systems.", "design"],
  ["Support", "Customer support and success.", "support"],
];

const FIRST = ["Liam", "Noah", "Emma", "Olivia", "Mia", "Lucas", "Ethan", "Sofia", "Aria", "Mateo", "Zara", "Leo", "Ivy", "Kai", "Nora", "Omar", "Priya", "Ravi", "Hana", "Yuki", "Diego", "Elena", "Amara", "Felix", "Grace", "Hugo", "Isla", "Jonas", "Layla", "Marcus", "Nina", "Owen"];
const LAST = ["Patel", "Chen", "Garcia", "Okafor", "Nguyen", "Silva", "Kim", "Rossi", "Muller", "Haddad", "Johansson", "Kowalski", "Tanaka", "Mensah", "Novak", "Reyes", "Singh", "Laurent", "Ibrahim", "Fischer", "Costa", "Park", "Ahmed", "Moreau", "Andersen", "Bauer", "Lopez", "Sato", "Rahman", "Weber", "Dubois", "Khan"];

const TITLES: Record<string, string[]> = {
  Development: ["Implement SSO login flow", "Refactor billing service", "Fix pagination on invoices API", "Add audit logging to admin actions", "Upgrade Node runtime", "Write integration tests for checkout", "Optimise dashboard queries", "Migrate file storage to S3", "Set up staging alerts", "Build webhook retry queue", "Harden rate limiting", "Ship mobile push notifications"],
  HR: ["Update onboarding checklist", "Run Q4 engagement survey", "Draft remote work policy", "Schedule performance reviews", "Shortlist senior engineer candidates", "Prepare benefits renewal", "Revise leave policy", "Organise compliance training"],
  Marketing: ["Launch autumn campaign", "Write case study: Northwind", "Refresh pricing page copy", "Plan webinar series", "SEO audit for blog", "Produce product launch video", "Set up email nurture flow", "Prepare trade show booth"],
  Sales: ["Follow up enterprise leads", "Prepare Q4 pipeline review", "Negotiate Contoso renewal", "Build partner pitch deck", "Update CRM territory mapping", "Demo for Globex procurement", "Draft reseller agreement", "Qualify inbound leads"],
  Operations: ["Reconcile October expenses", "Renew SaaS licences", "Office network upgrade", "Vendor security reviews", "Update asset inventory", "Prepare board finance pack", "Automate payroll export", "Review travel policy"],
  Design: ["Design task board empty states", "Usability test new onboarding", "Update design tokens", "Create icon set for reports", "Redesign settings navigation", "Accessibility audit of forms", "Prototype mobile task view", "Document component guidelines"],
  Support: ["Triage priority-1 backlog", "Write help centre article: SSO", "Analyse CSAT dip", "Update macros for billing tickets", "Train team on new escalation path", "Review SLA breaches", "Build FAQ chatbot answers", "Close stale tickets"],
};

const TAGS = ["backend", "frontend", "q4", "customer", "compliance", "quick-win", "research", "release"];

const PROJECT_NAMES: Record<string, [string, string][]> = {
  Development: [["Nova Platform 3.0", "NOVA"], ["Payments Revamp", "PAY"]],
  HR: [["People Ops 2026", "PPL"]],
  Marketing: [["Autumn Launch", "AUT"], ["Content Engine", "CNT"]],
  Sales: [["Enterprise Expansion", "ENT"]],
  Operations: [["Finance Automation", "FIN"], ["Workplace Upgrade", "WRK"]],
  Design: [["Design System v2", "DSN"]],
  Support: [["Support Excellence", "SUP"]],
};

/* ---------------- Departments ---------------- */

export const departments: Department[] = DEPARTMENTS.map(([name, description], i) => ({
  id: `dep_${i + 1}`,
  name,
  description,
  managerId: null,
  managerName: null,
  employeeCount: 0,
  activeTaskCount: 0,
  completionRate: 0,
  archived: false,
  createdAt: iso(subDays(today, 400 - i * 10)),
}));

/* ---------------- Users ---------------- */

export const users: DemoUser[] = [];
let empSeq = 1001;
let nameIdx = 0;

function makeUser(
  name: string,
  email: string,
  role: Role,
  dept: Department,
  title: string,
  managerId: string | null,
  status: AccountStatus = "active"
): DemoUser {
  const [firstName = name, ...rest] = name.split(" ");
  const user: DemoUser = {
    id: `usr_${users.length + 1}`,
    employeeId: `BN-E${empSeq++}`,
    name,
    firstName,
    lastName: rest.join(" "),
    email,
    avatarUrl: null,
    title,
    departmentId: dept.id,
    departmentName: dept.name,
    role,
    jobFunction: DEPARTMENTS.find(([n]) => n === dept.name)![2],
    managerId,
    managerName: managerId ? users.find((u) => u.id === managerId)?.name ?? null : null,
    status,
    joinDate: dateOnly(subDays(today, int(30, 1400))),
    assignedTaskCount: 0,
    invitationSentAt: status === "invited" ? iso(subDays(today, int(1, 5))) : null,
    lastLoginAt: status === "active" ? iso(subHours(new Date(), int(1, 200))) : null,
    password: DEMO_PASSWORD,
  };
  users.push(user);
  return user;
}

function nextName() {
  const name = `${FIRST[nameIdx % FIRST.length]} ${LAST[(nameIdx * 7) % LAST.length]}`;
  nameIdx++;
  return name;
}
const emailFor = (name: string) => `${name.toLowerCase().replace(" ", ".")}@bizwoke.dev`;

const devDept = departments[0]!;
const hrDept = departments[1]!;
const opsDept = departments[4]!;
export const adminUser = makeUser("Ava Thompson", "admin@bizwoke.dev", "super_admin", opsDept, "Head of Operations", null);

for (const dept of departments) {
  const isDev = dept.id === devDept.id;
  const isHr = dept.id === hrDept.id;
  let manager: DemoUser;
  if (isDev) manager = makeUser("Daniel Brooks", "manager@bizwoke.dev", "manager", dept, "Engineering Manager", adminUser.id);
  else if (isHr) manager = makeUser("Rachel Owens", "hr@bizwoke.dev", "hr_manager", dept, "HR Manager", adminUser.id);
  else {
    const n = nextName();
    manager = makeUser(n, emailFor(n), "manager", dept, `${dept.name} Manager`, adminUser.id);
  }
  dept.managerId = manager.id;
  dept.managerName = manager.name;

  if (isDev) makeUser("Sarah Mitchell", "employee@bizwoke.dev", "employee", dept, "Software Engineer", manager.id);
  const headcount = isDev ? 4 : int(3, 4);
  for (let i = 0; i < headcount; i++) {
    const n = nextName();
    const status = weighted<AccountStatus>([["active", 18], ["invited", 2], ["deactivated", 1]]);
    makeUser(n, emailFor(n), "employee", dept, pick(["Specialist", "Associate", "Senior Specialist", "Coordinator", "Analyst"]), manager.id, status);
  }
}

export const toRef = (u: Pick<Employee, "id" | "name" | "email" | "avatarUrl">): UserRef => ({
  id: u.id,
  name: u.name,
  email: u.email,
  avatarUrl: u.avatarUrl ?? null,
});

/* ---------------- Projects ---------------- */

export const projects: Project[] = [];
for (const dept of departments) {
  for (const [name, key] of PROJECT_NAMES[dept.name] ?? []) {
    const manager = users.find((u) => u.id === dept.managerId)!;
    projects.push({
      id: `prj_${projects.length + 1}`,
      key,
      name,
      description: `${name} — cross-functional initiative owned by ${dept.name}.`,
      departmentId: dept.id,
      departmentName: dept.name,
      manager: toRef(manager),
      memberIds: users.filter((u) => u.departmentId === dept.id).map((u) => u.id),
      status: weighted<ProjectStatus>([["active", 7], ["planning", 1], ["on_hold", 1]]),
      startDate: dateOnly(subDays(today, int(30, 120))),
      dueDate: dateOnly(addDays(today, int(14, 120))),
      taskCount: 0,
      completedTaskCount: 0,
      archived: false,
    });
  }
}

/* ---------------- Tasks ---------------- */

export const tasks: StoredTask[] = [];
export const taskExtras = new Map<string, DemoTaskExtras>();
let taskSeq = 1001;

const progressFor: Record<TaskStatus, () => number> = {
  todo: () => 0,
  in_progress: () => pick([10, 20, 30, 40, 50, 60, 70, 80]),
  blocked: () => pick([10, 20, 30, 40]),
  in_review: () => 100,
  completed: () => 100,
  cancelled: () => pick([0, 10, 20]),
};

function createTask(project: Project, assignees: DemoUser[], status: TaskStatus, dueOffset: number) {
  const dept = departments.find((d) => d.id === project.departmentId)!;
  const manager = users.find((u) => u.id === dept.managerId)!;
  const createdBy = rand() < 0.15 ? adminUser : manager;
  const due = addDays(today, dueOffset);
  const start = subDays(due, int(3, 20));
  const estimated = pick([2, 4, 6, 8, 12, 16, 24, 32]);
  const progress = progressFor[status]();
  const actual = Math.round(estimated * (progress / 100) * (0.7 + rand() * 0.7) * 2) / 2;
  const created = subDays(start, int(0, 3));
  const updated =
    status === "completed"
      ? subHours(rand() < 0.8 ? subDays(due, int(0, 3)) : addDays(due, int(1, 4)), int(1, 8))
      : subHours(new Date(), int(1, 120));
  const shared = rand() < 0.15
    ? users.filter((u) => u.departmentId === dept.id && u.role === "employee" && !assignees.includes(u)).slice(0, 1)
    : [];
  const checklistLabels = ["Scope requirements", "Implement changes", "Peer review", "Update documentation", "Stakeholder sign-off"].slice(0, int(0, 5));
  const checklist: ChecklistItem[] = checklistLabels.map((label, i) => ({
    id: `chk_${taskSeq}_${i}`,
    label,
    done: status === "completed" || status === "in_review" || i < Math.floor((checklistLabels.length * progress) / 100),
  }));

  const id = `tsk_${taskSeq}`;
  const task: StoredTask = {
    id,
    key: `BN-${taskSeq++}`,
    title: pick(TITLES[dept.name]!),
    description:
      "Deliver the agreed scope for this work item. Keep the checklist current, log time as you go and submit for review when complete.\n\nAcceptance criteria:\n• Meets the requirements agreed with stakeholders\n• Documented and peer-reviewed\n• No open critical issues",
    projectId: project.id,
    projectName: project.name,
    departmentId: dept.id,
    departmentName: dept.name,
    assignedTo: assignees.map(toRef),
    createdBy: toRef(createdBy),
    sharedWith: shared.map(toRef),
    priority: weighted<TaskPriority>([["low", 3], ["medium", 5], ["high", 3], ["critical", 1]]),
    status,
    tags: rand() < 0.6 ? [pick(TAGS)] : [],
    // Mirrors the backend: calendar days stored as UTC day boundaries.
    startDate: `${dateOnly(start)}T00:00:00.000Z`,
    dueDate: `${dateOnly(due)}T23:59:59.999Z`,
    estimatedHours: estimated,
    actualHours: actual,
    progressPercentage: progress,
    checklistTotal: checklist.length,
    checklistDone: checklist.filter((c) => c.done).length,
    commentCount: 0,
    attachmentCount: 0,
    createdAt: iso(created),
    updatedAt: iso(updated),
  };

  const comments: TaskComment[] = rand() < 0.6
    ? [
        { id: `cmt_${id}_1`, author: toRef(createdBy), body: "Please prioritise this — it's blocking the release plan.", mentions: [], createdAt: iso(addDays(created, 1)) },
        ...(rand() < 0.6 ? [{ id: `cmt_${id}_2`, author: toRef(assignees[0]!), body: "On it. I'll post an update once the first pass is done.", mentions: [], createdAt: iso(addDays(created, 2)) }] : []),
      ]
    : [];
  const attachments: Attachment[] = rand() < 0.35
    ? [{ id: `att_${id}_1`, fileName: pick(["Requirements doc", "Wireframes", "Meeting notes", "Data export"]), url: "https://example.com/files/demo", sizeBytes: null, contentType: null, uploadedBy: toRef(createdBy), createdAt: iso(addDays(created, 1)) }]
    : [];
  const timeEntries: TimeEntry[] = actual > 0
    ? [{ id: `tim_${id}_1`, user: toRef(assignees[0]!), minutes: Math.round(actual * 60), note: "Work session", date: dateOnly(subDays(updated, 1)), createdAt: iso(subDays(updated, 1)) }]
    : [];
  const history: DemoHistory[] = [
    { id: `his_${id}_1`, action: "task.created", actor: toRef(createdBy), description: `created the task and assigned it to ${assignees.map((a) => a.name).join(", ")}`, createdAt: iso(created) },
  ];
  if (status !== "todo") {
    history.push({ id: `his_${id}_2`, action: "task.status_changed", actor: toRef(assignees[0]!), description: "changed status from To Do to In Progress", createdAt: iso(addDays(created, 1)) });
  }
  let review: TaskReview | null = null;
  if (status === "in_review" || status === "completed") {
    review = {
      state: status === "completed" ? "approved" : "pending",
      submittedBy: toRef(assignees[0]!),
      submittedAt: iso(subHours(updated, 6)),
      submissionNote: "Ready for review — all checklist items done.",
      reviewer: status === "completed" ? toRef(createdBy) : null,
      reviewedAt: status === "completed" ? iso(updated) : null,
      reviewNote: status === "completed" ? "Looks good, approved." : null,
    };
    history.push({ id: `his_${id}_3`, action: "task.review_submitted", actor: toRef(assignees[0]!), description: "submitted the task for review", createdAt: review.submittedAt });
    if (status === "completed") history.push({ id: `his_${id}_4`, action: "task.approved", actor: toRef(createdBy), description: "approved the task", createdAt: iso(updated) });
  }

  task.commentCount = comments.length;
  task.attachmentCount = attachments.length;
  tasks.push(task);
  taskExtras.set(id, { checklist, comments, attachments, timeEntries, history, review });
  return task;
}

const statusWeights: [TaskStatus, number][] = [
  ["todo", 4], ["in_progress", 5], ["blocked", 1], ["in_review", 2], ["completed", 7], ["cancelled", 0.5],
];

for (const project of projects) {
  const members = users.filter((u) => u.departmentId === project.departmentId && u.role === "employee" && u.status === "active");
  if (!members.length) continue;
  const count = int(9, 14);
  for (let i = 0; i < count; i++) {
    const status = weighted(statusWeights);
    const a1 = pick(members);
    const others = members.filter((m) => m !== a1);
    const assignees = rand() < 0.2 && others.length ? [a1, pick(others)] : [a1];
    const dueOffset = status === "completed" ? -int(1, 50) : weighted<number>([[-int(1, 10), 2], [int(0, 2), 2], [int(3, 30), 6]]);
    createTask(project, assignees, status, dueOffset);
  }
}

// Guarantee the demo employee and manager have a rich, varied workload.
const demoEmployee = users.find((u) => u.email === "employee@bizwoke.dev")!;
const demoManager = users.find((u) => u.email === "manager@bizwoke.dev")!;
const devProjects = projects.filter((p) => p.departmentId === devDept.id);
const guaranteed: [TaskStatus, number][] = [
  ["todo", 5], ["todo", 1], ["in_progress", 2], ["in_progress", 9], ["in_progress", -3],
  ["blocked", 4], ["in_review", 1], ["completed", -6], ["completed", -12], ["todo", -2], ["in_progress", 0],
];
guaranteed.forEach(([status, offset], i) => createTask(devProjects[i % devProjects.length]!, [demoEmployee], status, offset));
([["in_progress", 6], ["todo", 12], ["in_review", 2]] as [TaskStatus, number][]).forEach(([status, offset], i) => {
  const t = createTask(devProjects[i % devProjects.length]!, [demoManager], status, offset);
  t.createdBy = toRef(adminUser);
});

/* ---------------- Notifications ---------------- */

export const notificationsByUser = new Map<string, AppNotification[]>();

export function seedNotifications(userId: string) {
  const existing = notificationsByUser.get(userId);
  if (existing) return existing;
  const mine = tasks.filter((t) => t.assignedTo.some((a) => a.id === userId) || t.createdBy.id === userId).slice(0, 8);
  const kinds = ["task_assigned", "task_due_soon", "comment", "task_overdue", "review_requested", "review_approved", "changes_requested", "task_reassigned"] as const;
  const list: AppNotification[] = mine.map((t, i) => {
    const kind = kinds[i % kinds.length]!;
    const copy: Record<(typeof kinds)[number], [string, string]> = {
      task_assigned: ["New task assigned", `${t.createdBy.name} assigned you ${t.key}: ${t.title}`],
      task_due_soon: ["Task due soon", `${t.key} is due soon`],
      comment: ["New comment", `${t.createdBy.name} commented on ${t.key}`],
      task_overdue: ["Task overdue", `${t.key} has passed its due date`],
      review_requested: ["Review requested", `${t.key} was submitted for your review`],
      review_approved: ["Task approved", `${t.key} was approved`],
      changes_requested: ["Changes requested", `Changes were requested on ${t.key}`],
      task_reassigned: ["Task reassigned", `${t.key} was reassigned`],
    };
    return {
      id: `ntf_${userId}_${i}`,
      type: kind,
      title: copy[kind][0],
      body: copy[kind][1],
      read: i > 3,
      link: `/tasks/${t.id}`,
      createdAt: iso(subMinutes(new Date(), (i + 1) * int(20, 300))),
    };
  });
  list.push({ id: `ntf_${userId}_sys`, type: "system", title: "Welcome to Bizwoke Nova", body: "Your workspace is ready. Explore your tasks and dashboard.", read: true, link: null, createdAt: iso(subDays(today, 14)) });
  notificationsByUser.set(userId, list);
  return list;
}

export const preferencesByUser = new Map<string, NotificationPreferences>();

/* ---------------- Activity ---------------- */

export const activity: ActivityLog[] = [];
const ACTIONS: [string, ActivityLog["entityType"], (label: string) => string][] = [
  ["task.status_changed", "task", (l) => `moved ${l} to In Progress`],
  ["task.created", "task", (l) => `created ${l}`],
  ["task.approved", "task", (l) => `approved ${l}`],
  ["task.comment_added", "task", (l) => `commented on ${l}`],
  ["user.created", "user", (l) => `created an account for ${l}`],
  ["user.role_changed", "user", (l) => `changed the role of ${l}`],
  ["project.updated", "project", (l) => `updated project ${l}`],
  ["auth.login", "auth", () => "signed in"],
];
for (let i = 0; i < 90; i++) {
  const [action, entityType, describe] = pick(ACTIONS);
  const actor = pick(users.filter((u) => u.status === "active"));
  const task = pick(tasks);
  const project = pick(projects);
  const emp = pick(users);
  const label = entityType === "task" ? task.key : entityType === "project" ? project.name : entityType === "user" ? emp.name : null;
  activity.push({
    id: `act_${i + 1}`,
    actor: toRef(actor),
    action,
    entityType,
    entityId: entityType === "task" ? task.id : entityType === "project" ? project.id : entityType === "user" ? emp.id : null,
    entityLabel: label,
    description: describe(label ?? ""),
    createdAt: iso(subMinutes(new Date(), i * int(15, 90))),
  });
}
