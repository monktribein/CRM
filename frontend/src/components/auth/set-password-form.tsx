"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { getErrorMessage } from "@/lib/api/client";
import { setPasswordSchema } from "@/lib/validation";

type Values = z.infer<typeof setPasswordSchema>;

/** Shared by reset-password and accept-invitation: token comes from ?token=. */
export function SetPasswordForm({
  title,
  description,
  submitLabel,
  successTitle,
  successDescription,
  onSubmit,
}: {
  title: string;
  description: string;
  submitLabel: string;
  successTitle: string;
  successDescription: string;
  onSubmit: (token: string, password: string) => Promise<void>;
}) {
  const token = useSearchParams().get("token");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(setPasswordSchema), defaultValues: { password: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;

  if (!token) {
    return (
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Link is invalid</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          This link is missing its security token. Open the link from your email again, or request a new one.
        </p>
        <Button variant="outline" className="mt-6 w-full" asChild>
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <div>
        <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="size-5" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{successTitle}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{successDescription}</p>
        <Button className="mt-6 w-full" size="lg" asChild>
          <Link href="/login">Continue to sign in</Link>
        </Button>
      </div>
    );
  }

  const submit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await onSubmit(token, password);
      setDone(true);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  });

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
      {error && (
        <Alert variant="destructive" className="mt-6">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        <Field label="New password" error={errors.password?.message} description="At least 10 characters, with a letter and a number." required>
          <Input type="password" autoComplete="new-password" {...form.register("password")} />
        </Field>
        <Field label="Confirm password" error={errors.confirm?.message} required>
          <Input type="password" autoComplete="new-password" {...form.register("confirm")} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </form>
    </div>
  );
}
