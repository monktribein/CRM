"use client";

import { useState } from "react";
import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Copy, Eye, EyeOff, KeyRound, Loader2, UserPlus, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, applyFieldErrors } from "@/components/common/field";
import { PageHeader } from "@/components/common/page-header";
import { useCurrentUser } from "@/components/providers/auth-provider";
import { AccountStatusBadge, RoleBadge } from "@/components/employees/employee-badges";
import { useManagers } from "@/components/employees/use-managers";
import { useDepartments } from "@/hooks/use-lookups";
import { ApiError } from "@/lib/api/client";
import { usersApi } from "@/lib/api/services";
import { toDateInput } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { grantableRoles, jobFunctionLabels, roleMeta } from "@/lib/roles";
import type { InvitationResult, JobFunction, Role } from "@/lib/types";
import { cn } from "@/lib/utils";

const NONE = "__none__";

const schema = z.object({
  firstName: z.string().trim().min(1, "Enter a first name.").max(60),
  lastName: z.string().trim().min(1, "Enter a last name.").max(60),
  email: z.string().trim().toLowerCase().email("Enter a valid work email."),
  title: z.string().trim().max(100),
  role: z.string().min(1, "Choose a role."),
  jobFunction: z.string().min(1, "Choose a job function."),
  departmentId: z.string().min(1, "Select a department."),
  managerId: z.string(),
  joinDate: z.string().min(1, "Pick a join date."),
  password: z.string().min(1, "Enter or generate a password.").max(128),
});
type Values = z.infer<typeof schema>;

