"use client";

import { type ReactNode } from "react";
import { UI_COMPONENT } from "@/lib/maestro-ui-component-ids";
import { motion, useReducedMotion } from "motion/react";

/** Content-capable adaptation of SmoothUI Hover Expand's horizontal flex-panel pattern.
 * SmoothUI Hover Expand: Eduardo Calvo, MIT license.
 * The original gallery uses button panels; Maestro separates triggers from panels so
 * breadcrumbs, menus and other nested interactive controls remain accessible. */
export function MaestroHoverExpand({ active, onChange, panels }: {
  active: "trail" | "perspectives" | "features"; onChange: (value: "trail" | "perspectives" | "features") => void;
  panels: { id: "trail" | "perspectives" | "features"; label: string; content: ReactNode }[];
}) {
  const reducedMotion = useReducedMotion();
  return <div id={UI_COMPONENT.viewRibbon} className="flex h-24 min-w-0 shrink-0 overflow-hidden border-b bg-background" role="group" aria-label="View navigation">
    {panels.map((panel) => {
      const expanded = active === panel.id;
      return <motion.section key={panel.id} className={`flex min-w-0 overflow-hidden border-r last:border-r-0 ${expanded ? "flex-1" : "shrink-0"}`} initial={false}
        animate={{ width: expanded ? "auto" : 38 }}
        transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 35 }}>
        <button type="button" onClick={() => onChange(panel.id)} aria-expanded={expanded}
          aria-label={panel.label} className={`flex w-9 shrink-0 cursor-pointer items-center justify-center bg-muted/30 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground ${expanded ? "border-r" : ""}`}>
          <span className="[writing-mode:vertical-rl] rotate-180">{panel.label}</span>
        </button>
        <div className={`min-w-0 flex-1 overflow-x-auto overflow-y-hidden px-3 py-2 ${expanded ? "" : "hidden"}`} aria-hidden={!expanded}>
          {expanded ? panel.content : null}
        </div>
      </motion.section>;
    })}
  </div>;
}
