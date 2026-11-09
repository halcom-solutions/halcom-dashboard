import { isRole, type Role } from "@/domain/access/roles";

/**
 * Everything about calculations and quotations that the business may change without a new release (D-088), kept as one document that
 * a Superadmin or Admin edits on the settings page: the item categories, the tax schemes (WAPU, Non-WAPU or any other), the approval
 * steps and when each is needed, and what the quotation shows. A quotation copies the parts it is computed and approved with when it is
 * submitted, so a later change never moves an approved figure or re-routes an approval already under way.
 *
 * Rates are basis points (1 % = 100); amounts are cents written as text (they can exceed what a JSON number holds exactly).
 */

export type CategoryConfig = {
  key: string;
  label: string;
  /** The Jurnal product a line of this category is booked to (Jurnal needs an existing product). */
  jurnalProduct: string;
  /** Words that put an item from a BOQ into this category ("jasa", "instalasi"...), compared without case. */
  keywords: string[];
};

export type WithholdingConfig = { key: string; label: string; rateBp: number; categories: string[] };

export type TaxSchemeConfig = {
  key: string;
  label: string;
  description: string;
  ppnRateBp: number;
  dppNumerator: number;
  dppDenominator: number;
  /** Income tax the customer withholds, a project cost: a rate on the revenue of the listed categories. */
  withholdings: WithholdingConfig[];
};

export type ApproverConfig = { kind: "ROLE"; role: Role } | { kind: "USERS"; userIds: string[] };

export type StepCondition = { kind: "ALWAYS" } | { kind: "GM_BELOW"; thresholdBp: number } | { kind: "REVENUE_AT_LEAST"; amountCents: string };

export type ApprovalStepConfig = {
  key: string;
  /** The box on the approval form when the step must approve: "Diperiksa (Purchasing)", "Disetujui (Direktur)". */
  label: string;
  /** The box when the step need not approve but is told: "Diketahui (Direktur)". */
  acknowledgeLabel: string;
  approver: ApproverConfig;
  condition: StepCondition;
  /** When the condition is not met: the approver is still told and may note it ("Diketahui"), or the step is left out. */
  whenNotRequired: "ACKNOWLEDGE" | "SKIP";
  /** The approver may correct buy prices, vendors and vendor terms while it is their turn (Purchasing). */
  mayEditCosts: boolean;
};

export type DocumentConfig = {
  title: string;
  companyName: string;
  companyAddress: string;
  companyContact: string;
  companyTaxId: string;
  /** The text under the lines: validity, delivery, warranty, bank account... */
  notes: string;
  signatoryTitle: string;
  validityDays: number;
  showSpecification: boolean;
  showGroups: boolean;
  showUnitPrice: boolean;
  showCategory: boolean;
  showTerms: boolean;
  showSignature: boolean;
};

export type QuotationConfig = {
  categories: CategoryConfig[];
  taxSchemes: TaxSchemeConfig[];
  defaultTaxScheme: string;
  steps: ApprovalStepConfig[];
  document: DocumentConfig;
};

