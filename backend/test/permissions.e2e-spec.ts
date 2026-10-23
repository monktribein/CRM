import { bearer, createHarness, isoDay, type Harness } from './harness.js';

describe('Authorisation & data scoping (e2e)', () => {
  let h: Harness;
  const t: Record<string, string> = {};
  let devTaskId: string;
  let marketingTaskId: string;

  beforeAll(async () => {
    h = await createHarness();
    for (const [k, u] of Object.entries(h.fx.users)) {
      if (k !== 'inactive') t[k] = (await h.login(u.email)).token;
    }
    // A Marketing project + task created by an admin, outside the Dev manager's scope.
    const mktProject = await h.http().post('/api/v1/projects').set(bearer(t.admin!)).send({
      name: 'Brand Refresh', key: 'BRAND', departmentId: String(h.fx.marketingId), status: 'active', startDate: isoDay(0), dueDate: isoDay(60),
    }).expect(201);
    marketingTaskId = (await h.http().post('/api/v1/tasks').set(bearer(t.admin!)).send({
      title: 'Launch campaign', projectId: mktProject.body.data.id, departmentId: String(h.fx.marketingId),
      assigneeIds: [h.fx.users.marketer.id], priority: 'high', startDate: isoDay(0), dueDate: isoDay(7), estimatedHours: 8,
    }).expect(201)).body.data.id;
    devTaskId = (await h.http().post('/api/v1/tasks').set(bearer(t.manager!)).send({
      title: 'Fix login bug', projectId: String(h.fx.projectId), departmentId: String(h.fx.devId),
      assigneeIds: [h.fx.users.emp1.id], priority: 'medium', startDate: isoDay(0), dueDate: isoDay(5), estimatedHours: 4,
    }).expect(201)).body.data.id;
  });
  afterAll(async () => {
    await h.close();
  });

  describe('employees', () => {
    it('cannot list employees, create tasks or view organisation tasks', async () => {
      await h.http().get('/api/v1/users').set(bearer(t.emp1!)).expect(403);
      await h.http().post('/api/v1/tasks').set(bearer(t.emp1!)).send({}).expect(403);
      await h.http().get('/api/v1/tasks?scope=all').set(bearer(t.emp1!)).expect(403);
      await h.http().get('/api/v1/reports/tasks').set(bearer(t.emp1!)).expect(403);
      await h.http().get('/api/v1/activity-logs').set(bearer(t.emp1!)).expect(403);
    });

    it('see only their own tasks', async () => {
      const mine = await h.http().get('/api/v1/tasks').set(bearer(t.emp1!)).expect(200);
      expect(mine.body.data.map((x: { id: string }) => x.id)).toEqual([devTaskId]);
      expect(mine.body.meta).toMatchObject({ total: 1, page: 1 });
      const other = await h.http().get('/api/v1/tasks').set(bearer(t.emp2!)).expect(200);
      expect(other.body.data).toHaveLength(0);
    });

    it("get 404 (not 403) for tasks they can't see, so IDs don't leak", async () => {
      await h.http().get(`/api/v1/tasks/${devTaskId}`).set(bearer(t.emp2!)).expect(404);
      await h.http().get(`/api/v1/tasks/${marketingTaskId}`).set(bearer(t.emp1!)).expect(404);
    });

    it('cannot approve, reassign or edit tasks', async () => {
      await h.http().post(`/api/v1/tasks/${devTaskId}/approve`).set(bearer(t.emp1!)).send({}).expect(403);
      await h.http().post(`/api/v1/tasks/${devTaskId}/assignments`).set(bearer(t.emp1!)).send({ assigneeIds: [h.fx.users.emp2.id] }).expect(403);
      await h.http().patch(`/api/v1/tasks/${devTaskId}`).set(bearer(t.emp1!)).send({ title: 'Hijacked' }).expect(403);
    });
  });

  describe('managers', () => {
    it('see team tasks but not other departments', async () => {
      const all = await h.http().get('/api/v1/tasks?scope=all').set(bearer(t.manager!)).expect(200);
      const ids = all.body.data.map((x: { id: string }) => x.id);
      expect(ids).toContain(devTaskId);
      expect(ids).not.toContain(marketingTaskId);
      await h.http().get(`/api/v1/tasks/${marketingTaskId}`).set(bearer(t.manager!)).expect(404);
    });

    it('list only employees in their departments', async () => {
      const res = await h.http().get('/api/v1/users?pageSize=100').set(bearer(t.manager!)).expect(200);
      const emails = res.body.data.map((u: { email: string }) => u.email);
      expect(emails).toContain('emp1@acme.test');
      expect(emails).not.toContain('marketer@acme.test');
    });

    it('cannot create employee accounts or manage departments', async () => {
      await h.http().post('/api/v1/users').set(bearer(t.manager!)).send({}).expect(403);
      await h.http().post('/api/v1/departments').set(bearer(t.manager!)).send({ name: 'Rogue' }).expect(403);
    });

    it('get team-scoped reports and dashboards', async () => {
      const report = await h.http().get('/api/v1/reports/departments').set(bearer(t.manager!)).expect(200);
      expect(report.body.data.map((r: { department: string }) => r.department)).toEqual(['Development']);
      const summary = await h.http().get('/api/v1/dashboard/summary').set(bearer(t.manager!)).expect(200);
      expect(summary.body.data.role).toBe('manager');
      expect(summary.body.data.stats.assignedByMe).toBe(1);
    });
  });

  describe('HR managers', () => {
    it('can create employees but cannot grant privileged roles', async () => {
      const body = (role: string, email: string) => ({
        firstName: 'A', lastName: 'B', email, role, jobFunction: 'hr', departmentId: String(h.fx.devId), joinDate: '2026-10-01', sendInvitation: false,
      });
      await h.http().post('/api/v1/users').set(bearer(t.hr!)).send(body('admin', 'sneaky@acme.test')).expect(403);
      await h.http().post('/api/v1/users').set(bearer(t.hr!)).send(body('employee', 'ok.hire@acme.test')).expect(201);
    });

    it('cannot see task data', async () => {
      await h.http().get('/api/v1/tasks?scope=all').set(bearer(t.hr!)).expect(403);
      await h.http().get(`/api/v1/tasks/${devTaskId}`).set(bearer(t.hr!)).expect(404);
    });
  });

  describe('admins', () => {
    it('cannot modify a Super Admin or their own role', async () => {
      await h.http().patch(`/api/v1/users/${h.fx.users.superAdmin.id}`).set(bearer(t.admin!)).send({ role: 'employee' }).expect(403);
      await h.http().patch(`/api/v1/users/${h.fx.users.superAdmin.id}/status`).set(bearer(t.admin!)).send({ status: 'deactivated' }).expect(403);
      await h.http().patch(`/api/v1/users/${h.fx.users.admin.id}`).set(bearer(t.admin!)).send({ role: 'super_admin' }).expect(403);
    });

    it('can change roles; the change applies on the next request', async () => {
      await h.http().patch(`/api/v1/users/${h.fx.users.emp2.id}`).set(bearer(t.admin!)).send({ role: 'manager' }).expect(200);
      // emp2's existing token now carries manager permissions — roles are read from the DB, not the JWT.
      await h.http().get('/api/v1/tasks?scope=all').set(bearer(t.emp2!)).expect(200);
      await h.http().patch(`/api/v1/users/${h.fx.users.emp2.id}`).set(bearer(t.admin!)).send({ role: 'employee' }).expect(200);
      await h.http().get('/api/v1/tasks?scope=all').set(bearer(t.emp2!)).expect(403);
    });

    it('deactivating a user blocks their existing access token immediately', async () => {
      const victim = await h.login(h.fx.users.marketer.email);
      await h.http().patch(`/api/v1/users/${h.fx.users.marketer.id}/status`).set(bearer(t.admin!)).send({ status: 'deactivated' }).expect(200);
      await h.http().get('/api/v1/auth/me').set(bearer(victim.token)).expect(401);
      await h.http().post('/api/v1/auth/refresh').set('Cookie', victim.cookie).expect(401);
    });

    it('soft-deletes users and keeps history', async () => {
      const created = await h.http().post('/api/v1/users').set(bearer(t.admin!)).send({
        firstName: 'Temp', lastName: 'User', email: 'temp@acme.test', role: 'employee', jobFunction: 'other', departmentId: String(h.fx.devId), joinDate: '2026-10-01', sendInvitation: false,
      }).expect(201);
      const id = created.body.data.user.id;
      await h.http().delete(`/api/v1/users/${id}`).set(bearer(t.admin!)).expect(204);
      await h.http().get(`/api/v1/users/${id}`).set(bearer(t.admin!)).expect(404);
      const raw = await h.model<{ deletedAt: Date | null; status: string }>('User').findById(id).lean();
      expect(raw).toMatchObject({ status: 'deactivated' });
      expect(raw!.deletedAt).toBeInstanceOf(Date);
    });

    it('activates accounts created with an admin-set password so they can sign in', async () => {
      const created = await h.http().post('/api/v1/users').set(bearer(t.admin!)).send({
        firstName: 'Pre', lastName: 'Set', email: 'preset@acme.test', role: 'employee', jobFunction: 'other', departmentId: String(h.fx.devId), joinDate: '2026-10-01', sendInvitation: false, password: 'abc',
      }).expect(201);
      expect(created.body.data).toMatchObject({ user: { status: 'active' }, invitationUrl: null });
      const login = await h.http().post('/api/v1/auth/login').send({ email: 'preset@acme.test', password: 'abc' }).expect(200);
      expect(login.body.data.user).toMatchObject({ email: 'preset@acme.test', role: 'employee' });
    });

    it('prevents duplicate department names (case-insensitive)', async () => {
      await h.http().post('/api/v1/departments').set(bearer(t.admin!)).send({ name: 'development' }).expect(409);
    });
  });

  it('never trusts client-supplied organisation or role fields', async () => {
    await h.http().post('/api/v1/tasks').set(bearer(t.manager!)).send({
      title: 'x', organizationId: '000000000000000000000000', projectId: String(h.fx.projectId), departmentId: String(h.fx.devId),
      assigneeIds: [h.fx.users.emp1.id], priority: 'low', startDate: isoDay(0), dueDate: isoDay(1), estimatedHours: 1,
    }).expect(422);
    await h.http().patch('/api/v1/users/me').set(bearer(t.emp1!)).send({ firstName: 'E', lastName: 'One', role: 'admin' }).expect(422);
  });

  it('writes an append-only activity log', async () => {
    const logs = await h.http().get('/api/v1/activity-logs').set(bearer(t.admin!)).expect(200);
    expect(logs.body.data.some((l: { action: string }) => l.action === 'task.created')).toBe(true);
    const Log = h.model('ActivityLog');
    await expect(Log.updateMany({}, { description: 'tampered' })).rejects.toThrow(/append-only/);
    await expect(Log.deleteMany({})).rejects.toThrow(/append-only/);
  });
});
