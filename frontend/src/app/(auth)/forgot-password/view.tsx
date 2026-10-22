"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { ApiError, getErrorMessage } from "@/lib/api/client";
import { authApi } from "@/lib/api/services";

const schema = z.object({ email: z.string().trim().email("Enter a valid email address.") });

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await authApi.forgotPassword(email);
      setSentTo(email);
    } catch (e) {
      // Rate limiting is the only failure worth surfacing; never reveal whether an account exists.
      setError(e instanceof ApiError && e.status === 429 ? e.message : getErrorMessage(e));
    }
  });

  if (sentTo) {
    return (
      <div>
        <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
          <MailCheck className="size-5" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          If an account exists for <span className="font-medium text-foreground">{sentTo}</span>, we&apos;ve sent a link to reset
          your password. The link expires in 30 minutes.
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          Didn&apos;t get it? Check spam, or contact your administrator.
        </p>
        <Button variant="outline" className="mt-6 w-full" asChild>
          <Link href="/login">
            <ArrowLeft /> Back to sign in
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Enter your work email and we&apos;ll send you a reset link.</p>
      {error && (
        <Alert variant="destructive" className="mt-6">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <Field label="Work email" error={errors.email?.message} required>
          <Input type="email" autoComplete="email" placeholder="name@company.com" {...form.register("email")} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          Send reset link
        </Button>
      </form>
      <Link href="/login" className="mt-6 flex items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
    </div>
  );
}
