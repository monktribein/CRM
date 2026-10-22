import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Access denied" };

export default function AccessDeniedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-workspace px-4 text-center">
      <Logo tone="dark" className="mb-10" />
      <div className="flex size-12 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
        <ShieldAlert className="size-6" aria-hidden="true" />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">You don&apos;t have access to this page</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Your role doesn&apos;t include permission to view this area. If you think this is a mistake, ask your administrator
        to review your role.
      </p>
      <div className="mt-6 flex gap-2">
        <Button asChild>
          <Link href="/dashboard">Go to overview</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/my-tasks">My tasks</Link>
        </Button>
      </div>
    </main>
  );
}
