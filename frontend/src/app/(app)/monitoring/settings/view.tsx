"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { PolicyCard } from "@/components/monitoring/policy-card";

export default function MonitoringSettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Monitoring Settings"
        description="Organisation-wide policy. Screenshots are captured every 5 minutes only while an enrolled, consenting employee is signed in and sharing their screen."
        actions={
          <Button variant="outline" asChild>
            <Link href="/monitoring">Enrol employees <ArrowRight /></Link>
          </Button>
        }
      />
      <PolicyCard />
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Retention is applied hourly: screenshot files past their retention date are permanently deleted from the database, and the purge is recorded in the access audit log.</li>
        <li>A retention change applies to screenshots captured after the change.</li>
        <li>Changing the policy version ends consent for everyone; enrolled employees are asked again at their next sign-in.</li>
      </ul>
    </div>
  );
}
