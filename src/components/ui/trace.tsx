"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";

export type TraceStatus = "running" | "success" | "warning" | "error";

export function Trace({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("w-full min-w-0 rounded-lg border bg-card py-1", className)} {...props} />;
}

export function TraceCollapsible({ children, defaultOpen = false, className }: {
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  // Native details keeps the state local to each event and supports keyboard activation.
  // defaultOpen is React state initialization, not a valid native details attribute.
  const ref = React.useRef<HTMLDetailsElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.open = defaultOpen;
  }, [defaultOpen]);
  return <details ref={ref} className={cn("group/trace min-w-0", className)}>{children}</details>;
}

export function TraceCollapsibleTrigger({ children }: { children: React.ReactNode }) {
  return (
    <summary className="flex min-w-0 cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden">
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronDown aria-hidden="true" className="mr-3 size-3.5 shrink-0 text-muted-foreground transition-transform group-open/trace:rotate-180" />
    </summary>
  );
}

export function TraceCollapsibleContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-w-0 pb-2 pl-10 pr-3 text-xs text-muted-foreground", className)}>{children}</div>;
}

export function TraceLine({ children, className, status, ...props }: React.ComponentProps<"div"> & { status?: TraceStatus }) {
  return <div className={cn("flex min-h-9 min-w-0 items-center gap-2 px-3 py-2 text-xs", className)} data-status={status} {...props}>{children}</div>;
}

export function TraceIcon({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("flex size-4 shrink-0 items-center justify-center text-muted-foreground", className)}>{children}</span>;
}

export function TraceTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("min-w-0 break-words font-medium", className)}>{children}</span>;
}

export function TraceDescription({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("min-w-0 break-words text-muted-foreground", className)}>{children}</span>;
}
