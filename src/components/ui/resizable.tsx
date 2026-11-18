"use client";

import * as React from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";

export const ResizablePanelGroup = PanelGroup;
export const ResizablePanel = Panel;

/** Match the shadcn Resizable composition: one real, centered, keyboard-accessible
 * resize separator between adjacent Panels.  Never offset the pointer target to
 * the *left* pane; doing so allows the other handle to steal a drag. */
export function ResizableHandle({ className = "", withHandle = false, ...props }: React.ComponentProps<typeof PanelResizeHandle> & { withHandle?: boolean }) {
  return (
    <PanelResizeHandle
      className={`group relative z-10 flex w-2 min-w-2 max-w-2 shrink-0 touch-none cursor-col-resize items-center justify-center bg-transparent outline-none before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border hover:before:bg-primary focus-visible:ring-2 focus-visible:ring-ring data-[resize-handle-active]:before:bg-primary ${className}`}
      {...props}
    >
      {withHandle ? <span aria-hidden="true" className="pointer-events-none absolute z-10 h-8 w-px rounded-full bg-border group-hover:bg-primary" /> : null}
    </PanelResizeHandle>
  );
}
