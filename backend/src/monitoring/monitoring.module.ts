import { Injectable, Logger, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MONITORING_MODELS } from '../database/models.js';
import { AccessLogService } from './access-log.service.js';
import { ScreenshotStorageService } from './screenshot-storage.service.js';
import { MonitoringAdminController } from './monitoring-admin.controller.js';
import { MonitoringAdminService } from './monitoring-admin.service.js';
import { MonitoringController } from './monitoring.controller.js';
import { MonitoringService } from './monitoring.service.js';

/** Closes interrupted sessions and enforces screenshot retention. Both jobs are idempotent. */
@Injectable()
export class MonitoringScheduler {
  private readonly logger = new Logger(MonitoringScheduler.name);

  constructor(private readonly monitoring: MonitoringService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'monitoring-session-expiry', disabled: process.env.NODE_ENV === 'test' })
  async expireSessions() {
    const n = await this.monitoring.expireStaleSessions();
    if (n) this.logger.log(`Expired ${n} monitoring session(s) with no heartbeat`);
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'monitoring-retention', disabled: process.env.NODE_ENV === 'test' })
  async purge() {
    const n = await this.monitoring.purgeExpiredScreenshots();
    if (n) this.logger.log(`Deleted ${n} screenshot(s) past their retention period`);
  }
}

@Module({
  imports: [MongooseModule.forFeature(MONITORING_MODELS)],
  // Admin controller first so "monitoring/admin/..." isn't shadowed by other routes.
  controllers: [MonitoringAdminController, MonitoringController],
  providers: [MonitoringService, MonitoringAdminService, AccessLogService, ScreenshotStorageService, MonitoringScheduler],
})
export class MonitoringModule {}
