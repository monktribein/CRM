import { Module, type DynamicModule, type INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { validateEnv } from '../config/env.js';
import { redactCredentials } from './connection.js';
import { DatabaseModule } from './database.module.js';
import { ALL_MODELS } from './models.js';

/** Minimal context for database scripts: config + connection + models only. */
@Module({})
class DatabaseCliModule {}

/** Built lazily so configuration errors are reported cleanly by runDatabaseScript. */
function databaseCliModule(): DynamicModule {
  return {
    module: DatabaseCliModule,
    imports: [
      ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
      DatabaseModule,
      MongooseModule.forFeature(ALL_MODELS),
    ],
  };
}

export function model<T>(app: INestApplicationContext, name: string): Model<T> {
  return app.get<Model<T>>(getModelToken(name));
}

/**
 * Runs a database script with clean output and a guaranteed exit code.
 * Errors are printed without credentials.
 */
export async function runDatabaseScript(name: string, fn: (app: INestApplicationContext) => Promise<void>) {
  let app: INestApplicationContext | undefined;
  try {
    app = await NestFactory.createApplicationContext(databaseCliModule(), {
      logger: ['error', 'warn'],
      abortOnError: false,
    });
    await fn(app);
    await app.close();
    process.exit(0);
  } catch (err) {
    console.error(`\n✖ ${name} failed: ${redactCredentials((err as Error).message ?? String(err))}`);
    await app?.close().catch(() => undefined);
    process.exit(1);
  }
}
