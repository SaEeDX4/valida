/**
 * Roles and permissions — Doc 11 sections 146-152 (E1).
 *
 * Server authorization is by explicit permission, mapped from roles here and
 * nowhere else (s149). Default deny (s152): a permission not listed for a role
 * is not granted.
 */

export const PERMISSIONS = Object.freeze([
  'jobs:read',
  'jobs:create',
  'jobs:update',
  'jobs:publish',
  'jobs:close',
  'jobs:archive',
  'applications:read',
  'applications:status:update',
  'applications:notes:write',
  'applications:resume:read',
  'applications:communication',
  'audit:read',
  'admins:read',
  'admins:create',
  'admins:update',
  'admins:disable',
  'admins:roles:update',
]);

const RECRUITMENT = Object.freeze([
  'jobs:read',
  'jobs:create',
  'jobs:update',
  'jobs:publish',
  'jobs:close',
  'jobs:archive',
  'applications:read',
  'applications:status:update',
  'applications:notes:write',
  'applications:resume:read',
  'applications:communication',
]);

export const ROLE_PERMISSIONS = Object.freeze({
  ADMIN_OWNER: PERMISSIONS, // s151: all Phase 3 permissions
  RECRUITMENT_ADMIN: RECRUITMENT, // s151: not admins:* and not audit:read
});

/** The permission set of a role list; unknown roles grant nothing. */
export function permissionsFor(roles) {
  const granted = new Set();
  for (const role of Array.isArray(roles) ? roles : []) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) granted.add(permission);
  }
  return granted;
}

export function hasPermission(roles, permission) {
  return permissionsFor(roles).has(permission);
}
