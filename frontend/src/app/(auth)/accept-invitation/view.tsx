"use client";

import { Suspense } from "react";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { authApi } from "@/lib/api/services";

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <SetPasswordForm
        title="Activate your account"
        description="Your administrator created a Bizwoke Nova account for you. Set a password to activate it."
        submitLabel="Activate account"
        successTitle="Account activated"
        successDescription="Your account is ready. Sign in to see your workspace."
        onSubmit={authApi.acceptInvitation}
      />
    </Suspense>
  );
}
