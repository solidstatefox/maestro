"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "radix-ui"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { cn } from "cn"

/** shadcn/ui Radix Select, using the same components and theme tokens as Maestro.
 * https://ui.shadcn.com/docs/components/radix/select */
function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectTrigger({ className, children, size = "sm", ...props }:
  React.ComponentProps<typeof SelectPrimitive.Trigger> & { size?: "sm" | "default" }) {
  return <SelectPrimitive.Trigger
    data-slot="select-trigger"
    data-size={size}
    className={cn(
      "flex w-full min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-background px-2.5 text-xs text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 [&>svg]:shrink-0",
      size === "sm" ? "h-8" : "h-9",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild><ChevronDownIcon className="ml-auto size-3.5 shrink-0 opacity-60" aria-hidden="true"/></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props}/>
}

function SelectContent({ className, children, position = "popper", ...props }:
  React.ComponentProps<typeof SelectPrimitive.Content>) {
  return <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      data-slot="select-content"
      position={position}
      sideOffset={4}
      className={cn(
        "z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center"><ChevronUpIcon className="size-4"/></SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center"><ChevronDownIcon className="size-4"/></SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item data-slot="select-item"
    className={cn("relative flex min-h-8 cursor-default select-none items-center rounded-md py-1 pl-2 pr-8 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",className)}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center"><CheckIcon className="size-3.5"/></SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
