"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { tasksApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";
import { statusMeta } from "@/lib/task-meta";
import type { TaskDetail, TaskStatus } from "@/lib/types";

export function useTaskMutations(taskId: string) {
  const qc = useQueryClient();

  const applied = (task: TaskDetail, message?: string) => {
    qc.setQueryData(qk.task(taskId), task);
    void qc.invalidateQueries({ queryKey: [...qk.tasks, "list"] });
    void qc.invalidateQueries({ queryKey: qk.taskActivity(taskId) });
    void qc.invalidateQueries({ queryKey: qk.dashboard });
    void qc.invalidateQueries({ queryKey: qk.unreadCount() });
    if (message) toast.success(message);
  };

  return {
    status: useMutation({
      mutationFn: (status: TaskStatus) => tasksApi.updateStatus(taskId, status),
      onSuccess: (t) => applied(t, `Status changed to ${statusMeta[t.status].label}`),
    }),
    progress: useMutation({
      mutationFn: (value: number) => tasksApi.updateProgress(taskId, value),
      onSuccess: (t) => applied(t, `Progress updated to ${t.progressPercentage}%`),
    }),
    logTime: useMutation({
      mutationFn: (entry: { minutes: number; date: string; note?: string }) => tasksApi.logTime(taskId, entry),
      onSuccess: (t) => applied(t, "Time logged"),
    }),
    comment: useMutation({
      mutationFn: (body: string) => tasksApi.addComment(taskId, body),
      onSuccess: (t) => applied(t),
    }),
    attach: useMutation({
      mutationFn: (input: { fileName: string; url: string }) => tasksApi.addAttachment(taskId, input),
      onSuccess: (t) => applied(t, "Attachment added"),
    }),
    addChecklistItem: useMutation({
      mutationFn: (label: string) => tasksApi.addChecklistItem(taskId, label),
      onSuccess: (t) => applied(t),
    }),
    toggleChecklistItem: useMutation({
      mutationFn: ({ itemId, done }: { itemId: string; done: boolean }) => tasksApi.toggleChecklistItem(taskId, itemId, done),
      onSuccess: (t) => applied(t),
    }),
    submitForReview: useMutation({
      mutationFn: (note?: string) => tasksApi.submitForReview(taskId, note),
      onSuccess: (t) => applied(t, "Submitted for review"),
    }),
    approve: useMutation({
      mutationFn: (note?: string) => tasksApi.approve(taskId, note),
      onSuccess: (t) => applied(t, "Task approved and completed"),
    }),
    requestChanges: useMutation({
      mutationFn: (note: string) => tasksApi.requestChanges(taskId, note),
      onSuccess: (t) => applied(t, "Changes requested"),
    }),
    assign: useMutation({
      mutationFn: (assigneeIds: string[]) => tasksApi.assign(taskId, assigneeIds),
      onSuccess: (t) => applied(t, "Assignees updated"),
    }),
  };
}
