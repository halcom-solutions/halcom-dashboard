"use client";

import { useActionState, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ALSO_MANAGEMENT_ROLES } from "@/domain/access/permissions";
import { isPrivilegedRole, ROLE_LABELS, type Role } from "@/domain/access/roles";
import { SaveText } from "@/components/ui/save-text";
import {
  changeEmailAction,
  changeRoleAction,
  createUserAction,
  resetPasswordAction,
  setActiveAction,
  setAlsoManagementAction,
  startImpersonationAction,
  type ActionState,
} from "./actions";

const SELECT_CLASS =
  "h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function Status({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
      {state.message}
    </p>
  );
}

function RoleOptions({ roles }: { roles: readonly Role[] }) {
  return roles.map((role) => (
    <option key={role} value={role}>
      {ROLE_LABELS[role]}
    </option>
  ));
}

export function CreateUserForm({ roles }: { roles: readonly Role[] }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createUserAction, null);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-name">Name</Label>
        <Input id="new-name" name="name" required maxLength={100} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-email">Email</Label>
        <Input id="new-email" name="email" type="email" required maxLength={254} autoComplete="off" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-role">Role</Label>
        <select id="new-role" name="role" required defaultValue="" className={SELECT_CLASS}>
          <option value="" disabled>
            Select a role
          </option>
          <RoleOptions roles={roles} />
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">Initial password</Label>
        <Input id="new-password" name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create user"}
      </Button>
      <div className="sm:col-span-2 lg:col-span-5">
        <Status state={state} />
      </div>
    </form>
  );
}

export function RoleForm({ userId, currentRole, roles, label }: { userId: string; currentRole: Role; roles: readonly Role[]; label: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(changeRoleAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex gap-2">
        <select name="role" defaultValue={currentRole} aria-label={`Role for ${label}`} className={SELECT_CLASS}>
          <RoleOptions roles={roles} />
        </select>
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
      </div>
      <Status state={state} />
    </form>
  );
}

/** Lets the person also see what Management sees (read only). Superadmin only; the page decides who gets the form. */
export function AlsoManagementForm({ userId, enabled, label }: { userId: string; enabled: boolean; label: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(setAlsoManagementAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <p className="text-sm text-muted-foreground">
        {enabled ? "Aktif: menu dan dashboard Management (hanya lihat) ada di samping peran ini." : "Mati. Aktifkan agar orang ini juga melihat yang dilihat Management, tanpa hak mengubah."}
      </p>
      <div>
        <Button type="submit" size="sm" variant={enabled ? "outline" : "default"} disabled={pending} aria-label={`${enabled ? "Matikan" : "Aktifkan"} tampilan Management untuk ${label}`}>
          {enabled ? "Matikan" : "Aktifkan"}
        </Button>
      </div>
      <Status state={state} />
    </form>
  );
}

/** Opens the application as this account, read only. Superadmin only; the page decides who gets the form. */
export function ImpersonateForm({ userId, name, label }: { userId: string; name: string; label: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(startImpersonationAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <p className="text-sm text-muted-foreground">Periksa tampilan akun ini. Hanya lihat: perubahan tidak disimpan, berlaku 1 jam, dan tercatat di audit log.</p>
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending} aria-label={`Lihat sebagai ${label}`}>
          {pending ? "Membuka…" : `Lihat sebagai ${name}`}
        </Button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function ActiveForm({ userId, isActive, label }: { userId: string; isActive: boolean; label: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(setActiveAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="active" value={String(!isActive)} />
      <Button type="submit" variant={isActive ? "destructive" : "outline"} size="sm" disabled={pending} aria-label={`${isActive ? "Deactivate" : "Reactivate"} ${label}`}>
        {isActive ? "Deactivate" : "Reactivate"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function ResetPasswordForm({ userId, label }: { userId: string; label: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(resetPasswordAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex gap-2">
        <Input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" aria-label={`New password for ${label}`} placeholder="Kata sandi baru" className="w-40" />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          Reset
        </Button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function ChangeEmailForm({ userId, email }: { userId: string; email: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(changeEmailAction, null);

  return (
    <form key={email} action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex gap-2">
        <Input name="email" type="email" required maxLength={254} defaultValue={email} autoComplete="off" aria-label={`Email for ${email}`} className="w-56" />
        <Button type="submit" size="sm" disabled={pending}>
          <SaveText what={`email for ${email}`} />
        </Button>
      </div>
      <Status state={state} />
    </form>
  );
}

/**
 * The one button in an account's Actions column. It opens a window with everything that can be changed on the account: the e-mail
 * (Superadmin), the role, a new password, and switching the account off or on. The window stays open after each change so its message
 * can be read; the table behind it refreshes by itself.
 */
export function UserEditDialog({
  user,
  roles,
  canChangeEmail,
  canSetManagement,
  canImpersonate,
}: {
  user: { id: string; name: string; email: string; role: Role; alsoManagement: boolean; isActive: boolean };
  roles: readonly Role[];
  canChangeEmail: boolean;
  canSetManagement: boolean;
  canImpersonate: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  return (
    <>
      <Button type="button" variant="outline" size="sm" aria-haspopup="dialog" aria-label={`Edit ${user.email}`} onClick={() => dialog.current?.showModal()}>
        Edit
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className="m-auto max-h-[90svh] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/40"
        onClick={(event) => {
          // A click on the dimmed area outside the window closes it.
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="flex flex-col gap-5 p-5">
          <div>
            <h2 id={`${id}-title`} className="font-heading text-lg font-semibold">
              Edit {user.name}
            </h2>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
          {canChangeEmail ? (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold">Email</h3>
              <ChangeEmailForm userId={user.id} email={user.email} />
            </section>
          ) : null}
          <section className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">Role</h3>
            <RoleForm userId={user.id} currentRole={user.role} roles={roles} label={user.email} />
          </section>
          {canSetManagement && ALSO_MANAGEMENT_ROLES.includes(user.role) ? (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold">Tampilan Management</h3>
              <AlsoManagementForm userId={user.id} enabled={user.alsoManagement} label={user.email} />
            </section>
          ) : null}
          {canImpersonate && user.isActive && !isPrivilegedRole(user.role) ? (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold">Lihat sebagai</h3>
              <ImpersonateForm userId={user.id} name={user.name} label={user.email} />
            </section>
          ) : null}
          <section className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">Password</h3>
            <ResetPasswordForm userId={user.id} label={user.email} />
          </section>
          <section className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">Account status</h3>
            <ActiveForm userId={user.id} isActive={user.isActive} label={user.email} />
          </section>
          <div className="flex justify-end border-t pt-4">
            <Button type="button" variant="outline" onClick={() => dialog.current?.close()}>
              Close
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
