"use client";

import { useState } from "react";
import Link from "next/link";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays } from "date-fns";
import { toast } from "sonner";
import { FolderKanban, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Field, applyFieldErrors } from "@/components/common/field";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { UserLabel } from "@/components/common/user-avatar";
import { useAuth } from "@/components/providers/auth-provider";
import { ProgressBar } from "@/components/tasks/task-badges";
import { useDepartments } from "@/hooks/use-lookups";
import { ApiError } from "@/lib/api/client";
import { projectsApi } from "@/lib/api/services";
import { formatDay, toDateInput } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { toneClasses, type Tone } from "@/lib/task-meta";
import type { ProjectStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS: Record<ProjectStatus, { label: string; tone: Tone }> = {
  planning: { label: "Planning", tone: "neutral" },
  active: { label: "Active", tone: "info" },
  on_hold: { label: "On hold", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
};

const schema = z
  .object({
    name: z.string().trim().min(2, "Enter a project name.").max(100),
    key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,9}$/, "2–10 letters/numbers, starting with a letter."),
    description: z.string().max(500),
    departmentId: z.string().min(1, "Select a department."),
    status: z.enum(["planning", "active", "on_hold", "completed"]),
    startDate: z.string().min(1, "Pick a start date."),
    dueDate: z.string().min(1, "Pick a deadline."),
  })
  .refine((v) => v.dueDate >= v.startDate, { path: ["dueDate"], message: "Deadline must be after the start date." });
type Values = z.infer<typeof schema>;

function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const departments = useDepartments();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", key: "", description: "", departmentId: "", status: "planning", startDate: toDateInput(new Date()), dueDate: toDateInput(addDays(new Date(), 60)) },
  });
  const { errors, isSubmitting } = form.formState;
  const create = useMutation({ meta: { silent: true }, mutationFn: (v: Values) => projectsApi.create({ ...v, description: v.description || undefined }) });
  const submit = form.handleSubmit(async (v) => {
    try {
      const p = await create.mutateAsync(v);
      void qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`Project ${p.name} created`);
      form.reset();
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && applyFieldErrors(e.fieldErrors, form.setError)) return;
      form.setError("root", { message: e instanceof Error ? e.message : "Couldn't create project." });
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>You&apos;ll be set as the project manager; change it later if needed.</DialogDescription>
          </DialogHeader>
          {errors.root && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errors.root.message}</p>}
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="Name" error={errors.name?.message} required><Input {...form.register("name")} /></Field>
            <Field label="Key" error={errors.key?.message} required><Input className="uppercase" maxLength={10} {...form.register("key")} /></Field>
          </div>
          <Field label="Description" error={errors.description?.message}><Textarea rows={2} {...form.register("description")} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department" error={errors.departmentId?.message} required>
              <Controller control={form.control} name="departmentId" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{(departments.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </Field>
            <Field label="Status">
              <Controller control={form.control} name="status" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STATUS).map(([k, s]) => <SelectItem key={k} value={k}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </Field>
            <Field label="Start date" error={errors.startDate?.message} required><Input type="date" {...form.register("startDate")} /></Field>
            <Field label="Deadline" error={errors.dueDate?.message} required><Input type="date" {...form.register("dueDate")} /></Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Loader2 className="animate-spin" />} Create project</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectsPage() {
  const { can, canAny } = useAuth();
  const [open, setOpen] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: qk.projects(), queryFn: () => projectsApi.list() });
  const taskLink = canAny(["tasks.view_all", "tasks.view_team"]) ? "/tasks" : "/my-tasks";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        description="Initiatives that group related tasks, with owners and deadlines."
        actions={can("projects.manage") && <Button onClick={() => setOpen(true)}><Plus /> New project</Button>}
      />
      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !isLoading && !data?.length ? (
          <EmptyState icon={FolderKanban} title="No projects yet" description="Projects you're part of will show up here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <caption className="sr-only">Projects</caption>
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2.5 pr-3 pl-4 font-medium">Project</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Department</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Manager</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Timeline</th>
                  <th scope="col" className="w-48 py-2.5 pr-4 pl-3 font-medium">Progress</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 6 }).map((_, i) => <tr key={i} className="border-b"><td colSpan={6} className="px-4 py-3"><Skeleton className="h-7" /></td></tr>)
                  : data!.map((p) => {
                      const pct = p.taskCount ? Math.round((p.completedTaskCount / p.taskCount) * 100) : 0;
                      return (
                        <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-3 pr-3 pl-4">
                            <Link href={`${taskLink}?projectId=${p.id}`} className="font-medium hover:text-primary hover:underline">{p.name}</Link>
                            <p className="font-mono text-xs text-muted-foreground">{p.key}</p>
                          </td>
                          <td className="px-3 py-3">{p.departmentName}</td>
                          <td className="px-3 py-3">{p.manager ? <UserLabel user={p.manager} /> : "—"}</td>
                          <td className="px-3 py-3">
                            <span className={cn("inline-flex h-6 items-center rounded-md px-2 text-xs font-medium ring-1 ring-inset", toneClasses[STATUS[p.status].tone])}>{STATUS[p.status].label}</span>
                          </td>
                          <td className="px-3 py-3 text-xs whitespace-nowrap text-muted-foreground">{formatDay(p.startDate, "MMM d")} → {formatDay(p.dueDate)}</td>
                          <td className="py-3 pr-4 pl-3">
                            <ProgressBar value={pct} tone={pct === 100 ? "success" : "info"} label={`${p.name} progress`} />
                            <p className="mt-0.5 text-[11px] text-muted-foreground tabular">{p.completedTaskCount} of {p.taskCount} tasks</p>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <CreateProjectDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
