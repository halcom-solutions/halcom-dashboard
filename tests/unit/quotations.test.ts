import { describe, expect, it } from "vitest";
import { allRequiredApproved, currentStep, isApproverOf, isConditionMet, planApprovals, type ApprovalRow } from "@/domain/quotations/approval";
import { parseBoqSheet } from "@/domain/quotations/boq-sheet";
import { calculate, type CalculationInput, type LineInput } from "@/domain/quotations/calculation";
import { checkQuotationConfig, DEFAULT_QUOTATION_CONFIG, guessCategory, ppnExplanation, readQuotationConfig, taxSchemeOf } from "@/domain/quotations/config";
import { jurnalSalesQuotePayload } from "@/domain/quotations/jurnal";
import { bpToPercent, centsToDecimal, divRound, parseMoney, parsePercent, parseQuantity, quantityToDecimal } from "@/domain/quotations/money";
import { formatQuotationNumber, QUOTATION_NUMBER_PATTERN, sequenceOf } from "@/domain/quotations/numbering";
import { isCalculationEditable, isHeaderEditable } from "@/domain/quotations/workflow";

const rp = (rupiah: number) => BigInt(rupiah) * 100n;
const goods = (description: string, quantity: string, sellPrice: string, buyPrice: string | null): LineInput => ({ description, category: "GOODS", quantity, unit: "Unit", sellPrice, buyPrice });

/** PT SIIX EMS Indonesia, Part for IT Support (Non-WAPU workbook, 9 Nov 2026). */
const NON_WAPU = taxSchemeOf(DEFAULT_QUOTATION_CONFIG, "NON_WAPU");
const WAPU = taxSchemeOf(DEFAULT_QUOTATION_CONFIG, "WAPU");
const STEPS = DEFAULT_QUOTATION_CONFIG.steps;
const routeOf = (result: { revenue: bigint; grossMargin: bigint }) => planApprovals(STEPS, result).filter((step) => step.required).map((step) => step.key);

const siix: CalculationInput = {
  taxScheme: NON_WAPU,
  lines: [
    goods("Apacer SSD AS2280P4 M.2 NVMe Gen3 512GB", "5", "1763000", "1468468"),
    goods("Apacer RAM DDR4 16GB 3200MHz", "3", "2379000", "1981982"),
    goods("Thermal Paste MasterGel Pro V2", "2", "144000", "120000"),
    goods("Vention Patch Cord CAT6 1M", "15", "22000", "15315"),
    goods("Vention Patch Cord CAT6 2M", "15", "27000", "18919"),
    goods("Fan Processor Dell Latitude 3410", "2", "222000", "185000"),
  ],
  costs: [{ description: "Pengiriman", amount: "300000" }],
  terms: [{ label: "TOP 30 Hari", sharePercent: "100" }],
};

/** Diskominfo Makassar, HDD Synology option 2 (WAPU workbook, 2 Nov 2026). */
const diskominfo: CalculationInput = {
  taxScheme: WAPU,
  lines: [goods("Synology HAT3320-8T, 8TB SATA HDD 7200RPM", "8", "11250000", "9000000")],
  costs: [{ description: "Pengiriman", amount: "1000000" }],
  terms: [{ label: "Termin 1", sharePercent: "100" }],
};

