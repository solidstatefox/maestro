"use client"

import * as React from "react"
import { Combobox as Primitive } from "@base-ui/react"
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react"
import { cn } from "cn"

/** shadcn/ui Base Combobox composition (Input / Content / Empty / List / Item).
 * No trigger is rendered for root URI editing when showTrigger={false}. */
const Combobox = Primitive.Root

function ComboboxInput({ className, showTrigger = true, showClear = false, ...props }:
  Primitive.Input.Props & { showTrigger?: boolean; showClear?: boolean }) {
  return (
    <div data-slot="combobox-input-group" className={cn("flex h-9 w-full min-w-0 items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring/30",className)}>
      <Primitive.Input data-slot="combobox-input"
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
        {...props}/>
      {showTrigger && <Primitive.Trigger aria-label="Show suggestions" className="flex h-full shrink-0 items-center px-2 text-muted-foreground hover:text-foreground">
        <ChevronDownIcon aria-hidden="true" className="size-4" />
      </Primitive.Trigger>}
      {showClear && <Primitive.Clear aria-label="Clear" className="flex h-full shrink-0 items-center px-2 text-muted-foreground hover:text-foreground">
        <XIcon aria-hidden="true" className="size-4" />
      </Primitive.Clear>}
    </div>
  )
}
function ComboboxContent({ className, side = "bottom", sideOffset = 6, align = "start", ...props }:
  Primitive.Popup.Props & Pick<Primitive.Positioner.Props,"side"|"sideOffset"|"align">) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner side={side} sideOffset={sideOffset} align={align} className="isolate z-[400]">
        <Primitive.Popup data-slot="combobox-content"
          className={cn("max-h-[min(18rem,var(--available-height))] w-[max(var(--anchor-width),min(40rem,80vw))] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg outline-none",className)} {...props}/>
      </Primitive.Positioner>
    </Primitive.Portal>
  )
}
function ComboboxList({ className, ...props }: Primitive.List.Props) {
  return <Primitive.List data-slot="combobox-list" className={cn("max-h-64 overflow-y-auto overscroll-contain p-1",className)} {...props}/>
}
function ComboboxEmpty({ className, ...props }: Primitive.Empty.Props) {
  return <Primitive.Empty data-slot="combobox-empty" className={cn("px-3 py-2 text-sm text-muted-foreground",className)} {...props}/>
}
function ComboboxItem({ className, children, ...props }: Primitive.Item.Props) {
  return <Primitive.Item data-slot="combobox-item"
    className={cn("relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 pr-7 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50",className)} {...props}>
      {children}
      <Primitive.ItemIndicator render={<span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center"/>}>
        <CheckIcon className="size-4" aria-hidden="true" />
      </Primitive.ItemIndicator>
    </Primitive.Item>
}
export { Combobox, ComboboxInput, ComboboxContent, ComboboxEmpty, ComboboxList, ComboboxItem }
