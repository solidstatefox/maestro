"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ComponentProps } from "react";

/** Root for a shadcn-style tooltip using Base UI's Tooltip primitive. */
function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

/** Trigger for a tooltip; supports Base UI's `render` prop. */
function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/** Positioned tooltip content styled to match Maestro's shadcn UI. */
function TooltipContent({
  className = "",
  sideOffset = 4,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Popup> & { sideOffset?: number }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner sideOffset={sideOffset} className="z-50">
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={`z-50 max-w-xs origin-(--transform-origin) rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-md transition duration-150 ease-out data-[starting-style]:translate-y-1 data-[starting-style]:opacity-0 data-[ending-style]:translate-y-1 data-[ending-style]:opacity-0 data-[side=top]:data-[starting-style]:translate-y-1 data-[side=bottom]:data-[starting-style]:-translate-y-1 data-[side=left]:data-[starting-style]:translate-x-1 data-[side=right]:data-[starting-style]:-translate-x-1 ${className}`}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="z-50 h-2 w-3 fill-foreground data-[side=top]:-bottom-1.5 data-[side=bottom]:-top-1.5 data-[side=left]:-right-1.5 data-[side=right]:-left-1.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipTrigger };
