import type { TaskStatus } from './task.schema.js';

/**
 * Task workflow rules — pure functions with no I/O so every rule is unit
 * tested in isolation (see task-workflow.spec.ts).
 *
 *   • New tasks start as To Do.
 *   • Assignees may move work between In Progress and Blocked, and submit it
 *     for review. They can complete it directly only when the organisation
 *     does not require approval.
 *   • Managers (reviewers in scope) approve or request changes, cancel, and
 *     reopen closed tasks.
 *   • In Review is only reachable through "submit for review", and leaves
 *     only through approve / request changes (or cancellation).
 */

export const WORKABLE: readonly TaskStatus[] = ['todo', 'in_progress', 'blocked'];
export const CLOSED: readonly TaskStatus[] = ['completed', 'cancelled'];

export interface WorkflowActor {
  isAssignee: boolean;
  /** Holds tasks.review and the task is within their authorised teams. */
  isManager: boolean;
}

const MANAGER_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['todo', 'blocked', 'cancelled'],
  blocked: ['todo', 'in_progress', 'cancelled'],
  in_review: ['cancelled'],
  completed: ['in_progress'],
  cancelled: ['todo'],
};

const ORDER: readonly TaskStatus[] = ['todo', 'in_progress', 'blocked', 'in_review', 'completed', 'cancelled'];

/** Statuses this actor may set via PATCH /tasks/:id/status. */
export function allowedTransitions(status: TaskStatus, actor: WorkflowActor, reviewRequired: boolean): TaskStatus[] {
  const allowed = new Set<TaskStatus>();
  if (actor.isAssignee && WORKABLE.includes(status)) {
    allowed.add('in_progress').add('blocked');
    if (!reviewRequired) allowed.add('completed');
  }
  if (actor.isManager) {
    MANAGER_TRANSITIONS[status].forEach((s) => allowed.add(s));
    if (!reviewRequired && (status === 'in_progress' || status === 'blocked')) allowed.add('completed');
  }
  allowed.delete(status);
  // in_review is never set directly; it requires a submission.
  allowed.delete('in_review');
  return ORDER.filter((s) => allowed.has(s));
}

export function canSubmitForReview(status: TaskStatus, actor: WorkflowActor, reviewRequired: boolean) {
  return actor.isAssignee && reviewRequired && WORKABLE.includes(status);
}

export function canReview(status: TaskStatus, actor: WorkflowActor) {
  return actor.isManager && status === 'in_review';
}

export function canUpdateProgress(status: TaskStatus, actor: WorkflowActor) {
  return actor.isAssignee && WORKABLE.includes(status);
}

export function isValidProgress(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

/**
 * Progress after a status change. Completion always means 100%; requesting
 * changes caps progress below 100 so work can't look finished.
 */
export function progressFor(next: TaskStatus, current: number) {
  if (next === 'completed') return 100;
  return Math.min(current, 90);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Overdue and due-soon are computed at read time (never stored), from UTC
 * timestamps. Status — not progress — decides completion, so an overdue task
 * at 100% progress is still overdue until it is actually completed.
 */
export function deadlineFlags(task: { status: TaskStatus; dueDate: Date }, now: Date, dueSoonDays: number) {
  if (CLOSED.includes(task.status)) return { isOverdue: false, isDueSoon: false };
  const due = task.dueDate.getTime();
  const isOverdue = due < now.getTime();
  const isDueSoon = !isOverdue && due - now.getTime() <= dueSoonDays * DAY_MS;
  return { isOverdue, isDueSoon };
}

/** Accepts "YYYY-MM-DD" (start / end of that UTC day) or a full ISO timestamp. */
export function parseTaskDate(value: string, edge: 'start' | 'end'): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`);
  }
  return new Date(value);
}
