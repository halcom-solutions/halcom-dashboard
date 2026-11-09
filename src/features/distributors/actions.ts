"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-status";
import { DISTRIBUTORS_PATH, REQUESTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { XLSX_LIMITS } from "@/server/import/xlsx-reader";
import { createDistributor, deleteDistributor, updateDistributor } from "@/server/distributors/service";
import { importDistributors, type DistributorImportResult } from "@/server/distributors/import";

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** Adds a distributor. */
export async function createDistributorAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await createDistributor(getDb(), { id: user.id, role: user.role }, {
    name: text(formData, "name"),
    alias: text(formData, "alias"),
    paymentType: text(formData, "paymentType"),
    topDays: text(formData, "topDays"),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(DISTRIBUTORS_PATH);
  return { ok: true, message: `${result.value.name} ditambahkan.` };
}

/** Saves the name, alias, payment terms and on/off state (the checkbox) of a distributor. */
export async function saveDistributorAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await updateDistributor(getDb(), { id: user.id, role: user.role }, {
    id: text(formData, "id"),
    name: text(formData, "name"),
    alias: text(formData, "alias"),
    paymentType: text(formData, "paymentType"),
    topDays: text(formData, "topDays"),
    isActive: text(formData, "active") === "true",
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(DISTRIBUTORS_PATH);
  revalidatePath(REQUESTS_PATH);
  return { ok: true, message: "Tersimpan." };
}

/** Deletes a distributor no RFQ names; the service refuses otherwise. */
export async function deleteDistributorAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await deleteDistributor(getDb(), { id: user.id, role: user.role }, { id: text(formData, "id") });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(DISTRIBUTORS_PATH);
  return { ok: true, message: `${result.value.name} dihapus.` };
}

/** Checks an uploaded sheet (`commit` unset) or saves it (`commit=true`). The file is read again on the server each time. */
export async function importDistributorsAction(formData: FormData): Promise<DistributorImportResult> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Pilih berkas .xlsx." };
  if (file.size > XLSX_LIMITS.fileBytes) return { ok: false, message: `Berkas lebih besar dari ${XLSX_LIMITS.fileBytes / 1024 / 1024} MB.` };
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, message: "Hanya workbook .xlsx yang bisa diimpor. Simpan sheet sebagai Excel Workbook (.xlsx)." };
  const result = await importDistributors(getDb(), { id: user.id, role: user.role }, { bytes: new Uint8Array(await file.arrayBuffer()), commit: formData.get("commit") === "true" });
  // Also after a save that stopped halfway: the rows before the failure are saved.
  if (result.ok && formData.get("commit") === "true") {
    revalidatePath(DISTRIBUTORS_PATH);
    revalidatePath(REQUESTS_PATH);
  }
  return result;
}
