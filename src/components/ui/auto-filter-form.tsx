"use client";

import type { ComponentProps } from "react";

/**
 * A GET filter form that applies a dropdown as soon as it is changed, so nobody has to press Filter after picking one.
 * Text fields still apply on Enter (or the Filter button), so the list does not reload on every key.
 */
export function AutoFilterForm(props: ComponentProps<"form">) {
  return (
    <form
      {...props}
      onChange={(event) => {
        if (event.target instanceof HTMLSelectElement) event.currentTarget.requestSubmit();
      }}
    />
  );
}
