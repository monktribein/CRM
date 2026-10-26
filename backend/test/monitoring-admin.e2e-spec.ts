import type { MockInstance } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ScreenshotStorageService } from '../src/monitoring/screenshot-storage.service.js';
import { MonitoringService } from '../src/monitoring/monitoring.service.js';
import { bearer, createHarness, PASSWORD, type Harness } from './harness.js';

/** A JPEG header with a baseline SOF0 marker declaring 1280×720. */
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00, 0x03]),
  Buffer.alloc(64, 1),
]);

const ADMIN_ENDPOINTS = ['sessions', 'screenshots', 'uploads', 'access-logs'];

describe('Super Admin monitoring dashboard (e2e)', () => {
  let h: Harness;
  let storage: ScreenshotStorageService;
  let storeSpy: MockInstance<ScreenshotStorageService['store']>;
  let deleteSpy: MockInstance<ScreenshotStorageService['delete']>;
  let service: MonitoringService;
  const t: Record<string, string> = {};
  const sessions: Record<string, string> = {};
  let otherOrgToken: string;

  const fileIdOf = async (id: string) => ((await h.model<{ fileId: string | null }>('Screenshot').findById(id).lean())!).fileId;
  const api = (path: string, tok = t.superAdmin!) => h.http().get(`/api/v1/monitoring/admin/${path}`).set(bearer(tok));
  const start = async (who: string) => (await h.http().post('/api/v1/monitoring/sessions').set(bearer(t[who]!)).send({ displaySurface: 'monitor' }).expect(201)).body.data.id as string;
  const upload = (who: string, sessionId: string, captureId = randomUUID()) =>
    h.http().post('/api/v1/monitoring/screenshots').set(bearer(t[who]!))
      .field('sessionId', sessionId).field('captureId', captureId).field('capturedAt', new Date().toISOString())
      .attach('file', JPEG, { filename: 'shot.jpg', contentType: 'image/jpeg' });

  beforeAll(async () => {
    h = await createHarness();
    for (const [k, u] of Object.entries(h.fx.users)) {
      if (k !== 'inactive') t[k] = (await h.login(u.email)).token;
    }
    service = h.app.get(MonitoringService);
    // Real GridFS storage in the in-memory MongoDB; spies only observe or inject failures.
    storage = h.app.get(ScreenshotStorageService);
    storeSpy = vi.spyOn(storage, 'store');
    deleteSpy = vi.spyOn(storage, 'delete');

    // Organisation in India Standard Time (UTC+05:30, no DST).
    await h.model('Organization').updateOne({ _id: h.fx.orgId }, { $set: { timezone: 'Asia/Kolkata' } });
    await h.http().patch('/api/v1/monitoring/policy').set(bearer(t.superAdmin!)).send({ enabled: true, policyVersion: 'v1' }).expect(200);
    for (const who of ['emp1', 'marketer'] as const) {
      await h.http().patch(`/api/v1/monitoring/employees/${h.fx.users[who].id}`).set(bearer(t.superAdmin!)).send({ enabled: true }).expect(200);
      await h.http().post('/api/v1/monitoring/me/consent').set(bearer(t[who]!)).send({ decision: 'granted', policyVersion: 'v1' }).expect(200);
    }

    // emp1: session ended by logout with two screenshots.
    sessions.logout = await start('emp1');
    await upload('emp1', sessions.logout).expect(201);
    await upload('emp1', sessions.logout).expect(201);
    await h.http().post(`/api/v1/monitoring/sessions/${sessions.logout}/end`).set(bearer(t.emp1!)).send({ reason: 'logout' }).expect(200);
    // emp1: stream stopped (interrupted).
    sessions.stream = await start('emp1');
    await h.http().post(`/api/v1/monitoring/sessions/${sessions.stream}/end`).set(bearer(t.emp1!)).send({ reason: 'stream_ended' }).expect(200);
    // marketer: still active.
    sessions.active = await start('marketer');
    await upload('marketer', sessions.active).expect(201);

    // A second organisation with its own Super Admin.
    const Org = h.model<{ name: string; slug: string }>('Organization');
    const other = await Org.create({ name: 'Other Org', slug: 'other' });
    const { hashPassword } = await import('../src/auth/password.js');
    await h.model('User').create({
      organizationId: other._id, employeeId: 'O-1', firstName: 'Olga', lastName: 'Other', email: 'root@other.test',
      passwordHash: await hashPassword(PASSWORD), securityRole: 'super_admin', jobFunction: 'other', status: 'active', joinedAt: new Date(),
    });
    otherOrgToken = (await h.login('root@other.test')).token;
  });
  afterAll(async () => {
    await h.close();
  });

  describe('authorisation', () => {
    it('is limited to Super Admins — admins, HR, managers and employees get 403', async () => {
      for (const path of ADMIN_ENDPOINTS) await api(path).expect(200);
      for (const who of ['admin', 'hr', 'manager', 'emp1']) {
        for (const path of ADMIN_ENDPOINTS) await api(path, t[who]).expect(403);
        await api(`sessions/${sessions.logout}`, t[who]).expect(403);
      }
    });

    it('never crosses organisation boundaries, even with a known ID', async () => {
      expect((await api('sessions', otherOrgToken).expect(200)).body.data).toHaveLength(0);
      expect((await api('screenshots', otherOrgToken).expect(200)).body.data).toHaveLength(0);
      await api(`sessions/${sessions.logout}`, otherOrgToken).expect(404);
      const shot = (await api(`screenshots?sessionId=${sessions.logout}`).expect(200)).body.data[0];
      await api(`screenshots/${shot.id}/preview`, otherOrgToken).expect(404);
      // Client-supplied filters can't widen the scope either.
      expect((await api(`screenshots?userId=${h.fx.users.emp1.id}`, otherOrgToken).expect(200)).body.data).toHaveLength(0);
    });

    it('rejects unauthenticated preview requests', async () => {
      const shot = (await api(`screenshots?sessionId=${sessions.logout}`).expect(200)).body.data[0];
      await h.http().get(`/api/v1/monitoring/admin/screenshots/${shot.id}/preview`).expect(401);
    });
  });

  describe('login activity', () => {
    it('distinguishes confirmed logout from interruption and never invents a logout time', async () => {
      const rows = (await api('sessions?pageSize=50').expect(200)).body.data as { id: string; displayStatus: string; logoutAt: string | null; loginAt: string | null; captureCount: number; lastUploadAt: string | null; employee: { employeeId: string; departmentName: string; jobFunction: string; consent: { current: boolean } } }[];
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[sessions.logout!]).toMatchObject({ displayStatus: 'ended', captureCount: 2 });
      expect(byId[sessions.logout!]!.logoutAt).not.toBeNull();
      expect(byId[sessions.logout!]!.lastUploadAt).not.toBeNull();
      expect(byId[sessions.logout!]!.loginAt).not.toBeNull();
      expect(byId[sessions.stream!]).toMatchObject({ displayStatus: 'interrupted', logoutAt: null });
      expect(byId[sessions.active!]).toMatchObject({ displayStatus: 'active', logoutAt: null });
      expect(byId[sessions.active!]!.employee).toMatchObject({ departmentName: 'Marketing', jobFunction: 'other', consent: { current: true } });
    });

    it('shows heartbeat-timeout sessions as expired without a logout time', async () => {
      const id = await start('emp1');
      await h.model('MonitoringSession').updateOne({ _id: id }, { $set: { lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) } });
      await service.expireStaleSessions();
      const row = (await api(`sessions/${id}`).expect(200)).body.data;
      expect(row).toMatchObject({ displayStatus: 'expired', logoutAt: null, endReason: 'heartbeat_timeout' });
    });

    it('filters by employee search, department and status, and sorts', async () => {
      const ids = (res: { body: { data: { employee: { email: string } }[] } }) => [...new Set(res.body.data.map((r) => r.employee.email))];
      expect(ids(await api('sessions?search=marketer').expect(200))).toEqual(['marketer@acme.test']);
      expect(ids(await api(`sessions?departmentId=${String(h.fx.devId)}`).expect(200))).toEqual(['emp1@acme.test']);
      const interrupted = (await api('sessions?status=interrupted').expect(200)).body.data;
      expect(interrupted.map((r: { id: string }) => r.id)).toEqual([sessions.stream]);
      const sorted = (await api('sessions?sort=captureCount&order=desc').expect(200)).body.data;
      expect(sorted[0].id).toBe(sessions.logout);
      await api('sessions?sort=password').expect(422);
      const page = await api('sessions?pageSize=1&page=2').expect(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta.total).toBeGreaterThanOrEqual(4);
    });

    it('applies date filters as calendar days in the organisation timezone', async () => {
      // 2026-03-10T19:00Z is 00:30 on 11 March in Asia/Kolkata.
      const Sessions = h.model('MonitoringSession');
      const s = await Sessions.create({ organizationId: h.fx.orgId, userId: h.fx.users.emp2.id, status: 'ended', endReason: 'logout', policyVersion: 'v1', startedAt: new Date('2026-03-10T19:00:00Z'), lastHeartbeatAt: new Date('2026-03-10T19:05:00Z'), endedAt: new Date('2026-03-10T19:05:00Z') });
      const ids = async (q: string) => (await api(`sessions?${q}`).expect(200)).body.data.map((r: { id: string }) => r.id);
      expect(await ids('from=2026-03-11&to=2026-03-11')).toEqual([String(s._id)]);
      expect(await ids('from=2026-03-10&to=2026-03-10')).toEqual([]);
      // 18:29Z on the 11th is 23:59 IST — still the 11th; 18:30Z is the 12th.
      await Sessions.collection.updateOne({ _id: s._id }, { $set: { startedAt: new Date('2026-03-11T18:29:00Z') } });
      expect(await ids('from=2026-03-11&to=2026-03-11')).toEqual([String(s._id)]);
      await Sessions.collection.updateOne({ _id: s._id }, { $set: { startedAt: new Date('2026-03-11T18:30:00Z') } });
      expect(await ids('from=2026-03-11&to=2026-03-11')).toEqual([]);
      await api('sessions?from=11/03/2026').expect(422);
      // Timestamps are returned in UTC (ISO 8601 with Z) for the client to render in the org zone.
      expect((await api(`sessions/${String(s._id)}`).expect(200)).body.data).toMatchObject({ startedAt: '2026-03-11T18:30:00.000Z', timezone: 'Asia/Kolkata' });
    });
  });

  describe('screenshot gallery', () => {
    it('lists a session’s screenshots in capture order with dimensions and availability', async () => {
      const shots = (await api(`screenshots?sessionId=${sessions.logout}`).expect(200)).body.data;
      expect(shots).toHaveLength(2);
      expect(Date.parse(shots[0].capturedAt)).toBeLessThanOrEqual(Date.parse(shots[1].capturedAt));
      expect(shots[0]).toMatchObject({ width: 1280, height: 720, status: 'uploaded', availability: 'available', employee: { employeeId: expect.any(String) } });
    });

    it('streams previews and downloads through the API and audits both', async () => {
      const shot = (await api(`screenshots?sessionId=${sessions.logout}`).expect(200)).body.data[0];
      const preview = await api(`screenshots/${shot.id}/preview`).buffer(true).expect(200);
      expect(preview.headers['content-type']).toBe('image/jpeg');
      expect(preview.headers['content-disposition']).toMatch(/^inline/);
      expect(JSON.stringify(preview.headers)).not.toMatch(/mongodb|gridfs/i);
      const dl = await api(`screenshots/${shot.id}/preview?download=true`).buffer(true).expect(200);
      expect(dl.headers['content-disposition']).toMatch(/^attachment/);

      const logs = (await api('access-logs').expect(200)).body.data;
      expect(logs.slice(0, 2).map((l: { action: string }) => l.action)).toEqual(['downloaded', 'previewed']);
      expect(logs[0]).toMatchObject({ actor: { id: h.fx.users.superAdmin.id, role: 'super_admin' }, screenshotId: shot.id, employee: { id: h.fx.users.emp1.id } });
      expect((await api('access-logs?action=downloaded').expect(200)).body.data).toHaveLength(1);
    });

    it('reports pending uploads and files missing from storage honestly', async () => {
      const Shots = h.model('Screenshot');
      const pending = await Shots.create({ organizationId: h.fx.orgId, userId: h.fx.users.emp1.id, sessionId: sessions.stream, captureId: randomUUID(), capturedAt: new Date(), status: 'pending', expiresAt: new Date(Date.now() + 864e5) });
      expect((await api(`screenshots/${String(pending._id)}/preview`).expect(409)).body.code).toBe('not_uploaded');

      const shot = (await api(`screenshots?sessionId=${sessions.logout}`).expect(200)).body.data[1];
      await storage.delete((await fileIdOf(shot.id))!); // removed behind the CRM's back
      expect((await api(`screenshots/${shot.id}/preview`).expect(404)).body.code).toBe('file_missing');
      const after = (await api(`screenshots?sessionId=${sessions.logout}&availability=missing`).expect(200)).body.data;
      expect(after.map((s: { id: string }) => s.id)).toEqual([shot.id]);
    });
  });

  describe('upload & sync status', () => {
    it('shows failed uploads with their error and the browser backlog from heartbeats', async () => {
      storeSpy.mockRejectedValueOnce(new Error('write failed: 500 backend error'));
      await upload('marketer', sessions.active!).expect(503);
      await h.http().post(`/api/v1/monitoring/sessions/${sessions.active}/heartbeat`).set(bearer(t.marketer!))
        .send({ pendingUploads: 3, oldestPendingAt: new Date(Date.now() - 600_000).toISOString() }).expect(200);

      const status = (await api('uploads').expect(200)).body.data;
      expect(status.storageConfigured).toBe(true);
      expect(status.counts).toMatchObject({ failed: 1, missing: 1 });
      expect(status.counts.uploaded).toBeGreaterThan(0);
      const failed = status.problems.find((p: { status: string }) => p.status === 'failed');
      expect(failed).toMatchObject({ attempts: 1, lastError: expect.stringContaining('500'), employee: { id: h.fx.users.marketer.id } });
      expect(status.browserBacklog).toEqual([expect.objectContaining({ sessionId: sessions.active, clientQueue: expect.objectContaining({ pending: 3 }) })]);
    });
  });

  describe('retention', () => {
    it('purges expired screenshots, blocks previews and records the purge in the audit log', async () => {
      const shot = (await api(`screenshots?sessionId=${sessions.active}&availability=available`).expect(200)).body.data[0];
      const fileId = await fileIdOf(shot.id);
      await h.model('Screenshot').updateOne({ _id: shot.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await service.purgeExpiredScreenshots()).toBeGreaterThanOrEqual(1);
      expect(deleteSpy).toHaveBeenCalledWith(fileId);
      await expect(storage.read(fileId!)).rejects.toMatchObject({ status: 404 });
      expect((await api(`screenshots/${shot.id}/preview`).expect(410)).body.code).toBe('screenshot_deleted');
      const purged = (await api('access-logs?action=retention_purged').expect(200)).body.data;
      expect(purged.find((l: { screenshotId: string }) => l.screenshotId === shot.id)).toMatchObject({ actor: { id: null } });
    });
  });
});
