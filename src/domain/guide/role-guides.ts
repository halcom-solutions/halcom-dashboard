import type { Role } from "@/domain/access/roles";

/**
 * What each role reads and what it edits, kept apart on purpose: by default every role reads every project and request
 * (docs/requirements/RBAC.md, assumption A-9), but only the role that owns a field edits it. These sentences describe the default
 * permission matrix; the Permissions page shows the live one. Written in Indonesian; page, field and role names stay as the
 * application shows them.
 */
export type RoleGuide = { summary: string; reads: readonly string[]; edits: readonly string[]; cannot: readonly string[] };

const EVERY_PROJECT = "Semua proyek dan request, beserta riwayatnya";
const NO_CHANGES = "Mengubah proyek atau request apa pun";

export const ROLE_GUIDES: Record<Role, RoleGuide> = {
  SALES: {
    summary: "Membuat proyek, mengelola pipeline, meminta BOQ ke SOA atau RFQ ke Purchasing, memutuskan kelanjutan request yang sudah selesai, dan memantau progres.",
    reads: [EVERY_PROJECT, "Customers, Sales pipeline, Request center, dan Sales targets"],
    edits: [
      "Field komersial proyek milik Anda sendiri (dan proyek dari sumber lain)",
      "Proyek baru serta request BOQ, RFQ, dan PO",
      "Keputusan untuk melanjutkan BOQ atau RFQ yang sudah selesai pada proyek Anda",
      "Mengembalikan BOQ yang sudah selesai ke SOA untuk direvisi",
      "Industri customer (halaman Customers)",
      "Target sales Anda sendiri",
    ],
    cannot: ["Field teknis (SOA)", "Status dan PIC request (SOA dan Purchasing)", "Field komersial proyek milik salesperson lain"],
  },
  SOA: {
    summary: "Menerima request BOQ, mengelola kebutuhan teknis dan assessment, menyiapkan dan menyelesaikan BOQ, lalu menyerahkannya ke Purchasing.",
    reads: [EVERY_PROJECT, "BOQ tickets, Purchasing handoff, dan Technical reports", "Nilai komersial, hanya baca"],
    edits: [
      "Field teknis dan klasifikasi proyek, dengan change log",
      "Update Current action dan Next action",
      "Status dan PIC BOQ, serta SOA phase proyek",
      "Keputusan untuk melanjutkan BOQ yang sudah selesai ke RFQ",
      "Proyek yang didaftarkan untuk salesperson atau dari sumber lain, serta import proyek",
      "Master data principal dan solution",
    ],
    cannot: ["Field komersial (Sales)", "Status RFQ dan PO (Purchasing)", "Keputusan untuk melanjutkan RFQ yang sudah selesai ke PO (Sales, Purchasing, atau Admin)"],
  },
  PURCHASING: {
    summary: "Menerima request RFQ, mengajukan RFQ untuk proyek yang sudah ada, menjaga progres quotation tetap terbaru, meneruskan RFQ yang selesai ke PO, dan memproses PO.",
    reads: [EVERY_PROJECT, "Purchasing dashboard, RFQ requests, dan PO requests"],
    edits: [
      "Status RFQ dan PO",
      "PIC RFQ atau PO",
      "Request RFQ baru untuk proyek yang sudah ada (diberitahukan ke Sales PIC dan SOA PIC proyek)",
      "Keputusan untuk meneruskan RFQ yang sudah selesai ke PO (hak Continue an RFQ to a PO, bisa dicabut Superadmin)",
    ],
    cannot: ["Membuat proyek", "Mengajukan request BOQ atau PO baru dari nol", "Mengedit field proyek", "Mengubah status BOQ", "Memutuskan kelanjutan BOQ ke RFQ"],
  },
  FINANCE: {
    summary: "Meninjau nilai proyek serta referensi quotation dan PO untuk pencocokan. Hanya baca.",
    reads: [EVERY_PROJECT, "Finance dashboard dan Financial crosscheck, dengan unduhan CSV"],
    edits: [],
    cannot: [NO_CHANGES],
  },
  MANAGEMENT: {
    summary: "Memantau progres lewat dashboard dan laporan. Hanya baca.",
    reads: [EVERY_PROJECT, "Overview, Management dashboard, Technical reports, dan Financial crosscheck"],
    edits: [],
    cannot: [NO_CHANGES],
  },
  ADMIN: {
    summary: "Mengelola pengguna operasional, PIC, dan master data, serta bisa membantu Sales, SOA, dan Purchasing.",
    reads: ["Semua dashboard kecuali milik Superadmin, proyek, request, audit log, permission matrix, dan SLA policies"],
    edits: ["Pengguna operasional", "PIC", "Master data", "Proyek dan request atas nama tim, sesuai permission matrix"],
    cannot: ["Mengubah permission", "Mengelola akun Admin dan Superadmin", "Mengedit SLA policies", "Menggunakan System dan Backups"],
  },
  SUPERADMIN: {
    summary: "Pemilik sistem: akun semua peran, permission, SLA policies, pemantauan sistem, dan backup.",
    reads: ["Semuanya"],
    edits: ["Akun semua peran", "Permissions", "SLA policies dan email template", "Backup dan alat sistem"],
    cannot: ["Menghapus permission penting milik sendiri: editor permission tetap mempertahankannya"],
  },
};
