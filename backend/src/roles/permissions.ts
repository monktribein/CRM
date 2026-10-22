/**
 * Security model. Roles describe what a user may do; job functions describe
 * what they do. The two are deliberately independent — a developer can be an
 * Employee or a Manager.
 */
export const ROLES = ['super_admin', 'admin', 'hr_manager', 'manager', 'employee'] as const;
export type Role = (typeof ROLES)[number];

export const JOB_FUNCTIONS = [
  'developer',
  'hr',
  'marketing',
  'sales',
  'operations',
  'design',
  'support',
  'other',
] as const;
export type JobFunction = (typeof JOB_FUNCTIONS)[number];

export const PERMISSIONS = [
  'dashboard.admin',
  'dashboard.manager',
  'tasks.view_all',
  'tasks.view_team',
  'tasks.create',
  'tasks.assign',
  'tasks.review',
  'tasks.delete',
  'projects.view',
  'projects.manage',
  'departments.view',
  'departments.manage',
  'employees.view',
  'employees.manage',
  'employees.grant_privileged',
  'reports.view',
  'reports.export',
  'activity.view',
  'settings.org',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ADMIN: readonly Permission[] = [
  'dashboard.admin',
  'tasks.view_all',
  'tasks.view_team',
  'tasks.create',
  'tasks.assign',
  'tasks.review',
  'tasks.delete',
  'projects.view',
  'projects.manage',
  'departments.view',
  'departments.manage',
  'employees.view',
  'employees.manage',
  'employees.grant_privileged',
  'reports.view',
  'reports.export',
  'activity.view',
  'settings.org',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: ADMIN,
  admin: ADMIN,
  hr_manager: ['employees.view', 'employees.manage', 'departments.view', 'projects.view', 'activity.view'],
  manager: [
    'dashboard.manager',
    'tasks.view_team',
    'tasks.create',
    'tasks.assign',
    'tasks.review',
    'projects.view',
    'departments.view',
    'employees.view',
    'reports.view',
    'reports.export',
    'activity.view',
  ],
  employee: ['projects.view'],
};

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Roles an actor may grant, and therefore the roles of accounts they may
 * modify. Only a Super Admin can create or modify another Super Admin.
 */
export function grantableRoles(actor: Role): Role[] {
  switch (actor) {
    case 'super_admin':
      return [...ROLES];
    case 'admin':
      return ['employee', 'manager', 'hr_manager', 'admin'];
    case 'hr_manager':
      return ['employee', 'manager'];
    default:
      return [];
  }
}

/** Roles that can be a reporting manager or department manager. */
export const MANAGERIAL_ROLES: Role[] = ['super_admin', 'admin', 'hr_manager', 'manager'];
