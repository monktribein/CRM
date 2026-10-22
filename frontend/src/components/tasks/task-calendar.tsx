"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState, ErrorState } from "@/components/common/states";
import { StatusBadge } from "@/components/tasks/task-badges";
import { tasksApi } from "@/lib/api/services";
import { dayOf } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { attentionTone, toneClasses, toneDot } from "@/lib/task-meta";
import type { Task, TaskQuery } from "@/lib/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PER_CELL = 3;

function TaskChip({ task, onOpen }: { task: Task; onOpen: (t: Task) => void }) {
  const tone = attentionTone(task);
  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className={cn(
        "flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium ring-1 ring-inset outline-none focus-visible:ring-2 focus-visible:ring-primary",
        toneClasses[tone]
      )}
      title={`${task.key} · ${task.title}`}
    >
      <span className="font-mono opacity-70">{task.key}</span>
      <span className="truncate">{task.title}</span>
    </button>
  );
}

export function TaskCalendar({
  baseQuery,
  onOpen,
}: {
  baseQuery: Omit<TaskQuery, "page" | "pageSize" | "dueFrom" | "dueTo">;
  onOpen: (task: Task) => void;
}) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const query: TaskQuery = {
    ...baseQuery,
    dueFrom: format(gridStart, "yyyy-MM-dd"),
    dueTo: format(gridEnd, "yyyy-MM-dd"),
    sort: "dueDate",
    order: "asc",
    page: 1,
    pageSize: 200,
  };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: qk.taskList(query),
    queryFn: () => tasksApi.list(query),
    placeholderData: keepPreviousData,
  });
  const tasks = data?.items ?? [];
  const byDay = (day: Date) => tasks.filter((t) => isSameDay(dayOf(t.dueDate), day));
  const monthTasks = tasks.filter((t) => isSameMonth(dayOf(t.dueDate), month));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="min-w-36 text-sm font-semibold" aria-live="polite">
            {format(month, "MMMM yyyy")}
          </h2>
          {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
            Today
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => setMonth((m) => subMonths(m, 1))} aria-label="Previous month">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month">
            <ChevronRight />
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          {/* Month grid — tablet and up */}
          <div className="hidden md:block">
            <div className="grid grid-cols-7 border-b bg-muted/40 text-xs font-medium text-muted-foreground">
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const items = byDay(day);
                const outside = !isSameMonth(day, month);
                return (
                  <div
                    key={day.toISOString()}
                    className={cn("min-h-28 border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0", outside && "bg-muted/30")}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-full text-xs tabular",
                          isToday(day) ? "bg-primary font-semibold text-white" : outside ? "text-muted-foreground/60" : "text-foreground"
                        )}
                      >
                        {format(day, "d")}
                      </span>
                      {items.length > 0 && <span className="sr-only">{items.length} tasks due</span>}
                    </div>
                    <div className="space-y-1">
                      {isLoading ? null : items.slice(0, MAX_PER_CELL).map((t) => <TaskChip key={t.id} task={t} onOpen={onOpen} />)}
                      {items.length > MAX_PER_CELL && (
                        <Popover>
                          <PopoverTrigger className="w-full rounded px-1.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted">
                            +{items.length - MAX_PER_CELL} more
                          </PopoverTrigger>
                          <PopoverContent className="w-64 space-y-1 p-2">
                            <p className="px-1 pb-1 text-xs font-semibold">{format(day, "EEEE, MMM d")}</p>
                            {items.map((t) => (
                              <TaskChip key={t.id} task={t} onOpen={onOpen} />
                            ))}
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Agenda — mobile */}
          <div className="md:hidden">
            {!isLoading && monthTasks.length === 0 ? (
              <EmptyState title="Nothing due this month" />
            ) : (
              <ul className="divide-y">
                {monthTasks.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => onOpen(t)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
                      <span className="w-10 shrink-0 text-center">
                        <span className="block text-[11px] text-muted-foreground uppercase">{format(dayOf(t.dueDate), "EEE")}</span>
                        <span className="block text-lg leading-tight font-semibold tabular">{format(dayOf(t.dueDate), "d")}</span>
                      </span>
                      <span className={cn("size-2 shrink-0 rounded-full", toneDot[attentionTone(t)])} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{t.title}</span>
                        <span className="font-mono text-xs text-muted-foreground">{t.key}</span>
                      </span>
                      <StatusBadge status={t.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-2.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", toneDot.danger)} /> Overdue or critical</span>
            <span className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", toneDot.warning)} /> Due soon or blocked</span>
            <span className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", toneDot.success)} /> Completed</span>
            <span className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", toneDot.neutral)} /> Upcoming</span>
            {data && data.total > data.items.length && (
              <span className="ml-auto text-amber-700">Showing first {data.items.length} of {data.total} — narrow your filters.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
