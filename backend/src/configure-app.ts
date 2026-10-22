import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { timingSafeEqual } from 'node:crypto';
import { requestContextMiddleware } from './common/request-context.js';
import { createValidationPipe } from './common/validation.js';
import { allowedOrigins, type EnvironmentVariables } from './config/env.js';

export const API_PREFIX = 'api/v1';

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** HTTP hardening and global wiring shared by main.ts and the e2e tests. */
export function configureApp(app: NestExpressApplication) {
  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  const env = config.get('NODE_ENV', { infer: true });
  const origins = allowedOrigins({ FRONTEND_URL: config.get('FRONTEND_URL', { infer: true }) });

  // Render terminates TLS at a proxy; trust it so client IPs (rate limiting) are correct.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '100kb' });
  // After body parsing so the async context survives into handlers.
  app.use(requestContextMiddleware);

  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Request-Id'],
    exposedHeaders: ['Content-Disposition', 'X-Request-Id'],
    maxAge: 600,
  });

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();

  const swaggerEnabled = env !== 'production' || config.get('SWAGGER_ENABLED', { infer: true }) === 'true';
  if (swaggerEnabled) {
    if (env === 'production') {
      const user = config.get('SWAGGER_USER', { infer: true })!;
      const pass = config.get('SWAGGER_PASSWORD', { infer: true })!;
      app.use(`/${API_PREFIX}/docs`, (req: Request, res: Response, next: NextFunction) => {
        const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
        const [u = '', p = ''] = Buffer.from(encoded ?? '', 'base64').toString().split(':');
        if (scheme === 'Basic' && safeEqual(u, user) && safeEqual(p, pass)) return next();
        res.setHeader('WWW-Authenticate', 'Basic realm="API docs"').status(401).end();
      });
    }
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(`${config.get('APP_NAME', { infer: true })} API`)
        .setDescription('REST API for the Bizwoke Nova task management CRM. All responses use { data, meta? } envelopes.')
        .setVersion('1.0')
        .addBearerAuth()
        .addCookieAuth('bn_refresh')
        .build(),
    );
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);
  }
}
