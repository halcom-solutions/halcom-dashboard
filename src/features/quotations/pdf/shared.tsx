import { StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * Pieces both PDFs share. The built-in Helvetica covers Latin text, the en dash and ×, but not arrows, ≥ or check marks: texts written
 * for the PDF avoid them.
 */
export const NAVY = "#1f3864";
export const LIGHT = "#d9e1f2";
export const INPUT = "#fff2cc";

export const base = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 40, paddingHorizontal: 30, fontSize: 8, fontFamily: "Helvetica", color: "#111111" },
  bar: { backgroundColor: NAVY, color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 8.5, paddingVertical: 3, paddingHorizontal: 5, marginTop: 10, marginBottom: 3 },
  row: { flexDirection: "row" },
  th: { backgroundColor: LIGHT, color: NAVY, fontFamily: "Helvetica-Bold", fontSize: 7.5, padding: 3, borderWidth: 0.5, borderColor: "#9aa7c0", textAlign: "center" },
  td: { padding: 3, borderWidth: 0.5, borderColor: "#c8cfdc", fontSize: 7.5 },
  num: { textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#555555" },
  footer: { position: "absolute", bottom: 16, left: 30, right: 30, fontSize: 7, color: "#777777", flexDirection: "row", justifyContent: "space-between" },
});

/** The diagonal DRAFT across every page of a quotation that is not approved yet. */
export function DraftWatermark() {
  return (
    <View fixed style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 130, fontFamily: "Helvetica-Bold", color: "#c00000", opacity: 0.13, transform: "rotate(-45deg)" }}>DRAFT</Text>
    </View>
  );
}

export function Footer({ left }: { left: string }) {
  return (
    <View fixed style={base.footer}>
      <Text>{left}</Text>
      <Text render={({ pageNumber, totalPages }) => `Halaman ${pageNumber} dari ${totalPages}`} />
    </View>
  );
}

type PdfStyle = React.ComponentProps<typeof View>["style"];

/** A table cell with a width (points or percent) and the shared look. */
export function Cell({ width, children, style, header = false }: { width: number | `${number}%`; children?: React.ReactNode; style?: PdfStyle; header?: boolean }) {
  return (
    <View style={[header ? base.th : base.td, { width }, ...(Array.isArray(style) ? style : style ? [style] : [])]}>
      {typeof children === "string" || typeof children === "number" ? <Text>{children}</Text> : children}
    </View>
  );
}
