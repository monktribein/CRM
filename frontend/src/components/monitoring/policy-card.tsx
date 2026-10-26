"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/common/states";
import { useAuth } from "@/components/providers/auth-provider";
import { getErrorMessage } from "@/lib/api/client";
import { monitoringApi } from "@/lib/api/services";
import { qk } from "@/lib/query-keys";
import type { MonitoringPolicy } from "@/lib/types";


/** Organisation monitoring policy: enablement, notice, version and retention. */
export function PolicyCard() {
  const { can } = useAuth();
  const canManage = can("monitoring.manage");
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: qk.monitoringPolicy(), queryFn: monitoringApi.policy });
  // Unsaved edits layered over the server copy.
  const [edits, setEdits] = useState<Partial<MonitoringPolicy>>({});
  const draft = data ? { ...data, ...edits } : null;
  const setDraft = (next: MonitoringPolicy) => setEdits(next);

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (p: MonitoringPolicy) =>
      monitoringApi.updatePolicy({
        enabled: p.enabled,
        policyVersion: p.policyVersion,
        policyText: p.policyText,
        retentionDays: p.retentionDays,
        localRetentionHours: p.localRetentionHours,
      }),
    onSuccess: (p) => {
      qc.setQueryData(qk.monitoringPolicy(), p);
      setEdits({});
      void qc.invalidateQueries({ queryKey: qk.monitoring });
      toast.success("Monitoring policy saved");
    },
    onError: (e) => toast.error("Couldn't save the policy", { description: getErrorMessage(e) }),
  });

  if (error) return <div className="rounded-lg border bg-card"><ErrorState error={error} onRetry={() => refetch()} /></div>;
  if (!draft) return <Skeleton className="h-40 rounded-lg" />;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const versionChanged = draft.policyVersion !== data?.policyVersion;

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4 shadow-xs" aria-labelledby="policy-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="policy-heading" className="text-sm font-semibold">Organisation policy</h2>
        <Badge variant={data!.enabled ? "default" : "outline"}>{data!.enabled ? "Enabled" : "Disabled"}</Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_1fr]">
        <div className="flex items-center gap-2">
          <Switch id="mon-enabled" checked={draft.enabled} disabled={!canManage} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />
          <Label htmlFor="mon-enabled">Monitoring enabled for enrolled employees</Label>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mon-retention">Keep screenshots (days)</Label>
          <Input id="mon-retention" type="number" min={1} max={3650} className="h-8 w-32" disabled={!canManage} value={draft.retentionDays} onChange={(e) => setDraft({ ...draft, retentionDays: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="mon-local">Discard unsent browser copies after (hours)</Label>
          <Input id="mon-local" type="number" min={1} max={720} className="h-8 w-32" disabled={!canManage} value={draft.localRetentionHours} onChange={(e) => setDraft({ ...draft, localRetentionHours: Number(e.target.value) })} />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
        <div className="space-y-1">
          <Label htmlFor="mon-version">Policy version</Label>
          <Input id="mon-version" className="h-8" maxLength={20} disabled={!canManage} value={draft.policyVersion} onChange={(e) => setDraft({ ...draft, policyVersion: e.target.value })} />
          {versionChanged && <p className="text-xs text-muted-foreground">Changing the version asks every enrolled employee to consent again.</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="mon-text">Notice shown to employees</Label>
          <Textarea id="mon-text" rows={3} maxLength={5000} disabled={!canManage} value={draft.policyText} onChange={(e) => setDraft({ ...draft, policyText: e.target.value })} placeholder="Why monitoring is used, who can see screenshots, and how long they are kept." />
        </div>
      </div>
      {canManage && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => setEdits({})}>Reset</Button>
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
            {save.isPending && <Loader2 className="animate-spin" />} Save policy
          </Button>
        </div>
      )}
    </section>
  );
}

