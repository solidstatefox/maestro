"use client";

import type { ReactElement } from "react";
import { LoadingLabel } from "./kit/loading-label";
import type { ChartLoadingLabelProps } from "./core/types/loading";

/** A shimmering label centered over a chart while it loads. Set `exiting` to animate it away when loading finishes. */
const ChartLoadingLabel = ({ text = "Loading", className, exiting = false }: Readonly<ChartLoadingLabelProps>): ReactElement | null => (
  <LoadingLabel text={text} className={className} exiting={exiting} />
);

export { ChartLoadingLabel };
