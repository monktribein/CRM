import type { Permission, Role } from '../roles/permissions.js';

/**
 * The authenticated principal, resolved server-side from the access token
 * and the database on every request. Never built from client input.
 */
export interface AuthUser {
  id: string;
  organizationId: string;
  role: Role;
  departmentId: string | null;
  name: string;
  email: string;
  permissions: readonly Permission[];
}

export function can(user: AuthUser, permission: Permission) {
  return user.permissions.includes(permission);
}
