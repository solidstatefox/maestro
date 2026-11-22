"use client";
import type { ReactNode } from "react";
import { PanelsTopLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** Shared shadcn Outline Empty used by View, Analyze, and restoration failures. */
export function MaestroEmptyResults({ title, description, onBrowse, actions, media }: {
  title: string;
  description: ReactNode;
  onBrowse?: () => void;
  actions?: ReactNode;
  media?: ReactNode;
}) {
  return <Empty className="mx-auto my-3 max-w-xl" data-maestro-empty-results="true">
    <EmptyHeader>
      <EmptyMedia variant="icon">{media ?? <PanelsTopLeft aria-hidden="true"/>}</EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
    <EmptyContent>{actions ?? (onBrowse ? <Button type="button" variant="outline" onClick={onBrowse}>Browse</Button> : null)}</EmptyContent>
  </Empty>;
}
