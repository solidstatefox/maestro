"use client";
import { useEffect, useState } from "react";
import { RECORD_PERF_EVENT, recordPerformanceDebugEnabled, type RecordPerfEvent } from "@/lib/record-performance";
/** Only mounted when ?maestroDebug=record; never exposes RDF or HTTP details. */
export function RecordPerformanceDebug() {
  const [items, setItems] = useState<RecordPerfEvent[]>([]);
  useEffect(() => {
    if (!recordPerformanceDebugEnabled()) return;
    const onMeasurement = (event: Event) => setItems(previous => [...previous.slice(-11), (event as CustomEvent<RecordPerfEvent>).detail]);
    window.addEventListener(RECORD_PERF_EVENT, onMeasurement);
    return () => window.removeEventListener(RECORD_PERF_EVENT, onMeasurement);
  }, []);
  if (!recordPerformanceDebugEnabled()) return null;
  return <details data-maestro-record-performance className="mx-2 mt-1 rounded border border-dashed border-border p-2 text-xs text-muted-foreground">
    <summary className="cursor-pointer font-medium">Record performance (debug)</summary>
    <div className="mt-1 flex flex-col gap-1 font-mono">
      {items.length ? items.map((entry, index) => <div key={index}>{entry.phase}: {entry.elapsedMs} ms{entry.mode ? ` (${entry.mode})` : ""}</div>) : "No Record timing samples yet."}
    </div>
  </details>;
}
