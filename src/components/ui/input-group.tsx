"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/** shadcn/Base Input Group composition. One border and one focus ring belong
 * to the root; addons and input controls are unbordered siblings.  Block
 * addons take a full row (used by Maestro's assistant composer). */
function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="input-group" role="group" className={cn(
    "group/input-group flex w-full min-w-0 flex-wrap items-center rounded-md border border-input bg-background shadow-xs transition-colors",
    "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
    "has-[[data-slot=input-group-control]:disabled]:opacity-50",
    className,
  )} {...props}/>;
}
function InputGroupAddon({ align="inline-start", className, ...props }: React.ComponentProps<"div"> & {
  align?: "block-start" | "block-end" | "inline-start" | "inline-end";
}) {
  return <div data-slot="input-group-addon" data-align={align} className={cn(
    "flex min-w-0 shrink-0 items-center gap-2 text-sm text-muted-foreground",
    align === "inline-start" ? "order-first px-2" : align === "inline-end" ? "order-last px-2" :
      align === "block-start" ? "order-first w-full flex-wrap border-b px-3 py-2" :
      "order-last w-full flex-wrap border-t px-3 py-2",
    className,
  )} {...props}/>;
}
const InputGroupInput = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  function InputGroupInput({className,...props},ref) {
    return <input ref={ref} data-slot="input-group-control" className={cn(
      "h-9 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
      className,
    )} {...props}/>;
  },
);
const InputGroupTextarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  function InputGroupTextarea({className,...props},ref) {
    return <textarea ref={ref} data-slot="input-group-control" className={cn(
      "max-h-40 min-h-14 w-full resize-y bg-transparent p-3 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50",
      className,
    )} {...props}/>;
  },
);
function InputGroupButton({className,variant="ghost",size="xs",...props}:React.ComponentProps<typeof Button>){
  return <Button variant={variant} size={size} className={cn("shrink-0",className)} {...props}/>;
}
function InputGroupText({className,...props}:React.ComponentProps<"span">){
  return <span data-slot="input-group-text" className={cn("text-sm text-muted-foreground",className)} {...props}/>;
}
export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText, InputGroupTextarea };
