"use client";

import { useRef, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Every action registered with a left-widget hover tray is a labeled object.
 * Custom renderers (inspectors, XSLT provider controls) retain their own state;
 * for overflow, the manager delegates the menu action to the mounted renderer.
 */
export type LeftWidgetTrayAction = {
  id: string;
  label: string;
  icon: ReactNode;
  render?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  when?: boolean;
};
export function LeftWidgetButtonTray({ actions, threshold = 3 }: {
  actions: LeftWidgetTrayAction[];
  /** Zero-based slot occupied by the ellipsis if overflow exists. */
  threshold?: number;
}) {
  const hosts = useRef(new Map<string, HTMLSpanElement>());
  const available = actions.filter(action => action.when !== false);
  const actionIds = new Set(available.map(action => action.id));
  if (actionIds.size !== available.length) throw new Error("Duplicate left-widget tray action id");
  const visible = available.slice(0, Math.max(0, threshold));
  const hidden = available.slice(Math.max(0, threshold));
  const button = (action: LeftWidgetTrayAction) => action.render ?? <Tooltip>
    <TooltipTrigger render={<button type="button" disabled={action.disabled} onClick={action.onSelect}
      aria-label={action.label} className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 disabled:opacity-30">{action.icon}</button>} />
    <TooltipContent>{action.label}</TooltipContent>
  </Tooltip>;
  return <div data-left-widget-button-tray className="inline-flex shrink-0 items-center gap-1">
    {visible.map(action => <span key={action.id} data-tray-action={action.id} className="inline-flex shrink-0">{button(action)}</span>)}
    {hidden.length > 0 && <DropdownMenu>
      <Tooltip><TooltipTrigger render={<DropdownMenuTrigger asChild><button type="button" aria-label="More widget actions"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-input bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100"><Ellipsis className="size-4" aria-hidden="true" /></button></DropdownMenuTrigger>} />
        <TooltipContent>More widget actions</TooltipContent></Tooltip>
      <DropdownMenuContent align="end">
        {hidden.map(action => <DropdownMenuItem key={action.id} disabled={action.disabled} onSelect={() => {
          if (action.onSelect) action.onSelect();
          else hosts.current.get(action.id)?.querySelector<HTMLButtonElement>("button")?.click();
        }} className="flex cursor-pointer items-center gap-2">
          <span className="inline-flex size-4 shrink-0 items-center justify-center">{action.icon}</span>
          <span>{action.label}</span>
        </DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>}
    {hidden.map(action => <span key={`host-${action.id}`} ref={node => { if (node) hosts.current.set(action.id, node); else hosts.current.delete(action.id); }}
      className="pointer-events-none invisible fixed -left-[10000px] -top-[10000px]" aria-hidden="true">{button(action)}</span>)}
  </div>;
}
