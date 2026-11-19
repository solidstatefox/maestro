import { cssText } from "../style";
import type { StyleObject } from "../style";

/**
 * An attribute's value; `undefined` leaves the attribute out. A boolean is written as React DOM writes one (`markupAttrValue`): on
 * `aria-*` and `data-*` as its word, on an HTML boolean attribute (`hidden`) present and empty when true, left out when false.
 */
export type MarkupAttrValue = string | number | boolean | undefined;

/** Attributes by their name in markup (`class`, `stroke-width`, `viewBox`), in the order they're written. */
export type MarkupAttrs = Readonly<Record<string, MarkupAttrValue>>;

/** The DOM events a tree listens to (React: `onAnimationEnd`, `onAnimationIteration`). */
export type MarkupEvent = "animationend" | "animationiteration";

/** Where a framework puts its own children in a tree (a resource host's reader `<pattern>`s); `markupToString` writes nothing there. */
export const MARKUP_SLOT = { slot: "children" } as const;

/** A tree's child: an element, text, nothing (keeps a conditional child's place, as `null` does in JSX) or the framework's children. */
export type MarkupChild = MarkupNode | string | null | typeof MARKUP_SLOT;

/** What a tree builder returns: one child or a list of them (a fragment). */
export type MarkupTree = MarkupChild | readonly MarkupChild[];

/** An element of a tree. */
export interface MarkupNode {
  readonly tag: string;
  readonly attrs: MarkupAttrs;
  readonly style?: StyleObject;
  /**
   * The attribute `style` is written before (default: after them all). React writes props in order, so a node keeps the place its style had
   * in the JSX it replaced and the server markup stays the same.
   */
  readonly styleBefore?: string;
  /** Identity among its siblings: a new key remounts the element (restarting its CSS animation), as a React key does. */
  readonly key?: string | number;
  /** Listeners by event; a renderer may hand one the event (React does), so a tree wraps a reader's callback that must not see it. */
  readonly on?: Readonly<Partial<Record<MarkupEvent, (() => void) | undefined>>>;
  readonly children: readonly MarkupChild[];
}

interface NodeExtras {
  readonly style?: StyleObject;
  readonly styleBefore?: string;
  readonly key?: string | number;
  readonly on?: MarkupNode["on"];
}

/** An element: `el("rect", { width: 4 }, [], { style })`. */
export const el = (tag: string, attrs: MarkupAttrs, children: readonly MarkupChild[] = [], extras: NodeExtras = {}): MarkupNode => ({ tag, attrs, children, ...extras });

/** React's server escaping (react-dom-server escapeTextForBrowser), for text and attribute values alike. */
const ESCAPES: Readonly<Record<string, string>> = { '"': "&quot;", "&": "&amp;", "'": "&#x27;", "<": "&lt;", ">": "&gt;" };
const ESCAPED = /["&'<>]/g;
const escape = (text: string): string => text.replaceAll(ESCAPED, (char) => ESCAPES[char] ?? char);

/** A `<style>`'s text is raw; React's server only breaks a `</style` inside it (react-dom-server styleRegex). */
const STYLE_CLOSE = /(<\/|<)(s)(tyle)/gi;
export const rawStyleText = (text: string): string => text.replaceAll(STYLE_CLOSE, (_match, open: string, s: string, rest: string) => `${open}${s === "s" ? "\\73 " : "\\53 "}${rest}`);

/** An attribute's value as markup writes it, `undefined` when it's left out (a boolean as `MarkupAttrValue` says). */
export const markupAttrValue = (name: string, value: MarkupAttrValue): string | number | undefined => {
  if (typeof value !== "boolean") {
    return value;
  }
  if (name.startsWith("aria-") || name.startsWith("data-")) {
    return String(value);
  }
  return value ? "" : undefined;
};

// Array.isArray narrows to any[]; this keeps the element type.
const isChildList = (tree: MarkupTree): tree is readonly MarkupChild[] => Array.isArray(tree);

const isNode = (child: MarkupChild): child is MarkupNode => child !== null && typeof child === "object" && "tag" in child;

const styleAttr = (node: MarkupNode): string => {
  const text = node.style === undefined ? "" : cssText(node.style);
  return text === "" ? "" : ` style="${escape(text)}"`;
};

/** The markup written so far, split at each slot: the last piece grows. */
type Pieces = string[];

const write = (pieces: Pieces, text: string): void => {
  pieces[pieces.length - 1] += text;
};

const writeNode = (pieces: Pieces, node: MarkupNode): void => {
  let attrs = "";
  let styled = false;
  for (const [name, value] of Object.entries(node.attrs)) {
    if (name === node.styleBefore) {
      attrs += styleAttr(node);
      styled = true;
    }
    const written = markupAttrValue(name, value);
    if (written !== undefined) {
      attrs += ` ${name}="${escape(String(written))}"`;
    }
  }
  if (!styled) {
    attrs += styleAttr(node);
  }
  write(pieces, `<${node.tag}${attrs}>`);
  for (const child of node.children) {
    if (node.tag === "style" && typeof child === "string") {
      write(pieces, rawStyleText(child));
    } else {
      writeChild(pieces, child);
    }
  }
  write(pieces, `</${node.tag}>`);
};

const writeChild = (pieces: Pieces, child: MarkupChild): void => {
  if (isNode(child)) {
    writeNode(pieces, child);
  } else if (typeof child === "string") {
    write(pieces, escape(child));
  } else if (child !== null) {
    // The slot: the framework's children go between this piece and the next.
    pieces.push("");
  }
};

/**
 * The tree's markup split at its slots, one more piece than it has slots: a framework that writes its server markup as text places its
 * own children between them (Solid: kit/solid/runtime/markup.ts).
 */
export const markupPieces = (tree: MarkupTree): string[] => {
  const pieces: Pieces = [""];
  for (const child of isChildList(tree) ? tree : [tree]) {
    writeChild(pieces, child);
  }
  return pieces;
};

/** The tree as markup, written as React's `renderToStaticMarkup` writes the elements it replaced (an element always gets its closing tag). */
export const markupToString = (tree: MarkupTree): string => markupPieces(tree).join("");
