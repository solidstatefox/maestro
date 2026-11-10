"use client";
import type { ReactNode } from "react";
export function BrowseRibbon({ breadcrumbs }: { breadcrumbs: ReactNode }) {
  return <nav aria-label="Navigation breadcrumbs" className="flex min-h-14 flex-wrap items-start gap-2 bg-background px-4 pt-2 pb-7">{breadcrumbs}</nav>;
}
