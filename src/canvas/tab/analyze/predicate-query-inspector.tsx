"use client";
import { useState } from "react";
import { Code2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CodeBlock } from "@/components/ui/code-block";
import { LeftWidgetButtonTray } from "@/components/ui/left-widget-button-tray";
import type { QueryTrace } from "@/lib/predicate-query-diagnostics";
export function PredicateQueryTray({entries,label="Inspect analysis queries"}:{entries:QueryTrace;label?:string}) {
  const [open,setOpen] = useState(false);
  const [index,setIndex] = useState(0);
  const selected = entries[index] ?? entries[0];
  return <><LeftWidgetButtonTray actions={[{id:"inspector",label,icon:<Code2 className="size-4"/>,disabled:!entries.length,onSelect:()=>{setIndex(0);setOpen(true);}}]}/>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex h-[80vh] max-w-5xl flex-col overflow-hidden" showCloseButton>
      <DialogHeader><DialogTitle>Query inspector</DialogTitle><DialogDescription>FCT requests and SPARQL used by this analysis. Reused results retain their originating queries.</DialogDescription></DialogHeader>
      {selected && <><select aria-label="Analysis query" className="w-full rounded-md border bg-background p-2 text-sm" value={entries[index] ? index : 0} onChange={event=>setIndex(Number(event.target.value))}>
        {entries.map((entry,i)=><option key={i} value={i}>{i+1}. {entry.label}</option>)}
      </select>{selected.endpoint && <p className="break-all text-xs text-muted-foreground">{selected.endpoint}</p>}
      <CodeBlock className="min-h-0 flex-1" code={selected.query} language={selected.language} executionAddr={selected.endpoint} filename={`analysis-${index+1}.${selected.language === "xml" ? "xml" : "sparql"}`}/></>}
    </DialogContent></Dialog></>;
}
