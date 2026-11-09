import { describe, expect, it } from "vitest";
import { can } from "@/domain/access/permissions";
import { ROLES } from "@/domain/access/roles";
import { distributorLabel, parsePayment, paymentTermsLabel } from "@/domain/distributors/payment";
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
    expect(distributorLabel({ name: "PT Ingram Micro", alias: "Ingram" })).toBe("PT Ingram Micro (Ingram)");
    expect(distributorLabel({ name: "PT Ingram Micro", alias: null })).toBe("PT Ingram Micro");
  });
});

describe("distributor sheet layout", () => {
  it("finds columns by header name and needs only the name", () => {
    expect(mapSheetColumns([" nama ", "ALIAS", "Pembayaran"])).toEqual({ ok: true, index: { name: 0, alias: 1, payment: 2 } });
    expect(mapSheetColumns(["Alias", "Pembayaran"])).toMatchObject({ ok: false });
  });

  it("exports in the same order as the template so an export can be uploaded again", () => {
    expect(sheetRowOf({ id: "i", name: "N", alias: null, paymentType: "TOP", topDays: 7, isActive: false })).toEqual(["i", "N", null, "TOP", 7, "Nonaktif"]);
    expect(sheetHeaders()).toHaveLength(6);
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
