"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { createQuotationAction } from "./actions";

/** Starts a calculation for the project and opens it. */
export function CreateQuotationButton({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createQuotationAction, null);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="projectCode" value={projectCode} />
      <Button type="submit" disabled={pending}>
        {pending ? "Membuat…" : "Buat calculation & quotation"}
      </Button>
      <FormStatus state={state} />
    </form>
  );
}
