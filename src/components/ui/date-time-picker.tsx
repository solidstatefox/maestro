"use client";

import { useEffect, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

/** Shadcn-style date and time picker backed by the Base UI Popover.
 * Exposes the same local datetime string used by Maestro's UTC conversion.
 * All changes are delivered immediately; callers decide when a range is complete.
 */
export function DateTimePicker({ label, value, onChange }: {
  label: string; value: string; onChange: (next: string) => void;
}) {
  const today = new Date();
  const selected = /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
  const [shown, setShown] = useState(() => selected || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`);
  const [hours, setHours] = useState(() => value.slice(11, 13) || "00");
  const [minutes, setMinutes] = useState(() => value.slice(14, 16) || "00");
  useEffect(() => {
    if (selected) setShown(selected);
    if (value.length >= 16) { setHours(value.slice(11, 13)); setMinutes(value.slice(14, 16)); }
  }, [selected, value]);
  const [y, m] = shown.split("-").map(Number);
  const firstWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const totalDays = new Date(y, m, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const emit = (date: string, hour = hours, minute = minutes) => onChange(`${date}T${hour}:${minute}`);
  const shift = (step: number) => { const d = new Date(y, m - 1 + step, 1); setShown(`${d.getFullYear()}-${pad(d.getMonth()+1)}-01`); };
  return <div className="flex min-w-0 flex-col gap-1">
    <span className="text-xs text-muted-foreground">{label}</span>
    <Popover.Root>
      <Popover.Trigger aria-label={`Choose ${label.toLowerCase()} date and time`} className="flex h-9 min-w-0 items-center gap-2 rounded-md border bg-background px-2 text-left text-xs hover:bg-accent">
        <CalendarDays className="size-4 shrink-0"/><span className="truncate">{value ? value.replace("T", " · ") : "Select date and time"}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} className="z-50">
          <Popover.Popup className="w-72 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg outline-none">
            <div className="mb-2 flex items-center justify-between text-sm font-medium">
              <button type="button" className="rounded p-1 hover:bg-accent" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="size-4"/></button>
              {new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric"}).format(new Date(y,m-1,1))}
              <button type="button" className="rounded p-1 hover:bg-accent" onClick={() => shift(1)} aria-label="Next month"><ChevronRight className="size-4"/></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {["Mo","Tu","We","Th","Fr","Sa","Su"].map(day=><span className="py-1 text-muted-foreground" key={day}>{day}</span>)}
              {Array.from({length:firstWeekday},(_,i)=><span key={`pad-${i}`}/>)}
              {Array.from({length:totalDays},(_,i)=>{
                const day = `${y}-${pad(m)}-${pad(i+1)}`;
                return <button key={day} type="button" aria-label={day} aria-pressed={selected===day} onClick={()=>emit(day)} className="size-8 rounded-md hover:bg-accent aria-pressed:bg-primary aria-pressed:text-primary-foreground">{i+1}</button>;
              })}
            </div>
            <div className="mt-3 flex items-center gap-2 border-t pt-3 text-xs">
              <span className="text-muted-foreground">Time</span>
              <select aria-label={`${label} hour`} className="rounded-md border bg-background px-2 py-1" value={hours} onChange={event=>{setHours(event.target.value);if(selected)emit(selected,event.target.value,minutes);}}>
                {Array.from({length:24},(_,i)=><option key={i} value={pad(i)}>{pad(i)}</option>)}
              </select>
              <span>:</span>
              <select aria-label={`${label} minute`} className="rounded-md border bg-background px-2 py-1" value={minutes} onChange={event=>{setMinutes(event.target.value);if(selected)emit(selected,hours,event.target.value);}}>
                {Array.from({length:60},(_,i)=><option key={i} value={pad(i)}>{pad(i)}</option>)}
              </select>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  </div>;
}
