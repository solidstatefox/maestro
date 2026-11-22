"use client";

import type { ReactNode } from "react";

/** Stable Maestro fixture surfaces shared by the live panes and their skeletons.
 * Layout and semantic furniture do not change when query data arrives. */
export function LeftPaneToolbar({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2 text-sm whitespace-nowrap">{children}</div>;
}

export function BrowseGroupToolbar({ children, hidden = false }: { children: ReactNode; hidden?: boolean }) {
  return <div className={`group/header shrink-0 border-b px-3 pb-3 pt-0 ${hidden ? "hidden" : ""}`}>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">{children}</div>
  </div>;
}

export function RecordHeaderFixture({ children }: { children: ReactNode }) {
  return <div className="group/record-header px-4 pt-1 pb-0">{children}</div>;
}

/** The live Results cards and loading cards share the same border, rhythm and padding. */
export function ResultCardFixture({ children, selected = false }: { children: ReactNode; selected?: boolean }) {
  return <div data-result-selected={selected ? "true" : "false"} className={`mb-2 rounded-md border ${selected ? "border-primary" : "border-border"}`}>{children}</div>;
}
