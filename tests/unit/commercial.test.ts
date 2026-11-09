import { describe, expect, it } from "vitest";
import { diffCommercial, parseAmount, parseCommercialValue } from "@/domain/projects/commercial";
import { fieldLabel } from "@/domain/projects/fields";
import { marginFields } from "@/domain/projects/margin";
import { targetMarginAmount, targetMarginPercentOf } from "@/domain/projects/pipeline";
import { PROGRESS_LABELS, PROGRESS_NAMES, PROGRESS_PERCENT, progressFromStage, trackStatusFromStatus } from "@/domain/projects/progress";
import { PROJECT_STAGES } from "@/domain/projects/pipeline";
import { canSeeEmail } from "@/domain/requests/access";
import { navLinksFor } from "@/features/navigation/links";
import { topSlices, type Slice } from "@/server/projects/analytics";

describe("parseCommercialValue", () => {
  it("reads plain and Indonesian-formatted amounts, and treats blank as no value", () => {
    expect(parseCommercialValue("estimatedValue", "1200000000")).toEqual({ ok: true, value: 1_200_000_000 });
    expect(parseCommercialValue("estimatedValue", "1.200.000.000")).toEqual({ ok: true, value: 1_200_000_000 });
    expect(parseCommercialValue("estimatedValue", "  ")).toEqual({ ok: true, value: null });
    expect(parseCommercialValue("estimatedValue", "-5").ok).toBe(false);
    expect(parseCommercialValue("estimatedValue", "12abc").ok).toBe(false);
  });

  it("accepts a target margin from 0 to 100 with a comma or a point", () => {
    expect(parseCommercialValue("targetMargin", "12,5")).toEqual({ ok: true, value: 12.5 });
    expect(parseCommercialValue("targetMargin", "0")).toEqual({ ok: true, value: 0 });
    expect(parseCommercialValue("targetMargin", "100")).toEqual({ ok: true, value: 100 });
    expect(parseCommercialValue("targetMargin", "100.5").ok).toBe(false);
    expect(parseCommercialValue("targetMargin", "12.345").ok).toBe(false);
  });

  it("reads a target margin amount like any amount, and accepts a real calendar date only", () => {
    expect(parseCommercialValue("targetMarginValue", "150.000.000")).toEqual({ ok: true, value: 150_000_000 });
    expect(parseCommercialValue("targetMarginValue", "-5").ok).toBe(false);
    expect(parseCommercialValue("targetDate", "2026-12-10")).toEqual({ ok: true, value: "2026-12-10" });
    expect(parseCommercialValue("targetDate", "2026-13-40").ok).toBe(false);
    expect(parseCommercialValue("targetDate", "10/12/2026").ok).toBe(false);
  });
});

describe("Progress and Status", () => {
  it("accepts only the steps of the sheet's drop-downs", () => {
    expect(parseCommercialValue("progress", "AGREE")).toEqual({ ok: true, value: "AGREE" });
    expect(parseCommercialValue("progress", "30% - Propose").ok).toBe(false);
    expect(parseCommercialValue("trackStatus", "BLOCK")).toEqual({ ok: true, value: "BLOCK" });
    expect(parseCommercialValue("trackStatus", "Late").ok).toBe(false);
  });

  it("labels and weighs every step like the sheet", () => {
    expect(Object.values(PROGRESS_LABELS)).toEqual([
      "5% - Qualify",
      "15% - Understand",
      "30% - Propose",
      "60% - Negotiate",
      "60% - Negotiate (FU)",
      "95% - Agree",
      "100% - Closed Won",
      "0% - Closed Lost",
    ]);
    expect(PROGRESS_PERCENT.CLOSED_LOST).toBe(0);
  });

  it("gives every older stage and status a starting Progress and Status", () => {
    expect(PROJECT_STAGES.map(progressFromStage)).toEqual(["QUALIFY", "UNDERSTAND", "PROPOSE", "PROPOSE", "PROPOSE", "NEGOTIATE", "CLOSED_WON", "CLOSED_LOST"]);
    expect(trackStatusFromStatus("ACTIVE")).toBe("ON_TRACK");
    expect(trackStatusFromStatus("ON_HOLD")).toBe("ON_HOLD");
    expect(trackStatusFromStatus("COMPLETED")).toBe("DONE");
  });
});

describe("progress names for charts", () => {
  it("carry no percentage; the percentage only feeds the weighted pipeline", () => {
    for (const name of Object.values(PROGRESS_NAMES)) expect(name).not.toMatch(/\d/);
    expect(PROGRESS_NAMES.NEGOTIATE_FU).toBe("Negotiate (FU)");
  });
});

describe("parseAmount", () => {
  it("reads plain and Indonesian-formatted amounts and rejects everything else", () => {
    expect(parseAmount("Revenue", "2.500.000.000")).toEqual({ ok: true, value: 2_500_000_000 });
    expect(parseAmount("Revenue", " 1500 ")).toEqual({ ok: true, value: 1500 });
    expect(parseAmount("Revenue", "")).toEqual({ ok: true, value: null });
    expect(parseAmount("Revenue", undefined)).toEqual({ ok: true, value: null });
    expect(parseAmount("Revenue", "-1")).toMatchObject({ ok: false });
    expect(parseAmount("Revenue", "1e9")).toMatchObject({ ok: false });
  });
});

