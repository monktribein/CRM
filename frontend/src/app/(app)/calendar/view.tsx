"use client";

import { useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/components/providers/auth-provider";
import { TaskCalendar } from "@/components/tasks/task-calendar";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import type { TaskScope } from "@/lib/types";

export default function CalendarPage() {
  const { canAny } = useAuth();
  const canSeeTeam = canAny(["tasks.view_all", "tasks.view_team"]);
  // Managers and admins usually want their team's deadlines first.
  const [scope, setScope] = useState<TaskScope>(canSeeTeam ? "all" : "mine");
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Task Calendar"
        description="Deadlines by day. Colours flag overdue, due-soon and completed work."
        actions={
          canSeeTeam && (
            <Tabs value={scope} onValueChange={(v) => setScope(v as TaskScope)}>
              <TabsList aria-label="Calendar scope">
                <TabsTrigger value="mine">My tasks</TabsTrigger>
                <TabsTrigger value="all">Team tasks</TabsTrigger>
              </TabsList>
            </Tabs>
          )
        }
      />
      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <TaskCalendar baseQuery={{ scope }} onOpen={(t) => setOpenTaskId(t.id)} />
      </div>
      <TaskDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
    </div>
  );
}
