import Link from "next/link";
import { EmptyState } from "@/components/common/states";
import { DueDate, PriorityBadge, StatusBadge } from "@/components/tasks/task-badges";
import { UserStack } from "@/components/common/user-avatar";
import type { Task } from "@/lib/types";
import { attentionTone, toneDot } from "@/lib/task-meta";
import { cn } from "@/lib/utils";

export function TaskMiniList({
  tasks,
  emptyTitle,
  emptyDescription,
  showAssignees = false,
}: {
  tasks: Task[];
  emptyTitle: string;
  emptyDescription?: string;
  showAssignees?: boolean;
}) {
  if (!tasks.length) return <EmptyState title={emptyTitle} description={emptyDescription} className="py-8" />;
  return (
    <ul className="divide-y">
      {tasks.map((t) => (
        <li key={t.id}>
          <Link
            href={`/tasks/${t.id}`}
            className="flex flex-col gap-2 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/60 sm:flex-row sm:items-center sm:gap-3"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className={cn("size-2 shrink-0 rounded-full", toneDot[attentionTone(t)])} aria-hidden="true" />
              <span className="font-mono text-xs text-muted-foreground">{t.key}</span>
              <span className="truncate text-sm font-medium">{t.title}</span>
            </span>
            <span className="flex flex-wrap items-center gap-2 pl-4.5 sm:pl-0">
              {showAssignees && <UserStack users={t.assignedTo} max={2} />}
              <PriorityBadge priority={t.priority} />
              <StatusBadge status={t.status} />
              <DueDate task={t} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg border bg-card shadow-xs", className)} aria-label={title}>
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
