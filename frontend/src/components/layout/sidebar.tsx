"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/components/providers/auth-provider";
import { NAV_FOOTER, NAV_SECTIONS, type NavItem } from "@/components/layout/nav";
import { notificationsApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  if (href === "/tasks") return pathname === "/tasks" || pathname === "/tasks/new";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function useUnreadCount() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.unreadCount(),
    queryFn: notificationsApi.unreadCount,
    enabled: status === "authenticated",
    refetchInterval: 60_000,
    select: (d) => d.count,
  });
}

function NavLink({
  item,
  collapsed,
  active,
  badge,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-3 rounded-md px-2.5 text-[13px] font-medium outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        collapsed && "justify-center px-0"
      )}
    >
      {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sidebar-primary" aria-hidden="true" />}
      <Icon className={cn("size-[18px] shrink-0", active ? "text-white" : "text-sidebar-muted group-hover:text-white")} aria-hidden="true" />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!!badge && badge > 0 && (
        <span
          className={cn(
            "rounded-full bg-sidebar-primary px-1.5 text-[10px] font-semibold leading-4 text-white tabular",
            collapsed ? "absolute top-1 right-1" : "ml-auto"
          )}
        >
          {badge > 99 ? "99+" : badge}
          <span className="sr-only"> unread</span>
        </span>
      )}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

export function SidebarContent({
  collapsed,
  onToggle,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { canAny, user } = useAuth();
  const { data: unread } = useUnreadCount();
  const visible = (item: NavItem) => !item.any || canAny(item.any);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn("flex h-14 shrink-0 items-center border-b border-sidebar-border px-4", collapsed && "justify-center px-0")}>
        <Link href="/dashboard" aria-label="Bizwoke Nova — Overview" onClick={onNavigate} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <Logo collapsed={collapsed} />
        </Link>
      </div>

      <nav aria-label="Main" className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section, i) => {
          const items = section.items.filter(visible);
          if (!items.length) return null;
          return (
            <div key={section.label ?? i}>
              {section.label && !collapsed && (
                <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">{section.label}</p>
              )}
              {section.label && collapsed && <div className="mx-2 mb-2 border-t border-sidebar-border" aria-hidden="true" />}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} collapsed={collapsed} active={isActive(pathname, item.href)} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="space-y-0.5 border-t border-sidebar-border px-3 py-3">
        {NAV_FOOTER.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            collapsed={collapsed}
            active={isActive(pathname, item.href)}
            badge={item.href === "/notifications" ? unread : undefined}
            onNavigate={onNavigate}
          />
        ))}
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              "mt-1 flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-[13px] text-sidebar-muted outline-none hover:bg-sidebar-accent/60 hover:text-white focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              collapsed && "justify-center px-0"
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight className="size-[18px]" /> : <ChevronsLeft className="size-[18px]" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        )}
        {!collapsed && user && (
          <p className="truncate px-2.5 pt-2 text-[11px] text-sidebar-muted">{user.organizationName}</p>
        )}
      </div>
    </div>
  );
}
