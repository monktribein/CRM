import type {
  AccessAuditQuery,
  ActivityQuery,
  AdminScreenshotQuery,
  AdminSessionQuery,
  EmployeeQuery,
  ReportQuery,
  TaskQuery,
} from "@/lib/types";

/** Central TanStack Query keys so invalidation stays consistent. */
export const qk = {
  dashboard: ["dashboard"] as const,
  dashboardSummary: () => [...qk.dashboard, "summary"] as const,
  workload: () => [...qk.dashboard, "workload"] as const,
  teamPerformance: () => [...qk.dashboard, "team-performance"] as const,

  tasks: ["tasks"] as const,
  taskList: (q: TaskQuery) => [...qk.tasks, "list", q] as const,
  task: (id: string) => [...qk.tasks, "detail", id] as const,
  taskActivity: (id: string) => [...qk.tasks, "activity", id] as const,
  assignable: () => [...qk.tasks, "assignable"] as const,

  users: ["users"] as const,
  userList: (q: EmployeeQuery) => [...qk.users, "list", q] as const,

  departments: (includeArchived = false) => ["departments", { includeArchived }] as const,
  projects: (includeArchived = false) => ["projects", { includeArchived }] as const,

  reports: (kind: string, q: ReportQuery) => ["reports", kind, q] as const,

  notifications: ["notifications"] as const,
  notificationList: (unreadOnly: boolean, page: number) => [...qk.notifications, "list", unreadOnly, page] as const,
  unreadCount: () => [...qk.notifications, "unread"] as const,

  activity: (q: ActivityQuery) => ["activity", q] as const,
  orgSettings: () => ["settings", "organization"] as const,
  preferences: () => ["settings", "notifications"] as const,
  search: (q: string) => ["search", q] as const,

  monitoring: ["monitoring"] as const,
  monitoringPolicy: () => [...qk.monitoring, "policy"] as const,
  monitoringEmployees: (q: { search?: string; page?: number }) => [...qk.monitoring, "employees", q] as const,
  monitoringEmployee: (userId: string) => [...qk.monitoring, "employee", userId] as const,
  monitoringSessions: (userId: string) => [...qk.monitoring, "sessions", userId] as const,
  screenshots: (q: { userId: string; sessionId?: string; page?: number }) => [...qk.monitoring, "screenshots", q] as const,
  adminSessions: (q: AdminSessionQuery) => [...qk.monitoring, "admin", "sessions", q] as const,
  adminSession: (id: string) => [...qk.monitoring, "admin", "session", id] as const,
  adminScreenshots: (q: AdminScreenshotQuery) => [...qk.monitoring, "admin", "screenshots", q] as const,
  adminImage: (id: string) => [...qk.monitoring, "admin", "image", id] as const,
  uploadStatus: () => [...qk.monitoring, "admin", "uploads"] as const,
  accessLogs: (q: AccessAuditQuery) => [...qk.monitoring, "admin", "access", q] as const,
};
