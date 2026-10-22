import type { CurrentUser, Permission } from "@/lib/types";

/**
 * Frontend permission helpers. These only decide what to *show*; the backend
 * must enforce every permission on every request.
 */
export function hasPermission(
  user: CurrentUser | null | undefined,
  permission: Permission
): boolean {
  return !!user && user.permissions.includes(permission);
}

export function hasAnyPermission(
  user: CurrentUser | null | undefined,
  permissions: Permission[]
): boolean {
  if (permissions.length === 0) return !!user;
  return permissions.some((p) => hasPermission(user, p));
}
