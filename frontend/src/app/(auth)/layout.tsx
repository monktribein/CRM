import { CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/brand/logo";

const POINTS = [
  "Assign, track and review work across every department",
  "Role-aware dashboards for admins, managers and employees",
  "Deadline risk surfaced before it becomes overdue",
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <Logo />
        <div className="relative z-10 max-w-md">
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            One workspace for every team&apos;s tasks.
          </h2>
          <ul className="mt-6 space-y-3 text-sm">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-2.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-indigo-300" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-sidebar-muted">Accounts are created by your organisation&apos;s administrator.</p>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full border border-sidebar-border"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 -bottom-8 size-64 rounded-full border border-sidebar-border"
        />
      </aside>
      <main className="flex items-center justify-center bg-background px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <Logo tone="dark" className="mb-8 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
