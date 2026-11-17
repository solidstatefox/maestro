import * as React from "react"
import { cn } from "cn"

/** shadcn/ui Button Group: joined controls, native focus/disabled states, no bespoke border wrapper.
 * https://ui.shadcn.com/docs/components/radix/button-group */
function ButtonGroup({ className, orientation = "horizontal", ...props }:
  React.ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      data-slot="button-group"
      role="group"
      data-orientation={orientation}
      className={cn(
        "flex w-fit items-stretch [&>button]:focus-visible:relative [&>button]:focus-visible:z-10",
        orientation === "horizontal"
          ? "[&>button:not(:first-child)]:rounded-l-none [&>button:not(:last-child)]:rounded-r-none [&>button:not(:first-child)]:-ml-px"
          : "flex-col [&>button:not(:first-child)]:rounded-t-none [&>button:not(:last-child)]:rounded-b-none [&>button:not(:first-child)]:-mt-px",
        className,
      )}
      {...props}
    />
  )
}

function ButtonGroupSeparator({ className, orientation = "vertical", ...props }:
  React.ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }) {
  return <div role="separator" aria-orientation={orientation} data-slot="button-group-separator"
    className={cn("self-stretch bg-border", orientation === "vertical" ? "w-px" : "h-px", className)} {...props} />
}

function ButtonGroupText({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="button-group-text" className={cn("flex items-center justify-center px-3 text-sm text-muted-foreground", className)} {...props} />
}

export { ButtonGroup, ButtonGroupSeparator, ButtonGroupText }
