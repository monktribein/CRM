"use client";

import { Suspense } from "react";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { authApi } from "@/lib/api/services";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <SetPasswordForm
        title="Choose a new password"
        description="Your new password replaces the old one and signs you out of other devices."
        submitLabel="Update password"
        successTitle="Password updated"
        successDescription="You can now sign in with your new password."
        onSubmit={authApi.resetPassword}
      />
    </Suspense>
  );
}
