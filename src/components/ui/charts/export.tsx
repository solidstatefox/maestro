"use client";

import { useState } from "react";
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import { cn } from "./core/cn";
import { EXPORT_BUTTON_CLASS, EXPORT_ICON, exportButtonAttrs, exportButtonText, runExportButton } from "./core/export/button";
import type { ChartExportButtonOptions } from "./core/export/button";
import { createChartExporter } from "./core/export/exporter";
import type { ChartExporter } from "./core/types/export";
import { renderMarkup } from "./runtime/markup";

export { createChartExporter } from "./core/export/exporter";

/**
 * A chart exporter: bind `ref` to an element holding the chart (its card's content, a wrapper), then save or read it.
 *
 * ```tsx
 * const exporter = useChartExport();
 * <CardContent ref={exporter.ref}><LineChart … /></CardContent>
 * <Button onClick={() => exporter.download("revenue.png")}>Download</Button>
 * ```
 */
export function useChartExport(): ChartExporter {
  const [exporter] = useState(createChartExporter);
  return exporter;
}

/** Props for `ChartExportButton`: the export's options, and a button's own (its label as `children`). */
export interface ChartExportButtonProps extends ChartExportButtonOptions, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children"> {
  /** The button's label: a download icon and the format by default. */
  readonly children?: ReactNode;
}

const DEFAULT_ICON = /* @__PURE__ */ renderMarkup(EXPORT_ICON);

/** A button that saves the chart nearest it (its card's content), or its `exporter`'s, as a PNG or an SVG file. */
export function ChartExportButton({
  format = "png",
  filename,
  exporter,
  background,
  scale,
  embedFonts,
  settle,
  label,
  className,
  children,
  onClick,
  ...rest
}: ChartExportButtonProps): ReactElement {
  return (
    // oxlint-disable-next-line react/jsx-props-no-spreading -- a button's own attributes, forwarded
    <button
      {...rest}
      {...exportButtonAttrs(format, children !== undefined || rest["aria-label"] !== undefined)}
      className={cn(EXPORT_BUTTON_CLASS, className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          void runExportButton(event.currentTarget, { format, filename, exporter, background, scale, embedFonts, settle, label });
        }
      }}
    >
      {children ?? (
        <>
          {DEFAULT_ICON}
          {exportButtonText(format)}
        </>
      )}
    </button>
  );
}
