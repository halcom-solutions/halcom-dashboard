"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { startAsksForPic, type PicOption } from "@/domain/pics/teams";
import { boardColumns, columnOf, isOverrideMove, movesFor, reasonRequired, REQUEST_STATUS_LABELS, type RequestStatus } from "@/domain/requests/status";
import type { RequestType } from "@/domain/requests/types";
import { cn } from "@/lib/utils";
import type { RequestRow } from "@/server/requests/queries";
import { moveRequestAction } from "./actions";
import { formatDateOnly } from "./format";
import { SlaBadge } from "./sla-badge";

type Pending = { card: RequestRow; to: RequestStatus };
/** An RFQ or PO that is being started: the team picks its PIC first. */
type PendingStart = { card: RequestRow };

/** An RFQ or PO moved to Completed after its SLA deadline: the team says why (the server asks for it too). */
const lateCompletion = (card: RequestRow, to: RequestStatus) => to === "COMPLETED" && card.type !== "BOQ" && card.sla.state === "overdue";

/** Columns shown folded until opened: only their name and number are on show. */
const FOLDED: ReadonlySet<RequestStatus> = new Set<RequestStatus>(["REVISION", "CANCELLED"]);

/**
 * The board: one column per status, and the place where SOA and Purchasing change a status, by dragging a card to another column.
 * Only the moves the flow allows light up as drop targets (a BOQ gets a Revision column after Completed; an RFQ or PO does not). A
 * cancellation, or reopening a completed RFQ or PO, asks for a reason first. People who may not work on a request's type see its card
 * but cannot drag it. The server checks every move again. With the keyboard: focus a card and press Shift + Arrow Left or Right.
 * A superadmin (`canOverride`) can drop a card on any other column, outside the flow, with a reason. While a card is dragged near the top or
 * bottom edge of the screen the page scrolls (and a column list near its own edge), so a long board can be reached without dropping the card.
 */
