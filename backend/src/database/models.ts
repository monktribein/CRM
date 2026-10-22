import type { ModelDefinition } from '@nestjs/mongoose';
import { ActivityLog, ActivityLogSchema } from '../activity-logs/activity-log.schema.js';
import {
  InvitationToken,
  InvitationTokenSchema,
  PasswordResetToken,
  PasswordResetTokenSchema,
  RefreshToken,
  RefreshTokenSchema,
} from '../auth/tokens/token.schemas.js';
import { Comment, CommentSchema } from '../comments/comment.schema.js';
import { Counter, CounterSchema } from '../common/counter.schema.js';
import { Department, DepartmentSchema } from '../departments/department.schema.js';
import { Notification, NotificationSchema } from '../notifications/notification.schema.js';
import { Project, ProjectSchema } from '../projects/project.schema.js';
import { Organization, OrganizationSchema } from '../settings/organization.schema.js';
import { Task, TaskSchema } from '../tasks/task.schema.js';
import { User, UserSchema } from '../users/user.schema.js';

/** Core business collections, shared across feature modules (CoreModule). */
export const CORE_MODELS: ModelDefinition[] = [
  { name: Organization.name, schema: OrganizationSchema },
  { name: User.name, schema: UserSchema },
  { name: Department.name, schema: DepartmentSchema },
  { name: Project.name, schema: ProjectSchema },
  { name: Task.name, schema: TaskSchema },
  { name: Counter.name, schema: CounterSchema },
];

export const TOKEN_MODELS: ModelDefinition[] = [
  { name: RefreshToken.name, schema: RefreshTokenSchema },
  { name: PasswordResetToken.name, schema: PasswordResetTokenSchema },
  { name: InvitationToken.name, schema: InvitationTokenSchema },
];

/** Every collection — used by the database CLI (indexes, seeding). */
export const ALL_MODELS: ModelDefinition[] = [
  ...CORE_MODELS,
  ...TOKEN_MODELS,
  { name: Comment.name, schema: CommentSchema },
  { name: Notification.name, schema: NotificationSchema },
  { name: ActivityLog.name, schema: ActivityLogSchema },
];