/** The two workbooks of November 2026, as configuration: PPN 12 % on 11/12, PPh 22 1.5 % on goods for WAPU, PPh 23 2 % on services. */
export const DEFAULT_QUOTATION_CONFIG: QuotationConfig = {
  categories: [
    { key: "GOODS", label: "Barang", jurnalProduct: "Barang", keywords: [] },
    {
      key: "SERVICES",
      label: "Jasa",
      jurnalProduct: "Jasa",
      keywords: ["jasa", "service", "instalasi", "installation", "konfigurasi", "commissioning", "support", "maintenance", "training", "supervision"],
    },
  ],
  taxSchemes: [
    {
      key: "NON_WAPU",
      label: "Non-WAPU",
      description: "Customer swasta: hanya PPh 23 atas jasa yang dipotong customer.",
      ppnRateBp: 1200,
      dppNumerator: 11,
      dppDenominator: 12,
      withholdings: [{ key: "PPH23", label: "PPh 23 dipotong customer", rateBp: 200, categories: ["SERVICES"] }],
    },
    {
      key: "WAPU",
      label: "WAPU",
      description: "Pemerintah / BUMN: PPh 22 atas barang dipungut bendahara, PPh 23 atas jasa dipotong.",
      ppnRateBp: 1200,
      dppNumerator: 11,
      dppDenominator: 12,
      withholdings: [
        { key: "PPH22", label: "PPh 22 dipungut customer (WAPU)", rateBp: 150, categories: ["GOODS"] },
        { key: "PPH23", label: "PPh 23 dipotong customer", rateBp: 200, categories: ["SERVICES"] },
      ],
    },
  ],
  defaultTaxScheme: "NON_WAPU",
  steps: [
    {
      key: "PURCHASING",
      label: "Diperiksa (Purchasing)",
      acknowledgeLabel: "Diketahui (Purchasing)",
      approver: { kind: "ROLE", role: "PURCHASING" },
      condition: { kind: "ALWAYS" },
      whenNotRequired: "SKIP",
      mayEditCosts: true,
    },
    {
      key: "DIRECTOR",
      label: "Disetujui (Direktur)",
      acknowledgeLabel: "Diketahui (Direktur)",
      approver: { kind: "USERS", userIds: [] },
      condition: { kind: "GM_BELOW", thresholdBp: 1500 },
      whenNotRequired: "ACKNOWLEDGE",
      mayEditCosts: false,
    },
  ],
  document: {
    title: "QUOTATION",
    companyName: "PT Halcom Inovasi Teknologi",
    companyAddress: "",
    companyContact: "",
    companyTaxId: "",
    notes: "Harga belum termasuk PPN kecuali disebutkan.\nHarga dapat berubah mengikuti kurs dan ketersediaan stok.",
    signatoryTitle: "Sales",
    validityDays: 30,
    showSpecification: true,
    showGroups: true,
    showUnitPrice: true,
    showCategory: false,
    showTerms: true,
    showSignature: true,
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading and checking
// ---------------------------------------------------------------------------------------------------------------------------------

export type ConfigCheck = { ok: true; value: QuotationConfig } | { ok: false; message: string };

const KEY = /^[A-Z][A-Z0-9_]{0,29}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, max) : "");
const bp = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : null);
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

/**
 * Checks a configuration as it comes from the settings form or the database. Every reference must resolve: a withholding names
 * existing categories, the default scheme exists, an approver role exists. Returns the first problem in words a person can act on.
 */
