"use client";

import * as React from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

type AttachmentState = "idle" | "uploading" | "processing" | "error" | "done";
export function Attachment({ state = "done", size = "default", orientation = "horizontal", className, ...props }: React.ComponentProps<"div"> & { state?: AttachmentState; size?: "default" | "sm" | "xs"; orientation?: "horizontal" | "vertical" }) {
  return <div data-slot="attachment" data-state={state} data-size={size} data-orientation={orientation}
    className={cn("group/attachment relative flex min-w-0 items-center gap-2 rounded-lg border bg-card px-2 py-1.5 text-card-foreground", orientation === "vertical" && "flex-col", size === "xs" && "text-[11px]", size === "sm" && "text-xs", size === "default" && "text-sm", state === "error" && "border-destructive text-destructive", className)} {...props} />;
}
export function AttachmentMedia({ variant = "icon", className, ...props }: React.ComponentProps<"div"> & { variant?: "icon" | "image" }) {
  return <div data-slot="attachment-media" className={cn("flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground [&_img]:h-full [&_img]:w-full [&_img]:object-cover", variant === "image" && "size-12", className)} {...props} />;
}
export function AttachmentContent({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="attachment-content" className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)} {...props} />; }
export function AttachmentTitle({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="attachment-title" className={cn("truncate font-medium group-data-[state=uploading]/attachment:animate-pulse group-data-[state=processing]/attachment:animate-pulse", className)} {...props} />; }
export function AttachmentDescription({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="attachment-description" className={cn("truncate text-xs text-muted-foreground", className)} {...props} />; }
export function AttachmentActions({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="attachment-actions" className={cn("relative z-10 flex shrink-0 items-center gap-1", className)} {...props} />; }
export function AttachmentAction({ className, ...props }: React.ComponentProps<typeof Button>) { return <Button type="button" variant="ghost" size="icon-xs" className={cn("rounded-full", className)} {...props} />; }
export function AttachmentTrigger({ className, ...props }: React.ComponentProps<"button">) { return <button type="button" data-slot="attachment-trigger" className={cn("absolute inset-0 rounded-lg focus-visible:ring-2 focus-visible:ring-ring", className)} {...props} />; }
export function AttachmentGroup({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="attachment-group" role="group" className={cn("flex min-w-0 snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [&>[data-slot=attachment]]:shrink-0 [&>[data-slot=attachment]]:snap-start", className)} {...props} />; }
