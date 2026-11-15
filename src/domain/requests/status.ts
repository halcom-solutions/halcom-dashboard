import type { RequestType } from "./types";

/** Keep in sync with `enum RequestStatus` in prisma/schema.prisma (brief §7, reduced to what is confirmed). */
export const REQUEST_STATUSES = [
  "SUBMITTED",
  "IN_PROGRESS",
  "WAITING_FOR_SALES",
  "COMPLETED",
  "REVISION",
  "CANCELLED",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/**
 * Waiting for Sales is retired: nobody can move a request into it any more (what the team needs from Sales is asked and answered by
 * email, which keeps the history). It stays a valid stored value because older requests, and their append-only status history, use it.
 */
export const RETIRED_STATUSES = ["WAITING_FOR_SALES"] as const satisfies readonly RequestStatus[];

export const isRetired = (status: RequestStatus): boolean => (RETIRED_STATUSES as readonly RequestStatus[]).includes(status);

/** The statuses that are offered: filters, columns and the badges of new work. */
export const ACTIVE_STATUSES = REQUEST_STATUSES.filter((status) => !isRetired(status));

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  SUBMITTED: "Submitted",
  IN_PROGRESS: "In progress",
  WAITING_FOR_SALES: "Waiting for Sales (retired)",
  COMPLETED: "Completed",
  REVISION: "Revision",
  CANCELLED: "Cancelled",
};

/**
 * Where a request can be dragged to on the board. Revision comes only after a request was completed: Sales (or the customer through
 * Sales) asked for changes and the owning team reworks it, on a fresh SLA clock. A request that still has the retired Waiting for Sales status can be moved on like
 * one that is In progress.
 */
function transitionsOf(): Record<RequestStatus, readonly RequestStatus[]> {
  return {
    // A request nobody has touched can be answered straight away: no manual "In progress" step in between.
    SUBMITTED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
    IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    WAITING_FOR_SALES: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
    // Every type is sent back through Revision (with a reason); the earlier completion stays in the status history (brief §6.3).
    COMPLETED: ["REVISION"],
    REVISION: ["COMPLETED", "CANCELLED"],
    CANCELLED: [],
  };
}

// The type is kept so a type could get its own flow; every type shares the same one today.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function allowedTransitions(from: RequestStatus, type: RequestType): readonly RequestStatus[] {
  return transitionsOf()[from];
}

export function canTransition(from: RequestStatus, to: RequestStatus, type: RequestType): boolean {
  return allowedTransitions(from, type).includes(to);
}

/**
 * Where a person can move a request to. The flow above is for everybody who works the type; a superadmin may also correct a request to any
 * other offered status (a completed one back to cancelled, a cancelled one reopened). Those moves are outside the flow, so they always need a
 * reason and are audited as an override. The retired status is never a target.
 */
export function movesFor(from: RequestStatus, type: RequestType, canOverride: boolean): readonly RequestStatus[] {
  if (!canOverride) return allowedTransitions(from, type);
  return ACTIVE_STATUSES.filter((status) => status !== from);
}

/** A move that the flow does not allow: only a superadmin can make it. */
export const isOverrideMove = (from: RequestStatus, to: RequestStatus, type: RequestType): boolean => !canTransition(from, to, type);

/** Cancelling and sending a completed request back for revision must say why, so they cannot be hidden silently (brief §8.4). */
export function reasonRequired(_from: RequestStatus, to: RequestStatus): boolean {
  return to === "CANCELLED" || to === "REVISION";
}

export function isOpen(status: RequestStatus): boolean {
  return status !== "COMPLETED" && status !== "CANCELLED";
}

/** The columns of the board, in the order work moves through them. */
// The type is kept so a type could get its own columns; every type shares the same ones today.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function boardColumns(_type: RequestType | null): readonly RequestStatus[] {
  return ACTIVE_STATUSES;
}

/** The board column a request sits in: a retired status is shown where the work is, In progress. */
export function columnOf(status: RequestStatus): RequestStatus {
  return isRetired(status) ? "IN_PROGRESS" : status;
}

/**
 * The flow is BOQ -> RFQ -> PO. A request is continued once it is Completed (brief §17 leaves "complete at handover or
 * after acknowledgement" open). Completion never implies a purchase: someone has to decide to continue (brief §6.1).
 * A BOQ can be skipped: Sales may start with an RFQ.
 */
export const NEXT_IN_FLOW: Record<RequestType, RequestType | null> = { BOQ: "RFQ", RFQ: "PO", PO: null };

export function canHandOver(type: RequestType, status: RequestStatus): boolean {
  return NEXT_IN_FLOW[type] !== null && status === "COMPLETED";
}

/** A PO follows an RFQ: it can only be raised on a project that has a completed RFQ. A BOQ and an RFQ have no such condition. */
export const PO_NEEDS_RFQ = "PO butuh RFQ yang sudah selesai di project ini. Ajukan RFQ dulu, lalu lanjutkan ke PO setelah RFQ selesai.";

/** The step that follows in the flow, or null after a PO. */
export function nextRequestType(type: RequestType): RequestType | null {
  return NEXT_IN_FLOW[type];
}

/** Types a request can be continued as: an RFQ after a BOQ, a PO after an RFQ. */
export const HANDOVER_TYPES = ["RFQ", "PO"] as const satisfies readonly RequestType[];
