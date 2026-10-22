"use client";

import { PageHeader } from "@/components/common/page-header";
import { TaskForm } from "@/components/tasks/task-form";

export default function NewTaskPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Create task" description="New tasks start as To Do and notify every assignee." />
      <TaskForm />
    </div>
  );
}
