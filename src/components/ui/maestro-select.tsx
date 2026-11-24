"use client";

import * as React from "react";
import { cn } from "cn";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * One shadcn/Radix dropdown surface for legacy Maestro option lists.
 * The adapter accepts the existing <option> declarations but renders ONLY
 * Radix SelectItem elements, never a hidden or duplicate native <select>.
 *
 * The legacy callbacks use just event.target.value/currentTarget.value;
 * those are explicit value-only objects here, not fabricated DOM Events.
 */
type ValueChange = Readonly<{
  target: Readonly<{ value: string }>;
  currentTarget: Readonly<{ value: string }>;
}>;

type Props = {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (change: ValueChange) => void;
  children: React.ReactNode;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  title?: string;
  "aria-label"?: string;
  "aria-busy"?: boolean | "true" | "false";
};

const EMPTY_OPTION = "__maestro_radix_empty_option__";

type Choice = { value: string; label: React.ReactNode; disabled: boolean };

function choicesFromOptions(children: React.ReactNode): Choice[] {
  const items: Choice[] = [];
  const visit = (nodes: React.ReactNode) => {
    for (const child of React.Children.toArray(nodes)) {
      if (!React.isValidElement(child)) continue;
      if (child.type === React.Fragment) {
        visit((child.props as { children?: React.ReactNode }).children);
      } else if (child.type === "option") {
        const props = child.props as { value?: string | number; disabled?: boolean; children?: React.ReactNode };
        const raw = props.value === undefined ? String(props.children ?? "") : String(props.value);
        items.push({ value: raw, label: props.children, disabled: Boolean(props.disabled) });
      }
    }
  };
  visit(children);
  return items;
}

export function MaestroSelect({ value, defaultValue, onChange, children, id, name, disabled,
  required, className = "", title, "aria-label": ariaLabel, "aria-busy": ariaBusy }: Props) {
  const choices = React.useMemo(() => choicesFromOptions(children), [children]);
  const toSelectValue = (raw: string | number) => String(raw) === "" ? EMPTY_OPTION : String(raw);
  return <Select
    {...(value !== undefined ? { value: toSelectValue(value) } : {})}
    {...(defaultValue !== undefined ? { defaultValue: toSelectValue(defaultValue) } : {})}
    name={name} required={required} disabled={disabled}
    onValueChange={(next) => {
      const selected = next === EMPTY_OPTION ? "" : next;
      const change: ValueChange = { target: { value: selected }, currentTarget: { value: selected } };
      onChange?.(change);
    }}>
    <SelectTrigger id={id} title={title} aria-label={ariaLabel} aria-busy={ariaBusy}
      className={cn("h-8 w-auto min-w-[4.5rem] rounded-md border border-input bg-background px-2 text-xs", className)}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {choices.map((choice, i) => <SelectItem key={`${choice.value}-${i}`}
        value={toSelectValue(choice.value)} disabled={choice.disabled}>{choice.label}</SelectItem>)}
    </SelectContent>
  </Select>;
}
