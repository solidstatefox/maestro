"use client";
import type * as React from "react";
import { Trace, TraceLine, TraceTitle } from "@/components/ui/trace";

/** AI Elements Task steps share the same Trace primitives as the execution terminal. */
export function Task(props: React.ComponentProps<typeof Trace>) { return <Trace {...props} />; }
export function TaskItem({ status, title, children }: { status: "running" | "success" | "warning" | "error"; title: string; children?: React.ReactNode }) {
  return <div className="border-b border-border/50 last:border-0" data-status={status}>
    <TraceLine><span aria-hidden="true" className={status === "error" ? "text-destructive" : status === "warning" ? "text-amber-600" : status === "success" ? "text-emerald-600" : "text-muted-foreground"}>{status === "running" ? "…" : status === "success" ? "✓" : status === "warning" ? "!" : "✕"}</span><TraceTitle>{title}</TraceTitle></TraceLine>
    {children}
  </div>;
}
