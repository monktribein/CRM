import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { SLUG_PATTERN } from '../common/slug.js';
import { isValidTimeZone } from '../database/validators.js';

@Schema({ _id: false })
export class OrganizationSettings {
  /** Tasks due within this many days get a "due soon" warning. */
  @Prop({ type: Number, default: 2, min: 0, max: 30 })
  dueSoonThresholdDays: number;

  /** Default for new tasks: completion requires manager approval. */
  @Prop({ type: Boolean, default: true })
  reviewRequired: boolean;
}

/** Screenshot-monitoring policy. Off until an administrator enables it. */
@Schema({ _id: false })
export class MonitoringPolicy {
  @Prop({ type: Boolean, default: false })
  enabled: boolean;

  /** Bumping the version requires every enrolled employee to consent again. */
  @Prop({ type: String, default: '1', trim: true, maxlength: 20 })
  policyVersion: string;

  /** Notice shown to employees before they consent. */
  @Prop({ type: String, default: '', maxlength: 5000 })
  policyText: string;

  /** Screenshots (and their stored files) are deleted this many days after capture. */
  @Prop({ type: Number, default: 20, min: 1, max: 3650 })
  retentionDays: number;

  /** Unsent screenshots are discarded from the browser's encrypted queue after this long. */
  @Prop({ type: Number, default: 72, min: 1, max: 720 })
  localRetentionHours: number;
}

@Schema({ timestamps: true, collection: 'organizations' })
export class Organization {
  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({ type: String, required: true, lowercase: true, trim: true, match: SLUG_PATTERN, maxlength: 80 })
  slug: string;

  @Prop({ type: SchemaFactory.createForClass(OrganizationSettings), default: () => ({}) })
  settings: OrganizationSettings;

  @Prop({ type: SchemaFactory.createForClass(MonitoringPolicy), default: () => ({}) })
  monitoring: MonitoringPolicy;

  /** IANA timezone used for reporting; all timestamps are stored in UTC. */
  @Prop({ type: String, default: 'UTC', validate: { validator: isValidTimeZone, message: 'Invalid timezone.' } })
  timezone: string;

  createdAt: Date;
  updatedAt: Date;
}

export type OrganizationDocument = HydratedDocument<Organization>;
export const OrganizationSchema = SchemaFactory.createForClass(Organization);
OrganizationSchema.index({ slug: 1 }, { unique: true });
