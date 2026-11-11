"use client";

import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

/** Small shadcn-style single-selection toggle group for calendar resolution. */
export function ToggleGroup({ className = "", ...props }: ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return <ToggleGroupPrimitive.Root data-slot="toggle-group" className={`inline-flex items-center gap-0 ${className}`} {...props}/>;
}
export function ToggleGroupItem({ className = "", ...props }: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return <ToggleGroupPrimitive.Item data-slot="toggle-group-item" className={`inline-flex h-8 min-w-0 items-center justify-center px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-accent data-[state=on]:text-foreground disabled:opacity-50 ${className}`} {...props}/>;
}
