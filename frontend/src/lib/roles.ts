import type { JobFunction, Role } from "@/lib/types";

export const roleMeta: Record<Role, { label: string; description: string }> = {
  super_admin: { label: "Super Admin", description: "Organisation configuration and every admin capability." },
  admin: { label: "Admin", description: "Manages employees, departments, projects, tasks and org-wide reports." },
  hr_manager: { label: "HR Manager", description: "Manages employee records and HR workflows." },
  manager: { label: "Manager", description: "Assigns and reviews tasks and sees workload for their teams." },
  employee: { label: "Employee", description: "Works on assigned and shared tasks." },
};

export const ROLE_ORDER: Role[] = ["employee", "manager", "hr_manager", "admin", "super_admin"];

export const jobFunctionLabels: Record<JobFunction, string> = {
  developer: "Developer",
  hr: "HR",
  marketing: "Marketing",
  sales: "Sales",
  operations: "Operations",
  design: "Design",
  support: "Support",
  other: "Other",
};

/**
 * Roles the current user may grant — mirrors the backend rule so the form
 * only offers valid options. The backend still rejects anything else.
 */
export function grantableRoles(actor: Role): Role[] {
  switch (actor) {
    case "super_admin":
      return ROLE_ORDER;
    case "admin":
      return ["employee", "manager", "hr_manager", "admin"];
    case "hr_manager":
      return ["employee", "manager"];
    default:
      return [];
  }
}
