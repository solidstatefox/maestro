/**
 * Numeric facet presentation only. Raw RDF lexical forms, datatypes, filter
 * bindings, query hashes and SPARQL ranges must never use these labels.
 * Uses ECMAScript Intl/Unicode CLDR number data rather than an English-only
 * table of ad-hoc K/M/B suffixes.
 */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function isNumericFacetLexical(value: string): boolean {
  return DECIMAL.test(value.trim());
}

function decimalParts(lexical: string): { negative: boolean; digits: string; power: number; order: number } | null {
  const value = lexical.trim();
  if (!isNumericFacetLexical(value)) return null;
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  const [coefficient, exponent = "0"] = unsigned.toLowerCase().split("e");
  const point = coefficient.indexOf(".");
  const fractional = point < 0 ? 0 : coefficient.length - point - 1;
  const digits = coefficient.replace(".", "").replace(/^0+/, "") || "0";
  const power = Number(exponent) - fractional;
  // Avoid constructing absurdly long decimals from a malicious endpoint.
  if (!Number.isSafeInteger(power) || Math.abs(power) > 100000) return null;
  return { negative, digits, power, order: digits === "0" ? 0 : digits.length + power - 1 };
}

/** Render a lexical decimal without exponential notation, when reasonably sized. */
export function expandNumericFacetLexical(lexical: string): string {
  const parts = decimalParts(lexical);
  if (!parts) return lexical;
  const { negative, digits, power } = parts;
  if (digits === "0") return negative ? "-0" : "0";
  const point = digits.length + power;
  if (point > 150 || point < -110) return lexical;
  const plain = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? `${digits}${"0".repeat(point - digits.length)}`
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return `${negative ? "-" : ""}${plain}`;
}

function present(lexical: string, significantDigits: number, locale: string): string {
  const p = decimalParts(lexical);
  if (!p) return lexical;
  const value = Number(lexical.trim());
  if (p.digits === "0") return value < 0 || p.negative ? "-0" : "0";
  const absOrder = p.order;
  const options: Intl.NumberFormatOptions = {
    maximumSignificantDigits: significantDigits, useGrouping: true,
  };
  const english = /^en(?:-|$)/i.test(locale);
  // CLDR compact-long provides localized thousands/millions/billions etc.
  // Do not apply compact abbreviations to tiny values: the locale might show 0.
  if (Number.isFinite(value) && Math.abs(value) >= 1000 && absOrder < 21) {
    return new Intl.NumberFormat(locale, {
      ...options, notation: "compact", compactDisplay: "short",
    }).format(value);
  }
  if (Number.isFinite(value) && Math.abs(value) >= 1e-6 && absOrder < 21) {
    return new Intl.NumberFormat(locale, options).format(value);
  }
  // For small numbers, retain a decimal rather than a reciprocal unit name.
  // Significant digits are limited so long repeating zeros do not overwhelm a row.
  if (Number.isFinite(value) && absOrder >= -24 && absOrder < -6) {
    return new Intl.NumberFormat(locale, { ...options, maximumFractionDigits: Math.min(30, -absOrder + significantDigits) }).format(value);
  }
  // Huge numbers beyond JS Number's finite range or CLDR's standard compact
  // bands: derive magnitude from the lexical decimal, never Number(lexical).
  if (english && (absOrder >= 21 || absOrder < -24)) {
    const group = Math.floor(absOrder / 3);
    const name = group >= 0 ? ({1:"K",2:"M",3:"B",4:"T",5:"Q",6:"Qi",7:"Sx",8:"Sp"} as Record<number,string>)[group] : undefined;
    if (name) {
      const first = p.digits.slice(0, significantDigits);
      const scaledPower = p.order - group * 3;
      const number = Number(`${first[0]}.${first.slice(1) || "0"}`) * 10 ** scaledPower;
      const numberText = new Intl.NumberFormat(locale, options).format(number);
      return `${p.negative ? "−" : ""}${numberText}${name}`;
    }
  }
  // Beyond the locale's compact prefixes, display a short power-of-ten marker.
  const prefix = `${p.negative ? "−" : ""}${p.digits[0]}${p.digits.length > 1 ? `.${p.digits.slice(1, significantDigits)}` : ""}`;
  return `${prefix} ×10^${p.order}`;
}

/**
 * Resolve rounding collisions among the facet choices, without changing the
 * query values. Additional digits are shown only where needed; exact lexical
 * values remain available in the normal shadcn tooltip.
 */
export function formatNumericFacetLabels(values: readonly string[], locale = "en-US"): string[] {
  const labels = values.map(value => isNumericFacetLexical(value) ? present(value, 6, locale) : value);
  for (let i = 0; i < values.length; i++) {
    if (!isNumericFacetLexical(values[i])) continue;
    let precision = 6;
    while (precision < 17 && values.some((other, j) => j !== i && other !== values[i] &&
      isNumericFacetLexical(other) && present(other, precision, locale) === present(values[i], precision, locale))) {
      precision++;
    }
    labels[i] = present(values[i], precision, locale);
    if (precision === 17 && values.some((other, j) => j !== i && other !== values[i] &&
      isNumericFacetLexical(other) && present(other, precision, locale) === labels[i])) {
      labels[i] = expandNumericFacetLexical(values[i]);
    }
  }
  return labels;
}
