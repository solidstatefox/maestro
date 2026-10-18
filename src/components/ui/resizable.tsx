"use client";

import * as React from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";

export const ResizablePanelGroup = PanelGroup;
export const ResizablePanel = Panel;

export function ResizableHandle({ className = "", withHandle = false, ...props }: React.ComponentProps<typeof PanelResizeHandle> & { withHandle?: boolean }) {
  return (
    <PanelResizeHandle
      className={`group relative flex w-px items-center justify-center bg-border transition-colors after:absolute after:inset-y-0 after:-left-1.5 after:w-3 hover:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[resize-handle-active]:bg-primary ${className}`}
      {...props}
    >
      {withHandle ? <span className="z-10 h-8 w-1 rounded-full bg-border group-hover:bg-primary" /> : null}
    </PanelResizeHandle>
  );
}
