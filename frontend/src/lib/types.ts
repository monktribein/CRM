/**
 * Shared domain types. These mirror the backend API contract
 * (backend/src/**\/dto + mappers). Keep the two in sync.
 */

/** Security role — what a user may do. Independent of job function. */
export type Role = "super_admin" | "admin" | "hr_manager" | "manager" | "employee";

/** Job function — what a user does. Independent of security role. */
export type JobFunction =
  | "developer"
  | "hr"
  | "marketing"
  | "sales"
  | "operations"
  | "design"
  | "support"
  | "other";

export type Permission =
  | "dashboard.admin"
  | "dashboard.manager"
  | "tasks.view_all"
  | "tasks.view_team"
  | "tasks.create"
  | "tasks.assign"
  | "tasks.review"
  | "tasks.delete"
  | "projects.view"
  | "projects.manage"
  | "departments.view"
  | "departments.manage"
  | "employees.view"
  | "employees.manage"
  | "employees.grant_privileged"
  | "reports.view"
  | "reports.export"
  | "activity.view"
  | "settings.org"
  | "monitoring.view"
  | "monitoring.manage"
  | "monitoring.super";

export type TaskStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "in_review"
  | "completed"
  | "cancelled";

export type TaskPriority = "low" | "medium" | "high" | "critical";

export type AccountStatus = "invited" | "active" | "deactivated";

