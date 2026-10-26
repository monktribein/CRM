"use client";

import { PageHeader } from "@/components/common/page-header";
import { SessionsTable } from "@/components/monitoring/admin/sessions-table";

export default function LoginActivityPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Login Activity"
        description="Sign-ins of monitored employees and their capture sessions. A logout time is shown only when the employee actually signed out; expired and interrupted sessions show the last heartbeat instead."
      />
      <SessionsTable variant="logins" />
    </div>
  );
}
