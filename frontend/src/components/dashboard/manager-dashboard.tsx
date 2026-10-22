"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Eye, ListChecks, OctagonAlert, TimerReset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/common/stat-card";
import { UserLabel } from "@/components/common/user-avatar";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Panel, TaskMiniList } from "@/components/tasks/task-mini-list";
import { ProgressBar } from "@/components/tasks/task-badges";
import { ChartCard, ChartTooltip, Legend, SERIES, STATUS_COLORS, axisProps, gridProps } from "@/components/charts/chart-kit";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";
import type { ManagerDashboard as Data } from "@/lib/types";
import { cn } from "@/lib/utils";

function pct(completed: number, total: number) {
  return total ? Math.round((completed / total) * 100) : 0;
}

export function ManagerDashboard({ data }: { data: Data }) {
  const workload = useQuery({ queryKey: qk.workload(), queryFn: dashboardApi.workload });
  const performance = useQuery({ queryKey: qk.teamPerformance(), queryFn: dashboardApi.teamPerformance });
  const workloadRows = (workload.data ?? []).map((w) => ({ ...w, name: w.member.name.split(" ")[0] }));
  const { stats, departmentProgress: dept } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Assigned by me" value={stats.assignedByMe} icon={ListChecks} tone="info" hint="Open tasks" href="/tasks" />
        <StatCard label="Overdue" value={stats.overdue} icon={OctagonAlert} tone="danger" href="/tasks?overdue=true" />
        <StatCard label="At risk" value={stats.atRisk} icon={TimerReset} tone="warning" hint="Due soon or blocked" href="/tasks?status=blocked" />
        <StatCard label="Pending reviews" value={stats.pendingReviews} icon={Eye} tone="info" href="/tasks?status=in_review" />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <ChartCard
          className="xl:col-span-3"
          title="Team workload"
          description="Open tasks per team member by status"
          loading={workload.isLoading}
          empty={!workload.isLoading && !workloadRows.length}
          table={{
            rows: workloadRows,
            columns: [
              { key: "name", label: "Member" },
              { key: "todo", label: "To Do", align: "right" },
              { key: "inProgress", label: "In Progress", align: "right" },
              { key: "inReview", label: "In Review", align: "right" },
              { key: "blocked", label: "Blocked", align: "right" },
            ],
          }}
          actions={
            <Legend
              items={[
                { label: "To Do", color: STATUS_COLORS.neutral },
                { label: "In Progress", color: SERIES[0] },
                { label: "In Review", color: SERIES[1] },
                { label: "Blocked", color: STATUS_COLORS.warning },
              ]}
            />
          }
        >
          {workload.error ? (
            <ErrorState error={workload.error} onRetry={() => workload.refetch()} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={workloadRows} margin={{ left: -16, right: 8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f5f9" }} />
                <Bar dataKey="todo" name="To Do" stackId="a" fill={STATUS_COLORS.neutral} stroke="#fff" strokeWidth={2} maxBarSize={28} />
                <Bar dataKey="inProgress" name="In Progress" stackId="a" fill={SERIES[0]} stroke="#fff" strokeWidth={2} maxBarSize={28} />
                <Bar dataKey="inReview" name="In Review" stackId="a" fill={SERIES[1]} stroke="#fff" strokeWidth={2} maxBarSize={28} />
                <Bar dataKey="blocked" name="Blocked" stackId="a" fill={STATUS_COLORS.warning} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <Panel title="Department progress" description={dept ? dept.department : undefined} className="xl:col-span-2">
          {!dept ? (
            <EmptyState title="No department assigned" description="Ask an admin to assign you to a department." className="py-8" />
          ) : (
            <div className="space-y-4 p-4">
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-2xl font-semibold tabular">{pct(dept.completed, dept.total)}%</span>
                  <span className="text-xs text-muted-foreground tabular">
                    {dept.completed} of {dept.total} tasks completed
                  </span>
                </div>
                <ProgressBar value={pct(dept.completed, dept.total)} tone="success" label={`${dept.department} completion`} />
              </div>
              <ul className="space-y-3 border-t pt-4">
                {dept.projects.map((p) => (
                  <li key={p.projectId}>
                    <div className="mb-1 flex justify-between text-[13px]">
                      <span className="truncate font-medium">{p.project}</span>
                      <span className="text-muted-foreground tabular">
                        {p.completed}/{p.total}
                      </span>
                    </div>
                    <ProgressBar value={pct(p.completed, p.total)} label={`${p.project} completion`} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Overdue & at-risk tasks"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/tasks?overdue=true">View all</Link>
            </Button>
          }
        >
          <TaskMiniList tasks={data.riskTasks} showAssignees emptyTitle="Nothing at risk" emptyDescription="No overdue, due-soon or blocked tasks in your teams." />
        </Panel>
        <Panel
          title="Pending reviews"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/tasks?status=in_review">View all</Link>
            </Button>
          }
        >
          <TaskMiniList tasks={data.pendingReviews} showAssignees emptyTitle="No reviews waiting" emptyDescription="Submitted tasks will appear here." />
        </Panel>
      </div>

      <Panel title="Team member performance" description="Completed tasks, overdue work and on-time rate">
        {performance.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : performance.error ? (
          <ErrorState error={performance.error} onRetry={() => performance.refetch()} />
        ) : !performance.data?.length ? (
          <EmptyState title="No team members yet" className="py-8" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2 font-medium">Member</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Completed</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Overdue</th>
                  <th scope="col" className="w-48 px-4 py-2 font-medium">On-time rate</th>
                </tr>
              </thead>
              <tbody>
                {performance.data.map((row) => (
                  <tr key={row.member.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5"><UserLabel user={row.member} /></td>
                    <td className="px-4 py-2.5 text-right tabular">{row.completed}</td>
                    <td className={cn("px-4 py-2.5 text-right tabular", row.overdue > 0 && "font-medium text-red-700")}>{row.overdue}</td>
                    <td className="px-4 py-2.5">
                      <ProgressBar value={row.onTimeRate} tone={row.onTimeRate >= 80 ? "success" : row.onTimeRate >= 60 ? "warning" : "danger"} label={`${row.member.name} on-time rate`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
