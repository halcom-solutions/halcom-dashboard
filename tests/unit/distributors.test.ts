import { describe, expect, it } from "vitest";
import { can } from "@/domain/access/permissions";
import { ROLES } from "@/domain/access/roles";
import { distributorLabel, parsePayment, parseTerms, parseTermsText, paymentTermsLabel, termsLabel } from "@/domain/distributors/payment";
import { mapSheetColumns, parseStatus, sheetHeaders, sheetRowOf } from "@/domain/distributors/sheet";
import { navLinksFor } from "@/features/navigation/links";

describe("distributor payment terms", () => {
  it("keeps TOP days for TOP only and refuses TOP without valid days", () => {
    expect(parsePayment("CBD", "")).toEqual({ ok: true, paymentType: "CBD", topDays: null });
    expect(parsePayment("COD", "30")).toEqual({ ok: true, paymentType: "COD", topDays: null });
    expect(parsePayment("TOP", "14")).toEqual({ ok: true, paymentType: "TOP", topDays: 14 });
    expect(parsePayment("TOP", 30)).toEqual({ ok: true, paymentType: "TOP", topDays: 30 });
    for (const days of ["", "0", "-7", "366", "7.5", "abc", null, undefined]) expect(parsePayment("TOP", days), String(days)).toMatchObject({ ok: false });
    expect(parsePayment("NET30", "30")).toMatchObject({ ok: false });
  });

  it("writes terms and names the way people read them", () => {
    expect(paymentTermsLabel({ paymentType: "TOP", topDays: 14 })).toBe("TOP 14 hari");
    expect(paymentTermsLabel({ paymentType: "CBD", topDays: null })).toBe("CBD");
    expect(termsLabel([{ paymentType: "CBD", topDays: null }, { paymentType: "TOP", topDays: 30 }, { paymentType: "TOP", topDays: 60 }])).toBe("CBD; TOP 30 hari; TOP 60 hari");
    expect(distributorLabel({ name: "PT Ingram Micro", alias: "Ingram" })).toBe("PT Ingram Micro (Ingram)");
    expect(distributorLabel({ name: "PT Ingram Micro", alias: null })).toBe("PT Ingram Micro");
  });

  it("takes a list of terms: at least one, no repeats, each valid, the order kept", () => {
    expect(parseTerms([{ paymentType: "TOP", topDays: "30" }, { paymentType: "TOP", topDays: "60" }, { paymentType: "CBD", topDays: "" }])).toEqual({
      ok: true,
      terms: [{ paymentType: "TOP", topDays: 30 }, { paymentType: "TOP", topDays: 60 }, { paymentType: "CBD", topDays: null }],
    });
    expect(parseTerms([])).toMatchObject({ ok: false });
    expect(parseTerms(undefined)).toMatchObject({ ok: false });
    expect(parseTerms([{ paymentType: "TOP", topDays: "30" }, { paymentType: "TOP", topDays: "30" }])).toMatchObject({ ok: false });
    expect(parseTerms([{ paymentType: "TOP", topDays: "" }])).toMatchObject({ ok: false });
    expect(parseTerms(Array.from({ length: 11 }, (_, i) => ({ paymentType: "TOP", topDays: String(i + 1) })))).toMatchObject({ ok: false });
  });

  it("reads the terms written in one sheet cell, and the old separate days column", () => {
    expect(parseTermsText("CBD; TOP 30; top 60 hari")).toEqual({ ok: true, terms: [{ paymentType: "CBD", topDays: null }, { paymentType: "TOP", topDays: 30 }, { paymentType: "TOP", topDays: 60 }] });
    expect(parseTermsText("TOP30,COD")).toMatchObject({ ok: true });
    expect(parseTermsText("TOP", "14")).toEqual({ ok: true, terms: [{ paymentType: "TOP", topDays: 14 }] });
    expect(parseTermsText("TOP")).toMatchObject({ ok: false });
    expect(parseTermsText("NET 30")).toMatchObject({ ok: false });
    expect(parseTermsText("  ")).toMatchObject({ ok: false });
  });
});

describe("distributor sheet layout", () => {
  it("finds columns by header name and needs only the name", () => {
    expect(mapSheetColumns([" nama ", "ALIAS", "Pembayaran", "TOP (hari)"])).toEqual({ ok: true, index: { name: 0, alias: 1, payment: 2, topDays: 3 } });
    expect(mapSheetColumns(["Alias", "Pembayaran"])).toMatchObject({ ok: false });
  });

  it("exports in the same order as the template so an export can be uploaded again", () => {
    const terms = [{ paymentType: "TOP", topDays: 7 }, { paymentType: "CBD", topDays: null }] as const;
    expect(sheetRowOf({ id: "i", name: "N", alias: null, terms, isActive: false })).toEqual(["i", "N", null, "TOP 7 hari; CBD", "Nonaktif"]);
    expect(sheetHeaders()).toHaveLength(5);
    // what is exported is what is read back
    expect(parseTermsText("TOP 7 hari; CBD")).toMatchObject({ ok: true, terms });
  });

  it("reads the status cell", () => {
    expect(parseStatus("")).toBeNull();
    expect(parseStatus("Aktif")).toBe(true);
    expect(parseStatus("nonaktif")).toBe(false);
    expect(parseStatus("mungkin")).toBe("invalid");
  });
});

describe("who keeps the distributor list", () => {
  it("is Purchasing and the administrators, and Purchasing sees it in its menu", () => {
    for (const role of ROLES) expect(can(role, "distributors.manage"), role).toBe(["PURCHASING", "ADMIN", "SUPERADMIN"].includes(role));
    expect(navLinksFor("PURCHASING").map((link) => link.href)).toContain("/distributors");
    expect(navLinksFor("SALES").map((link) => link.href)).not.toContain("/distributors");
  });
});
