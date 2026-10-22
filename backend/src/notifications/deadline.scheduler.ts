import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { Organization } from '../settings/organization.schema.js';
import { Task } from '../tasks/task.schema.js';
import { CLOSED } from '../tasks/task-workflow.js';
import { NotificationsService } from './notifications.service.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Hourly sweep that creates "due soon" (once per task) and "overdue" (once per
 * task per day) notifications. De-duplication keys make the job idempotent,
 * so running it on several instances or restarting it is safe.
 */
@Injectable()
export class DeadlineScheduler {
  private readonly logger = new Logger(DeadlineScheduler.name);
  private running = false;

  constructor(
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    @InjectModel(Organization.name) private readonly orgs: Model<Organization>,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'deadline-notifications', disabled: process.env.NODE_ENV === 'test' })
  async run(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      const orgs = await this.orgs.find().select('settings').lean();
      for (const org of orgs) {
        const threshold = org.settings?.dueSoonThresholdDays ?? 2;
        const open = { organizationId: org._id, status: { $nin: CLOSED }, archivedAt: null };
        const dueSoon = await this.tasks
          .find({ ...open, dueDate: { $gte: now, $lte: new Date(now.getTime() + threshold * DAY) } })
          .select('taskCode title assignedTo organizationId')
          .lean();
        for (const t of dueSoon) {
          await this.notifications.notify({
            organizationId: org._id,
            recipients: t.assignedTo,
            type: 'task_due_soon',
            title: 'Task due soon',
            message: `${t.taskCode}: ${t.title} is due soon`,
            entity: { type: 'task', id: t._id },
            dedupeKey: (uid) => `due_soon:${String(t._id)}:${uid}`,
          });
        }
        const overdue = await this.tasks
          .find({ ...open, dueDate: { $lt: now } })
          .select('taskCode title assignedTo createdBy')
          .lean();
        const day = now.toISOString().slice(0, 10);
        for (const t of overdue) {
          await this.notifications.notify({
            organizationId: org._id,
            recipients: [...t.assignedTo, t.createdBy],
            type: 'task_overdue',
            title: 'Task overdue',
            message: `${t.taskCode}: ${t.title} has passed its due date`,
            entity: { type: 'task', id: t._id },
            dedupeKey: (uid) => `overdue:${String(t._id)}:${uid}:${day}`,
          });
        }
        if (dueSoon.length || overdue.length) {
          this.logger.log({ org: String(org._id), dueSoon: dueSoon.length, overdue: overdue.length }, 'Deadline sweep');
        }
      }
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'Deadline sweep failed');
    } finally {
      this.running = false;
    }
  }
}
