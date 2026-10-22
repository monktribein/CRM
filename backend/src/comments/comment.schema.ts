import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { uniqueIds } from '../database/validators.js';
import { AttachmentMeta, AttachmentMetaSchema } from '../tasks/task.schema.js';

@Schema({ timestamps: true, collection: 'comments' })
export class Comment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true })
  organizationId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Task', required: true })
  taskId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, minlength: 1, maxlength: 5000 })
  body: string;

  /** Users mentioned with @email who can already see the task. */
  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'User', default: [], validate: uniqueIds })
  mentions: Types.ObjectId[];

  @Prop({ type: [AttachmentMetaSchema], default: [] })
  attachments: AttachmentMeta[];

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type CommentDocument = HydratedDocument<Comment>;
export const CommentSchema = SchemaFactory.createForClass(Comment);
CommentSchema.index({ organizationId: 1, taskId: 1, createdAt: 1 });
