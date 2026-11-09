import type { Permission } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";

/**
 * The User Guide's one definition of the workflow. The flowchart, its tooltips, the mobile list and the role-by-role steps are all
 * drawn from this file, so a step is written once. Every statement here describes what the application does today (checked against
 * `src/domain/requests`, `src/domain/access/permissions.ts` and the pages named in `links`); add a step only when the feature exists.
 * `tests/unit/guide.test.ts` checks the structure: links point at real pages, permissions exist, no two nodes share a grid cell.
 *
 * The explanations are in Indonesian for the people who use the application. Page, section, button, field and status names stay as
 * the application shows them (English), so a step can be followed on screen word for word: `where`, `editable` and the link labels
 * are names, not prose.
 */

/** The lanes of the flowchart, top to bottom. Every role has one. */
export const GUIDE_LANES = ["SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT", "ADMIN", "SUPERADMIN"] as const satisfies readonly Role[];

/** Lanes that hold two rows of nodes (Sales has two parallel ways to start a request). */
export const LANE_ROWS: Record<(typeof GUIDE_LANES)[number], number> = {
  SALES: 2,
  SOA: 1,
  PURCHASING: 1,
  FINANCE: 1,
  MANAGEMENT: 1,
  ADMIN: 1,
  SUPERADMIN: 1,
};

/**
 * What a role has to hold to count as taking part in the workflow as that role. The guide highlights a role when the signed-in
 * account's permissions include all of these, so an Admin (who may support Sales, SOA and Purchasing) lights up each of them, and a
 * change in the permission editor changes the highlighting. It never looks at a name or an address.
 */
export const GUIDE_ROLE_CAPABILITY: Record<Role, readonly Permission[]> = {
  SALES: ["projects.create", "requests.create", "projects.edit.commercial"],
  SOA: ["requests.work.boq", "requests.handover", "projects.edit.technical"],
  PURCHASING: ["requests.work.purchasing"],
  FINANCE: ["dashboard.finance.view", "finance.crosscheck.view"],
  MANAGEMENT: ["dashboard.management.view"],
  ADMIN: ["users.manage", "pics.manage"],
  SUPERADMIN: ["permissions.manage"],
};

/**
 * Roles whose detailed steps are shown only to someone who holds that role's capability. Everyone sees that these lanes exist and
 * what they are for; the step-by-step instructions are for the people who can act on them.
 */
export const RESTRICTED_GUIDE_ROLES: readonly Role[] = ["ADMIN", "SUPERADMIN"];

export type NodeKind = "action" | "handoff" | "decision" | "readonly" | "setup";

/** Shown as text and an icon next to every node, so a node's kind never depends on colour. */
export const NODE_KIND_LABELS: Record<NodeKind, string> = {
  action: "Action",
  handoff: "Handoff",
  decision: "Decision",
  readonly: "Read-only",
  setup: "Setup",
};

/** A page a step points at, shown only to someone who holds at least one of the permissions that open it. */
export type GuideLink = { label: string; href: string; anyOf: readonly Permission[] };

export type GuideNode = {
  id: string;
  role: Role;
  kind: NodeKind;
  /** The action, as a short title. */
  title: string;
  /** Who receives the result, in a few words (the chart shows it as "Next"). */
  next: string;
  /** Position: a column along the flow and, in a two-row lane, the row. */
  col: number;
  row?: 0 | 1;
  /** Tooltip content. */
  action: string;
  input: string;
  output: string;
  recipient: string;
  /** Role-by-role instructions. */
  guide: {
    where: string;
    prerequisites: readonly string[];
    steps: readonly string[];
    editable: readonly string[];
    handoff: string;
    links: readonly GuideLink[];
  };
};

/** `work`: the same role carries on. `handoff`: the work passes to another role. `support`: information or setup, nothing is handed over. */
export type EdgeStyle = "work" | "handoff" | "support";
/** `h`: straight; `curve`: S-curve between neighbouring columns; `hv`: across then up or down; `vh`: up or down then across; `v`: straight up or down. */
export type EdgeRoute = "h" | "curve" | "hv" | "vh" | "v";
export type GuideEdge = { from: string; to: string; style: EdgeStyle; route: EdgeRoute; label?: string };

const PROJECTS_NEW = { label: "New project", href: "/projects/new", anyOf: ["projects.create", "projects.assign-sales", "projects.create.external"] } as const satisfies GuideLink;
const PROJECTS = { label: "Projects", href: "/projects", anyOf: ["projects.view"] } as const satisfies GuideLink;

const READ_ONLY = "Tidak ada: peran ini hanya membaca";