describe("calculation, against the two workbooks", () => {
  it("reproduces the Non-WAPU sheet, with PPN at 11% instead of the sheet's 10.1%", () => {
    const result = calculate(siix);
    expect(result.issues).toEqual([]);
    expect(result.revenue).toBe(rp(17_419_000));
    expect(result.cogs).toBe(rp(14_411_796));
    expect(result.grossProfit).toBe(rp(3_007_204));
    expect(result.otherCosts).toBe(rp(300_000));
    expect(result.withholdingTotal).toBe(0n);
    expect(result.grossMargin).toBe(rp(2_707_204));
    expect(bpToPercent(result.grossMarginBp!)).toBe("15.54");
    // The sheet had PPN 11% × 11/12 = 10.08% (Rp 1.756.416); the rate is 12% × 11/12 = 11%.
    expect(result.ppn).toBe(rp(1_916_090));
    expect(result.revenueWithPpn).toBe(rp(19_335_090));
    expect(result.termAmounts).toEqual([rp(19_335_090)]);
    expect(routeOf(result)).toEqual(["PURCHASING"]);
    expect(result.lines[0]).toMatchObject({ revenue: rp(8_815_000), cogs: rp(7_342_340), grossProfit: rp(1_472_660) });
  });

  it("reproduces the WAPU sheet: PPh 22 of 1.5% on goods is a project cost", () => {
    const result = calculate(diskominfo);
    expect(result.issues).toEqual([]);
    expect(result.revenue).toBe(rp(90_000_000));
    expect(result.grossProfit).toBe(rp(18_000_000));
    expect(result.withholdings.map((w) => [w.key, w.amount])).toEqual([["PPH22", rp(1_350_000)], ["PPH23", 0n]]);
    expect(result.otherCosts).toBe(rp(2_350_000));
    expect(result.grossMargin).toBe(rp(15_650_000));
    expect(result.ppn).toBe(rp(9_900_000));
    expect(routeOf(result)).toEqual(["PURCHASING"]);
  });

  it("needs the Director below 15% and decides on the gross margin after other costs, not the gross profit", () => {
    const expensive = calculate({ ...diskominfo, costs: [{ description: "Pengiriman", amount: "5000000" }] });
    // Gross profit is still 20%, but the margin after shipping and PPh is 12.94%.
    expect(bpToPercent(expensive.grossProfitBp!)).toBe("20");
    expect(bpToPercent(expensive.grossMarginBp!)).toBe("12.94");
    expect(routeOf(expensive)).toEqual(["PURCHASING", "DIRECTOR"]);
  });

  it("treats exactly 15% as enough for Purchasing alone", () => {
    const gmBelow = { kind: "GM_BELOW", thresholdBp: 1500 } as const;
    expect(isConditionMet(gmBelow, { grossMargin: rp(150_000), revenue: rp(1_000_000) })).toBe(false);
    expect(isConditionMet(gmBelow, { grossMargin: rp(149_999), revenue: rp(1_000_000) })).toBe(true);
    expect(isConditionMet(gmBelow, { grossMargin: -rp(10), revenue: rp(1_000_000) })).toBe(true);
    expect(isConditionMet({ kind: "REVENUE_AT_LEAST", amountCents: String(rp(1_000_000_000)) }, { grossMargin: 0n, revenue: rp(1_000_000_000) })).toBe(true);
  });

  it("withholds PPh 23 on services for every customer, and PPh 22 only for WAPU", () => {
    const service: LineInput = { description: "Instalasi", category: "SERVICES", quantity: "1", unit: "Lot", sellPrice: "10000000", buyPrice: "6000000" };
    const nonWapu = calculate({ ...siix, lines: [service, goods("Switch", "1", "10000000", "8000000")], costs: [] });
    expect(nonWapu.withholdings.map((w) => [w.key, w.amount])).toEqual([["PPH23", rp(200_000)]]);
    const wapu = calculate({ ...diskominfo, lines: [service, goods("Switch", "1", "10000000", "8000000")], costs: [] });
    expect(wapu.withholdings.map((w) => [w.key, w.amount])).toEqual([["PPH22", rp(150_000)], ["PPH23", rp(200_000)]]);
    expect(wapu.otherCosts).toBe(rp(350_000));
    // A scheme an administrator adds later (for example a customer that withholds nothing) needs no code.
    const exempt = calculate({ ...siix, taxScheme: { ...NON_WAPU, withholdings: [] }, lines: [service], costs: [] });
    expect(exempt.withholdingTotal).toBe(0n);
  });

  it("splits the total over the terms and gives the rounding to the last one", () => {
    const result = calculate({ ...siix, terms: [{ label: "DP", sharePercent: "33.33" }, { label: "Kirim", sharePercent: "33.33" }, { label: "BAST", sharePercent: "33.34" }] });
    expect(result.issues).toEqual([]);
    expect(result.termAmounts.reduce((a, b) => a + b, 0n)).toBe(result.revenueWithPpn);
  });

  it("lists what still blocks a submission", () => {
    const result = calculate({ ...siix, lines: [goods("", "0", "abc", null)], terms: [{ label: "DP", sharePercent: "50" }] });
    expect(result.issues).toEqual([
      "Baris 1: tulis line item.",
      "Baris 1: qty harus lebih dari 0.",
      "Baris 1: harga jual satuan belum benar.",
      "Baris 1: harga beli satuan (COGS) belum diisi.",
      "Total porsi termin pembayaran customer harus 100%.",
      "Total revenue harus lebih dari 0.",
    ]);
    expect(calculate({ ...siix, lines: [] }).issues).toContain("Tambahkan paling sedikit satu baris revenue.");
    // A buy price of zero is a real price (an item the company already owns), not a missing one.
    expect(calculate({ ...siix, lines: [goods("Stok sendiri", "1", "100000", "0")] }).issues).toEqual([]);
  });
});

