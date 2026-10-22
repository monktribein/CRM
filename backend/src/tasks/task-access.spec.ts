import { Types } from 'mongoose';
import type { AuthUser } from '../common/auth-user.js';
import { permissionsFor, type Role } from '../roles/permissions.js';
import { TaskContext } from './task-access.js';
import type { TaskStatus } from './task.schema.js';

const org = new Types.ObjectId();
const dev = new Types.ObjectId();
const marketing = new Types.ObjectId();
const settings = { dueSoonThresholdDays: 2, reviewRequired: true };

function user(role: Role, departmentId = dev): AuthUser {
  return {
    id: new Types.ObjectId().toString(),
    organizationId: org.toString(),
    role,
    departmentId: departmentId.toString(),
    name: role,
    email: `${role}@test.dev`,
    permissions: permissionsFor(role),
  };
}

function task(overrides: Partial<{ assignedTo: string[]; sharedWith: string[]; createdBy: string; departmentId: Types.ObjectId; status: TaskStatus; organizationId: Types.ObjectId }> = {}) {
  return {
    organizationId: overrides.organizationId ?? org,
    assignedTo: (overrides.assignedTo ?? []).map((i) => new Types.ObjectId(i)),
    sharedWith: (overrides.sharedWith ?? []).map((i) => new Types.ObjectId(i)),
    createdBy: new Types.ObjectId(overrides.createdBy ?? new Types.ObjectId().toString()),
    departmentId: overrides.departmentId ?? dev,
    status: overrides.status ?? 'in_progress',
    reviewRequired: true,
  };
}

describe('TaskContext', () => {
  it('lets employees see only assigned or shared tasks', () => {
    const emp = user('employee');
    const ctx = new TaskContext(emp, [], settings);
    expect(ctx.canView(task({ assignedTo: [emp.id] }))).toBe(true);
    expect(ctx.canView(task({ sharedWith: [emp.id] }))).toBe(true);
    expect(ctx.canView(task())).toBe(false);
  });

  it('scopes managers to their authorised departments', () => {
    const mgr = user('manager');
    const ctx = new TaskContext(mgr, [dev], settings);
    expect(ctx.canView(task({ departmentId: dev }))).toBe(true);
    expect(ctx.canView(task({ departmentId: marketing }))).toBe(false);
    expect(ctx.canView(task({ departmentId: marketing, createdBy: mgr.id }))).toBe(true);
  });

  it('never grants access across organisations, even to admins', () => {
    const admin = user('admin');
    const ctx = new TaskContext(admin, null, settings);
    expect(ctx.canView(task())).toBe(true);
    expect(ctx.canView(task({ organizationId: new Types.ObjectId() }))).toBe(false);
  });

  it('does not let HR managers see team tasks', () => {
    const hr = user('hr_manager');
    expect(new TaskContext(hr, [], settings).canView(task())).toBe(false);
  });

  it('exposes review only to managers of tasks in review', () => {
    const mgr = user('manager');
    const emp = user('employee');
    const t = task({ assignedTo: [emp.id], status: 'in_review' });
    expect(new TaskContext(mgr, [dev], settings).capabilities(t).canReview).toBe(true);
    expect(new TaskContext(emp, [], settings).capabilities(t).canReview).toBe(false);
  });

  it('prevents editing closed tasks', () => {
    const mgr = user('manager');
    expect(new TaskContext(mgr, [dev], settings).capabilities(task({ status: 'completed' })).canEdit).toBe(false);
  });
});
