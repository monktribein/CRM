"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, ListChecks, Loader2, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Field, applyFieldErrors } from "@/components/common/field";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { useAuth } from "@/components/providers/auth-provider";
import { ProgressBar } from "@/components/tasks/task-badges";
import { useManagers } from "@/components/employees/use-managers";
import { ApiError } from "@/lib/api/client";
import { departmentsApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";

const NONE = "__none__";
const schema = z.object({
  name: z.string().trim().min(2, "Enter a department name.").max(80),
  description: z.string().max(300),
  managerId: z.string(),
});
type Values = z.infer<typeof schema>;

function CreateDepartmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const managers = useManagers(open);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: "", description: "", managerId: NONE } });
  const { errors, isSubmitting } = form.formState;
  const create = useMutation({
    meta: { silent: true },
    mutationFn: (v: Values) => departmentsApi.create({ name: v.name, description: v.description || undefined, managerId: v.managerId === NONE ? null : v.managerId }),
  });
  const submit = form.handleSubmit(async (v) => {
    try {
      const d = await create.mutateAsync(v);
      void qc.invalidateQueries({ queryKey: ["departments"] });
      toast.success(`${d.name} department created`);
      form.reset();
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && applyFieldErrors(e.fieldErrors, form.setError)) return;
      form.setError("root", { message: e instanceof Error ? e.message : "Couldn't create department." });
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add department</DialogTitle>
            <DialogDescription>Department names must be unique in your organisation.</DialogDescription>
          </DialogHeader>
          {errors.root && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errors.root.message}</p>}
          <Field label="Name" error={errors.name?.message} required><Input {...form.register("name")} /></Field>
          <Field label="Description" error={errors.description?.message}><Textarea rows={2} {...form.register("description")} /></Field>
          <Field label="Department manager">
            <Controller control={form.control} name="managerId" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Assign later</SelectItem>
                  {(managers.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Loader2 className="animate-spin" />} Create department</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function DepartmentsPage() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: qk.departments(), queryFn: () => departmentsApi.list() });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Teams & Departments"
        description="Departments, their managers, headcount and delivery health."
        actions={can("departments.manage") && <Button onClick={() => setOpen(true)}><Plus /> Add department</Button>}
      />
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : error ? (
        <div className="rounded-lg border bg-card"><ErrorState error={error} onRetry={() => refetch()} /></div>
      ) : !data?.length ? (
        <div className="rounded-lg border bg-card"><EmptyState icon={Building2} title="No departments yet" /></div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((d) => (
            <li key={d.id} className="flex flex-col rounded-lg border bg-card p-4 shadow-xs">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                  <Building2 className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{d.name}</h2>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{d.description ?? "No description"}</p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-muted/50 py-2">
                  <dt className="text-[11px] text-muted-foreground">People</dt>
                  <dd className="text-sm font-semibold tabular">{d.employeeCount}</dd>
                </div>
                <div className="rounded-md bg-muted/50 py-2">
                  <dt className="text-[11px] text-muted-foreground">Open tasks</dt>
                  <dd className="text-sm font-semibold tabular">{d.activeTaskCount}</dd>
                </div>
                <div className="rounded-md bg-muted/50 py-2">
                  <dt className="text-[11px] text-muted-foreground">Done</dt>
                  <dd className="text-sm font-semibold tabular">{d.completionRate}%</dd>
                </div>
              </dl>
              <div className="mt-3"><ProgressBar value={d.completionRate} tone="success" label={`${d.name} completion rate`} /></div>
              <p className="mt-3 text-xs text-muted-foreground">Manager: <span className="font-medium text-foreground">{d.managerName ?? "Unassigned"}</span></p>
              <div className="mt-auto flex gap-1 pt-3">
                {can("employees.view") && (
                  <Button variant="ghost" size="sm" asChild><Link href={`/employees?departmentId=${d.id}`}><Users /> Members</Link></Button>
                )}
                {(can("tasks.view_all") || can("tasks.view_team")) && (
                  <Button variant="ghost" size="sm" asChild><Link href={`/tasks?departmentId=${d.id}`}><ListChecks /> Tasks</Link></Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <CreateDepartmentDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