describe("money", () => {
  it("parses plain amounts, quantities and percentages exactly", () => {
    expect(parseMoney("1763000")).toBe(176_300_000n);
    expect(parseMoney("1763000.5")).toBe(176_300_050n);
    expect(parseMoney(1468468)).toBe(146_846_800n);
    for (const bad of ["", "-1", "1.234.567", "1,5", "1e5", "0.001", null, undefined, Number.NaN]) expect(parseMoney(bad), String(bad)).toBeNull();
    expect(parseQuantity("2.5")).toBe(2500n);
    expect(parseQuantity("0.0001")).toBeNull();
    expect(parsePercent("33.33")).toBe(3333n);
    expect(parsePercent("100.01")).toBeNull();
  });

  it("rounds half away from zero and writes decimals back", () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(centsToDecimal(176_300_050n)).toBe("1763000.50");
    expect(centsToDecimal(-5n)).toBe("-0.05");
    expect(quantityToDecimal(15_000n)).toBe("15");
    expect(quantityToDecimal(2500n)).toBe("2.5");
  });
});

describe("configuration", () => {
  it("defaults to the workbooks: PPN 12% on a base of 11/12 (11%), Purchasing always, the Director below 15%", () => {
    expect(ppnExplanation(NON_WAPU)).toBe("12% × 11/12 = 11%");
    expect(readQuotationConfig(undefined)).toEqual(DEFAULT_QUOTATION_CONFIG);
    expect(readQuotationConfig({ categories: "nonsense" })).toEqual(DEFAULT_QUOTATION_CONFIG);
    expect(checkQuotationConfig(DEFAULT_QUOTATION_CONFIG)).toEqual({ ok: true, value: DEFAULT_QUOTATION_CONFIG });
  });

  it("refuses a configuration with broken references or without a step that always applies", () => {
    const broken = (patch: Partial<typeof DEFAULT_QUOTATION_CONFIG>) => checkQuotationConfig({ ...DEFAULT_QUOTATION_CONFIG, ...patch });
    expect(broken({ defaultTaxScheme: "NOPE" })).toMatchObject({ ok: false });
    expect(broken({ categories: [] })).toMatchObject({ ok: false });
    expect(broken({ taxSchemes: [{ ...WAPU, withholdings: [{ key: "X", label: "PPh X", rateBp: 100, categories: ["UNKNOWN"] }] }], defaultTaxScheme: "WAPU" })).toMatchObject({ ok: false });
    expect(broken({ steps: STEPS.filter((step) => step.key === "DIRECTOR") })).toMatchObject({ ok: false, message: expect.stringContaining("selalu") });
    expect(broken({ steps: [STEPS[0]!, STEPS[0]!] })).toMatchObject({ ok: false });
  });

  it("adds a Komisaris above a revenue without code, and plans the steps from the figures", () => {
    const komisaris = { ...STEPS[1]!, key: "COMMISSIONER", label: "Disetujui (Komisaris)", acknowledgeLabel: "Diketahui (Komisaris)", condition: { kind: "REVENUE_AT_LEAST", amountCents: String(rp(5_000_000_000)) }, whenNotRequired: "SKIP" } as const;
    const config = checkQuotationConfig({ ...DEFAULT_QUOTATION_CONFIG, steps: [...STEPS, komisaris] });
    if (!config.ok) throw new Error(config.message);
    const small = planApprovals(config.value.steps, { revenue: rp(100_000_000), grossMargin: rp(20_000_000) });
    expect(small.map((step) => [step.key, step.required])).toEqual([["PURCHASING", true], ["DIRECTOR", false]]);
    const big = planApprovals(config.value.steps, { revenue: rp(6_000_000_000), grossMargin: rp(600_000_000) });
    expect(big.map((step) => [step.key, step.required, step.position])).toEqual([["PURCHASING", true, 1], ["DIRECTOR", true, 2], ["COMMISSIONER", true, 3]]);
  });

  it("puts a BOQ item in a category by its words", () => {
    const categories = DEFAULT_QUOTATION_CONFIG.categories;
    expect(guessCategory(categories, "Jasa", "JASA", "Instalasi & Konfigurasi Server")).toBe("SERVICES");
    expect(guessCategory(categories, "Support", null, "Technical Support Service Co-Care")).toBe("SERVICES");
    expect(guessCategory(categories, "Network Equipment", "STORAGE", "Huawei CloudEngine")).toBe("GOODS");
  });
});

