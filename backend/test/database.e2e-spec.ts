import { Types, type Model } from 'mongoose';
import { seedDevelopmentData, type DevSeedModels } from '../src/database/seed/development.js';
import { bootstrapOrganization } from '../src/database/seed/bootstrap.js';
import { bearer, createHarness, isoDay, type Harness } from './harness.js';

type AnyModel = Model<Record<string, unknown>>;

describe('Database layer (e2e)', () => {
  let h: Harness;
  let m: Record<'Organization' | 'User' | 'Department' | 'Project' | 'Task' | 'Comment' | 'Counter' | 'RefreshToken' | 'PasswordResetToken' | 'InvitationToken' | 'Notification' | 'ActivityLog', AnyModel>;

  beforeAll(async () => {
    h = await createHarness();
    const names = ['Organization', 'User', 'Department', 'Project', 'Task', 'Comment', 'Counter', 'RefreshToken', 'PasswordResetToken', 'InvitationToken', 'Notification', 'ActivityLog'] as const;
    m = Object.fromEntries(names.map((n) => [n, h.model(n)])) as typeof m;
    await Promise.all(Object.values(m).map((model) => model.createIndexes()));
  });
  afterAll(async () => {
    await h.close();
  });

  const user = (orgId: Types.ObjectId, email: string, extra: Record<string, unknown> = {}) => ({
    organizationId: orgId,
    employeeId: `X-${new Types.ObjectId().toHexString().slice(-6)}`,
    firstName: 'Test',
    lastName: 'User',
    email,
    securityRole: 'employee',
    jobFunction: 'developer',
    joinedAt: new Date(),
    ...extra,
  });

  describe('collections & indexes', () => {
    it('uses the documented collection names', () => {
      expect(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.collection.name]))).toMatchObject({
        Organization: 'organizations', User: 'users', Department: 'departments', Project: 'projects', Task: 'tasks',
        Comment: 'comments', Notification: 'notifications', ActivityLog: 'activityLogs', RefreshToken: 'refreshTokens',
        PasswordResetToken: 'passwordResetTokens',
      });
    });

    it('has TTL indexes on expiring auth records and notifications', async () => {
      for (const name of ['RefreshToken', 'PasswordResetToken', 'InvitationToken'] as const) {
        const ttl = (await m[name].collection.indexes()).find((i) => i.name === 'ttl_expires_at');
        expect(ttl).toMatchObject({ key: { expiresAt: 1 }, expireAfterSeconds: 0 });
      }
      const n = (await m.Notification.collection.indexes()).find((i) => i.name === 'ttl_180d');
      expect(n?.expireAfterSeconds).toBe(180 * 24 * 3600);
    });

    it('declares the task query indexes', async () => {
      const names = (await m.Task.collection.indexes()).map((i) => i.name);
      expect(names).toEqual(expect.arrayContaining(['uniq_org_task_code', 'my_tasks', 'team_tasks', 'org_status_due', 'project_progress']));
    });
  });

  describe('uniqueness', () => {
    it('enforces unique organisation slugs', async () => {
      await expect(m.Organization.create({ name: 'Dup', slug: 'acme' })).rejects.toMatchObject({ code: 11000 });
      await expect(m.Organization.create({ name: 'Bad', slug: 'Not A Slug!' })).rejects.toThrow(/slug/);
    });

    it('makes email unique per organisation (case-insensitive) and frees it on soft delete', async () => {
      const other = await m.Organization.create({ name: 'Globex', slug: 'globex' });
      await m.User.create(user(h.fx.orgId, 'Same@Person.test'));
      // Same email in another organisation is allowed.
      await m.User.create(user(other._id as Types.ObjectId, 'same@person.test'));
      // Duplicate (normalised) in the same organisation is not.
      await expect(m.User.create(user(h.fx.orgId, 'SAME@person.test'))).rejects.toMatchObject({ code: 11000 });
      // After soft deletion the address can be re-used.
      await m.User.updateOne({ organizationId: h.fx.orgId, email: 'same@person.test' }, { deletedAt: new Date(), status: 'deactivated' });
      await expect(m.User.create(user(h.fx.orgId, 'same@person.test'))).resolves.toBeTruthy();
    });

    it('keeps employee IDs unique per organisation', async () => {
      await m.User.create(user(h.fx.orgId, 'e1@x.test', { employeeId: 'E-1' }));
      await expect(m.User.create(user(h.fx.orgId, 'e2@x.test', { employeeId: 'E-1' }))).rejects.toMatchObject({ code: 11000 });
    });

    it('keeps department slugs unique among active departments only', async () => {
      const d = await m.Department.create({ organizationId: h.fx.orgId, name: 'Legal', slug: 'legal' });
      await expect(m.Department.create({ organizationId: h.fx.orgId, name: 'Legal', slug: 'legal' })).rejects.toMatchObject({ code: 11000 });
      await m.Department.updateOne({ _id: d._id }, { status: 'archived' });
      await expect(m.Department.create({ organizationId: h.fx.orgId, name: 'Legal', slug: 'legal' })).resolves.toBeTruthy();
    });
  });

  describe('validation', () => {
    const task = (extra: Record<string, unknown> = {}) => ({
      organizationId: h.fx.orgId,
      taskCode: `T-${new Types.ObjectId().toHexString().slice(-8)}`,
      title: 'Schema test',
      projectId: h.fx.projectId,
      departmentId: h.fx.devId,
      createdBy: new Types.ObjectId(h.fx.users.manager.id),
      assignedBy: new Types.ObjectId(h.fx.users.manager.id),
      assignedTo: [new Types.ObjectId(h.fx.users.emp1.id)],
      startDate: new Date('2026-10-01'),
      dueDate: new Date('2026-10-10'),
      estimatedHours: 4,
      ...extra,
    });

    it('rejects invalid emails, roles, statuses and priorities', async () => {
      await expect(m.User.create(user(h.fx.orgId, 'not-an-email'))).rejects.toThrow(/email/);
      await expect(m.User.create(user(h.fx.orgId, 'r@x.test', { securityRole: 'god' }))).rejects.toThrow(/securityRole/);
      await expect(m.Task.create(task({ priority: 'urgent' }))).rejects.toThrow(/priority/);
      await expect(m.Task.create(task({ status: 'done' }))).rejects.toThrow(/status/);
    });

    it('rejects due dates before start dates', async () => {
      await expect(m.Task.create(task({ dueDate: new Date('2026-09-01') }))).rejects.toThrow(/due date must be on or after/);
    });

    it('rejects duplicate or missing assignees', async () => {
      const id = new Types.ObjectId(h.fx.users.emp1.id);
      await expect(m.Task.create(task({ assignedTo: [id, id] }))).rejects.toThrow(/assignedTo/);
      await expect(m.Task.create(task({ assignedTo: [] }))).rejects.toThrow(/assignedTo/);
    });

    it('enforces 0–100 progress on saves AND on update queries', async () => {
      await expect(m.Task.create(task({ progressPercentage: 101 }))).rejects.toThrow(/progressPercentage/);
      const t = await m.Task.create(task());
      await expect(m.Task.updateOne({ _id: t._id }, { progressPercentage: 150 })).rejects.toThrow(/progressPercentage/);
      await expect(m.Task.findOneAndUpdate({ _id: t._id }, { status: 'not-a-status' })).rejects.toThrow(/status/);
    });

    it('forces 100% progress on completed tasks', async () => {
      const t = await m.Task.create(task({ status: 'completed', progressPercentage: 40 }));
      expect(t.get('progressPercentage')).toBe(100);
    });

    it('stores only token hashes', async () => {
      await expect(m.PasswordResetToken.create({ userId: new Types.ObjectId(), tokenHash: 'raw-token', expiresAt: new Date() })).rejects.toThrow(/tokenHash/);
    });
  });

  describe('organisation isolation', () => {
    it("refuses to link records from another organisation", async () => {
      const foreignOrg = await m.Organization.create({ name: 'Initech', slug: 'initech' });
      const foreignDept = await m.Department.create({ organizationId: foreignOrg._id, name: 'Dev', slug: 'dev' });
      const foreignProject = await m.Project.create({
        organizationId: foreignOrg._id, name: 'Secret', projectCode: 'SECRET', departmentId: foreignDept._id,
        startDate: new Date(), dueDate: new Date(Date.now() + 864e5), createdBy: new Types.ObjectId(),
      });
      const { token } = await h.login(h.fx.users.admin.email);
      const body = {
        title: 'Cross-org attempt', projectId: String(h.fx.projectId), departmentId: String(h.fx.devId),
        assigneeIds: [h.fx.users.emp1.id], priority: 'low', startDate: isoDay(0), dueDate: isoDay(1), estimatedHours: 1,
      };
      const p = await h.http().post('/api/v1/tasks').set(bearer(token)).send({ ...body, projectId: String(foreignProject._id) }).expect(422);
      expect(p.body.details).toHaveProperty('projectId');
      await h.http().post('/api/v1/tasks').set(bearer(token)).send({ ...body, departmentId: String(foreignDept._id) }).expect(422);
      const foreignUser = await m.User.create(user(foreignOrg._id as Types.ObjectId, 'outsider@initech.test', { status: 'active' }));
      await h.http().post('/api/v1/tasks').set(bearer(token)).send({ ...body, assigneeIds: [String(foreignUser._id)] }).expect(422);
      await h.http().patch(`/api/v1/users/${h.fx.users.emp1.id}`).set(bearer(token)).send({ managerId: String(foreignUser._id) }).expect(422);
      await h.http().get(`/api/v1/users/${String(foreignUser._id)}`).set(bearer(token)).expect(404);
    });

    it('keeps department memberIds in sync with user placement', async () => {
      const { token } = await h.login(h.fx.users.admin.email);
      await h.http().patch(`/api/v1/users/${h.fx.users.emp2.id}`).set(bearer(token)).send({ departmentId: String(h.fx.marketingId) }).expect(200);
      const [dev, mkt] = await Promise.all([m.Department.findById(h.fx.devId).lean(), m.Department.findById(h.fx.marketingId).lean()]);
      expect((dev!.memberIds as Types.ObjectId[]).map(String)).not.toContain(h.fx.users.emp2.id);
      expect((mkt!.memberIds as Types.ObjectId[]).map(String)).toContain(h.fx.users.emp2.id);
    });
  });

  it('stamps audit entries with the request ID', async () => {
    const { token } = await h.login(h.fx.users.manager.email);
    const requestId = 'test-request-0001';
    const res = await h.http().post('/api/v1/tasks').set(bearer(token)).set('X-Request-Id', requestId).send({
      title: 'Traceable', projectId: String(h.fx.projectId), departmentId: String(h.fx.devId),
      assigneeIds: [h.fx.users.emp1.id], priority: 'low', startDate: isoDay(0), dueDate: isoDay(2), estimatedHours: 1,
    }).expect(201);
    expect(res.headers['x-request-id']).toBe(requestId);
    const log = await m.ActivityLog.findOne({ entityId: new Types.ObjectId(res.body.data.id as string), action: 'task.created' }).lean();
    expect(log).toMatchObject({ requestId, changes: expect.objectContaining({ priority: 'low' }) });
    const task = await m.Task.findById(res.body.data.id).lean();
    expect(task).toMatchObject({ assignedBy: new Types.ObjectId(h.fx.users.manager.id), reviewRequired: true, archivedAt: null });
  });

  describe('seeding', () => {
    const models = (): DevSeedModels => ({
      organizations: m.Organization as never, departments: m.Department as never, users: m.User as never, counters: m.Counter as never,
      projects: m.Project as never, tasks: m.Task as never, comments: m.Comment as never,
    });

    it('refuses to run the development seed in production', async () => {
      await expect(seedDevelopmentData(models(), 'Dev-password-123', 'production')).rejects.toThrow(/never runs in production/);
    });

    it('is idempotent and covers every status', async () => {
      const first = await seedDevelopmentData(models(), 'Dev-password-123', 'development');
      const org = new Types.ObjectId(first.organizationId);
      const counts = async () => ({
        users: await m.User.countDocuments({ organizationId: org }),
        departments: await m.Department.countDocuments({ organizationId: org }),
        projects: await m.Project.countDocuments({ organizationId: org }),
        tasks: await m.Task.countDocuments({ organizationId: org }),
        comments: await m.Comment.countDocuments({ organizationId: org }),
      });
      const before = await counts();
      expect(before).toMatchObject({ departments: 7, projects: 7, tasks: 42 });
      expect(first.summary.users).toBe(before.users);
      const second = await seedDevelopmentData(models(), 'Dev-password-123', 'development');
      expect(second.summary).toEqual({ users: 0, projects: 0, tasks: 0, comments: 0 });
      expect(await counts()).toEqual(before);
      const statuses = (await m.Task.distinct('status', { organizationId: org })) as string[];
      expect(statuses.sort((a, b) => a.localeCompare(b))).toEqual(['blocked', 'cancelled', 'completed', 'in_progress', 'in_review', 'todo']);
      const admin = await m.User.findOne({ organizationId: org, email: 'admin@example.com' }).select('+passwordHash').lean();
      expect(admin).toMatchObject({ securityRole: 'super_admin' });
      expect(admin!.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it('seeded users can sign in, scoped to their organisation', async () => {
      const res = await h.http().post('/api/v1/auth/login').send({ email: 'admin@example.com', password: 'Dev-password-123' }).expect(200);
      expect(res.body.data.user.organizationName).toBe('Bizwoke Nova (Development)');
      const tasks = await h.http().get('/api/v1/tasks?scope=all&pageSize=100').set(bearer(res.body.data.accessToken as string)).expect(200);
      expect(tasks.body.meta.total).toBe(42);
    });

    it('bootstrap is idempotent', async () => {
      const opts = { orgName: 'Boot Co', email: 'Owner@Boot.test', password: 'Owner-password-1' };
      const bm = { organizations: m.Organization as never, departments: m.Department as never, users: m.User as never, counters: m.Counter as never };
      expect((await bootstrapOrganization(bm, opts)).created).toBe(true);
      expect((await bootstrapOrganization(bm, opts)).created).toBe(false);
      const org = await m.Organization.findOne({ slug: 'boot-co' }).lean();
      expect(await m.Department.countDocuments({ organizationId: org!._id })).toBe(7);
      expect(await m.User.countDocuments({ organizationId: org!._id })).toBe(1);
    });

    it('asks for the organisation when an email exists in several', async () => {
      // admin@example.com now exists only in the dev org; add the same address to another org.
      const boot = await m.Organization.findOne({ slug: 'boot-co' }).lean();
      const { hashPassword } = await import('../src/auth/password.js');
      await m.User.create(user(boot!._id as Types.ObjectId, 'admin@example.com', { status: 'active', passwordHash: await hashPassword('Dev-password-123') }));
      const ambiguous = await h.http().post('/api/v1/auth/login').send({ email: 'admin@example.com', password: 'Dev-password-123' }).expect(409);
      expect(ambiguous.body.code).toBe('organization_required');
      const scoped = await h.http().post('/api/v1/auth/login').send({ email: 'admin@example.com', password: 'Dev-password-123', organization: 'boot-co' }).expect(200);
      expect(scoped.body.data.user.organizationName).toBe('Boot Co');
    });
  });
});