export function checkQuotationConfig(input: unknown): ConfigCheck {
  const raw = (input ?? {}) as Record<string, unknown>;
  const fail = (message: string): ConfigCheck => ({ ok: false, message });

  const categories: CategoryConfig[] = [];
  for (const [index, item] of (Array.isArray(raw["categories"]) ? raw["categories"] : []).entries()) {
    const row = (item ?? {}) as Record<string, unknown>;
    const key = str(row["key"], 30).toUpperCase();
    const label = str(row["label"], 60);
    if (!KEY.test(key)) return fail(`Kategori ${index + 1}: kode harus huruf besar/angka/garis bawah, diawali huruf (misalnya GOODS).`);
    if (!label) return fail(`Kategori ${key}: tulis namanya.`);
    if (categories.some((other) => other.key === key)) return fail(`Kode kategori ${key} dipakai dua kali.`);
    const keywords = (Array.isArray(row["keywords"]) ? row["keywords"] : []).map((word) => str(word, 40).toLowerCase()).filter(Boolean).slice(0, 40);
    categories.push({ key, label, jurnalProduct: str(row["jurnalProduct"], 100) || label, keywords });
  }
  if (categories.length === 0) return fail("Tambahkan paling sedikit satu kategori item.");
  const categoryKeys = new Set(categories.map((category) => category.key));

  const taxSchemes: TaxSchemeConfig[] = [];
  for (const [index, item] of (Array.isArray(raw["taxSchemes"]) ? raw["taxSchemes"] : []).entries()) {
    const row = (item ?? {}) as Record<string, unknown>;
    const key = str(row["key"], 30).toUpperCase();
    const label = str(row["label"], 60);
    if (!KEY.test(key)) return fail(`Skema pajak ${index + 1}: kode harus huruf besar/angka/garis bawah, diawali huruf (misalnya WAPU).`);
    if (!label) return fail(`Skema pajak ${key}: tulis namanya.`);
    if (taxSchemes.some((other) => other.key === key)) return fail(`Kode skema pajak ${key} dipakai dua kali.`);
    const ppnRateBp = bp(row["ppnRateBp"]);
    if (ppnRateBp === null) return fail(`Skema ${label}: tarif PPN harus 0 sampai 100%.`);
    const numerator = row["dppNumerator"];
    const denominator = row["dppDenominator"];
    if (!(typeof numerator === "number" && typeof denominator === "number" && Number.isInteger(numerator) && Number.isInteger(denominator) && numerator >= 1 && denominator >= numerator && denominator <= 100)) {
      return fail(`Skema ${label}: faktor DPP harus pecahan bilangan bulat tidak lebih dari 1, misalnya 11/12.`);
    }
    const withholdings: WithholdingConfig[] = [];
    for (const [w, entry] of (Array.isArray(row["withholdings"]) ? row["withholdings"] : []).entries()) {
      const withholding = (entry ?? {}) as Record<string, unknown>;
      const wKey = str(withholding["key"], 30).toUpperCase() || `W${w + 1}`;
      const wLabel = str(withholding["label"], 80);
      const rate = bp(withholding["rateBp"]);
      const cats = (Array.isArray(withholding["categories"]) ? withholding["categories"] : []).map((value) => str(value, 30).toUpperCase());
      if (!wLabel) return fail(`Skema ${label}: potongan ${w + 1} belum punya nama.`);
      if (rate === null) return fail(`Skema ${label}, ${wLabel}: tarif harus 0 sampai 100%.`);
      if (cats.length === 0 || cats.some((cat) => !categoryKeys.has(cat))) return fail(`Skema ${label}, ${wLabel}: pilih kategori yang ada.`);
      withholdings.push({ key: wKey, label: wLabel, rateBp: rate, categories: [...new Set(cats)] });
    }
    taxSchemes.push({ key, label, description: str(row["description"], 300), ppnRateBp, dppNumerator: numerator, dppDenominator: denominator, withholdings });
  }
  if (taxSchemes.length === 0) return fail("Tambahkan paling sedikit satu skema pajak.");
  const defaultTaxScheme = str(raw["defaultTaxScheme"], 30).toUpperCase();
  if (!taxSchemes.some((scheme) => scheme.key === defaultTaxScheme)) return fail("Pilih skema pajak bawaan dari daftar.");

  const steps: ApprovalStepConfig[] = [];
  for (const [index, item] of (Array.isArray(raw["steps"]) ? raw["steps"] : []).entries()) {
    const row = (item ?? {}) as Record<string, unknown>;
    const key = str(row["key"], 30).toUpperCase();
    const label = str(row["label"], 80);
    if (!KEY.test(key)) return fail(`Langkah ${index + 1}: kode harus huruf besar/angka/garis bawah, diawali huruf (misalnya DIRECTOR).`);
    if (!label) return fail(`Langkah ${key}: tulis label persetujuannya.`);
    if (steps.some((other) => other.key === key)) return fail(`Kode langkah ${key} dipakai dua kali.`);
    const approverRaw = (row["approver"] ?? {}) as Record<string, unknown>;
    let approver: ApproverConfig;
    if (approverRaw["kind"] === "ROLE") {
      if (!isRole(approverRaw["role"])) return fail(`Langkah ${label}: pilih peran penyetuju.`);
      approver = { kind: "ROLE", role: approverRaw["role"] };
    } else if (approverRaw["kind"] === "USERS") {
      const userIds = [...new Set((Array.isArray(approverRaw["userIds"]) ? approverRaw["userIds"] : []).filter((id): id is string => typeof id === "string" && UUID.test(id)))].slice(0, 10);
      approver = { kind: "USERS", userIds };
    } else return fail(`Langkah ${label}: pilih penyetuju (peran atau orang).`);
    const conditionRaw = (row["condition"] ?? {}) as Record<string, unknown>;
    let condition: StepCondition;
    if (conditionRaw["kind"] === "ALWAYS") condition = { kind: "ALWAYS" };
    else if (conditionRaw["kind"] === "GM_BELOW") {
      const threshold = bp(conditionRaw["thresholdBp"]);
      if (threshold === null) return fail(`Langkah ${label}: batas GM harus 0 sampai 100%.`);
      condition = { kind: "GM_BELOW", thresholdBp: threshold };
    } else if (conditionRaw["kind"] === "REVENUE_AT_LEAST") {
      const amount = typeof conditionRaw["amountCents"] === "string" && /^\d{1,17}$/.test(conditionRaw["amountCents"]) ? conditionRaw["amountCents"] : null;
      if (amount === null) return fail(`Langkah ${label}: nilai revenue minimal tidak valid.`);
      condition = { kind: "REVENUE_AT_LEAST", amountCents: amount };
    } else return fail(`Langkah ${label}: pilih kapan langkah ini diperlukan.`);
    steps.push({
      key,
      label,
      acknowledgeLabel: str(row["acknowledgeLabel"], 80) || label,
      approver,
      condition,
      whenNotRequired: row["whenNotRequired"] === "ACKNOWLEDGE" ? "ACKNOWLEDGE" : "SKIP",
      mayEditCosts: bool(row["mayEditCosts"], false),
    });
  }
  if (steps.length === 0) return fail("Tambahkan paling sedikit satu langkah persetujuan.");
  if (!steps.some((step) => step.condition.kind === "ALWAYS")) return fail("Paling sedikit satu langkah harus selalu diperlukan, supaya tidak ada quotation yang lolos tanpa pemeriksaan.");

  const d = (raw["document"] ?? {}) as Record<string, unknown>;
  const fallback = DEFAULT_QUOTATION_CONFIG.document;
  const validity = d["validityDays"];
  const document: DocumentConfig = {
    title: str(d["title"], 60) || fallback.title,
    companyName: str(d["companyName"], 120) || fallback.companyName,
    companyAddress: str(d["companyAddress"], 400),
    companyContact: str(d["companyContact"], 200),
    companyTaxId: str(d["companyTaxId"], 60),
    notes: str(d["notes"], 3000),
    signatoryTitle: str(d["signatoryTitle"], 60) || fallback.signatoryTitle,
    validityDays: typeof validity === "number" && Number.isInteger(validity) && validity >= 1 && validity <= 365 ? validity : fallback.validityDays,
    showSpecification: bool(d["showSpecification"], fallback.showSpecification),
    showGroups: bool(d["showGroups"], fallback.showGroups),
    showUnitPrice: bool(d["showUnitPrice"], fallback.showUnitPrice),
    showCategory: bool(d["showCategory"], fallback.showCategory),
    showTerms: bool(d["showTerms"], fallback.showTerms),
    showSignature: bool(d["showSignature"], fallback.showSignature),
  };

  return { ok: true, value: { categories, taxSchemes, defaultTaxScheme, steps, document } };
}