describe("approval steps", () => {
  const rows: ApprovalRow[] = [
    { position: 1, key: "PURCHASING", required: true, status: "APPROVED", approver: { kind: "ROLE", role: "PURCHASING" }, mayEditCosts: true },
    { position: 2, key: "DIRECTOR", required: true, status: "PENDING", approver: { kind: "USERS", userIds: ["u-dzaki"] }, mayEditCosts: false },
    { position: 3, key: "COMMISSIONER", required: false, status: "PENDING", approver: { kind: "USERS", userIds: ["u-nadirman"] }, mayEditCosts: false },
  ];

  it("waits for the first open step that must approve; a step that is only told never holds it up", () => {
    expect(currentStep(rows)?.key).toBe("DIRECTOR");
    expect(allRequiredApproved(rows)).toBe(false);
    const after = rows.map((row) => (row.key === "DIRECTOR" ? { ...row, status: "APPROVED" as const } : row));
    expect(currentStep(after)).toBeNull();
    expect(allRequiredApproved(after)).toBe(true);
  });

  it("knows its approvers by role or by name", () => {
    expect(isApproverOf(rows[0]!.approver, { id: "x", role: "PURCHASING" })).toBe(true);
    expect(isApproverOf(rows[1]!.approver, { id: "u-dzaki", role: "SALES" })).toBe(true);
    expect(isApproverOf(rows[1]!.approver, { id: "someone", role: "SUPERADMIN" })).toBe(false);
  });
});

describe("BOQ worksheet (Kemenkebud layout)", () => {
  const headers = ["No", "Nama Barang", "Spesifikasi", "Kategori", "Uom", "Qty", "Cost Excl PPN", "Total Cost Excl PPN", "Cost Incl PPN", "Total Cost Incl PPN", "Margin", "Selling Price Excl PPN", "", "Total Selling Price Excl PPN", "Margin (Rp)", "Margin (%)", "Distri", "Stock", "Notes", "Add"];
  const row = (cells: Record<number, string>) => headers.map((_, index) => cells[index] ?? "");
  const sheet = {
    headers,
    rowNumbers: [2, 3, 4, 5, 6, 7, 40, 62, 92],
    rows: [
      row({ 0: "5", 1: "CCTV" }),
      row({ 0: "5.1", 1: "Hikvision DS-2CD2143G2-LI", 2: "IP Camera 4 MP 2.8mm", 3: "CCTV", 4: "Unit", 5: "2", 6: "2730700", 11: "3194919", 13: "6390000", 16: "Megabintang", 18: "", 19: "TRUE" }),
      row({ 0: "5.4", 1: "Toshiba 12TB HDD", 3: "Harddisk", 4: "Unit", 5: "2", 6: "9369369.36936937", 13: "21924000", 16: "Megabintang", 17: "Ready", 19: "TRUE" }),
      row({ 0: "5.5", 1: "Optional item", 4: "Unit", 5: "1", 19: "FALSE" }),
      row({ 0: "7", 1: "JASA" }),
      row({ 0: "7.1", 1: "Instalasi & Konfigurasi Server Xfusion", 2: "per unit", 3: "Jasa", 4: "Unit", 5: "2", 6: "75000000", 13: "175500000", 19: "TRUE" }),
      // The old summary block under the table (G34:T93: revenue per item, COGS per vendor, signatures) is no longer used: nothing in the
      // Nama Barang column, so none of it becomes an item.
      row({ 15: "1", 16: "Huawei OceanStor Dorado 3000 V7 (Site 1)", 18: "1", 19: "16373194860" }),
      row({ 16: "Total Revenue", 18: "Incl", 19: "21000000000" }),
      row({ 16: "Dzaki Yudi Ananda", 19: "Nadirman" }),
    ],
  };

  it("reads items under their group headings, with the rounded selling price per unit, and leaves out what Add excludes and the old summary block", () => {
    const result = parseBoqSheet(sheet);
    if (!result.ok) throw new Error(result.message);
    expect(result.skipped).toBe(1);
    expect(result.items.map((item) => [item.groupLabel, item.name, item.uom, item.quantity, item.buyPrice, item.sellPrice, item.vendor])).toEqual([
      ["CCTV", "Hikvision DS-2CD2143G2-LI", "Unit", "2", "2730700", "3195000", "Megabintang"],
      ["CCTV", "Toshiba 12TB HDD", "Unit", "2", "9369369.37", "10962000", "Megabintang"],
      ["JASA", "Instalasi & Konfigurasi Server Xfusion", "Unit", "2", "75000000", "87750000", null],
    ]);
    expect(result.items[1]?.note).toBe("Stock: Ready");
    expect(result.items[0]?.specification).toBe("IP Camera 4 MP 2.8mm");
  });

  it("reads a BOQ from SOA without prices, and refuses a sheet without names or quantities", () => {
    const soa = parseBoqSheet({ headers: ["Nama Unit", "Spesifikasi", "Satuan", "Qty"], rowNumbers: [2], rows: [["Switch 48 port", "48x10GE", "Unit", "3"]] });
    expect(soa).toMatchObject({ ok: true, items: [{ name: "Switch 48 port", specification: "48x10GE", uom: "Unit", quantity: "3", buyPrice: null, sellPrice: null }] });
    expect(parseBoqSheet({ headers: ["Spesifikasi", "Qty"], rowNumbers: [], rows: [] })).toMatchObject({ ok: false });
  });
});

