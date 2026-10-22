"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useAuth } from "@/components/providers/auth-provider";
import { getErrorMessage } from "@/lib/api/client";
import { isApiConfigured } from "@/lib/config";
import { safeRedirect } from "@/lib/validation";

const schema = z.object({
  email: z.string().trim().min(1, "Enter your work email.").email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
type Values = z.infer<typeof schema>;

const DEMO_ACCOUNTS = [
  ["Super Admin", "admin@bizwoke.dev"],
  ["Manager", "manager@bizwoke.dev"],
  ["HR Manager", "hr@bizwoke.dev"],
  ["Employee", "employee@bizwoke.dev"],
] as const;

export function LoginForm() {
  const { login, status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeRedirect(params.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.email, values.password);
      router.replace(next);
    } catch (e) {
      setError(getErrorMessage(e, "Sign in failed. Please try again."));
    }
  });

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Sign in to your workspace</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Use the work account your administrator created for you.</p>

      {!isApiConfigured() && (
        <Alert variant="destructive" className="mt-6">
          <AlertCircle />
          <AlertDescription>
            The API isn&apos;t configured. Set <code className="font-mono text-xs">NEXT_PUBLIC_API_URL</code> and restart.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="mt-6" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <Field label="Work email" error={errors.email?.message} required>
          <Input type="email" autoComplete="username" placeholder="name@company.com" {...form.register("email")} />
        </Field>
        <div className="space-y-1.5">
          <Field
            label="Password"
            error={errors.password?.message}
            required
            adornment={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            }
          >
            <Input type={showPassword ? "text" : "password"} autoComplete="current-password" className="pr-9" {...form.register("password")} />
          </Field>
          <div className="text-right">
            <Link href="/forgot-password" className="text-[13px] font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO_MODE === "true" && (
        <div className="mt-8 rounded-lg border border-dashed border-amber-300 bg-amber-50/60 p-3 text-xs text-amber-900">
          <p className="font-semibold">Development demo mode</p>
          <p className="mt-0.5">In-browser demo data. Password for all accounts: <code className="font-mono">Demo@1234</code></p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DEMO_ACCOUNTS.map(([label, email]) => (
              <button
                key={email}
                type="button"
                className="rounded border border-amber-300 bg-white px-2 py-1 font-medium hover:bg-amber-100"
                onClick={() => {
                  form.setValue("email", email);
                  form.setValue("password", "Demo@1234");
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Need an account? Ask your administrator — self-registration is disabled.
      </p>
    </div>
  );
}
