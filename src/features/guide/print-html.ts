import { ROLE_LABELS, type Role } from "@/domain/access/roles";
import { nodesOfRole, visibleLinks } from "@/domain/guide/access";
import { RACI_LEGEND, RACI_ROWS, type RaciCode } from "@/domain/guide/raci";
import { ROLE_GUIDES } from "@/domain/guide/role-guides";
import { GUIDE_LANES, NODE_KIND_LABELS } from "@/domain/guide/workflow";
import { allowedTransitions, isRetired, REQUEST_STATUSES, REQUEST_STATUS_LABELS, reasonRequired } from "@/domain/requests/status";
import { REQUEST_TYPES } from "@/domain/requests/types";

/**
 * The User Guide as printable HTML, in editions (D-091): the general one that everyone gets (Sales, SOA, Purchasing, Management),
 * one for Finance and one for Admin and Superadmin, so the detailed steps of administration stay with the people who do them, as on
 * the /guide page. Each edition has a cover with the contents and the workflow, the RACI matrix of the whole workflow, then one part
 * per role of the edition that starts on a new page, then the request statuses. Built from the same definitions as the /guide page (role-guides.ts, workflow.ts, status.ts), so
 * the PDF says what the application does. Each role's part shows that role's full steps and the pages it may open, as the page shows
 * them to an account of that role. `npm run guide:pdf` prints it (scripts/user-guide-pdf).
 */