describe("workflow", () => {
  it("changes figures only in a draft, and the customer header until the customer chose it", () => {
    expect(isCalculationEditable("DRAFT")).toBe(true);
    for (const status of ["PENDING", "APPROVED", "CANCELLED"] as const) expect(isCalculationEditable(status)).toBe(false);
    expect(isHeaderEditable("APPROVED", false)).toBe(true);
    expect(isHeaderEditable("APPROVED", true)).toBe(false);
    expect(isHeaderEditable("PENDING", false)).toBe(false);
  });
});

describe("numbering like Jurnal", () => {
  it("writes QUO-YY-MM-NNNNN from the Jakarta date", () => {
    expect(formatQuotationNumber(10_001, new Date("2026-10-15T03:00:00Z"))).toBe("QUO-26-10-10001");
    // 31 October 18:00 UTC is already 1 November in Jakarta.
    expect(formatQuotationNumber(10_002, new Date("2026-10-31T18:00:00Z"))).toBe("QUO-26-11-10002");
    expect(formatQuotationNumber(123_456, new Date("2027-01-02T03:00:00Z"))).toBe("QUO-27-01-123456");
    expect(QUOTATION_NUMBER_PATTERN.test("QUO-26-10-10001")).toBe(true);
    expect(sequenceOf("QUO-26-10-10042")).toBe(10_042);
    expect(sequenceOf("Sales Quote #12")).toBeNull();
  });
});

describe("Jurnal sales quote body", () => {
  it("carries the number, the link back and one line per revenue row", () => {
    const body = jurnalSalesQuotePayload({
      id: "0193f6c0-0000-7000-8000-000000000001",
      number: "QUO-26-11-10001",
      transactionDate: "2026-11-09",
      expiryDate: "2026-12-09",
      customerName: "PT SIIX EMS Indonesia",
      email: null,
      billingAddress: "Kawasan Industri",
      paymentTerm: "TOP 30 Hari",
      customerReference: "PR-123",
      message: null,
      memo: "HIT-PROJ-101",
      lines: [
        { description: "Apacer SSD", specification: null, category: "GOODS", quantity: "5", unit: "Unit", sellPrice: "1763000.00" },
        { description: "Instalasi", specification: "2 hari kerja\nTermasuk konfigurasi", category: "SERVICES", quantity: "1", unit: "Lot", sellPrice: "5000000" },
      ],
    }, { categories: DEFAULT_QUOTATION_CONFIG.categories });
    expect(body.sales_quote).toMatchObject({
      transaction_no: "QUO-26-11-10001",
      custom_id: "0193f6c0-0000-7000-8000-000000000001",
      person_name: "PT SIIX EMS Indonesia",
      term_name: "TOP 30 Hari",
      memo: "Ref. customer: PR-123\nHIT-PROJ-101",
      transaction_lines_attributes: [
        { product_name: "Barang", description: "Apacer SSD", quantity: 5, rate: 1_763_000, line_tax_name: "PPN" },
        { product_name: "Jasa", description: "Instalasi\n2 hari kerja\nTermasuk konfigurasi", quantity: 1, rate: 5_000_000, line_tax_name: "PPN" },
      ],
    });
    expect(body.sales_quote).not.toHaveProperty("email");
  });
});
