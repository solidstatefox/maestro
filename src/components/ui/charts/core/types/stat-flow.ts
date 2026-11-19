export interface ChartStatFlowFormat {
  /** `"standard"` writes the full number, `"compact"` abbreviates it (1.2K). */
  notation?: "standard" | "compact";
  /** Whether compact notation uses short (`K`) or long (`thousand`) forms. */
  compactDisplay?: "short" | "long";
  /** Fewest digits after the decimal point. */
  minimumFractionDigits?: number;
  /** Most digits after the decimal point. */
  maximumFractionDigits?: number;
  /** Fewest digits before the decimal point; shorter numbers are zero-padded. */
  minimumIntegerDigits?: number;
  /** Fewest significant digits. */
  minimumSignificantDigits?: number;
  /** Most significant digits. */
  maximumSignificantDigits?: number;
  /** `"decimal"`, `"percent"` or `"currency"`. */
  style?: "decimal" | "percent" | "currency";
  /** ISO 4217 currency code, for example `"USD"`. Required when `style` is `"currency"`. */
  currency?: string;
  /** How the currency is written: `"symbol"`, `"narrowSymbol"`, `"code"` or `"name"`. */
  currencyDisplay?: "symbol" | "narrowSymbol" | "code" | "name";
  /** Unit identifier, for example `"kilometer"`. */
  unit?: string;
  /** How the unit is written: `"short"`, `"long"` or `"narrow"`. */
  unitDisplay?: "short" | "long" | "narrow";
}

/** Props of `ChartStatFlow`. */
export interface ChartStatFlowProps<Node> {
  /** The number to show. */
  value: number;
  /** Caption shown below the number. */
  label: string;
  /**
   * How the number is formatted.
   * @default { notation: "standard", maximumFractionDigits: 0 }
   */
  formatOptions?: ChartStatFlowFormat;
  /** Text placed before the number, for example `"$"`. */
  prefix?: string;
  /** Text placed after the number, for example `"%"`. */
  suffix?: string;
  /** Class names that replace the default number style. */
  valueClassName?: string;
  /** Class names that replace the default label style. */
  labelClassName?: string;
  /** Icon shown in a circle above the number. */
  icon?: Node;
}
