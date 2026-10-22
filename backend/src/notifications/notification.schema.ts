import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const NOTIFICATION_TYPES = [
  'task_assigned',
  'task_reassigned',
  'task_due_soon',
  'task_overdue',
  'review_requested',
  'review_approved',
  'changes_requested',
  'comment',
  'mention',
  'system',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_ENTITIES = ['task', 'project', 'user', 'department', 'system'] as const;
export type NotificationEntity = (typeof NOTIFICATION_ENTITIES)[number];

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'notifications' })
export class Notification {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  recipientId: Types.ObjectId;

  /** Who triggered it; null for system/scheduler notifications. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  actorId: Types.ObjectId | null;

  @Prop({ type: String, enum: NOTIFICATION_TYPES, required: true })
  type: NotificationType;

  @Prop({ type: String, required: true, maxlength: 200 })
  title: string;

  @Prop({ type: String, required: true, maxlength: 500 })
  message: string;

  @Prop({ type: String, enum: NOTIFICATION_ENTITIES, default: 'system' })
  entityType: NotificationEntity;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  entityId: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  readAt: Date | null;

  /** Prevents duplicate scheduler notifications (e.g. one overdue alert per day). */
  @Prop({ type: String, default: undefined })
  dedupeKey?: string;

  createdAt: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);
// Inbox (newest first) and unread count.
NotificationSchema.index({ recipientId: 1, createdAt: -1 }, { name: 'inbox' });
NotificationSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 }, { name: 'inbox_unread' });
NotificationSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } }, name: 'uniq_dedupe_key' },
);
// Retention: notifications expire after 180 days.
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600, name: 'ttl_180d' });
