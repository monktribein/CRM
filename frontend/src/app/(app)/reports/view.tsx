"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, startOfMonth, subDays } from "date-fns";
import { toast } from "sonner";
import { CalendarRange, CheckCircle2, Download, Loader2, OctagonAlert, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/page-header";
import { StatCard, StatCardSkeleton } from "@/components/common/stat-card";
import { ErrorState, EmptyState } from "@/components/common/states";
import { UserStack } from "@/components/common/user-avatar";
import { useAuth } from "@/components/providers/auth-provider";
import { ChartCard, ChartTooltip, Legend, SERIES, STATUS_COLORS, axisProps, gridProps } from "@/components/charts/chart-kit";
import { DueDate, PriorityBadge, ProgressBar } from "@/components/tasks/task-badges";
import { Panel } from "@/components/tasks/task-mini-list";
import { useDepartments } from "@/hooks/use-lookups";
import { reportsApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";
import { statusMeta } from "@/lib/task-meta";
import type { ReportKind, ReportQuery } from "@/lib/types";

const ALL = "__all__";
type Preset = "7d" | "30d" | "90d" | "month" | "custom";
const today = () => format(new Date(), "yyyy-MM-dd");
function rangeFor(p: Exclude<Preset, "custom">) {
  const now = new Date();
  const from = p === "month" ? startOfMonth(now) : subDays(now, p === "7d" ? 7 : p === "30d" ? 30 : 90);
  return { from: format(from, "yyyy-MM-dd"), to: today() };
}

const STATUS_FILL: Record<string, string> = {
  todo: STATUS_COLORS.neutral,
  in_progress: SERIES[0],
  blocked: STATUS_COLORS.warning,
  in_review: SERIES[1],
  completed: STATUS_COLORS.good,
  cancelled: "#cbd5e1",
};

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReportsPage() {
  const { can } = useAuth();
  const departments = useDepartments();
  const [preset, setPreset] = useState<Preset>("30d");
  const [custom, setCustom] = useState(rangeFor("30d"));
  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const [period, setPeriod] = useState<"weekly" | "monthly">("weekly");

  const range = preset === "custom" ? custom : rangeFor(preset);
  const query: ReportQuery = { ...range, departmentId };
  const invalidRange = range.from > range.to;

  const tasks = useQuery({ queryKey: qk.reports("tasks", query), queryFn: () => reportsApi.tasks(query), enabled: !invalidRange });
  const employees = useQuery({ queryKey: qk.reports("employees", query), queryFn: () => reportsApi.employees(query), enabled: !invalidRange });
  const depts = useQuery({ queryKey: qk.reports("departments", query), queryFn: () => reportsApi.departments(query), enabled: !invalidRange });

  const exporter = useMutation({
    mutationFn: (kind: ReportKind) => reportsApi.exportCsv(kind, query),
    onSuccess: ({ blob, fileName }, kind) => {
      downloadBlob(blob, fileName ?? `bizwoke-${kind}-${range.from}-to-${range.to}.csv`);
      toast.success("Export downloaded");
    },
  });

  const t = tasks.data;
  const onTimeTotal = t ? t.onTime.onTime + t.onTime.late : 0;
  const onTimeRate = onTimeTotal ? Math.round((t!.onTime.onTime / onTimeTotal) * 100) : 0;
  const productivity = t?.productivity[period] ?? [];
  const statusRows = (t?.statusDistribution ?? []).map((s) => ({ ...s, label: statusMeta[s.status].label }));
  const deptRows = (depts.data ?? []).map((d) => ({ ...d, open: d.total - d.completed }));
  const workloadRows = (employees.data ?? []).slice(0, 12);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports & Analytics"
        description="Delivery, workload and productivity across the teams you can access."
        actions={
          can("reports.export") && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={exporter.isPending || invalidRange}>
                  {exporter.isPending ? <Loader2 className="animate-spin" /> : <Download />} Export CSV
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs">Export for selected range</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => exporter.mutate("tasks")}>Task report</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exporter.mutate("employees")}>Employee workload</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exporter.mutate("departments")}>Department performance</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3 shadow-xs">
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">Date range</Label>
          <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
            <SelectTrigger size="sm" className="w-40"><CalendarRange className="text-muted-foreground" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="month">This month</SelectItem>
              <SelectItem value="custom">Custom range</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {preset === "custom" && (
          <>
            <div className="grid gap-1">
              <Label htmlFor="from" className="text-xs text-muted-foreground">From</Label>
              <Input id="from" type="date" className="h-8 w-40" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="to" className="text-xs text-muted-foreground">To</Label>
              <Input id="to" type="date" className="h-8 w-40" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </div>
          </>
        )}
        {can("departments.view") && (
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Department</Label>
            <Select value={departmentId ?? ALL} onValueChange={(v) => setDepartmentId(v === ALL ? undefined : v)}>
              <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {(departments.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {invalidRange && <p className="pb-1.5 text-xs font-medium text-red-600" role="alert">“From” must be before “To”.</p>}
      </div>

      {tasks.error ? (
        <div className="rounded-lg border bg-card"><ErrorState error={tasks.error} onRetry={() => tasks.refetch()} /></div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tasks.isLoading || !t ? (
            Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <StatCard label="Tasks in range" value={t.totals.total} icon={CalendarRange} hint={`${t.totals.open} still open`} />
              <StatCard label="Completed" value={t.totals.completed} icon={CheckCircle2} tone="success" />
              <StatCard label="On-time completion" value={`${onTimeRate}%`} icon={Timer} tone={onTimeRate >= 80 ? "success" : onTimeRate >= 60 ? "warning" : "danger"} hint={`${t.onTime.onTime} on time · ${t.onTime.late} late`} />
              <StatCard label="Overdue now" value={t.totals.overdue} icon={OctagonAlert} tone="danger" />
            </>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Department-wise task completion"
          loading={depts.isLoading}
          empty={!deptRows.length}
          table={{ rows: deptRows, columns: [
            { key: "department", label: "Department" },
            { key: "completed", label: "Completed", align: "right" },
            { key: "open", label: "Open", align: "right" },
            { key: "overdue", label: "Overdue", align: "right" },
            { key: "onTimeRate", label: "On time", align: "right", format: (v) => `${v}%` },
          ] }}
          actions={<Legend items={[{ label: "Completed", color: STATUS_COLORS.good }, { label: "Open", color: SERIES[0] }]} />}
        >
          {depts.error ? <ErrorState error={depts.error} onRetry={() => depts.refetch()} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deptRows} margin={{ left: -16, right: 8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="department" {...axisProps} interval="preserveStartEnd" minTickGap={6} tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 9)}…` : v)} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f5f9" }} />
                <Bar dataKey="completed" name="Completed" stackId="a" fill={STATUS_COLORS.good} stroke="#fff" strokeWidth={2} maxBarSize={32} />
                <Bar dataKey="open" name="Open" stackId="a" fill={SERIES[0]} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Employee workload distribution"
          description="Open tasks per person (top 12)"
          loading={employees.isLoading}
          empty={!workloadRows.length}
          height={300}
          table={{ rows: employees.data ?? [], columns: [
            { key: "name", label: "Employee" },
            { key: "departmentName", label: "Department", format: (v) => (v as string | null) ?? "—" },
            { key: "open", label: "Open", align: "right" },
            { key: "overdue", label: "Overdue", align: "right" },
            { key: "estimatedOpenHours", label: "Est. hours", align: "right", format: (v) => `${v}h` },
            { key: "loggedHours", label: "Logged", align: "right", format: (v) => `${v}h` },
          ] }}
        >
          {employees.error ? <ErrorState error={employees.error} onRetry={() => employees.refetch()} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={workloadRows} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid {...gridProps} horizontal={false} vertical />
                <XAxis type="number" {...axisProps} allowDecimals={false} />
                <YAxis type="category" dataKey="name" {...axisProps} width={110} interval={0} tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f5f9" }} />
                <Bar dataKey="open" name="Open tasks" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Productivity"
          description={period === "weekly" ? "Tasks completed per week" : "Tasks completed per month"}
          loading={tasks.isLoading}
          empty={productivity.every((p) => p.completed === 0)}
          table={{ rows: productivity, columns: [
            { key: "label", label: period === "weekly" ? "Week of" : "Month" },
            { key: "completed", label: "Completed", align: "right" },
            { key: "hours", label: "Hours", align: "right", format: (v) => `${Math.round(Number(v) * 10) / 10}h` },
          ] }}
          actions={
            <Tabs value={period} onValueChange={(v) => setPeriod(v as "weekly" | "monthly")}>
              <TabsList className="h-7"><TabsTrigger value="weekly" className="text-xs">Weekly</TabsTrigger><TabsTrigger value="monthly" className="text-xs">Monthly</TabsTrigger></TabsList>
            </Tabs>
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={productivity} margin={{ left: -16, right: 8 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} minTickGap={12} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f5f9" }} />
              <Bar dataKey="completed" name="Completed" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Task status distribution"
          loading={tasks.isLoading}
          empty={statusRows.every((s) => s.count === 0)}
          table={{ rows: statusRows, columns: [{ key: "label", label: "Status" }, { key: "count", label: "Tasks", align: "right" }] }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={statusRows} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" {...axisProps} allowDecimals={false} />
              <YAxis type="category" dataKey="label" {...axisProps} width={90} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f5f9" }} />
              <Bar dataKey="count" name="Tasks" radius={[0, 4, 4, 0]} maxBarSize={16} label={{ position: "right", fill: "#475569", fontSize: 12 }}>
                {statusRows.map((s) => <Cell key={s.status} fill={STATUS_FILL[s.status]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title="Overdue task report" description="Open tasks past their due date" className="xl:col-span-3">
          {tasks.isLoading ? null : !t?.overdue.length ? (
            <EmptyState icon={CheckCircle2} title="No overdue tasks" description="Everything in this range is on schedule." className="py-8" />
          ) : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-4 py-2 font-medium">Task</th>
                    <th scope="col" className="px-3 py-2 font-medium">Assignees</th>
                    <th scope="col" className="px-3 py-2 font-medium">Priority</th>
                    <th scope="col" className="px-4 py-2 font-medium">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {t.overdue.map((o) => (
                    <tr key={o.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <Link href={`/tasks/${o.id}`} className="font-medium hover:text-primary hover:underline">{o.title}</Link>
                        <p className="text-xs text-muted-foreground"><span className="font-mono">{o.key}</span> · {o.departmentName}</p>
                      </td>
                      <td className="px-3 py-2.5"><UserStack users={o.assignedTo} max={2} /></td>
                      <td className="px-3 py-2.5"><PriorityBadge priority={o.priority} /></td>
                      <td className="px-4 py-2.5"><DueDate task={{ ...o, isOverdue: true, isDueSoon: false }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Project progress" className="xl:col-span-2">
          {!t?.projectProgress.length ? (
            <EmptyState title="No projects in range" className="py-8" />
          ) : (
            <ul className="space-y-3 p-4">
              {t.projectProgress.map((p) => {
                const pct = p.total ? Math.round((p.completed / p.total) * 100) : 0;
                return (
                  <li key={p.projectId}>
                    <div className="mb-1 flex justify-between text-[13px]">
                      <span className="truncate font-medium">{p.project}</span>
                      <span className="text-muted-foreground tabular">{p.completed}/{p.total}</span>
                    </div>
                    <ProgressBar value={pct} tone={pct === 100 ? "success" : "info"} label={`${p.project} progress`} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
