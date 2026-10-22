"use client";

import { Suspense } from "react";
import { EmployeeDirectory } from "./employee-directory";

export default function EmployeesPage() {
  return (
    <Suspense>
      <EmployeeDirectory />
    </Suspense>
  );
}
