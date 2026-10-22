"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, MessageSquare, Paperclip } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { UserStack } from "@/components/common/user-avatar";
import { DueDate, PriorityBadge, ProgressBar, StatusBadge } from "@/components/tasks/task-badges";
import { formatHours, formatRelative } from "@/lib/format";
import { attentionTone, toneDot } from "@/lib/task-meta";
import type { Task, TaskSortField } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SortState {
  sort: TaskSortField;
  order: "asc" | "desc";
}

function SortHeader({
  field,
  label,
  state,
  onSort,
  className,
}: {
  field: TaskSortField;
  label: string;
  state: SortState;
  onSort: (field: TaskSortField) => void;
  className?: string;
}) {
  const active = state.sort === field;
  const Icon = !active ? ArrowUpDown : state.order === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (state.order === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-2.5 font-medium", className)}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn("-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground", active && "text-foreground")}
      >
        {label}
        <Icon className={cn("size-3.5", !active && "opacity-40")} aria-hidden="true" />
      </button>
    </th>
  );
}

export function TaskTable({
  tasks,
  loading,
  sort,
  onSort,
  onOpen,
  showAssignees = true,
}: {
  tasks: Task[];
  loading: boolean;
  sort: SortState;
  onSort: (field: TaskSortField) => void;
  onOpen: (task: Task) => void;
  showAssignees?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <caption className="sr-only">Tasks. Select a row to open task details.</caption>
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <SortHeader field="key" label="ID" state={sort} onSort={onSort} className="w-[110px] pl-4" />
            <SortHeader field="title" label="Task" state={sort} onSort={onSort} />
            {showAssignees && <th scope="col" className="px-3 py-2.5 font-medium">Assignees</th>}
            <SortHeader field="priority" label="Priority" state={sort} onSort={onSort} />
            <SortHeader field="status" label="Status" state={sort} onSort={onSort} />
            <SortHeader field="dueDate" label="Due" state={sort} onSort={onSort} />
            <th scope="col" className="w-[140px] px-3 py-2.5 font-medium">Progress</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">Effort</th>
            <SortHeader field="updatedAt" label="Updated" state={sort} onSort={onSort} className="pr-4" />
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b">
                  <td colSpan={9} className="px-4 py-3">
                    <Skeleton className="h-6 w-full" />
                  </td>
                </tr>
              ))
            : tasks.map((t) => {
                const tone = attentionTone(t);
                return (
                  <tr
                    key={t.id}
                    tabIndex={0}
                    onClick={() => onOpen(t)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpen(t);
                      }
                    }}
                    className="group cursor-pointer border-b outline-none last:border-0 hover:bg-muted/40 focus-visible:bg-accent/40"
                    aria-label={`${t.key} ${t.title}`}
                  >
                    <td className="py-2.5 pr-3 pl-4">
                      <span className="flex items-center gap-2">
                        <span className={cn("size-2 shrink-0 rounded-full", toneDot[tone])} aria-hidden="true" />
                        <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{t.key}</span>
                      </span>
                    </td>
                    <td className="max-w-[320px] px-3 py-2.5">
                      <p className="truncate font-medium group-hover:text-primary">{t.title}</p>
                      <p className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                        <span className="truncate">{t.projectName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{t.departmentName}</span>
                        {t.commentCount > 0 && (
                          <span className="inline-flex items-center gap-0.5" aria-label={`${t.commentCount} comments`}>
                            <MessageSquare className="size-3" aria-hidden="true" /> {t.commentCount}
                          </span>
                        )}
                        {t.attachmentCount > 0 && (
                          <span className="inline-flex items-center gap-0.5" aria-label={`${t.attachmentCount} attachments`}>
                            <Paperclip className="size-3" aria-hidden="true" /> {t.attachmentCount}
                          </span>
                        )}
                      </p>
                    </td>
                    {showAssignees && (
                      <td className="px-3 py-2.5">
                        <UserStack users={t.assignedTo} />
                      </td>
                    )}
                    <td className="px-3 py-2.5"><PriorityBadge priority={t.priority} /></td>
                    <td className="px-3 py-2.5"><StatusBadge status={t.status} /></td>
                    <td className="px-3 py-2.5"><DueDate task={t} /></td>
                    <td className="px-3 py-2.5">
                      <ProgressBar value={t.progressPercentage} tone={t.status === "completed" ? "success" : "info"} label={`${t.key} progress`} />
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs whitespace-nowrap text-muted-foreground tabular">
                      <span className={cn(t.actualHours > t.estimatedHours && "font-medium text-amber-700")}>{formatHours(t.actualHours)}</span>
                      {" / "}
                      {formatHours(t.estimatedHours)}
                    </td>
                    <td className="py-2.5 pr-4 pl-3 text-xs whitespace-nowrap text-muted-foreground">{formatRelative(t.updatedAt)}</td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
