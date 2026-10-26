"use client";

import { PageHeader } from "@/components/common/page-header";
import { SessionsTable } from "@/components/monitoring/admin/sessions-table";

export default function MonitoringSessionsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Monitoring Sessions"
        description="Every screen-sharing grant: when it started, how it ended and how many screenshots were stored. Select a session to see its screenshots."
      />
      <SessionsTable variant="sessions" />
    </div>
  );
}
