import { CheckCircle2, MailQuestion, MinusCircle, ShieldCheck } from "lucide-react";
import { roleMeta } from "@/lib/roles";
import { toneClasses, type Tone } from "@/lib/task-meta";
import type { AccountStatus, Role } from "@/lib/types";
import { cn } from "@/lib/utils";

const statusMetaMap: Record<AccountStatus, { label: string; tone: Tone; icon: typeof CheckCircle2 }> = {
  active: { label: "Active", tone: "success", icon: CheckCircle2 },
  invited: { label: "Invited", tone: "warning", icon: MailQuestion },
  deactivated: { label: "Deactivated", tone: "muted", icon: MinusCircle },
};

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const m = statusMetaMap[status];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium ring-1 ring-inset", toneClasses[m.tone])}>
      <m.icon className="size-3.5" aria-hidden="true" />
      {m.label}
    </span>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  const privileged = role === "admin" || role === "super_admin";
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        privileged ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : "bg-slate-50 text-slate-700 ring-slate-200"
      )}
    >
      {privileged && <ShieldCheck className="size-3.5" aria-hidden="true" />}
      {roleMeta[role].label}
    </span>
  );
}
