"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, applyFieldErrors } from "@/components/common/field";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/states";
import { UserAvatar } from "@/components/common/user-avatar";
import { useAuth, useCurrentUser } from "@/components/providers/auth-provider";
import { RoleBadge } from "@/components/employees/employee-badges";
import { ApiError } from "@/lib/api/client";
import { authApi, settingsApi, usersApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";
import { jobFunctionLabels } from "@/lib/roles";
import { passwordSchema } from "@/lib/validation";
import type { NotificationPreferences } from "@/lib/types";

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-lg border bg-card p-5 shadow-xs md:grid-cols-[240px_minmax(0,1fr)]">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="max-w-xl">{children}</div>
    </section>
  );
}

/* ---------- Profile ---------- */

const profileSchema = z.object({
  firstName: z.string().trim().min(1, "Required.").max(60),
  lastName: z.string().trim().min(1, "Required.").max(60),
  title: z.string().trim().max(100),
});

function ProfileTab() {
  const user = useCurrentUser();
  const { setUser } = useAuth();
  const [first = "", ...rest] = user.name.split(" ");
  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { firstName: first, lastName: rest.join(" "), title: user.title ?? "" },
  });
  const { errors, isSubmitting, isDirty } = form.formState;
  const save = useMutation({ mutationFn: usersApi.updateProfile });
  const submit = form.handleSubmit(async (v) => {
    try {
      const updated = await save.mutateAsync(v);
      setUser(updated);
      form.reset(v);
      toast.success("Profile updated");
    } catch {
      /* toasted globally */
    }
  });
  return (
    <div className="space-y-4">
      <Section title="Profile" description="How you appear to teammates.">
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="flex items-center gap-3">
            <UserAvatar user={user} size="lg" />
            <div className="text-sm">
              <p className="font-medium">{user.email}</p>
              <p className="text-xs text-muted-foreground">Employee ID {user.employeeId}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" error={errors.firstName?.message} required><Input {...form.register("firstName")} /></Field>
            <Field label="Last name" error={errors.lastName?.message} required><Input {...form.register("lastName")} /></Field>
          </div>
          <Field label="Job title" error={errors.title?.message}><Input {...form.register("title")} /></Field>
          <Button type="submit" disabled={!isDirty || isSubmitting}>{isSubmitting && <Loader2 className="animate-spin" />} Save profile</Button>
        </form>
      </Section>
      <Section title="Role & department" description="Managed by your administrator.">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Security role</dt><dd className="mt-1"><RoleBadge role={user.role} /></dd></div>
          <div><dt className="text-xs text-muted-foreground">Job function</dt><dd className="mt-1">{jobFunctionLabels[user.jobFunction]}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Department</dt><dd className="mt-1">{user.departmentName ?? "—"}</dd></div>
        </dl>
      </Section>
    </div>
  );
}

/* ---------- Security ---------- */

const passwordForm = z
  .object({ currentPassword: z.string().min(1, "Enter your current password."), newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "Passwords don't match." })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ["newPassword"], message: "Choose a different password." });

