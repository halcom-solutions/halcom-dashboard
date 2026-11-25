import { can, type Permission } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import type { RequestType } from "./types";

/** The permission needed to work on (change the status of) a request of this type. */
export function workPermission(type: RequestType): Permission {
  return type === "BOQ" ? "requests.work.boq" : "requests.work.purchasing";
}

/**
 * Who sees the email text of a request. Sales (and admins) write to whichever team owns the request. SOA only
 * deals with BOQ requests, and with the RFQ or PO it hands over to Purchasing itself; an RFQ or PO that Sales raised
 * goes to Purchasing, so SOA does not see its email. Purchasing does not send these emails.
 */
export function canSeeEmail(role: Role, type: RequestType, isHandover: boolean): boolean {
  if (!can(role, "requests.email")) return false;
  if (role === "SOA") return type === "BOQ" || isHandover;
  return true;
}

/**
 * Who decides what follows a completed BOQ or RFQ: the Sales owner of the project (the customer relationship is
 * theirs), admins, SOA for the step after a BOQ, and Purchasing for the step after an RFQ (`requests.continue.rfq`, which the
 * Superadmin can switch off or hand to another role). `ownsProject` is true for the Sales user who owns the project.
 */
export function canContinueFlow(role: Role, type: RequestType, ownsProject: boolean): boolean {
  if (role === "SALES") return ownsProject;
  if (type === "RFQ" && can(role, "requests.continue.rfq")) return true;
  if (role === "SOA") return type === "BOQ" && can(role, "requests.handover");
  return can(role, "requests.handover");
}

/** Whether a role may take part in the continue/stop decision at all (the entry check of the services; the type and project are checked after). */
export function mayDecideFlow(role: Role): boolean {
  return role === "SALES" || can(role, "requests.handover") || can(role, "requests.continue.rfq");
}

export function canWorkOn(role: Role, type: RequestType): boolean {
  return can(role, workPermission(type));
}
