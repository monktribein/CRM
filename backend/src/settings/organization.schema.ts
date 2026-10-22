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

@Schema({ timestamps: true, collection: 'organizations' })
export class Organization {
  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({ type: String, required: true, lowercase: true, trim: true, match: SLUG_PATTERN, maxlength: 80 })
  slug: string;

  @Prop({ type: SchemaFactory.createForClass(OrganizationSettings), default: () => ({}) })
  settings: OrganizationSettings;

  /** IANA timezone used for reporting; all timestamps are stored in UTC. */
  @Prop({ type: String, default: 'UTC', validate: { validator: isValidTimeZone, message: 'Invalid timezone.' } })
  timezone: string;

  createdAt: Date;
  updatedAt: Date;
}

export type OrganizationDocument = HydratedDocument<Organization>;
export const OrganizationSchema = SchemaFactory.createForClass(Organization);
OrganizationSchema.index({ slug: 1 }, { unique: true });