const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** Random 12-character password without look-alike characters (0/O, 1/l/I). */
function generatePassword(length = 12) {
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join("");
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function Step({ n, title, description, children }: { n: number; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b p-5 last:border-0 md:grid-cols-[220px_minmax(0,1fr)]" aria-labelledby={`step-${n}`}>
      <div>
        <p className="text-xs font-semibold text-primary">Step {n}</p>
        <h2 id={`step-${n}`} className="mt-0.5 text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export default function NewEmployeePage() {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const departments = useDepartments();
  const managers = useManagers();
  const roles = grantableRoles(me.role);
  const [result, setResult] = useState<{ invitation: InvitationResult; password: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: "", lastName: "", email: "", title: "", role: "employee", jobFunction: "",
      departmentId: "", managerId: NONE, joinDate: toDateInput(new Date()), password: "",
    },
  });
  const { errors, isSubmitting } = form.formState;
  const departmentId = useWatch({ control: form.control, name: "departmentId" });
  const selectedDept = departments.data?.find((d) => d.id === departmentId);

  const create = useMutation({
    meta: { silent: true },
    mutationFn: (v: Values) =>
      usersApi.create({
        ...v,
        title: v.title || undefined,
        role: v.role as Role,
        jobFunction: v.jobFunction as JobFunction,
        managerId: v.managerId === NONE ? null : v.managerId,
        sendInvitation: false,
      }),
  });

  const submit = form.handleSubmit(async (v) => {
    try {
      const r = await create.mutateAsync(v);
      void qc.invalidateQueries({ queryKey: qk.users });
      setResult({ invitation: r, password: v.password });
    } catch (e) {
      if (e instanceof ApiError && applyFieldErrors(e.fieldErrors, form.setError)) return;
      form.setError("root", { message: e instanceof Error ? e.message : "Couldn't create the account." });
    }
  });

  if (result) {
    const u = result.invitation.user;
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="rounded-lg border bg-card p-6 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">Account created for {u.name}</h1>
              <p className="text-sm text-muted-foreground">{u.email} · {u.employeeId}</p>
            </div>
          </div>
          <dl className="mt-5 grid gap-3 rounded-md bg-muted/40 p-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Role</dt><dd className="mt-1"><RoleBadge role={u.role} /></dd></div>
            <div><dt className="text-xs text-muted-foreground">Account status</dt><dd className="mt-1"><AccountStatusBadge status={u.status} /></dd></div>
            <div><dt className="text-xs text-muted-foreground">Department</dt><dd className="mt-1">{u.departmentName}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Reporting manager</dt><dd className="mt-1">{u.managerName ?? "—"}</dd></div>
          </dl>
          <div className="mt-5 space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="flex items-center gap-2 font-medium"><KeyRound className="size-4" aria-hidden="true" /> Login credentials</p>
            <p className="text-xs">Share these with {u.name}. The password can&apos;t be shown again after you leave this page.</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs">Login ID</span>
                <Input readOnly value={u.email} className="h-8 bg-white font-mono text-xs" aria-label="Login ID" onFocus={(e) => e.target.select()} />
                <CopyButton value={u.email} label="login ID" />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs">Password</span>
                <Input readOnly value={result.password} className="h-8 bg-white font-mono text-xs" aria-label="Password" onFocus={(e) => e.target.select()} />
                <CopyButton value={result.password} label="password" />
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            The account is active. When they sign in, they&apos;ll see the workspace for the <span className="font-medium">{roleMeta[u.role].label}</span> role.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => { form.reset(); setShowPassword(false); setResult(null); }}><UserPlus /> Add another</Button>
          <Button variant="outline" asChild><Link href="/employees">Back to directory</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Add employee" description="Create the account, assign a role, then place them in a department, then set their login password." />
      <form onSubmit={submit} noValidate className="overflow-hidden rounded-lg border bg-card shadow-xs">
        {errors.root && <p role="alert" className="m-5 mb-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errors.root.message}</p>}

        <Step n={1} title="Account details" description="The work email becomes their sign-in.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" error={errors.firstName?.message} required><Input autoComplete="off" {...form.register("firstName")} /></Field>
            <Field label="Last name" error={errors.lastName?.message} required><Input autoComplete="off" {...form.register("lastName")} /></Field>
            <Field label="Work email" error={errors.email?.message} required><Input type="email" autoComplete="off" {...form.register("email")} /></Field>
            <Field label="Job title" error={errors.title?.message}><Input placeholder="e.g. Senior Designer" {...form.register("title")} /></Field>
            <Field label="Join date" error={errors.joinDate?.message} required><Input type="date" {...form.register("joinDate")} /></Field>
          </div>
        </Step>

        <Step n={2} title="Security role" description="Controls what they can see and do. Separate from their job function.">
          <Controller
            control={form.control}
            name="role"
            render={({ field }) => (
              <div role="radiogroup" aria-label="Security role" className="grid gap-2 sm:grid-cols-2">
                {roles.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={field.value === r}
                    onClick={() => field.onChange(r)}
                    className={cn(
                      "rounded-md border p-3 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                      field.value === r ? "border-primary bg-accent/50 ring-1 ring-primary" : "hover:bg-muted/50"
                    )}
                  >
                    <span className="block text-sm font-medium">{roleMeta[r].label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{roleMeta[r].description}</span>
                  </button>
                ))}
              </div>
            )}
          />
          {errors.role && <p className="text-xs font-medium text-red-600" role="alert">{errors.role.message}</p>}
        </Step>

        <Step n={3} title="Department & reporting" description="Where they sit and who they report to.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department" error={errors.departmentId?.message} required>
              <Controller control={form.control} name="departmentId" render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => {
                  field.onChange(v);
                  const d = departments.data?.find((x) => x.id === v);
                  if (d?.managerId && form.getValues("managerId") === NONE) form.setValue("managerId", d.managerId);
                }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select a department" /></SelectTrigger>
                  <SelectContent>{(departments.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </Field>
            <Field label="Job function" error={errors.jobFunction?.message} required>
              <Controller control={form.control} name="jobFunction" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="e.g. Developer" /></SelectTrigger>
                  <SelectContent>{Object.entries(jobFunctionLabels).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </Field>
            <Field label="Reporting manager" description={selectedDept?.managerName ? `${selectedDept.name} is managed by ${selectedDept.managerName}.` : undefined}>
              <Controller control={form.control} name="managerId" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No manager</SelectItem>
                    {(managers.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.name} · {m.departmentName ?? "—"}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </Field>
          </div>
        </Step>

        <Step n={4} title="Login credentials" description="They sign in with their work email and this password. The account is active right away.">
          <Field label="Password" error={errors.password?.message} required>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input type={showPassword ? "text" : "password"} autoComplete="new-password" className="pr-9 font-mono" {...form.register("password")} />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  form.setValue("password", generatePassword(), { shouldValidate: true, shouldDirty: true });
                  setShowPassword(true);
                }}
              >
                <Wand2 /> Generate
              </Button>
            </div>
          </Field>
        </Step>

        <div className="flex justify-end gap-2 border-t bg-muted/30 px-5 py-3">
          <Button type="button" variant="outline" asChild><Link href="/employees">Cancel</Link></Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />} Create account
          </Button>
        </div>
      </form>
    </div>
  );
}
