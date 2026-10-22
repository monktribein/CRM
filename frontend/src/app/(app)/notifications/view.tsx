"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertOctagon,
  Bell,
  CheckCheck,
  CheckCircle2,
  Clock,
  Eye,
  AtSign,
  MessageSquare,
  RotateCcw,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { EmptyState, ErrorState } from "@/components/common/states";
import { useUnreadCount } from "@/components/layout/sidebar";
import { notificationsApi } from "@/lib/api/services";
import { formatDateTime, formatRelative } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { NotificationType } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS: Record<NotificationType, { icon: LucideIcon; className: string }> = {
  task_assigned: { icon: UserPlus, className: "bg-indigo-50 text-indigo-600" },
  task_reassigned: { icon: UserPlus, className: "bg-indigo-50 text-indigo-600" },
  task_due_soon: { icon: Clock, className: "bg-amber-50 text-amber-600" },
  task_overdue: { icon: AlertOctagon, className: "bg-red-50 text-red-600" },
  review_requested: { icon: Eye, className: "bg-sky-50 text-sky-600" },
  review_approved: { icon: CheckCircle2, className: "bg-emerald-50 text-emerald-600" },
  changes_requested: { icon: RotateCcw, className: "bg-amber-50 text-amber-600" },
  comment: { icon: MessageSquare, className: "bg-slate-100 text-slate-600" },
  mention: { icon: AtSign, className: "bg-indigo-50 text-indigo-600" },
  system: { icon: Bell, className: "bg-slate-100 text-slate-600" },
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const { data: unread = 0 } = useUnreadCount();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.notificationList(unreadOnly, page),
    queryFn: () => notificationsApi.list({ unreadOnly, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: qk.notifications });
  const markAll = useMutation({ mutationFn: notificationsApi.markAllRead, onSuccess: refresh });
  const markOne = useMutation({ mutationFn: notificationsApi.markRead, onSuccess: refresh });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Assignments, deadlines, reviews and mentions."
        actions={
          <Button variant="outline" onClick={() => markAll.mutate()} disabled={!unread || markAll.isPending}>
            <CheckCheck /> Mark all as read
          </Button>
        }
      />
      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <div className="border-b p-3">
          <Tabs value={unreadOnly ? "unread" : "all"} onValueChange={(v) => { setUnreadOnly(v === "unread"); setPage(1); }}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="unread">Unread {unread > 0 && <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-white tabular">{unread}</span>}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {isLoading ? (
          <div className="space-y-3 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data?.items.length ? (
          <EmptyState icon={Bell} title={unreadOnly ? "No unread notifications" : "No notifications yet"} description="You're all caught up." />
        ) : (
          <>
            <ul className="divide-y">
              {data.items.map((n) => {
                const meta = ICONS[n.type];
                return (
                  <li key={n.id} className={cn("flex items-start gap-3 px-4 py-3.5", !n.read && "bg-accent/30")}>
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", meta.className)}>
                      <meta.icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {n.title}
                        {!n.read && <span className="ml-2 inline-block size-1.5 rounded-full bg-primary align-middle" aria-label="Unread" />}
                      </p>
                      <p className="text-sm text-muted-foreground">{n.body}</p>
                      <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)} className="text-xs text-muted-foreground">{formatRelative(n.createdAt)}</time>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {n.link && (
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={n.link} onClick={() => !n.read && markOne.mutate(n.id)}>Open</Link>
                        </Button>
                      )}
                      {!n.read && (
                        <Button variant="ghost" size="sm" onClick={() => markOne.mutate(n.id)}>Mark read</Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
