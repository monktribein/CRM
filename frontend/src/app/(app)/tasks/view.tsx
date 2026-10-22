"use client";

import { Suspense } from "react";
import { TaskWorkspace } from "@/components/tasks/task-workspace";
import { useAuth } from "@/components/providers/auth-provider";

export default function AllTasksPage() {
  const { can } = useAuth();
  return (
    <Suspense>
      <TaskWorkspace
        scope="all"
        title="All Tasks"
        description={can("tasks.view_all") ? "Every task across the organisation." : "Tasks across the teams you manage."}
      />
    </Suspense>
  );
}
