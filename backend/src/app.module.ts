import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ActivityLogsModule } from './activity-logs/activity-logs.module.js';
import { AuthModule } from './auth/auth.module.js';
import { TokensModule } from './auth/tokens/tokens.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { JwtAuthGuard, PermissionsGuard } from './common/guards.js';
import { AppThrottlerGuard } from './common/throttler.guard.js';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor.js';
import { validateEnv, type EnvironmentVariables } from './config/env.js';
import { CoreModule } from './core/core.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DepartmentsModule } from './departments/departments.module.js';
import { HealthModule } from './health/health.module.js';
import { MailModule } from './mail/mail.service.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { RolesModule } from './roles/roles.module.js';
import { SearchModule } from './search/search.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => {
        const env = config.get('NODE_ENV', { infer: true });
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }) ?? (env === 'test' ? 'silent' : env === 'production' ? 'info' : 'debug'),
            genReqId: (req, res) => {
              const incoming = req.headers['x-request-id'];
              const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
              res.setHeader('X-Request-Id', id);
              return id;
            },
            // Never log credentials, tokens or cookies.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                '*.password',
                '*.passwordHash',
                '*.token',
                '*.accessToken',
                '*.refreshToken',
              ],
              censor: '[redacted]',
            },
            serializers: {
              req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
            },
            autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
            transport: env === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
          },
        };
      },
    }),
    DatabaseModule,
    // Per user when signed in, per IP otherwise (see AppThrottlerGuard).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 600 }]),
    ScheduleModule.forRoot(),
    CoreModule,
    MailModule,
    TokensModule,
    ActivityLogsModule,
    NotificationsModule,
    UsersModule,
    AuthModule,
    RolesModule,
    DepartmentsModule,
    ProjectsModule,
    TasksModule,
    ReportsModule,
    SettingsModule,
    SearchModule,
    HealthModule,
  ],
  providers: [
    // Order matters: rate limit → authenticate → authorise.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class AppModule {}
