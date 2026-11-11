"use client";

import { useEffect, useRef, useState } from "react";
import { Clock1, Clock2, Clock3, Clock4, Clock5, Clock6, Clock7, Clock8, Clock9, Clock10, Clock11, Clock12 } from "lucide-react";
import { readMaestroWidgetTimeouts, type MaestroTimeoutCategory } from "@/lib/maestro-query-timeouts";
import { getMaestroQueryExecutionSnapshot, type MaestroQueryClockScope } from "@/lib/maestro-query-execution-clock";

const CLOCKS = [Clock1, Clock2, Clock3, Clock4, Clock5, Clock6, Clock7, Clock8, Clock9, Clock10, Clock11, Clock12] as const;

/** 100ms animated loading indicator. Queue time animates the clock but is not charged to the query ratio. */
export function ElapsedStatus({ label, category, requestWaves = 1, clockScope }: { label: string; category?: MaestroTimeoutCategory; requestWaves?: number; clockScope?: MaestroQueryClockScope }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [animationTick, setAnimationTick] = useState(0);
  const [hasDispatched, setHasDispatched] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState<number | null>(null);
  const displayedGeneration = useRef<number | null>(null);

  useEffect(() => {
    const mountedAt = performance.now();
    // If the status mounts after its request has already started, keep the ratio visible.
    const initialSnapshot = clockScope ? getMaestroQueryExecutionSnapshot(clockScope) : null;
    displayedGeneration.current = initialSnapshot?.generation ?? null;
    setHasDispatched(initialSnapshot ? initialSnapshot.lastStartedAt > 0 : false);
    const update = () => {
      setAnimationTick(Math.floor((performance.now() - mountedAt) / 100));
      if (clockScope) {
        const snapshot = getMaestroQueryExecutionSnapshot(clockScope);
        setElapsedMs(snapshot.elapsedMs);
        // The same mounted component may survive a live query change or Refresh.
        // The next pipeline starts queued with no ratio until its first dispatch.
        if (displayedGeneration.current !== snapshot.generation) {
          displayedGeneration.current = snapshot.generation;
          setHasDispatched(snapshot.lastStartedAt > 0);
        } else if (snapshot.lastStartedAt > 0) {
          setHasDispatched(true);
        }
      } else {
        // Non-query operations animate but have no Virtuoso dispatch clock.
        setElapsedMs(0);
      }
      const configured = category ? readMaestroWidgetTimeouts()[category] : 0;
      setTimeoutMs(configured > 0 ? configured * 1000 : null);
    };
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [category, clockScope]);

  const Clock = CLOCKS[animationTick % CLOCKS.length];
  const budgetMs = timeoutMs === null ? null : timeoutMs * Math.max(1, Math.ceil(requestWaves));
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const overdueSeconds = budgetMs === null ? -1 : elapsedSeconds - Math.round(budgetMs / 1000);
  const overduePalette = [
    "#16a34a", "#55a630", "#84ab21", "#b1aa18", "#d5a319",
    "#e49a1c", "#ed8a16", "#f57914", "#fa5810", "#fc2c08", "#ff0000",
  ];
  const elapsedColor = overdueSeconds < 0 ? undefined : overduePalette[Math.min(10, overdueSeconds)];
  const cleanLabel = label.replace(/\s*(?:\.{3}|…)+\s*$/, "").trim();
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap" aria-live="off">
      <Clock className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{cleanLabel}</span>
      {hasDispatched && (
        <>
          <span aria-hidden="true" className="text-muted-foreground/60">·</span>
          <span className="tabular-nums" style={elapsedColor ? { color: elapsedColor } : undefined} aria-label={budgetMs === null ? `${elapsedSeconds} seconds elapsed` : `${elapsedSeconds} seconds of active requests, ${Math.round(budgetMs / 1000)} seconds of configured query budget`}>
            {elapsedSeconds}{budgetMs !== null ? ` / ${Math.round(budgetMs / 1000)}` : ""}s
          </span>
        </>
      )}
    </span>
  );
}
