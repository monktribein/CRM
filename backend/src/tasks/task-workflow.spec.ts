import {
  allowedTransitions,
  canReview,
  canSubmitForReview,
  canUpdateProgress,
  deadlineFlags,
  isValidProgress,
  parseTaskDate,
  progressFor,
} from './task-workflow.js';

const assignee = { isAssignee: true, isManager: false };
const manager = { isAssignee: false, isManager: true };
const outsider = { isAssignee: false, isManager: false };

describe('task workflow', () => {
  describe('allowedTransitions', () => {
    it('lets assignees move work between In Progress and Blocked only', () => {
      expect(allowedTransitions('todo', assignee, true)).toEqual(['in_progress', 'blocked']);
      expect(allowedTransitions('in_progress', assignee, true)).toEqual(['blocked']);
      expect(allowedTransitions('blocked', assignee, true)).toEqual(['in_progress']);
    });

    it('never lets assignees complete work when approval is required', () => {
      for (const s of ['todo', 'in_progress', 'blocked'] as const) {
        expect(allowedTransitions(s, assignee, true)).not.toContain('completed');
      }
    });

    it('lets assignees complete directly when approval is not required', () => {
      expect(allowedTransitions('in_progress', assignee, false)).toContain('completed');
    });

    it('gives assignees no transitions out of review or closed states', () => {
      expect(allowedTransitions('in_review', assignee, true)).toEqual([]);
      expect(allowedTransitions('completed', assignee, true)).toEqual([]);
      expect(allowedTransitions('cancelled', assignee, true)).toEqual([]);
    });

    it('lets managers cancel and reopen but not set In Review directly', () => {
      expect(allowedTransitions('todo', manager, true)).toEqual(['in_progress', 'blocked', 'cancelled']);
      expect(allowedTransitions('completed', manager, true)).toEqual(['in_progress']);
      expect(allowedTransitions('cancelled', manager, true)).toEqual(['todo']);
      for (const s of ['todo', 'in_progress', 'blocked', 'completed', 'cancelled'] as const) {
        expect(allowedTransitions(s, manager, true)).not.toContain('in_review');
      }
    });

    it('only allows cancelling a task that is in review via the status endpoint', () => {
      expect(allowedTransitions('in_review', manager, true)).toEqual(['cancelled']);
    });

    it('gives outsiders nothing', () => {
      expect(allowedTransitions('todo', outsider, false)).toEqual([]);
    });

    it('never includes the current status', () => {
      expect(allowedTransitions('blocked', { isAssignee: true, isManager: true }, true)).not.toContain('blocked');
    });
  });

  it('only assignees submit, only when review is required and work is open', () => {
    expect(canSubmitForReview('in_progress', assignee, true)).toBe(true);
    expect(canSubmitForReview('in_progress', assignee, false)).toBe(false);
    expect(canSubmitForReview('in_review', assignee, true)).toBe(false);
    expect(canSubmitForReview('completed', assignee, true)).toBe(false);
    expect(canSubmitForReview('in_progress', manager, true)).toBe(false);
  });

  it('only managers review, and only tasks in review', () => {
    expect(canReview('in_review', manager)).toBe(true);
    expect(canReview('in_progress', manager)).toBe(false);
    expect(canReview('in_review', assignee)).toBe(false);
  });

  it('allows progress updates only by assignees on open work', () => {
    expect(canUpdateProgress('in_progress', assignee)).toBe(true);
    expect(canUpdateProgress('in_review', assignee)).toBe(false);
    expect(canUpdateProgress('completed', assignee)).toBe(false);
    expect(canUpdateProgress('in_progress', manager)).toBe(false);
  });

  it('enforces progress between 0 and 100 as whole numbers', () => {
    expect(isValidProgress(0)).toBe(true);
    expect(isValidProgress(100)).toBe(true);
    expect(isValidProgress(-1)).toBe(false);
    expect(isValidProgress(101)).toBe(false);
    expect(isValidProgress(50.5)).toBe(false);
  });

  it('forces 100% on completion and caps progress when sent back', () => {
    expect(progressFor('completed', 40)).toBe(100);
    expect(progressFor('in_progress', 100)).toBe(90);
    expect(progressFor('in_progress', 30)).toBe(30);
  });

  describe('deadlineFlags', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    it('flags open tasks past their due date as overdue', () => {
      expect(deadlineFlags({ status: 'in_progress', dueDate: new Date('2026-10-21T23:59:59Z') }, now, 2)).toEqual({ isOverdue: true, isDueSoon: false });
    });
    it('never treats an overdue open task as completed, even at 100% progress', () => {
      expect(deadlineFlags({ status: 'in_review', dueDate: new Date('2026-10-01T00:00:00Z') }, now, 2).isOverdue).toBe(true);
    });
    it('does not flag completed or cancelled tasks', () => {
      expect(deadlineFlags({ status: 'completed', dueDate: new Date('2026-10-01') }, now, 2)).toEqual({ isOverdue: false, isDueSoon: false });
      expect(deadlineFlags({ status: 'cancelled', dueDate: new Date('2026-10-01') }, now, 2)).toEqual({ isOverdue: false, isDueSoon: false });
    });
    it('uses the configurable due-soon threshold', () => {
      const task = { status: 'todo' as const, dueDate: new Date('2026-10-25T12:00:00Z') };
      expect(deadlineFlags(task, now, 2).isDueSoon).toBe(false);
      expect(deadlineFlags(task, now, 3).isDueSoon).toBe(true);
    });
  });

  it('parses date-only values as UTC day boundaries', () => {
    expect(parseTaskDate('2026-10-22', 'start').toISOString()).toBe('2026-10-22T00:00:00.000Z');
    expect(parseTaskDate('2026-10-22', 'end').toISOString()).toBe('2026-10-22T23:59:59.999Z');
  });
});
