import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { initials } from "@/lib/format";
import type { UserRef } from "@/lib/types";
import { cn } from "@/lib/utils";

const PALETTE = [
  "bg-indigo-100 text-indigo-700",
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-700",
  "bg-violet-100 text-violet-700",
  "bg-teal-100 text-teal-700",
];

function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const sizes = { xs: "size-5 text-[9px]", sm: "size-6 text-[10px]", md: "size-8 text-xs", lg: "size-10 text-sm" };

export function UserAvatar({
  user,
  size = "sm",
  className,
}: {
  user: Pick<UserRef, "id" | "name" | "avatarUrl">;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <Avatar className={cn(sizes[size], className)}>
      {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
      <AvatarFallback className={cn("font-semibold", colorFor(user.id))}>{initials(user.name)}</AvatarFallback>
    </Avatar>
  );
}

export function UserStack({ users, max = 3 }: { users: UserRef[]; max?: number }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-1.5">
        {shown.map((u) => (
          <Tooltip key={u.id}>
            <TooltipTrigger asChild>
              <span className="rounded-full ring-2 ring-card">
                <UserAvatar user={u} />
              </span>
            </TooltipTrigger>
            <TooltipContent>{u.name}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      {extra > 0 && <span className="ml-1.5 text-xs text-muted-foreground">+{extra}</span>}
      <span className="sr-only">{users.map((u) => u.name).join(", ")}</span>
    </div>
  );
}

export function UserLabel({ user, size = "sm" }: { user: UserRef; size?: keyof typeof sizes }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <UserAvatar user={user} size={size} />
      <span className="truncate">{user.name}</span>
    </span>
  );
}
