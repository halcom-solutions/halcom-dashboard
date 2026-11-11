import { DASHBOARD_KEYS, type DashboardKey } from "./dashboards";
import { ALL_PERMISSIONS, type Permission } from "./permissions";
import { ROLE_LABELS, ROLES } from "./roles";

/**
 * How the permission editor groups and explains every permission. The identifiers stay exactly as the code checks them; only the
 * label, the description and the category are added here. The `Record<Permission, …>` types make the compiler refuse a permission
 * that is missing, and a unit test proves each one is listed in exactly one category.
 */
export const PERMISSION_CATEGORIES = [
  { id: "dashboard-access", title: "Dashboard Access", description: "Dashboard yang bisa dibuka suatu peran. Tiap dashboard diberikan sendiri-sendiri." },
  { id: "user-role-management", title: "User & Role Management", description: "Melihat dan mengelola akun dan perannya." },
  { id: "permission-management", title: "Permission Management", description: "Melihat dan mengubah hak akses tiap peran." },
  { id: "project-management", title: "Project Management", description: "Mendaftarkan, mengubah, mengimpor, memindahkan PIC, dan menghapus project." },
  { id: "request-workflow", title: "Request, BOQ, RFQ & Handoffs", description: "Mengajukan dan mengerjakan request BOQ, RFQ, dan PO, serta menyerahkan BOQ ke Purchasing." },
  { id: "master-data", title: "Master data, Principals, Customers & PICs", description: "Daftar rujukan project dan request, serta orang tujuan tiket." },
  { id: "sales-pipeline", title: "Sales pipeline & Targets", description: "Target milik salesperson sendiri." },
  { id: "finance", title: "Finance & Crosscheck", description: "Membaca nilai project terhadap referensi quotation dan PO." },
  { id: "reports", title: "Reports & Analytics", description: "Laporan operasional dan export-nya." },
  { id: "audit-system", title: "Audit, System & Configuration", description: "Audit log, kondisi sistem, backup, kebijakan SLA, dan tema." },
] as const;

export type PermissionCategoryId = (typeof PERMISSION_CATEGORIES)[number]["id"];

type Entry = { category: PermissionCategoryId; label: string; description: string };

const DASHBOARD_LABELS: Record<DashboardKey, string> = {
  superadmin: ROLE_LABELS.SUPERADMIN,
  admin: ROLE_LABELS.ADMIN,
  sales: ROLE_LABELS.SALES,
  soa: ROLE_LABELS.SOA,
  purchasing: ROLE_LABELS.PURCHASING,
  finance: ROLE_LABELS.FINANCE,
  management: ROLE_LABELS.MANAGEMENT,
};

const DASHBOARD_ENTRIES = Object.fromEntries(
  DASHBOARD_KEYS.map((key) => [
    `dashboard.${key}.view`,
    { category: "dashboard-access", label: `${DASHBOARD_LABELS[key]} dashboard`, description: `Buka dashboard ${DASHBOARD_LABELS[key]} di /dashboard/${key}.` } satisfies Entry,
  ]),
) as Record<`dashboard.${DashboardKey}.view`, Entry>;

