import { Progress as ProgressPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

type ProgressProps = ComponentProps<typeof ProgressPrimitive.Root> & {
  indeterminate?: boolean;
};

/** shadcn/ui Progress wrapper with a visible indeterminate state for initial loading. */
export function Progress({
  className = "",
  value = 0,
  max = 100,
  indeterminate = false,
  ...props
}: ProgressProps) {
  const percentage = max > 0 ? Math.min(100, Math.max(0, ((value ?? 0) / max) * 100)) : 0;
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      max={max}
      className={`relative h-2 w-full overflow-hidden rounded-full bg-slate-300/70 dark:bg-slate-700 ${className}`}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={`h-full bg-primary transition-all ${indeterminate ? "w-[38%] animate-pulse" : "w-full"}`}
        style={{ transform: indeterminate ? "translateX(0)" : `translateX(-${100 - percentage}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
