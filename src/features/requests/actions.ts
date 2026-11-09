"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/ui/form-status";
import { marginFields } from "@/domain/projects/margin";
import { PROJECTS_PATH, REQUESTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { assignRequestDistributor } from "@/server/distributors/service";
import { assignRequestPic } from "@/server/pics/service";
import { deleteRequest } from "@/server/requests/delete";
import { changeRequestStatus, createProject, createRequest, handOverToPurchasing, requestRevision, setRequestDates, setProjectPhase, stopFlow } from "@/server/requests/service";

// Each action checks the sign-in (and, where one permission fits, that permission) on the server;
// the service then re-checks the actor and the record-specific rules inside its transaction.

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

export async function createProjectAction(_previous: FormState, formData: FormData): Promise<FormState> {
  // Who may register a project depends on its source, so the service decides; it re-checks the stored role.
  const user = await requireUser();
  const requestType = text(formData, "requestType");
  const result = await createProject(getDb(), { id: user.id, role: user.role }, {
    endUserCompany: text(formData, "endUserCompany"),
    name: text(formData, "name"),
    description: text(formData, "description"),
    targetDate: text(formData, "targetDate"),
    sourceType: text(formData, "sourceType"),
    externalSourceName: text(formData, "externalSourceName"),
    externalContact: text(formData, "externalContact"),
    externalReference: text(formData, "externalReference"),
    sourceNotes: text(formData, "sourceNotes"),
    salesOwnerId: text(formData, "salesOwnerId"),
    progress: text(formData, "progress"),
    trackStatus: text(formData, "trackStatus"),
    ...marginFields(formData.get("marginMode"), formData.get("marginInput")),
    // "" means no request; otherwise the project is created together with its first BOQ, RFQ or PO.
    request: requestType
      ? {
          type: requestType,
          description: text(formData, "requestDescription"),
          requiredBy: text(formData, "requestRequiredBy"),
        }
      : null,
    submissionKey: text(formData, "submissionKey"),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(PROJECTS_PATH);
  if (result.value.requestCode) {
    revalidatePath(REQUESTS_PATH);
    redirect(`/request/${result.value.requestCode}`);
  }
  redirect(`${PROJECTS_PATH}/${result.value.code}`);
}

export async function createRequestAction(_previous: FormState, formData: FormData): Promise<FormState> {
  // BOQ for a project from another source is raised by SOA, everything else by Sales: the service decides per project.
  const user = await requireUser();
  const result = await createRequest(getDb(), { id: user.id, role: user.role }, {
    projectId: text(formData, "projectId"),
    type: text(formData, "type"),
    title: text(formData, "title"),
    description: text(formData, "description"),
    requiredBy: text(formData, "requiredBy"),
    submissionKey: text(formData, "submissionKey"),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(REQUESTS_PATH);
  redirect(`/request/${result.value.code}`);
}

/**
 * Moves a request to another column of the board (the only place SOA and Purchasing change a status). The service re-checks who may
 * move this type of request, that the move is allowed from where the request is, and that a reason came with a cancellation or reopening.
 */
export async function moveRequestAction(requestId: string, to: string, reason?: string, picId?: string): Promise<NonNullable<FormState>> {
  const user = await requireUser();
  const actor = { id: user.id, role: user.role };
  // Starting an RFQ or PO on the board names the PIC first (the board asks for it); the service re-checks who may assign and that the PIC belongs to the team.
  if (picId) {
    const assigned = await assignRequestPic(getDb(), actor, { requestId, picId });
    if (!assigned.ok) return { ok: false, message: assigned.message };
  }
  const result = await changeRequestStatus(getDb(), actor, { requestId, to, reason: reason ?? null });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`/request/${result.value.code}`);
  revalidatePath(REQUESTS_PATH);
  return { ok: true, message: `${result.value.code} moved.` };
}

export async function handOverAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const actor = { id: user.id, role: user.role };
  if (text(formData, "decision") === "stop") {
    const stopped = await stopFlow(getDb(), actor, { sourceId: text(formData, "sourceId"), note: text(formData, "note") });
    if (!stopped.ok) return { ok: false, message: stopped.message };
    revalidatePath(`/request/${stopped.value.code}`);
    revalidatePath(REQUESTS_PATH);
    return { ok: true, message: "Tersimpan: request ini tidak dilanjutkan. Anda masih bisa melanjutkannya nanti." };
  }
  const result = await handOverToPurchasing(getDb(), actor, {
    sourceId: text(formData, "sourceId"),
    targetType: text(formData, "targetType"),
    note: text(formData, "note"),
    requiredBy: text(formData, "requiredBy"),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(REQUESTS_PATH);
  // `email=1` opens the email draft of the new request ([HITRFQ] / [HITPO]) as soon as the page loads.
  redirect(`/request/${result.value.code}?email=1`);
}

/**
 * SOA or Purchasing hands a request to one of their PICs (or takes it back with an empty choice). On an RFQ the same form also names the
 * distributor (a `distributorId` field is sent, empty to clear); the PIC is saved first and each part is re-checked by its own service.
 */
export async function assignPicAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const actor = { id: user.id, role: user.role };
  const requestId = text(formData, "requestId");
  const result = await assignRequestPic(getDb(), actor, { requestId, picId: text(formData, "picId") ?? "" });
  if (!result.ok) return { ok: false, message: result.message };
  let message = result.value.picId ? "PIC saved." : "PIC cleared.";
  if (formData.has("distributorId")) {
    const distributor = await assignRequestDistributor(getDb(), actor, { requestId, distributorId: text(formData, "distributorId") ?? "" });
    if (!distributor.ok) return { ok: false, message: `PIC tersimpan, tetapi distributor gagal: ${distributor.message}` };
    message = distributor.value.distributorId ? "PIC dan distributor tersimpan." : "PIC tersimpan, distributor dikosongkan.";
  }
  revalidatePath(`/request/${result.value.code}`);
  revalidatePath(REQUESTS_PATH);
  return { ok: true, message };
}

/** SOA labels a project with the phase of the work (or clears the label). */
export async function setPhaseAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await setProjectPhase(getDb(), { id: user.id, role: user.role }, { projectId: text(formData, "projectId"), phase: text(formData, "phase") ?? "" });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`/projects/${result.value.code}`);
  revalidatePath(PROJECTS_PATH);
  return { ok: true, message: "Phase tersimpan." };
}

/** Sales send a completed BOQ back to SOA for a revision. The service checks who may, that the BOQ is completed, and that a reason came. */
export async function setRequestDatesAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await setRequestDates(getDb(), { id: user.id, role: user.role }, {
    requestId: text(formData, "requestId"),
    createdAt: text(formData, "createdAt"),
    completedAt: text(formData, "completedAt"),
    requesterId: text(formData, "requesterId"),
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`/request/${result.value.code}`);
  revalidatePath(REQUESTS_PATH);
  revalidatePath(PROJECTS_PATH);
  // The code changed with the requester: the old address is gone, so the person is taken to the new one.
  if (result.value.code !== text(formData, "code")) redirect(`/request/${result.value.code}`);
  return { ok: true, message: `Tanggal ${result.value.code} tersimpan.` };
}

export async function requestRevisionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await requestRevision(getDb(), { id: user.id, role: user.role }, { requestId: text(formData, "requestId"), reason: text(formData, "reason") });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(`/request/${result.value.code}`);
  revalidatePath(REQUESTS_PATH);
  revalidatePath("/notifications");
  return { ok: true, message: `${result.value.code} is now in Revision. SOA has been told.` };
}

/** A superadmin deletes a request (hidden, history kept). The service re-checks the permission and the typed code, then the project page opens. */
export async function deleteRequestAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await deleteRequest(getDb(), { id: user.id, role: user.role }, { requestId: text(formData, "requestId"), confirmCode: text(formData, "confirmCode") ?? "" });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(REQUESTS_PATH);
  revalidatePath(PROJECTS_PATH);
  revalidatePath("/dashboard", "layout");
  redirect(`${PROJECTS_PATH}/${result.projectCode}#requests`);
}
