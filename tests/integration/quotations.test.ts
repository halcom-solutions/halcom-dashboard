import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { DEFAULT_QUOTATION_CONFIG, type QuotationConfig } from "@/domain/quotations/config";
import { QUOTATION_NUMBER_PATTERN, sequenceOf } from "@/domain/quotations/numbering";
import { getDb } from "@/lib/db";
import { createDistributor } from "@/server/distributors/service";
import { toXlsx } from "@/server/export/xlsx";
import { importRequestItems, readCalculationSheet, saveRequestItems } from "@/server/quotations/boq-items";
import { getQuotationDetail, listQuotations } from "@/server/quotations/queries";
import {
  acknowledgeQuotation,
  approveQuotation,
  cancelQuotation,
  chooseQuotation,
  createQuotation,
  duplicateQuotation,
  recallQuotation,
  reopenQuotation,
  returnQuotation,
  reviseCosts,
  saveCalculation,
  saveHeader,
  submitQuotation,
  unchooseQuotation,
} from "@/server/quotations/service";
import { getNextQuotationSequence, saveQuotationConfig, setNextQuotationSequence } from "@/server/quotations/settings";
import { createProject, createRequest } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();
const tag = () => randomBytes(4).toString("hex");
type TestActor = { id: string; role: Role };
const actorOf = async (role: Role): Promise<TestActor> => {
  const user = await makeUser(role);
  return { id: user.id, role: user.role };
};

let admin: TestActor;
let purchasing: TestActor;
let director: TestActor;
let commissioner: TestActor;

/** The default rules with the Director named, and a Komisaris for sales from Rp 5 miliar (as on the Kemenkebud BOQ). */
function testConfig(): QuotationConfig {
  return {
    ...DEFAULT_QUOTATION_CONFIG,
    steps: [
      DEFAULT_QUOTATION_CONFIG.steps[0]!,
      { ...DEFAULT_QUOTATION_CONFIG.steps[1]!, approver: { kind: "USERS", userIds: [director.id] } },
      {
        key: "COMMISSIONER",
        label: "Disetujui (Komisaris)",
        acknowledgeLabel: "Diketahui (Komisaris)",
        approver: { kind: "USERS", userIds: [commissioner.id] },
        condition: { kind: "REVENUE_AT_LEAST", amountCents: "500000000000" },
        whenNotRequired: "SKIP",
        mayEditCosts: false,
      },
    ],
  };
}

beforeAll(async () => {
  admin = await actorOf("ADMIN");
  purchasing = await actorOf("PURCHASING");
  // The Director is a salesperson too, as at Halcom.
  director = await actorOf("SALES");
  commissioner = await actorOf("MANAGEMENT");
  const saved = await saveQuotationConfig(db, admin, testConfig());
  if (!saved.ok) throw new Error(saved.message);
});

afterAll(async () => {
  await db.$disconnect();
});

async function projectOf(owner: TestActor) {
  const endUserCompany = `PT Quote ${tag()}`;
  const created = await createProject(db, owner, { endUserCompany, name: `Part for IT Support ${tag()}` });
  if (!created.ok) throw new Error(created.message);
  return { ...created.value, endUserCompany };
}

async function draftFor(owner: TestActor, projectId?: string) {
  const id = projectId ?? (await projectOf(owner)).id;
  const created = await createQuotation(db, owner, { projectId: id });
  if (!created.ok) throw new Error(created.message);
  return { projectId: id, ...created.value };
}

/** The Non-WAPU workbook of PT SIIX (GM 15.54 %), or a cheaper sale whose margin falls below 15 %. */
function siixLines(sellFirst = "1763000") {
  const goods = (description: string, quantity: string, sellPrice: string, buyPrice: string | null) => ({
    groupLabel: "",
    description,
    specification: "",
    category: "GOODS",
    quantity,
    unit: "Unit",
    sellPrice,
    buyPrice,
    costDescription: "",
    distributorId: "",
    vendorName: "SMI",
    vendorTerms: "30 Hari",
    costNote: "",
  });
  return [
    goods("Apacer SSD 512GB", "5", sellFirst, "1468468"),
    goods("Apacer RAM 16GB", "3", "2379000", "1981982"),
    goods("Thermal Paste", "2", "144000", "120000"),
    goods("Patch Cord 1M", "15", "22000", "15315"),
    goods("Patch Cord 2M", "15", "27000", "18919"),
    goods("Fan Dell 3410", "2", "222000", "185000"),
  ];
}

