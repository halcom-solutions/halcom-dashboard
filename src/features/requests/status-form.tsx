"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { startAsksForPic, type PicOption } from "@/domain/pics/teams";
import { reasonRequired, REQUEST_STATUS_LABELS, type RequestStatus } from "@/domain/requests/status";
import type { RequestType } from "@/domain/requests/types";
import { changeStatusAction } from "./actions";

/**
 * Changes the status of a request from its page: the same moves as dragging the card on the board, for people who prefer a drop-down (or
 * work on a small screen). It asks for what the move needs: a reason for a cancellation, a revision, a late completion or a move outside
 * the flow (a superadmin's correction), and the PIC when an RFQ or PO is started. The server checks everything again. The result is a toast
 * (success, or a warning when the move was outside the flow, or a danger when it failed), and the page refreshes to show the new status.
 * The page mounts it with the status as its key, so a finished move starts the next one from a clean form.
 */
export function StatusForm({
  requestId,
  type,
  status,
  moves,
  outsideFlow,
  overdue,
  pics,
  currentPicId,
}: {
  requestId: string;
  type: RequestType;
  status: RequestStatus;
  /** Where the viewer can move this request. */
  moves: readonly RequestStatus[];
  /** The part of `moves` that the usual flow does not allow (only a superadmin has any). */
  outsideFlow: readonly RequestStatus[];
  overdue: boolean;
  pics: readonly PicOption[];
  currentPicId: string;
}) {
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState<RequestStatus | "">("");
  const [reason, setReason] = useState("");
  const [picId, setPicId] = useState(currentPicId);

  // The toast comes from here, not from the form's own result: once the move is saved the page is rendered again and this form is mounted
  // anew (it is keyed by the status), so a result handed to the old form would never be shown.
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    start(async () => {
      const result = await changeStatusAction(null, data);
      if (!result?.ok) {
        const message = result?.message ?? "Status tidak bisa diubah.";
        setError(message);
        toast.danger(message);
        return;
      }
      toast(result.message, result.level === "warning" ? "warning" : "success");
      router.refresh();
    });
  }

  const target = to === "" ? null : to;
  const needsPic = target !== null && startAsksForPic(type, status, target);
  const isOutside = target !== null && outsideFlow.includes(target);
  const needsReason = target !== null && (reasonRequired(status, target) || isOutside || (target === "COMPLETED" && type !== "BOQ" && overdue));
  const ready = target !== null && (!needsReason || reason.trim() !== "") && (!needsPic || picId !== "");

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 sm:items-start">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-to`}>Ubah status ke</Label>
        <NativeSelect id={`${id}-to`} name="to" value={to} onChange={(event) => setTo(event.target.value as RequestStatus | "")}>
          <option value="">Pilih status baru</option>
          {moves.map((move) => (
            <option key={move} value={move}>
              {REQUEST_STATUS_LABELS[move]}
              {outsideFlow.includes(move) ? " (di luar alur biasa)" : ""}
            </option>
          ))}
        </NativeSelect>
      </div>
      {needsPic ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-pic`}>PIC yang mengerjakan</Label>
          <NativeSelect id={`${id}-pic`} name="picId" value={picId} onChange={(event) => setPicId(event.target.value)} required>
            <option value="">Pilih PIC</option>
            {pics.map((pic) => (
              <option key={pic.id} value={pic.id}>
                {pic.name}
              </option>
            ))}
          </NativeSelect>
          {pics.length === 0 ? <p className="text-xs text-destructive">Belum ada PIC aktif. Minta Admin menambahkannya di halaman PICs.</p> : null}
        </div>
      ) : null}
      {needsReason ? (
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`${id}-reason`}>{target === "COMPLETED" && !isOutside ? "Catatan keterlambatan" : "Alasan"}</Label>
          <Textarea id={`${id}-reason`} name="reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required className="min-h-20" />
          <p className="text-xs text-muted-foreground">
            {isOutside
              ? "Perpindahan ini di luar alur biasa (hanya Superadmin). Alasan masuk ke riwayat status dan audit log."
              : target === "COMPLETED"
                ? "Request ini melewati batas SLA. Tulis alasan keterlambatan; catatan ini bisa dilihat semua orang."
                : target === "REVISION"
                  ? "Tulis apa yang perlu diubah. Jam SLA revisi mulai dari sekarang."
                  : "Alasan masuk ke riwayat status."}
          </p>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending || !ready} variant={target === "CANCELLED" ? "destructive" : "default"}>
          {pending ? "Menyimpan…" : target ? `Ubah ke ${REQUEST_STATUS_LABELS[target]}` : "Ubah status"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      ) : null}
    </form>
  );
}
