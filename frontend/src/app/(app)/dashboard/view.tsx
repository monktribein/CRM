"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/common/page-header";
import { StatCardSkeleton } from "@/components/common/stat-card";
import { ErrorState } from "@/components/common/states";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { EmployeeDashboard } from "@/components/dashboard/employee-dashboard";
import { ManagerDashboard } from "@/components/dashboard/manager-dashboard";
import { useAuth, useCurrentUser } from "@/components/providers/auth-provider";
import { dashboardApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const user = useCurrentUser();
  const { can } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: qk.dashboardSummary(), queryFn: dashboardApi.summary });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting()}, ${user.name.split(" ")[0]}`}
        description={
          data?.role === "admin"
            ? "Organisation-wide overview of work across every department."
            : data?.role === "manager"
              ? "How your teams are tracking, and what needs your attention."
              : "Your work at a glance."
        }
        actions={
          can("tasks.create") && (
            <Button asChild>
              <Link href="/tasks/new">
                <Plus /> New task
              </Link>
            </Button>
          )
        }
      />
      {isLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
          </div>
        </div>
      ) : error ? (
        <div className="rounded-lg border bg-card">
          <ErrorState error={error} title="Couldn't load your dashboard" onRetry={() => refetch()} />
        </div>
      ) : data?.role === "admin" ? (
        <AdminDashboard data={data} />
      ) : data?.role === "manager" ? (
        <ManagerDashboard data={data} />
      ) : data ? (
        <EmployeeDashboard data={data} />
      ) : null}
    </div>
  );
}
