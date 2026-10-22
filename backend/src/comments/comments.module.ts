import { Injectable, Module } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../common/auth-user.js';
import { refOf, RefsService } from '../core/refs.service.js';
import { oid } from '../core/scope.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { Task } from '../tasks/task.schema.js';
import { User } from '../users/user.schema.js';
import { Comment, CommentSchema } from './comment.schema.js';

type TaskRef = Pick<Task, 'organizationId' | 'taskCode' | 'assignedTo' | 'sharedWith' | 'createdBy' | 'departmentId'> & {
  _id: Types.ObjectId;
};

const MENTION = /@([^\s@]+@[^\s@]+\.[^\s@,;:!?)]+)/g;

/**
 * Comment storage and mention handling. Access to the parent task is checked
 * by TasksService before any method here is called.
 */
@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly refs: RefsService,
    private readonly notifications: NotificationsService,
  ) {}

  async listForTask(task: TaskRef) {
    const list = await this.comments.find({ taskId: task._id, organizationId: task.organizationId, deletedAt: null }).sort({ createdAt: 1 }).limit(500).lean();
    const authors = await this.refs.userRefs(list.map((c) => c.authorId));
    return list.map((c) => ({
      id: String(c._id),
      author: refOf(authors, c.authorId),
      body: c.body,
      mentions: c.mentions.map(String),
      createdAt: c.createdAt,
    }));
  }

  /**
   * Mentions (`@email`) only notify people who can already see the task —
   * mentioning someone never grants access.
   */
  async create(actor: AuthUser, task: TaskRef, body: string) {
    const emails = [...body.matchAll(MENTION)].map((m) => m[1]!.toLowerCase());
    const participants = [...task.assignedTo, ...task.sharedWith, task.createdBy].map(String);
    const mentioned = emails.length
      ? await this.users
          .find({
            organizationId: task.organizationId,
            email: { $in: emails },
            status: 'active',
            $or: [
              { _id: { $in: participants.map(oid) } },
              { departmentId: task.departmentId },
              { securityRole: { $in: ['admin', 'super_admin'] } },
            ],
          })
          .select('_id')
          .lean()
      : [];
    const mentionIds = mentioned.map((m) => m._id);

    await this.comments.create({
      organizationId: task.organizationId,
      taskId: task._id,
      authorId: oid(actor.id),
      body,
      mentions: mentionIds,
    });

    const entity = { type: 'task' as const, id: task._id };
    await this.notifications.notify({
      organizationId: task.organizationId,
      recipients: mentionIds,
      actorId: actor.id,
      type: 'mention',
      title: 'You were mentioned',
      message: `${actor.name} mentioned you on ${task.taskCode}`,
      entity,
    });
    const mentionSet = new Set(mentionIds.map(String));
    await this.notifications.notify({
      organizationId: task.organizationId,
      recipients: participants.filter((p) => !mentionSet.has(p)),
      actorId: actor.id,
      type: 'comment',
      title: 'New comment',
      message: `${actor.name} commented on ${task.taskCode}`,
      entity,
    });
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: Comment.name, schema: CommentSchema }])],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
