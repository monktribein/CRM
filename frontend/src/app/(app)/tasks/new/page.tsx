import type { Metadata } from "next";
import View from "./view";

export const metadata: Metadata = { title: "Create task" };

// Rendered client-side after the session is restored; see (app)/layout.tsx.
export const instant = false;

export default function Page() {
  return <View />;
}
