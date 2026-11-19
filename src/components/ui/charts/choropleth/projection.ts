import { Children, cloneElement, isValidElement } from "react";
import type { ReactNode } from "react";
import { isNumber, isString } from "../core/guards";

interface PatternProps {
  readonly id?: string;
  readonly children?: ReactNode;
}

const scopePatterns = (node: ReactNode, prefix: string): ReactNode =>
  Children.map(node, (child) => {
    if (!isValidElement<PatternProps>(child)) {
      return isString(child) || isNumber(child) ? child : null;
    }
    const next = isString(child.props.id) ? { id: prefix + child.props.id } : {};
    // oxlint-disable-next-line react/no-clone-element -- caller-owned pattern elements need their ids scoped per chart instance
    return child.props.children === undefined ? cloneElement(child, next) : cloneElement(child, next, scopePatterns(child.props.children, prefix));
  });

export { scopePatterns };
