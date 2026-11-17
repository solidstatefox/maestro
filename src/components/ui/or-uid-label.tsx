"use client";
import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";
import * as LucideIcons from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Base-36 OR identifier. Breadcrumbs use bare LetterX; every other surface
 * uses SquareLetterX. The fallback is for Lucide releases without the glyph. */
export function OrUidIcon({ uid, bare = false }: { uid?: string; bare?: boolean }) {
  if (!uid) return null;
  const letter = uid.toUpperCase();
  const key = `${bare ? "Letter" : "SquareLetter"}${letter}`;
  const icon = (LucideIcons as unknown as Record<string, ComponentType<{ className?: string }>>)[key];
  return <Tooltip><TooltipTrigger render={<span className="inline-flex shrink-0 items-center justify-center text-muted-foreground" tabIndex={0} aria-label={`OR condition ${letter}`}>
    {icon ? createElement(icon, { className: "size-3.5" }) :
      <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        {!bare && <rect x="3" y="3" width="18" height="18" rx="2" />}
        <text x="12" y="16.5" textAnchor="middle" fill="currentColor" stroke="none" fontSize="13" fontWeight="600">{letter}</text>
      </svg>}
  </span>} /><TooltipContent>{`OR condition ${letter}: properties with the same letter are alternatives`}</TooltipContent></Tooltip>;
}
export function OrUidLabel({ uid, children }: { uid?: string; children: ReactNode }) {
  if (!uid) return <>{children}</>;
  return <span data-or-uid={uid} className="inline-flex min-w-0 max-w-full items-center gap-1 align-middle">
    <OrUidIcon uid={uid}/><span className="min-w-0">{children}</span>
  </span>;
}
