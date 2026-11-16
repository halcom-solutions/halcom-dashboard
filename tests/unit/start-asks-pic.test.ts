import { describe, expect, it } from "vitest";
import { startAsksForPic } from "@/domain/pics/teams";

describe("starting a request asks for a PIC", () => {
  it("always for an RFQ or a PO, and for a BOQ only while it has no PIC", () => {
    expect(startAsksForPic("RFQ", "SUBMITTED", "IN_PROGRESS")).toBe(true);
    expect(startAsksForPic("RFQ", "SUBMITTED", "IN_PROGRESS", true)).toBe(true);
    expect(startAsksForPic("PO", "SUBMITTED", "IN_PROGRESS", true)).toBe(true);
    expect(startAsksForPic("BOQ", "SUBMITTED", "IN_PROGRESS")).toBe(true);
    expect(startAsksForPic("BOQ", "SUBMITTED", "IN_PROGRESS", true)).toBe(false);
  });

  it("only when moving from Submitted to In progress", () => {
    for (const type of ["BOQ", "RFQ", "PO"] as const) {
      expect(startAsksForPic(type, "SUBMITTED", "COMPLETED")).toBe(false);
      expect(startAsksForPic(type, "IN_PROGRESS", "COMPLETED")).toBe(false);
      expect(startAsksForPic(type, "REVISION", "IN_PROGRESS")).toBe(false);
    }
  });
});
