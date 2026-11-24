"use client";

import { useContext, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrowsePanePreferenceContext } from "@/canvas/browse-pane-layout";
import { BROWSE_PANE_LABELS, moveBrowsePane, type BrowsePane } from "@/canvas/browse-pane-order";

/** Row number is the pane's left-to-right position. Drop moves, not duplicates. */
export function BrowsePaneOrderControl() {
  const { order, loaded, changeOrder } = useContext(BrowsePanePreferenceContext);
  const dragging = useRef<BrowsePane | null>(null);
  const [target, setTarget] = useState<BrowsePane | null>(null);
  const finishDrag = () => { dragging.current = null; setTarget(null); };
  const move = (pane: BrowsePane, index: number) => changeOrder(moveBrowsePane(order, pane, index));
  return <section aria-labelledby="maestro-browse-pane-order-heading" className="flex flex-col gap-2 rounded-md border p-3">
    <h3 id="maestro-browse-pane-order-heading" className="text-sm font-medium">Browse pane order</h3>
    <p className="text-xs text-muted-foreground">Drag to reorder from left to right, or use the arrows.</p>
    <ol aria-label="Browse panes, left to right" className="space-y-1.5" aria-busy={!loaded}>
      {order.map((pane, index) => <li key={pane}
        className={`flex items-center gap-2 rounded-md border px-2 py-1 ${target === pane ? "border-primary bg-accent" : ""}`}
        onDragOver={event => {
          if (!loaded || !dragging.current) return;
          event.preventDefault(); event.dataTransfer.dropEffect = "move"; setTarget(pane);
        }}
        onDrop={event => {
          if (!loaded || !dragging.current) return;
          event.preventDefault(); move(dragging.current, index); finishDrag();
        }}>
        <span draggable={loaded} aria-label={`Drag ${BROWSE_PANE_LABELS[pane]}`} title={`Drag ${BROWSE_PANE_LABELS[pane]}`}
          className="flex cursor-grab touch-none items-center text-muted-foreground active:cursor-grabbing"
          onDragStart={event => {
            if (!loaded) { event.preventDefault(); return; }
            dragging.current = pane; event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", pane);
          }} onDragEnd={finishDrag}>
          <GripVertical className="size-4" aria-hidden="true" />
        </span>
        <span className="w-4 text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
        <span className="min-w-0 flex-1 text-sm">{BROWSE_PANE_LABELS[pane]}</span>
        <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`Move ${BROWSE_PANE_LABELS[pane]} left`} disabled={!loaded || index === 0} onClick={() => move(pane, index - 1)}><ArrowUp className="size-4" aria-hidden="true" /></Button>
        <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`Move ${BROWSE_PANE_LABELS[pane]} right`} disabled={!loaded || index === order.length - 1} onClick={() => move(pane, index + 1)}><ArrowDown className="size-4" aria-hidden="true" /></Button>
      </li>)}
    </ol>
    <div className="sr-only" aria-live="polite">{order.map(pane => BROWSE_PANE_LABELS[pane]).join(", ")}</div>
  </section>;
}