export interface UserRef {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

export interface CurrentUser extends UserRef {
  employeeId: string;
  role: Role;
  jobFunction: JobFunction;
  title?: string | null;
  departmentId: string | null;
  departmentName: string | null;
  organizationName: string;
  /** Authoritative permission list issued by the backend. */
  permissions: Permission[];
}

/** Short-lived access token. The refresh token is an HttpOnly cookie. */
export interface Session {
  accessToken: string;
  /** ISO timestamp. */
  expiresAt: string;
}

export interface LoginResponse extends Session {
  user: CurrentUser;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Department {
  id: string;
  name: string;
  description?: string | null;
  managerId?: string | null;
  managerName?: string | null;
  employeeCount: number;
  activeTaskCount: number;
  completionRate: number;
  archived: boolean;
  createdAt: string;
}

export type ProjectStatus = "planning" | "active" | "on_hold" | "completed";

export interface Project {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  departmentId: string;
  departmentName: string;
  manager: UserRef | null;
  memberIds: string[];
  status: ProjectStatus;
  startDate: string;
  dueDate: string;
  taskCount: number;
  completedTaskCount: number;
  archived: boolean;
}

export interface Task {
  id: string;
  /** Human-readable task ID, e.g. "BN-1024". */
  key: string;
  title: string;
  description: string;
  projectId: string;
  projectName: string;
  departmentId: string;
  departmentName: string;
  /** Assigned employees. */
  assignedTo: UserRef[];
  /** The assigning manager. */
  createdBy: UserRef;
  sharedWith: UserRef[];
  priority: TaskPriority;
  status: TaskStatus;
  tags: string[];
  /** UTC ISO timestamps. */
  startDate: string;
  dueDate: string;
  estimatedHours: number;
  actualHours: number;
  progressPercentage: number;
  /** Computed by the backend: past due and not completed/cancelled. */
  isOverdue: boolean;
  /** Computed by the backend using the organisation's configurable threshold. */
  isDueSoon: boolean;
  checklistTotal: number;
  checklistDone: number;
  commentCount: number;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface TaskComment {
  id: string;
  author: UserRef;
  body: string;
  mentions: string[];
  createdAt: string;
}

/** Attachment metadata. Files live in external storage referenced by URL. */
export interface Attachment {
  id: string;
  fileName: string;
  url: string;
  sizeBytes?: number | null;
  contentType?: string | null;
  uploadedBy: UserRef;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  user: UserRef;
  minutes: number;
  note?: string | null;
  date: string;
  createdAt: string;
}

/** An entry from GET /tasks/:id/activity. */
export interface TaskActivity {
  id: string;
  action: string;
  actor: UserRef;
  description: string;
  createdAt: string;
}

export type ReviewState = "pending" | "approved" | "changes_requested";

export interface TaskReview {
  state: ReviewState;
  submittedBy: UserRef;
  submittedAt: string;
  submissionNote?: string | null;
  reviewer?: UserRef | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
}

/**
 * Per-task capabilities computed by the backend for the current user.
 * The UI only uses these to hide controls; the backend re-checks every call.
 */
export interface TaskCapabilities {
  canEdit: boolean;
  canReassign: boolean;
  canChangeStatus: boolean;
  /** Statuses the current user may move this task to right now. */
  allowedStatuses: TaskStatus[];
  canUpdateProgress: boolean;
  canLogTime: boolean;
  canComment: boolean;
  canAttach: boolean;
  canEditChecklist: boolean;
  canSubmitForReview: boolean;
  canReview: boolean;
}

export interface TaskDetail extends Task {
  checklist: ChecklistItem[];
  comments: TaskComment[];
  attachments: Attachment[];
  timeEntries: TimeEntry[];
  review: TaskReview | null;
  capabilities: TaskCapabilities;
}

export type TaskScope = "mine" | "all";

export type TaskSortField = "dueDate" | "priority" | "updatedAt" | "status" | "title" | "key";

export interface TaskQuery {
  scope: TaskScope;
  search?: string;
  status?: TaskStatus[];
  priority?: TaskPriority[];
  departmentId?: string;
  projectId?: string;
  assigneeId?: string;
  dueFrom?: string;
  dueTo?: string;
  overdue?: boolean;
  tag?: string;
  sort?: TaskSortField;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface TaskInput {
  title: string;
  description: string;
  projectId: string;
  departmentId: string;
  assigneeIds: string[];
  priority: TaskPriority;
  startDate: string;
  dueDate: string;
  estimatedHours: number;
  tags: string[];
  checklist: { label: string }[];
}

export interface Employee {
  id: string;
  employeeId: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl?: string | null;
  title?: string | null;
  departmentId: string | null;
  departmentName: string | null;
  role: Role;
  jobFunction: JobFunction;
  managerId: string | null;
  managerName: string | null;
  status: AccountStatus;
  joinDate: string;
  assignedTaskCount: number;
  invitationSentAt?: string | null;
  lastLoginAt?: string | null;
}

/** Returned when an account is created or an invitation is re-issued. */
export interface InvitationResult {
  user: Employee;
  /**
   * One-time activation link. Only returned when email delivery is not
   * configured, so the administrator can share it securely.
   */
  invitationUrl: string | null;
  emailSent: boolean;
}

export interface EmployeeQuery {
  search?: string;
  departmentId?: string;
  role?: Role[];
  status?: AccountStatus;
  page?: number;
  pageSize?: number;
}

export interface EmployeeInput {
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  role: Role;
  jobFunction: JobFunction;
  departmentId: string;
  managerId?: string | null;
  joinDate: string;
  sendInvitation: boolean;
  /** Admin-set sign-in password. When present the account is active immediately. */
  password?: string;
}

export interface EmployeeUpdateInput {
  firstName?: string;
  lastName?: string;
  title?: string;
  role?: Role;
  jobFunction?: JobFunction;
  departmentId?: string;
  managerId?: string | null;
}

export type NotificationType =
  | "task_assigned"
  | "task_reassigned"
  | "task_due_soon"
  | "task_overdue"
  | "review_requested"
  | "review_approved"
  | "changes_requested"
  | "comment"
  | "mention"
  | "system";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  link?: string | null;
  createdAt: string;
}

export type ActivityEntity = "task" | "user" | "project" | "department" | "auth" | "settings" | "monitoring";

/* ---------- Screenshot monitoring ---------- */

export type ConsentDecision = "granted" | "declined";

/** The signed-in employee's own monitoring requirement. */
export interface MyMonitoringStatus {
  required: boolean;
  policy: { version: string; text: string } | null;
  consent: { decision: ConsentDecision | null; policyVersion: string | null; at: string | null };
  needsConsent: boolean;
  captureIntervalSeconds: number;
  heartbeatIntervalSeconds: number;
  localRetentionHours: number;
}

export type MonitoringSessionStatus = "active" | "ended" | "expired";
export type MonitoringEndReason =
  | "logout"
  | "user_stopped"
  | "stream_ended"
  | "page_closed"
  | "session_expired"
  | "heartbeat_timeout"
  | "superseded"
  | "monitoring_disabled";

/** Administrator-facing status: "ended" is a confirmed logout or stop; "interrupted" is anything else. */
export type SessionDisplayStatus = "active" | "ended" | "expired" | "interrupted";

export interface MonitoringSession {
  id: string;
  userId: string;
  status: MonitoringSessionStatus;
  displayStatus: SessionDisplayStatus;
  /** The employee's sign-in time. */
  loginAt: string | null;
  /** Set only for a confirmed logout — never inferred from a timeout. */
  logoutAt: string | null;
  lastUploadAt: string | null;
  clientQueue: { pending: number; oldestCapturedAt: string | null; reportedAt: string } | null;
  startedAt: string;
  lastHeartbeatAt: string;
  endedAt: string | null;
  endReason: MonitoringEndReason | null;
  displaySurface: string | null;
  captureCount: number;
  lastCaptureAt: string | null;
  policyVersion: string;
}

export interface MonitoringPolicy {
  enabled: boolean;
  policyVersion: string;
  policyText: string;
  retentionDays: number;
  localRetentionHours: number;
  storageConfigured: boolean;
  captureIntervalSeconds: number;
}

export interface EmployeeMonitoringStatus {
  userId: string;
  employeeId: string;
  name: string;
  email: string;
  enabled: boolean;
  required: boolean;
  consent: { decision: ConsentDecision | null; policyVersion: string | null; at: string | null; current: boolean };
  latestSession: MonitoringSession | null;
  lastCaptureAt: string | null;
  failedUploads: number;
}

export interface ScreenshotRecord {
  id: string;
  userId: string;
  sessionId: string;
  captureId: string;
  capturedAt: string;
  status: "pending" | "uploading" | "uploaded" | "failed" | "deleted";
  attempts: number;
  uploadedAt: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  expiresAt: string;
  width: number | null;
  height: number | null;
  lastError: string | null;
  availability: ScreenshotAvailability;
}

export type ScreenshotAvailability = "available" | "pending" | "failed" | "missing" | "deleted";

/* ---------- Super Admin monitoring dashboard ---------- */

export interface MonitoredEmployee {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  departmentId: string | null;
  departmentName: string | null;
  jobFunction: JobFunction;
  consent: { decision: ConsentDecision | null; policyVersion: string | null; at: string | null; current: boolean };
}

export interface AdminSessionRow extends MonitoringSession {
  employee: MonitoredEmployee | null;
}

export interface AdminSessionDetail extends AdminSessionRow {
  screenshotCounts: Partial<Record<ScreenshotRecord["status"], number>>;
  timezone: string;
}

export interface AdminScreenshot extends ScreenshotRecord {
  employee: { id: string; employeeId: string; name: string } | null;
}

export type SessionSort = "startedAt" | "loginAt" | "lastHeartbeatAt" | "endedAt" | "captureCount" | "lastUploadAt";

export interface AdminSessionQuery {
  search?: string;
  departmentId?: string;
  userId?: string;
  status?: SessionDisplayStatus;
  /** Calendar days (YYYY-MM-DD) in the organisation timezone. */
  from?: string;
  to?: string;
  sort?: SessionSort;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface AdminScreenshotQuery {
  sessionId?: string;
  userId?: string;
  departmentId?: string;
  availability?: ScreenshotAvailability;
  from?: string;
  to?: string;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface UploadSyncStatus {
  storageConfigured: boolean;
  counts: Record<"uploaded" | "pending" | "uploading" | "failed" | "deleted" | "missing", number>;
  oldestUnsentCapturedAt: string | null;
  problems: (AdminScreenshot & { updatedAt: string })[];
  browserBacklog: { sessionId: string; employee: AdminScreenshot["employee"]; clientQueue: NonNullable<MonitoringSession["clientQueue"]> }[];
}

export type AccessAction = "previewed" | "downloaded" | "deleted" | "retention_purged";

export interface AccessLogEntry {
  id: string;
  action: AccessAction;
  actor: { id: string | null; name: string; role: Role | null };
  employee: { id: string; employeeId: string | null; name: string };
  screenshotId: string;
  sessionId: string;
  capturedAt: string;
  ip: string | null;
  createdAt: string;
}

export interface AccessAuditQuery {
  action?: AccessAction;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface ActivityLog {
  id: string;
  actor: UserRef;
  action: string;
  entityType: ActivityEntity;
  entityId: string | null;
  entityLabel: string | null;
  description: string;
  createdAt: string;
}

export interface ActivityQuery {
  search?: string;
  entityType?: ActivityEntity;
  page?: number;
  pageSize?: number;
}

/* ---------- Dashboards ---------- */

export interface TrendPoint {
  date: string;
  created: number;
  completed: number;
}

export interface AdminDashboard {
  role: "admin";
  stats: {
    totalEmployees: number;
    activeTasks: number;
    completedTasks: number;
    overdueTasks: number;
  };
  departmentPerformance: {
    departmentId: string;
    department: string;
    completed: number;
    active: number;
    overdue: number;
    onTimeRate: number;
  }[];
  completionTrend: TrendPoint[];
  recentActivity: ActivityLog[];
  attentionEmployees: {
    employee: UserRef & { departmentName: string | null };
    overdueCount: number;
    blockedCount: number;
  }[];
}

export interface WorkloadRow {
  member: UserRef;
  todo: number;
  inProgress: number;
  inReview: number;
  blocked: number;
}

export interface TeamPerformanceRow {
  member: UserRef;
  completed: number;
  overdue: number;
  onTimeRate: number;
}

export interface ManagerDashboard {
  role: "manager";
  stats: {
    assignedByMe: number;
    overdue: number;
    atRisk: number;
    pendingReviews: number;
  };
  riskTasks: Task[];
  departmentProgress: {
    department: string;
    completed: number;
    total: number;
    projects: { projectId: string; project: string; completed: number; total: number }[];
  } | null;
  pendingReviews: Task[];
}

export interface EmployeeDashboard {
  role: "employee";
  stats: {
    total: number;
    todo: number;
    inProgress: number;
    inReview: number;
    completed: number;
    overdue: number;
  };
  upcoming: Task[];
  productivity: { label: string; completed: number; hours: number }[];
}

export type DashboardData = AdminDashboard | ManagerDashboard | EmployeeDashboard;

/* ---------- Reports ---------- */

export interface ReportQuery {
  from: string;
  to: string;
  departmentId?: string;
  projectId?: string;
}

/** GET /reports/tasks */
export interface TaskReport {
  range: { from: string; to: string };
  totals: { total: number; completed: number; overdue: number; open: number };
  onTime: { onTime: number; late: number };
  statusDistribution: { status: TaskStatus; count: number }[];
  productivity: {
    weekly: { label: string; completed: number; hours: number }[];
    monthly: { label: string; completed: number; hours: number }[];
  };
  projectProgress: { projectId: string; project: string; completed: number; total: number }[];
  overdue: Pick<Task, "id" | "key" | "title" | "dueDate" | "priority" | "status" | "assignedTo" | "departmentName">[];
}

/** GET /reports/employees */
export interface EmployeeReportRow {
  userId: string;
  name: string;
  departmentName: string | null;
  open: number;
  completed: number;
  overdue: number;
  estimatedOpenHours: number;
  loggedHours: number;
  onTimeRate: number;
}

/** GET /reports/departments */
export interface DepartmentReportRow {
  departmentId: string;
  department: string;
  total: number;
  completed: number;
  overdue: number;
  onTimeRate: number;
}

export type ReportKind = "tasks" | "employees" | "departments";

export interface SearchResults {
  tasks: Pick<Task, "id" | "key" | "title" | "status">[];
  employees: Pick<Employee, "id" | "name" | "email" | "departmentName">[];
  projects: Pick<Project, "id" | "key" | "name">[];
}

export interface OrganizationSettings {
  name: string;
  dueSoonThresholdDays: number;
  reviewRequired: boolean;
  timezone: string;
}

export interface NotificationPreferences {
  emailAssignments: boolean;
  emailDueReminders: boolean;
  emailReviews: boolean;
  inAppComments: boolean;
  dailyDigest: boolean;
}

/** GET /reports/activity — what was worked on in the selected range. */
export interface WorkDetailTask {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  priority: Task["priority"];
  progressPercentage: number;
  dueDate: string;
  completedAt: string | null;
  completedInRange: boolean;
  departmentName: string;
  projectName: string;
  assignedTo: Task["assignedTo"];
  subtasks: { done: number; total: number; items: { id: string; label: string; done: boolean }[] };
  loggedMinutes: number;
  timeEntries: { date: string; minutes: number; note: string | null; by: string }[];
  activity: { at: string; action: string; by: string; description: string }[];
}
export interface WorkDetailReport {
  range: { from: string; to: string };
  summary: { tasksWorked: number; completed: number; loggedMinutes: number; activities: number };
  tasks: WorkDetailTask[];
}