const calculationOf = (quotationId: string, overrides: Record<string, unknown> = {}) => ({
  quotationId,
  taxScheme: "NON_WAPU",
  optionLabel: "Opsi 1",
  rfqRequestId: "",
  lines: siixLines(),
  costs: [{ description: "Pengiriman", note: "", amount: "300000" }, { description: "", note: "", amount: "" }],
  terms: [{ label: "TOP 30 Hari", sharePercent: "100", note: "Setelah invoice diterima" }],
  ...overrides,
});

const steps = async (quotationId: string) =>
  (await db.quotationApproval.findMany({ where: { quotationId }, orderBy: { position: "asc" } })).map((row) => [row.stepKey, row.required, row.status]);

/** Submits and lets Purchasing approve its step. */
async function submitAndCheck(owner: TestActor, quotationId: string) {
  const submitted = await submitQuotation(db, owner, { quotationId });
  if (!submitted.ok) throw new Error(submitted.message);
  const checked = await approveQuotation(db, purchasing, { quotationId, note: "", picId: "" });
  if (!checked.ok) throw new Error(checked.message);
  return checked.value;
}

describe("starting a quotation", () => {
  it("numbers it like Jurnal and fills in what it can", async () => {
    const sales = await actorOf("SALES");
    const project = await projectOf(sales);
    const rfq = await createRequest(db, sales, { projectId: project.id, type: "RFQ", title: "Prices" });
    if (!rfq.ok) throw new Error(rfq.message);

    const first = await draftFor(sales, project.id);
    const second = await draftFor(sales, project.id);
    expect(first.number).toMatch(QUOTATION_NUMBER_PATTERN);
    expect(sequenceOf(second.number)).toBe(sequenceOf(first.number)! + 1);

    const row = await db.quotation.findUniqueOrThrow({ where: { id: first.id }, include: { costs: { orderBy: { position: "asc" } }, terms: true } });
    expect(row).toMatchObject({ status: "DRAFT", optionLabel: "Opsi 1", customerName: project.endUserCompany, rfqRequestId: rfq.value.id, taxScheme: "NON_WAPU", configSnapshot: null });
    expect(row.memo).toContain(project.code);
    expect((row.expiryDate!.getTime() - row.transactionDate.getTime()) / 86_400_000).toBe(DEFAULT_QUOTATION_CONFIG.document.validityDays);
    expect(row.costs.map((cost) => cost.description)).toEqual(["Pengiriman", "Instalasi / teknisi", "Akomodasi & perjalanan", "Komisi / fee / lain-lain"]);
    expect(row.terms.map((term) => [term.label, term.sharePercent.toString()])).toEqual([["Termin 1", "100"]]);
    expect((await db.quotation.findUniqueOrThrow({ where: { id: second.id } })).optionLabel).toBe("Opsi 2");
  });

  it("is for the project's salesperson and the administrators only", async () => {
    const owner = await actorOf("SALES");
    const project = await projectOf(owner);
    expect(await createQuotation(db, await actorOf("SALES"), { projectId: project.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    for (const role of ["SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      expect(await createQuotation(db, await actorOf(role), { projectId: project.id }), role).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect((await createQuotation(db, admin, { projectId: project.id })).ok).toBe(true);
  });

  it("copies the e-mail, address and tax scheme of the customer's last quotation", async () => {
    const sales = await actorOf("SALES");
    const first = await draftFor(sales);
    const row = await db.quotation.findUniqueOrThrow({ where: { id: first.id } });
    expect((await saveCalculation(db, sales, calculationOf(first.id, { taxScheme: "WAPU" }))).ok).toBe(true);
    const header = await saveHeader(db, sales, {
      quotationId: first.id,
      customerName: row.customerName,
      email: "Procurement@Customer.example",
      billingAddress: "Jl. Contoh 1\nMakassar",
      transactionDate: row.transactionDate.toISOString().slice(0, 10),
      expiryDate: "",
      paymentTerm: "TOP 30 Hari",
      customerReference: "PR-77",
      message: "",
      memo: "",
    });
    if (!header.ok) throw new Error(header.message);
    const next = await draftFor(sales, first.projectId);
    expect(await db.quotation.findUniqueOrThrow({ where: { id: next.id } })).toMatchObject({ email: "procurement@customer.example", billingAddress: "Jl. Contoh 1\nMakassar", taxScheme: "WAPU", paymentTerm: "TOP 30 Hari" });
  });
});

describe("items SOA writes in a BOQ", () => {
  it("fill a new calculation: unit name, specification, unit and quantity in their groups, the category guessed", async () => {
    const sales = await actorOf("SALES");
    const soa = await actorOf("SOA");
    const project = await projectOf(sales);
    const boq = await createRequest(db, sales, { projectId: project.id, type: "BOQ", title: "BOQ DC" });
    if (!boq.ok) throw new Error(boq.message);

    const items = [
      { groupLabel: "STORAGE", name: "Huawei OceanStor Dorado 3000 V7", specification: "2U, Dual Controller, NVMe", categoryLabel: "Storage", uom: "Unit", quantity: "1", note: "" },
      { groupLabel: "JASA", name: "Instalasi & Konfigurasi Server Xfusion", specification: "per unit", categoryLabel: "Jasa", uom: "Unit", quantity: "2", note: "" },
    ];
    expect(await saveRequestItems(db, sales, { requestId: boq.value.id, items })).toMatchObject({ ok: false });
    expect(await saveRequestItems(db, soa, { requestId: boq.value.id, items: [{ ...items[0]!, quantity: "0" }] })).toMatchObject({ ok: false });
    expect(await saveRequestItems(db, soa, { requestId: boq.value.id, items })).toMatchObject({ ok: true, value: { count: 2 } });

    const draft = await draftFor(sales, project.id);
    const row = await db.quotation.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: { orderBy: { position: "asc" } } } });
    expect(row.boqRequestId).toBe(boq.value.id);
    expect(row.lines.map((l) => [l.groupLabel, l.description, l.specification, l.category, l.unit, l.quantity.toString(), l.sellPrice.toString(), l.buyPrice])).toEqual([
      ["STORAGE", "Huawei OceanStor Dorado 3000 V7", "2U, Dual Controller, NVMe", "GOODS", "Unit", "1", "0", null],
      ["JASA", "Instalasi & Konfigurasi Server Xfusion", "per unit", "SERVICES", "Unit", "2", "0", null],
    ]);
  });

  it("are imported from the BOQ workbook by SOA, and the same workbook fills Sales' form with prices and vendors", async () => {
    const sales = await actorOf("SALES");
    const soa = await actorOf("SOA");
    const project = await projectOf(sales);
    const boq = await createRequest(db, sales, { projectId: project.id, type: "BOQ", title: "BOQ CCTV" });
    if (!boq.ok) throw new Error(boq.message);
    const vendor = `Megabintang ${tag()}`;
    const distributor = await createDistributor(db, purchasing, { name: vendor, terms: [{ paymentType: "TOP", topDays: 30 }] });
    if (!distributor.ok) throw new Error(distributor.message);
    const workbook = toXlsx(
      "BOQ",
      ["No", "Nama Barang", "Spesifikasi", "Kategori", "Uom", "Qty", "Cost Excl PPN", "Total Selling Price Excl PPN", "Distri", "Add"],
      [
        ["5", "CCTV", null, null, null, null, null, null, null, null],
        ["5.1", "Hikvision DS-2CD2143G2-LI", "IP Camera 4 MP 2.8mm", "CCTV", "Unit", 2, 2730700, 6390000, vendor, "TRUE"],
        ["5.2", "Optional", null, "CCTV", "Unit", 1, 100, 200, null, "FALSE"],
      ],
    );
    const imported = await importRequestItems(db, soa, { requestId: boq.value.id, bytes: workbook });
    expect(imported).toMatchObject({ ok: true, value: { count: 1, skipped: 1 } });
    const stored = await db.requestItem.findMany({ where: { requestId: boq.value.id } });
    expect(stored.map((item) => [item.groupLabel, item.name, item.uom, item.quantity.toString()])).toEqual([["CCTV", "Hikvision DS-2CD2143G2-LI", "Unit", "2"]]);

    const read = await readCalculationSheet(db, sales, workbook);
    if (!read.ok) throw new Error(read.message);
    expect(read.value.lines).toEqual([
      expect.objectContaining({ groupLabel: "CCTV", description: "Hikvision DS-2CD2143G2-LI", quantity: "2", buyPrice: "2730700", sellPrice: "3195000", distributorId: distributor.value.id, vendorTerms: "TOP 30 hari", vendorName: "" }),
    ]);
    expect(await readCalculationSheet(db, soa, workbook)).toMatchObject({ ok: false });
  });
});

describe("the calculation", () => {
  it("stores the workbook's figures and fills the vendor's TOP from the Distributors master", async () => {
    const sales = await actorOf("SALES");
    const { id } = await draftFor(sales);
    const distributor = await createDistributor(db, purchasing, { name: `PT Agres ${tag()}`, terms: [{ paymentType: "TOP", topDays: 30 }] });
    if (!distributor.ok) throw new Error(distributor.message);
    const lines = siixLines();
    lines[1] = { ...lines[1]!, distributorId: distributor.value.id, vendorName: "", vendorTerms: "" };

    const saved = await saveCalculation(db, sales, calculationOf(id, { lines }));
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.value.issues).toEqual([]);
    const row = await db.quotation.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { position: "asc" } }, costs: true } });
    expect(row.revenue.toString()).toBe("17419000");
    expect(row.grossMargin.toString()).toBe("2707204");
    expect(row.grossMarginBp).toBe(1554);
    expect(row.lines[1]).toMatchObject({ distributorId: distributor.value.id, vendorTerms: "TOP 30 hari", vendorName: null });
    expect(row.costs).toHaveLength(1);

    expect(await saveCalculation(db, sales, calculationOf(id, { taxScheme: "UNKNOWN" }))).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await saveCalculation(db, sales, calculationOf(id, { lines: [{ ...siixLines()[0]!, category: "NOPE" }] }))).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await saveCalculation(db, await actorOf("SALES"), calculationOf(id))).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("cannot be submitted with a buy price missing or terms short of 100%", async () => {
    const sales = await actorOf("SALES");
    const { id } = await draftFor(sales);
    const lines = siixLines();
    lines[0] = { ...lines[0]!, buyPrice: null };
    expect((await saveCalculation(db, sales, calculationOf(id, { lines }))).ok).toBe(true);
    expect(await submitQuotation(db, sales, { quotationId: id })).toMatchObject({ ok: false, code: "INVALID_STATE", message: expect.stringContaining("harga beli") });
    expect((await saveCalculation(db, sales, calculationOf(id, { terms: [{ label: "DP", sharePercent: "50", note: "" }] }))).ok).toBe(true);
    expect(await submitQuotation(db, sales, { quotationId: id })).toMatchObject({ ok: false, message: expect.stringContaining("100%") });
  });
});