const escape = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const list = (items: readonly string[], empty: string, ordered = false): string => {
  if (items.length === 0) return `<p class="muted">${escape(empty)}</p>`;
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((item) => `<li>${escape(item)}</li>`).join("")}</${tag}>`;
};

function rolePart(role: Role, index: number): string {
  const info = ROLE_GUIDES[role];
  const steps = nodesOfRole(role)
    .map((node, step) => {
      const links = visibleLinks(node, [role]);
      return `
      <section class="step">
        <h3>${index}.${step + 1} ${escape(node.title)} <span class="kind">${escape(NODE_KIND_LABELS[node.kind])}</span></h3>
        <p class="muted">${escape(node.action)}</p>
        <dl>
          <dt>Di mana</dt><dd>${escape(node.guide.where)}</dd>
          <dt>Diteruskan ke</dt><dd>${escape(node.next)}</dd>
        </dl>
        <h4>Sebelum mulai</h4>${list(node.guide.prerequisites, "Tidak ada.")}
        <h4>Langkah</h4>${list(node.guide.steps, "Tidak ada.", true)}
        <h4>Yang bisa diubah</h4>${list(node.guide.editable, "Tidak ada.")}
        <h4>Serah terima</h4><p>${escape(node.guide.handoff)}</p>
        ${links.length > 0 ? `<p class="links">Halaman: ${links.map((link) => `${escape(link.label)} <code>${escape(link.href)}</code>`).join(" · ")}</p>` : ""}
      </section>`;
    })
    .join("");

  return `
  <article class="role" id="role-${role.toLowerCase()}">
    <header class="role-head">
      <p class="eyebrow">Bagian ${index}</p>
      <h2>${escape(ROLE_LABELS[role])}</h2>
      <p class="summary">${escape(info.summary)}</p>
    </header>
    <div class="grid">
      <section class="box"><h4>Bisa membaca</h4>${list(info.reads, "Tidak ada.")}</section>
      <section class="box"><h4>Bisa mengubah</h4>${list(info.edits, "Tidak ada: peran ini hanya membaca.")}</section>
      <section class="box"><h4>Tidak bisa</h4>${list(info.cannot, "Tidak ada.")}</section>
    </div>
    <h3 class="steps-title">Langkah demi langkah</h3>
    ${steps || `<p class="muted">Tidak ada langkah khusus untuk peran ini.</p>`}
  </article>`;
}

function statusTable(): string {
  const rows = REQUEST_STATUSES.filter((status) => !isRetired(status))
    .map((status) => {
      const cells = REQUEST_TYPES.map((type) => {
        const next = allowedTransitions(status, type);
        return `<td>${next.length === 0 ? "Tidak ada" : next.map((to) => escape(`${REQUEST_STATUS_LABELS[to]}${reasonRequired(status, to) ? " (dengan alasan)" : ""}`)).join(", ")}</td>`;
      }).join("");
      return `<tr><th scope="row">${escape(REQUEST_STATUS_LABELS[status])}</th>${cells}</tr>`;
    })
    .join("");
  return `
  <article class="role" id="statuses">
    <header class="role-head">
      <p class="eyebrow">Lampiran</p>
      <h2>Status request</h2>
      <p class="summary">Status berikutnya yang boleh dipilih. SOA memindahkan BOQ, Purchasing memindahkan RFQ dan PO, dengan menyeret kartu di board. Membatalkan, atau mengembalikan request yang selesai untuk direvisi, perlu alasan. Revisi memulai jam SLA baru.</p>
    </header>
    <table>
      <thead><tr><th>Status</th>${REQUEST_TYPES.map((type) => `<th>Berikutnya untuk ${type}</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </article>`;
}

export type UserGuideEdition = { key: string; title: string; audience: string; roles: readonly Role[]; file: string };

export const USER_GUIDE_EDITIONS: readonly UserGuideEdition[] = [
  { key: "general", title: "User Guide", audience: "Untuk semua pengguna: Sales, SOA, Purchasing, dan Management.", roles: ["SALES", "SOA", "PURCHASING", "MANAGEMENT"], file: "halcom-user-guide.pdf" },
  { key: "finance", title: "User Guide: Finance", audience: "Untuk tim Finance.", roles: ["FINANCE"], file: "halcom-user-guide-finance.pdf" },
  { key: "admin", title: "User Guide: Admin dan Superadmin", audience: "Untuk Admin dan Superadmin. Jangan dibagikan ke peran lain.", roles: ["ADMIN", "SUPERADMIN"], file: "halcom-user-guide-admin.pdf" },
];

const RACI_CLASS: Record<RaciCode, string> = { R: "raci-r", A: "raci-a", "A/R": "raci-a", C: "raci-c", I: "raci-i" };

function raciPart(): string {
  const head = GUIDE_LANES.map((role) => `<th>${escape(ROLE_LABELS[role])}</th>`).join("");
  const rows = RACI_ROWS.map((row) => `<tr><th scope="row">${escape(row.activity)}</th>${GUIDE_LANES.map((role) => {
    const code = row.codes[role];
    return code ? `<td class="raci ${RACI_CLASS[code]}">${code}</td>` : `<td class="raci"></td>`;
  }).join("")}</tr>`).join("");
  const legend = (Object.entries(RACI_LEGEND) as [string, string][]).map(([code, text]) => `<li><strong>${code}</strong>: ${escape(text)}</li>`).join("");
  return `
  <article class="role" id="raci">
    <header class="role-head">
      <p class="eyebrow">Pembuka</p>
      <h2>RACI matrix</h2>
      <p class="summary">Siapa mengerjakan, siapa bertanggung jawab, siapa dimintai masukan, dan siapa diberi tahu, untuk setiap aktivitas di alur kerja. Mengikuti izin dan notifikasi bawaan aplikasi.</p>
    </header>
    <table class="raci-table">
      <thead><tr><th>Aktivitas</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <ul class="legend">${legend}<li><strong>A/R</strong>: peran yang sama mengerjakan dan bertanggung jawab</li></ul>
  </article>`;
}

export type UserGuideHtmlOptions = {
  edition: UserGuideEdition;
  /** The day printed on the cover, already formatted. */
  printedOn: string;
  /** The logo as a data URI, or null to leave it out. */
  logo: string | null;
};

export function renderUserGuideHtml({ edition, printedOn, logo }: UserGuideHtmlOptions): string {
  const contents = edition.roles.map((role, index) => `<li><a href="#role-${role.toLowerCase()}">${index + 1}. ${escape(ROLE_LABELS[role])}</a> <span class="muted">${escape(ROLE_GUIDES[role].summary)}</span></li>`).join("");
  const workflow = GUIDE_LANES.map((role) => `<tr><th scope="row">${escape(ROLE_LABELS[role])}</th><td>${nodesOfRole(role).map((node) => escape(node.title)).join(" → ") || "–"}</td></tr>`).join("");

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Halcom Dashboard: ${escape(edition.title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; color: #1f2937; font-size: 10.5pt; line-height: 1.45; margin: 0; }
  h1, h2, h3, h4 { color: #0b4f80; margin: 0; }
  h1 { font-size: 26pt; }
  h2 { font-size: 20pt; }
  h3 { font-size: 12.5pt; margin-top: 14pt; }
  h4 { font-size: 10pt; text-transform: uppercase; letter-spacing: .04em; color: #1173ba; margin-top: 8pt; }
  p { margin: 4pt 0; }
  ul, ol { margin: 3pt 0 3pt 16pt; padding: 0; }
  li { margin: 1.5pt 0; }
  a { color: #1173ba; text-decoration: none; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 9pt; color: #0b4f80; }
  .muted { color: #6b7280; }
  .cover { display: flex; flex-direction: column; gap: 14pt; }
  .cover img { height: 48px; width: auto; align-self: flex-start; }
  .cover .lead { font-size: 12pt; max-width: 150mm; }
  .cover ol { list-style: none; margin-left: 0; }
  .cover ol li { margin: 5pt 0; }
  .role { break-before: page; }
  .role-head { border-bottom: 2px solid #1173ba; padding-bottom: 8pt; margin-bottom: 10pt; }
  .eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: 8.5pt; color: #6b7280; margin: 0; }
  .summary { font-size: 11pt; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8pt; }
  .box { border: 1px solid #d1d5db; border-radius: 6pt; padding: 6pt 8pt; break-inside: avoid; }
  .box h4 { margin-top: 0; }
  .steps-title { border-top: 1px solid #e5e7eb; padding-top: 10pt; margin-top: 14pt; font-size: 14pt; }
  .step { break-inside: avoid; border-left: 3px solid #38a1e6; padding: 2pt 0 4pt 10pt; margin-top: 12pt; }
  .step h3 { margin-top: 0; }
  .kind { font-size: 8pt; font-weight: 600; color: #374151; background: #e5e7eb; border-radius: 3pt; padding: 1pt 5pt; vertical-align: middle; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 1pt 10pt; margin: 4pt 0; }
  dt { font-weight: 600; color: #374151; }
  dd { margin: 0; }
  .links { font-size: 9pt; color: #374151; margin-top: 6pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 6pt; }
  th, td { border: 1px solid #d1d5db; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  thead th { background: #eef6fc; color: #0b4f80; }
  tbody th { white-space: nowrap; }
  .audience { font-size: 12pt; font-weight: 600; color: #374151; }
  .raci-table { font-size: 9pt; }
  .raci-table tbody th { white-space: normal; font-weight: 500; }
  .raci-table thead th { text-align: center; font-size: 8.5pt; }
  .raci-table thead th:first-child { text-align: left; }
  td.raci { text-align: center; font-weight: 700; width: 9%; }
  .raci-a { background: #0b4f80; color: #fff; }
  .raci-r { background: #38a1e6; color: #fff; }
  .raci-c { background: #fef3c7; color: #1f2937; }
  .raci-i { background: #f3f4f6; color: #374151; }
  .legend { list-style: none; margin: 8pt 0 0; font-size: 9pt; columns: 2; }
</style>
</head>
<body>
  <section class="cover">
    ${logo ? `<img src="${logo}" alt="Halcom">` : ""}
    <div>
      <p class="eyebrow">Halcom Dashboard</p>
      <h1>${escape(edition.title)}</h1>
      <p class="audience">${escape(edition.audience)}</p>
      <p class="muted">Dicetak ${escape(printedOn)}</p>
    </div>
    <p class="lead">Alur proyek dari Sales ke SOA dan Purchasing, dan tugas tiap peran. Sales membuat project, SOA mengerjakan BOQ, lalu Purchasing mengerjakan RFQ dan PO. BOQ boleh dilewati. Semua peran bisa membaca; tiap peran hanya mengedit bagiannya. RACI matrix ada di bagian pembuka; setiap peran punya bagiannya sendiri, mulai di halaman baru.</p>
    <div>
      <h3>Isi</h3>
      <ol><li><a href="#raci">RACI matrix</a></li>${contents}<li><a href="#statuses">Lampiran: Status request</a></li></ol>
    </div>
    <div>
      <h3>Alur kerja</h3>
      <table><tbody>${workflow}</tbody></table>
    </div>
    <p class="muted">Panduan ini menggambarkan izin bawaan. Halaman Permissions di aplikasi menunjukkan izin yang berlaku saat ini.</p>
  </section>
  ${raciPart()}
  ${edition.roles.map((role, index) => rolePart(role, index + 1)).join("")}
  ${statusTable()}
</body>
</html>`;
}
