import { bearer, createHarness, isoDay, type Harness } from './harness.js';

describe('Task assignment & workflow (e2e)', () => {
  let h: Harness;
  const t: Record<string, string> = {};
  let taskId: string;

  const newTask = (overrides: Record<string, unknown> = {}) => ({
    title: 'Implement SSO',
    description: 'OIDC with the corporate IdP',
    projectId: String(h.fx.projectId),
    departmentId: String(h.fx.devId),
    assigneeIds: [h.fx.users.emp1.id],
    priority: 'high',
    startDate: isoDay(0),
    dueDate: isoDay(5),
    estimatedHours: 12,
    tags: ['Backend', 'backend', 'Q4'],
    checklist: [{ label: 'Spike' }, { label: 'Implement' }],
    ...overrides,
  });

  beforeAll(async () => {
    h = await createHarness();
    for (const k of ['admin', 'manager', 'emp1', 'emp2'] as const) t[k] = (await h.login(h.fx.users[k].email)).token;
  });
  afterAll(async () => {
    await h.close();
  });

  describe('creation & assignment', () => {
    it('creates tasks as To Do with a sequential key and notifies assignees', async () => {
      const res = await h.http().post('/api/v1/tasks').set(bearer(t.manager!)).send(newTask()).expect(201);
      taskId = res.body.data.id;
      expect(res.body.data).toMatchObject({
        key: 'BN-1001',
        status: 'todo',
        progressPercentage: 0,
        tags: ['backend', 'q4'],
        checklistTotal: 2,
        departmentName: 'Development',
        projectName: 'Core Platform',
        createdBy: { id: h.fx.users.manager.id },
        isOverdue: false,
      });
      expect(res.body.data.dueDate).toBe(`${isoDay(5)}T23:59:59.999Z`);
      const notes = await h.http().get('/api/v1/notifications').set(bearer(t.emp1!)).expect(200);
      expect(notes.body.data[0]).toMatchObject({ type: 'task_assigned', read: false, link: `/tasks/${taskId}` });
    });

    it('rejects inactive assignees', async () => {
      await h.http().post('/api/v1/tasks').set(bearer(t.manager!)).send(newTask({ assigneeIds: [h.fx.users.inactive.id] })).expect(422);
    });

    it("rejects assignees outside the manager's departments", async () => {
      await h.http().post('/api/v1/tasks').set(bearer(t.manager!)).send(newTask({ assigneeIds: [h.fx.users.marketer.id] })).expect(403);
    });

    it("rejects managers creating tasks for departments they don't manage", async () => {
      await h.http().post('/api/v1/tasks').set(bearer(t.manager!)).send(newTask({ departmentId: String(h.fx.marketingId) })).expect(403);
    });

    it('requires assignees to belong to the task department or project team', async () => {
      const res = await h.http().post('/api/v1/tasks').set(bearer(t.admin!)).send(newTask({ assigneeIds: [h.fx.users.marketer.id] })).expect(422);
      expect(res.body.message).toMatch(/not in this task's department or project team/);
      // Adding them to the project team makes the assignment valid.
      await h.http().patch(`/api/v1/projects/${String(h.fx.projectId)}`).set(bearer(t.admin!)).send({ memberIds: [h.fx.users.marketer.id] }).expect(200);
      await h.http().post('/api/v1/tasks').set(bearer(t.admin!)).send(newTask({ assigneeIds: [h.fx.users.marketer.id] })).expect(201);
    });

    it('validates dates and payloads', async () => {
      await h.http().post('/api/v1/tasks').set(bearer(t.manager!)).send(newTask({ startDate: isoDay(5), dueDate: isoDay(1) })).expect(422);
      const res = await h.http().post('/api/v1/tasks').set(bearer(t.manager!)).send(newTask({ assigneeIds: [], priority: 'urgent' })).expect(422);
      expect(Object.keys(res.body.details)).toEqual(expect.arrayContaining(['assigneeIds', 'priority']));
    });

    it('records reassignment history and notifies new assignees', async () => {
      await h.http().post(`/api/v1/tasks/${taskId}/assignments`).set(bearer(t.manager!)).send({ assigneeIds: [h.fx.users.emp1.id, h.fx.users.emp2.id] }).expect(201);
      const activity = await h.http().get(`/api/v1/tasks/${taskId}/activity`).set(bearer(t.manager!)).expect(200);
      expect(activity.body.data.map((a: { action: string }) => a.action)).toContain('task.reassigned');
      const notes = await h.http().get('/api/v1/notifications').set(bearer(t.emp2!)).expect(200);
      expect(notes.body.data[0].type).toBe('task_reassigned');
      await h.http().post(`/api/v1/tasks/${taskId}/assignments`).set(bearer(t.manager!)).send({ assigneeIds: [h.fx.users.emp1.id] }).expect(201);
      await h.http().get(`/api/v1/tasks/${taskId}`).set(bearer(t.emp2!)).expect(404);
    });
  });

  describe('workflow', () => {
    it('exposes per-user capabilities', async () => {
      const asEmp = await h.http().get(`/api/v1/tasks/${taskId}`).set(bearer(t.emp1!)).expect(200);
      expect(asEmp.body.data.capabilities).toMatchObject({ allowedStatuses: ['in_progress', 'blocked'], canSubmitForReview: true, canReview: false, canEdit: false });
      const asMgr = await h.http().get(`/api/v1/tasks/${taskId}`).set(bearer(t.manager!)).expect(200);
      expect(asMgr.body.data.capabilities).toMatchObject({ canEdit: true, canReassign: true, canUpdateProgress: false });
    });

    it('lets employees move permitted tasks to In Progress and Blocked only', async () => {
      await h.http().patch(`/api/v1/tasks/${taskId}/status`).set(bearer(t.emp1!)).send({ status: 'in_progress' }).expect(200);
      await h.http().patch(`/api/v1/tasks/${taskId}/status`).set(bearer(t.emp1!)).send({ status: 'blocked', reason: 'Waiting on IdP' }).expect(200);
      const done = await h.http().patch(`/api/v1/tasks/${taskId}/status`).set(bearer(t.emp1!)).send({ status: 'completed' }).expect(422);
      expect(done.body.message).toMatch(/submitted for review and approved/);
      await h.http().patch(`/api/v1/tasks/${taskId}/status`).set(bearer(t.emp1!)).send({ status: 'cancelled' }).expect(422);
      await h.http().patch(`/api/v1/tasks/${taskId}/status`).set(bearer(t.emp1!)).send({ status: 'in_review' }).expect(422);
      await h.http().patch(`/api/v1/tasks/${taskId}/status`).set(bearer(t.emp1!)).send({ status: 'in_progress' }).expect(200);
    });

    it('enforces progress between 0 and 100', async () => {
      await h.http().patch(`/api/v1/tasks/${taskId}/progress`).set(bearer(t.emp1!)).send({ progressPercentage: 150 }).expect(422);
      await h.http().patch(`/api/v1/tasks/${taskId}/progress`).set(bearer(t.emp1!)).send({ progressPercentage: -5 }).expect(422);
      await h.http().patch(`/api/v1/tasks/${taskId}/progress`).set(bearer(t.emp1!)).send({ progressPercentage: 33.3 }).expect(422);
      const ok = await h.http().patch(`/api/v1/tasks/${taskId}/progress`).set(bearer(t.emp1!)).send({ progressPercentage: 60 }).expect(200);
      expect(ok.body.data.progressPercentage).toBe(60);
      await h.http().patch(`/api/v1/tasks/${taskId}/progress`).set(bearer(t.manager!)).send({ progressPercentage: 70 }).expect(403);
    });

    it('logs time, comments and attachment metadata', async () => {
      const time = await h.http().post(`/api/v1/tasks/${taskId}/time-entries`).set(bearer(t.emp1!)).send({ minutes: 90, date: isoDay(0), note: 'Spike' }).expect(201);
      expect(time.body.data.actualHours).toBe(1.5);
      await h.http().post(`/api/v1/tasks/${taskId}/attachments`).set(bearer(t.emp1!)).send({ fileName: 'spec', url: 'http://insecure.example/spec' }).expect(422);
      await h.http().post(`/api/v1/tasks/${taskId}/attachments`).set(bearer(t.emp1!)).send({ fileName: 'spec', url: 'https://files.example/spec.pdf' }).expect(201);
      const c = await h.http().post(`/api/v1/tasks/${taskId}/comments`).set(bearer(t.emp1!)).send({ body: 'Ready soon @manager@acme.test' }).expect(201);
      expect(c.body.data.comments.at(-1)).toMatchObject({ body: 'Ready soon @manager@acme.test', mentions: [h.fx.users.manager.id] });
      const notes = await h.http().get('/api/v1/notifications?unreadOnly=true').set(bearer(t.manager!)).expect(200);
      expect(notes.body.data[0].type).toBe('mention');
    });

    it('submits for review, sets progress to 100 and notifies the manager', async () => {
      const res = await h.http().post(`/api/v1/tasks/${taskId}/submit-review`).set(bearer(t.emp1!)).send({ note: 'All done' }).expect(201);
      expect(res.body.data).toMatchObject({ status: 'in_review', progressPercentage: 100, review: { state: 'pending', submissionNote: 'All done' } });
      await h.http().post(`/api/v1/tasks/${taskId}/submit-review`).set(bearer(t.emp1!)).send({}).expect(422);
      await h.http().patch(`/api/v1/tasks/${taskId}/progress`).set(bearer(t.emp1!)).send({ progressPercentage: 50 }).expect(403);
    });

    it('requires a note to request changes and returns the task to In Progress', async () => {
      await h.http().post(`/api/v1/tasks/${taskId}/request-changes`).set(bearer(t.manager!)).send({}).expect(422);
      const res = await h.http().post(`/api/v1/tasks/${taskId}/request-changes`).set(bearer(t.manager!)).send({ note: 'Add tests' }).expect(201);
      expect(res.body.data).toMatchObject({ status: 'in_progress', progressPercentage: 90, review: { state: 'changes_requested', reviewNote: 'Add tests' } });
    });

    it('completes only through approval, with 100% progress', async () => {
      await h.http().post(`/api/v1/tasks/${taskId}/approve`).set(bearer(t.manager!)).send({}).expect(422);
      await h.http().post(`/api/v1/tasks/${taskId}/submit-review`).set(bearer(t.emp1!)).send({}).expect(201);
      const res = await h.http().post(`/api/v1/tasks/${taskId}/approve`).set(bearer(t.manager!)).send({ note: 'Great' }).expect(201);
      expect(res.body.data).toMatchObject({ status: 'completed', progressPercentage: 100, isOverdue: false, review: { state: 'approved' } });
      await h.http().patch(`/api/v1/tasks/${taskId}/status`).set(bearer(t.emp1!)).send({ status: 'in_progress' }).expect(403);
    });

    it('records every transition in the task activity', async () => {
      const res = await h.http().get(`/api/v1/tasks/${taskId}/activity`).set(bearer(t.emp1!)).expect(200);
      const actions = res.body.data.map((a: { action: string }) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['task.created', 'task.status_changed', 'task.progress_updated', 'task.review_submitted', 'task.changes_requested', 'task.approved']));
    });

    it('lets managers reopen completed tasks', async () => {
      const res = await h.http().patch(`/api/v1/tasks/${taskId}/status`).set(bearer(t.manager!)).send({ status: 'in_progress' }).expect(200);
      expect(res.body.data.status).toBe('in_progress');
    });
  });

  describe('deadlines', () => {
    it('computes overdue dynamically and clears it on completion — not on 100% progress', async () => {
      const created = await h.http().post('/api/v1/tasks').set(bearer(t.manager!)).send(newTask({ title: 'Late work', startDate: isoDay(-10), dueDate: isoDay(-2) })).expect(201);
      const id = created.body.data.id;
      expect(created.body.data).toMatchObject({ isOverdue: true, isDueSoon: false });
      const submitted = await h.http().post(`/api/v1/tasks/${id}/submit-review`).set(bearer(t.emp1!)).send({}).expect(201);
      expect(submitted.body.data).toMatchObject({ progressPercentage: 100, isOverdue: true });
      const overdueList = await h.http().get('/api/v1/tasks?overdue=true').set(bearer(t.emp1!)).expect(200);
      expect(overdueList.body.data.map((x: { id: string }) => x.id)).toContain(id);
      const approved = await h.http().post(`/api/v1/tasks/${id}/approve`).set(bearer(t.manager!)).send({}).expect(201);
      expect(approved.body.data.isOverdue).toBe(false);
    });

    it('flags due-soon tasks using the organisation threshold', async () => {
      const created = await h.http().post('/api/v1/tasks').set(bearer(t.manager!)).send(newTask({ title: 'Soon', dueDate: isoDay(3) })).expect(201);
      expect(created.body.data.isDueSoon).toBe(false);
      await h.http().patch('/api/v1/settings/organization').set(bearer(t.admin!)).send({ dueSoonThresholdDays: 5 }).expect(200);
      const after = await h.http().get(`/api/v1/tasks/${created.body.data.id}`).set(bearer(t.manager!)).expect(200);
      expect(after.body.data.isDueSoon).toBe(true);
      await h.http().patch('/api/v1/settings/organization').set(bearer(t.manager!)).send({ dueSoonThresholdDays: 1 }).expect(403);
    });

    it('creates idempotent overdue notifications from the scheduler', async () => {
      const { DeadlineScheduler } = await import('../src/notifications/deadline.scheduler.js');
      const scheduler = h.app.get(DeadlineScheduler);
      await h.http().post('/api/v1/tasks').set(bearer(t.manager!)).send(newTask({ title: 'Forgotten', startDate: isoDay(-5), dueDate: isoDay(-1), assigneeIds: [h.fx.users.emp2.id] })).expect(201);
      await scheduler.run();
      await scheduler.run();
      const notes = await h.http().get('/api/v1/notifications?pageSize=50').set(bearer(t.emp2!)).expect(200);
      const overdue = notes.body.data.filter((n: { type: string; body: string }) => n.type === 'task_overdue' && n.body.includes('Forgotten'));
      expect(overdue).toHaveLength(1);
    });
  });

  describe('when approval is not required', () => {
    it('lets assignees complete directly and forces 100% progress', async () => {
      await h.http().patch('/api/v1/settings/organization').set(bearer(t.admin!)).send({ reviewRequired: false }).expect(200);
      const created = await h.http().post('/api/v1/tasks').set(bearer(t.manager!)).send(newTask({ title: 'Quick fix' })).expect(201);
      const id = created.body.data.id;
      await h.http().patch(`/api/v1/tasks/${id}/status`).set(bearer(t.emp1!)).send({ status: 'in_progress' }).expect(200);
      await h.http().post(`/api/v1/tasks/${id}/submit-review`).set(bearer(t.emp1!)).send({}).expect(422);
      const done = await h.http().patch(`/api/v1/tasks/${id}/status`).set(bearer(t.emp1!)).send({ status: 'completed' }).expect(200);
      expect(done.body.data).toMatchObject({ status: 'completed', progressPercentage: 100 });
      await h.http().patch('/api/v1/settings/organization').set(bearer(t.admin!)).send({ reviewRequired: true }).expect(200);
    });
  });

  describe('reports', () => {
    it('computes statistics from stored data and exports CSV', async () => {
      const report = await h.http().get(`/api/v1/reports/tasks?from=${isoDay(-30)}&to=${isoDay(30)}`).set(bearer(t.admin!)).expect(200);
      expect(report.body.data.totals.total).toBeGreaterThanOrEqual(5);
      expect(report.body.data.statusDistribution.find((s: { status: string }) => s.status === 'completed').count).toBeGreaterThanOrEqual(2);
      const csv = await h.http().get(`/api/v1/reports/tasks?from=${isoDay(-30)}&to=${isoDay(30)}&format=csv`).set(bearer(t.admin!)).expect(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.headers['content-disposition']).toMatch(/attachment; filename="bizwoke-tasks-/);
      expect(csv.text).toContain('BN-1001');
      const employees = await h.http().get('/api/v1/reports/employees').set(bearer(t.manager!)).expect(200);
      expect(employees.body.data.find((r: { name: string }) => r.name.startsWith('emp1'))).toMatchObject({ loggedHours: 1.5 });
    });
  });
});
