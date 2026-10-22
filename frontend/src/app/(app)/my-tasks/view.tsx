"use client";

import { Suspense } from "react";
import { TaskWorkspace } from "@/components/tasks/task-workspace";

export default function MyTasksPage() {
  return (
    <Suspense>
      <TaskWorkspace scope="mine" title="My Tasks" description="Tasks assigned to you and tasks explicitly shared with you." />
    </Suspense>
  );
}
