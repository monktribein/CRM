/**
 * DEVELOPMENT-ONLY synthetic dataset. Refuses to run when NODE_ENV=production.
 * All names are fictional and all emails use the reserved example.com domain.
 * Idempotent: every record is matched on its natural key and only inserted
 * if missing ($setOnInsert), so re-running never duplicates or overwrites.
 */
import type { Model, Types } from 'mongoose';
import { hashPassword } from '../../auth/password.js';
import type { Comment } from '../../comments/comment.schema.js';
import { slugify } from '../../common/slug.js';
import type { Project } from '../../projects/project.schema.js';
import type { JobFunction, Role } from '../../roles/permissions.js';
import type { Task, TaskPriority, TaskStatus } from '../../tasks/task.schema.js';
import { ensureOrganization, type BootstrapModels } from './bootstrap.js';

export interface DevSeedModels extends BootstrapModels {
  projects: Model<Project>;
  tasks: Model<Task>;
  comments: Model<Comment>;
}

export const DEV_ORG = { name: 'Bizwoke Nova (Development)', slug: 'bizwoke-nova-dev' };
export const DEV_ADMIN_EMAIL = 'admin@example.com';

const PEOPLE: Record<string, { manager: [string, string]; employees: [string, string][]; fn: JobFunction; project: [string, string] }> = {
  Development: { manager: ['Daniel', 'Brooks'], employees: [['Sarah', 'Mitchell'], ['Liam', 'Patel'], ['Mia', 'Chen']], fn: 'developer', project: ['NOVA', 'Nova Platform 3.0'] },
  HR: { manager: ['Rachel', 'Owens'], employees: [['Omar', 'Haddad'], ['Grace', 'Novak']], fn: 'hr', project: ['PPL', 'People Ops 2026'] },
  Marketing: { manager: ['Elena', 'Costa'], employees: [['Leo', 'Kim'], ['Ivy', 'Reyes']], fn: 'marketing', project: ['AUT', 'Autumn Launch'] },
  Sales: { manager: ['Marcus', 'Weber'], employees: [['Nora', 'Singh'], ['Kai', 'Tanaka']], fn: 'sales', project: ['ENT', 'Enterprise Expansion'] },
  Operations: { manager: ['Hugo', 'Laurent'], employees: [['Zara', 'Mensah'], ['Felix', 'Bauer']], fn: 'operations', project: ['FIN', 'Finance Automation'] },
  Design: { manager: ['Isla', 'Andersen'], employees: [['Hana', 'Sato'], ['Diego', 'Lopez']], fn: 'design', project: ['DSN', 'Design System v2'] },
  Support: { manager: ['Amara', 'Okafor'], employees: [['Ravi', 'Rahman'], ['Nina', 'Dubois']], fn: 'support', project: ['SUP', 'Support Excellence'] },
};

const TASK_TITLES = [
  'Scope requirements with stakeholders',
  'Draft implementation plan',
  'Resolve blocking dependency',
  'Prepare review materials',
  'Ship first milestone',
  'Retire legacy process',
];
/** status, priority, start offset (days), due offset (days) */
const TASK_SHAPES: [TaskStatus, TaskPriority, number, number][] = [
  ['todo', 'medium', 0, 9],
  ['in_progress', 'high', -6, 1],
  ['blocked', 'critical', -10, -2],
  ['in_review', 'medium', -12, 3],
  ['completed', 'low', -20, -5],
  ['cancelled', 'low', -15, 5],
];

const DAY = 864e5;
const day = (offset: number, edge: 'start' | 'end') => {
  const d = new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
  return new Date(`${d}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`);
};
const emailOf = (first: string, last: string) => `${first}.${last}@example.com`.toLowerCase();

