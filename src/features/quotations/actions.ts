"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/ui/form-status";
import { QUOTATIONS_PATH, QUOTATION_SETTINGS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { XLSX_LIMITS } from "@/server/import/xlsx-reader";
import { importRequestItems, readCalculationSheet, saveRequestItems, type ImportedLine } from "@/server/quotations/boq-items";
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
  type QuotationResult,
} from "@/server/quotations/service";
import { saveQuotationConfig, setNextQuotationSequence } from "@/server/quotations/settings";

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

async function actor() {
  const user = await requireUser();
  return { id: user.id, role: user.role };
}

function refresh(number: string, projectCode?: string) {
  revalidatePath(`${QUOTATIONS_PATH}/${number}`);
  revalidatePath(QUOTATIONS_PATH);
  if (projectCode) revalidatePath(`/projects/${projectCode}`);
}

function stateOf<T extends { number: string }>(result: QuotationResult<T>, message: string): FormState {
  if (!result.ok) return { ok: false, message: result.message };
  refresh(result.value.number, undefined);
  return { ok: true, message };
}

/** Starts a calculation for a project and opens it. */
export async function createQuotationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const result = await createQuotation(getDb(), await actor(), { projectId: text(formData, "projectId"), rfqRequestId: text(formData, "rfqRequestId") });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`/projects/${text(formData, "projectCode")}`);
  redirect(`${QUOTATIONS_PATH}/${result.value.number}`);
}

export async function duplicateQuotationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const result = await duplicateQuotation(getDb(), await actor(), { quotationId: text(formData, "quotationId") });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(QUOTATIONS_PATH);
  redirect(`${QUOTATIONS_PATH}/${result.value.number}`);
}

/** The whole calculation, sent as JSON in one field (the rows are added and removed on the page). */
export async function saveCalculationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  let payload: unknown;
  try {
    payload = JSON.parse(text(formData, "payload"));
  } catch {
    return { ok: false, message: "Data calculation tidak terbaca. Muat ulang halaman lalu coba lagi." };
  }
  const result = await saveCalculation(getDb(), await actor(), payload);
  if (!result.ok) return { ok: false, message: result.message };
  refresh(result.value.number);
  return { ok: true, message: result.value.issues.length ? `Tersimpan. Belum bisa diajukan: ${result.value.issues[0]}` : "Calculation tersimpan dan siap diajukan." };
}

export async function reviseCostsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  let payload: unknown;
  try {
    payload = JSON.parse(text(formData, "payload"));
  } catch {
    return { ok: false, message: "Data COGS tidak terbaca. Muat ulang halaman lalu coba lagi." };
  }
  const result = await reviseCosts(getDb(), await actor(), payload);
  if (!result.ok) return { ok: false, message: result.message };
  refresh(result.value.number);
  return { ok: true, message: result.value.changed ? `${result.value.changed} baris COGS diperbarui.` : "Tidak ada yang berubah." };
}

export async function saveHeaderAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const result = await saveHeader(getDb(), await actor(), {
    quotationId: text(formData, "quotationId"),
    customerName: text(formData, "customerName"),
    email: text(formData, "email"),
    billingAddress: text(formData, "billingAddress"),
    transactionDate: text(formData, "transactionDate"),
    expiryDate: text(formData, "expiryDate"),
    paymentTerm: text(formData, "paymentTerm"),
    customerReference: text(formData, "customerReference"),
    message: text(formData, "message"),
    memo: text(formData, "memo"),
  });
  return stateOf(result, "Quotation tersimpan.");
}

const id = (formData: FormData) => ({ quotationId: text(formData, "quotationId") });

export async function submitQuotationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const result = await submitQuotation(getDb(), await actor(), id(formData));
  if (!result.ok) return { ok: false, message: result.message };
  refresh(result.value.number);
  return { ok: true, message: `Diajukan. Persetujuan: ${result.value.steps.join(" → ")}.` };
}

export async function recallQuotationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return stateOf(await recallQuotation(getDb(), await actor(), id(formData)), "Ditarik kembali menjadi draft.");
}

export async function returnQuotationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return stateOf(await returnQuotation(getDb(), await actor(), { ...id(formData), reason: text(formData, "reason") }), "Dikembalikan ke Sales.");
}

export async function approveQuotationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const result = await approveQuotation(getDb(), await actor(), { ...id(formData), note: text(formData, "note"), picId: text(formData, "picId") });
  if (!result.ok) return { ok: false, message: result.message };
  refresh(result.value.number);
  return { ok: true, message: result.value.status === "APPROVED" ? "Disetujui. Quotation siap dikirim." : `Disetujui. Berikutnya: ${result.value.next}.` };
}

