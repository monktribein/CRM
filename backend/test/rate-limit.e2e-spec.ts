import { createHarness, type Harness } from './harness.js';

describe('Rate limiting (e2e)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ authRateLimit: 10 });
  });
  afterAll(async () => {
    await h.close();
  });

  it('throttles repeated login attempts', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await h.http().post('/api/v1/auth/login').send({ email: 'emp1@acme.test', password: `wrong-pass-${i}` });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('throttles per account, so colleagues behind the same office IP can still sign in', async () => {
    // emp1 is throttled from the test above; emp2 shares the IP but not the bucket.
    await h.http().post('/api/v1/auth/login').send({ email: 'emp1@acme.test', password: 'Correct-horse-42' }).expect(429);
    await h.http().post('/api/v1/auth/login').send({ email: 'emp2@acme.test', password: 'Correct-horse-42' }).expect(200);
  });

  it('allows frequent page reloads (session refreshes) without signing users out', async () => {
    const { cookie } = await h.login('manager@acme.test');
    let current = cookie;
    for (let i = 0; i < 40; i++) {
      const res = await h.http().post('/api/v1/auth/refresh').set('Cookie', current).expect(200);
      current = ([] as string[]).concat(res.headers['set-cookie']).find((c) => c.startsWith('bn_refresh='))!.split(';')[0]!;
    }
  });
});