/** A stored configuration read back; anything unreadable falls back to the defaults, so a bad row cannot stop every quotation. */
export function readQuotationConfig(value: unknown): QuotationConfig {
  if (value === null || value === undefined) return DEFAULT_QUOTATION_CONFIG;
  const checked = checkQuotationConfig(value);
  return checked.ok ? checked.value : DEFAULT_QUOTATION_CONFIG;
}

export function taxSchemeOf(config: Pick<QuotationConfig, "taxSchemes" | "defaultTaxScheme">, key: string): TaxSchemeConfig {
  return config.taxSchemes.find((scheme) => scheme.key === key) ?? config.taxSchemes.find((scheme) => scheme.key === config.defaultTaxScheme) ?? config.taxSchemes[0]!;
}

export function categoryLabel(categories: readonly CategoryConfig[], key: string): string {
  return categories.find((category) => category.key === key)?.label ?? key;
}

/** The category an item from a BOQ belongs to: the first whose keywords appear in its category or name, else the first category. */
export function guessCategory(categories: readonly CategoryConfig[], ...texts: (string | null | undefined)[]): string {
  const haystack = texts.filter(Boolean).join(" ").toLowerCase();
  const byLabel = categories.find((category) => haystack.split(/[^a-z0-9]+/).includes(category.label.toLowerCase()));
  if (byLabel) return byLabel.key;
  const byKeyword = categories.find((category) => category.keywords.some((word) => haystack.includes(word)));
  return (byKeyword ?? categories[0]!).key;
}

/** What the settings page and the approval form say about a condition. */
export function conditionLabel(condition: StepCondition, formatAmount: (cents: string) => string = (cents) => cents): string {
  if (condition.kind === "ALWAYS") return "Selalu";
  if (condition.kind === "GM_BELOW") return `Jika GM < ${condition.thresholdBp / 100}%`;
  return `Jika revenue ≥ ${formatAmount(condition.amountCents)}`;
}

/** The effective PPN of a scheme, as the Parameter sheet explained it: "12% × 11/12 = 11%". */
export function ppnExplanation(scheme: Pick<TaxSchemeConfig, "ppnRateBp" | "dppNumerator" | "dppDenominator">): string {
  const effective = (scheme.ppnRateBp * scheme.dppNumerator) / scheme.dppDenominator / 100;
  const round = (value: number) => Math.round(value * 100) / 100;
  return `${round(scheme.ppnRateBp / 100)}% × ${scheme.dppNumerator}/${scheme.dppDenominator} = ${round(effective)}%`;
}
