import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const ACTIVITY_ENTITIES = ['task', 'user', 'project', 'department', 'auth', 'settings', 'monitoring'] as const;
export type ActivityEntity = (typeof ACTIVITY_ENTITIES)[number];

/** Append-only audit trail. Updates and deletes are rejected at the model level. */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'activityLogs', versionKey: false })
export class ActivityLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true, immutable: true })
  organizationId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, immutable: true })
  actorId: Types.ObjectId;

  /** e.g. "task.status_changed". */
  @Prop({ type: String, required: true, immutable: true, maxlength: 80 })
  action: string;

  @Prop({ type: String, enum: ACTIVITY_ENTITIES, required: true, immutable: true })
  entityType: ActivityEntity;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, immutable: true })
  entityId: Types.ObjectId | null;

  /** Safe change metadata (e.g. { from, to }) — secret-like keys are stripped. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: undefined, immutable: true })
  changes?: Record<string, unknown>;

  /** Correlates the entry with the HTTP request (X-Request-Id) and logs. */
  @Prop({ type: String, default: null, immutable: true })
  requestId: string | null;

  /** Display snapshots so the log stays readable if records are renamed or removed. */
  @Prop({ type: String, required: true, immutable: true })
  actorName: string;

  @Prop({ type: String, default: null, immutable: true })
  entityLabel: string | null;

  @Prop({ type: String, required: true, immutable: true, maxlength: 500 })
  description: string;

  createdAt: Date;
}

export type ActivityLogDocument = HydratedDocument<ActivityLog>;
export const ActivityLogSchema = SchemaFactory.createForClass(ActivityLog);
ActivityLogSchema.index({ organizationId: 1, createdAt: -1 }, { name: 'org_recent' });
ActivityLogSchema.index({ organizationId: 1, entityType: 1, entityId: 1, createdAt: -1 }, { name: 'entity_history' });
ActivityLogSchema.index({ organizationId: 1, actorId: 1, createdAt: -1 }, { name: 'actor_history' });

const reject = () => {
  throw new Error('Activity logs are append-only');
};
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndReplace',
] as const) {
  ActivityLogSchema.pre(op, reject);
}
