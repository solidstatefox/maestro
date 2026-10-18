import type { HTMLAttributes } from "react";

/** Small shadcn-style joined control group. Child buttons remain native, accessible buttons. */
export function ButtonGroup({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role={props.role ?? "group"}
      className={`inline-flex min-w-0 overflow-hidden rounded-md border border-input bg-background [&>*+*]:border-l [&>*+*]:border-input [&>button]:rounded-none [&>button]:border-0 [&>button]:shadow-none ${className}`}
      {...props}
    />
  );
}
