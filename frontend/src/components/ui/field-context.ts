"use client";

import { createContext, useContext } from "react";

/**
 * Lets composite controls (Select triggers, pickers) rendered through
 * react-hook-form's <Controller> pick up the id / aria wiring of the
 * surrounding <Field>, so their label and error text stay connected.
 */
export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

export const FieldControlContext = createContext<FieldControlProps | null>(null);

export function useFieldControl(): FieldControlProps | null {
  return useContext(FieldControlContext);
}
