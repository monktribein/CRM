import type { MockInstance } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Model } from 'mongoose';
import { ScreenshotStorageService } from '../src/monitoring/screenshot-storage.service.js';
import { HEARTBEAT_TIMEOUT_MS, MonitoringService } from '../src/monitoring/monitoring.service.js';
import { bearer, createHarness, type Harness } from './harness.js';

// Smallest valid JPEG header is enough: the API checks magic bytes, not decodability.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

describe('Screenshot monitoring (e2e)', () => {
  let h: Harness;
  let storage: ScreenshotStorageService;
  let storeSpy: MockInstance<ScreenshotStorageService['store']>;
  let deleteSpy: MockInstance<ScreenshotStorageService['delete']>;
  let service: MonitoringService;
  const t: Record<string, string> = {};

  const fileIdOf = async (id: string) => ((await h.model<{ fileId: string | null }>('Screenshot').findById(id).lean())!).fileId;
  const status = (tok: string) => h.http().get('/api/v1/monitoring/me').set(bearer(tok));
  const start = (tok: string) => h.http().post('/api/v1/monitoring/sessions').set(bearer(tok)).send({ displaySurface: 'monitor' });
  const upload = (tok: string, sessionId: string, captureId = randomUUID(), capturedAt = new Date().toISOString()) =>
    h.http().post('/api/v1/monitoring/screenshots').set(bearer(tok))
      .field('sessionId', sessionId).field('captureId', captureId).field('capturedAt', capturedAt)
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
  });
  afterAll(async () => {
    await h.close();
  });

  it('is not required until the organisation and the employee are both enabled', async () => {
    expect((await status(t.emp1!).expect(200)).body.data).toMatchObject({ required: false, needsConsent: false });
    await h.http().patch('/api/v1/monitoring/policy').set(bearer(t.admin!)).send({ enabled: true, policyVersion: '2026-1', policyText: 'We capture your screen every 5 minutes.' }).expect(200);
    expect((await status(t.emp1!).expect(200)).body.data.required).toBe(false);
    await h.http().patch(`/api/v1/monitoring/employees/${h.fx.users.emp1.id}`).set(bearer(t.admin!)).send({ enabled: true }).expect(200);
    const s = (await status(t.emp1!).expect(200)).body.data;
    expect(s).toMatchObject({ required: true, needsConsent: true, captureIntervalSeconds: 300, policy: { version: '2026-1' } });
  });

  it('refuses to start a session without consent to the current policy', async () => {
    const res = await start(t.emp1!).expect(403);
    expect(res.body.code).toBe('consent_required');
    await h.http().post('/api/v1/monitoring/me/consent').set(bearer(t.emp1!)).send({ decision: 'granted', policyVersion: 'old' }).expect(409);
  });

  it('records consent, then starts a session tied to the authenticated employee', async () => {
    await h.http().post('/api/v1/monitoring/me/consent').set(bearer(t.emp1!)).send({ decision: 'granted', policyVersion: '2026-1' }).expect(200);
    expect((await status(t.emp1!)).body.data.needsConsent).toBe(false);
    const session = (await start(t.emp1!).expect(201)).body.data;
    expect(session).toMatchObject({ userId: h.fx.users.emp1.id, status: 'active', policyVersion: '2026-1' });
    // Body fields cannot redirect the session to someone else.
    await h.http().post('/api/v1/monitoring/sessions').set(bearer(t.emp1!)).send({ userId: h.fx.users.emp2.id }).expect(422);
  });

  it('rejects sessions for employees who are not enrolled', async () => {
    expect((await start(t.emp2!).expect(409)).body.code).toBe('monitoring_disabled');
  });

  it('records a browser permission denial in the audit log', async () => {
    await h.http().post('/api/v1/monitoring/me/permission-denied').set(bearer(t.emp1!)).expect(204);
    const Logs = h.model<{ action: string }>('ActivityLog');
    expect(await Logs.countDocuments({ action: 'monitoring.permission_denied' })).toBe(1);
  });

  it('uploads screenshots idempotently by capture ID', async () => {
    const session = (await start(t.emp1!).expect(201)).body.data;
    const captureId = randomUUID();
    const first = (await upload(t.emp1!, session.id, captureId).expect(201)).body.data;
    expect(first.status).toBe('uploaded');
    const again = (await upload(t.emp1!, session.id, captureId).expect(201)).body.data;
    expect(again.id).toBe(first.id);
    expect(storeSpy).toHaveBeenCalledTimes(1);
    const Shots = h.model('Screenshot');
    expect(await Shots.countDocuments({ captureId })).toBe(1);
  });

  it('rejects non-image files and other employees’ sessions', async () => {
    const session = (await start(t.emp1!).expect(201)).body.data;
    await h.http().post('/api/v1/monitoring/screenshots').set(bearer(t.emp1!))
      .field('sessionId', session.id).field('captureId', randomUUID()).field('capturedAt', new Date().toISOString())
      .attach('file', Buffer.from('not an image'), { filename: 'x.jpg', contentType: 'image/jpeg' }).expect(400);
    await h.http().patch(`/api/v1/monitoring/employees/${h.fx.users.emp2.id}`).set(bearer(t.admin!)).send({ enabled: true }).expect(200);
    await h.http().post('/api/v1/monitoring/me/consent').set(bearer(t.emp2!)).send({ decision: 'granted', policyVersion: '2026-1' }).expect(200);
    expect((await upload(t.emp2!, session.id).expect(404)).body.code).toBe('session_not_found');
  });

  it('marks a failed storage write as failed, then succeeds on retry without duplicates', async () => {
    const session = (await start(t.emp1!).expect(201)).body.data;
    const captureId = randomUUID();
    storeSpy.mockRejectedValueOnce(new Error('write failed'));
    expect((await upload(t.emp1!, session.id, captureId).expect(503)).body.code).toBe('storage_failed');
    const Shots = h.model<{ status: string; attempts: number }>('Screenshot');
    expect(await Shots.findOne({ captureId }).lean()).toMatchObject({ status: 'failed', attempts: 1 });

    const ok = (await upload(t.emp1!, session.id, captureId).expect(201)).body.data;
    expect(ok).toMatchObject({ status: 'uploaded', attempts: 2 });
    expect(await Shots.countDocuments({ captureId })).toBe(1);
  });

  it('ends the session on logout and refuses further heartbeats', async () => {
    const session = (await start(t.emp1!).expect(201)).body.data;
    await h.http().post(`/api/v1/monitoring/sessions/${session.id}/heartbeat`).set(bearer(t.emp1!)).expect(200);
    const ended = (await h.http().post(`/api/v1/monitoring/sessions/${session.id}/end`).set(bearer(t.emp1!)).send({ reason: 'logout' }).expect(200)).body.data;
    expect(ended).toMatchObject({ status: 'ended', endReason: 'logout' });
    expect((await h.http().post(`/api/v1/monitoring/sessions/${session.id}/heartbeat`).set(bearer(t.emp1!)).expect(409)).body.code).toBe('session_inactive');
    // Clients may not claim server-only end reasons.
    await h.http().post(`/api/v1/monitoring/sessions/${session.id}/end`).set(bearer(t.emp1!)).send({ reason: 'heartbeat_timeout' }).expect(422);
  });

  it('requires a new session after a stream ends; a new session supersedes the old one', async () => {
    const a = (await start(t.emp1!).expect(201)).body.data;
    await h.http().post(`/api/v1/monitoring/sessions/${a.id}/end`).set(bearer(t.emp1!)).send({ reason: 'stream_ended' }).expect(200);
    const b = (await start(t.emp1!).expect(201)).body.data;
    const c = (await start(t.emp1!).expect(201)).body.data;
    const Sessions = h.model<{ status: string; endReason: string }>('MonitoringSession');
    expect(await Sessions.findById(b.id).lean()).toMatchObject({ status: 'ended', endReason: 'superseded' });
    expect(await Sessions.countDocuments({ userId: h.fx.users.emp1.id, status: 'active' })).toBe(1);
    expect(c.status).toBe('active');
  });

  it('expires sessions whose heartbeats stop (browser closed, computer asleep)', async () => {
    const session = (await start(t.emp1!).expect(201)).body.data;
    const Sessions: Model<{ lastHeartbeatAt: Date; status: string; endReason: string }> = h.model('MonitoringSession');
    await Sessions.updateOne({ _id: session.id }, { $set: { lastHeartbeatAt: new Date(Date.now() - HEARTBEAT_TIMEOUT_MS - 1000) } });
    // A late heartbeat cannot revive it.
    await h.http().post(`/api/v1/monitoring/sessions/${session.id}/heartbeat`).set(bearer(t.emp1!)).expect(409);
    expect(await Sessions.findById(session.id).lean()).toMatchObject({ status: 'expired', endReason: 'heartbeat_timeout' });

    const other = (await start(t.emp1!).expect(201)).body.data;
    await Sessions.updateOne({ _id: other.id }, { $set: { lastHeartbeatAt: new Date(Date.now() - HEARTBEAT_TIMEOUT_MS - 1000) } });
    expect(await service.expireStaleSessions()).toBe(1);
    expect((await Sessions.findById(other.id).lean())!.status).toBe('expired');
  });

  describe('access control', () => {
    it('hides screenshot history and settings from employees and HR', async () => {
      for (const who of ['emp1', 'hr'] as const) {
        await h.http().get('/api/v1/monitoring/employees').set(bearer(t[who]!)).expect(403);
        await h.http().get(`/api/v1/monitoring/screenshots?userId=${h.fx.users.emp1.id}`).set(bearer(t[who]!)).expect(403);
      }
      await h.http().patch('/api/v1/monitoring/policy').set(bearer(t.manager!)).send({ enabled: false }).expect(403);
      await h.http().patch(`/api/v1/monitoring/employees/${h.fx.users.emp1.id}`).set(bearer(t.manager!)).send({ enabled: false }).expect(403);
    });

    it('lets managers see their own team only', async () => {
      const list = await h.http().get(`/api/v1/monitoring/screenshots?userId=${h.fx.users.emp1.id}`).set(bearer(t.manager!)).expect(200);
      expect(list.body.data.length).toBeGreaterThan(0);
      await h.http().get(`/api/v1/monitoring/screenshots?userId=${h.fx.users.marketer.id}`).set(bearer(t.manager!)).expect(404);
      const emails = (await h.http().get('/api/v1/monitoring/employees?pageSize=100').set(bearer(t.manager!)).expect(200)).body.data.map((r: { email: string }) => r.email);
      expect(emails).toContain('emp1@acme.test');
      expect(emails).not.toContain('marketer@acme.test');
    });

    it('serves image bytes to authorised viewers and audits each view', async () => {
      const shot = (await h.http().get(`/api/v1/monitoring/screenshots?userId=${h.fx.users.emp1.id}`).set(bearer(t.admin!)).expect(200)).body.data.find((s: { status: string }) => s.status === 'uploaded');
      const res = await h.http().get(`/api/v1/monitoring/screenshots/${shot.id}/content`).set(bearer(t.admin!)).buffer(true).expect(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      await h.http().get(`/api/v1/monitoring/screenshots/${shot.id}/content`).set(bearer(t.emp1!)).expect(403);
      const Logs = h.model<{ action: string }>('ScreenshotAccessLog');
      expect(await Logs.countDocuments({ action: 'previewed' })).toBe(1);
    });
  });

  describe('retention', () => {
    it('lets admins delete a screenshot, removing the stored file', async () => {
      const shot = (await h.http().get(`/api/v1/monitoring/screenshots?userId=${h.fx.users.emp1.id}`).set(bearer(t.admin!)).expect(200)).body.data.find((s: { status: string }) => s.status === 'uploaded');
      const fileId = await fileIdOf(shot.id);
      expect(await storage.read(fileId!)).toBeInstanceOf(Buffer);
      await h.http().delete(`/api/v1/monitoring/screenshots/${shot.id}`).set(bearer(t.manager!)).expect(403);
      await h.http().delete(`/api/v1/monitoring/screenshots/${shot.id}`).set(bearer(t.admin!)).expect(204);
      expect(deleteSpy).toHaveBeenCalledWith(fileId);
      await expect(storage.read(fileId!)).rejects.toMatchObject({ status: 404 });
      await h.http().get(`/api/v1/monitoring/screenshots/${shot.id}/content`).set(bearer(t.admin!)).expect(404);
    });

    it('purges screenshots past their retention date', async () => {
      const Shots = h.model<{ status: string; expiresAt: Date }>('Screenshot');
      const live = await Shots.countDocuments({ status: 'uploaded' });
      expect(live).toBeGreaterThan(0);
      expect(await service.purgeExpiredScreenshots(new Date(Date.now() + 400 * 864e5))).toBeGreaterThanOrEqual(live);
      expect(await Shots.countDocuments({ status: { $ne: 'deleted' } })).toBe(0);
    });
  });

  it('ends active sessions when an admin disables monitoring', async () => {
    const session = (await start(t.emp1!).expect(201)).body.data;
    await h.http().patch('/api/v1/monitoring/policy').set(bearer(t.admin!)).send({ enabled: false }).expect(200);
    const Sessions = h.model<{ status: string; endReason: string }>('MonitoringSession');
    expect(await Sessions.findById(session.id).lean()).toMatchObject({ status: 'ended', endReason: 'monitoring_disabled' });
    expect((await upload(t.emp1!, session.id).expect(410)).body.code).toBe('monitoring_disabled');
  });
});
