"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Loader2, MonitorUp, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCurrentUser } from "@/components/providers/auth-provider";
import { getErrorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { monitoringRuntime } from "@/lib/monitoring/runtime";
import type { ConsentDecision } from "@/lib/types";

export function useMonitoring() {
  return useSyncExternalStore(monitoringRuntime.subscribe, monitoringRuntime.getState, monitoringRuntime.getServerState);
}

/**
 * Starts the monitoring workflow for the signed-in employee: checks the
 * organisation policy and recorded consent, asks for consent when needed and
 * prompts for a fresh screen-sharing grant. Rendered inside the app shell.
 */
export function MonitoringProvider({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser();
  const state = useMonitoring();

  useEffect(() => {
    void monitoringRuntime.init(user.id);
  }, [user.id]);

  return (
    <>
      {children}
      <ConsentDialog open={state.phase === "needs_consent"} />
    </>
  );
}

function ConsentDialog({ open }: { open: boolean }) {
  const { status } = useMonitoring();
  const [busy, setBusy] = useState<ConsentDecision | null>(null);

  const decide = async (decision: ConsentDecision) => {
    setBusy(decision);
    try {
      if (decision === "granted") {
        // Agreeing records consent and opens the browser's screen-share prompt
        // in the same click — no separate "Start screen sharing" step.
        await monitoringRuntime.start({ grantConsent: true });
      } else {
        await monitoringRuntime.consent(decision);
      }
    } catch (error) {
      toast.error("Couldn't save your decision", { description: getErrorMessage(error) });
      await monitoringRuntime.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg" onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldAlert className="size-5 text-primary" aria-hidden="true" /> Screen monitoring notice</DialogTitle>
          <DialogDescription>
            Your organisation has enabled screen monitoring for your account (policy version {status?.policy?.version}).
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 space-y-3 overflow-y-auto rounded-md border bg-muted/40 p-3 text-sm">
          {status?.policy?.text ? <p className="whitespace-pre-wrap">{status.policy.text}</p> : null}
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>While you are signed in and sharing your screen, a screenshot is taken every {Math.round((status?.captureIntervalSeconds ?? 300) / 60)} minutes.</li>
            <li>When you agree, your browser will ask which screen to share — choose <strong>Entire screen</strong>. It asks again each time you sign in, and shows its own indicator while sharing. No audio is recorded.</li>
            <li>Screenshots are stored securely in your organisation&apos;s CRM database and visible only to authorised administrators and your managers.</li>
            <li>Capture stops when you sign out, close the browser or stop sharing.</li>
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={!!busy} onClick={() => decide("declined")}>
            {busy === "declined" && <Loader2 className="animate-spin" />} Decline
          </Button>
          <Button disabled={!!busy} onClick={() => decide("granted")}>
            {busy === "granted" && <Loader2 className="animate-spin" />} I understand and agree
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Small, persistent dot in the corner of the screen whenever monitoring
 * applies to the signed-in user. Click it for details and controls — it
 * never shows text on its own, so it stays out of the way of normal work.
 */
export function MonitoringBanner() {
  const state = useMonitoring();
  if (state.phase === "off" || state.phase === "needs_consent") return null;

  const minutes = Math.round((state.status?.captureIntervalSeconds ?? 300) / 60);
  const color =
    state.phase === "active"
      ? "bg-red-500"
      : state.phase === "starting"
        ? "bg-amber-500"
        : "bg-amber-500";
  const label =
    state.phase === "active"
      ? "Screen monitoring is active"
      : state.phase === "starting"
        ? "Waiting for screen-sharing permission"
        : "Screen monitoring needs attention";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="fixed bottom-4 right-4 z-50 flex size-4 items-center justify-center rounded-full"
        >
          <span className="relative flex size-3" aria-hidden="true">
            {state.phase === "active" && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
            )}
            <span className={`relative inline-flex size-3 rounded-full ring-2 ring-background ${color}`} />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm">
        {state.phase === "active" && (
          <div className="space-y-2">
            <p className="font-medium">Screen monitoring is active</p>
            <p className="text-muted-foreground">
              A screenshot is taken every {minutes} minutes
              {state.lastCaptureAt ? ` · last ${formatDateTime(state.lastCaptureAt)}` : ""}
              {state.pending ? ` · ${state.pending} waiting to upload` : ""}
              {!state.durable ? " · offline queue unavailable in this browser" : ""}
            </p>
            <Button size="xs" variant="outline" onClick={() => void monitoringRuntime.stop("user_stopped")}>
              Stop sharing
            </Button>
          </div>
        )}
        {state.phase === "starting" && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Waiting for screen-sharing permission…
          </div>
        )}
        {state.phase === "unsupported" && (
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>Screen monitoring is required for your account, but this browser doesn&apos;t support screen sharing. Please use a current desktop version of Chrome, Edge or Firefox.</span>
          </div>
        )}
        {state.phase === "declined" && (
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>You declined screen monitoring (policy v{state.status?.policy?.version}). Your administrator can see this decision.</span>
          </div>
        )}
        {state.phase === "needs_permission" && (
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
              <span>{state.notice ?? "Screen monitoring is required for your account and is not running."}</span>
            </div>
            <Button size="xs" onClick={() => void monitoringRuntime.start()}>
              <MonitorUp /> Start screen sharing
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