export const GUIDE_NODES: readonly GuideNode[] = [
  // ---- Sales ---------------------------------------------------------------------------------------------------------------
  {
    id: "sales.create",
    role: "SALES",
    kind: "action",
    title: "Buat proyek",
    next: "Ajukan request",
    col: 0,
    row: 0,
    action: "Daftarkan opportunity sebagai proyek. Anda menjadi Sales PIC-nya. Project ID (HIT-PROJ-001, HIT-PROJ-002, dan seterusnya) diberikan saat Anda menyimpan.",
    input: "End-user company dan Project name (wajib). Opsional: Target closing, Progress, Status, Gross Profit, Description.",
    output: "Proyek dengan Project ID-nya. Semua peran bisa membacanya.",
    recipient: "Anda sendiri: ajukan request BOQ atau RFQ berikutnya, atau pilih langsung di form yang sama.",
    guide: {
      where: "Projects → New project",
      prerequisites: ["Anda masuk dengan akun Sales (Admin atau Superadmin juga bisa melakukannya atas nama Sales)."],
      steps: [
        "Buka Projects lalu pilih New project.",
        "Isi End-user company dan Project name. Tambahkan Target closing, Gross Profit, dan Description jika sudah diketahui.",
        "Untuk langsung meminta pekerjaan, pilih BOQ atau RFQ pada pilihan request dan isi ringkasannya. Biarkan kosong jika hanya ingin membuat proyek.",
        "Pilih Create project (atau Create project and BOQ request). Project ID muncul di halaman proyek.",
      ],
      editable: ["End-user company", "Project name", "Target closing", "Progress", "Status", "Gross Profit", "Description"],
      handoff: "Proyek saja tidak menyerahkan apa pun. Request yang dibuat di form yang sama masuk ke tim pemiliknya (SOA untuk BOQ, Purchasing untuk RFQ).",
      links: [PROJECTS_NEW, PROJECTS],
    },
  },
  {
    id: "sales.boq",
    role: "SALES",
    kind: "handoff",
    title: "Ajukan request BOQ",
    next: "SOA",
    col: 1,
    row: 0,
    action: "Minta SOA menyiapkan Bill of Quantities untuk proyek ini.",
    input: "Proyek, ringkasan satu baris (wajib), detail, dan tanggal Needed by (opsional).",
    output: "Request BOQ berstatus Submitted, notifikasi di aplikasi untuk tim SOA, dan teks email (To, Cc, subject, isi) untuk disalin ke Outlook. Aplikasi tidak mengirim email sendiri.",
    recipient: "SOA",
    guide: {
      where: "Projects → open the project → Requests → New BOQ",
      prerequisites: ["Proyek sudah ada dan statusnya On Track."],
      steps: [
        "Buka proyek dan masuk ke bagian Requests.",
        "Pilih New BOQ. Isi Summary dan Details; tambahkan Needed by jika ada tenggat.",
        "Pilih Create request.",
        "Buka teks email pada request, salin ke Outlook, lalu kirim sendiri ke grup SOA.",
      ],
      editable: ["Details", "Needed by"],
      handoff: "SOA diberi tahu di aplikasi. Email Anda kirim sendiri: aplikasi hanya menyiapkan teksnya.",
      links: [PROJECTS, { label: "New request", href: "/requests/new", anyOf: ["requests.create"] }],
    },
  },
  {
    id: "sales.revise",
    role: "SALES",
    kind: "handoff",
    title: "Minta revisi",
    next: "SOA (tahap Revision)",
    col: 4,
    row: 0,
    action: "Jika customer ingin mengubah BOQ yang sudah selesai, kembalikan dari halaman request. Tiket langsung masuk ke tahap Revision dan SOA menerima notifikasi merah.",
    input: "BOQ yang sudah Completed, dan perubahan yang diminta customer (wajib, maksimal 500 karakter).",
    output:
      "BOQ berstatus Revision dengan alasan Anda tercatat di riwayatnya. SOA (tim dan technical PIC proyek) diberi tahu, dengan notifikasi dan lonceng berwarna merah. Berlaku juga untuk RFQ dan PO: yang diberi tahu adalah tim Purchasing. Setiap revisi punya jam SLA sendiri dari saat dikembalikan, dengan batas yang sama seperti SLA tim; hasil SLA penyelesaian pertama tidak berubah.",
    recipient: "SOA",
    guide: {
      where: "Open the completed BOQ → Request a revision",
      prerequisites: ["BOQ sudah Completed.", "Anda pemilik proyek (salesperson mana pun boleh untuk proyek dari sumber lain), atau Anda Admin."],
      steps: [
        "Buka BOQ yang sudah selesai dari bagian Requests proyek atau dari Request center.",
        "Di Request a revision, jelaskan apa yang ingin diubah customer.",
        "Pilih Request revision. BOQ berpindah ke Revision dan SOA diberi tahu.",
        "SOA mengerjakan ulang lalu menyelesaikannya lagi; tanggal penyelesaian pertamanya tetap disimpan, jadi revisi tidak membuat SLA terlambat.",
      ],
      editable: ["What needs to change"],
      handoff: "SOA melihat BOQ di kolom Revision pada BOQ board dan menerima notifikasi merah.",
      links: [{ label: "Request center", href: "/requests", anyOf: ["requests.view"] }, PROJECTS],
    },
  },
  {
    id: "sales.rfq",
    role: "SALES",
    kind: "handoff",
    title: "Ajukan RFQ (tanpa BOQ)",
    next: "Purchasing",
    col: 5,
    row: 1,
    action: "Minta quotation atau harga langsung ke Purchasing. BOQ boleh dilewati: alur bisa dimulai dengan RFQ.",
    input: "Proyek, ringkasan satu baris (wajib), detail, dan tanggal Needed by (opsional).",
    output: "Request RFQ berstatus Submitted, notifikasi di aplikasi untuk tim Purchasing, dan teks email untuk disalin ke Outlook.",
    recipient: "Purchasing",
    guide: {
      where: "Projects → open the project → Requests → New RFQ",
      prerequisites: ["Proyek sudah ada dan statusnya On Track."],
      steps: [
        "Buka proyek dan masuk ke bagian Requests.",
        "Pilih New RFQ. Isi Summary serta spesifikasi, kuantitas, merek, dan batasan yang sudah diketahui.",
        "Pilih Create request.",
        "Salin teks email ke Outlook lalu kirim sendiri ke grup Purchasing.",
      ],
      editable: ["Details", "Needed by"],
      handoff: "Purchasing diberi tahu di aplikasi. SOA tidak menerima teks email untuk RFQ yang diajukan Sales.",
      links: [PROJECTS, { label: "New request", href: "/requests/new", anyOf: ["requests.create"] }],
    },
  },
  {
    id: "sales.po",
    role: "SALES",
    kind: "decision",
    title: "Putuskan PO",
    next: "Purchasing",
    col: 8,
    row: 1,
    action: "Pada RFQ yang sudah selesai, pilih Continue to PO atau Do not continue. PO hanya bisa diajukan setelah proyek memiliki RFQ yang sudah selesai.",
    input: "RFQ Completed yang belum punya keputusan, dan catatan opsional maksimal 500 karakter.",
    output: "Request PO berstatus Submitted untuk Purchasing yang merujuk ke RFQ-nya, atau keputusan tercatat untuk tidak melanjutkan (catatan menjelaskan alasannya).",
    recipient: "Purchasing (Sales dan tim Purchasing diberi tahu)",
    guide: {
      where: "Open the completed RFQ → What happens next?",
      prerequisites: ["RFQ sudah Completed dan belum pernah diputuskan.", "Anda pemilik proyek (salesperson mana pun boleh memutuskan untuk proyek bersumber Other), atau Anda Admin."],
      steps: [
        "Buka RFQ yang sudah selesai dari bagian Requests proyek atau dari RFQ requests.",
        "Di What happens next?, tambahkan catatan jika perlu.",
        "Pilih Continue to PO, atau Do not continue dan tulis alasannya di catatan.",
      ],
      editable: ["Note"],
      handoff: "Melanjutkan akan membuat request PO untuk Purchasing. Pembelian baru berjalan setelah seseorang memutuskan untuk melanjutkan RFQ.",
      links: [PROJECTS],
    },
  },
  {
    id: "sales.track",
    role: "SALES",
    kind: "action",
    title: "Perbarui detail komersial",
    next: "Semua orang (tampilan bersama)",
    col: 9,
    row: 0,
    action: "Jaga sisi komersial proyek tetap terbaru dan pantau di halaman Sales pipeline dan Sales targets.",
    input: "Opportunity date, Progress, Status, Gross Profit, Quote released, Target closing, Final value, dan Won date seiring perkembangan deal.",
    output: "Angka pipeline yang terbaru dan change log untuk setiap perubahan. Semua peran bisa membaca proyek; Finance membaca nilai dan referensinya.",
    recipient: "Semua orang yang bisa membaca proyek",
    guide: {
      where: "Project → Commercial; Sales pipeline; Sales targets",
      prerequisites: ["Anda Sales PIC proyek ini (atau proyeknya dari sumber lain), atau Anda Admin."],
      steps: [
        "Buka proyek dan masuk ke bagian Commercial.",
        "Perbarui Progress, Status, nilai, margin, dan tanggal, lalu simpan. Setiap perubahan dicatat di change log.",
        "Mengisi Quote released akan memindahkan Progress ke Propose jika proyek masih Opportunity, dan mengisi Won date memindahkannya ke Closed Won.",
        "Pantau pipeline Anda di Sales pipeline dan target Anda di halaman Sales targets.",
        "Cek bagian Requests untuk melihat posisi BOQ, RFQ, dan PO.",
      ],
      editable: ["Opportunity date", "Progress", "Status", "Gross Profit", "Quote released", "Target closing", "Final value", "Won date"],
      handoff: "Tidak ada serah terima. Semua peran bisa membaca detail proyek; hanya Sales PIC yang mengedit field komersial.",
      links: [
        { label: "Sales pipeline", href: "/dashboard/sales", anyOf: ["dashboard.sales.view"] },
        { label: "Sales targets", href: "/targets", anyOf: ["dashboard.sales.view"] },
        PROJECTS,
      ],
    },
  },

  // ---- SOA -----------------------------------------------------------------------------------------------------------------
  {
    id: "soa.register",
    role: "SOA",
    kind: "action",
    title: "Daftarkan proyek",
    next: "BOQ tickets",
    col: 0,
    action:
      "Daftarkan proyek untuk salesperson yang Anda pilih (source Internal Sales), atau untuk perusahaan sales eksternal atau sumber lain (source Other, tanpa Sales PIC internal), lalu ajukan BOQ-nya di form yang sama.",
    input: "End-user company dan Project name. Untuk Internal Sales, salesperson (wajib). Untuk Other, nama sales eksternal (wajib).",
    output: "Proyek dan, jika dipilih, request BOQ pertamanya.",
    recipient: "BOQ tickets milik SOA sendiri",
    guide: {
      where: "Projects → New project",
      prerequisites: ["Anda masuk dengan akun SOA (Admin atau Superadmin juga bisa melakukannya)."],
      steps: [
        "Buka Projects lalu pilih New project.",
        "Pilih Project source: Internal Sales (lalu pilih salesperson) atau Other (lalu isi nama sales).",
        "Isi End-user company dan Project name.",
        "Pilih BOQ pada pilihan request, isi ringkasannya, lalu buat proyek dan request-nya.",
      ],
      editable: ["Project source", "Sales PIC or external sales name", "End-user company", "Project name", "Request details"],
      handoff: "BOQ masuk ke BOQ tickets, siap untuk ditriase.",
      links: [PROJECTS_NEW, PROJECTS],
    },
  },
  {
    id: "soa.receive",
    role: "SOA",
    kind: "action",
    title: "Terima dan triase BOQ",
    next: "SOA PIC",
    col: 2,
    action: "BOQ baru muncul di BOQ tickets dan SOA diberi tahu. Tetapkan PIC (orang SOA yang bernama, bukan akun login) lalu mulai pekerjaannya.",
    input: "Request BOQ (summary, details, Needed by) dan email dari Sales.",
    output: "BOQ dengan PIC, dipindah dari Submitted ke In progress.",
    recipient: "SOA PIC yang mengerjakan BOQ",
    guide: {
      where: "BOQ tickets → open the request",
      prerequisites: ["BOQ berstatus Submitted.", "Ada setidaknya satu SOA PIC aktif (Admin mengelola daftarnya di PICs)."],
      steps: [
        "Buka BOQ tickets dan buka request baru tersebut.",
        "Di kartu PIC, pilih PIC lalu pilih Save PIC. Perubahan tercatat di PIC history.",
        "Buka BOQ board dan seret kartunya dari Submitted ke In progress.",
      ],
      editable: ["PIC", "Request status"],
      handoff: "Requester dan Sales PIC proyek diberi tahu setiap kali status berubah.",
      links: [{ label: "BOQ tickets", href: "/requests/boq", anyOf: ["requests.view"] }],
    },
  },
  {
    id: "soa.work",
    role: "SOA",
    kind: "action",
    title: "Kerjakan kebutuhan teknis",
    next: "Sales (lewat email)",
    col: 3,
    action: "Catat detail teknis di proyek, tandai bagian pekerjaan yang sedang dikerjakan (Assessment, Sizing, atau POC), dan posting update.",
    input: "Kebutuhan customer dan temuan assessment Anda.",
    output:
      "Field teknis yang diperbarui (setiap perubahan dicatat dari dan ke), label phase yang diberitahukan ke Sales dan Purchasing, serta entri Current action dan Next action di Activity feed proyek.",
    recipient: "Sales, lewat email untuk pertanyaan; semua orang, lewat halaman proyek",
    guide: {
      where: "Project → Technical and Activity (SOA phase is on the Technical tab)",
      prerequisites: ["BOQ masih terbuka (Submitted, In progress, atau Revision)."],
      steps: [
        "Buka proyek. Di bagian Technical, atur klasifikasi (principal dan solution) dan isi detail teknis, lalu pilih Save technical details.",
        "Masih di bagian Technical, pilih SOA phase proyek (Assessment, Sizing, POC, atau phase tambahan). Phase milik proyek, bukan milik satu request BOQ.",
        "Di bagian Activity, posting apa yang sudah dikerjakan (Current action) dan apa yang berikutnya (Next action).",
        "Ajukan pertanyaan ke Sales dan sepakati revisi lewat email agar riwayatnya tetap tersimpan. Status Waiting for Sales sudah tidak dipakai.",
      ],
      editable: [
        "Requirement",
        "Assessment, architecture, sizing, BOQ, quotation, proposal and POC status",
        "Solution proposed",
        "Scope estimate",
        "Technical challenge, blocker and notes",
        "Principals and solution",
        "SOA phase",
      ],
      handoff: "Field teknis hanya diedit oleh SOA. Field komersial milik Sales tetap read-only bagi SOA.",
      links: [PROJECTS, { label: "BOQ tickets", href: "/requests/boq", anyOf: ["requests.view"] }],
    },
  },
  {
    id: "soa.complete",
    role: "SOA",
    kind: "action",
    title: "Siapkan dan selesaikan BOQ",
    next: "Purchasing handoff",
    col: 4,
    action:
      "Siapkan BOQ, lalu pindahkan kartunya ke Completed di BOQ board. Dokumen BOQ sendiri disiapkan di luar aplikasi; aplikasi mencatat request, statusnya, dan riwayatnya.",
    input: "BOQ yang sudah jadi. Membatalkan memerlukan alasan.",
    output: "BOQ berstatus Completed. Requester dan Sales PIC proyek diberi tahu, dan BOQ masuk daftar Ready for handoff.",
    recipient: "Daftar Purchasing handoff (siap diputuskan)",
    guide: {
      where: "BOQ tickets → board view",
      prerequisites: ["BOQ berstatus Submitted, In progress, atau Revision."],
      steps: [
        "Buka BOQ board.",
        "Seret kartu ke Completed. Kartu Submitted boleh langsung ke Completed.",
        "Jika customer kemudian meminta perubahan (disepakati lewat email), seret kartu yang sudah selesai ke Revision, kerjakan ulang, lalu selesaikan lagi.",
        "Untuk menghentikan request, seret ke Cancelled dan isi alasannya.",
      ],
      editable: ["Request status (with a reason for Cancelled)"],
      handoff: "BOQ yang selesai tidak mengesahkan apa pun dengan sendirinya: harus ada yang memutuskan apakah dilanjutkan.",
      links: [{ label: "BOQ tickets", href: "/requests/boq", anyOf: ["requests.view"] }],
    },
  },
  {
    id: "soa.handoff",
    role: "SOA",
    kind: "handoff",
    title: "Serahkan ke Purchasing",
    next: "Purchasing",
    col: 5,
    action:
      "Pada BOQ yang sudah selesai pilih Continue to RFQ, yang membuat request RFQ untuk Purchasing dengan rujukan ke BOQ-nya, atau Do not continue dengan catatan. Sales pemilik proyek dan Admin juga dapat membuat keputusan ini.",
    input: "BOQ Completed yang belum punya keputusan, dan catatan opsional maksimal 500 karakter.",
    output: "Request RFQ berstatus Submitted. Purchasing, requester, dan Sales PIC diberi tahu, dan RFQ masuk daftar Recently handed over. Atau keputusan tercatat untuk tidak melanjutkan.",
    recipient: "Purchasing",
    guide: {
      where: "Purchasing handoff → Ready for handoff → open the BOQ → What happens next?",
      prerequisites: ["BOQ sudah Completed dan belum pernah diputuskan."],
      steps: [
        "Buka Purchasing handoff. BOQ selesai yang menunggu keputusan ditampilkan, yang terlama di atas.",
        "Buka salah satunya dan baca What happens next?.",
        "Tambahkan catatan jika perlu, lalu pilih Continue to RFQ (atau Do not continue dan tulis alasannya).",
        "Gunakan teks email pada RFQ baru dan balas di thread email BOQ asli agar percakapan tetap satu alur.",
      ],
      editable: ["Decision note"],
      handoff: "RFQ tetap terhubung ke proyek dan merujuk ke BOQ-nya. Purchasing melihatnya di RFQ requests.",
      links: [{ label: "Purchasing handoff", href: "/handoffs", anyOf: ["handoffs.view"] }],
    },
  },

  // ---- Purchasing ----------------------------------------------------------------------------------------------------------
  {
    id: "pur.raise",
    role: "PURCHASING",
    kind: "handoff",
    title: "Ajukan RFQ untuk proyek",
    next: "Purchasing, diberitahukan ke Sales dan SOA",
    col: 5,
    action:
      "Ajukan RFQ sendiri untuk proyek yang sudah ada. Persempit daftar proyek berdasarkan Sales PIC atau SOA PIC; PIC proyek ditampilkan. RFQ masuk ke Purchasing dan juga diberitahukan ke Sales PIC dan SOA PIC proyek.",
    input: "Proyek, ringkasan satu baris (wajib), detail, dan tanggal Needed by (opsional). Opsional juga Sales PIC dan SOA PIC untuk mempersempit daftar proyek.",
    output:
      "Request RFQ berstatus Submitted. Tim Purchasing, Sales PIC, dan SOA PIC proyek diberi tahu, dan RFQ tampil di Sales dashboard milik Sales PIC. Cara ini hanya berlaku untuk RFQ.",
    recipient: "Purchasing; Sales PIC dan SOA PIC proyek diberi tahu",
    guide: {
      where: "RFQ requests → New RFQ request",
      prerequisites: ["Proyek sudah ada (didaftarkan Sales atau SOA) dan statusnya On Track."],
      steps: [
        "Buka RFQ requests lalu pilih New RFQ request.",
        "Opsional, pilih Sales PIC dan SOA PIC untuk mempersempit daftar, lalu pilih proyeknya. Sales PIC dan SOA PIC-nya muncul di sampingnya.",
        "Isi Summary serta spesifikasi, kuantitas, merek, dan batasan yang sudah diketahui, lalu pilih Create request.",
        "RFQ muncul di daftar RFQ Anda; Sales PIC melihatnya di Request center dan di dashboard-nya.",
      ],
      editable: ["Project", "Details", "Needed by"],
      handoff: "Sales PIC dan SOA PIC diberi tahu di aplikasi. Purchasing tidak mengirim email request: Sales PIC bisa menyalinnya dari request.",
      links: [{ label: "RFQ requests", href: "/requests/rfq", anyOf: ["requests.view"] }, { label: "New request", href: "/requests/new", anyOf: ["requests.create.rfq", "requests.create"] }],
    },
  },
  {
    id: "pur.receive",
    role: "PURCHASING",
    kind: "action",
    title: "Terima RFQ",
    next: "Purchasing PIC",
    col: 6,
    action: "RFQ datang dari Sales, atau dari SOA setelah BOQ. RFQ muncul di RFQ requests dan Purchasing diberi tahu. Tetapkan PIC.",
    input: "Request RFQ: summary, details, Needed by, dan rujukan ke BOQ jika diserahkan dari BOQ.",
    output: "RFQ dengan Purchasing PIC.",
    recipient: "Purchasing PIC yang mengerjakan RFQ",
    guide: {
      where: "RFQ requests → open the request",
      prerequisites: ["RFQ berstatus Submitted.", "Ada setidaknya satu Purchasing PIC aktif (Admin mengelola daftarnya di PICs)."],
      steps: [
        "Buka RFQ requests dan buka request baru tersebut.",
        "Di kartu PIC, pilih PIC lalu pilih Save PIC.",
        "Di kartu Distributor, pilih distributor yang dituju RFQ ini lalu simpan. Jenis pembayarannya (CBD, COD, atau TOP) ikut tampil. Distributor baru ditambahkan di menu Distributors.",
        "Buka RFQ board dan seret kartunya dari Submitted ke In progress.",
      ],
      editable: ["PIC", "Distributor", "Request status"],
      handoff: "Requester dan Sales PIC proyek diberi tahu setiap kali status berubah.",
      links: [
        { label: "RFQ requests", href: "/requests/rfq", anyOf: ["requests.view"] },
        { label: "Distributors", href: "/distributors", anyOf: ["distributors.manage"] },
      ],
    },
  },
  {
    id: "pur.quote",
    role: "PURCHASING",
    kind: "action",
    title: "Perbarui progres quotation",
    next: "Sales",
    col: 7,
    action:
      "Jaga status dan PIC RFQ tetap terbaru sampai quotation selesai. Pekerjaan quotation sendiri dilakukan di luar aplikasi; aplikasi mencatat request-nya.",
    input: "Keadaan pekerjaan quotation. Membatalkan RFQ, atau mengembalikan RFQ yang sudah selesai untuk direvisi, memerlukan alasan.",
    output: "RFQ berstatus Completed. Requester dan Sales PIC proyek diberi tahu, dan RFQ menjadi referensi quotation proyek untuk Finance.",
    recipient: "Sales, yang memutuskan apakah dilanjutkan ke PO",
    guide: {
      where: "RFQ requests → board view",
      prerequisites: ["RFQ berstatus Submitted atau In progress."],
      steps: [
        "Buka RFQ board.",
        "Seret kartu ke In progress selama dikerjakan, dan ke Completed saat quotation selesai.",
        "Ganti PIC di halaman request jika pekerjaan berpindah ke orang lain.",
        "Untuk menghentikan request, seret ke Cancelled dan isi alasannya. RFQ yang sudah selesai bisa dikembalikan ke Revision, juga dengan alasan; jam SLA revisi mulai dari saat itu.",
      ],
      editable: ["Status request (dengan alasan untuk Cancelled dan pembukaan kembali)", "PIC"],
      handoff: "Sales yang memutuskan apakah RFQ yang selesai dilanjutkan ke PO. Purchasing tidak membuat PO sendiri.",
      links: [{ label: "RFQ requests", href: "/requests/rfq", anyOf: ["requests.view"] }],
    },
  },
  {
    id: "pur.po",
    role: "PURCHASING",
    kind: "action",
    title: "Proses PO",
    next: "Sales dan Finance",
    col: 9,
    action: "Kerjakan request PO yang diajukan Sales dari RFQ yang sudah selesai, lalu selesaikan.",
    input: "Request PO, yang merujuk ke RFQ yang sudah selesai.",
    output: "PO berstatus Completed. Requester dan Sales PIC proyek diberi tahu, dan PO menjadi referensi PO proyek untuk Finance.",
    recipient: "Sales (diberi tahu) dan Finance (membaca referensinya)",
    guide: {
      where: "PO requests → board view",
      prerequisites: ["Request PO berstatus Submitted. PO hanya ada setelah RFQ selesai."],
      steps: [
        "Buka PO requests dan buka request baru tersebut.",
        "Tetapkan PIC di kartu PIC lalu pilih Save PIC.",
        "Di PO board, seret kartu ke In progress, lalu ke Completed. PO yang sudah selesai bisa dikembalikan ke Revision dengan alasan; jam SLA revisi mulai dari saat itu.",
      ],
      editable: ["PIC", "Status request (dengan alasan untuk Cancelled dan pembukaan kembali)"],
      handoff: "PO adalah langkah terakhir alur ini. Sales dan Finance membaca hasilnya.",
      links: [{ label: "PO requests", href: "/requests/po", anyOf: ["requests.view"] }],
    },
  },

  // ---- Finance -------------------------------------------------------------------------------------------------------------
  {
    id: "fin.check",
    role: "FINANCE",
    kind: "readonly",
    title: "Cocokkan nilai dan referensi",
    next: "Tanpa handoff (hanya baca)",
    col: 9,
    action:
      "Bandingkan nilai setiap proyek dengan referensi quotation (RFQ) dan PO-nya serta dengan progress-nya. Flag: Closed Won tanpa final value, tanpa referensi PO, atau tanpa referensi quotation, dan PO selesai pada proyek yang belum Closed Won.",
    input: "Tanpa isian. Opsional: filter berdasarkan flag, pencarian, dan unduh daftar sebagai CSV.",
    output: "Daftar proyek beserta flag-nya, hanya untuk dibaca.",
    recipient: "Tidak ada: Finance membaca dan melapor lewat jalurnya sendiri",
    guide: {
      where: "Financial crosscheck",
      prerequisites: ["Sudah ada proyek dengan request RFQ dan PO."],
      steps: [
        "Buka Financial crosscheck.",
        "Pilih flag untuk melihat proyek yang perlu dicek saja, atau cari proyek tertentu.",
        "Buka proyek untuk membaca nilainya, Requests-nya, dan riwayat di balik referensi.",
        "Unduh CSV jika daftar ini dibutuhkan di tempat lain.",
      ],
      editable: [READ_ONLY],
      handoff: "Finance tidak bisa mengubah proyek atau request. Selisih diperbaiki oleh Sales (field komersial) atau Purchasing (request).",
      links: [
        { label: "Financial crosscheck", href: "/finance/crosscheck", anyOf: ["finance.crosscheck.view"] },
        { label: "Finance dashboard", href: "/dashboard/finance", anyOf: ["dashboard.finance.view"] },
        PROJECTS,
      ],
    },
  },

  // ---- Management ----------------------------------------------------------------------------------------------------------
  {
    id: "mgmt.follow",
    role: "MANAGEMENT",
    kind: "readonly",
    title: "Pantau progres",
    next: "Tanpa handoff (hanya baca)",
    col: 9,
    action: "Baca dashboard dan laporan. Peran ini tidak mengubah apa pun.",
    input: "Tanpa isian.",
    output: "Overview, Management dashboard, Technical reports, dan Financial crosscheck.",
    recipient: "Tidak ada",
    guide: {
      where: "Overview, Management dashboard, Technical reports, Financial crosscheck",
      prerequisites: ["Tidak ada."],
      steps: [
        "Buka Overview untuk pipeline dan jumlah request.",
        "Buka Technical reports untuk laporan BOQ bulanan.",
        "Buka Financial crosscheck untuk membaca nilai dan referensi.",
        "Buka proyek atau request mana pun untuk membaca detail dan riwayatnya.",
      ],
      editable: [READ_ONLY],
      handoff: "Tidak ada.",
      links: [
        { label: "Overview", href: "/dashboard", anyOf: ["dashboard.shared.view"] },
        { label: "Management dashboard", href: "/dashboard/management", anyOf: ["dashboard.management.view"] },
        { label: "Technical reports", href: "/reports/technical", anyOf: ["reports.technical.view"] },
        { label: "Financial crosscheck", href: "/finance/crosscheck", anyOf: ["finance.crosscheck.view"] },
      ],
    },
  },

  // ---- Administration ------------------------------------------------------------------------------------------------------
  {
    id: "admin.setup",
    role: "ADMIN",
    kind: "setup",
    title: "Kelola pengguna, PIC, dan master data",
    next: "SOA dan Purchasing",
    col: 2,
    action: "Buat dan kelola akun operasional, pelihara daftar SOA PIC dan Purchasing PIC, serta master data (principal dan solution) yang dipilih di form proyek.",
    input: "Nama, peran, dan status pengguna operasional dan PIC; data master.",
    output: "Akun yang bisa masuk, dan PIC yang menjadi tujuan tiket. Admin juga bisa membaca audit log, permission matrix, dan SLA policies.",
    recipient: "SOA dan Purchasing, yang memilih PIC dari daftar ini",
    guide: {
      where: "Users and roles, PICs, Master data, Audit logs",
      prerequisites: ["Anda memiliki akun Admin atau Superadmin."],
      steps: [
        "Buka Users and roles untuk membuat pengguna operasional, mengubah peran, menonaktifkan akun, atau mereset kata sandi.",
        "Buka PICs untuk menambah atau menonaktifkan orang yang menjadi tujuan tiket SOA dan Purchasing. PIC bukan akun login.",
        "Buka Master data untuk mengelola principal dan solution.",
        "Buka Audit logs untuk melihat siapa mengubah apa.",
      ],
      editable: ["Operational users", "PICs", "Master data"],
      handoff: "Admin hanya bisa mengelola peran operasional. Akun Admin dan Superadmin dikelola oleh Superadmin.",
      links: [
        { label: "Users and roles", href: "/admin/users", anyOf: ["users.view"] },
        { label: "PICs", href: "/admin/pics", anyOf: ["pics.manage"] },
        { label: "Master data", href: "/admin/master-data", anyOf: ["masterdata.manage"] },
        { label: "Audit logs", href: "/admin/audit", anyOf: ["audit.view"] },
      ],
    },
  },
  {
    id: "super.config",
    role: "SUPERADMIN",
    kind: "setup",
    title: "Permissions dan pengaturan sistem",
    next: "Admin dan semua peran",
    col: 2,
    action: "Tentukan apa yang boleh dilakukan setiap peran, atur rentang SLA dan email template per tim, dan jaga sistem.",
    input: "Pemberian permission per peran, SLA policies, dan alat sistem.",
    output: "Aturan yang menjadi dasar setiap request yang masuk, tercatat di audit log.",
    recipient: "Admin dan semua peran (perubahan berlaku pada request berikutnya)",
    guide: {
      where: "Permissions, Email, SLA, System, Backups",
      prerequisites: ["Anda memiliki akun Superadmin."],
      steps: [
        "Buka Permissions untuk memberi atau mencabut permission suatu peran. Setiap penyimpanan dicatat sebagai satu audit event per peran yang berubah.",
        "Buka SLA untuk mengubah rentang SLA tiap tim, dan Email untuk mengubah penerima (To/CC) dan template email tiap tim.",
        "Buka System untuk memantau kesehatan aplikasi dan database, dan Backups untuk membuat dump database.",
        "Kelola akun Admin dan Superadmin di Users and roles.",
      ],
      editable: ["Role permissions", "SLA policies and email templates", "Admin and Superadmin accounts"],
      handoff: "Superadmin selalu mempertahankan permission untuk mengelola akun dan permission.",
      links: [
        { label: "Permissions", href: "/admin/permissions", anyOf: ["permissions.view"] },
        { label: "Email", href: "/admin/settings/email", anyOf: ["settings.view"] },
        { label: "SLA", href: "/admin/settings/sla", anyOf: ["settings.view"] },
        { label: "System", href: "/admin/system", anyOf: ["system.monitor"] },
        { label: "Backups", href: "/admin/backups", anyOf: ["system.backup"] },
      ],
    },
  },
];

