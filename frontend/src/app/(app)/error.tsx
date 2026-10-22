"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/common/states";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="rounded-lg border bg-card">
      <ErrorState error={new Error("An unexpected error occurred while showing this page.")} title="Something went wrong" onRetry={reset} />
    </div>
  );
}
