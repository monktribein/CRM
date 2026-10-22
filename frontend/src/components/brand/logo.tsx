import { cn } from "@/lib/utils";

/** Geometric mark: two offset squares forming a stylised "N" spark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="8" fill="#4f46e5" />
      <path d="M9 23V9l14 14V9" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="23" cy="9" r="2.2" fill="#a5b4fc" />
    </svg>
  );
}

export function Logo({
  collapsed = false,
  tone = "light",
  className,
}: {
  collapsed?: boolean;
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      {!collapsed && (
        <span
          className={cn(
            "text-[15px] font-semibold tracking-tight whitespace-nowrap",
            tone === "light" ? "text-white" : "text-foreground"
          )}
        >
          Bizwoke <span className={tone === "light" ? "text-indigo-300" : "text-primary"}>Nova</span>
        </span>
      )}
    </div>
  );
}
