"use client";

import { useRouter } from "next/navigation";
import { useFieldArray, useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { addDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, applyFieldErrors } from "@/components/common/field";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { useCurrentUser } from "@/components/providers/auth-provider";
import { useAssignableUsers, useDepartments, useProjects } from "@/hooks/use-lookups";
import { ApiError } from "@/lib/api/client";
import { tasksApi } from "@/lib/api/services";
import { toDateInput } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { PRIORITY_ORDER, priorityMeta, toneClasses } from "@/lib/task-meta";
import type { TaskDetail, TaskPriority } from "@/lib/types";
import { cn } from "@/lib/utils";

const schema = z
  .object({
    title: z.string().trim().min(3, "Title must be at least 3 characters.").max(200),
    description: z.string().max(10_000),
    projectId: z.string().min(1, "Select a project."),
    departmentId: z.string().min(1, "Select a department."),
    assigneeIds: z.array(z.string()),
    priority: z.enum(["low", "medium", "high", "critical"]),
    startDate: z.string().min(1, "Pick a start date."),
    dueDate: z.string().min(1, "Pick a due date."),
    estimatedHours: z.coerce.number<string>({ error: "Enter a number of hours." }).min(0.5, "At least 0.5 hours.").max(1000),
    tags: z.string().max(300),
    checklist: z.array(z.object({ label: z.string().trim().max(200) })),
  })
  .refine((v) => v.dueDate >= v.startDate, { path: ["dueDate"], message: "Due date must be on or after the start date." });

type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

export function TaskForm({ task }: { task?: TaskDetail }) {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const editing = !!task;
  const departments = useDepartments();
  const projects = useProjects();
  const assignable = useAssignableUsers(!editing);

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: task
      ? {
          title: task.title,
          description: task.description,
          projectId: task.projectId,
          departmentId: task.departmentId,
          assigneeIds: task.assignedTo.map((a) => a.id),
          priority: task.priority,
          startDate: task.startDate.slice(0, 10),
          dueDate: task.dueDate.slice(0, 10),
          estimatedHours: String(task.estimatedHours),
          tags: task.tags.join(", "),
          checklist: [],
        }
      : {
          title: "",
          description: "",
          projectId: "",
          departmentId: user.departmentId ?? "",
          assigneeIds: [],
          priority: "medium",
          startDate: toDateInput(new Date()),
          dueDate: toDateInput(addDays(new Date(), 7)),
          estimatedHours: "4",
          tags: "",
          checklist: [],
        },
  });
  const { errors, isSubmitting } = form.formState;
  const checklist = useFieldArray({ control: form.control, name: "checklist" });

  const save = useMutation({
    meta: { silent: true },
    mutationFn: async (v: FormOut) => {
      const tags = v.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (task) {
        return tasksApi.update(task.id, {
          title: v.title,
          description: v.description,
          projectId: v.projectId,
          departmentId: v.departmentId,
          priority: v.priority,
          startDate: v.startDate,
          dueDate: v.dueDate,
          estimatedHours: v.estimatedHours,
          tags,
        });
      }
      return tasksApi.create({
        ...v,
        tags,
        checklist: v.checklist.filter((c) => c.label.length > 0),
      });
    },
  });

  const onSubmit = form.handleSubmit(async (v) => {
    if (!editing && v.assigneeIds.length === 0) {
      form.setError("assigneeIds", { message: "Assign at least one employee." });
      return;
    }
    try {
      const saved = await save.mutateAsync(v);
      qc.setQueryData(qk.task(saved.id), saved);
      void qc.invalidateQueries({ queryKey: qk.tasks });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      toast.success(editing ? `${saved.key} updated` : `${saved.key} created and assigned`);
      router.push(`/tasks/${saved.id}`);
    } catch (e) {
      if (e instanceof ApiError && applyFieldErrors(e.fieldErrors, form.setError)) return;
      form.setError("root", { message: e instanceof Error ? e.message : "Couldn't save the task." });
    }
  });

  const onProjectChange = (projectId: string) => {
    form.setValue("projectId", projectId, { shouldValidate: true });
    const p = projects.data?.find((x) => x.id === projectId);
    if (p) form.setValue("departmentId", p.departmentId, { shouldValidate: true });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5 rounded-lg border bg-card p-5 shadow-xs">
        {errors.root && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errors.root.message}
          </p>
        )}
        <Field label="Title" error={errors.title?.message} required>
          <Input placeholder="e.g. Prepare Q4 pipeline review" {...form.register("title")} />
        </Field>
        <Field label="Description" error={errors.description?.message} description="Context, acceptance criteria and links.">
          <Textarea rows={7} {...form.register("description")} />
        </Field>

        {!editing && (
          <Field label="Assign to" error={errors.assigneeIds?.message} description="You can assign one or more employees you're permitted to manage." required>
            <Controller
              control={form.control}
              name="assigneeIds"
              render={({ field }) => (
                <AssigneePicker options={assignable.data ?? []} loading={assignable.isLoading} value={field.value} onChange={field.onChange} />
              )}
            />
          </Field>
        )}

        {!editing && (
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium">Checklist</legend>
            {checklist.fields.length === 0 && <p className="text-xs text-muted-foreground">Break the work into steps (optional).</p>}
            <ul className="space-y-2">
              {checklist.fields.map((f, i) => (
                <li key={f.id} className="flex gap-2">
                  <Input placeholder={`Step ${i + 1}`} aria-label={`Checklist item ${i + 1}`} {...form.register(`checklist.${i}.label`)} className="h-8" />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => checklist.remove(i)} aria-label={`Remove item ${i + 1}`}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
            <Button type="button" variant="outline" size="sm" onClick={() => checklist.append({ label: "" })} disabled={checklist.fields.length >= 30}>
              <Plus /> Add item
            </Button>
          </fieldset>
        )}
      </div>

      <div className="space-y-5">
        <div className="space-y-4 rounded-lg border bg-card p-5 shadow-xs">
          <Field label="Project" error={errors.projectId?.message} required>
            <Controller
              control={form.control}
              name="projectId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={onProjectChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={projects.isLoading ? "Loading…" : "Select a project"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(projects.data ?? []).filter((p) => !p.archived).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} <span className="text-muted-foreground">({p.key})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Department" error={errors.departmentId?.message} description="Set from the project; change if needed." required>
            <Controller
              control={form.control}
              name="departmentId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a department" />
                  </SelectTrigger>
                  <SelectContent>
                    {(departments.data ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>

          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Priority</legend>
            <Controller
              control={form.control}
              name="priority"
              render={({ field }) => (
                <div role="radiogroup" aria-label="Priority" className="grid grid-cols-2 gap-1.5">
                  {[...PRIORITY_ORDER].reverse().map((p: TaskPriority) => {
                    const meta = priorityMeta[p];
                    const selected = field.value === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => field.onChange(p)}
                        className={cn(
                          "flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                          selected ? cn(toneClasses[meta.tone], "ring-1 ring-inset") : "hover:bg-muted"
                        )}
                      >
                        <meta.icon className="size-3.5" aria-hidden="true" /> {meta.label}
                      </button>
                    );
                  })}
                </div>
              )}
            />
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date" error={errors.startDate?.message} required>
              <Input type="date" {...form.register("startDate")} />
            </Field>
            <Field label="Due date" error={errors.dueDate?.message} required>
              <Input type="date" {...form.register("dueDate")} />
            </Field>
          </div>
          <Field label="Estimated effort (hours)" error={errors.estimatedHours?.message} required>
            <Input type="number" min={0.5} step={0.5} inputMode="decimal" {...form.register("estimatedHours")} />
          </Field>
          <Field label="Tags" error={errors.tags?.message} description="Comma-separated, e.g. backend, q4">
            <Input {...form.register("tags")} />
          </Field>
        </div>

        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />}
            {editing ? "Save changes" : "Create task"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
