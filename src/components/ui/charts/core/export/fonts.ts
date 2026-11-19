export interface UsedFont {
  readonly family: string;
  readonly weight: string;
  readonly style: string;
  readonly text: string;
}

interface FaceUse {
  readonly weights: Set<number>;
  readonly styles: Set<string>;
  readonly codePoints: Set<number>;
}

const QUOTES = /^["']|["']$/g;
const WEIGHT_WORDS: Readonly<Record<string, number>> = { normal: 400, bold: 700, lighter: 300, bolder: 700 };
const URL_SRC = /url\(\s*(["']?)([^"')]+)\1\s*\)\s*(?:format\(\s*["']?([\w-]+)["']?\s*\))?/g;
const MIME: Readonly<Record<string, string>> = {
  woff2: "font/woff2",
  woff: "font/woff",
  truetype: "font/ttf",
  ttf: "font/ttf",
  opentype: "font/otf",
  otf: "font/otf",
};

const familyName = (name: string): string => name.trim().replace(QUOTES, "").toLowerCase();

const weightOf = (weight: string): number => WEIGHT_WORDS[weight] ?? (Number.parseFloat(weight) || 400);

/** Each family of the stacks the texts use, with the weights, styles and characters set in it. */
const usesOf = (fonts: readonly UsedFont[]): Map<string, FaceUse> => {
  const uses = new Map<string, FaceUse>();
  for (const font of fonts) {
    for (const family of font.family.split(",")) {
      const name = familyName(family);
      let use = uses.get(name);
      if (use === undefined) {
        use = { weights: new Set(), styles: new Set(), codePoints: new Set() };
        uses.set(name, use);
      }
      use.weights.add(weightOf(font.weight));
      use.styles.add(font.style === "normal" ? "normal" : "italic");
      for (const char of font.text) {
        use.codePoints.add(char.codePointAt(0) ?? 0);
      }
    }
  }
  return uses;
};

/** Whether a rule's `font-weight` (one value or a variable font's range) takes one of the weights. */
const coversWeight = (descriptor: string, weights: Set<number>): boolean => {
  const parts = descriptor.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return weights.has(400);
  }
  const low = weightOf(parts[0] as string);
  const high = parts.length > 1 ? weightOf(parts[1] as string) : low;
  for (const weight of weights) {
    if (weight >= low && weight <= high) {
      return true;
    }
  }
  return false;
};

const coversStyle = (descriptor: string, styles: Set<string>): boolean => {
  const style = descriptor.trim() === "" || descriptor.trim() === "normal" ? "normal" : "italic";
  return styles.has(style);
};

/** Whether a rule's `unicode-range` (`U+0000-00FF, U+0131, U+1F??`) holds one of the characters. */
const coversRange = (descriptor: string, codePoints: Set<number>): boolean => {
  if (descriptor.trim() === "") {
    return true;
  }
  const ranges = descriptor.split(",").map((part) => {
    const range = part.trim().replace(/^u\+/i, "");
    if (range.includes("?")) {
      return [Number.parseInt(range.replaceAll("?", "0"), 16), Number.parseInt(range.replaceAll("?", "F"), 16)] as const;
    }
    const [from = "0", to = from] = range.split("-");
    return [Number.parseInt(from, 16), Number.parseInt(to, 16)] as const;
  });
  for (const point of codePoints) {
    if (ranges.some(([from, to]) => point >= from && point <= to)) {
      return true;
    }
  }
  return false;
};

/** Every `@font-face` rule the document's stylesheets hold (in `@media`, `@supports`, `@layer` and imported sheets too). */
const faceRules = (doc: Document): CSSFontFaceRule[] => {
  const found: CSSFontFaceRule[] = [];
  const visit = (rules: CSSRuleList | undefined): void => {
    if (rules === undefined) {
      return;
    }
    for (const rule of rules) {
      // By its text, not `instanceof`: a framed chart's rules are its frame's window's classes.
      if (rule.cssText.startsWith("@font-face")) {
        found.push(rule as CSSFontFaceRule);
        continue;
      }
      if ("cssRules" in rule) {
        visit((rule as CSSGroupingRule).cssRules);
      }
      if ("styleSheet" in rule) {
        visit(readRules((rule as CSSImportRule).styleSheet));
      }
    }
  };
  for (const sheet of doc.styleSheets) {
    visit(readRules(sheet));
  }
  return found;
};

/** A stylesheet's rules, or none when another origin serves it without CORS. */
const readRules = (sheet: CSSStyleSheet | null): CSSRuleList | undefined => {
  try {
    return sheet?.cssRules;
  } catch {
    return undefined;
  }
};

let fetched: Map<string, Promise<string | null>> | undefined;

const base64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  }
  return btoa(binary);
};

/** A font file as a data URL (once per URL for the page's life), `null` when it can't be fetched. */
const dataUrl = (url: string, format: string | undefined): Promise<string | null> => {
  if (url.startsWith("data:")) {
    return Promise.resolve(url);
  }
  fetched ??= new Map();
  let pending = fetched.get(url);
  if (pending === undefined) {
    const extension = /\.(\w+)(?:[?#].*)?$/.exec(url)?.[1]?.toLowerCase();
    const mime = MIME[format ?? ""] ?? MIME[extension ?? ""] ?? "font/woff2";
    pending = fetch(url)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((buffer) => (buffer === null ? null : `data:${mime};base64,${base64(new Uint8Array(buffer))}`))
      .catch(() => null);
    fetched.set(url, pending);
  }
  return pending;
};

const quote = (text: string): string => `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/** The `@font-face` rules the texts use, their fonts embedded, as a stylesheet's text (`""` when none applies). */
export async function embeddedFontFaces(doc: Document, fonts: readonly UsedFont[]): Promise<string> {
  const uses = usesOf(fonts);
  const faces: Promise<string | null>[] = [];
  for (const rule of faceRules(doc)) {
    const family = familyName(rule.style.getPropertyValue("font-family"));
    const use = uses.get(family);
    if (
      use === undefined ||
      !coversWeight(rule.style.getPropertyValue("font-weight"), use.weights) ||
      !coversStyle(rule.style.getPropertyValue("font-style"), use.styles) ||
      !coversRange(rule.style.getPropertyValue("unicode-range"), use.codePoints)
    ) {
      continue;
    }
    const src = rule.style.getPropertyValue("src");
    const first = [...src.matchAll(URL_SRC)][0];
    if (first === undefined) {
      continue;
    }
    const base = rule.parentStyleSheet?.href ?? doc.baseURI;
    let url: string;
    try {
      url = first[2]?.startsWith("data:") === true ? (first[2] as string) : new URL(first[2] as string, base).href;
    } catch {
      continue;
    }
    const format = first[3];
    const descriptors = ["font-weight", "font-style", "font-stretch", "unicode-range", "font-feature-settings", "ascent-override", "descent-override", "line-gap-override"]
      .map((name) => [name, rule.style.getPropertyValue(name)] as const)
      .filter(([, value]) => value !== "")
      .map(([name, value]) => `${name}:${value};`)
      .join("");
    faces.push(
      dataUrl(url, format).then((data) =>
        data === null ? null : `@font-face{font-family:${quote(rule.style.getPropertyValue("font-family").replace(QUOTES, ""))};src:url(${data})${format === undefined ? "" : ` format(${quote(format)})`};${descriptors}font-display:block;}`,
      ),
    );
  }
  const written = await Promise.all(faces);
  return written.filter((face): face is string => face !== null).join("\n");
}
