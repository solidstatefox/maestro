"use client";
import type { ComponentProps } from "react";
import { cn } from "cn";

/** Shadcn Base Empty composition shared by View and Analyze. */
export function Empty({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="empty" className={cn("flex min-h-64 w-full flex-col items-center justify-center gap-6 rounded-lg border border-dashed p-8 text-center", className)} {...props}/>;
}
export function EmptyHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="empty-header" className={cn("flex max-w-sm flex-col items-center gap-2 text-center", className)} {...props}/>;
}
export function EmptyMedia({ className, variant = "default", ...props }: ComponentProps<"div"> & { variant?: "icon" | "default" }) {
  return <div data-slot="empty-icon" data-variant={variant} className={cn(variant === "icon" ? "mb-2 flex size-10 items-center justify-center rounded-lg bg-muted text-foreground [&_svg]:size-5" : "mb-2 text-muted-foreground", className)} {...props}/>;
}
export function EmptyTitle({ className, ...props }: ComponentProps<"h3">) {
  return <h3 data-slot="empty-title" className={cn("text-base font-medium tracking-tight", className)} {...props}/>;
}
export function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="empty-description" className={cn("text-sm leading-relaxed text-muted-foreground", className)} {...props}/>;
}
export function EmptyContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="empty-content" className={cn("flex flex-wrap items-center gap-2", className)} {...props}/>;
}
