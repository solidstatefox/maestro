"use client";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
/** The same navigation button appears in normal, loading and unavailable Configure panes. */
export function ReturnToFiltersButton({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  return <Button type="button" size="sm" variant="outline" onClick={onClick} disabled={disabled}
    className="cursor-pointer gap-2" aria-label="Return to Filters">
    <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />Return to Filters
  </Button>;
}
