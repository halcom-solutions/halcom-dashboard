"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { redirect } from "next/navigation";
import { homePathFor } from "@/domain/access/dashboards";
import { requirePermission } from "@/server/auth/current-user";
import { readSessionToken, setSessionCookie } from "@/server/auth/session-cookie";
import { revokeSession } from "@/server/auth/session-store";
import { startImpersonation } from "@/server/users/impersonation";
import { USERS_PATH } from "@/features/navigation/links";
import {
  changeUserEmail,
  changeUserRole,
  createUser,
  resetUserPassword,
  setUserActive,
  setUserAlsoManagement,
  type UserResult,
} from "@/server/users/service";

export type ActionState = { ok: boolean; message: string } | null;

function toState(result: UserResult<unknown>, successMessage: string): ActionState {
  if (result.ok) {
    revalidatePath(USERS_PATH);
    return { ok: true, message: successMessage };
  }
  return { ok: false, message: result.message };
}

// Each action re-checks the permission on the server; the service then checks the
// target-specific rules inside its transaction.
async function actor() {
  const user = await requirePermission("users.manage");
  return { id: user.id, role: user.role };
}

export async function createUserAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result = await createUser(getDb(), await actor(), {
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    password: formData.get("password"),
  });
  return toState(result, "User created.");
}

export async function changeRoleAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result = await changeUserRole(getDb(), await actor(), String(formData.get("userId")), formData.get("role"));
  return toState(result, "Role updated.");
}

/** Superadmin only: opens the application as another account, read only. The superadmin own session is closed; leaving the mode opens a new one. */
export async function startImpersonationAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("users.impersonate");
  const result = await startImpersonation(getDb(), { id: user.id, role: user.role }, String(formData.get("userId")));
  if (!result.ok) return { ok: false, message: result.message };
  const previous = await readSessionToken();
  if (previous) await revokeSession(getDb(), previous);
  await setSessionCookie(result.value.token, result.value.expiresAt);
  revalidatePath("/", "layout");
  redirect(homePathFor(result.value.role));
}

/** Superadmin only: its own permission decides. */
export async function setAlsoManagementAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("users.manage-privileged");
  const enabled = formData.get("enabled") === "true";
  const result = await setUserAlsoManagement(getDb(), { id: user.id, role: user.role }, String(formData.get("userId")), enabled);
  return toState(result, enabled ? "Tampilan Management diaktifkan." : "Tampilan Management dimatikan.");
}

export async function setActiveAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const activate = formData.get("active") === "true";
  const result = await setUserActive(getDb(), await actor(), String(formData.get("userId")), activate);
  return toState(result, activate ? "User reactivated." : "User deactivated.");
}

export async function resetPasswordAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result = await resetUserPassword(getDb(), await actor(), String(formData.get("userId")), {
    password: formData.get("password"),
  });
  return toState(result, "Kata sandi direset. Pengguna keluar dari semua sesi.");
}

/** Superadmin only: its own permission, not users.manage, decides. */
export async function changeEmailAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("users.change-email");
  const result = await changeUserEmail(getDb(), { id: user.id, role: user.role }, String(formData.get("userId")), { email: formData.get("email") });
  return toState(result, "Email diubah.");
}
