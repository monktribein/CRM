"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Search, Send, UserMinus, UserPlus, UserCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { EmptyState, ErrorState } from "@/components/common/states";
import { UserAvatar } from "@/components/common/user-avatar";
import { useAuth, useCurrentUser } from "@/components/providers/auth-provider";
import { AccountStatusBadge, RoleBadge } from "@/components/employees/employee-badges";
import { EditEmployeeDialog } from "@/components/employees/edit-employee-dialog";
import { InvitationOutcome } from "@/components/employees/invitation-link";
import { useDebounce } from "@/hooks/use-debounce";
import { useDepartments } from "@/hooks/use-lookups";
import { usersApi } from "@/lib/api/services";
import { formatDay } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { ROLE_ORDER, grantableRoles, jobFunctionLabels, roleMeta } from "@/lib/roles";
import type { AccountStatus, Employee, EmployeeQuery, InvitationResult, Role } from "@/lib/types";

const ALL = "__all__";

export function EmployeeDirectory() {
  const me = useCurrentUser();
  const { can } = useAuth();
  const canManage = can("employees.manage");
  const qc = useQueryClient();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const departments = useDepartments();

  const [search, setSearch] = useState(params.get("search") ?? "");
  const debounced = useDebounce(search, 300);
  const query: EmployeeQuery = {
    search: debounced || undefined,
    departmentId: params.get("departmentId") ?? undefined,
    role: params.get("role") ? [params.get("role") as Role] : undefined,
    status: (params.get("status") as AccountStatus | null) ?? undefined,
    page: Number(params.get("page") ?? 1),
    pageSize: Number(params.get("pageSize") ?? 20),
  };

  const setParam = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === ALL) next.delete(k);
      else next.set(k, String(v));
    }
    if (!("page" in patch)) next.delete("page");
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  useEffect(() => {
    if ((params.get("search") ?? "") !== debounced) setParam({ search: debounced || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: qk.userList(query),
    queryFn: () => usersApi.list(query),
    placeholderData: keepPreviousData,
  });

  const [editing, setEditing] = useState<Employee | null>(null);
  const [confirm, setConfirm] = useState<{ employee: Employee; action: "deactivate" | "reactivate" | "remove" } | null>(null);
  const [invite, setInvite] = useState<InvitationResult | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.users });

  const statusChange = useMutation({
    mutationFn: async ({ employee, action }: { employee: Employee; action: "deactivate" | "reactivate" | "remove" }) => {
      if (action === "remove") await usersApi.remove(employee.id);
      else await usersApi.setStatus(employee.id, action === "deactivate" ? "deactivated" : "active");
    },
    onSuccess: (_d, { employee, action }) => {
      void invalidate();
      toast.success(
        action === "remove" ? `${employee.name} removed` : `${employee.name} ${action === "deactivate" ? "deactivated" : "reactivated"}`
      );
    },
  });
  const resend = useMutation({
    mutationFn: (e: Employee) => usersApi.resendInvitation(e.id),
    onSuccess: (r) => {
      void invalidate();
      setInvite(r);
    },
  });

  const manageable = (e: Employee) => canManage && e.id !== me.id && grantableRoles(me.role).includes(e.role);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employees"
        description="Directory of everyone in your organisation. Accounts are created by administrators only."
        actions={
          canManage && (
            <Button asChild>
              <Link href="/employees/new">
                <UserPlus /> Add employee
              </Link>
            </Button>
          )
        }
      />

      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email or ID" className="h-8 pl-8" aria-label="Search employees" />
          </div>
          <Select value={query.departmentId ?? ALL} onValueChange={(v) => setParam({ departmentId: v })}>
            <SelectTrigger size="sm" className="min-w-36" aria-label="Department"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All departments</SelectItem>
              {(departments.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={params.get("role") ?? ALL} onValueChange={(v) => setParam({ role: v })}>
            <SelectTrigger size="sm" className="min-w-32" aria-label="Role"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All roles</SelectItem>
              {ROLE_ORDER.map((r) => <SelectItem key={r} value={r}>{roleMeta[r].label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={query.status ?? ALL} onValueChange={(v) => setParam({ status: v })}>
            <SelectTrigger size="sm" className="min-w-32" aria-label="Account status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="invited">Invited</SelectItem>
              <SelectItem value="deactivated">Deactivated</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !isLoading && !data?.items.length ? (
          <EmptyState icon={Users} title="No employees found" description="Try a different search or filter." />
        ) : (
          <div className={isFetching && !isLoading ? "opacity-60 transition-opacity" : undefined}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <caption className="sr-only">Employees</caption>
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2.5 pr-3 pl-4 font-medium">Employee</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">ID</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Department</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Role</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Manager</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Joined</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Open tasks</th>
                    <th scope="col" className="w-12 py-2.5 pr-4 pl-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-b"><td colSpan={9} className="px-4 py-3"><Skeleton className="h-7" /></td></tr>
                      ))
                    : data!.items.map((e) => (
                        <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2.5 pr-3 pl-4">
                            <div className="flex items-center gap-3">
                              <UserAvatar user={e} size="md" />
                              <div className="min-w-0">
                                <p className="truncate font-medium">{e.name}</p>
                                <p className="truncate text-xs text-muted-foreground">{e.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{e.employeeId}</td>
                          <td className="px-3 py-2.5">
                            <p>{e.departmentName ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">{e.title ?? jobFunctionLabels[e.jobFunction]}</p>
                          </td>
                          <td className="px-3 py-2.5"><RoleBadge role={e.role} /></td>
                          <td className="px-3 py-2.5 text-muted-foreground">{e.managerName ?? "—"}</td>
                          <td className="px-3 py-2.5"><AccountStatusBadge status={e.status} /></td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatDay(e.joinDate)}</td>
                          <td className="px-3 py-2.5 text-right tabular">{e.assignedTaskCount}</td>
                          <td className="py-2.5 pr-4 pl-3 text-right">
                            {canManage && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${e.name}`}><MoreHorizontal /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onSelect={() => setEditing(e)}><Pencil /> Edit role & department</DropdownMenuItem>
                                  {e.status === "invited" && (
                                    <DropdownMenuItem onSelect={() => resend.mutate(e)}><Send /> Re-issue invitation</DropdownMenuItem>
                                  )}
                                  {manageable(e) && (
                                    <>
                                      <DropdownMenuSeparator />
                                      {e.status === "deactivated" ? (
                                        <DropdownMenuItem onSelect={() => setConfirm({ employee: e, action: "reactivate" })}><UserCheck /> Reactivate</DropdownMenuItem>
                                      ) : e.status === "active" ? (
                                        <DropdownMenuItem onSelect={() => setConfirm({ employee: e, action: "deactivate" })}><UserMinus /> Deactivate</DropdownMenuItem>
                                      ) : null}
                                      <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({ employee: e, action: "remove" })}>
                                        <UserMinus /> Remove from directory
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            {data && (
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={(p) => setParam({ page: p })} onPageSizeChange={(s) => setParam({ pageSize: s })} />
            )}
          </div>
        )}
      </div>

      <EditEmployeeDialog employee={editing} onOpenChange={(o) => !o && setEditing(null)} />

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === "remove" ? "Remove" : confirm?.action === "deactivate" ? "Deactivate" : "Reactivate"} {confirm?.employee.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.action === "deactivate" && "They will be signed out and unable to log in. Their tasks and history are kept."}
              {confirm?.action === "reactivate" && "They will be able to sign in again with their existing password."}
              {confirm?.action === "remove" &&
                "The account is deactivated and hidden from the directory. Task history and audit logs are preserved for integrity."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm?.action === "reactivate" ? "default" : "destructive"}
              onClick={() => confirm && statusChange.mutate(confirm)}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!invite} onOpenChange={(o) => !o && setInvite(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invitation re-issued</DialogTitle>
            <DialogDescription>Any previous invitation link for this account no longer works.</DialogDescription>
          </DialogHeader>
          {invite && <InvitationOutcome result={invite} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
