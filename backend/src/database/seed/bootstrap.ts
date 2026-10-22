import type { Model, Types } from 'mongoose';
import { hashPassword } from '../../auth/password.js';
import { Counter, nextSequence } from '../../common/counter.schema.js';
import { slugify } from '../../common/slug.js';
import type { Department } from '../../departments/department.schema.js';
import type { Organization } from '../../settings/organization.schema.js';
import type { User } from '../../users/user.schema.js';

export const DEFAULT_DEPARTMENTS: [string, string][] = [
  ['Development', 'Product engineering, platform and QA.'],
  ['HR', 'People operations, hiring and employee experience.'],
  ['Marketing', 'Brand, content, campaigns and growth.'],
  ['Sales', 'New business, account management and partnerships.'],
  ['Operations', 'Finance, facilities, IT and internal tooling.'],
  ['Design', 'Product design, research and design systems.'],
  ['Support', 'Customer support and success.'],
];

export interface BootstrapModels {
  organizations: Model<Organization>;
  departments: Model<Department>;
  users: Model<User>;
  counters: Model<Counter>;
}

export function assertStrongPassword(password: string | undefined, variable: string): string {
  if (!password || password.length < 12 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
    throw new Error(`${variable} must be at least 12 characters and include a letter and a number.`);
  }
  return password;
}

/** Idempotently creates (or finds) an organisation and its default departments. */
export async function ensureOrganization(m: BootstrapModels, name: string, slug = slugify(name)) {
  const org = await m.organizations.findOneAndUpdate(
    { slug },
    { $setOnInsert: { name, slug } },
    { upsert: true, returnDocument: 'after' },
  );
  const departments = new Map<string, Types.ObjectId>();
  for (const [deptName, description] of DEFAULT_DEPARTMENTS) {
    const deptSlug = slugify(deptName);
    const dept = await m.departments.findOneAndUpdate(
      { organizationId: org._id, slug: deptSlug, status: 'active' },
      { $setOnInsert: { organizationId: org._id, name: deptName, slug: deptSlug, description, status: 'active' } },
      { upsert: true, returnDocument: 'after' },
    );
    departments.set(deptName, dept._id);
  }
  return { org, departments };
}

/**
 * Production-safe bootstrap: organisation, default departments and the first
 * Super Admin. Public registration is disabled, so this is how the first
 * account is created. Running it again changes nothing.
 */
export async function bootstrapOrganization(
  m: BootstrapModels,
  opts: { orgName: string; orgSlug?: string; email: string; password: string; firstName?: string; lastName?: string },
) {
  const email = opts.email.trim().toLowerCase();
  const { org, departments } = await ensureOrganization(m, opts.orgName, opts.orgSlug || undefined);
  const existing = await m.users.findOne({ organizationId: org._id, email, deletedAt: null }).lean();
  if (existing) return { org, created: false };

  const operations = departments.get('Operations') ?? null;
  const seq = await nextSequence(m.counters, `${String(org._id)}:employee`);
  const admin = await m.users.create({
    organizationId: org._id,
    employeeId: `BN-E${seq}`,
    firstName: opts.firstName?.trim() || 'System',
    lastName: opts.lastName?.trim() || 'Administrator',
    email,
    passwordHash: await hashPassword(opts.password),
    securityRole: 'super_admin',
    jobFunction: 'operations',
    departmentId: operations,
    status: 'active',
    joinedAt: new Date(),
  });
  if (operations) await m.departments.updateOne({ _id: operations }, { $addToSet: { memberIds: admin._id } });
  return { org, created: true };
}

/** The organisation configured for this deployment (SEED_ORG_NAME / SEED_ORG_SLUG / APP_NAME). */
export function configuredOrganization(env: NodeJS.ProcessEnv = process.env) {
  const name = env.SEED_ORG_NAME?.trim() || env.APP_NAME?.trim() || 'Bizwoke Nova';
  return { name, slug: env.SEED_ORG_SLUG?.trim() || slugify(name) };
}
