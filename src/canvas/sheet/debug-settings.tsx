"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { MaestroSelect } from "@/components/ui/maestro-select";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import { MAESTRO_DEBUG_PARAMS, currentMaestroDebugSettings, urlWithMaestroDebugSettings,
  type MaestroDebugParam } from "@/lib/maestro-debug-url";

/** URL switches are opt-in; no debug UI or instrumentation turns on until Reload. */
export function MaestroDebugSettings({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const [originalUrl, setOriginalUrl] = useState("");
  const [selections, setSelections] = useState<Record<MaestroDebugParam, string>>({ maestroDebug: "", maestroLifecycle: "" });
  useEffect(() => {
    if (!active) { setOpen(false); return; }
    const current = window.location.href;
    setOriginalUrl(current);
    setSelections(currentMaestroDebugSettings(current));
  }, [active]);
  const updatedUrl = useMemo(() => originalUrl ? urlWithMaestroDebugSettings(originalUrl, selections) : "", [originalUrl, selections]);
  return <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border" >
    <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-accent/40" aria-label="Debug URL settings">
      <span className="text-sm font-semibold">Debug</span>
      {open ? <ChevronsDownUp className="size-4 text-muted-foreground"/> : <ChevronsUpDown className="size-4 text-muted-foreground"/>}
    </CollapsibleTrigger>
    <CollapsibleContent className="flex flex-col gap-3 border-t px-3 pb-4 pt-3">
      <p className="text-xs text-muted-foreground">Diagnostics are off by default. Choose options, then reload the current page with those URL settings.</p>
    {MAESTRO_DEBUG_PARAMS.map(definition => <div key={definition.key} className="flex items-center justify-between gap-3">
      <Label htmlFor={`maestro-debug-${definition.key}`}>{definition.label}</Label>
      <MaestroSelect id={`maestro-debug-${definition.key}`} aria-label={`${definition.label} debug setting`}
        value={selections[definition.key]}
        onChange={event => setSelections(previous => ({ ...previous, [definition.key]: event.currentTarget.value }))}
        className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-xs">
        {definition.values.map(option => <option key={option.value || "off"} value={option.value}>{option.label}</option>)}
      </MaestroSelect>
    </div>)}
    <Label htmlFor="maestro-debug-url-preview" className="text-xs">Current URL with selected debug flags</Label>
    <output id="maestro-debug-url-preview" className="max-h-24 overflow-auto break-all rounded-md bg-muted p-2 text-[11px] text-muted-foreground" aria-live="polite">{updatedUrl}</output>
    <Button type="button" variant="outline" disabled={!originalUrl}
      onClick={() => { if (originalUrl) window.location.assign(urlWithMaestroDebugSettings(window.location.href, selections)); }}>Reload with debug settings</Button>
    </CollapsibleContent>
  </Collapsible>;
}
