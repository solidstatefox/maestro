import type { CSSProperties } from "react";
import type {
  AreaSparklineProps as CoreAreaSparklineProps,
  BarSparklineProps as CoreBarSparklineProps,
  LineSparklineProps as CoreLineSparklineProps,
  SparklineBaseProps as CoreSparklineBaseProps,
} from "../core/types/sparkline";

/** Props every sparkline takes. */
export interface SparklineBaseProps<T> extends CoreSparklineBaseProps<T, CSSProperties> {}
/** Props for `LineSparkline`. */
export interface LineSparklineProps<T> extends CoreLineSparklineProps<T, CSSProperties> {}
/** Props for `AreaSparkline`. */
export interface AreaSparklineProps<T> extends CoreAreaSparklineProps<T, CSSProperties> {}
/** Props for `BarSparkline`. */
export interface BarSparklineProps<T> extends CoreBarSparklineProps<T, CSSProperties> {}
