import { createElement, Fragment } from "react";
import type { ReactNode } from "react";
import type { MarkupChild, MarkupEvent, MarkupNode, MarkupTree } from "../core/markup/node";
import { toCamel } from "../core/style";

/** Markup names React spells its own way; any other dashed name (not `data-*` / `aria-*`) is camel-cased (`stroke-width` → `strokeWidth`). */
const REACT_NAMES: Readonly<Record<string, string>> = { class: "className", "xlink:href": "xlinkHref" };
const DASHED = /-([a-z])/g;
const EVENT_PROPS: readonly (readonly [MarkupEvent, string])[] = [["animationend", "onAnimationEnd"], ["animationiteration", "onAnimationIteration"]];

const propName = (name: string): string => {
  const own = REACT_NAMES[name];
  if (own !== undefined) {
    return own;
  }
  return name.startsWith("data-") || name.startsWith("aria-") ? name : name.replaceAll(DASHED, (_dash, letter: string) => letter.toUpperCase());
};

const propsOf = (node: MarkupNode): Record<string, unknown> => {
  const props: Record<string, unknown> = {};
  if (node.key !== undefined) {
    props.key = node.key;
  }
  const style = node.style === undefined ? undefined : toCamel(node.style);
  let styled = style === undefined;
  for (const [name, value] of Object.entries(node.attrs)) {
    if (!styled && name === node.styleBefore) {
      props.style = style;
      styled = true;
    }
    if (value !== undefined) {
      props[propName(name)] = value;
    }
  }
  if (!styled) {
    props.style = style;
  }
  for (const [event, prop] of EVENT_PROPS) {
    const listener = node.on?.[event];
    if (listener !== undefined) {
      props[prop] = listener;
    }
  }
  return props;
};

// Children go in as arguments, not one array: positions and keys reconcile as the JSX's did, with no key warning for static children.
const renderChild = (child: MarkupChild, slot: ReactNode): ReactNode => {
  if (child === null || typeof child === "string") {
    return child;
  }
  if (!("tag" in child)) {
    return slot;
  }
  return createElement(child.tag, propsOf(child), ...child.children.map((grandchild) => renderChild(grandchild, slot)));
};

// Array.isArray narrows to any[]; this keeps the element type.
const isChildList = (tree: MarkupTree): tree is readonly MarkupChild[] => Array.isArray(tree);

/** A tree (or a list of them, as a fragment) as React elements; `slot` goes where the tree has the core's `MARKUP_SLOT`. */
export const renderMarkup = (tree: MarkupTree, slot?: ReactNode): ReactNode =>
  isChildList(tree) ? createElement(Fragment, null, ...tree.map((child) => renderChild(child, slot))) : renderChild(tree, slot);
