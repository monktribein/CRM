"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/common/field";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { useAssignableUsers } from "@/hooks/use-lookups";
import { toDateInput } from "@/lib/format";
import type { TaskDetail } from "@/lib/types";

/** Runs an action; errors are already toasted by the global mutation handler. */
async function attempt(fn: () => Promise<unknown>) {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ---------------- Submit for review ---------------- */

export function SubmitReviewDialog({
  open,
  onOpenChange,
  task,
  onSubmit,
  pending,
}: BaseProps & { task: TaskDetail; onSubmit: (note?: string) => Promise<unknown>; pending: boolean }) {
  const [note, setNote] = useState("");
  const openItems = task.checklist.filter((c) => !c.done).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit for review</DialogTitle>
          <DialogDescription>
            {task.createdBy.name} will be asked to approve {task.key} or request changes. Progress will be set to 100%.
          </DialogDescription>
        </DialogHeader>
        {openItems > 0 && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {openItems} checklist item{openItems > 1 ? "s are" : " is"} still open.
          </p>
        )}
        <Field label="Note for reviewer" description="Optional — summarise what was done.">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={pending}
            onClick={async () => {
              if (!(await attempt(() => onSubmit(note.trim() || undefined)))) return;
              setNote("");
              onOpenChange(false);
            }}
          >
            {pending && <Loader2 className="animate-spin" />} Submit for review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Review decision ---------------- */

export function ReviewDialog({
  open,
  onOpenChange,
  decision,
  onApprove,
  onRequestChanges,
  pending,
}: BaseProps & {
  decision: "approve" | "request_changes";
  onApprove: (note?: string) => Promise<unknown>;
  onRequestChanges: (note: string) => Promise<unknown>;
  pending: boolean;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const approving = decision === "approve";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{approving ? "Approve task" : "Request changes"}</DialogTitle>
          <DialogDescription>
            {approving
              ? "The task will be marked Completed and the assignees notified."
              : "The task returns to In Progress and the assignees are notified with your feedback."}
          </DialogDescription>
        </DialogHeader>
        <Field label={approving ? "Comment" : "What needs to change?"} required={!approving} error={error ?? undefined}>
          <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={approving ? "default" : "destructive"}
            disabled={pending}
            onClick={async () => {
              const text = note.trim();
              if (!approving && !text) {
                setError("Explain what needs to change.");
                return;
              }
              setError(null);
              if (!(await attempt(() => (approving ? onApprove(text || undefined) : onRequestChanges(text))))) return;
              setNote("");
              onOpenChange(false);
            }}
          >
            {pending && <Loader2 className="animate-spin" />}
            {approving ? "Approve & complete" : "Request changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Log time ---------------- */

const timeSchema = z
  .object({
    hours: z.coerce.number<string>().int().min(0).max(24),
    minutes: z.coerce.number<string>().int().min(0).max(59),
    date: z.string().min(1, "Pick a date."),
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.hours * 60 + v.minutes > 0, { path: ["minutes"], message: "Enter a duration." })
  .refine((v) => v.hours * 60 + v.minutes <= 24 * 60, { path: ["hours"], message: "Max 24 hours per entry." });

type TimeInput = z.input<typeof timeSchema>;
type TimeOutput = z.output<typeof timeSchema>;

export function LogTimeDialog({
  open,
  onOpenChange,
  onSubmit,
}: BaseProps & { onSubmit: (entry: { minutes: number; date: string; note?: string }) => Promise<unknown> }) {
  const form = useForm<TimeInput, unknown, TimeOutput>({
    resolver: zodResolver(timeSchema),
    defaultValues: { hours: "1", minutes: "0", date: toDateInput(new Date()), note: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    if (!(await attempt(() => onSubmit({ minutes: v.hours * 60 + v.minutes, date: v.date, note: v.note || undefined })))) return;
    form.reset();
    onOpenChange(false);
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Log time</DialogTitle>
            <DialogDescription>Record time spent on this task. Actual effort updates automatically.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Hours" error={errors.hours?.message}>
              <Input type="number" min={0} max={24} inputMode="numeric" {...form.register("hours")} />
            </Field>
            <Field label="Minutes" error={errors.minutes?.message}>
              <Input type="number" min={0} max={59} step={5} inputMode="numeric" {...form.register("minutes")} />
            </Field>
            <Field label="Date" error={errors.date?.message}>
              <Input type="date" max={toDateInput(new Date())} {...form.register("date")} />
            </Field>
          </div>
          <Field label="Note" description="Optional">
            <Input placeholder="What did you work on?" {...form.register("note")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />} Log time
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Reassign ---------------- */

export function ReassignDialog({
  open,
  onOpenChange,
  task,
  onSubmit,
  pending,
}: BaseProps & { task: TaskDetail; onSubmit: (ids: string[]) => Promise<unknown>; pending: boolean }) {
  const { data: users = [], isLoading } = useAssignableUsers(open);
  const [ids, setIds] = useState(() => task.assignedTo.map((a) => a.id));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reassign {task.key}</DialogTitle>
          <DialogDescription>Only active employees you&apos;re permitted to assign are listed. New assignees are notified.</DialogDescription>
        </DialogHeader>
        <AssigneePicker options={users} value={ids} onChange={setIds} loading={isLoading} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={pending || ids.length === 0}
            onClick={async () => {
              if (await attempt(() => onSubmit(ids))) onOpenChange(false);
            }}
          >
            {pending && <Loader2 className="animate-spin" />} Save assignees
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Attachment ---------------- */

const attachmentSchema = z.object({
  fileName: z.string().trim().min(1, "Give the attachment a name.").max(200),
  url: z.string().trim().url("Enter a valid URL.").startsWith("https://", "Use a secure https:// link."),
});

export function AttachmentDialog({
  open,
  onOpenChange,
  onSubmit,
}: BaseProps & { onSubmit: (input: { fileName: string; url: string }) => Promise<unknown> }) {
  const form = useForm<z.infer<typeof attachmentSchema>>({
    resolver: zodResolver(attachmentSchema),
    defaultValues: { fileName: "", url: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    if (!(await attempt(() => onSubmit(v)))) return;
    form.reset();
    onOpenChange(false);
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add attachment</DialogTitle>
            <DialogDescription>
              Link a file from your organisation&apos;s document storage (e.g. Drive, SharePoint, S3). Bizwoke Nova stores the link and metadata.
            </DialogDescription>
          </DialogHeader>
          <Field label="Name" error={errors.fileName?.message} required>
            <Input placeholder="Requirements v2.pdf" {...form.register("fileName")} />
          </Field>
          <Field label="Link" error={errors.url?.message} required>
            <Input type="url" placeholder="https://" {...form.register("url")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />} Add attachment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
