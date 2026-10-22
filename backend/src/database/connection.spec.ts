import { validateEnv } from '../config/env.js';
import { describeHosts, redactCredentials, resolveDbName } from './connection.js';

const URI = 'mongodb+srv://nova_user:S3cr3t%40pass@cluster0.abcd.mongodb.net/?retryWrites=true&w=majority';

describe('connection helpers', () => {
  it('never reveals credentials', () => {
    expect(redactCredentials(URI)).not.toContain('S3cr3t');
    expect(redactCredentials(URI)).not.toContain('nova_user');
    expect(redactCredentials(`connect failed for ${URI} (timeout)`)).toBe(
      'connect failed for mongodb+srv://***:***@cluster0.abcd.mongodb.net/?retryWrites=true&w=majority (timeout)',
    );
    expect(describeHosts(URI)).toBe('cluster0.abcd.mongodb.net');
    expect(describeHosts('mongodb://a:1@h1:27017,h2:27017/db')).toBe('h1:27017,h2:27017');
  });

  it('resolves the database name: explicit → URI path → bizwoke_nova', () => {
    expect(resolveDbName(URI)).toBe('bizwoke_nova');
    expect(resolveDbName('mongodb+srv://u:p@c.example.net/acme_prod?w=majority')).toBe('acme_prod');
    expect(resolveDbName('mongodb+srv://u:p@c.example.net/acme_prod', 'override')).toBe('override');
  });
});

describe('environment validation', () => {
  const base = {
    NODE_ENV: 'development',
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    FRONTEND_URL: 'http://localhost:3000',
  };

  it('fails clearly when MONGODB_URI is missing', () => {
    expect(() => validateEnv({ ...base })).toThrow(/MONGODB_URI is not set/);
  });

  it('rejects a malformed MONGODB_URI without echoing it', () => {
    try {
      validateEnv({ ...base, MONGODB_URI: 'postgres://user:hunter2@db' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/must start with mongodb:\/\/ or mongodb\+srv:\/\//);
      expect((err as Error).message).not.toContain('hunter2');
    }
  });

  it('accepts an Atlas SRV URI and defaults the pool size', () => {
    const env = validateEnv({ ...base, MONGODB_URI: URI });
    expect(env.MONGODB_MAX_POOL_SIZE).toBe(20);
  });
});

describe('allowed frontend origins', () => {
  const allowed = ['https://bizwoke-nova.vercel.app', 'https://crm-*-riya-pandeys-projects-698f6c31.vercel.app'];

  it('matches exact origins and Vercel preview deployments of the same team', async () => {
    const { isAllowedOrigin } = await import('../config/env.js');
    expect(isAllowedOrigin('https://bizwoke-nova.vercel.app', allowed)).toBe(true);
    expect(isAllowedOrigin('https://crm-3vok4j0w0-riya-pandeys-projects-698f6c31.vercel.app', allowed)).toBe(true);
  });

  it('rejects look-alikes and other sites', async () => {
    const { isAllowedOrigin } = await import('../config/env.js');
    expect(isAllowedOrigin('https://evil.vercel.app', allowed)).toBe(false);
    expect(isAllowedOrigin('https://crm-x.evil.com-riya-pandeys-projects-698f6c31.vercel.app', allowed)).toBe(false);
    expect(isAllowedOrigin('https://crm-a-riya-pandeys-projects-698f6c31.vercel.app.evil.com', allowed)).toBe(false);
    expect(isAllowedOrigin('http://crm-a-riya-pandeys-projects-698f6c31.vercel.app', allowed)).toBe(false);
  });

  it('refuses over-broad patterns at startup', () => {
    const env = { NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://u:p@c.example.net', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40) };
    expect(() => validateEnv({ ...env, FRONTEND_URL: 'https://app.example.com,https://*.vercel.app' })).toThrow(/too broad/);
    expect(() => validateEnv({ ...env, FRONTEND_URL: 'https://crm-*-team.vercel.app' })).toThrow(/first entry must be your real site/);
    expect(() => validateEnv({ ...env, FRONTEND_URL: 'https://app.example.com,https://crm-*-team.vercel.app' })).not.toThrow();
  });
});
