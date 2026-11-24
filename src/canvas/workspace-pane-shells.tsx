"use client";

import type { MouseEventHandler, ReactNode, Ref } from "react";
import { ResizablePanel } from "@/components/ui/resizable";
import { useBrowsePanePosition, useBrowsePaneDefaultSize, useBrowsePaneMinSize } from "@/canvas/browse-pane-layout";

/** These are the same resizable pane frames used by live Maestro and its loading state. */
export function LeftPaneFrame({ children, defaultSize = 25 }: { children: ReactNode; defaultSize?: number }) {
  const order = useBrowsePanePosition("filters");
  return <ResizablePanel id="maestro-browse-left" order={order} defaultSize={useBrowsePaneDefaultSize("filters", defaultSize)} minSize={useBrowsePaneMinSize("filters", 16)} className="min-w-0 overflow-hidden">{children}</ResizablePanel>;
}
export function CenterPaneFrame({ children, defaultSize = 45 }: { children: ReactNode; defaultSize?: number }) {
  const order = useBrowsePanePosition("results");
  return <ResizablePanel id="maestro-browse-center" order={order} defaultSize={useBrowsePaneDefaultSize("results", defaultSize)} minSize={useBrowsePaneMinSize("results", 25)} className="min-w-0 overflow-hidden">{children}</ResizablePanel>;
}
export function RightPaneFrame({ children, defaultSize = 30 }: { children: ReactNode; defaultSize?: number }) {
  const order = useBrowsePanePosition("record");
  return <ResizablePanel id="maestro-browse-right" order={order} defaultSize={useBrowsePaneDefaultSize("record", defaultSize)} minSize={useBrowsePaneMinSize("record", 18)} className="min-w-0 overflow-hidden">{children}</ResizablePanel>;
}

/** Use the live pane body elements, not a separate skeleton-only visual imitation. */
export function LeftPaneBody({ children }: { children: ReactNode }) {
  return <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">{children}</aside>;
}
export function CenterPaneBody({ children, paneRef }: { children: ReactNode; paneRef?: Ref<HTMLElement> }) {
  return <section ref={paneRef} className="flex h-full min-h-0 min-w-0 flex-col">{children}</section>;
}
export function RightPaneBody({ children, paneRef, onClickCapture }: { children: ReactNode; paneRef?: Ref<HTMLElement>; onClickCapture?: MouseEventHandler<HTMLElement> }) {
  return <section ref={paneRef} onClickCapture={onClickCapture} className="flex h-full min-h-0 min-w-0 flex-col">{children}</section>;
}
