"use client";

import { useEffect } from "react";
import { toast } from "./toast";

/** `level: "warning"` shows the result as a warning (amber) toast: a change that worked but is outside the usual flow, or is only partly done. Under the form it shows like `ok` says. */
export type FormState = { ok: boolean; message: string; level?: "warning" } | null;

/**
 * The result of a form. Every result shows as a toast. A failure also stays under the form as an alert, so the person can read
 * it while fixing the input; a success needs no line of its own.
 */
export function FormStatus({ state }: { state: FormState }) {
  useEffect(() => {
    if (state) toast(state.message, state.level === "warning" ? "warning" : state.ok ? "success" : "danger", state);
  }, [state]);
  if (!state || state.ok) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {state.message}
    </p>
  );
}
