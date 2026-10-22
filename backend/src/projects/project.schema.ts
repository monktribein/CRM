import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { assertDateRange, uniqueIds } from '../database/validators.js';

export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

@Schema({ timestamps: true, collection: 'projects' })
export class Project {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({ type: String, trim: true, maxlength: 500, default: null })
  description: string | null;

  /** Short code such as "NOVA"; unique per organisation. */
  @Prop({ type: String, required: true, uppercase: true, trim: true, match: /^[A-Z][A-Z0-9]{1,9}$/ })
  projectCode: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Department', required: true })
  departmentId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  managerId: Types.ObjectId | null;

  /** Project team members from outside the owning department. */
  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'User', default: [], validate: uniqueIds })
  memberIds: Types.ObjectId[];

  @Prop({ type: Date, required: true })
  startDate: Date;

  @Prop({ type: Date, required: true })
  dueDate: Date;

  @Prop({ type: String, enum: PROJECT_STATUSES, default: 'planning' })
  status: ProjectStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type ProjectDocument = HydratedDocument<Project>;
export const ProjectSchema = SchemaFactory.createForClass(Project);
ProjectSchema.index({ organizationId: 1, projectCode: 1 }, { unique: true, name: 'uniq_org_project_code' });
ProjectSchema.index({ organizationId: 1, departmentId: 1, status: 1 });
ProjectSchema.index({ organizationId: 1, memberIds: 1 });
ProjectSchema.pre('validate', function () {
  assertDateRange(this.startDate, this.dueDate, 'Project');
});
