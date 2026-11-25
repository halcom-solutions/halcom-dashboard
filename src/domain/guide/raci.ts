import { GUIDE_LANES } from "./workflow";

/**
 * Who does what in the workflow, as a RACI matrix: R does the work, A answers for the result (one per activity), C is asked for
 * input, I is told. Each row is an activity of the User Guide (workflow.ts) and follows the default permissions and notifications
 * (role-guides.ts, D-083): the role that may do a step is R, the role that decides it is A, a role that is notified is I. "A/R"
 * means the same role does the work and answers for it. Printed at the start of every User Guide PDF (D-091).
 */
export type RaciCode = "R" | "A" | "A/R" | "C" | "I";

export type RaciRow = { activity: string; codes: Partial<Record<(typeof GUIDE_LANES)[number], RaciCode>> };

export const RACI_LEGEND: Record<"R" | "A" | "C" | "I", string> = {
  R: "Responsible: mengerjakan",
  A: "Accountable: bertanggung jawab atas hasilnya dan memutuskan (satu per aktivitas)",
  C: "Consulted: dimintai masukan",
  I: "Informed: diberi tahu",
};

export const RACI_ROWS: readonly RaciRow[] = [
  { activity: "Membuat proyek dan mengelola pipeline (field komersial)", codes: { SALES: "A/R", SOA: "R", FINANCE: "I", MANAGEMENT: "I", ADMIN: "C" } },
  { activity: "Mengajukan request BOQ", codes: { SALES: "A/R", SOA: "I" } },
  { activity: "Mengerjakan kebutuhan teknis dan menyelesaikan BOQ", codes: { SOA: "A/R", SALES: "C", MANAGEMENT: "I" } },
  { activity: "Meminta revisi BOQ, RFQ, atau PO yang sudah selesai", codes: { SALES: "A/R", SOA: "I", PURCHASING: "I" } },
  { activity: "Melanjutkan BOQ yang selesai ke RFQ", codes: { SALES: "A", SOA: "R", PURCHASING: "I" } },
  { activity: "Mengajukan RFQ (tanpa BOQ, atau untuk proyek yang sudah ada)", codes: { SALES: "A/R", PURCHASING: "R", SOA: "I" } },
  { activity: "Mengerjakan RFQ dan memperbarui progres quotation", codes: { PURCHASING: "A/R", SALES: "I", SOA: "I" } },
  { activity: "Memutuskan PO (melanjutkan RFQ yang selesai)", codes: { SALES: "A/R", PURCHASING: "R", FINANCE: "I" } },
  { activity: "Memproses PO", codes: { PURCHASING: "A/R", SALES: "I", FINANCE: "I" } },
  { activity: "Menjaga SLA dan PIC request BOQ", codes: { SOA: "A/R", MANAGEMENT: "I", ADMIN: "I" } },
  { activity: "Menjaga SLA dan PIC request RFQ dan PO", codes: { PURCHASING: "A/R", MANAGEMENT: "I", ADMIN: "I" } },
  { activity: "Mencocokkan nilai proyek dengan quotation dan PO", codes: { FINANCE: "A/R", SALES: "C", PURCHASING: "C", MANAGEMENT: "I" } },
  { activity: "Memantau progres dan hal yang perlu perhatian di semua tim", codes: { MANAGEMENT: "A/R", ADMIN: "I" } },
  { activity: "Mengelola pengguna operasional, PIC, dan master data", codes: { ADMIN: "A/R", SOA: "C", PURCHASING: "C", SUPERADMIN: "C" } },
  { activity: "Permissions, SLA policies, email template, dan backup", codes: { SUPERADMIN: "A/R", ADMIN: "I" } },
];
