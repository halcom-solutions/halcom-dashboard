import { Document, Page, Text, View } from "@react-pdf/renderer";
import { categoryLabel, ppnExplanation } from "@/domain/quotations/config";
import { isApprovedStatus } from "@/domain/quotations/workflow";
import type { QuotationDetail } from "@/server/quotations/queries";
import { formatCents, formatDecimal, formatLongDay } from "../format";
import { base, Cell, DraftWatermark, Footer, LIGHT, NAVY } from "./shared";

/**
 * The quotation the customer receives. What it shows follows the configuration's document part (letterhead, specification under each
 * item, group headings, unit price, category, payment terms, notes, signature). Until it is approved every page carries a diagonal DRAFT.
 */
export function QuotationDocument({ detail }: { detail: QuotationDetail }) {
  const { calculation: c, rules } = detail;
  const doc = detail.config.document;
  const approved = isApprovedStatus(detail.status);
  // Column widths in percent; the description takes what the optional columns leave.
  const widths = { no: 5, qty: 7, unit: 8, price: doc.showUnitPrice ? 15 : 0, category: doc.showCategory ? 11 : 0, amount: 16 };
  const description = 100 - widths.no - widths.qty - widths.unit - widths.price - widths.category - widths.amount;
  const span = (value: number): `${number}%` => `${value}%`;
  const groupStarts = (index: number) => doc.showGroups && !!detail.lines[index]?.groupLabel && detail.lines[index]?.groupLabel !== detail.lines[index - 1]?.groupLabel;

  return (
    <Document title={`${doc.title} ${detail.number}`} author={doc.companyName}>
      <Page size="A4" style={[base.page, { fontSize: 8.5 }]}>
        {approved ? null : <DraftWatermark />}

        <View style={[base.row, { justifyContent: "space-between", borderBottomWidth: 1.5, borderBottomColor: NAVY, paddingBottom: 8 }]}>
          <View style={{ maxWidth: "55%" }}>
            <Text style={{ fontSize: 13, fontFamily: "Helvetica-Bold", color: NAVY }}>{doc.companyName}</Text>
            {doc.companyAddress ? <Text style={base.muted}>{doc.companyAddress}</Text> : null}
            {doc.companyContact ? <Text style={base.muted}>{doc.companyContact}</Text> : null}
            {doc.companyTaxId ? <Text style={base.muted}>NPWP: {doc.companyTaxId}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold", color: NAVY }}>{doc.title}</Text>
            <Text>No: {detail.number}</Text>
            <Text>Tanggal: {formatLongDay(detail.transactionDate)}</Text>
            {detail.expiryDate ? <Text>Berlaku s/d: {formatLongDay(detail.expiryDate)}</Text> : null}
            {detail.customerReference ? <Text>Ref. customer: {detail.customerReference}</Text> : null}
          </View>
        </View>

        <View style={[base.row, { marginTop: 10, marginBottom: 10, gap: 16 }]}>
          <View style={{ flex: 1 }}>
            <Text style={[base.bold, { color: NAVY }]}>Kepada</Text>
            <Text style={base.bold}>{detail.customerName}</Text>
            {detail.billingAddress ? <Text>{detail.billingAddress}</Text> : null}
            {detail.email ? <Text>{detail.email}</Text> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[base.bold, { color: NAVY }]}>Project</Text>
            <Text>{detail.project.name}</Text>
            {detail.paymentTerm ? <Text>Syarat pembayaran: {detail.paymentTerm}</Text> : null}
          </View>
        </View>

        <View style={base.row} fixed>
          <Cell header width={span(widths.no)}>No</Cell>
          <Cell header width={span(description)}>Deskripsi</Cell>
          {widths.category ? <Cell header width={span(widths.category)}>Kategori</Cell> : null}
          <Cell header width={span(widths.qty)}>Qty</Cell>
          <Cell header width={span(widths.unit)}>Satuan</Cell>
          {widths.price ? <Cell header width={span(widths.price)}>Harga Satuan</Cell> : null}
          <Cell header width={span(widths.amount)}>Jumlah</Cell>
        </View>
        {detail.lines.map((line, index) => (
          <View key={line.id}>
            {groupStarts(index) ? (
              <View style={[base.row, { backgroundColor: LIGHT }]}>
                <Cell width="100%" style={[base.bold, { textTransform: "uppercase" }]}>{line.groupLabel ?? ""}</Cell>
              </View>
            ) : null}
            <View style={base.row} wrap={false}>
              <Cell width={span(widths.no)} style={{ textAlign: "center" }}>{String(index + 1)}</Cell>
              <Cell width={span(description)}>
                <Text style={base.bold}>{line.description}</Text>
                {doc.showSpecification && line.specification ? <Text style={[base.muted, { marginTop: 1 }]}>{line.specification}</Text> : null}
              </Cell>
              {widths.category ? <Cell width={span(widths.category)}>{categoryLabel(rules.categories, line.category)}</Cell> : null}
              <Cell width={span(widths.qty)} style={base.num}>{line.quantity.toString()}</Cell>
              <Cell width={span(widths.unit)}>{line.unit}</Cell>
              {widths.price ? <Cell width={span(widths.price)} style={base.num}>{formatDecimal(line.sellPrice)}</Cell> : null}
              <Cell width={span(widths.amount)} style={base.num}>{formatCents(c.lines[index]?.revenue ?? 0n)}</Cell>
            </View>
          </View>
        ))}

        <View style={{ alignSelf: "flex-end", width: "45%", marginTop: 6 }} wrap={false}>
          {[
            ["Subtotal (excl PPN)", formatCents(c.revenue), false],
            [`PPN (${ppnExplanation(rules.taxScheme)})`, formatCents(c.ppn), false],
            ["TOTAL", `Rp ${formatCents(c.revenueWithPpn)}`, true],
          ].map(([label, value, strong]) => (
            <View key={String(label)} style={[base.row, strong ? { backgroundColor: LIGHT } : {}]}>
              <Cell width="60%" style={strong ? base.bold : {}}>{String(label)}</Cell>
              <Cell width="40%" style={[base.num, strong ? base.bold : {}]}>{String(value)}</Cell>
            </View>
          ))}
        </View>

        {doc.showTerms && detail.terms.length > 0 ? (
          <View style={{ marginTop: 10 }} wrap={false}>
            <Text style={[base.bold, { color: NAVY }]}>Termin pembayaran</Text>
            {detail.terms.map((term, index) => (
              <Text key={term.id}>
                {index + 1}. {term.label} – {term.sharePercent.toString()}% (Rp {formatCents(c.termAmounts[index] ?? 0n)}){term.note ? `, ${term.note}` : ""}
              </Text>
            ))}
          </View>
        ) : null}

        {detail.message ? (
          <View style={{ marginTop: 10 }} wrap={false}>
            <Text style={[base.bold, { color: NAVY }]}>Pesan</Text>
            <Text>{detail.message}</Text>
          </View>
        ) : null}
        {doc.notes ? (
          <View style={{ marginTop: 10 }} wrap={false}>
            <Text style={[base.bold, { color: NAVY }]}>Catatan</Text>
            <Text>{doc.notes}</Text>
          </View>
        ) : null}

        {doc.showSignature ? (
          <View style={{ marginTop: 18, width: "40%" }} wrap={false}>
            <Text>Hormat kami,</Text>
            <Text style={base.bold}>{doc.companyName}</Text>
            <View style={{ height: 46 }} />
            <Text style={[base.bold, { textDecoration: "underline" }]}>{detail.preparedBy.name}</Text>
            <Text>{doc.signatoryTitle}</Text>
          </View>
        ) : null}
        <Footer left={`${detail.number} • ${doc.companyName}`} />
      </Page>
    </Document>
  );
}
