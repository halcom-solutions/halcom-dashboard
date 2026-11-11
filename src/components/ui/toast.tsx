"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Success: it worked. Warning: it worked in part, or needs a look. Danger: it did not work. */
export type ToastKind = "success" | "warning" | "danger";
type Toast = { id: number; kind: ToastKind; message: string };

// One small store for the whole page: forms push a toast, the Toaster in the shell shows it.
let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
// A form's result object is toasted once, even if the form re-renders or is rebuilt with it.
const seen = new WeakSet<object>();

export function dismissToast(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

/**
 * Shows a message for a few seconds (longer when it is long). `source` is the result object it came from, so it is not shown twice.
 * `kind` is "success", "warning" or "danger"; a plain boolean still works (true is success, false is danger).
 */
function show(message: string, kind: ToastKind | boolean, source?: object) {
  const level: ToastKind = kind === true ? "success" : kind === false ? "danger" : kind;
  if (source) {
    if (seen.has(source)) return;
    seen.add(source);
  }
  const id = nextId++;
  // The same message again (several saves in a row) replaces the one on screen instead of stacking.
  toasts = [...toasts.filter((item) => item.message !== message).slice(-2), { id, kind: level, message }];
  emit();
  setTimeout(() => dismissToast(id), Math.min(9000, 3500 + message.length * 40));
}

/** `toast(message, kind)`, or `toast.success(message)`, `toast.warning(message)`, `toast.danger(message)`. */
export const toast = Object.assign(show, {
  success: (message: string, source?: object) => show(message, "success", source),
  warning: (message: string, source?: object) => show(message, "warning", source),
  danger: (message: string, source?: object) => show(message, "danger", source),
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * The corner where toasts appear. A success or a warning is announced politely (role status). A failure is shown here too, but is read from
 * the alert under its form, which stays while the person fixes the input, so the toast is hidden from screen readers.
 */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  // Escape closes the newest one.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && toasts.length > 0) dismissToast(toasts[toasts.length - 1]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // A modal dialog covers the page and makes it inert, so while one is open the toasts go inside it (seen and read out there).
  const host = list.length > 0 ? (document.querySelector<HTMLDialogElement>("dialog[open]") ?? null) : null;
  const corner = (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:w-96">
      {list.map((item) => (
        <div
          key={item.id}
          data-toast={item.kind}
          role={item.kind === "danger" ? undefined : "status"}
          aria-hidden={item.kind === "danger" ? true : undefined}
          className={cn(
            "pointer-events-auto flex w-full items-start gap-2 rounded-lg border bg-popover px-3 py-2.5 text-sm text-popover-foreground shadow-lg",
            item.kind === "success" && "border-primary/30",
            item.kind === "warning" && "border-amber-500/60",
            item.kind === "danger" && "border-destructive/50",
          )}
        >
          {item.kind === "success" ? (
            <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          ) : item.kind === "warning" ? (
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          ) : (
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          )}
          <span className="flex-1">{item.message}</span>
          <button type="button" aria-label="Hilangkan notifikasi" tabIndex={item.kind === "danger" ? -1 : 0} onClick={() => dismissToast(item.id)} className="text-muted-foreground hover:text-foreground">
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
  return host ? createPortal(corner, host) : corner;
}