describe("diffCommercial", () => {
  const current = { createdAt: "2026-09-01", progress: "PROPOSE", trackStatus: "ON_TRACK", estimatedValue: 100, targetMargin: null, targetMarginValue: null, quoteReleasedAt: null, targetDate: "2026-12-10", finalValue: null, wonDate: null };

  it("lists only real changes, including clearing a value", () => {
    expect(diffCommercial(current, { estimatedValue: 100, targetMargin: 12.5, targetDate: null })).toEqual([
      { field: "targetMargin", from: null, to: "12.5" },
      { field: "targetDate", from: "2026-12-10", to: null },
    ]);
  });

  it("logs Progress and Status in the wording of the sheet", () => {
    expect(diffCommercial(current, { progress: "NEGOTIATE_FU", trackStatus: "BLOCK" })).toEqual([
      { field: "progress", from: "30% - Propose", to: "60% - Negotiate (FU)" },
      { field: "trackStatus", from: "On Track", to: "Block" },
    ]);
  });

  it("leaves fields that were not submitted alone", () => {
    expect(diffCommercial(current, { targetMargin: 10 })).toEqual([{ field: "targetMargin", from: null, to: "10" }]);
  });
});

describe("targetMarginAmount", () => {
  it("uses the final value once known, otherwise the estimate, and stays empty without both parts", () => {
    expect(targetMarginAmount(1_000, null, 12.5)).toBe(125);
    expect(targetMarginAmount(1_000, 2_000, 10)).toBe(200);
    expect(targetMarginAmount(null, null, 10)).toBeNull();
    expect(targetMarginAmount(1_000, null, null)).toBeNull();
  });

  it("uses a fixed amount as it is, and shows it as a percentage of the sale", () => {
    expect(targetMarginAmount(1_000, 2_000, 10, 150)).toBe(150);
    expect(targetMarginAmount(null, null, null, 150)).toBe(150);
    expect(targetMarginPercentOf(1_000, 2_000, null, 150)).toBe(7.5);
    expect(targetMarginPercentOf(null, null, null, 150)).toBeNull();
    expect(targetMarginPercentOf(1_000, null, 12.5, null)).toBe(12.5);
  });

  it("puts the margin box into one stored field and clears the other", () => {
    expect(marginFields("amount", "150")).toEqual({ targetMargin: "", targetMarginValue: "150" });
    expect(marginFields("percent", "12,5")).toEqual({ targetMargin: "12,5", targetMarginValue: "" });
    expect(marginFields(undefined, "9")).toEqual({ targetMargin: "", targetMarginValue: "9" });
  });

  it("labels the new fields in the change log", () => {
    expect(fieldLabel("targetMargin")).toBe("Gross Profit (%)");
    expect(fieldLabel("unknown_old_field")).toBe("unknown_old_field");
  });
});

describe("topSlices", () => {
  const slice = (label: string, value: number, count = 1): Slice => ({ key: label, label, value, count, weighted: 0 });

  it("orders by value, folds the tail into Other and puts Not set last", () => {
    const result = topSlices([slice("Not set", 999), slice("A", 5), slice("B", 50), slice("C", 20), slice("D", 10)], 2);

    expect(result.map((s) => s.label)).toEqual(["B", "C", "Other (2)", "Not set"]);
    expect(result[2]).toMatchObject({ value: 15, count: 2 });
  });
});

describe("Sales navigation", () => {
  it("gives Sales one Request center instead of the separate BOQ, RFQ and PO lists, and a page for their targets", () => {
    expect(navLinksFor("SALES").map((l) => [l.href, l.label])).toEqual([
      ["/dashboard", "Overview"],
      ["/dashboard/sales", "Sales pipeline"],
      ["/projects", "Projects"],
      ["/customers", "Customers"],
      ["/targets", "Sales targets"],
      ["/requests", "Request center"],
      ["/quotations", "Quotations"],
    ]);
  });
});

describe("canSeeEmail", () => {
  it("keeps RFQ and PO email with Sales and Purchasing' side; SOA only sees BOQ and what it handed over itself", () => {
    expect(canSeeEmail("SOA", "BOQ", false)).toBe(true);
    expect(canSeeEmail("SOA", "RFQ", false)).toBe(false);
    expect(canSeeEmail("SOA", "PO", false)).toBe(false);
    expect(canSeeEmail("SOA", "RFQ", true)).toBe(true); // an RFQ created by SOA's own handover
    expect(canSeeEmail("SALES", "RFQ", false)).toBe(true);
    expect(canSeeEmail("ADMIN", "PO", false)).toBe(true);
    for (const role of ["PURCHASING", "FINANCE", "MANAGEMENT"] as const) expect(canSeeEmail(role, "RFQ", false)).toBe(false);
  });
});

describe("topSlices ranked by count", () => {
  const slice = (label: string, value: number, count = 1): Slice => ({ key: label, label, value, count, weighted: 0 });

  it("keeps the name with the most projects even when it has little money, which a value ranking would fold into Other", () => {
    const slices = [slice("Component", 0, 21), slice("A", 500, 1), slice("B", 400, 1), slice("C", 300, 1)];
    expect(topSlices(slices, 2).map((s) => s.label)).toEqual(["A", "B", "Other (2)"]);
    expect(topSlices(slices, 2, "count").map((s) => s.label)).toEqual(["Component", "A", "Other (2)"]);
  });
});
