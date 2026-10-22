"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/states";
import { TaskForm } from "@/components/tasks/task-form";
import { useRouteTask } from "@/components/tasks/use-task";

export default function EditTaskPage() {
  const { data, isLoading, error, refetch } = useRouteTask();
  return (
    <div className="space-y-5">
      <PageHeader title={data ? `Edit ${data.key}` : "Edit task"} description="Assignees are changed from the task page with Reassign." />
      {isLoading ? (
        <Skeleton className="h-96" />
      ) : error ? (
        <div className="rounded-lg border bg-card">
          <ErrorState error={error} onRetry={() => refetch()} />
        </div>
      ) : data && !data.capabilities.canEdit ? (
        <div className="rounded-lg border bg-card">
          <ErrorState error={new Error("You don't have permission to edit this task, or it's closed.")} title="Can't edit this task" />
        </div>
      ) : data ? (
        <TaskForm task={data} />
      ) : null}
    </div>
  );
}
