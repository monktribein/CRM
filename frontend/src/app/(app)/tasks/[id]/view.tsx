"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/states";
import { TaskDetailView } from "@/components/tasks/task-detail";
import { useRouteTask } from "@/components/tasks/use-task";
import { ApiError } from "@/lib/api/client";

export default function TaskPage() {
  const { data, isLoading, error, refetch } = useRouteTask();

  if (isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="rounded-lg border bg-card">
        <ErrorState
          error={error}
          title={notFound ? "Task not found" : "Couldn't load this task"}
          onRetry={notFound ? undefined : () => refetch()}
        />
        <div className="flex justify-center pb-8">
          <Button variant="outline" size="sm" asChild>
            <Link href="/my-tasks">
              <ArrowLeft /> Back to my tasks
            </Link>
          </Button>
        </div>
      </div>
    );
  }
  return data ? <TaskDetailView task={data} /> : null;
}
