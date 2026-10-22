import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { CommentsService } from '../comments/comments.module.js';
import { refOf, RefsService } from '../core/refs.service.js';
import type { Task } from './task.schema.js';
import { TaskContext } from './task-access.js';
import { deadlineFlags } from './task-workflow.js';

export type LeanTask = Task & { _id: Types.ObjectId };

/** Shapes stored tasks into API responses with populated references. */
@Injectable()
export class TaskPresenter {
  constructor(
    private readonly refs: RefsService,
    private readonly comments: CommentsService,
  ) {}

  async many(tasks: LeanTask[], ctx: TaskContext, now = new Date()) {
    const userIds = tasks.flatMap((t) => [...t.assignedTo, ...t.sharedWith, t.createdBy]);
    const [users, depts, projects] = await Promise.all([
      this.refs.userRefs(userIds),
      this.refs.departmentNames(tasks.map((t) => t.departmentId)),
      this.refs.projectNames(tasks.map((t) => t.projectId)),
    ]);
    return tasks.map((t) => ({
      id: String(t._id),
      key: t.taskCode,
      title: t.title,
      description: t.description,
      projectId: String(t.projectId),
      projectName: projects.get(String(t.projectId)) ?? '',
      departmentId: String(t.departmentId),
      departmentName: depts.get(String(t.departmentId)) ?? '',
      assignedTo: t.assignedTo.map((id) => refOf(users, id)),
      createdBy: refOf(users, t.createdBy),
      sharedWith: t.sharedWith.map((id) => refOf(users, id)),
      priority: t.priority,
      status: t.status,
      tags: t.tags,
      startDate: t.startDate,
      dueDate: t.dueDate,
      estimatedHours: t.estimatedHours,
      actualHours: t.actualHours,
      progressPercentage: t.progressPercentage,
      ...deadlineFlags(t, now, ctx.settings.dueSoonThresholdDays),
      checklistTotal: t.checklist.length,
      checklistDone: t.checklist.filter((c) => c.done).length,
      commentCount: t.commentCount,
      attachmentCount: t.attachments.length,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  async detail(task: LeanTask, ctx: TaskContext) {
    const [[base], comments, people] = await Promise.all([
      this.many([task], ctx),
      this.comments.listForTask(task),
      this.refs.userRefs([
        ...task.attachments.map((a) => a.uploadedBy),
        ...task.timeEntries.map((e) => e.userId),
        task.review?.submittedBy,
        task.review?.reviewerId,
      ]),
    ]);
    const r = task.review;
    return {
      ...base!,
      checklist: task.checklist.map((c) => ({ id: String(c._id), label: c.label, done: c.done })),
      comments,
      attachments: task.attachments.map((a) => ({
        id: String(a._id),
        fileName: a.fileName,
        url: a.url,
        sizeBytes: a.sizeBytes,
        contentType: a.contentType,
        uploadedBy: refOf(people, a.uploadedBy),
        createdAt: a.createdAt,
      })),
      timeEntries: [...task.timeEntries]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((e) => ({ id: String(e._id), user: refOf(people, e.userId), minutes: e.minutes, note: e.note, date: e.date, createdAt: e.createdAt })),
      review: r
        ? {
            state: r.state,
            submittedBy: refOf(people, r.submittedBy),
            submittedAt: r.submittedAt,
            submissionNote: r.submissionNote,
            reviewer: r.reviewerId ? refOf(people, r.reviewerId) : null,
            reviewedAt: r.reviewedAt,
            reviewNote: r.reviewNote,
          }
        : null,
      capabilities: ctx.capabilities(task),
    };
  }
}