describe("approval, by the configured steps", () => {
  it("at or above 15%: Purchasing approves it, the Director is only told, and the figures are frozen with the rules", async () => {
    const sales = await actorOf("SALES");
    const { id, number } = await draftFor(sales);
    expect((await saveCalculation(db, sales, calculationOf(id))).ok).toBe(true);
    expect(await submitQuotation(db, sales, { quotationId: id })).toMatchObject({ ok: true, value: { steps: ["Diperiksa (Purchasing)"] } });
    expect(await steps(id)).toEqual([["PURCHASING", true, "PENDING"], ["DIRECTOR", false, "PENDING"]]);
    expect((await db.quotation.findUniqueOrThrow({ where: { id } })).configSnapshot).toMatchObject({ taxScheme: { key: "NON_WAPU" } });
    await expect(db.notification.count({ where: { recipientId: purchasing.id, kind: "quotation.awaiting", href: `/quotations/${number}` } })).resolves.toBe(1);

    // Under approval: Sales cannot change the figures, and only the approver whose turn it is decides.
    expect(await saveCalculation(db, sales, calculationOf(id))).toMatchObject({ ok: false, code: "INVALID_STATE" });
    for (const other of [sales, director, admin]) expect(await approveQuotation(db, other, { quotationId: id, note: "", picId: "" })).toMatchObject({ ok: false });

    const picName = `Gita ${tag()}`;
    const pic = await db.pic.create({ data: { name: picName, nameKey: picName.toLowerCase(), team: "PURCHASING" } });
    expect(await approveQuotation(db, purchasing, { quotationId: id, note: "Harga sesuai RFQ.", picId: pic.id })).toMatchObject({ ok: true, value: { status: "APPROVED" } });
    expect(await db.quotation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "APPROVED" });
    expect(await db.quotationApproval.findFirstOrThrow({ where: { quotationId: id, stepKey: "PURCHASING" } })).toMatchObject({ status: "APPROVED", decidedByPicId: pic.id, note: "Harga sesuai RFQ." });
    await expect(db.notification.count({ where: { recipientId: director.id, kind: "quotation.approved", href: `/quotations/${number}` } })).resolves.toBe(1);

    const detail = await getQuotationDetail(db, sales, number);
    expect(detail?.actions.has("editCalculation")).toBe(false);
    expect(detail?.actions.has("choose")).toBe(true);
    expect((await getQuotationDetail(db, director, number))?.actions.has("acknowledge")).toBe(true);
    expect((await acknowledgeQuotation(db, director, { quotationId: id, note: "Ok", picId: "" })).ok).toBe(true);
    expect(await steps(id)).toEqual([["PURCHASING", true, "APPROVED"], ["DIRECTOR", false, "ACKNOWLEDGED"]]);
  });

  it("below 15%: the Director must approve after Purchasing; nobody else can stand in", async () => {
    const sales = await actorOf("SALES");
    const { id, number } = await draftFor(sales);
    // Selling the SSD at 1.500.000 instead of 1.763.000 takes the margin below 15 %.
    expect((await saveCalculation(db, sales, calculationOf(id, { lines: siixLines("1500000") }))).ok).toBe(true);
    expect((await submitAndCheck(sales, id)).status).toBe("PENDING");
    expect(await steps(id)).toEqual([["PURCHASING", true, "APPROVED"], ["DIRECTOR", true, "PENDING"]]);
    await expect(db.notification.count({ where: { recipientId: director.id, kind: "quotation.awaiting", href: `/quotations/${number}` } })).resolves.toBe(1);

    for (const other of [sales, purchasing, admin, commissioner]) expect(await approveQuotation(db, other, { quotationId: id, note: "", picId: "" })).toMatchObject({ ok: false });
    // The database refuses an approved quotation with a required step still open, whatever writes it.
    await expect(db.$executeRaw`UPDATE quotations SET status = 'APPROVED', approved_at = now() WHERE id = ${id}::uuid`).rejects.toThrow();

    expect((await approveQuotation(db, director, { quotationId: id, note: "OK, customer strategis.", picId: "" })).ok).toBe(true);
    expect((await db.quotation.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
    const event = await db.auditEvent.findFirstOrThrow({ where: { entityId: id, action: "quotation.step_approved", after: { path: ["step"], equals: "DIRECTOR" } } });
    expect(event.after).toMatchObject({ selfApproved: false, quotationApproved: true });
    expect((await listQuotations(db, director, "mine")).some((row) => row.number === number)).toBe(false);
  });

  it("lets the Director approve a calculation of their own, and records it", async () => {
    const { id } = await draftFor(director);
    expect((await saveCalculation(db, director, calculationOf(id, { lines: siixLines("1500000") }))).ok).toBe(true);
    await submitAndCheck(director, id);
    expect((await approveQuotation(db, director, { quotationId: id, note: "", picId: "" })).ok).toBe(true);
    const event = await db.auditEvent.findFirstOrThrow({ where: { entityId: id, action: "quotation.step_approved", after: { path: ["step"], equals: "DIRECTOR" } } });
    expect(event.after).toMatchObject({ selfApproved: true });
  });

  it("brings in the Komisaris from Rp 5 miliar, a step an administrator added without code", async () => {
    const sales = await actorOf("SALES");
    const { id } = await draftFor(sales);
    const big = [{ ...siixLines()[0]!, description: "Huawei OceanStor Dorado", quantity: "1", sellPrice: "6000000000", buyPrice: "4800000000" }];
    expect((await saveCalculation(db, sales, calculationOf(id, { lines: big, costs: [] }))).ok).toBe(true);
    await submitAndCheck(sales, id);
    expect(await steps(id)).toEqual([["PURCHASING", true, "APPROVED"], ["DIRECTOR", false, "PENDING"], ["COMMISSIONER", true, "PENDING"]]);
    expect(await approveQuotation(db, director, { quotationId: id, note: "", picId: "" })).toMatchObject({ ok: false });
    expect(await approveQuotation(db, commissioner, { quotationId: id, note: "Disetujui.", picId: "" })).toMatchObject({ ok: true, value: { status: "APPROVED" } });
  });

  it("follows Purchasing's corrected buy price: a dearer cost brings the Director in", async () => {
    const sales = await actorOf("SALES");
    const { id } = await draftFor(sales);
    expect((await saveCalculation(db, sales, calculationOf(id))).ok).toBe(true);
    expect((await submitQuotation(db, sales, { quotationId: id })).ok).toBe(true);
    expect(await reviseCosts(db, sales, { quotationId: id, lines: [] })).toMatchObject({ ok: false });

    const revised = await reviseCosts(db, purchasing, { quotationId: id, lines: [{ position: 1, buyPrice: "1650000", costDescription: "", distributorId: "", vendorName: "SMI", vendorTerms: "30 Hari", costNote: "Harga naik" }] });
    expect(revised).toMatchObject({ ok: true, value: { changed: 1 } });
    expect(await steps(id)).toEqual([["PURCHASING", true, "PENDING"], ["DIRECTOR", true, "PENDING"]]);
    expect(await approveQuotation(db, purchasing, { quotationId: id, note: "", picId: "" })).toMatchObject({ ok: true, value: { status: "PENDING", next: "Disetujui (Direktur)" } });
    await expect(db.auditEvent.count({ where: { entityId: id, action: "quotation.costs_revised" } })).resolves.toBe(1);
  });

  it("goes back to Sales with a reason, clearing the approvals; Sales can also recall and reopen", async () => {
    const sales = await actorOf("SALES");
    const { id } = await draftFor(sales);
    expect((await saveCalculation(db, sales, calculationOf(id))).ok).toBe(true);
    expect((await submitQuotation(db, sales, { quotationId: id })).ok).toBe(true);
    expect(await returnQuotation(db, purchasing, { quotationId: id, reason: "" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await returnQuotation(db, purchasing, { quotationId: id, reason: "Harga RAM sudah naik, cek ulang." })).ok).toBe(true);
    expect(await db.quotation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DRAFT", submittedAt: null, configSnapshot: null, returnedReason: "Harga RAM sudah naik, cek ulang.", returnedById: purchasing.id });
    expect(await steps(id)).toEqual([]);

    expect((await submitQuotation(db, sales, { quotationId: id })).ok).toBe(true);
    expect((await recallQuotation(db, sales, { quotationId: id })).ok).toBe(true);
    await submitAndCheck(sales, id);
    expect(await reopenQuotation(db, sales, { quotationId: id, reason: "" })).toMatchObject({ ok: false });
    expect((await reopenQuotation(db, sales, { quotationId: id, reason: "Customer minta qty berubah." })).ok).toBe(true);
    expect(await db.quotation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DRAFT", approvedAt: null });
  });
});

describe("two options, one chosen", () => {
  it("keeps one chosen option per project, and the chosen one cannot be reopened or cancelled", async () => {
    const sales = await actorOf("SALES");
    const first = await draftFor(sales);
    expect((await saveCalculation(db, sales, calculationOf(first.id))).ok).toBe(true);
    const copy = await duplicateQuotation(db, sales, { quotationId: first.id });
    if (!copy.ok) throw new Error(copy.message);
    const second = copy.value;
    const copied = await db.quotation.findUniqueOrThrow({ where: { id: second.id }, include: { lines: true } });
    expect(copied).toMatchObject({ projectId: first.projectId, optionLabel: "Opsi 2", status: "DRAFT" });
    expect(copied.lines).toHaveLength(6);

    for (const id of [first.id, second.id]) await submitAndCheck(sales, id);
    expect((await chooseQuotation(db, sales, { quotationId: first.id })).ok).toBe(true);
    expect(await chooseQuotation(db, sales, { quotationId: second.id })).toMatchObject({ ok: false, code: "CONFLICT", message: expect.stringContaining(first.number) });
    expect(await reopenQuotation(db, sales, { quotationId: first.id, reason: "x" })).toMatchObject({ ok: false });
    expect(await cancelQuotation(db, sales, { quotationId: first.id, reason: "x" })).toMatchObject({ ok: false });
    expect((await getQuotationDetail(db, sales, second.number))?.chosenSibling).toBe(first.number);

    expect((await unchooseQuotation(db, sales, { quotationId: first.id })).ok).toBe(true);
    expect((await chooseQuotation(db, sales, { quotationId: second.id })).ok).toBe(true);
    expect((await cancelQuotation(db, sales, { quotationId: first.id, reason: "Customer memilih opsi 2." })).ok).toBe(true);
    expect(await db.quotation.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: "CANCELLED", cancelReason: "Customer memilih opsi 2." });
  });
});

describe("the customer header", () => {
  it("checks dates and e-mail and is audited field by field", async () => {
    const sales = await actorOf("SALES");
    const { id } = await draftFor(sales);
    const base = { quotationId: id, customerName: "PT A", email: "", billingAddress: "", transactionDate: "2026-11-09", expiryDate: "2026-12-09", paymentTerm: "", customerReference: "", message: "", memo: "" };
    expect(await saveHeader(db, sales, { ...base, expiryDate: "2026-11-01" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await saveHeader(db, sales, { ...base, email: "not-an-email" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await saveHeader(db, sales, { ...base, transactionDate: "2026-02-30" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await saveHeader(db, sales, base)).ok).toBe(true);
    const event = await db.auditEvent.findFirstOrThrow({ where: { entityId: id, action: "quotation.header_saved" } });
    expect(event.after).toMatchObject({ customerName: "PT A", transactionDate: "2026-11-09" });
  });
});

describe("a fresh installation (the default rules, no Director named yet)", () => {
  it("lets a quotation at or above 15% through Purchasing, and stops one below 15% until a Director is named", async () => {
    const stored = await db.appSetting.findUniqueOrThrow({ where: { key: "quotations.config" } });
    await db.appSetting.delete({ where: { key: "quotations.config" } });
    try {
      const sales = await actorOf("SALES");
      const good = await draftFor(sales);
      expect((await saveCalculation(db, sales, calculationOf(good.id))).ok).toBe(true);
      expect(await submitQuotation(db, sales, { quotationId: good.id })).toMatchObject({ ok: true, value: { steps: ["Diperiksa (Purchasing)"] } });
      // The Director is only told and nobody is named: the step is left out instead of blocking.
      expect(await steps(good.id)).toEqual([["PURCHASING", true, "PENDING"]]);

      const thin = await draftFor(sales);
      expect((await saveCalculation(db, sales, calculationOf(thin.id, { lines: siixLines("1500000") }))).ok).toBe(true);
      expect(await submitQuotation(db, sales, { quotationId: thin.id })).toMatchObject({ ok: false, code: "INVALID_STATE", message: expect.stringContaining("tidak punya penyetuju aktif") });
    } finally {
      await db.appSetting.create({ data: { key: stored.key, value: stored.value ?? {}, updatedById: stored.updatedById } });
    }
  });
});

describe("configuration and numbering", () => {
  it("is kept by Superadmin and Admin, checks its approvers, and moves the next number forward only", async () => {
    expect(await saveQuotationConfig(db, await actorOf("SALES"), testConfig())).toMatchObject({ ok: false });
    const inactive = await makeUser("SALES", { isActive: false });
    const bad = testConfig();
    bad.steps[1] = { ...bad.steps[1]!, approver: { kind: "USERS", userIds: [inactive.id] } };
    expect(await saveQuotationConfig(db, admin, bad)).toMatchObject({ ok: false, message: expect.stringContaining("tidak aktif") });
    expect(await saveQuotationConfig(db, admin, testConfig())).toEqual({ ok: true, changed: false });

    const current = await getNextQuotationSequence(db);
    expect(await setNextQuotationSequence(db, await actorOf("SALES"), String(current + 5))).toMatchObject({ ok: false });
    expect(await setNextQuotationSequence(db, admin, String(current - 1))).toMatchObject({ ok: false });
    expect(await setNextQuotationSequence(db, admin, String(current + 5))).toEqual({ ok: true, changed: true });
    const { number } = await draftFor(await actorOf("SALES"));
    expect(sequenceOf(number)).toBe(current + 5);
  });
});
