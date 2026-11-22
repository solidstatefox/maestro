"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  maxPageSize = 100,
  pageSizeSelect = false,
  listTag = "div",
  listClassName = "",
  className = "",
  layout = "stack",
  id,
}: {
  children?: React.ReactNode;
  pageSize?: number;
  maxPageSize?: number;
  /** Opt-in selector for provider-managed lists (e.g. EURIO Project Results). */
  pageSizeSelect?: boolean;
  /** Render an actual ordered list for provider-authored <li> children. */
  listTag?: "div" | "ol";
  listClassName?: string;
  className?: string;
  layout?: "stack" | "wrap" | "groups";
  id?: string;
}) {
  const values = React.Children.toArray(children).filter(React.isValidElement);
  const cap = Number.isFinite(maxPageSize) ? Math.max(1, Math.min(100, Math.floor(maxPageSize))) : 100;
  const initialSize = Number.isFinite(pageSize) ? Math.max(1, Math.min(cap, Math.floor(pageSize))) : 5;
  // Preserve the original controlled-by-prop behavior for every existing
  // RecordValuePages caller. Only opt-in lists own a mutable page size.
  const [chosenSize, setChosenSize] = React.useState<number | null>(null);
  const size = pageSizeSelect && chosenSize !== null ? Math.max(1, Math.min(cap, chosenSize)) : initialSize;
  const pages = Math.max(1, Math.ceil(values.length / size));
  const [page, setPage] = React.useState(0);
  const current = Math.min(page, pages - 1);
  const start = current * size;
  const isResultList = listTag === "ol";
  const ListContainer = isResultList ? "ol" : "div";
  const choices = [5, 10, 20].filter((choice) => choice <= cap);
  if (!choices.includes(size)) choices.unshift(size);
  const setSelectedSize = (value: number) => {
    if (!Number.isFinite(value)) return;
    const selected = Math.max(1, Math.min(cap, Math.floor(value)));
    setPage(Math.floor(start / selected)); // Keep the first visible result in view.
    setChosenSize(selected);
  };
  return (
    <div id={id} className={`min-w-0 ${className}`}>
      <ListContainer className={listClassName || (layout === "wrap" ? "min-w-0 leading-8" : "flex min-w-0 flex-col gap-1.5")}>
        {values.slice(start, start + size).map((value, i) => (
          layout === "groups" || isResultList ? (
            // <ol> must contain <li> directly. Wrapping a Result in the
            // generic ClampedRecordValue <div> breaks native list semantics.
            <React.Fragment key={(value as React.ReactElement).key ?? start + i}>{value}</React.Fragment>
          ) : layout === "wrap" ? (
            <span className="inline-block max-w-full align-baseline mr-1.5" key={(value as React.ReactElement).key ?? start + i}>
              {value}
            </span>
          ) : (
            <ClampedRecordValue key={(value as React.ReactElement).key ?? start + i}>
              {value}
            </ClampedRecordValue>
          )
        ))}
      </ListContainer>
      {pages > 1 && (
        <nav aria-label={isResultList ? "Results pagination" : "Property values pagination"}
          className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
          <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {values.length ? start + 1 : 0}–{Math.min(start + size, values.length)} of {values.length}
          </span>
          {/* Exactly the same Per page / shadcn Button paginator used by
              Bookmarks and History Perspectives. Not a provider-specific dropdown. */}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {pageSizeSelect && <>
              <label htmlFor={`${id ?? "record"}-page-size`} className="whitespace-nowrap text-xs text-muted-foreground">Per page</label>
              <select id={`${id ?? "record"}-page-size`} aria-label="Results per page" value={size}
                onChange={(event) => setSelectedSize(Number(event.currentTarget.value))}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs">
                {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
              </select>
            </>}
            <Button type="button" variant="outline" size="icon-sm"
              aria-label={isResultList ? "Previous results" : "Previous property values"}
              disabled={current === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <span className="min-w-[5.5rem] whitespace-nowrap text-center text-xs text-muted-foreground" aria-live="polite">
              Page {current + 1} of {pages}
            </span>
            <Button type="button" variant="outline" size="icon-sm"
              aria-label={isResultList ? "Next results" : "Next property values"}
              disabled={current >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
