import { describe, expect, it } from "vitest";
import { can } from "@/domain/access/permissions";
import { ROLES } from "@/domain/access/roles";
import { ACTIVE_STATUSES, allowedTransitions, isOverrideMove, movesFor, REQUEST_STATUSES } from "@/domain/requests/status";

describe("where a request can be moved", () => {
  it("is the flow for everybody who works the type", () => {
    for (const status of REQUEST_STATUSES) expect(movesFor(status, "RFQ", false)).toEqual(allowedTransitions(status, "RFQ"));
    expect(movesFor("COMPLETED", "BOQ", false)).toEqual(["REVISION"]);
    expect(movesFor("CANCELLED", "PO", false)).toEqual([]);
  });

  it("is every other offered status for a superadmin, and never the retired one", () => {
    for (const status of REQUEST_STATUSES) {
      const moves = movesFor(status, "RFQ", true);
      expect(moves).not.toContain(status);
      expect(moves).not.toContain("WAITING_FOR_SALES");
      expect(moves.length).toBe(ACTIVE_STATUSES.filter((other) => other !== status).length);
    }
    expect(movesFor("COMPLETED", "RFQ", true)).toContain("CANCELLED");
    expect(movesFor("CANCELLED", "RFQ", true)).toEqual(expect.arrayContaining(["SUBMITTED", "IN_PROGRESS", "COMPLETED", "REVISION"]));
  });

  it("calls a move outside the flow an override", () => {
    expect(isOverrideMove("COMPLETED", "CANCELLED", "RFQ")).toBe(true);
    expect(isOverrideMove("CANCELLED", "IN_PROGRESS", "BOQ")).toBe(true);
    expect(isOverrideMove("IN_PROGRESS", "COMPLETED", "RFQ")).toBe(false);
    expect(isOverrideMove("COMPLETED", "REVISION", "BOQ")).toBe(false);
  });

  it("is a permission only a superadmin holds", () => {
    for (const role of ROLES) expect(can(role, "requests.override-status"), role).toBe(role === "SUPERADMIN");
  });
});
