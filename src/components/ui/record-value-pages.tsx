"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Shared inline value truncation. A value's full text and click targets remain in the DOM. */
function ClampedRecordValue({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = React.useState(false);
  const [overflows, setOverflows] = React.useState(false);
  const textRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const check = () => {
      if (!expanded) setOverflows(element.scrollHeight > element.clientHeight + 2);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children, expanded]);
  return <div className="min-w-0">
    <div ref={textRef} className={expanded ? "min-w-0 break-words" : "min-w-0 break-words line-clamp-3"}>{children}</div>
    {(overflows || expanded) && <button type="button" className="mt-0.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
      aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "less" : "more ..."}</button>}
  </div>;
}

/**
 * Pure presentation for XSLT-provided RDF values. No RDF or SPARQL logic here.
 * Children are the links/literals selected and formatted by the stylesheet.
 */
export function RecordValuePages({
  children,
  pageSize = 5,
  className = "",
  layout = "stack",
  id,
}: {
  children?: React.ReactNode;
  pageSize?: number;
  className?: string;
  layout?: "stack" | "wrap";
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
      <div className={layout === "wrap" ? "min-w-0 leading-8" : "flex min-w-0 flex-col gap-1.5"}>
        {values.slice(start, start + size).map((value, i) => (
          layout === "wrap" ? (
            <span className="inline-block max-w-full align-baseline mr-1.5" key={(value as React.ReactElement).key ?? start + i}>
              {value}
            </span>
          ) : (
            <ClampedRecordValue key={(value as React.ReactElement).key ?? start + i}>
              {value}
            </ClampedRecordValue>
          )
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
