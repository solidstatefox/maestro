"use client";

import type { ComponentProps } from "react";

/** shadcn-style semantic breadcrumb primitives. */
export function Breadcrumb({ className = "", ...props }: ComponentProps<"nav">) {
  return <nav aria-label="Breadcrumb" className={className} {...props} />;
}
export function BreadcrumbList({ className = "", ...props }: ComponentProps<"ol">) {
  return <ol className={`flex flex-wrap items-center gap-1 text-xs ${className}`} {...props} />;
}
export function BreadcrumbItem({ className = "", ...props }: ComponentProps<"li">) {
  return <li className={`inline-flex min-w-0 items-center gap-1 ${className}`} {...props} />;
}
export function BreadcrumbSeparator({ className = "", ...props }: ComponentProps<"li">) {
  return <li aria-hidden="true" className={`text-muted-foreground ${className}`} {...props}>›</li>;
}
