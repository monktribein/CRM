"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, applyFieldErrors } from "@/components/common/field";
import { useCurrentUser } from "@/components/providers/auth-provider";
import { useManagers } from "@/components/employees/use-managers";
import { useDepartments } from "@/hooks/use-lookups";
import { ApiError } from "@/lib/api/client";
import { usersApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";
import { grantableRoles, jobFunctionLabels, roleMeta } from "@/lib/roles";
import type { Employee, JobFunction, Role } from "@/lib/types";

const NONE = "__none__";

const schema = z.object({
  title: z.string().max(100),
  role: z.string().min(1),
  jobFunction: z.string().min(1),
  departmentId: z.string().min(1, "Select a department."),
  managerId: z.string(),
});
type Values = z.infer<typeof schema>;

export function EditEmployeeDialog({ employee, onOpenChange }: { employee: Employee | null; onOpenChange: (o: boolean) => void }) {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const departments = useDepartments();
  const managers = useManagers(!!employee);
  const roles = grantableRoles(me.role);
  const canChangeRole = !!employee && employee.id !== me.id && roles.includes(employee.role);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: employee
      ? {
          title: employee.title ?? "",
          role: employee.role,
          jobFunction: employee.jobFunction,
          departmentId: employee.departmentId ?? "",
          managerId: employee.managerId ?? NONE,
        }
      : undefined,
  });
  const { errors, isSubmitting } = form.formState;

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (v: Values) =>
      usersApi.update(employee!.id, {
        title: v.title,
        ...(canChangeRole && v.role !== employee!.role ? { role: v.role as Role } : {}),
        jobFunction: v.jobFunction as JobFunction,
        departmentId: v.departmentId,
        managerId: v.managerId === NONE ? null : v.managerId,
      }),
  });

  const submit = form.handleSubmit(async (v) => {
    try {
      const updated = await save.mutateAsync(v);
      void qc.invalidateQueries({ queryKey: qk.users });
      toast.success(`${updated.name} updated`);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && applyFieldErrors(e.fieldErrors, form.setError)) return;
      form.setError("root", { message: e instanceof Error ? e.message : "Couldn't save changes." });
    }
  });

  return (
    <Dialog open={!!employee} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Edit {employee?.name}</DialogTitle>
            <DialogDescription>Security role and job function are managed separately.</DialogDescription>
          </DialogHeader>
          {errors.root && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errors.root.message}</p>}
          <Field label="Job title" error={errors.title?.message}>
            <Input {...form.register("title")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Security role" description={canChangeRole ? undefined : "You can't change this account's role."}>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!canChangeRole}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(canChangeRole ? roles : [employee?.role ?? "employee"]).map((r) => (
                        <SelectItem key={r} value={r}>{roleMeta[r].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Job function">
              <Controller
                control={form.control}
                name="jobFunction"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(jobFunctionLabels).map(([k, label]) => (
                        <SelectItem key={k} value={k}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Department" error={errors.departmentId?.message}>
              <Controller
                control={form.control}
                name="departmentId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {(departments.data ?? []).map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Reporting manager">
              <Controller
                control={form.control}
                name="managerId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No manager</SelectItem>
                      {(managers.data ?? []).filter((m) => m.id !== employee?.id).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />} Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
