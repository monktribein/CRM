"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCircle2, Circle, CircleDot, Eye, ListTodo, OctagonAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/common/stat-card";
import { Panel, TaskMiniList } from "@/components/tasks/task-mini-list";
import { ChartCard, ChartTooltip, SERIES, axisProps, gridProps } from "@/components/charts/chart-kit";
import type { EmployeeDashboard as Data } from "@/lib/types";

export function EmployeeDashboard({ data }: { data: Data }) {
  const { stats } = data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="My total tasks" value={stats.total} icon={ListTodo} href="/my-tasks" />
        <StatCard label="To do" value={stats.todo} icon={Circle} href="/my-tasks?status=todo" />
        <StatCard label="In progress" value={stats.inProgress} icon={CircleDot} tone="info" href="/my-tasks?status=in_progress" />
        <StatCard label="Awaiting review" value={stats.inReview} icon={Eye} tone="info" href="/my-tasks?status=in_review" />
        <StatCard label="Completed" value={stats.completed} icon={CheckCircle2} tone="success" href="/my-tasks?status=completed" />
        <StatCard label="Overdue" value={stats.overdue} icon={OctagonAlert} tone="danger" href="/my-tasks?overdue=true" />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel
          className="xl:col-span-3"
          title="Upcoming deadlines"
          description="Your open tasks, soonest first"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/calendar">Open calendar</Link>
            </Button>
          }
        >
          <TaskMiniList tasks={data.upcoming} emptyTitle="No open tasks" emptyDescription="New assignments will appear here." />
        </Panel>

        <ChartCard
          className="xl:col-span-2"
          title="Personal productivity"
          description="Tasks completed per week, last 8 weeks"
          empty={data.productivity.every((p) => p.completed === 0)}
          table={{
            rows: data.productivity,
            columns: [
              { key: "label", label: "Week of" },
              { key: "completed", label: "Completed", align: "right" },
              { key: "hours", label: "Hours", align: "right", format: (v) => `${Math.round(Number(v) * 10) / 10}h` },
            ],
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.productivity} margin={{ left: -16, right: 8 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} minTickGap={12} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f5f9" }} />
              <Bar dataKey="completed" name="Completed" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
