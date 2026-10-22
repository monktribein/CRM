import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { assertDateRange, integerPercent, nonEmptyUniqueIds, uniqueIds } from '../database/validators.js';

export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'in_review', 'completed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const REVIEW_STATES = ['pending', 'approved', 'changes_requested'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

@Schema({ timestamps: false })
export class ChecklistItem {
  _id: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, maxlength: 200 }) label: string;
  @Prop({ type: Boolean, default: false }) done: boolean;
}

/** Metadata only — files live in external storage referenced by URL. */
@Schema({ timestamps: false })
export class AttachmentMeta {
  _id: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, maxlength: 200 }) fileName: string;
  @Prop({ type: String, required: true, maxlength: 2000, match: /^https:\/\// }) url: string;
  @Prop({ type: Number, default: null, min: 0 }) sizeBytes: number | null;
  @Prop({ type: String, default: null, maxlength: 100 }) contentType: string | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) uploadedBy: Types.ObjectId;
  @Prop({ type: Date, default: () => new Date() }) createdAt: Date;
}
export const AttachmentMetaSchema = SchemaFactory.createForClass(AttachmentMeta);

@Schema({ timestamps: false })
export class TimeEntry {
  _id: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) userId: Types.ObjectId;
  @Prop({ type: Number, required: true, min: 1, max: 1440 }) minutes: number;
  @Prop({ type: String, maxlength: 500, default: null }) note: string | null;
  @Prop({ type: Date, required: true }) date: Date;
  @Prop({ type: Date, default: () => new Date() }) createdAt: Date;
}

@Schema({ _id: false })
export class TaskReview {
  @Prop({ type: String, enum: REVIEW_STATES, required: true }) state: ReviewState;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) submittedBy: Types.ObjectId;
  @Prop({ type: Date, required: true }) submittedAt: Date;
  @Prop({ type: String, maxlength: 2000, default: null }) submissionNote: string | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null }) reviewerId: Types.ObjectId | null;
  @Prop({ type: Date, default: null }) reviewedAt: Date | null;
  @Prop({ type: String, maxlength: 2000, default: null }) reviewNote: string | null;
}

const uniqueSubdocIds = {
  validator: (items: { _id: Types.ObjectId }[]) => new Set(items.map((i) => String(i._id))).size === items.length,
  message: 'Duplicate item IDs in {PATH}.',
};

@Schema({ timestamps: true, collection: 'tasks' })
export class Task {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  /** Human-readable ID, e.g. BN-1024. Unique per organisation. */
  @Prop({ type: String, required: true, trim: true, maxlength: 30 })
  taskCode: string;

  @Prop({ type: String, required: true, trim: true, minlength: 3, maxlength: 200 })
  title: string;

  @Prop({ type: String, maxlength: 10_000, default: '' })
  description: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', required: true })
  projectId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Department', required: true })
  departmentId: Types.ObjectId;

  /** The user who created the task (the reviewer by default). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  /** Assignees. Multiple are allowed; duplicates are not. */
  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'User', default: [], validate: nonEmptyUniqueIds })
  assignedTo: Types.ObjectId[];

  /** The user who made the most recent assignment. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  assignedBy: Types.ObjectId;

  /** Read-only collaborators who can view and comment. */
  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'User', default: [], validate: uniqueIds })
  sharedWith: Types.ObjectId[];

  @Prop({ type: String, enum: TASK_PRIORITIES, default: 'medium' })
  priority: TaskPriority;

  @Prop({ type: String, enum: TASK_STATUSES, default: 'todo' })
  status: TaskStatus;

  /** UTC timestamps. Date-only input is stored as the start / end of that UTC day. */
  @Prop({ type: Date, required: true })
  startDate: Date;

  @Prop({ type: Date, required: true })
  dueDate: Date;

  @Prop({ type: Number, required: true, min: 0, max: 10_000 })
  estimatedHours: number;

  @Prop({ type: Number, default: 0, min: 0, max: 100_000 })
  actualHours: number;

  @Prop({ type: Number, default: 0, validate: integerPercent })
  progressPercentage: number;

  @Prop({ type: [SchemaFactory.createForClass(ChecklistItem)], default: [], validate: uniqueSubdocIds })
  checklist: ChecklistItem[];

  @Prop({
    type: [String],
    default: [],
    validate: { validator: (t: string[]) => t.length <= 10 && new Set(t).size === t.length, message: 'Up to 10 unique tags.' },
  })
  tags: string[];

  @Prop({ type: [AttachmentMetaSchema], default: [], validate: uniqueSubdocIds })
  attachments: AttachmentMeta[];

  @Prop({ type: [SchemaFactory.createForClass(TimeEntry)], default: [] })
  timeEntries: TimeEntry[];

  /** Snapshot of the organisation setting at creation: completion needs manager approval. */
  @Prop({ type: Boolean, required: true, default: true })
  reviewRequired: boolean;

  @Prop({ type: SchemaFactory.createForClass(TaskReview), default: null })
  review: TaskReview | null;

  @Prop({ type: Number, default: 0, min: 0 })
  commentCount: number;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  /** Archived tasks are hidden from lists and reports but kept for history. */
  @Prop({ type: Date, default: null })
  archivedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type TaskDocument = HydratedDocument<Task>;
export const TaskSchema = SchemaFactory.createForClass(Task);

// Indexes follow the actual query patterns (see docs/DATABASE.md).
TaskSchema.index({ organizationId: 1, taskCode: 1 }, { unique: true, name: 'uniq_org_task_code' });
TaskSchema.index({ organizationId: 1, assignedTo: 1, status: 1, dueDate: 1 }, { name: 'my_tasks' });
TaskSchema.index({ organizationId: 1, departmentId: 1, status: 1, dueDate: 1 }, { name: 'team_tasks' });
TaskSchema.index({ organizationId: 1, status: 1, dueDate: 1 }, { name: 'org_status_due' });
TaskSchema.index({ organizationId: 1, projectId: 1, status: 1 }, { name: 'project_progress' });
TaskSchema.index({ organizationId: 1, createdBy: 1, status: 1 }, { name: 'created_by_me' });
TaskSchema.index({ organizationId: 1, sharedWith: 1 }, { name: 'shared_with' });
TaskSchema.index(
  { organizationId: 1, completedAt: 1 },
  { name: 'completed_at', partialFilterExpression: { completedAt: { $type: 'date' } } },
);

TaskSchema.pre('validate', function () {
  assertDateRange(this.startDate, this.dueDate, 'Task');
  // Invariant: a completed task always has 100% progress.
  if (this.status === 'completed') this.progressPercentage = 100;
});