export async function acknowledgeQuotationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return stateOf(await acknowledgeQuotation(getDb(), await actor(), { ...id(formData), note: text(formData, "note"), picId: text(formData, "picId") }), "Ditandai diketahui.");
}

export async function reopenQuotationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return stateOf(await reopenQuotation(getDb(), await actor(), { ...id(formData), reason: text(formData, "reason") }), "Dibuka kembali sebagai draft. Ajukan lagi setelah diubah.");
}

export async function cancelQuotationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return stateOf(await cancelQuotation(getDb(), await actor(), { ...id(formData), reason: text(formData, "reason") }), "Quotation dibatalkan.");
}

export async function chooseQuotationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return stateOf(await chooseQuotation(getDb(), await actor(), id(formData)), "Ditandai sebagai opsi yang dipilih customer.");
}

export async function unchooseQuotationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return stateOf(await unchooseQuotation(getDb(), await actor(), id(formData)), "Pilihan customer dibatalkan.");
}


/** The whole configuration, sent as JSON in one field. */
export async function saveQuotationConfigAction(_previous: FormState, formData: FormData): Promise<FormState> {
  let payload: unknown;
  try {
    payload = JSON.parse(text(formData, "payload"));
  } catch {
    return { ok: false, message: "Data konfigurasi tidak terbaca. Muat ulang halaman lalu coba lagi." };
  }
  const result = await saveQuotationConfig(getDb(), await actor(), payload);
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(QUOTATION_SETTINGS_PATH);
  revalidatePath(QUOTATIONS_PATH);
  return { ok: true, message: result.changed ? "Konfigurasi tersimpan. Quotation yang sudah diajukan tetap memakai aturan saat diajukan." : "Tidak ada yang berubah." };
}

export async function setNextNumberAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const result = await setNextQuotationSequence(getDb(), await actor(), text(formData, "next"));
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(QUOTATION_SETTINGS_PATH);
  return { ok: true, message: result.changed ? "Nomor berikutnya tersimpan." : "Tidak ada yang berubah." };
}

type SheetFile = { ok: true; bytes: Uint8Array } | { ok: false; message: string };

async function sheetFile(formData: FormData): Promise<SheetFile> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Pilih berkas .xlsx." };
  if (file.size > XLSX_LIMITS.fileBytes) return { ok: false, message: `Berkas lebih besar dari ${XLSX_LIMITS.fileBytes / 1024 / 1024} MB.` };
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, message: "Hanya workbook .xlsx yang bisa dibaca. Simpan sheet sebagai Excel Workbook (.xlsx)." };
  return { ok: true, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** Reads a BOQ workbook into calculation lines for the form (nothing is saved until the calculation is saved). */
export async function readCalculationSheetAction(formData: FormData): Promise<{ ok: true; lines: ImportedLine[]; message: string } | { ok: false; message: string }> {
  const file = await sheetFile(formData);
  if (!file.ok) return file;
  const result = await readCalculationSheet(getDb(), await actor(), file.bytes);
  if (!result.ok) return result;
  const extra = [result.value.skipped ? `${result.value.skipped} baris dilewati` : "", ...result.value.warnings.slice(0, 3)].filter(Boolean).join(". ");
  return { ok: true, lines: result.value.lines, message: `${result.value.lines.length} baris dibaca dari sheet. Periksa lalu simpan.${extra ? ` ${extra}.` : ""}` };
}

/** SOA saves the items of a BOQ (sent as JSON in one field). */
export async function saveBoqItemsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  let items: unknown;
  try {
    items = JSON.parse(text(formData, "items"));
  } catch {
    return { ok: false, message: "Data item tidak terbaca. Muat ulang halaman lalu coba lagi." };
  }
  const result = await saveRequestItems(getDb(), await actor(), { requestId: text(formData, "requestId"), items });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`/request/${result.value.code}`);
  revalidatePath("/projects/[code]", "page");
  return { ok: true, message: `${result.value.count} item BOQ tersimpan.` };
}

/** SOA uploads the BOQ workbook; its items replace the BOQ's items. */
export async function importBoqItemsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const file = await sheetFile(formData);
  if (!file.ok) return file;
  const result = await importRequestItems(getDb(), await actor(), { requestId: text(formData, "requestId"), bytes: file.bytes });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`/request/${result.value.code}`);
  revalidatePath("/projects/[code]", "page");
  const extra = [result.value.skipped ? `${result.value.skipped} baris dilewati (Add = FALSE atau qty kosong)` : "", ...result.value.warnings.slice(0, 3)].filter(Boolean).join(". ");
  return { ok: true, message: `${result.value.count} item diimpor.${extra ? ` ${extra}.` : ""}` };
}