export const GUIDE_EDGES: readonly GuideEdge[] = [
  { from: "sales.create", to: "sales.boq", style: "work", route: "h" },
  { from: "sales.create", to: "sales.rfq", style: "work", route: "vh", label: "Tanpa BOQ" },
  { from: "soa.register", to: "soa.receive", style: "work", route: "h" },
  { from: "sales.boq", to: "soa.receive", style: "handoff", route: "curve" },
  { from: "sales.revise", to: "soa.complete", style: "handoff", route: "v", label: "Revision" },
  { from: "soa.receive", to: "soa.work", style: "work", route: "h" },
  { from: "soa.work", to: "soa.complete", style: "work", route: "h" },
  { from: "soa.complete", to: "soa.handoff", style: "work", route: "h" },
  { from: "soa.handoff", to: "pur.receive", style: "handoff", route: "curve" },
  { from: "sales.rfq", to: "pur.receive", style: "handoff", route: "hv" },
  { from: "pur.raise", to: "pur.receive", style: "work", route: "h" },
  { from: "pur.receive", to: "pur.quote", style: "work", route: "h" },
  { from: "pur.quote", to: "sales.po", style: "handoff", route: "hv" },
  { from: "sales.po", to: "pur.po", style: "handoff", route: "curve" },
  { from: "pur.po", to: "sales.track", style: "handoff", route: "v" },
  { from: "pur.po", to: "fin.check", style: "support", route: "v", label: "Referensi, hanya baca" },
  { from: "admin.setup", to: "soa.receive", style: "support", route: "v", label: "PICs" },
  { from: "admin.setup", to: "pur.receive", style: "support", route: "hv" },
  { from: "super.config", to: "admin.setup", style: "support", route: "v", label: "Permissions, SLA" },
];

export const GUIDE_NODES_BY_ID: ReadonlyMap<string, GuideNode> = new Map(GUIDE_NODES.map((node) => [node.id, node]));
