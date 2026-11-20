"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/toast";
import { changePasswordAction } from "./actions";

/** Once the password is changed the person goes straight to their dashboard ("/" sends each role to its own); the toast follows them there. */
export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(changePasswordAction, null);
  const router = useRouter();
  useEffect(() => {
    if (!state?.ok) return;
    toast.success(state.message, state);
    router.replace("/");
  }, [state, router]);

  return (
    <form action={formAction} className="grid max-w-md gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="current-password">Current password</Label>
        <PasswordInput id="current-password" name="currentPassword" required autoComplete="current-password" maxLength={128} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">New password</Label>
        <PasswordInput id="new-password" name="newPassword" required minLength={8} maxLength={128} autoComplete="new-password" />
        <p className="text-xs text-muted-foreground">8 to 128 characters.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <PasswordInput id="confirm-password" name="confirmPassword" required minLength={8} maxLength={128} autoComplete="new-password" />
      </div>
      <FormStatus state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
