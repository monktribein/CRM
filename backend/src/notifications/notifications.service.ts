import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../common/auth-user.js';
import { Paginated, skipFor } from '../common/pagination.js';
import { oid } from '../core/scope.service.js';
import { MailService } from '../mail/mail.service.js';
import { User } from '../users/user.schema.js';
import { Notification, type NotificationEntity, type NotificationType } from './notification.schema.js';

export interface NotifyInput {
  organizationId: string | Types.ObjectId;
  recipients: (string | Types.ObjectId)[];
  /** The acting user. Never notified about their own action; null for system events. */
  actorId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  entity?: { type: NotificationEntity; id: string | Types.ObjectId };
  dedupeKey?: (recipientId: string) => string;
}

/** Notification type → the user preference that controls email delivery. */
const EMAIL_PREF: Partial<Record<NotificationType, keyof User['notificationPreferences']>> = {
  task_assigned: 'emailAssignments',
  task_reassigned: 'emailAssignments',
  task_due_soon: 'emailDueReminders',
  task_overdue: 'emailDueReminders',
  review_requested: 'emailReviews',
  review_approved: 'emailReviews',
  changes_requested: 'emailReviews',
};

/** Frontend route for an entity (computed, not stored). */
function linkFor(entityType: NotificationEntity, entityId: Types.ObjectId | null): string | null {
  if (!entityId) return null;
  if (entityType === 'task') return `/tasks/${String(entityId)}`;
  if (entityType === 'project') return `/projects`;
  if (entityType === 'user') return `/employees`;
  return null;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name) private readonly notifications: Model<Notification>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly mail: MailService,
  ) {}

  async notify(input: NotifyInput) {
    const org = oid(input.organizationId);
    const ids = [...new Set(input.recipients.map(String))].filter((id) => id !== input.actorId);
    if (!ids.length) return;
    // Recipients must be active members of the same organisation.
    const recipients = await this.users
      .find({ _id: { $in: ids.map(oid) }, organizationId: org, status: 'active', deletedAt: null })
      .select('email notificationPreferences')
      .lean();
    const inApp = recipients.filter((r) => !(input.type === 'comment' && r.notificationPreferences?.inAppComments === false));
    if (inApp.length) {
      try {
        await this.notifications.insertMany(
          inApp.map((r) => ({
            organizationId: org,
            recipientId: r._id,
            actorId: input.actorId ? oid(input.actorId) : null,
            type: input.type,
            title: input.title,
            message: input.message,
            entityType: input.entity?.type ?? 'system',
            entityId: input.entity ? oid(input.entity.id) : null,
            dedupeKey: input.dedupeKey?.(String(r._id)),
          })),
          { ordered: false },
        );
      } catch (err) {
        // Duplicate dedupe keys are expected from the scheduler; anything else is real.
        if ((err as { code?: number }).code !== 11000) throw err;
      }
    }
    const pref = EMAIL_PREF[input.type];
    if (pref && this.mail.enabled) {
      await Promise.all(
        recipients
          .filter((r) => r.notificationPreferences?.[pref] !== false)
          .map((r) => this.mail.send(input.type, r.email, input.title, input.message)),
      );
    }
  }

  async list(user: AuthUser, q: { unreadOnly?: boolean; page: number; pageSize: number }) {
    const filter: Record<string, unknown> = { recipientId: oid(user.id), organizationId: oid(user.organizationId) };
    if (q.unreadOnly) filter.readAt = null;
    const [items, total] = await Promise.all([
      this.notifications.find(filter).sort({ createdAt: -1 }).skip(skipFor(q)).limit(q.pageSize).lean(),
      this.notifications.countDocuments(filter),
    ]);
    return new Paginated(
      items.map((n) => ({
        id: String(n._id),
        type: n.type,
        title: n.title,
        body: n.message,
        link: linkFor(n.entityType, n.entityId),
        read: n.readAt !== null,
        createdAt: n.createdAt,
      })),
      total,
      q.page,
      q.pageSize,
    );
  }

  async unreadCount(user: AuthUser) {
    return { count: await this.notifications.countDocuments({ recipientId: oid(user.id), readAt: null }) };
  }

  async markRead(user: AuthUser, id: string) {
    const res = await this.notifications.updateOne({ _id: oid(id), recipientId: oid(user.id) }, { readAt: new Date() });
    if (!res.matchedCount) throw new NotFoundException('Notification not found.');
  }

  async markAllRead(user: AuthUser) {
    await this.notifications.updateMany({ recipientId: oid(user.id), readAt: null }, { readAt: new Date() });
  }
}
