import { grantableRoles, permissionsFor, roleHas, ROLES } from './permissions.js';

describe('role permissions', () => {
  it('gives employees no management or organisation-wide permissions', () => {
    const p = permissionsFor('employee');
    expect(p).not.toContain('tasks.view_all');
    expect(p).not.toContain('tasks.create');
    expect(p).not.toContain('employees.view');
    expect(p).not.toContain('reports.view');
  });

  it('scopes managers to their teams', () => {
    expect(roleHas('manager', 'tasks.view_team')).toBe(true);
    expect(roleHas('manager', 'tasks.view_all')).toBe(false);
    expect(roleHas('manager', 'employees.manage')).toBe(false);
    expect(roleHas('manager', 'tasks.review')).toBe(true);
  });

  it('lets HR manage employee records but not tasks', () => {
    expect(roleHas('hr_manager', 'employees.manage')).toBe(true);
    expect(roleHas('hr_manager', 'tasks.create')).toBe(false);
    expect(roleHas('hr_manager', 'employees.grant_privileged')).toBe(false);
  });

  it('reserves organisation settings for admins', () => {
    for (const role of ROLES) {
      expect(roleHas(role, 'settings.org')).toBe(role === 'admin' || role === 'super_admin');
    }
  });

  describe('grantableRoles', () => {
    it('only lets a Super Admin grant Super Admin', () => {
      expect(grantableRoles('super_admin')).toContain('super_admin');
      expect(grantableRoles('admin')).not.toContain('super_admin');
    });
    it('stops HR from granting privileged roles', () => {
      expect(grantableRoles('hr_manager')).toEqual(['employee', 'manager']);
    });
    it('gives managers and employees nothing to grant', () => {
      expect(grantableRoles('manager')).toEqual([]);
      expect(grantableRoles('employee')).toEqual([]);
    });
  });
});
