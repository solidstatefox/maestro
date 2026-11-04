"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

export function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="input-group" className={cn("flex w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-background shadow-xs focus-within:ring-2 focus-within:ring-ring/30", className)} {...props} />;
}
export function InputGroupAddon({ align = "inline-end", className, ...props }: React.ComponentProps<"div"> & { align?: "block-start" | "block-end" | "inline-start" | "inline-end" }) {
  return <div data-slot="input-group-addon" data-align={align} className={cn("flex min-w-0 items-center gap-2 px-2 py-1.5", align === "block-start" ? "flex-wrap border-b" : "", align === "block-end" ? "border-t" : "", className)} {...props} />;
}
export const InputGroupTextarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(function InputGroupTextarea({ className, ...props }, ref) {
  return <textarea ref={ref} data-slot="input-group-control" className={cn("max-h-40 min-h-14 w-full resize-y bg-transparent p-3 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50", className)} {...props} />;
});
export function InputGroupButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button className={cn("shrink-0", className)} {...props} />;
}
