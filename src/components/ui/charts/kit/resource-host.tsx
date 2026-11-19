import { Children, createElement, isValidElement } from "react";
import type { ReactNode } from "react";
import { isString } from "../core/guards";
import { MARKUP_SLOT } from "../core/markup/node";
import { resourceHost } from "../core/markup/resources";
import { isLocalRef, isNonEmptyString, scopedResourceId, scopedResourceRef } from "../core/resource-ids";
import { renderMarkup } from "../runtime/markup";

interface ResourceHostProps {
  readonly idPrefix: string;
  readonly resources: ReactNode;
}

// Renders consumer defs (patterns, masks, gradients) once per mount.
export const ResourceHost = ({ idPrefix, resources }: Readonly<ResourceHostProps>): ReactNode => {
  if (Children.toArray(resources).length === 0) {
    return null;
  }
  return renderMarkup(resourceHost(idPrefix, [MARKUP_SLOT]), resources);
};

interface ScopableProps {
  readonly id?: unknown;
  readonly href?: unknown;
  readonly xlinkHref?: unknown;
  readonly children?: ReactNode;
}

// Scopes a resources tree to the mount; definitions reference the scoped ids.
export const scopeResourceIds = (nodes: ReactNode, idPrefix: string): ReactNode =>
  Children.map(nodes, (node): ReactNode => {
    if (isValidElement<ScopableProps>(node)) {
      const { children, href, id, xlinkHref } = node.props;
      const scopedChildren = scopeResourceIds(children, idPrefix);
      const nextId = isNonEmptyString(id) ? scopedResourceId(idPrefix, id) : undefined;
      const nextHref = isLocalRef(href) ? scopedResourceRef(idPrefix, href) : undefined;
      const nextXlinkHref = isLocalRef(xlinkHref) ? scopedResourceRef(idPrefix, xlinkHref) : undefined;
      const unchanged = nextId === undefined && nextHref === undefined && nextXlinkHref === undefined && scopedChildren === children;
      if (unchanged) {return node;}
      return createElement(node.type, {
        ...node.props,
        ...(nextId === undefined ? undefined : { id: nextId }),
        ...(nextHref === undefined ? undefined : { href: nextHref }),
        ...(nextXlinkHref === undefined ? undefined : { xlinkHref: nextXlinkHref }),
        ...(scopedChildren === children ? undefined : { children: scopedChildren }),
        key: node.key ?? undefined,
      });
    }
    return node;
  });

interface PatternProps {
  readonly patternTransform?: unknown;
  readonly children?: ReactNode;
}

// Moves every <pattern> tile origin by (dx, dy) at render time, keeping the consumer's own patternTransform after the shift.
export const translatePatterns = (nodes: ReactNode, dx: number, dy: number): ReactNode =>
  Children.map(nodes, (node): ReactNode => {
    if (!isValidElement<PatternProps>(node)) {
      return node;
    }
    if (node.type === "pattern") {
      const own = isString(node.props.patternTransform) ? node.props.patternTransform : "";
      return createElement(node.type, { ...node.props, patternTransform: `translate(${dx} ${dy}) ${own}`.trim() });
    }
    const { children } = node.props;
    const shifted = translatePatterns(children, dx, dy);
    return shifted === children ? node : createElement(node.type, { ...node.props, key: node.key ?? undefined }, shifted);
  });
