"use client";

import { Toggle as TogglePrimitive } from "radix-ui";
import type { ComponentProps } from "react";

/** shadcn/ui Toggle primitive wrapper. Controlled `pressed` state is owned by the caller. */
export function Toggle({ className = "", ...props }: ComponentProps<typeof TogglePrimitive.Root>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 ${className}`}
      {...props}
    />
  );
}
