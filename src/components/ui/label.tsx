"use client";

import * as React from "react";

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

/** shadcn/ui-compatible accessible Label primitive. */
export function Label({ className = "", ...props }: LabelProps) {
  return (
    <label
      data-slot="label"
      className={`flex items-center gap-2 text-sm leading-none font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}
