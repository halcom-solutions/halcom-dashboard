import { Document, Page, Text, View } from "@react-pdf/renderer";
import { planApprovals } from "@/domain/quotations/approval";
import { categoryLabel, conditionLabel, ppnExplanation } from "@/domain/quotations/config";
import { bpToPercent } from "@/domain/quotations/money";
import { isApprovedStatus } from "@/domain/quotations/workflow";
import { jakartaDay } from "@/domain/requests/metrics";
import type { QuotationDetail } from "@/server/quotations/queries";
import { formatBp, formatCents, formatDecimal, formatLongDay } from "../format";
import { base, Cell, DraftWatermark, Footer, INPUT, LIGHT, NAVY } from "./shared";

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const pct = (part: bigint, whole: bigint) => (whole > 0n ? formatBp((part * 10_000n) / whole) : "–");

/**
 * The "Project Approval" sheet as a PDF, laid out like the workbook (WAPU / Non-WAPU): project information and summary, revenue per line,
 * customer terms, cost per line, other costs with the withholdings, the margin summary, and the approval boxes with the configured steps.
 * Until the quotation is approved every page carries a diagonal DRAFT.
 */
export function ApprovalDocument({ detail }: { detail: QuotationDetail }) {
  const { calculation: c, rules } = detail;
  const scheme = rules.taxScheme;
  const steps = detail.approvals.length
    ? detail.approvals.map((step) => ({ label: step.required ? step.label : step.acknowledgeLabel, required: step.required, name: step.decidedByPic?.name ?? step.decidedBy?.name ?? "", at: step.decidedAt, note: step.note, status: step.status }))
    : planApprovals(rules.steps, c).map((step) => ({ label: step.required ? step.label : step.acknowledgeLabel, required: step.required, name: "", at: null, note: null, status: "PENDING" as const }));
  const notes = steps.filter((step) => step.note).map((step) => `${step.label}: ${step.note}`);
  const approved = isApprovedStatus(detail.status);
  const required = steps.filter((step) => step.required).map((step) => step.label);

  return (
    <Document title={`Project Approval ${detail.number}`} author={detail.preparedBy.name}>
      <Page size="A4" style={base.page}>
        {approved ? null : <DraftWatermark />}
        <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", color: NAVY }}>PROJECT APPROVAL – {scheme.label.toUpperCase()}</Text>
        <Text style={[base.muted, { marginBottom: 8 }]}>
          {detail.config.document.companyName} • Approval margin project per line item
        </Text>

        <View style={[base.row, { gap: 12 }]}>
          <View style={{ flex: 3 }}>
            <Text style={[base.bar, { marginTop: 0 }]}>INFORMASI PROJECT</Text>
            {[
              ["Sales", detail.preparedBy.name],
              ["Customer", detail.customerName],
              ["Project", `${detail.project.code} ${detail.project.name}`],
              ["No. RFQ", detail.rfqRequest?.code ?? "–"],
              ["No. Quotation", `${detail.number}${detail.optionLabel ? ` (${detail.optionLabel})` : ""}`],
              ["Tanggal", formatLongDay(detail.transactionDate)],
            ].map(([label, value]) => (
              <View key={label} style={base.row}>
                <Cell width="30%">{label}</Cell>
                <Cell width="70%" style={{ backgroundColor: INPUT }}>{value}</Cell>
              </View>
            ))}
          </View>
          <View style={{ flex: 2 }}>
            <Text style={[base.bar, { marginTop: 0 }]}>RINGKASAN</Text>
            <View style={base.row}>
              <Cell width="50%">Gross Profit</Cell>
              <Cell width="50%" style={base.num}>{formatCents(c.grossProfit)}</Cell>
            </View>
            <View style={base.row}>
              <Cell width="50%">Gross Margin</Cell>
              <Cell width="50%" style={[base.num, base.bold]}>{formatBp(c.grossMarginBp)}</Cell>
            </View>
            <View style={[base.td, { backgroundColor: approved ? "#e2efda" : "#fff2cc" }]}>
              <Text>{approved ? `Disetujui (${formatLongDay(detail.approvedAt)}). Quotation boleh dikirim.` : detail.status === "PENDING" ? `Menunggu: ${detail.waitingFor ?? "-"}` : "Draft: belum diajukan."}</Text>
            </View>
          </View>
        </View>

        <Text style={base.bar}>1. REVENUE PER LINE ITEM (EXCL PPN)</Text>
        <View style={base.row}>
          <Cell header width="5%">No</Cell>
          <Cell header width="31%">Line Item</Cell>
          <Cell header width="10%">Kategori</Cell>
          <Cell header width="6%">Qty</Cell>
          <Cell header width="11%">Harga Jual Satuan</Cell>
          <Cell header width="11%">Total Jual</Cell>
          <Cell header width="10%">COGS</Cell>
          <Cell header width="10%">Gross Profit</Cell>
          <Cell header width="6%">GM %</Cell>
        </View>
        {detail.lines.map((line, index) => (
          <View key={line.id} style={base.row} wrap={false}>
            <Cell width="5%" style={{ textAlign: "center" }}>{String(index + 1)}</Cell>
            <Cell width="31%">
              <Text>{line.description}</Text>
              {line.groupLabel ? <Text style={base.muted}>{line.groupLabel}</Text> : null}
            </Cell>
            <Cell width="10%">{categoryLabel(rules.categories, line.category)}</Cell>
            <Cell width="6%" style={base.num}>{`${line.quantity.toString()} ${line.unit}`}</Cell>
            <Cell width="11%" style={base.num}>{formatDecimal(line.sellPrice)}</Cell>
            <Cell width="11%" style={base.num}>{formatCents(c.lines[index]?.revenue ?? 0n)}</Cell>
            <Cell width="10%" style={base.num}>{formatCents(c.lines[index]?.cogs ?? 0n)}</Cell>
            <Cell width="10%" style={base.num}>{formatCents(c.lines[index]?.grossProfit ?? 0n)}</Cell>
            <Cell width="6%" style={base.num}>{formatBp(c.lines[index]?.marginBp ?? null)}</Cell>
          </View>
        ))}
        <View style={[base.row, base.bold]}>
          <Cell width="63%" style={base.bold}>TOTAL REVENUE (EXCL PPN)</Cell>
          <Cell width="11%" style={[base.num, base.bold]}>{formatCents(c.revenue)}</Cell>
          <Cell width="10%" style={[base.num, base.bold]}>{formatCents(c.cogs)}</Cell>
          <Cell width="10%" style={[base.num, base.bold]}>{formatCents(c.grossProfit)}</Cell>
          <Cell width="6%" style={[base.num, base.bold]}>{formatBp(c.grossProfitBp)}</Cell>
        </View>
        <View style={base.row}>
          <Cell width="63%" style={base.num}>{`PPN (${ppnExplanation(scheme)})`}</Cell>
          <Cell width="11%" style={base.num}>{formatCents(c.ppn)}</Cell>
        </View>
        <View style={base.row}>
          <Cell width="63%" style={[base.num, base.bold]}>Total Revenue (incl PPN)</Cell>
          <Cell width="11%" style={[base.num, base.bold]}>{formatCents(c.revenueWithPpn)}</Cell>
        </View>

        <Text style={[base.bold, { marginTop: 8, marginBottom: 2 }]}>Termin Pembayaran Customer</Text>
        <View style={base.row}>
          <Cell header width="5%">No</Cell>
          <Cell header width="30%">Termin</Cell>
          <Cell header width="10%">Porsi (%)</Cell>
          <Cell header width="35%">Keterangan</Cell>
          <Cell header width="20%">Nilai Tagihan (incl PPN)</Cell>
        </View>
        {detail.terms.map((term, index) => (
          <View key={term.id} style={base.row}>
            <Cell width="5%" style={{ textAlign: "center" }}>{String(index + 1)}</Cell>
            <Cell width="30%">{term.label}</Cell>
            <Cell width="10%" style={base.num}>{`${term.sharePercent.toString()}%`}</Cell>
            <Cell width="35%">{term.note ?? ""}</Cell>
            <Cell width="20%" style={base.num}>{formatCents(c.termAmounts[index] ?? 0n)}</Cell>
          </View>
        ))}
        <View style={base.row}>
          <Cell width="35%" style={base.bold}>TOTAL</Cell>
          <Cell width="10%" style={[base.num, base.bold]}>{`${bpToPercent(c.termShareTotalBp)}%`}</Cell>
          <Cell width="35%">{c.termShareTotalBp === 10_000n ? "OK" : "Belum 100%"}</Cell>
          <Cell width="20%" style={[base.num, base.bold]}>{formatCents(c.termAmounts.reduce((a, b) => a + b, 0n))}</Cell>
        </View>

        <Text style={base.bar}>2. COGS PER LINE ITEM (EXCL PPN)</Text>
        <View style={base.row}>
          <Cell header width="5%">No</Cell>
          <Cell header width="30%">Line Item</Cell>
          <Cell header width="17%">Vendor / Distributor</Cell>
          <Cell header width="6%">Qty</Cell>
          <Cell header width="12%">Harga Beli Satuan</Cell>
          <Cell header width="12%">Total Beli</Cell>
          <Cell header width="8%">TOP Vendor</Cell>
          <Cell header width="10%">Catatan</Cell>
        </View>
        {detail.lines.map((line, index) => (
          <View key={line.id} style={base.row} wrap={false}>
            <Cell width="5%" style={{ textAlign: "center" }}>{String(index + 1)}</Cell>
            <Cell width="30%">{line.costDescription ?? line.description}</Cell>
            <Cell width="17%">{line.distributor?.alias ?? line.distributor?.name ?? line.vendorName ?? "–"}</Cell>
            <Cell width="6%" style={base.num}>{line.quantity.toString()}</Cell>
            <Cell width="12%" style={base.num}>{line.buyPrice === null ? "–" : formatDecimal(line.buyPrice)}</Cell>
            <Cell width="12%" style={base.num}>{formatCents(c.lines[index]?.cogs ?? 0n)}</Cell>
            <Cell width="8%">{line.vendorTerms ?? ""}</Cell>
            <Cell width="10%">{line.costNote ?? ""}</Cell>
          </View>
        ))}
        <View style={base.row}>
          <Cell width="70%" style={base.bold}>TOTAL COGS (EXCL PPN)</Cell>
          <Cell width="12%" style={[base.num, base.bold]}>{formatCents(c.cogs)}</Cell>
        </View>

        <Text style={base.bar}>3. BIAYA PROYEK LAINNYA</Text>
        <View style={base.row}>
          <Cell header width="5%">No</Cell>
          <Cell header width="40%">Deskripsi</Cell>
          <Cell header width="35%">Catatan</Cell>
          <Cell header width="20%">Nilai (Rp)</Cell>
        </View>
        {[
          ...detail.costs.map((cost) => ({ key: cost.id, description: cost.description, note: cost.note ?? "", amount: formatDecimal(cost.amount) })),
          ...c.withholdings.map((w) => ({ key: w.key, description: w.label, note: `Otomatis: ${bpToPercent(BigInt(w.rateBp))}% × ${w.categories.map((key) => categoryLabel(rules.categories, key)).join(" + ")}`, amount: formatCents(w.amount) })),
        ].map((row, index) => (
          <View key={row.key} style={base.row}>
            <Cell width="5%" style={{ textAlign: "center" }}>{String(index + 1)}</Cell>
            <Cell width="40%">{row.description}</Cell>
            <Cell width="35%">{row.note}</Cell>
            <Cell width="20%" style={base.num}>{row.amount}</Cell>
          </View>
        ))}
        <View style={base.row}>
          <Cell width="80%" style={base.bold}>TOTAL BIAYA LAINNYA</Cell>
          <Cell width="20%" style={[base.num, base.bold]}>{formatCents(c.otherCosts)}</Cell>
        </View>

        <View wrap={false}>
          <Text style={base.bar}>4. RINGKASAN MARGIN PROJECT (EXCL PPN)</Text>
          <View style={base.row}>
            <Cell header width="55%">Keterangan</Cell>
            <Cell header width="25%">Nilai (Rp)</Cell>
            <Cell header width="20%">% Revenue</Cell>
          </View>
          {[
            ["Revenue", formatCents(c.revenue), c.revenue > 0n ? "100,0%" : "–", false],
            ["(–) COGS", formatCents(-c.cogs), pct(c.cogs, c.revenue), false],
            ["GROSS PROFIT", formatCents(c.grossProfit), formatBp(c.grossProfitBp), true],
            ["(–) Biaya proyek lainnya (termasuk pajak dipotong customer)", formatCents(-c.otherCosts), pct(c.otherCosts, c.revenue), false],
            ["GROSS MARGIN", formatCents(c.grossMargin), formatBp(c.grossMarginBp), true],
          ].map(([label, value, share, strong]) => (
            <View key={String(label)} style={[base.row, label === "GROSS MARGIN" ? { backgroundColor: LIGHT } : {}]}>
              <Cell width="55%" style={strong ? base.bold : {}}>{String(label)}</Cell>
              <Cell width="25%" style={[base.num, strong ? base.bold : {}]}>{String(value)}</Cell>
              <Cell width="20%" style={[base.num, strong ? base.bold : {}]}>{String(share)}</Cell>
            </View>
          ))}
        </View>

        <View wrap={false}>
          <Text style={base.bar}>5. APPROVAL</Text>
          <Text style={base.bold}>Aturan approval (konfigurasi saat {detail.submittedAt ? "diajukan" : "ini"}):</Text>
          {rules.steps.map((step) => (
            <Text key={step.key}>
              {"•  "}
              {step.label}: {lowerFirst(conditionLabel(step.condition, (cents) => `Rp ${formatCents(BigInt(cents))}`))}
              {step.condition.kind !== "ALWAYS" && step.whenNotRequired === "ACKNOWLEDGE" ? `; selain itu ${step.acknowledgeLabel.toLowerCase()}` : ""}
            </Text>
          ))}
          <View style={[base.td, { marginTop: 4, backgroundColor: steps.filter((s) => s.required).length > 1 ? "#fff2cc" : "#e2efda" }]}>
            <Text>
              <Text style={base.bold}>Jalur approval: </Text>
              {required.length ? required.join(", lalu ") : "-"}
            </Text>
          </View>
          <View style={[base.row, { marginTop: 8 }]}>
            {[{ label: "Diajukan (Sales)", name: detail.submittedBy?.name ?? detail.preparedBy.name, at: detail.submittedAt, status: detail.submittedAt ? "DONE" : "PENDING" }, ...steps].map((box, index) => (
              <View key={index} style={{ flex: 1, borderWidth: 0.5, borderColor: "#9aa7c0", marginRight: 4 }}>
                <Text style={[base.th, { borderWidth: 0 }]}>{box.label}</Text>
                <View style={{ height: 34, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: box.status === "PENDING" ? "#999999" : "#2e7d32", fontFamily: "Helvetica-Bold" }}>{box.status === "PENDING" ? "" : box.status === "ACKNOWLEDGED" ? "DIKETAHUI" : box.status === "DONE" ? "DIAJUKAN" : "DISETUJUI"}</Text>
                </View>
                <Text style={{ paddingHorizontal: 3 }}>Nama: {box.name}</Text>
                <Text style={{ paddingHorizontal: 3, paddingBottom: 3 }}>Tanggal: {box.at ? formatLongDay(box.at) : ""}</Text>
              </View>
            ))}
          </View>
          <Text style={[base.bold, { marginTop: 8 }]}>Catatan</Text>
          <View style={[base.td, { minHeight: 30, backgroundColor: INPUT }]}>
            <Text>{notes.join("\n")}</Text>
          </View>
        </View>
        <Footer left={`${detail.number} • ${detail.project.code} • dicetak ${formatLongDay(new Date(`${jakartaDay(new Date())}T00:00:00Z`))}`} />
      </Page>
    </Document>
  );
}
