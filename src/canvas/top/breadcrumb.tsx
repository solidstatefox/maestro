"use client";

import type { ReactNode } from "react";
import type { FctQueryNode } from "@/lib/fct-query-api";
import { ChevronsRightLeft, Regex, EqualApproximately, ChevronRight, ChevronLeft, Equal } from "lucide-react";

  /** Operator icon shared by breadcrumb bindings, menus, and Query Tree bindings. */
export function renderValueOperator(value: FctQueryNode, sizeClass = "size-3.5"): ReactNode {
    const op = (value.attributes.op ?? "=").trim().toLowerCase();
    const iconClass = `${sizeClass} shrink-0 self-center text-muted-foreground`;
    if (value.attributes.rangeStart !== undefined || value.attributes.rangeEnd !== undefined) {
      return <ChevronsRightLeft className={iconClass} aria-label="inclusive range" />;
    }
    if (op === "regex") return <Regex className={iconClass} aria-label="regular expression" />;
    if (op === "contains") return <EqualApproximately className={iconClass} aria-label="contains" />;
    if (op === ">" || op === "gt") return <ChevronRight className={iconClass} aria-label="greater than" />;
    if (op === "<" || op === "lt") return <ChevronLeft className={iconClass} aria-label="less than" />;
    if ([">=", "gte", "<=", "lte"].includes(op)) {
      const Icon = op === ">=" || op === "gte" ? ChevronRight : ChevronLeft;
      return <span className="inline-flex shrink-0 items-center gap-0" aria-label={op === ">=" || op === "gte" ? "greater than or equal" : "less than or equal"}>
        <Icon className={iconClass} aria-hidden="true" />
        <Equal className={iconClass} aria-hidden="true" />
      </span>;
    }
    return <Equal className={iconClass} aria-label="equals" />;
  }

