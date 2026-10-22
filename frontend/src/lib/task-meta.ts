import {
  Ban,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  Eye,
  OctagonAlert,
  ArrowDown,
  ArrowUp,
  Equal,
  type LucideIcon,
} from "lucide-react";
import { differenceInCalendarDays } from "date-fns";
import { dayOf } from "@/lib/format";
import type { Task, TaskPriority, TaskStatus } from "@/lib/types";

export type Tone = "neutral" | "info" | "warning" | "danger" | "success" | "muted";

export const toneClasses: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  muted: "bg-slate-50 text-slate-500 ring-slate-200",
};

export const toneDot: Record<Tone, string> = {
  neutral: "bg-slate-400",
  info: "bg-indigo-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  success: "bg-emerald-500",
  muted: "bg-slate-300",
};

export const STATUS_ORDER: TaskStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "completed",
  "cancelled",
];

export const statusMeta: Record<
  TaskStatus,
  { label: string; icon: LucideIcon; tone: Tone; chart: string }
> = {
  todo: { label: "To Do", icon: Circle, tone: "neutral", chart: "#94a3b8" },
  in_progress: { label: "In Progress", icon: CircleDot, tone: "info", chart: "#4f46e5" },
  blocked: { label: "Blocked", icon: OctagonAlert, tone: "warning", chart: "#f59e0b" },
  in_review: { label: "In Review", icon: Eye, tone: "info", chart: "#0ea5e9" },
  completed: { label: "Completed", icon: CheckCircle2, tone: "success", chart: "#10b981" },
  cancelled: { label: "Cancelled", icon: Ban, tone: "muted", chart: "#cbd5e1" },
};

export const PRIORITY_ORDER: TaskPriority[] = ["critical", "high", "medium", "low"];

export const priorityMeta: Record<
  TaskPriority,
  { label: string; icon: LucideIcon; tone: Tone; rank: number }
> = {
  low: { label: "Low", icon: ArrowDown, tone: "neutral", rank: 0 },
  medium: { label: "Medium", icon: Equal, tone: "info", rank: 1 },
  high: { label: "High", icon: ArrowUp, tone: "warning", rank: 2 },
  critical: { label: "Critical", icon: OctagonAlert, tone: "danger", rank: 3 },
};

export const CLOSED_STATUSES: TaskStatus[] = ["completed", "cancelled"];

export function isClosed(status: TaskStatus) {
  return CLOSED_STATUSES.includes(status);
}

export type DeadlineState = "overdue" | "due_soon" | "on_track" | "completed" | "cancelled";

type DeadlineInput = Pick<Task, "status" | "dueDate" | "isOverdue" | "isDueSoon">;

/**
 * Overdue / due-soon flags are computed by the backend (the due-soon
 * threshold is an organisation setting), so the UI never re-derives them.
 */
export function getDeadlineState(
  task: DeadlineInput,
  now: Date = new Date()
): { state: DeadlineState; daysLeft: number } {
  const daysLeft = differenceInCalendarDays(dayOf(task.dueDate), now);
  if (task.status === "completed") return { state: "completed", daysLeft };
  if (task.status === "cancelled") return { state: "cancelled", daysLeft };
  if (task.isOverdue) return { state: "overdue", daysLeft };
  if (task.isDueSoon) return { state: "due_soon", daysLeft };
  return { state: "on_track", daysLeft };
}

export const deadlineMeta: Record<DeadlineState, { label: string; tone: Tone; icon: LucideIcon }> = {
  overdue: { label: "Overdue", tone: "danger", icon: OctagonAlert },
  due_soon: { label: "Due soon", tone: "warning", icon: CircleDashed },
  on_track: { label: "On track", tone: "neutral", icon: Circle },
  completed: { label: "Completed", tone: "success", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", tone: "muted", icon: Ban },
};

/**
 * The attention tone for a task row/card: red for overdue or critical,
 * amber for due soon or blocked, green for completed, otherwise neutral.
 */
export function attentionTone(task: DeadlineInput & Pick<Task, "priority">): Tone {
  const { state } = getDeadlineState(task);
  if (state === "completed") return "success";
  if (state === "cancelled") return "muted";
  if (state === "overdue" || task.priority === "critical") return "danger";
  if (state === "due_soon" || task.status === "blocked") return "warning";
  return "neutral";
}
