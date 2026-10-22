import { apiDownload, apiPaginated, apiRequest } from "@/lib/api/client";
import type {
  ActivityLog,
  ActivityQuery,
  AppNotification,
  CurrentUser,
  DashboardData,
  Department,
  DepartmentReportRow,
  Employee,
  EmployeeInput,
  EmployeeQuery,
  EmployeeReportRow,
  EmployeeUpdateInput,
  InvitationResult,
  LoginResponse,
  NotificationPreferences,
  OrganizationSettings,
  Project,
  ProjectStatus,
  ReportKind,
  ReportQuery,
  SearchResults,
  Task,
  TaskActivity,
  TaskDetail,
  TaskInput,
  TaskQuery,
  TaskReport,
  TaskStatus,
  TeamPerformanceRow,
  UserRef,
  WorkloadRow,
} from "@/lib/types";

/**
 * Typed wrappers for every backend endpoint. Paths are relative to
 * NEXT_PUBLIC_API_URL, which includes the version prefix (…/api/v1).
 */
const id = (value: string) => encodeURIComponent(value);

export const authApi = {
  login: (email: string, password: string) =>
    apiRequest<LoginResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
      skipAuthRefresh: true,
    }),
  logout: () => apiRequest<void>("/auth/logout", { method: "POST", skipAuthRefresh: true }),
  me: () => apiRequest<CurrentUser>("/auth/me"),
  forgotPassword: (email: string) =>
    apiRequest<void>("/auth/forgot-password", { method: "POST", body: { email }, skipAuthRefresh: true }),
  resetPassword: (token: string, password: string) =>
    apiRequest<void>("/auth/reset-password", {
      method: "POST",
      body: { token, password },
      skipAuthRefresh: true,
    }),
  acceptInvitation: (token: string, password: string) =>
    apiRequest<void>("/auth/accept-invitation", {
      method: "POST",
      body: { token, password },
      skipAuthRefresh: true,
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiRequest<void>("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } }),
};

export const dashboardApi = {
  summary: () => apiRequest<DashboardData>("/dashboard/summary"),
  workload: () => apiRequest<WorkloadRow[]>("/dashboard/workload"),
  teamPerformance: () => apiRequest<TeamPerformanceRow[]>("/dashboard/team-performance"),
};

export const tasksApi = {
  list: (query: TaskQuery) => apiPaginated<Task>("/tasks", { query: { ...query } }),
  get: (taskId: string) => apiRequest<TaskDetail>(`/tasks/${id(taskId)}`),
  activity: (taskId: string) => apiRequest<TaskActivity[]>(`/tasks/${id(taskId)}/activity`),
  create: (input: TaskInput) => apiRequest<TaskDetail>("/tasks", { method: "POST", body: input }),
  update: (taskId: string, input: Partial<Omit<TaskInput, "assigneeIds" | "checklist">>) =>
    apiRequest<TaskDetail>(`/tasks/${id(taskId)}`, { method: "PATCH", body: input }),
  updateStatus: (taskId: string, status: TaskStatus, reason?: string) =>
    apiRequest<TaskDetail>(`/tasks/${id(taskId)}/status`, { method: "PATCH", body: { status, reason } }),
  updateProgress: (taskId: string, progressPercentage: number) =>
    apiRequest<TaskDetail>(`/tasks/${id(taskId)}/progress`, { method: "PATCH", body: { progressPercentage } }),
  assign: (taskId: string, assigneeIds: string[]) =>
    apiRequest<TaskDetail>(`/tasks/${id(taskId)}/assignments`, { method: "POST", body: { assigneeIds } }),
  logTime: (taskId: string, entry: { minutes: number; date: string; note?: string }) =>
    apiRequest<TaskDetail>(`/tasks/${id(taskId)}/time-entries`, { method: "POST", body: entry }),
  addComment: (taskId: string, body: string) =>
    apiRequest<TaskDetail>(`/tasks/${id(taskId)}/comments`, { method: "POST", body: { body } }),
  addAttachment: (taskId: string, input: { fileName: string; url: string }) =>
    apiRequest<TaskDetail>(`/tasks/${id(taskId)}/attachments`, { method: "POST", body: input }),
  addChecklistItem: (taskId: string, label: string) =>
    apiRequest<TaskDetail>(`/tasks/${id(taskId)}/checklist`, { method: "POST", body: { label } }),
  toggleChecklistItem: (taskId: string, itemId: string, done: boolean) =>
    apiRequest<TaskDetail>(`/tasks/${id(taskId)}/checklist/${id(itemId)}`, { method: "PATCH", body: { done } }),
  submitForReview: (taskId: string, note?: string) =>
    apiRequest<TaskDetail>(`/tasks/${id(taskId)}/submit-review`, { method: "POST", body: { note } }),
  approve: (taskId: string, note?: string) =>
    apiRequest<TaskDetail>(`/tasks/${id(taskId)}/approve`, { method: "POST", body: { note } }),
  requestChanges: (taskId: string, note: string) =>
    apiRequest<TaskDetail>(`/tasks/${id(taskId)}/request-changes`, { method: "POST", body: { note } }),
  /** Employees the current user may assign tasks to (backend-filtered). */
  assignableUsers: () =>
    apiRequest<(UserRef & { departmentId: string | null })[]>("/tasks/assignable-users"),
};

export const usersApi = {
  list: (query: EmployeeQuery) => apiPaginated<Employee>("/users", { query: { ...query } }),
  get: (userId: string) => apiRequest<Employee>(`/users/${id(userId)}`),
  create: (input: EmployeeInput) => apiRequest<InvitationResult>("/users", { method: "POST", body: input }),
  update: (userId: string, input: EmployeeUpdateInput) =>
    apiRequest<Employee>(`/users/${id(userId)}`, { method: "PATCH", body: input }),
  setStatus: (userId: string, status: "active" | "deactivated") =>
    apiRequest<Employee>(`/users/${id(userId)}/status`, { method: "PATCH", body: { status } }),
  remove: (userId: string) => apiRequest<void>(`/users/${id(userId)}`, { method: "DELETE" }),
  resendInvitation: (userId: string) =>
    apiRequest<InvitationResult>(`/users/${id(userId)}/invitation`, { method: "POST" }),
  updateProfile: (input: { firstName: string; lastName: string; title?: string }) =>
    apiRequest<CurrentUser>("/users/me", { method: "PATCH", body: input }),
};

export const departmentsApi = {
  list: (includeArchived = false) =>
    apiRequest<Department[]>("/departments", { query: { includeArchived } }),
  create: (input: { name: string; description?: string; managerId?: string | null }) =>
    apiRequest<Department>("/departments", { method: "POST", body: input }),
  update: (departmentId: string, input: { name?: string; description?: string; managerId?: string | null }) =>
    apiRequest<Department>(`/departments/${id(departmentId)}`, { method: "PATCH", body: input }),
  archive: (departmentId: string) =>
    apiRequest<Department>(`/departments/${id(departmentId)}/archive`, { method: "PATCH" }),
};

export interface ProjectInput {
  name: string;
  key: string;
  description?: string;
  departmentId: string;
  managerId?: string | null;
  status: ProjectStatus;
  startDate: string;
  dueDate: string;
}

export const projectsApi = {
  list: (includeArchived = false) => apiRequest<Project[]>("/projects", { query: { includeArchived } }),
  create: (input: ProjectInput) => apiRequest<Project>("/projects", { method: "POST", body: input }),
  update: (projectId: string, input: Partial<ProjectInput>) =>
    apiRequest<Project>(`/projects/${id(projectId)}`, { method: "PATCH", body: input }),
  archive: (projectId: string) => apiRequest<Project>(`/projects/${id(projectId)}/archive`, { method: "PATCH" }),
};

export const reportsApi = {
  tasks: (query: ReportQuery) => apiRequest<TaskReport>("/reports/tasks", { query: { ...query } }),
  employees: (query: ReportQuery) =>
    apiRequest<EmployeeReportRow[]>("/reports/employees", { query: { ...query } }),
  departments: (query: ReportQuery) =>
    apiRequest<DepartmentReportRow[]>("/reports/departments", { query: { ...query } }),
  /** CSV generated server-side from live data. */
  exportCsv: (kind: ReportKind, query: ReportQuery) =>
    apiDownload(`/reports/${kind}`, { query: { ...query, format: "csv" } }),
};

export const notificationsApi = {
  list: (params: { unreadOnly?: boolean; page?: number; pageSize?: number } = {}) =>
    apiPaginated<AppNotification>("/notifications", { query: params }),
  unreadCount: () => apiRequest<{ count: number }>("/notifications/unread-count"),
  markRead: (notificationId: string) =>
    apiRequest<void>(`/notifications/${id(notificationId)}/read`, { method: "PATCH" }),
  markAllRead: () => apiRequest<void>("/notifications/read-all", { method: "POST" }),
};

export const activityApi = {
  list: (query: ActivityQuery) => apiPaginated<ActivityLog>("/activity-logs", { query: { ...query } }),
};

export const settingsApi = {
  organization: () => apiRequest<OrganizationSettings>("/settings/organization"),
  updateOrganization: (input: Partial<OrganizationSettings>) =>
    apiRequest<OrganizationSettings>("/settings/organization", { method: "PATCH", body: input }),
  preferences: () => apiRequest<NotificationPreferences>("/settings/notifications"),
  updatePreferences: (prefs: NotificationPreferences) =>
    apiRequest<NotificationPreferences>("/settings/notifications", { method: "PUT", body: prefs }),
};

export const searchApi = {
  search: (q: string, signal?: AbortSignal) => apiRequest<SearchResults>("/search", { query: { q }, signal }),
};
