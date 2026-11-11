import * as React from "react";

import { cn } from "@/lib/utils";

/** shadcn/base-style animated content placeholder. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("animate-pulse rounded-md bg-accent", className)} {...props} />;
}

export { Skeleton };
