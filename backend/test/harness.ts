import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Model, Types } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types.js';

export const PASSWORD = 'Correct-horse-42';
export const FRONTEND = 'https://app.example.test';

export interface Fixtures {
  orgId: Types.ObjectId;
  devId: Types.ObjectId;
  marketingId: Types.ObjectId;
  projectId: Types.ObjectId;
  users: Record<'superAdmin' | 'admin' | 'hr' | 'manager' | 'emp1' | 'emp2' | 'marketer' | 'inactive', { id: string; email: string }>;
}

export interface Harness {
  app: INestApplication<App>;
  http: () => ReturnType<typeof request>;
  fx: Fixtures;
  model: <T>(name: string) => Model<T>;
  login: (email: string, password?: string) => Promise<{ token: string; cookie: string }>;
  close: () => Promise<void>;
}

/**
 * Boots the real application (same configureApp as production) against an
 * in-memory MongoDB, with a seeded organisation and one user per role.
 */
export async function createHarness(opts: { authRateLimit?: number } = {}): Promise<Harness> {
  const mongo = await MongoMemoryServer.create();
  Object.assign(process.env, {
    // Suites log in many times from one IP; the dedicated rate-limit suite uses the real default.
    AUTH_RATE_LIMIT: String(opts.authRateLimit ?? 1000),
    NODE_ENV: 'test',
    MONGODB_URI: mongo.getUri('bizwoke-test'),
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-123',
    JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-456',
    FRONTEND_URL: FRONTEND,
    APP_NAME: 'Bizwoke Nova',
  });

  // Imported after the environment is set: ConfigModule validates at import time.
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/configure-app.js');
  const { hashPassword } = await import('../src/auth/password.js');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();

  const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
  const Org = model<{ name: string; slug: string }>('Organization');
  const Dept = model<{ organizationId: Types.ObjectId; name: string; slug: string; managerId?: string }>('Department');
  const User = model<Record<string, unknown>>('User');
  const Project = model<{ organizationId: Types.ObjectId; projectCode: string; createdBy: string; name: string; departmentId: Types.ObjectId; status: string; startDate: Date; dueDate: Date }>('Project');

  const org = await Org.create({ name: 'Acme Test Org', slug: 'acme' });
  const [dev, marketing, hrDept] = await Dept.create([
    { organizationId: org._id, name: 'Development', slug: 'development' },
    { organizationId: org._id, name: 'Marketing', slug: 'marketing' },
    { organizationId: org._id, name: 'HR', slug: 'hr' },
  ]);
  const hash = await hashPassword(PASSWORD);
  let n = 0;
  const mk = async (email: string, role: string, departmentId: Types.ObjectId, status = 'active') => {
    const u = await User.create({
      organizationId: org._id,
      employeeId: `T-${++n}`,
      firstName: email.split('@')[0],
      lastName: 'Test',
      email,
      passwordHash: hash,
      securityRole: role,
      jobFunction: 'other',
      departmentId,
      status,
      joinedAt: new Date(),
    });
    return { id: String(u._id), email };
  };
  const users = {
    superAdmin: await mk('root@acme.test', 'super_admin', dev!._id),
    admin: await mk('admin@acme.test', 'admin', dev!._id),
    hr: await mk('hr@acme.test', 'hr_manager', hrDept!._id),
    manager: await mk('manager@acme.test', 'manager', dev!._id),
    emp1: await mk('emp1@acme.test', 'employee', dev!._id),
    emp2: await mk('emp2@acme.test', 'employee', dev!._id),
    marketer: await mk('marketer@acme.test', 'employee', marketing!._id),
    inactive: await mk('gone@acme.test', 'employee', dev!._id, 'deactivated'),
  };
  await Dept.updateOne({ _id: dev!._id }, { managerId: users.manager.id });
  const project = await Project.create({
    organizationId: org._id,
    projectCode: 'CORE',
    createdBy: users.superAdmin.id,
    name: 'Core Platform',
    departmentId: dev!._id,
    status: 'active',
    startDate: new Date(),
    dueDate: new Date(Date.now() + 90 * 864e5),
  });

  const http = () => request(app.getHttpServer());
  const login = async (email: string, password = PASSWORD) => {
    const res = await http().post('/api/v1/auth/login').send({ email, password }).expect(200);
    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    return { token: res.body.data.accessToken as string, cookie: setCookie.find((c) => c.startsWith('bn_refresh='))!.split(';')[0]! };
  };

  return {
    app,
    http,
    model,
    login,
    fx: { orgId: org._id, devId: dev!._id, marketingId: marketing!._id, projectId: project._id, users },
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export function isoDay(offsetDays: number) {
  return new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);
}
