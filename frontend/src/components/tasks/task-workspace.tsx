"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarDays, Columns3, ListFilter, OctagonAlert, Plus, Rows3, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { EmptyState, ErrorState } from "@/components/common/states";
import { MultiSelectFilter } from "@/components/common/multi-select-filter";
import { useAuth } from "@/components/providers/auth-provider";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskCalendar } from "@/components/tasks/task-calendar";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import { TaskTable } from "@/components/tasks/task-table";
import { useTaskQueryState, type TaskView } from "@/components/tasks/use-task-query";
import { useDebounce } from "@/hooks/use-debounce";
import { useAssignableUsers, useDepartments, useProjects } from "@/hooks/use-lookups";
import { tasksApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";
import { PRIORITY_ORDER, STATUS_ORDER, priorityMeta, statusMeta } from "@/lib/task-meta";
import type { TaskQuery, TaskScope, TaskSortField } from "@/lib/types";
import { cn } from "@/lib/utils";

const ALL = "__all__";

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const debounced = useDebounce(text, 300);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search ID, title or assignee"
        className="h-8 pl-8"
        aria-label="Search tasks"
      />
    </div>
  );
}

function LookupSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: { id: string; name: string }[];
  onChange: (v: string | null) => void;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger size="sm" className={cn("w-auto min-w-32", value && "border-primary/40 bg-accent/40")} aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All {label.toLowerCase()}s</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TaskWorkspace({ scope, title, description }: { scope: TaskScope; title: string; description: string }) {
  const { can } = useAuth();
  const { query, view, update, activeFilterCount, clearFilters } = useTaskQueryState(scope);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const departments = useDepartments();
  const projects = useProjects();
  const people = useAssignableUsers(scope === "all");

  // Board needs every matching task in one page; table paginates server-side.
  const listQuery: TaskQuery = view === "board" ? { ...query, page: 1, pageSize: 200 } : query;
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: qk.taskList(listQuery),
    queryFn: () => tasksApi.list(listQuery),
    placeholderData: keepPreviousData,
    enabled: view !== "calendar",
  });
  const tasks = data?.items ?? [];

  const onSort = (field: TaskSortField) =>
    update({ sort: field, order: query.sort === field && query.order === "asc" ? "desc" : "asc" }, false);

  const hasFilters = activeFilterCount > 0 || !!query.search;

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description={description}
        actions={
          can("tasks.create") && (
            <Button asChild>
              <Link href="/tasks/new">
                <Plus /> New task
              </Link>
            </Button>
          )
        }
      />

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <div className="flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={query.search ?? ""} onChange={(v) => update({ search: v || null })} />
            <MultiSelectFilter
              label="Status"
              options={STATUS_ORDER.map((s) => ({ value: s, label: statusMeta[s].label, icon: statusMeta[s].icon }))}
              selected={query.status ?? []}
              onChange={(v) => update({ status: v })}
            />
            <MultiSelectFilter
              label="Priority"
              options={PRIORITY_ORDER.map((p) => ({ value: p, label: priorityMeta[p].label, icon: priorityMeta[p].icon }))}
              selected={query.priority ?? []}
              onChange={(v) => update({ priority: v })}
            />
            {can("departments.view") && (
              <LookupSelect label="Department" value={query.departmentId} options={departments.data ?? []} onChange={(v) => update({ departmentId: v })} />
            )}
            <LookupSelect label="Project" value={query.projectId} options={projects.data ?? []} onChange={(v) => update({ projectId: v })} />
            {scope === "all" && (
              <LookupSelect label="Assignee" value={query.assigneeId} options={people.data ?? []} onChange={(v) => update({ assigneeId: v })} />
            )}
            <Button
              variant="outline"
              size="sm"
              aria-pressed={!!query.overdue}
              onClick={() => update({ overdue: !query.overdue })}
              className={cn(query.overdue && "border-red-300 bg-red-50 text-red-700 hover:bg-red-100")}
            >
              <OctagonAlert /> Overdue
            </Button>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X /> Clear
              </Button>
            )}
          </div>
          <Tabs value={view} onValueChange={(v) => update({ view: v === "table" ? null : (v as TaskView) }, false)}>
            <TabsList aria-label="View">
              <TabsTrigger value="table"><Rows3 /> Table</TabsTrigger>
              <TabsTrigger value="board"><Columns3 /> Board</TabsTrigger>
              <TabsTrigger value="calendar"><CalendarDays /> Calendar</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {view === "calendar" ? (
          <TaskCalendar
            baseQuery={{ scope, search: query.search, status: query.status, priority: query.priority, departmentId: query.departmentId, projectId: query.projectId, assigneeId: query.assigneeId, overdue: query.overdue }}
            onOpen={(t) => setOpenTaskId(t.id)}
          />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !isLoading && tasks.length === 0 ? (
          <EmptyState
            icon={ListFilter}
            title={hasFilters ? "No tasks match these filters" : scope === "mine" ? "You have no tasks yet" : "No tasks yet"}
            description={hasFilters ? "Try removing a filter or changing your search." : "Tasks assigned to you or shared with you will appear here."}
            action={hasFilters ? <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button> : undefined}
          />
        ) : view === "board" ? (
          <>
            <TaskBoard tasks={tasks} loading={isLoading} listQuery={listQuery} onOpen={(t) => setOpenTaskId(t.id)} />
            {data && data.total > data.items.length && (
              <p className="border-t px-4 py-2 text-xs text-amber-700">
                Showing the first {data.items.length} of {data.total} tasks. Use filters to narrow the board.
              </p>
            )}
          </>
        ) : (
          <div className={cn("transition-opacity", isFetching && !isLoading && "opacity-60")}>
            <TaskTable
              tasks={tasks}
              loading={isLoading}
              sort={{ sort: query.sort ?? "dueDate", order: query.order ?? "asc" }}
              onSort={onSort}
              onOpen={(t) => setOpenTaskId(t.id)}
              showAssignees={scope === "all" || tasks.some((t) => t.assignedTo.length > 1)}
            />
            {data && (
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPageChange={(p) => update({ page: p }, false)}
                onPageSizeChange={(s) => update({ pageSize: s })}
              />
            )}
          </div>
        )}
      </div>

      <TaskDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
    </div>
  );
}
