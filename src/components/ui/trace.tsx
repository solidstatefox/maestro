"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
export function Trace({ className, ...props }: React.ComponentProps<"div">) { return <div className={cn("w-full min-w-0 rounded-lg border bg-card", className)} {...props} />; }
export function TraceCollapsible({ children, defaultOpen = false }: { children: React.ReactNode; defaultOpen?: boolean }) {
  const detailsRef = React.useRef<HTMLDetailsElement>(null);
  React.useEffect(() => {
    if (detailsRef.current) detailsRef.current.open = defaultOpen;
  }, [defaultOpen]);
  return <details ref={detailsRef} className="group">{children}</details>;
}
export function TraceCollapsibleTrigger({ children }: { children: React.ReactNode }) { return <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{children}<ChevronDown className="ml-auto mr-2 inline size-3 transition-transform group-open:rotate-180" /></summary>; }
export function TraceCollapsibleContent({ children }: { children: React.ReactNode }) { return <div className="border-t p-2">{children}</div>; }
export function TraceLine({ children }: { children: React.ReactNode }) { return <div className="inline-flex min-h-9 items-center gap-2 px-3 py-2 text-xs">{children}</div>; }
export function TraceIcon({ children }: { children: React.ReactNode }) { return <span className="text-muted-foreground">{children}</span>; }
export function TraceTitle({ children }: { children: React.ReactNode }) { return <span className="font-medium">{children}</span>; }
