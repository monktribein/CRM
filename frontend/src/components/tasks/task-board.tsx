"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CheckSquare, MessageSquare, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { UserStack } from "@/components/common/user-avatar";
import { DueDate, PriorityBadge } from "@/components/tasks/task-badges";
import { tasksApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";
import { STATUS_ORDER, attentionTone, statusMeta, toneDot } from "@/lib/task-meta";
import type { Paginated, Task, TaskQuery, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const BOARD_COLUMNS: TaskStatus[] = ["todo", "in_progress", "blocked", "in_review", "completed"];

function useMoveTask(listQuery: TaskQuery) {
  const qc = useQueryClient();
  const key = qk.taskList(listQuery);
  return useMutation({
    mutationFn: ({ task, to }: { task: Task; to: TaskStatus }) =>
      to === "in_review" ? tasksApi.submitForReview(task.id) : tasksApi.updateStatus(task.id, to),
    onMutate: async ({ task, to }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Paginated<Task>>(key);
      qc.setQueryData<Paginated<Task>>(key, (old) =>
        old ? { ...old, items: old.items.map((t) => (t.id === task.id ? { ...t, status: to } : t)) } : old
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (updated) => {
      qc.setQueryData(qk.task(updated.id), updated);
      toast.success(`${updated.key} moved to ${statusMeta[updated.status].label}`);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [...qk.tasks, "list"] });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

function BoardCard({
  task,
  onOpen,
  onMove,
  onDragStart,
}: {
  task: Task;
  onOpen: () => void;
  onMove: (to: TaskStatus) => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const tone = attentionTone(task);
  return (
    <motion.li layout="position" transition={{ duration: 0.15 }}>
      <div
        draggable
        onDragStart={onDragStart}
        className={cn(
          "group relative rounded-md border bg-card p-3 shadow-xs transition-shadow hover:shadow-sm",
          tone === "danger" && "border-l-2 border-l-red-500",
          tone === "warning" && "border-l-2 border-l-amber-500"
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
          >
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", toneDot[tone])} aria-hidden="true" />
              {task.key}
            </span>
            <span className="mt-1 line-clamp-2 block text-[13px] font-medium leading-snug">{task.title}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="relative z-10 -mt-1 -mr-1 rounded p-1 text-muted-foreground opacity-60 outline-none hover:bg-muted hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label={`Move ${task.key}`}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>
              {STATUS_ORDER.filter((s) => s !== task.status).map((s) => {
                const Icon = statusMeta[s].icon;
                return (
                  <DropdownMenuItem key={s} onSelect={() => onMove(s)}>
                    <Icon /> {s === "in_review" ? "Submit for review" : statusMeta[s].label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{task.projectName}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <PriorityBadge priority={task.priority} />
          {task.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
          <DueDate task={task} />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {task.checklistTotal > 0 && (
              <span className="inline-flex items-center gap-0.5 tabular" aria-label={`Checklist ${task.checklistDone} of ${task.checklistTotal}`}>
                <CheckSquare className="size-3" aria-hidden="true" />
                {task.checklistDone}/{task.checklistTotal}
              </span>
            )}
            {task.commentCount > 0 && (
              <span className="inline-flex items-center gap-0.5" aria-label={`${task.commentCount} comments`}>
                <MessageSquare className="size-3" aria-hidden="true" />
                {task.commentCount}
              </span>
            )}
            <UserStack users={task.assignedTo} max={2} />
          </div>
        </div>
      </div>
    </motion.li>
  );
}

export function TaskBoard({
  tasks,
  loading,
  listQuery,
  onOpen,
}: {
  tasks: Task[];
  loading: boolean;
  listQuery: TaskQuery;
  onOpen: (task: Task) => void;
}) {
  const move = useMoveTask(listQuery);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const [dragging, setDragging] = useState<Task | null>(null);

  const doMove = (task: Task, to: TaskStatus) => {
    if (task.status !== to) move.mutate({ task, to });
  };

  return (
    <div className="scrollbar-thin flex gap-3 overflow-x-auto p-3 pb-4">
      {BOARD_COLUMNS.map((status) => {
        const meta = statusMeta[status];
        const Icon = meta.icon;
        const items = tasks.filter((t) => t.status === status);
        return (
          <section
            key={status}
            aria-label={`${meta.label} column, ${items.length} tasks`}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setDragOver(status);
            }}
            onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              if (dragging) doMove(dragging, status);
              setDragging(null);
            }}
            className={cn(
              "flex min-w-[210px] flex-1 flex-col rounded-lg border bg-muted/40 transition-colors",
              dragOver === status && "border-primary/50 bg-accent/60"
            )}
          >
            <header className="flex items-center gap-2 px-3 py-2.5">
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-[13px] font-semibold">{meta.label}</h3>
              <span className="ml-auto rounded-full bg-background px-2 text-xs text-muted-foreground tabular ring-1 ring-border">
                {loading ? "–" : items.length}
              </span>
            </header>
            <ul className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
              {loading
                ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)
                : items.map((t) => (
                    <BoardCard
                      key={t.id}
                      task={t}
                      onOpen={() => onOpen(t)}
                      onMove={(to) => doMove(t, to)}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", t.id);
                        setDragging(t);
                      }}
                    />
                  ))}
              {!loading && items.length === 0 && (
                <li className="flex flex-1 items-center justify-center rounded-md border border-dashed py-6 text-xs text-muted-foreground">
                  No tasks
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
