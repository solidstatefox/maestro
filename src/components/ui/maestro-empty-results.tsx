"use client";
import { PanelsTopLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export function MaestroEmptyResults({ title, description, onBrowse }: { title: string; description: string; onBrowse: () => void }) {
  return <Empty className="mx-auto my-3 max-w-xl" data-maestro-empty-results="true">
    <EmptyHeader>
      <EmptyMedia variant="icon"><PanelsTopLeft aria-hidden="true"/></EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
    <EmptyContent><Button type="button" variant="outline" onClick={onBrowse}>Browse</Button></EmptyContent>
  </Empty>;
}
