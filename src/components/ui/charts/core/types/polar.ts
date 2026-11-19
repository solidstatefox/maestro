export interface CenterStatFormat {
  /** `"standard"` or `"compact"` (1.2K). */
  readonly notation?: "standard" | "compact";
  /** `"short"` or `"long"` compact form; used with `notation: "compact"`. */
  readonly compactDisplay?: "short" | "long";
  /** Minimum number of fraction digits. */
  readonly minimumFractionDigits?: number;
  /** Maximum number of fraction digits. */
  readonly maximumFractionDigits?: number;
  /** Minimum number of integer digits. */
  readonly minimumIntegerDigits?: number;
  /** Minimum number of significant digits. */
  readonly minimumSignificantDigits?: number;
  /** Maximum number of significant digits. */
  readonly maximumSignificantDigits?: number;
  /** `"decimal"`, `"percent"` or `"currency"`. */
  readonly style?: "decimal" | "percent" | "currency";
  /** ISO 4217 currency code, for example `"USD"`; used with `style: "currency"`. */
  readonly currency?: string;
  /** How the currency is shown: symbol, code, name and so on. */
  readonly currencyDisplay?: Intl.NumberFormatOptions["currencyDisplay"];
  /** Unit identifier, for example `"kilometer"`. */
  readonly unit?: string;
  /** `"short"`, `"long"` or `"narrow"` unit form. */
  readonly unitDisplay?: "short" | "long" | "narrow";
}

export interface PolarHoverValue {
  /** Index of the hovered slice, ring or series, or `null` when nothing is hovered. */
  hoveredIndex: number | null;
  /** Sets the hovered index; pass `null` to clear hover. */
  readonly setHoveredIndex: (index: number | null) => void;
}
