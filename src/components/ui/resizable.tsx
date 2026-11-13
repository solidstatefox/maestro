"use client";

import * as React from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";

export const ResizablePanelGroup = PanelGroup;
export const ResizablePanel = Panel;

export function ResizableHandle({ className = "", withHandle = false, ...props }: React.ComponentProps<typeof PanelResizeHandle> & { withHandle?: boolean }) {
  return (
    <PanelResizeHandle
      className={`group relative flex !w-px !min-w-px !max-w-px shrink-0 items-center justify-center bg-border transition-colors after:absolute after:inset-y-0 after:-left-1 after:w-[3px] hover:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[resize-handle-active]:bg-primary ${className}`}
      {...props}
    >
      {withHandle ? <span className="pointer-events-none absolute z-10 h-8 w-px rounded-full bg-border group-hover:bg-primary" /> : null}
    </PanelResizeHandle>
  );
}
