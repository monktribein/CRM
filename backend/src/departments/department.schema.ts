import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { SLUG_PATTERN } from '../common/slug.js';
import { uniqueIds } from '../database/validators.js';

export const DEPARTMENT_STATUSES = ['active', 'archived'] as const;
export type DepartmentStatus = (typeof DEPARTMENT_STATUSES)[number];

@Schema({ timestamps: true, collection: 'departments' })
export class Department {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 80 })
  name: string;

  /** Derived from the name; unique per organisation among active departments. */
  @Prop({ type: String, required: true, lowercase: true, match: SLUG_PATTERN, maxlength: 80 })
  slug: string;

  @Prop({ type: String, trim: true, maxlength: 300, default: null })
  description: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  managerId: Types.ObjectId | null;

  /**
   * Users belonging to the department. Kept in sync with users.departmentId
   * by UsersService (users.departmentId is the source of truth).
   */
  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'User', default: [], validate: uniqueIds })
  memberIds: Types.ObjectId[];

  @Prop({ type: String, enum: DEPARTMENT_STATUSES, default: 'active' })
  status: DepartmentStatus;

  createdAt: Date;
  updatedAt: Date;
}

export type DepartmentDocument = HydratedDocument<Department>;
export const DepartmentSchema = SchemaFactory.createForClass(Department);
// Archived departments release their name so it can be reused.
DepartmentSchema.index(
  { organizationId: 1, slug: 1 },
  { unique: true, partialFilterExpression: { status: 'active' }, name: 'uniq_org_slug_active' },
);
DepartmentSchema.index({ organizationId: 1, managerId: 1 });
DepartmentSchema.pre('validate', function () {
  if (this.isModified('managerId') && this.managerId) {
    // A department manager is always counted as a member.
    if (!this.memberIds.some((m) => m.equals(this.managerId!))) this.memberIds.push(this.managerId);
  }
});