export const PERMISSION_CATALOG: Record<Permission, Entry> = {
  "dashboard.shared.view": { category: "dashboard-access", label: "Overview", description: "Buka Overview bersama di /dashboard: progres project dan statistik request." },
  ...DASHBOARD_ENTRIES,

  "users.view": { category: "user-role-management", label: "View users", description: "Lihat daftar akun dan jumlah akun di Admin dashboard." },
  "users.manage": { category: "user-role-management", label: "Manage users", description: "Buat akun, ubah peran, nonaktifkan, dan reset kata sandi pengguna operasional." },
  "users.manage-privileged": { category: "user-role-management", label: "Manage admin accounts", description: "Buat dan ubah akun Admin dan Superadmin. Hanya Superadmin yang bisa memegangnya." },
  "logins.manage": { category: "user-role-management", label: "Unlock sign-ins", description: "Lihat akun dan alamat yang terkunci karena terlalu sering salah kata sandi, dan buka kuncinya. Hanya Superadmin yang bisa memegangnya." },
  "users.impersonate": { category: "user-role-management", label: "View as another user", description: "Masuk sebagai akun lain (bukan Admin atau Superadmin) untuk memeriksa tampilannya. Hanya lihat, selama 1 jam, dan tercatat di audit log. Hanya Superadmin yang bisa memegangnya." },
  "users.change-email": { category: "user-role-management", label: "Change user e-mail", description: "Ubah alamat email untuk masuk. Hanya Superadmin yang bisa memegangnya." },

  "permissions.view": { category: "permission-management", label: "View permissions", description: "Buka halaman Permissions dan lihat hak akses tiap peran." },
  "permissions.manage": { category: "permission-management", label: "Manage permissions", description: "Beri dan cabut hak akses peran. Hanya Superadmin yang bisa memegangnya." },

  "projects.view": { category: "project-management", label: "View projects", description: "Lihat daftar project, halaman project, chart Overview, dan export project." },
  "projects.create": { category: "project-management", label: "Register own projects", description: "Daftarkan project sebagai Sales owner (source Internal Sales)." },
  "projects.create.external": { category: "project-management", label: "Register external projects", description: "Daftarkan project dari luar tim Sales internal (source Other)." },
  "projects.assign-sales": { category: "project-management", label: "Register for a salesperson", description: "Pilih salesperson internal yang didaftarkan untuk sebuah project." },
  "projects.import": { category: "project-management", label: "Import projects", description: "Tambah project baru dari sheet Excel (baris tanpa Project ID) lewat Import / Export, dan unduh templatenya." },
  "projects.edit.source": { category: "project-management", label: "Edit project source", description: "Ubah project antara Internal Sales dan Other, beserta data external sales." },
  "projects.edit.technical": { category: "project-management", label: "Edit technical fields", description: "Ubah field teknis project, dengan change log." },
  "projects.edit.principal": { category: "project-management", label: "Fill in Principals", description: "Isi atau ubah Principal project (SOA, Sales, Purchasing), juga lewat kolom Principals di Excel. Principal yang belum ada dibuat otomatis." },
  "projects.rename": { category: "project-management", label: "Rename projects", description: "Ubah nama project; nama lama dan baru masuk change log." },
  "projects.edit.description": { category: "project-management", label: "Edit project description", description: "Ubah deskripsi project (di halaman project dan lewat Excel); Sales hanya untuk project yang ia tangani; Admin dan Superadmin untuk semua project. Perubahan masuk change log." },
  "projects.edit.commercial": { category: "project-management", label: "Edit commercial fields", description: "Ubah nilai, margin, probability, dan field komersial lain." },
  "projects.delete": { category: "project-management", label: "Delete projects", description: "Hapus project (disembunyikan, riwayatnya tetap)." },
  "projects.reassign": { category: "project-management", label: "Reassign project PICs", description: "Pindahkan project ke Sales, Technical (SOA), atau Purchasing PIC lain." },
  "projects.bulk-update": { category: "project-management", label: "Bulk update projects", description: "Perbarui project dari sheet Excel hasil export (dicocokkan lewat Project ID), tiap perubahan masuk change log. Tiap peran hanya mendapat bagiannya: Sales kolom komersial project yang ia tangani, SOA principal, solution, dan Sales PIC, Admin dan Superadmin semuanya." },
  "projects.post-update": { category: "project-management", label: "Post project updates", description: "Tambah update Current action dan Next action pada project." },

  "requests.view": { category: "request-workflow", label: "View requests", description: "Lihat daftar request, halaman request, dan riwayatnya." },
  "requests.create": { category: "request-workflow", label: "Raise requests", description: "Ajukan request BOQ, RFQ, atau PO untuk sebuah project." },
  "requests.create.external": { category: "request-workflow", label: "Raise requests for external projects", description: "Ajukan request pada project dengan source Other." },
  "requests.create.rfq": { category: "request-workflow", label: "Raise RFQ requests", description: "Ajukan request RFQ (hanya RFQ) untuk project yang ada, misalnya oleh Purchasing atas nama Sales PIC dan SOA PIC project." },
  "requests.delete": { category: "request-workflow", label: "Delete requests", description: "Hapus request BOQ, RFQ, atau PO (disembunyikan dari semua daftar, riwayatnya tetap di audit log)." },
  "requests.edit-dates": { category: "request-workflow", label: "Correct request dates", description: "Atur tanggal request dibuat dan selesai secara manual, untuk tiket yang terlambat diinput atau salah catat. Tiap perubahan masuk audit log." },
  "requests.override-status": { category: "request-workflow", label: "Move a request to any status", description: "Pindahkan request ke status mana pun di luar alur biasa, misalnya Completed menjadi Cancelled atau Cancelled dibuka lagi. Alasan wajib dan tercatat di riwayat status dan audit log (hanya Superadmin)." },
  "requests.revise": { category: "request-workflow", label: "Request a revision", description: "Kembalikan BOQ yang selesai ke SOA untuk perubahan dari customer: request langsung masuk tahap Revision dan SOA diberi tahu (Sales pada project miliknya)." },
  "requests.email": { category: "request-workflow", label: "Request email text", description: "Salin teks email request untuk dikirim ke tim." },
  "requests.work.boq": { category: "request-workflow", label: "Work BOQ requests", description: "Ubah status request BOQ dan serahkan ke PIC (SOA)." },
  "requests.work.purchasing": { category: "request-workflow", label: "Work RFQ & PO requests", description: "Ubah status request RFQ dan PO dan serahkan ke PIC (Purchasing)." },
  "requests.handover": { category: "request-workflow", label: "Continue the request flow", description: "Putuskan langkah setelah BOQ atau RFQ selesai (BOQ ke Purchasing sebagai RFQ, RFQ ke PO) di project mana pun, bukan hanya miliknya." },
  "handoffs.view": { category: "request-workflow", label: "View Purchasing handoffs", description: "Buka halaman Purchasing handoff." },

  "masterdata.manage": { category: "master-data", label: "Manage master data", description: "Kelola principal, solution category, dan customer, lalu pakai untuk mengklasifikasikan project." },
  "sections.manage": { category: "master-data", label: "Manage technical sections and SOA phases", description: "Tambah bagian di tab Technical project dan phase yang bisa dipilih SOA; ganti nama atau nonaktifkan." },
  "pics.manage": { category: "master-data", label: "Manage PICs", description: "Tambah, ganti nama, dan nonaktifkan PIC tujuan tiket SOA dan Purchasing." },
  "customers.view": { category: "master-data", label: "View customers", description: "Buka halaman Customers." },
  "customers.rename": { category: "master-data", label: "Rename and merge customers", description: "Perbaiki nama customer yang salah ketik, atau gabungkan dua nama perusahaan yang sama (PNP dan Politeknik Negeri Padang)." },
  "industries.manage": { category: "master-data", label: "Edit the list of industries", description: "Tambah, ganti nama, dan hapus industri yang bisa diberikan ke customer (bawaan: Admin dan Superadmin)." },
  "customers.edit": { category: "master-data", label: "Edit customer details", description: "Isi industri customer di halaman Customers; chart, filter, dan export memakainya untuk semua project customer itu." },

  "targets.edit": { category: "sales-pipeline", label: "Sales targets", description: "Buka halaman Sales targets dan atur target gross profit sendiri." },

  "finance.crosscheck.view": { category: "finance", label: "Financial crosscheck", description: "Buka halaman Financial crosscheck dan unduh CSV-nya." },

  "reports.technical.view": { category: "reports", label: "Technical reports", description: "Buka halaman Technical reports dan unduh export-nya." },

  "audit.view": { category: "audit-system", label: "View audit log", description: "Buka halaman Audit logs dan lihat aktivitas administrasi terbaru." },
  "system.monitor": { category: "audit-system", label: "System health", description: "Buka halaman System (kondisi database dan runtime)." },
  "system.backup": { category: "audit-system", label: "Backups", description: "Buat dan lihat daftar backup database." },
  "theme.switch": { category: "audit-system", label: "Theme switcher", description: "Tampilkan pengganti tema di header (hanya preferensi tampilan)." },
  "settings.view": { category: "audit-system", label: "View SLA policies", description: "Buka halaman Email dan SLA." },
  "settings.manage": { category: "audit-system", label: "Manage SLA policies", description: "Ubah rentang SLA dan template email SOA dan Purchasing." },
};

export type CatalogPermission = { permission: Permission; label: string; description: string };

/** Every permission under its category, in the order of ALL_PERMISSIONS. Categories are never empty. */
export function permissionsByCategory(): { id: PermissionCategoryId; title: string; description: string; permissions: CatalogPermission[] }[] {
  return PERMISSION_CATEGORIES.map((category) => ({
    ...category,
    permissions: ALL_PERMISSIONS.filter((permission) => PERMISSION_CATALOG[permission].category === category.id).map((permission) => ({
      permission,
      label: PERMISSION_CATALOG[permission].label,
      description: PERMISSION_CATALOG[permission].description,
    })),
  }));
}

/** The roles shown as columns, in their usual order. */
export const EDITOR_ROLES = ROLES;

/** How the editor form names one role/permission cell ("SALES|projects.view"); neither part contains the separator. */
const CELL_SEPARATOR = "|";

export function cellKey(role: string, permission: string): string {
  return `${role}${CELL_SEPARATOR}${permission}`;
}

export function parseCellKey(cell: string): { role: string; permission: string } {
  const [role = "", permission = ""] = cell.split(CELL_SEPARATOR);
  return { role, permission };
}
