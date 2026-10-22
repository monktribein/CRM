import { Types } from 'mongoose';
import { can, type AuthUser } from '../common/auth-user.js';
import type { OrganizationSettings } from '../settings/organization.schema.js';
import type { Task } from './task.schema.js';
import {
  allowedTransitions,
  canReview,
  canSubmitForReview,
  canUpdateProgress,
  CLOSED,
  type WorkflowActor,
} from './task-workflow.js';

type TaskLike = Pick<Task, 'organizationId' | 'assignedTo' | 'sharedWith' | 'createdBy' | 'departmentId' | 'status' | 'reviewRequired'>;

/**
 * Per-request authorisation context for tasks. `departments === null` means
 * the user is authorised organisation-wide.
 */
export class TaskContext {
  constructor(
    readonly user: AuthUser,
    readonly departments: Types.ObjectId[] | null,
    readonly settings: OrganizationSettings,
  ) {}

  private sameOrg(t: TaskLike) {
    return String(t.organizationId) === this.user.organizationId;
  }

  isAssignee(t: TaskLike) {
    return this.sameOrg(t) && t.assignedTo.some((a) => String(a) === this.user.id);
  }

  isShared(t: TaskLike) {
    return this.sameOrg(t) && t.sharedWith.some((a) => String(a) === this.user.id);
  }

  /** Within the user's authorised teams (managers) or the whole org (admins). */
  inTeam(t: TaskLike) {
    if (!this.sameOrg(t)) return false;
    if (this.departments === null) return true;
    if (!can(this.user, 'tasks.view_team')) return false;
    return String(t.createdBy) === this.user.id || this.departments.some((d) => d.equals(t.departmentId));
  }

  canView(t: TaskLike) {
    return this.isAssignee(t) || this.isShared(t) || this.inTeam(t);
  }

  actor(t: TaskLike): WorkflowActor {
    return { isAssignee: this.isAssignee(t), isManager: can(this.user, 'tasks.review') && this.inTeam(t) };
  }

  canEdit(t: TaskLike) {
    return can(this.user, 'tasks.create') && this.inTeam(t) && !CLOSED.includes(t.status);
  }

  capabilities(t: TaskLike) {
    const actor = this.actor(t);
    const allowed = allowedTransitions(t.status, actor, t.reviewRequired);
    const workable = !CLOSED.includes(t.status);
    return {
      canEdit: this.canEdit(t),
      canReassign: can(this.user, 'tasks.assign') && this.inTeam(t) && workable,
      canChangeStatus: allowed.length > 0,
      allowedStatuses: allowed,
      canUpdateProgress: canUpdateProgress(t.status, actor),
      canLogTime: actor.isAssignee && t.status !== 'cancelled',
      canComment: this.canView(t),
      canAttach: this.canView(t) && t.status !== 'cancelled',
      canEditChecklist: (actor.isAssignee || this.canEdit(t)) && workable,
      canSubmitForReview: canSubmitForReview(t.status, actor, t.reviewRequired),
      canReview: canReview(t.status, actor),
    };
  }
}
