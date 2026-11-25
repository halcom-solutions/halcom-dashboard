"use client";

import { useEffect, useId, useRef } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/components/ui/form-status";

/**
 * A field that is read first and edited on purpose: the button opens the form in a modal, and the modal closes by itself once the
 * save succeeds (the toast says so). `state` is the result of the form inside.
 */
export function EditDialog({ title, buttonLabel, state, children }: { title: string; buttonLabel: string; state: FormState; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (state?.ok) dialog.current?.close();
  }, [state]);
  return (
    <>
      <Button type="button" size="sm" aria-haspopup="dialog" aria-label={buttonLabel} onClick={() => dialog.current?.showModal()}>
        <Pencil aria-hidden data-icon="inline-start" />
        Edit
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="flex flex-col gap-4 p-5">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {children}
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => dialog.current?.close()}>
              Batal
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