function SecurityTab() {
  const form = useForm<z.infer<typeof passwordForm>>({ resolver: zodResolver(passwordForm), defaultValues: { currentPassword: "", newPassword: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;
  const change = useMutation({ meta: { silent: true }, mutationFn: (v: z.infer<typeof passwordForm>) => authApi.changePassword(v.currentPassword, v.newPassword) });
  const submit = form.handleSubmit(async (v) => {
    try {
      await change.mutateAsync(v);
      form.reset();
      toast.success("Password changed", { description: "Other sessions have been signed out." });
    } catch (e) {
      if (e instanceof ApiError && applyFieldErrors(e.fieldErrors, form.setError)) return;
      form.setError("root", { message: e instanceof Error ? e.message : "Couldn't change password." });
    }
  });
  return (
    <Section title="Change password" description="Changing your password signs you out of other devices.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {errors.root && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errors.root.message}</p>}
        <Field label="Current password" error={errors.currentPassword?.message} required><Input type="password" autoComplete="current-password" {...form.register("currentPassword")} /></Field>
        <Field label="New password" error={errors.newPassword?.message} description="At least 10 characters, with a letter and a number." required><Input type="password" autoComplete="new-password" {...form.register("newPassword")} /></Field>
        <Field label="Confirm new password" error={errors.confirm?.message} required><Input type="password" autoComplete="new-password" {...form.register("confirm")} /></Field>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Loader2 className="animate-spin" />} Update password</Button>
      </form>
    </Section>
  );
}

/* ---------- Notifications ---------- */

const PREFS: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  { key: "emailAssignments", label: "Assignments", description: "Email me when a task is assigned or reassigned to me." },
  { key: "emailDueReminders", label: "Deadline reminders", description: "Email me before a task is due and when it becomes overdue." },
  { key: "emailReviews", label: "Reviews", description: "Email me about review requests, approvals and requested changes." },
  { key: "inAppComments", label: "Comments & mentions", description: "Notify me in-app about comments on my tasks." },
  { key: "dailyDigest", label: "Daily digest", description: "A morning summary of my open and upcoming work." },
];

function NotificationsTab() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: qk.preferences(), queryFn: settingsApi.preferences });
  const save = useMutation({
    mutationFn: settingsApi.updatePreferences,
    onSuccess: (p) => {
      qc.setQueryData(qk.preferences(), p);
      toast.success("Preferences saved");
    },
  });
  return (
    <Section title="Notification preferences" description="Choose how Bizwoke Nova keeps you informed.">
      {isLoading ? <Skeleton className="h-48" /> : error ? <ErrorState error={error} onRetry={() => refetch()} /> : data && (
        <ul className="divide-y rounded-md border">
          {PREFS.map((p) => (
            <li key={p.key}>
              <label className="flex cursor-pointer items-start justify-between gap-4 p-3">
                <span>
                  <span className="block text-sm font-medium">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">{p.description}</span>
                </span>
                <Switch checked={data[p.key]} disabled={save.isPending} onCheckedChange={(v) => save.mutate({ ...data, [p.key]: v })} />
              </label>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ---------- Organisation ---------- */

const orgSchema = z.object({
  name: z.string().trim().min(2, "Enter the organisation name.").max(100),
  dueSoonThresholdDays: z.coerce.number<string>().int().min(0).max(30),
  reviewRequired: z.boolean(),
  timezone: z.string().min(1),
});

function OrganizationTab() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: qk.orgSettings(), queryFn: settingsApi.organization });
  const form = useForm<z.input<typeof orgSchema>, unknown, z.output<typeof orgSchema>>({ resolver: zodResolver(orgSchema) });
  useEffect(() => {
    if (data) form.reset({ ...data, dueSoonThresholdDays: String(data.dueSoonThresholdDays) });
  }, [data, form]);
  const { errors, isSubmitting, isDirty } = form.formState;
  const save = useMutation({ mutationFn: settingsApi.updateOrganization });
  const submit = form.handleSubmit(async (v) => {
    try {
      const updated = await save.mutateAsync(v);
      qc.setQueryData(qk.orgSettings(), updated);
      void qc.invalidateQueries({ queryKey: qk.tasks });
      toast.success("Organisation settings saved");
    } catch {
      /* toasted globally */
    }
  });
  if (isLoading) return <Skeleton className="h-64" />;
  if (error) return <div className="rounded-lg border bg-card"><ErrorState error={error} onRetry={() => refetch()} /></div>;
  return (
    <Section title="Organisation" description="Workspace-wide rules. Changes apply to everyone.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="Organisation name" error={errors.name?.message} required><Input {...form.register("name")} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="“Due soon” warning (days)" error={errors.dueSoonThresholdDays?.message} description="Tasks due within this many days get an amber warning.">
            <Input type="number" min={0} max={30} {...form.register("dueSoonThresholdDays")} />
          </Field>
          <Field label="Timezone" error={errors.timezone?.message} description="Used for reports; deadlines are stored in UTC.">
            <Input {...form.register("timezone")} />
          </Field>
        </div>
        <Controller control={form.control} name="reviewRequired" render={({ field }) => (
          <label className="flex items-start gap-3 rounded-md border p-3">
            <Switch checked={!!field.value} onCheckedChange={field.onChange} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Require manager approval</span>
              <span className="block text-xs text-muted-foreground">Tasks only become Completed after a manager approves a review submission.</span>
            </span>
          </label>
        )} />
        <Button type="submit" disabled={!isDirty || isSubmitting}>{isSubmitting && <Loader2 className="animate-spin" />} Save settings</Button>
      </form>
    </Section>
  );
}

export function SettingsView() {
  const { can } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get("tab") ?? "profile";
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Your profile, security and notification preferences." />
      <Tabs value={tab} onValueChange={(v) => router.replace(v === "profile" ? pathname : `${pathname}?tab=${v}`, { scroll: false })}>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          {can("settings.org") && <TabsTrigger value="organization">Organisation</TabsTrigger>}
        </TabsList>
        <TabsContent value="profile" className="pt-4"><ProfileTab /></TabsContent>
        <TabsContent value="security" className="pt-4"><SecurityTab /></TabsContent>
        <TabsContent value="notifications" className="pt-4"><NotificationsTab /></TabsContent>
        {can("settings.org") && <TabsContent value="organization" className="pt-4"><OrganizationTab /></TabsContent>}
      </Tabs>
    </div>
  );
}
