"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Link2,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Send,
  UserPlus,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState } from "@/components/common/states";
import { UserAvatar, UserLabel } from "@/components/common/user-avatar";
import { DeadlineBadge, DueDate, PriorityBadge, ProgressBar, StatusBadge } from "@/components/tasks/task-badges";
import {
  AttachmentDialog,
  LogTimeDialog,
  ReassignDialog,
  ReviewDialog,
  SubmitReviewDialog,
} from "@/components/tasks/task-dialogs";
import { useTaskMutations } from "@/components/tasks/use-task-mutations";
import { tasksApi } from "@/lib/api/services";
import { formatBytes, formatDay, formatDateTime, formatHours, formatMinutes, formatRelative } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { statusMeta } from "@/lib/task-meta";
import type { TaskDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

type Mutations = ReturnType<typeof useTaskMutations>;

/* ---------------- Header actions ---------------- */

function TaskActions({ task, m, compact }: { task: TaskDetail; m: Mutations; compact?: boolean }) {
  const caps = task.capabilities;
  const [submitOpen, setSubmitOpen] = useState(false);
  const [review, setReview] = useState<"approve" | "request_changes" | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {caps.allowedStatuses.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={m.status.isPending}>
              {m.status.isPending ? <Loader2 className="animate-spin" /> : null}
              Change status <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>
            {caps.allowedStatuses.map((s) => {
              const Icon = statusMeta[s].icon;
              return (
                <DropdownMenuItem key={s} onSelect={() => m.status.mutate(s)}>
                  <Icon /> {statusMeta[s].label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {caps.canSubmitForReview && (
        <Button size="sm" onClick={() => setSubmitOpen(true)}>
          <Send /> Submit for review
        </Button>
      )}
      {caps.canReview && (
        <>
          <Button size="sm" onClick={() => setReview("approve")}>
            <CheckCircle2 /> Approve
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setReview("request_changes")}>
            <XCircle /> Request changes
          </Button>
        </>
      )}
      {caps.canEdit && !compact && (
        <Button size="sm" variant="ghost" asChild>
          <Link href={`/tasks/${task.id}/edit`}>
            <Pencil /> Edit
          </Link>
        </Button>
      )}
      <SubmitReviewDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        task={task}
        pending={m.submitForReview.isPending}
        onSubmit={(note) => m.submitForReview.mutateAsync(note)}
      />
      <ReviewDialog
        open={review !== null}
        onOpenChange={(o) => !o && setReview(null)}
        decision={review ?? "approve"}
        pending={m.approve.isPending || m.requestChanges.isPending}
        onApprove={(note) => m.approve.mutateAsync(note)}
        onRequestChanges={(note) => m.requestChanges.mutateAsync(note)}
      />
    </div>
  );
}

/* ---------------- Review banner ---------------- */

function ReviewBanner({ task }: { task: TaskDetail }) {
  const r = task.review;
  if (!r) return null;
  const styles = {
    pending: "border-sky-200 bg-sky-50 text-sky-900",
    approved: "border-emerald-200 bg-emerald-50 text-emerald-900",
    changes_requested: "border-amber-200 bg-amber-50 text-amber-900",
  }[r.state];
  const title = {
    pending: `Awaiting review — submitted by ${r.submittedBy.name} ${formatRelative(r.submittedAt)}`,
    approved: `Approved by ${r.reviewer?.name ?? "reviewer"} ${formatRelative(r.reviewedAt)}`,
    changes_requested: `Changes requested by ${r.reviewer?.name ?? "reviewer"} ${formatRelative(r.reviewedAt)}`,
  }[r.state];
  const note = r.state === "pending" ? r.submissionNote : r.reviewNote;
  return (
    <div className={cn("rounded-md border px-3 py-2.5 text-sm", styles)} role="status">
      <p className="font-medium">{title}</p>
      {note && <p className="mt-0.5 whitespace-pre-line opacity-90">“{note}”</p>}
    </div>
  );
}

/* ---------------- Progress ---------------- */

function ProgressControl({ task, m }: { task: TaskDetail; m: Mutations }) {
  const [value, setValue] = useState(task.progressPercentage);
  const dirty = value !== task.progressPercentage;
  if (!task.capabilities.canUpdateProgress) {
    return <ProgressBar value={task.progressPercentage} tone={task.status === "completed" ? "success" : "info"} label="Completion" />;
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer accent-primary"
          aria-label="Percentage completed"
          aria-valuetext={`${value}%`}
        />
        <span className="w-10 text-right text-sm font-medium tabular">{value}%</span>
      </div>
      {dirty && (
        <div className="flex gap-2">
          <Button size="xs" onClick={() => m.progress.mutate(value)} disabled={m.progress.isPending}>
            {m.progress.isPending && <Loader2 className="animate-spin" />} Save progress
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setValue(task.progressPercentage)}>
            Reset
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Checklist ---------------- */

function Checklist({ task, m }: { task: TaskDetail; m: Mutations }) {
  const [label, setLabel] = useState("");
  const editable = task.capabilities.canEditChecklist;
  return (
    <section aria-labelledby="checklist-heading">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="checklist-heading" className="text-sm font-semibold">
          Checklist
        </h2>
        {task.checklist.length > 0 && (
          <span className="text-xs text-muted-foreground tabular">
            {task.checklistDone} of {task.checklistTotal} done
          </span>
        )}
      </div>
      {task.checklist.length === 0 && !editable ? (
        <p className="text-sm text-muted-foreground">No checklist items.</p>
      ) : (
        <ul className="space-y-1">
          {task.checklist.map((item) => (
            <li key={item.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60">
                <Checkbox
                  checked={item.done}
                  disabled={!editable || m.toggleChecklistItem.isPending}
                  onCheckedChange={(c) => m.toggleChecklistItem.mutate({ itemId: item.id, done: c === true })}
                />
                <span className={cn("text-sm", item.done && "text-muted-foreground line-through")}>{item.label}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = label.trim();
            if (!v) return;
            m.addChecklistItem.mutate(v, { onSuccess: () => setLabel("") });
          }}
        >
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add an item…" className="h-8" aria-label="New checklist item" maxLength={200} />
          <Button type="submit" size="sm" variant="outline" disabled={!label.trim() || m.addChecklistItem.isPending}>
            <Plus /> Add
          </Button>
        </form>
      )}
    </section>
  );
}

/* ---------------- Tabs ---------------- */

function Comments({ task, m }: { task: TaskDetail; m: Mutations }) {
  const [body, setBody] = useState("");
  return (
    <div className="space-y-4">
      {task.comments.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No comments yet" description="Start the conversation about this task." className="py-6" />
      ) : (
        <ul className="space-y-4">
          {task.comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <UserAvatar user={c.author} size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium">{c.author.name}</span>{" "}
                  <time dateTime={c.createdAt} className="text-xs text-muted-foreground" title={formatDateTime(c.createdAt)}>
                    {formatRelative(c.createdAt)}
                  </time>
                </p>
                <p className="mt-0.5 text-sm whitespace-pre-line text-foreground/90">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {task.capabilities.canComment && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = body.trim();
            if (!text) return;
            m.comment.mutate(text, { onSuccess: () => setBody("") });
          }}
        >
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="Write a comment… Mention a teammate with @their-email"
            aria-label="New comment"
            maxLength={5000}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!body.trim() || m.comment.isPending}>
              {m.comment.isPending && <Loader2 className="animate-spin" />} Comment
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Attachments({ task, m }: { task: TaskDetail; m: Mutations }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      {task.attachments.length === 0 ? (
        <EmptyState icon={Paperclip} title="No attachments" className="py-6" />
      ) : (
        <ul className="divide-y rounded-md border">
          {task.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
              <Link2 className="size-4 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 truncate text-sm font-medium text-primary hover:underline">
                  {a.fileName} <ExternalLink className="size-3" aria-hidden="true" />
                  <span className="sr-only">(opens in new tab)</span>
                </a>
                <p className="text-xs text-muted-foreground">
                  {a.uploadedBy.name} · {formatRelative(a.createdAt)}
                  {a.sizeBytes ? ` · ${formatBytes(a.sizeBytes)}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {task.capabilities.canAttach && (
        <>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Paperclip /> Add attachment
          </Button>
          <AttachmentDialog open={open} onOpenChange={setOpen} onSubmit={(v) => m.attach.mutateAsync(v)} />
        </>
      )}
    </div>
  );
}

function TimeLog({ task, m }: { task: TaskDetail; m: Mutations }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
        <span>
          <span className="font-semibold tabular">{formatHours(task.actualHours)}</span>
          <span className="text-muted-foreground"> logged of {formatHours(task.estimatedHours)} estimated</span>
        </span>
        {task.capabilities.canLogTime && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Clock /> Log time
          </Button>
        )}
      </div>
      {task.timeEntries.length === 0 ? (
        <EmptyState icon={Clock} title="No time logged yet" className="py-6" />
      ) : (
        <ul className="divide-y rounded-md border">
          {task.timeEntries.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <UserAvatar user={e.user} />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{e.user.name}</span>
                {e.note && <span className="text-muted-foreground"> — {e.note}</span>}
              </span>
              <span className="text-xs text-muted-foreground">{formatDay(e.date, "MMM d")}</span>
              <span className="w-16 text-right font-medium tabular">{formatMinutes(e.minutes)}</span>
            </li>
          ))}
        </ul>
      )}
      <LogTimeDialog open={open} onOpenChange={setOpen} onSubmit={(v) => m.logTime.mutateAsync(v)} />
    </div>
  );
}

function History({ taskId }: { taskId: string }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: qk.taskActivity(taskId), queryFn: () => tasksApi.activity(taskId) });
  if (isLoading) return <Skeleton className="h-32" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data?.length) return <EmptyState title="No history yet" className="py-6" />;
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {data.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute top-1.5 -left-[25px] size-2 rounded-full bg-border ring-4 ring-card" aria-hidden="true" />
          <p className="text-sm">
            <span className="font-medium">{h.actor.name}</span> <span className="text-muted-foreground">{h.description}</span>
          </p>
          <time dateTime={h.createdAt} className="text-xs text-muted-foreground">
            {formatDateTime(h.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- Properties ---------------- */

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-start gap-3 py-2 text-sm">
      <dt className="pt-0.5 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Properties({ task, m }: { task: TaskDetail; m: Mutations }) {
  const [reassignOpen, setReassignOpen] = useState(false);
  return (
    <dl className="divide-y">
      <Property label="Status">
        <StatusBadge status={task.status} />
      </Property>
      <Property label="Priority">
        <PriorityBadge priority={task.priority} />
      </Property>
      <Property label="Deadline">
        <div className="flex flex-wrap items-center gap-2">
          <DueDate task={task} showLabel={false} />
          {!["completed", "cancelled"].includes(task.status) && <DeadlineBadge task={task} />}
        </div>
      </Property>
      <Property label="Assigned to">
        <div className="space-y-1.5">
          {task.assignedTo.map((a) => (
            <UserLabel key={a.id} user={a} />
          ))}
          {task.capabilities.canReassign && (
            <>
              <Button size="xs" variant="ghost" className="-ml-2" onClick={() => setReassignOpen(true)}>
                <UserPlus /> Reassign
              </Button>
              <ReassignDialog
                open={reassignOpen}
                onOpenChange={setReassignOpen}
                task={task}
                pending={m.assign.isPending}
                onSubmit={(ids) => m.assign.mutateAsync(ids)}
              />
            </>
          )}
        </div>
      </Property>
      <Property label="Assigned by">
        <UserLabel user={task.createdBy} />
      </Property>
      {task.sharedWith.length > 0 && (
        <Property label="Shared with">
          <div className="space-y-1.5">
            {task.sharedWith.map((u) => (
              <UserLabel key={u.id} user={u} />
            ))}
          </div>
        </Property>
      )}
      <Property label="Project">{task.projectName}</Property>
      <Property label="Department">{task.departmentName}</Property>
      <Property label="Start date">{formatDay(task.startDate)}</Property>
      <Property label="Due date">{formatDay(task.dueDate)}</Property>
      <Property label="Effort">
        <span className="tabular">
          <span className={cn(task.actualHours > task.estimatedHours && "font-medium text-amber-700")}>{formatHours(task.actualHours)}</span>{" "}
          actual / {formatHours(task.estimatedHours)} estimated
        </span>
      </Property>
      <Property label="Completed">
        <ProgressControl key={task.progressPercentage} task={task} m={m} />
      </Property>
      {task.tags.length > 0 && (
        <Property label="Tags">
          <div className="flex flex-wrap gap-1">
            {task.tags.map((t) => (
              <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        </Property>
      )}
      <Property label="Last updated">
        <span title={formatDateTime(task.updatedAt)}>{formatRelative(task.updatedAt)}</span>
      </Property>
    </dl>
  );
}

/* ---------------- View ---------------- */

export function TaskDetailView({ task, variant = "page" }: { task: TaskDetail; variant?: "page" | "drawer" }) {
  const m = useTaskMutations(task.id);
  const drawer = variant === "drawer";

  const tabs = (
    <Tabs defaultValue="comments">
      <TabsList>
        <TabsTrigger value="comments">Comments ({task.comments.length})</TabsTrigger>
        <TabsTrigger value="attachments">Files ({task.attachments.length})</TabsTrigger>
        <TabsTrigger value="time">Time</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="comments" className="pt-4"><Comments task={task} m={m} /></TabsContent>
      <TabsContent value="attachments" className="pt-4"><Attachments task={task} m={m} /></TabsContent>
      <TabsContent value="time" className="pt-4"><TimeLog task={task} m={m} /></TabsContent>
      <TabsContent value="history" className="pt-4"><History taskId={task.id} /></TabsContent>
    </Tabs>
  );

  const header = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">{task.key}</span>
        <span aria-hidden="true">·</span>
        <span>{task.projectName}</span>
      </div>
      <h1 className={cn("font-semibold tracking-tight", drawer ? "text-lg" : "text-xl")}>{task.title}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={task.status} />
        <PriorityBadge priority={task.priority} />
        {/* The status badge already says Completed / Cancelled for closed tasks. */}
        {!["completed", "cancelled"].includes(task.status) && <DeadlineBadge task={task} />}
      </div>
      <TaskActions task={task} m={m} compact={drawer} />
      <ReviewBanner task={task} />
    </div>
  );

  const description = (
    <section aria-labelledby="desc-heading">
      <h2 id="desc-heading" className="mb-1.5 text-sm font-semibold">Description</h2>
      {task.description ? (
        <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">{task.description}</p>
      ) : (
        <p className="text-sm text-muted-foreground">No description.</p>
      )}
    </section>
  );

  if (drawer) {
    return (
      <div className="space-y-6">
        {header}
        <div className="rounded-lg border px-3"><Properties task={task} m={m} /></div>
        {description}
        <Checklist task={task} m={m} />
        {tabs}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <div className="rounded-lg border bg-card p-5 shadow-xs">{header}</div>
        <div className="space-y-6 rounded-lg border bg-card p-5 shadow-xs">
          {description}
          <Checklist task={task} m={m} />
        </div>
        <div className="rounded-lg border bg-card p-5 shadow-xs">{tabs}</div>
      </div>
      <aside className="h-fit rounded-lg border bg-card px-4 py-2 shadow-xs lg:sticky lg:top-20" aria-label="Task properties">
        <Properties task={task} m={m} />
      </aside>
    </div>
  );
}
