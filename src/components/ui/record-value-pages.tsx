"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Pure presentation for XSLT-provided RDF values. No RDF or SPARQL logic here.
 * Children are the links/literals selected and formatted by the stylesheet.
 */
export function RecordValuePages({
  children,
  pageSize = 5,
  className = "",
  id,
}: {
  children?: React.ReactNode;
  pageSize?: number;
  className?: string;
  id?: string;
}) {
  const values = React.Children.toArray(children).filter(React.isValidElement);
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.min(100, Math.floor(pageSize))) : 5;
  const pages = Math.max(1, Math.ceil(values.length / size));
  const [page, setPage] = React.useState(0);
  const current = Math.min(page, pages - 1);
  const start = current * size;
  return (
    <div id={id} className={`min-w-0 ${className}`}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {values.slice(start, start + size).map((value, i) => (
          <div className="min-w-0 break-words" key={(value as React.ReactElement).key ?? start + i}>
            {value}
          </div>
        ))}
      </div>
      {pages > 1 && (
        <nav aria-label="Property values pagination" className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {start + 1}–{Math.min(start + size, values.length)} of {values.length}
          </span>
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Previous property values" disabled={current === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex size-7 items-center justify-center rounded-md border border-input bg-background hover:bg-accent disabled:pointer-events-none disabled:opacity-40">
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-11 text-center text-xs tabular-nums text-muted-foreground">{current + 1} / {pages}</span>
            <button type="button" aria-label="Next property values" disabled={current >= pages - 1}
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              className="inline-flex size-7 items-center justify-center rounded-md border border-input bg-background hover:bg-accent disabled:pointer-events-none disabled:opacity-40">
              <ChevronRight className="size-4" />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
