"use client";

import { useState } from "react";
import { Check, Copy, MailCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InvitationResult } from "@/lib/types";

/** Shows the honest outcome of an invitation: emailed, or a link to share. */
export function InvitationOutcome({ result }: { result: InvitationResult }) {
  const [copied, setCopied] = useState(false);
  if (result.emailSent) {
    return (
      <div className="flex gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          An invitation email was sent to <span className="font-medium">{result.user.email}</span>. The account stays in the
          <span className="font-medium"> Invited</span> state until they set a password.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Email delivery isn&apos;t configured, so no email was sent. Share this one-time activation link with{" "}
          <span className="font-medium">{result.user.name}</span> through a secure channel. It expires and can&apos;t be shown again.
        </span>
      </p>
      {result.invitationUrl && (
        <div className="flex gap-2">
          <Input readOnly value={result.invitationUrl} className="h-8 bg-white font-mono text-xs" aria-label="Activation link" onFocus={(e) => e.target.select()} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="bg-white"
            onClick={async () => {
              await navigator.clipboard.writeText(result.invitationUrl!);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
    </div>
  );
}
