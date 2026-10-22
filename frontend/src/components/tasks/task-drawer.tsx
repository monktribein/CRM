"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/states";
import { TaskDetailView } from "@/components/tasks/task-detail";
import { tasksApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";

export function TaskDrawer({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.task(taskId ?? ""),
    queryFn: () => tasksApi.get(taskId!),
    enabled: !!taskId,
  });

  return (
    <Sheet open={!!taskId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between border-b bg-background/95 px-5 py-3 backdrop-blur">
          <SheetTitle className="text-sm">{data ? data.key : "Task"}</SheetTitle>
          <SheetDescription className="sr-only">Task details</SheetDescription>
          {taskId && (
            <Button variant="ghost" size="sm" className="mr-8" asChild>
              <Link href={`/tasks/${taskId}`}>
                <Maximize2 /> Open full page
              </Link>
            </Button>
          )}
        </SheetHeader>
        <div className="p-5">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-40" />
            </div>
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : data ? (
            <TaskDetailView task={data} variant="drawer" />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
