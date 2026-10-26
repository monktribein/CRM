import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  FolderKanban,
  History,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  CloudUpload,
  Images,
  LogIn,
  MonitorCheck,
  MonitorPlay,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Visible if the user has any of these permissions (empty = everyone). */
  any?: Permission[];
}

export interface NavSection {
  label: string | null;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [
      { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
      { label: "My Tasks", href: "/my-tasks", icon: ListTodo },
      { label: "All Tasks", href: "/tasks", icon: ListChecks, any: ["tasks.view_all", "tasks.view_team"] },
      { label: "Task Calendar", href: "/calendar", icon: CalendarDays },
    ],
  },
  {
    label: "Organisation",
    items: [
      { label: "Projects", href: "/projects", icon: FolderKanban, any: ["projects.view"] },
      { label: "Teams & Departments", href: "/departments", icon: Building2, any: ["departments.view"] },
      { label: "Employees", href: "/employees", icon: Users, any: ["employees.view"] },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Reports & Analytics", href: "/reports", icon: BarChart3, any: ["reports.view"] },
      { label: "Activity Logs", href: "/activity", icon: History, any: ["activity.view"] },
      { label: "Screenshot Monitoring", href: "/monitoring", icon: MonitorCheck, any: ["monitoring.view"] },
    ],
  },
  {
    // Organisation-wide monitoring; Super Admin only (enforced by the API).
    label: "Employee Monitoring",
    items: [
      { label: "Login Activity", href: "/monitoring/logins", icon: LogIn, any: ["monitoring.super"] },
      { label: "Screenshot Gallery", href: "/monitoring/gallery", icon: Images, any: ["monitoring.super"] },
      { label: "Monitoring Sessions", href: "/monitoring/sessions", icon: MonitorPlay, any: ["monitoring.super"] },
      { label: "Upload & Sync Status", href: "/monitoring/uploads", icon: CloudUpload, any: ["monitoring.super"] },
      { label: "Monitoring Settings", href: "/monitoring/settings", icon: SlidersHorizontal, any: ["monitoring.super"] },
      { label: "Access Audit Logs", href: "/monitoring/audit", icon: ShieldCheck, any: ["monitoring.super"] },
    ],
  },
];

export const NAV_FOOTER: NavItem[] = [
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Settings", href: "/settings", icon: Settings },
];

/**
 * Route-level permission requirements (UX only — the API enforces access).
 * The first matching rule wins.
 */
const ROUTE_RULES: { match: (path: string) => boolean; any: Permission[] }[] = [
  { match: (p) => p === "/tasks", any: ["tasks.view_all", "tasks.view_team"] },
  { match: (p) => p === "/tasks/new" || /^\/tasks\/[^/]+\/edit$/.test(p), any: ["tasks.create"] },
  { match: (p) => p.startsWith("/projects"), any: ["projects.view"] },
  { match: (p) => p.startsWith("/departments"), any: ["departments.view"] },
  { match: (p) => p === "/employees/new", any: ["employees.manage"] },
  { match: (p) => p.startsWith("/employees"), any: ["employees.view"] },
  { match: (p) => p.startsWith("/reports"), any: ["reports.view"] },
  { match: (p) => p.startsWith("/activity"), any: ["activity.view"] },
  { match: (p) => /^\/monitoring\/(logins|gallery|sessions|uploads|settings|audit)(\/|$)/.test(p), any: ["monitoring.super"] },
  { match: (p) => p.startsWith("/monitoring"), any: ["monitoring.view"] },
];

export function requiredPermissions(pathname: string): Permission[] {
  return ROUTE_RULES.find((r) => r.match(pathname))?.any ?? [];
}

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Overview",
  "my-tasks": "My Tasks",
  tasks: "Tasks",
  new: "New",
  edit: "Edit",
  calendar: "Task Calendar",
  projects: "Projects",
  departments: "Teams & Departments",
  employees: "Employees",
  reports: "Reports & Analytics",
  notifications: "Notifications",
  activity: "Activity Logs",
  monitoring: "Screenshot Monitoring",
  logins: "Login Activity",
  gallery: "Screenshot Gallery",
  sessions: "Monitoring Sessions",
  uploads: "Upload & Sync Status",
  audit: "Access Audit Logs",
  settings: "Settings",
};

export function segmentLabel(segment: string) {
  return SEGMENT_LABELS[segment];
}
