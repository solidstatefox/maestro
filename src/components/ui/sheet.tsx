"use client"

import * as React from "react"
import { Dialog } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { cn } from "cn"

function Sheet(props: React.ComponentProps<typeof Dialog.Root>) {
  return <Dialog.Root data-slot="sheet" {...props} />
}

function SheetTrigger(props: React.ComponentProps<typeof Dialog.Trigger>) {
  return <Dialog.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose(props: React.ComponentProps<typeof Dialog.Close>) {
  return <Dialog.Close data-slot="sheet-close" {...props} />
}

function SheetContent({
  side = "right",
  className,
  children,
  ...props
}: React.ComponentProps<typeof Dialog.Popup> & {
  side?: "top" | "right" | "bottom" | "left"
}) {
  const sideClasses = {
    right: "inset-y-0 right-0 h-full w-[min(92vw,28rem)] border-l data-[open]:translate-x-0 data-[closed]:translate-x-full",
    left: "inset-y-0 left-0 h-full w-[min(92vw,28rem)] border-r data-[open]:translate-x-0 data-[closed]:-translate-x-full",
    top: "inset-x-0 top-0 max-h-[85vh] border-b data-[open]:translate-y-0 data-[closed]:-translate-y-full",
    bottom: "inset-x-0 bottom-0 max-h-[85vh] border-t data-[open]:translate-y-0 data-[closed]:translate-y-full",
  }
  return (
    <Dialog.Portal>
      <Dialog.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm transition-opacity duration-300 data-[open]:opacity-100 data-[closed]:opacity-0"
      />
      <Dialog.Viewport className="fixed inset-0 z-50 flex justify-end pointer-events-none">
        <Dialog.Popup
          data-slot="sheet-content"
          className={cn(
            "pointer-events-auto fixed flex flex-col gap-4 overflow-y-auto bg-background text-foreground shadow-xl outline-none transition-transform duration-300 ease-in-out",
            sideClasses[side],
            className,
          )}
          {...props}
        >
          {children}
          <Dialog.Close
            className="absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close controls"
          >
            <X className="size-4" />
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex flex-col gap-1.5 px-4 pt-5 pr-14", className)} {...props} />
}

function SheetTitle(props: React.ComponentProps<typeof Dialog.Title>) {
  return <Dialog.Title data-slot="sheet-title" className="text-base font-semibold" {...props} />
}

function SheetDescription(props: React.ComponentProps<typeof Dialog.Description>) {
  return <Dialog.Description data-slot="sheet-description" className="text-sm text-muted-foreground" {...props} />
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-footer" className={cn("mt-auto flex flex-col gap-2 px-4 pb-4", className)} {...props} />
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter }
