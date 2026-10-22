"use client";

import { useId, cloneElement, isValidElement } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { FieldControlContext, type FieldControlProps } from "@/components/ui/field-context";
import { cn } from "@/lib/utils";

/**
 * Accessible form field: wires label, description and error message to the
 * control via id / aria-describedby / aria-invalid.
 */
export function Field({
  label,
  error,
  description,
  required,
  className,
  adornment,
  children,
}: {
  label: string;
  /** Inline element inside the control (e.g. a show-password button); the label still targets the input. */
  adornment?: React.ReactNode;
  error?: string;
  description?: string;
  required?: boolean;
  className?: string;
  children: React.ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const descId = description ? `${id}-desc` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const controlProps: FieldControlProps = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": [descId, errId].filter(Boolean).join(" ") || undefined,
    "aria-required": required || undefined,
  };
  // Plain inputs receive the props directly; composite controls rendered via
  // <Controller> read them from context (see SelectTrigger, AssigneePicker).
  const control = isValidElement(children) ? cloneElement(children, { ...controlProps }) : children;

  return (
    <FieldControlContext.Provider value={controlProps}>
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id} className="text-[13px]">
        {label}
        {required && (
          <span className="text-red-600" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      {adornment ? (
        <div className="relative">
          {control}
          {adornment}
        </div>
      ) : (
        control
      )}
      {description && !error && (
        <p id={descId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
    </FieldControlContext.Provider>
  );
}

/** Applies server-side field errors (ApiError.fieldErrors) to a RHF form. */
export function applyFieldErrors<T extends FieldValues>(
  fieldErrors: Record<string, string[]> | undefined,
  setError: UseFormSetError<T>
): boolean {
  if (!fieldErrors) return false;
  let applied = false;
  for (const [name, messages] of Object.entries(fieldErrors)) {
    if (messages[0]) {
      setError(name as Path<T>, { type: "server", message: messages[0] });
      applied = true;
    }
  }
  return applied;
}
