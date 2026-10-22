"use client";

import { Suspense } from "react";
import { SettingsView } from "./settings-view";

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsView />
    </Suspense>
  );
}
