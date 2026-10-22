import { bearer, createHarness, FRONTEND, PASSWORD, type Harness } from './harness.js';

describe('Authentication (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it('reports health with the database up', async () => {
    const res = await h.http().get('/api/v1/health').expect(200);
    expect(res.body.data).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('logs in and sets a secure HttpOnly refresh cookie scoped to /api/v1/auth', async () => {
    const res = await h.http().post('/api/v1/auth/login').send({ email: 'EMP1@acme.test ', password: PASSWORD }).expect(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({ email: 'emp1@acme.test', role: 'employee', permissions: ['projects.view'] });
    expect(res.body.data).not.toHaveProperty('refreshToken');
    const cookie = ([] as string[]).concat(res.headers['set-cookie']).find((c) => c.startsWith('bn_refresh='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('returns the same error for unknown users and wrong passwords', async () => {
    const wrong = await h.http().post('/api/v1/auth/login').send({ email: 'emp1@acme.test', password: 'nope-nope-1' }).expect(401);
    const unknown = await h.http().post('/api/v1/auth/login').send({ email: 'nobody@acme.test', password: 'nope-nope-1' }).expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
    expect(wrong.body).toMatchObject({ statusCode: 401, error: 'UNAUTHORIZED', path: '/api/v1/auth/login' });
    expect(wrong.body.timestamp).toEqual(expect.any(String));
  });

  it('blocks deactivated accounts', async () => {
    await h.http().post('/api/v1/auth/login').send({ email: 'gone@acme.test', password: PASSWORD }).expect(403);
  });

  it('rejects unknown properties and operator injection', async () => {
    const res = await h.http().post('/api/v1/auth/login').send({ email: 'emp1@acme.test', password: PASSWORD, role: 'super_admin' }).expect(422);
    expect(res.body.details).toHaveProperty('role');
    await h.http().post('/api/v1/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } }).expect(422);
  });

  it('requires a valid access token for protected routes', async () => {
    await h.http().get('/api/v1/auth/me').expect(401);
    await h.http().get('/api/v1/auth/me').set(bearer('not-a-jwt')).expect(401);
    const { token } = await h.login('emp2@acme.test');
    const me = await h.http().get('/api/v1/auth/me').set(bearer(token)).expect(200);
    expect(me.body.data).toMatchObject({ email: 'emp2@acme.test', departmentName: 'Development', organizationName: 'Acme Test Org' });
  });

  it('rotates refresh tokens and revokes the family when an old token is reused', async () => {
    const { cookie: first } = await h.login('manager@acme.test');
    const r1 = await h.http().post('/api/v1/auth/refresh').set('Cookie', first).expect(200);
    const second = ([] as string[]).concat(r1.headers['set-cookie']).find((c) => c.startsWith('bn_refresh='))!.split(';')[0]!;
    expect(second).not.toBe(first);
    expect(r1.body.data.accessToken).toEqual(expect.any(String));

    // Replaying the rotated token is treated as theft…
    await h.http().post('/api/v1/auth/refresh').set('Cookie', first).expect(401);
    // …and invalidates the newest token in the same family.
    await h.http().post('/api/v1/auth/refresh').set('Cookie', second).expect(401);
  });

  it('revokes the session on logout', async () => {
    const { cookie } = await h.login('admin@acme.test');
    await h.http().post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
    await h.http().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('rejects cookie-authenticated calls from foreign origins', async () => {
    const { cookie } = await h.login('hr@acme.test');
    await h.http().post('/api/v1/auth/refresh').set('Cookie', cookie).set('Origin', 'https://evil.example').expect(403);
    await h.http().post('/api/v1/auth/refresh').set('Cookie', cookie).set('Origin', FRONTEND).expect(200);
  });

  it('only allows the configured frontend origin via CORS', async () => {
    const ok = await h.http().options('/api/v1/auth/login').set('Origin', FRONTEND).set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe(FRONTEND);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await h.http().options('/api/v1/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('has no public registration — account creation requires an administrator', async () => {
    await h.http().post('/api/v1/users').send({ email: 'x@acme.test' }).expect(401);
    // The route simply doesn't exist.
    await h.http().post('/api/v1/auth/register').send({ email: 'x@acme.test' }).expect(404);
  });

  it('activates invited accounts with a single-use invitation token', async () => {
    const { token } = await h.login('root@acme.test');
    const created = await h
      .http()
      .post('/api/v1/users')
      .set(bearer(token))
      .send({
        firstName: 'New',
        lastName: 'Hire',
        email: 'new.hire@acme.test',
        role: 'employee',
        jobFunction: 'developer',
        departmentId: String(h.fx.devId),
        managerId: h.fx.users.manager.id,
        joinDate: '2026-10-01',
        sendInvitation: true,
      })
      .expect(201);
    expect(created.body.data.user).toMatchObject({ status: 'invited', role: 'employee', departmentName: 'Development' });
    // No SMTP configured in tests, so the API honestly reports that and returns the link.
    expect(created.body.data.emailSent).toBe(false);
    const inviteToken = new URL(created.body.data.invitationUrl).searchParams.get('token')!;

    await h.http().post('/api/v1/auth/login').send({ email: 'new.hire@acme.test', password: 'Whatever-123' }).expect(401);
    await h.http().post('/api/v1/auth/accept-invitation').send({ token: inviteToken, password: 'short' }).expect(422);
    await h.http().post('/api/v1/auth/accept-invitation').send({ token: inviteToken, password: 'Brand-new-pass-1' }).expect(204);
    await h.http().post('/api/v1/auth/accept-invitation').send({ token: inviteToken, password: 'Brand-new-pass-1' }).expect(400);
    const login = await h.http().post('/api/v1/auth/login').send({ email: 'new.hire@acme.test', password: 'Brand-new-pass-1' }).expect(200);
    expect(login.body.data.user.role).toBe('employee');
  });

  it('never stores raw tokens or passwords', async () => {
    const tokens = await h.model<{ tokenHash: string }>('RefreshToken').find().lean();
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) expect(t.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const user = await h.model<{ passwordHash: string }>('User').findOne({ email: 'emp1@acme.test' }).select('+passwordHash').lean();
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('changes the password and revokes other sessions', async () => {
    const other = await h.login('emp2@acme.test');
    const current = await h.login('emp2@acme.test');
    await h.http().post('/api/v1/auth/change-password').set(bearer(current.token)).send({ currentPassword: 'wrong', newPassword: 'Another-pass-99' }).expect(422);
    await h.http().post('/api/v1/auth/change-password').set(bearer(current.token)).send({ currentPassword: PASSWORD, newPassword: 'Another-pass-99' }).expect(204);
    await h.http().post('/api/v1/auth/refresh').set('Cookie', other.cookie).expect(401);
    await h.http().post('/api/v1/auth/login').send({ email: 'emp2@acme.test', password: 'Another-pass-99' }).expect(200);
  });
});
