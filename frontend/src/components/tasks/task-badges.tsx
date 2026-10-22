import { CalendarClock } from "lucide-react";
import {
  deadlineMeta,
  getDeadlineState,
  priorityMeta,
  statusMeta,
  toneClasses,
  type Tone,
} from "@/lib/task-meta";
import { formatDay } from "@/lib/format";
import type { Task, TaskPriority, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

function Pill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        toneClasses[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const meta = statusMeta[status];
  const Icon = meta.icon;
  return (
    <Pill tone={meta.tone} className={className}>
      <Icon className="size-3.5" aria-hidden="true" />
      {meta.label}
    </Pill>
  );
}

export function PriorityBadge({ priority, className }: { priority: TaskPriority; className?: string }) {
  const meta = priorityMeta[priority];
  const Icon = meta.icon;
  return (
    <Pill tone={meta.tone} className={className}>
      <Icon className="size-3.5" aria-hidden="true" />
      {meta.label}
      <span className="sr-only"> priority</span>
    </Pill>
  );
}

type DeadlineTask = Pick<Task, "status" | "dueDate" | "isOverdue" | "isDueSoon">;

/** Due date with an attention indicator. Always renders text, not just color. */
export function DueDate({ task, showLabel = true }: { task: DeadlineTask; showLabel?: boolean }) {
  const { state, daysLeft } = getDeadlineState(task);
  const meta = deadlineMeta[state];
  const color =
    state === "overdue"
      ? "text-red-700"
      : state === "due_soon"
        ? "text-amber-700"
        : state === "completed"
          ? "text-emerald-700"
          : "text-foreground";
  const detail =
    state === "overdue"
      ? `${Math.abs(daysLeft)}d overdue`
      : state === "due_soon"
        ? daysLeft === 0
          ? "Due today"
          : `Due in ${daysLeft}d`
        : null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap tabular", color)}>
      {state === "overdue" || state === "due_soon" ? (
        <meta.icon className="size-3.5" aria-hidden="true" />
      ) : (
        <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden="true" />
      )}
      {formatDay(task.dueDate, "MMM d")}
      {showLabel && detail && <span className="text-xs font-medium">· {detail}</span>}
    </span>
  );
}

export function DeadlineBadge({ task }: { task: DeadlineTask }) {
  const { state } = getDeadlineState(task);
  const meta = deadlineMeta[state];
  return (
    <Pill tone={meta.tone}>
      <meta.icon className="size-3.5" aria-hidden="true" />
      {meta.label}
    </Pill>
  );
}

export function ProgressBar({ value, tone = "info", label }: { value: number; tone?: Tone; label?: string }) {
  const bar: Record<Tone, string> = {
    neutral: "bg-slate-400",
    info: "bg-primary",
    warning: "bg-amber-500",
    danger: "bg-red-500",
    success: "bg-emerald-500",
    muted: "bg-slate-300",
  };
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-full min-w-12 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        aria-label={label ?? "Progress"}
      >
        <div className={cn("h-full rounded-full transition-[width]", bar[tone])} style={{ width: `${value}%` }} />
      </div>
      <span className="w-8 text-right text-xs text-muted-foreground tabular">{Math.round(value)}%</span>
    </div>
  );
}
