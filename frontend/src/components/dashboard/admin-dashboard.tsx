"use client";

import Link from "next/link";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertOctagon, CheckCircle2, ListChecks, OctagonAlert, Users } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/common/stat-card";
import { UserAvatar } from "@/components/common/user-avatar";
import { EmptyState } from "@/components/common/states";
import { Panel } from "@/components/tasks/task-mini-list";
import { ChartCard, ChartTooltip, Legend, SERIES, STATUS_COLORS, axisProps, gridProps } from "@/components/charts/chart-kit";
import { formatRelative } from "@/lib/format";
import type { AdminDashboard as Data } from "@/lib/types";

export function AdminDashboard({ data }: { data: Data }) {
  const { stats } = data;
  const trend = data.completionTrend.map((p) => ({ ...p, label: format(parseISO(p.date), "MMM d") }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total employees" value={stats.totalEmployees} icon={Users} href="/employees" />
        <StatCard label="Active tasks" value={stats.activeTasks} icon={ListChecks} tone="info" href="/tasks" />
        <StatCard label="Completed tasks" value={stats.completedTasks} icon={CheckCircle2} tone="success" href="/tasks?status=completed" />
        <StatCard label="Overdue tasks" value={stats.overdueTasks} icon={OctagonAlert} tone="danger" hint="Needs attention" href="/tasks?overdue=true" />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <ChartCard
          className="xl:col-span-3"
          title="Department performance"
          description="Completed, active and overdue tasks by department"
          empty={!data.departmentPerformance.length}
          table={{
            rows: data.departmentPerformance,
            columns: [
              { key: "department", label: "Department" },
              { key: "completed", label: "Completed", align: "right" },
              { key: "active", label: "Active", align: "right" },
              { key: "overdue", label: "Overdue", align: "right" },
              { key: "onTimeRate", label: "On time", align: "right", format: (v) => `${v}%` },
            ],
          }}
          actions={
            <Legend
              items={[
                { label: "Completed", color: STATUS_COLORS.good },
                { label: "Active", color: SERIES[0] },
                { label: "Overdue", color: STATUS_COLORS.critical },
              ]}
            />
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.departmentPerformance} barGap={2} margin={{ left: -16, right: 8 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="department" {...axisProps} interval="preserveStartEnd" minTickGap={6} tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 9)}…` : v)} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f5f9" }} />
              <Bar dataKey="completed" name="Completed" fill={STATUS_COLORS.good} radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="active" name="Active" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Bar dataKey="overdue" name="Overdue" fill={STATUS_COLORS.critical} radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          className="xl:col-span-2"
          title="Task completion trend"
          description="Created vs completed, last 14 days"
          table={{
            rows: trend,
            columns: [
              { key: "label", label: "Day" },
              { key: "created", label: "Created", align: "right" },
              { key: "completed", label: "Completed", align: "right" },
            ],
          }}
          actions={<Legend items={[{ label: "Created", color: SERIES[1] }, { label: "Completed", color: SERIES[0] }]} />}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ left: -16, right: 8 }}>
              <defs>
                <linearGradient id="fillCompleted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} minTickGap={24} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#cbd5e1" }} />
              <Area type="monotone" dataKey="created" name="Created" stroke={SERIES[1]} strokeWidth={2} fill="none" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
              <Area type="monotone" dataKey="completed" name="Completed" stroke={SERIES[0]} strokeWidth={2} fill="url(#fillCompleted)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Employees requiring attention"
          description="Most overdue or blocked work"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/reports">View workload</Link>
            </Button>
          }
        >
          {!data.attentionEmployees.length ? (
            <EmptyState icon={CheckCircle2} title="Everyone is on track" description="No employees have overdue or blocked tasks." className="py-8" />
          ) : (
            <ul className="divide-y">
              {data.attentionEmployees.map((row) => (
                <li key={row.employee.id} className="flex items-center gap-3 px-4 py-3">
                  <UserAvatar user={row.employee} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.employee.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{row.employee.departmentName ?? "No department"}</p>
                  </div>
                  <div className="flex shrink-0 gap-2 text-xs">
                    {row.overdueCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 font-medium text-red-700 ring-1 ring-red-200 ring-inset">
                        <AlertOctagon className="size-3.5" aria-hidden="true" /> {row.overdueCount} overdue
                      </span>
                    )}
                    {row.blockedCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-800 ring-1 ring-amber-200 ring-inset">
                        <OctagonAlert className="size-3.5" aria-hidden="true" /> {row.blockedCount} blocked
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Recent activity"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/activity">View all</Link>
            </Button>
          }
        >
          {!data.recentActivity.length ? (
            <EmptyState title="No activity yet" className="py-8" />
          ) : (
            <ul className="divide-y">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                  <UserAvatar user={a.actor} />
                  <p className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{a.actor.name}</span>{" "}
                    <span className="text-muted-foreground">{a.description}</span>
                  </p>
                  <time dateTime={a.createdAt} className="shrink-0 text-xs text-muted-foreground">
                    {formatRelative(a.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