export function RequestBoard({
  rows,
  type,
  movable,
  pics,
  canOverride = false,
}: {
  rows: RequestRow[];
  type: RequestType | null;
  movable: Readonly<Record<RequestType, boolean>>;
  pics: readonly PicOption[];
  canOverride?: boolean;
}) {
  const router = useRouter();
  const [cards, setCards] = useState(rows);
  const [dragging, setDragging] = useState<RequestRow | null>(null);
  const [over, setOver] = useState<RequestStatus | null>(null);
  // A failure also stays on the page as an alert (the toast fades); a success is only a toast.
  const [message, setMessage] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const [starting, setStarting] = useState<PendingStart | null>(null);
  const [startPic, setStartPic] = useState("");
  const startDialog = useRef<HTMLDialogElement>(null);
  const columns = boardColumns(type);
  const mainColumns = columns.filter((status) => !FOLDED.has(status));
  const foldedColumns = columns.filter((status) => FOLDED.has(status));
  const [opened, setOpened] = useState<ReadonlySet<RequestStatus>>(new Set());
  const toggle = (status: RequestStatus) => setOpened((current) => { const next = new Set(current); if (!next.delete(status)) next.add(status); return next; });

  const accepts = (card: RequestRow | null, to: RequestStatus) => card !== null && movable[card.type] && movesFor(card.status, card.type, canOverride).includes(to);

  // Scroll while dragging: the drag keeps the page still otherwise, and on a small screen the columns do not fit.
  useEffect(() => {
    if (!dragging) return;
    const EDGE = 96;
    const MAX_STEP = 28;
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;
    const onOver = (event: DragEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    const step = (distance: number) => Math.ceil((1 - Math.max(0, distance) / EDGE) * MAX_STEP);
    const pageScroller = (() => {
      for (let node = boardRef.current?.parentElement ?? null; node; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowY;
        if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
      }
      return null;
    })();
    const tick = () => {
      if (pointer) {
        const { x, y } = pointer;
        const list = document.elementFromPoint(x, y)?.closest<HTMLElement>("ul[data-board-list]") ?? null;
        const box = list?.getBoundingClientRect();
        const scrollable = list !== null && list.scrollHeight > list.clientHeight;
        // A column list that can scroll takes the pointer near its own top or bottom edge first.
        if (scrollable && box && y - box.top < EDGE / 2 && list.scrollTop > 0) list.scrollTop -= step((y - box.top) * 2);
        else if (scrollable && box && box.bottom - y < EDGE / 2 && list.scrollTop + list.clientHeight < list.scrollHeight) list.scrollTop += step((box.bottom - y) * 2);
        else if (y < EDGE) (pageScroller ?? window).scrollBy(0, -step(y));
        else if (window.innerHeight - y < EDGE) (pageScroller ?? window).scrollBy(0, step(window.innerHeight - y));
      }
      frame = requestAnimationFrame(tick);
    };
    document.addEventListener("dragover", onOver);
    frame = requestAnimationFrame(tick);
    return () => {
      document.removeEventListener("dragover", onOver);
      cancelAnimationFrame(frame);
    };
  }, [dragging]);

  function move(card: RequestRow, to: RequestStatus, why?: string, picId?: string) {
    const picName = picId ? (pics.find((pic) => pic.id === picId)?.name ?? card.assigneeName) : card.assigneeName;
    setCards((current) => current.map((row) => (row.id === card.id ? { ...row, status: to, statusChangedAt: new Date(), assigneeId: picId ?? row.assigneeId, assigneeName: picName } : row)));
    setMessage(null);
    startTransition(async () => {
      const result = await moveRequestAction(card.id, to, why, picId);
      if (!result.ok) {
        setCards((current) => current.map((row) => (row.id === card.id ? card : row)));
        setMessage(result.message);
        toast.danger(result.message);
        return;
      }
      // A move outside the usual flow (a superadmin's correction) comes back as a warning.
      if (result.level === "warning") toast.warning(result.message);
      else toast.success(`${card.code} is now ${REQUEST_STATUS_LABELS[to]}.`);
      router.refresh();
    });
  }

  function drop(card: RequestRow | null, to: RequestStatus) {
    setOver(null);
    setDragging(null);
    if (!card || !accepts(card, to)) return;
    if (startAsksForPic(card.type, card.status, to)) {
      setStartPic(card.assigneeId ?? "");
      setStarting({ card });
      startDialog.current?.showModal();
      return;
    }
    if (reasonRequired(card.status, to) || lateCompletion(card, to) || isOverrideMove(card.status, to, card.type)) {
      setReason("");
      setPending({ card, to });
      dialog.current?.showModal();
      return;
    }
    move(card, to);
  }

  function confirm() {
    if (!pending || reason.trim() === "") return;
    const { card, to } = pending;
    setPending(null);
    dialog.current?.close();
    move(card, to, reason.trim());
  }

  function confirmStart() {
    if (!starting || startPic === "") return;
    const { card } = starting;
    setStarting(null);
    startDialog.current?.close();
    move(card, "IN_PROGRESS", undefined, startPic);
  }

  function cancelStart() {
    setStarting(null);
    startDialog.current?.close();
  }

  function cancelDialog() {
    setPending(null);
    dialog.current?.close();
  }

  /** Shift + Arrow: the same move as a drag, to the neighbouring column that accepts the card. */
  function keyboardMove(card: RequestRow, step: 1 | -1) {
    const from = columns.indexOf(columnOf(card.status));
    for (let index = from + step; index >= 0 && index < columns.length; index += step) {
      if (accepts(card, columns[index]!)) {
        drop(card, columns[index]!);
        return;
      }
    }
  }


  function renderCard(card: RequestRow) {
    const mayMove = movable[card.type] && movesFor(card.status, card.type, canOverride).length > 0;
    return (
      <li
        key={card.id}
        data-request={card.code}
        draggable={mayMove}
        tabIndex={mayMove ? 0 : undefined}
        aria-label={mayMove ? `${card.code}, ${REQUEST_STATUS_LABELS[card.status]}. Shift and arrow keys move it.` : undefined}
        className={cn("rounded-lg border bg-card p-2.5 text-sm shadow-xs", mayMove && "cursor-grab active:cursor-grabbing", dragging?.id === card.id && "opacity-50")}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", card.id);
          setDragging(card);
          setMessage(null);
        }}
        onDragEnd={() => {
          setDragging(null);
          setOver(null);
        }}
        onKeyDown={(event) => {
          if (!mayMove || !event.shiftKey || event.target !== event.currentTarget) return;
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            keyboardMove(card, event.key === "ArrowRight" ? 1 : -1);
          }
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <Link href={`/request/${card.code}`} draggable={false} className="font-mono text-xs font-medium text-primary underline-offset-4 hover:underline">
            {card.code}
          </Link>
          <span className="truncate text-xs text-muted-foreground">{card.assigneeName ?? "Unassigned"}</span>
        </div>
        <p className={cn("mt-1 line-clamp-1 font-medium", card.status === "CANCELLED" && "text-muted-foreground line-through")} title={card.title}>
          {card.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {card.endUserCompany}, {card.projectName}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <SlaBadge sla={card.sla} />
          {card.overdueDays !== null ? (
            <span className="text-xs font-medium text-destructive" title={`${card.overdueDays} hari kerja melewati batas SLA`}>
              +{card.overdueDays} {card.overdueDays === 1 ? "day" : "days"}
            </span>
          ) : null}
        </div>
        {card.overdueNote ? (
          <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground" title={card.overdueNote}>
            Catatan overdue: {card.overdueNote}
          </p>
        ) : null}
        {card.requiredBy ? <p className="mt-1 text-[11px] text-muted-foreground">{`needed by ${formatDateOnly(card.requiredBy)}`}</p> : null}
      </li>
    );
  }

  /** One column. Revision and Cancelled are folded: only their name and number show until opened, and a card can still be dropped on them. */
  function renderColumn(status: RequestStatus) {
    // Newest status change on top, in every column.
    const inColumn = cards.filter((row) => columnOf(row.status) === status).sort((a, b) => +new Date(b.statusChangedAt) - +new Date(a.statusChangedAt));
    const droppable = accepts(dragging, status);
    const folded = FOLDED.has(status) && !opened.has(status);
    return (
      <section
        key={status}
        aria-label={`${REQUEST_STATUS_LABELS[status]}, ${inColumn.length} request${inColumn.length === 1 ? "" : "s"}`}
        data-column={status}
        className={cn("flex min-w-0 flex-col gap-2 rounded-xl bg-muted/40 p-2 transition-colors", folded ? "min-h-0" : "min-h-32", droppable && "ring-2 ring-primary/40", over === status && droppable && "bg-primary/10")}
        onDragOver={(event) => {
          if (!droppable) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setOver(status);
        }}
        onDragLeave={() => setOver((current) => (current === status ? null : current))}
        onDrop={(event) => {
          event.preventDefault();
          drop(dragging, status);
        }}
      >
        <h2 className="flex items-center justify-between gap-2 px-1 pt-1 text-sm font-semibold">
          {FOLDED.has(status) ? (
            <button type="button" aria-expanded={!folded} onClick={() => toggle(status)} className="flex items-center gap-1 text-left">
              <ChevronRight aria-hidden className={cn("size-4 transition-transform", !folded && "rotate-90")} />
              {REQUEST_STATUS_LABELS[status]}
            </button>
          ) : (
            REQUEST_STATUS_LABELS[status]
          )}
          <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{inColumn.length}</span>
        </h2>
        {folded ? null : inColumn.length === 0 ? (
          <p className="px-1 pb-2 text-xs text-muted-foreground">None.</p>
        ) : (
          // Completed is the long column, so its cards sit in two columns instead of one tall stack. Each column scrolls inside itself, up to twice the screen height.
          <ul tabIndex={0} data-board-list aria-label={`Kartu ${REQUEST_STATUS_LABELS[status]}`} className={cn("max-h-[calc(200svh-32rem)] min-h-24 gap-2 overflow-y-auto pr-1", status === "COMPLETED" ? "grid sm:grid-cols-2" : "flex flex-col")}>
            {inColumn.map(renderCard)}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">Seret kartu ke kolom lain untuk mengubah status. Detail revisi dan pertanyaan ke Sales lewat email.</p>
      <div role="alert" className="mb-2 min-h-5 text-sm text-destructive">
        {message}
      </div>
      <div ref={boardRef} className={cn("grid gap-3 md:grid-cols-2", "lg:grid-cols-(--board-cols)")} style={{ "--board-cols": mainColumns.map((status) => (status === "COMPLETED" ? "2fr" : "1fr")).join(" ") } as React.CSSProperties} role="group" aria-label="Request board">
        {mainColumns.map((status) => renderColumn(status))}
      </div>
      {foldedColumns.length > 0 ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2" role="group" aria-label="Hidden columns">
          {foldedColumns.map((status) => renderColumn(status))}
        </div>
      ) : null}
      <dialog
        ref={startDialog}
        aria-labelledby="board-start-title"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50"
        onClose={() => setStarting(null)}
      >
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            confirmStart();
          }}
        >
          <div>
            <h2 id="board-start-title" className="text-base font-semibold">
              Siapa PIC untuk {starting?.card.code}?
            </h2>
            <p className="text-sm text-muted-foreground">Pilih PIC Purchasing yang mengerjakan request ini. Request pindah ke In progress setelah PIC disimpan.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="board-start-pic" className="text-sm font-medium">
              PIC
            </label>
            <NativeSelect id="board-start-pic" value={startPic} onChange={(event) => setStartPic(event.target.value)} required>
              <option value="">Pilih PIC</option>
              {pics.map((pic) => (
                <option key={pic.id} value={pic.id}>
                  {pic.name}
                </option>
              ))}
            </NativeSelect>
            {pics.length === 0 ? <p className="text-xs text-destructive">Belum ada PIC Purchasing yang aktif. Minta Admin menambahkannya di halaman PICs.</p> : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancelStart}>
              Batal
            </Button>
            <Button type="submit" disabled={startPic === ""}>
              Mulai dikerjakan
            </Button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={dialog}
        aria-labelledby="board-reason-title"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50"
        onClose={() => setPending(null)}
      >
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
        >
          <div>
            <h2 id="board-reason-title" className="text-base font-semibold">
              {pending && isOverrideMove(pending.card.status, pending.to, pending.card.type)
                ? `Pindahkan ${pending.card.code} ke ${REQUEST_STATUS_LABELS[pending.to]}?`
                : pending?.to === "COMPLETED"
                  ? `Selesaikan ${pending.card.code} yang overdue?`
                  : `${pending?.to === "CANCELLED" ? "Cancel" : "Revisi"} ${pending?.card.code}?`}
            </h2>
            <p className="text-sm text-muted-foreground">
              {pending && isOverrideMove(pending.card.status, pending.to, pending.card.type)
                ? "Perpindahan ini di luar alur biasa (hanya Superadmin). Tulis alasannya; masuk ke riwayat status dan audit log."
                : pending?.to === "COMPLETED"
                ? "Request ini melewati batas SLA. Tulis alasan keterlambatan: catatan ini bisa dilihat semua orang di daftar request dan di Purchasing dashboard."
                : pending?.to === "REVISION"
                  ? "Tulis apa yang perlu diubah. Catatan masuk ke riwayat status, dan jam SLA revisi mulai dari sekarang."
                  : "Say why. It is kept in the status history."}
            </p>
          </div>
          <Textarea aria-label={pending?.to === "COMPLETED" && !isOverrideMove(pending.card.status, pending.to, pending.card.type) ? "Catatan keterlambatan" : "Reason"} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required className="min-h-24" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancelDialog}>
              Keep it as it is
            </Button>
            <Button type="submit" variant={pending?.to === "CANCELLED" ? "destructive" : "default"} disabled={reason.trim() === ""}>
              {pending && isOverrideMove(pending.card.status, pending.to, pending.card.type)
                ? `Pindahkan ke ${REQUEST_STATUS_LABELS[pending.to]}`
                : pending?.to === "COMPLETED"
                  ? "Selesaikan request"
                  : pending?.to === "CANCELLED"
                    ? "Cancel request"
                    : "Request revision"}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