export async function seedDevelopmentData(
  m: DevSeedModels,
  password: string,
  env = process.env.NODE_ENV,
  target: { name: string; slug: string } = DEV_ORG,
) {
  if (env === 'production') {
    throw new Error('The development seed never runs in production (NODE_ENV=production).');
  }
  const passwordHash = await hashPassword(password);
  const { org, departments } = await ensureOrganization(m, target.name, target.slug);
  const summary = { users: 0, projects: 0, tasks: 0, comments: 0 };
  let employeeSeq = 0;

  const upsertUser = async (first: string, last: string, role: Role, fn: JobFunction, dept: Types.ObjectId, managerId: Types.ObjectId | null, email = emailOf(first, last)) => {
    employeeSeq++;
    const res = await m.users.findOneAndUpdate(
      { organizationId: org._id, email, deletedAt: null },
      {
        $setOnInsert: {
          organizationId: org._id,
          employeeId: `DEV-E${1000 + employeeSeq}`,
          firstName: first,
          lastName: last,
          email,
          passwordHash,
          securityRole: role,
          jobFunction: fn,
          title: role === 'employee' ? null : `${fn[0]!.toUpperCase()}${fn.slice(1)} ${role === 'hr_manager' ? 'HR Manager' : 'Manager'}`,
          departmentId: dept,
          managerId,
          status: 'active',
          joinedAt: day(-400 + employeeSeq * 7, 'start'),
        },
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    if (!res.lastErrorObject?.updatedExisting) summary.users++;
    await m.departments.updateOne({ _id: dept }, { $addToSet: { memberIds: res.value!._id } });
    return res.value!._id;
  };

  const admin = await upsertUser('Ava', 'Thompson', 'super_admin', 'operations', departments.get('Operations')!, null, DEV_ADMIN_EMAIL);

  let taskSeq = 1000;
  for (const [deptName, spec] of Object.entries(PEOPLE)) {
    const deptId = departments.get(deptName)!;
    const role: Role = deptName === 'HR' ? 'hr_manager' : 'manager';
    const manager = await upsertUser(spec.manager[0], spec.manager[1], role, spec.fn, deptId, admin);
    await m.departments.updateOne({ _id: deptId }, { $set: { managerId: manager } });
    const staff: Types.ObjectId[] = [];
    for (const [first, last] of spec.employees) staff.push(await upsertUser(first, last, 'employee', spec.fn, deptId, manager));

    const [code, name] = spec.project;
    const project = await m.projects.findOneAndUpdate(
      { organizationId: org._id, projectCode: code },
      {
        $setOnInsert: {
          organizationId: org._id,
          projectCode: code,
          name,
          description: `${name} — synthetic project for local development.`,
          departmentId: deptId,
          managerId: manager,
          memberIds: [],
          status: 'active',
          startDate: day(-45, 'start'),
          dueDate: day(90, 'end'),
          createdBy: admin,
        },
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    if (!project.lastErrorObject?.updatedExisting) summary.projects++;

    for (let i = 0; i < TASK_SHAPES.length; i++) {
      const [status, priority, startOffset, dueOffset] = TASK_SHAPES[i]!;
      taskSeq++;
      const assignee = staff[i % staff.length]!;
      const reviewed = status === 'completed' || status === 'in_review';
      const res = await m.tasks.findOneAndUpdate(
        { organizationId: org._id, taskCode: `DEMO-${taskSeq}` },
        {
          $setOnInsert: {
            organizationId: org._id,
            taskCode: `DEMO-${taskSeq}`,
            title: `${TASK_TITLES[i]} (${code})`,
            description: 'Synthetic task generated by the development seed.',
            projectId: project.value!._id,
            departmentId: deptId,
            createdBy: manager,
            assignedTo: [assignee],
            assignedBy: manager,
            sharedWith: [],
            priority,
            status,
            tags: [slugify(deptName)],
            startDate: day(startOffset, 'start'),
            dueDate: day(dueOffset, 'end'),
            estimatedHours: 8,
            actualHours: status === 'todo' ? 0 : 4,
            progressPercentage: { todo: 0, in_progress: 40, blocked: 20, in_review: 100, completed: 100, cancelled: 10 }[status],
            checklist: [{ label: 'Plan', done: status !== 'todo' }, { label: 'Deliver', done: reviewed }],
            reviewRequired: true,
            review: reviewed
              ? {
                  state: status === 'completed' ? 'approved' : 'pending',
                  submittedBy: assignee,
                  submittedAt: day(dueOffset - 1, 'start'),
                  submissionNote: 'Ready for review.',
                  reviewerId: status === 'completed' ? manager : null,
                  reviewedAt: status === 'completed' ? day(dueOffset, 'start') : null,
                  reviewNote: status === 'completed' ? 'Approved.' : null,
                }
              : null,
            completedAt: status === 'completed' ? day(dueOffset, 'start') : null,
          },
        },
        { upsert: true, returnDocument: 'after', includeResultMetadata: true },
      );
      if (!res.lastErrorObject?.updatedExisting) summary.tasks++;

      if (status === 'in_progress' || status === 'blocked') {
        const body = status === 'blocked' ? 'Waiting on an external dependency.' : 'Making good progress — first draft is up.';
        const c = await m.comments.updateOne(
          { organizationId: org._id, taskId: res.value!._id, authorId: assignee, body },
          { $setOnInsert: { organizationId: org._id, taskId: res.value!._id, authorId: assignee, body, mentions: [] } },
          { upsert: true },
        );
        if (c.upsertedCount) {
          summary.comments++;
          await m.tasks.updateOne({ _id: res.value!._id }, { $inc: { commentCount: 1 } });
        }
      }
    }
  }

  // Demo tasks use DEMO-* codes, so they never collide with real BN-* task codes.
  return { organizationId: String(org._id), summary };
}
