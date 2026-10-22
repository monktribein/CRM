import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { EnvironmentVariables } from './config/env.js';
import { configureApp } from './configure-app.js';
import { redactCredentials } from './database/connection.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, abortOnError: false });
  app.useLogger(app.get(Logger));
  configureApp(app);
  const port = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService).get('PORT', { infer: true });
  // Bind to all interfaces so Render's router can reach the service.
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`API listening on port ${port}`);
}

try {
  await bootstrap();
} catch (err) {
  // Configuration and database errors: one clear line, never credentials.
  console.error(`\n✖ Bizwoke Nova API failed to start: ${redactCredentials((err as Error).message ?? String(err))}\n`);
  process.exit(1);
}
