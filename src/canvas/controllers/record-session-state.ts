"use client";

import { useRecordState } from "@/canvas/controllers/record";
import { useRecordCoreState, useRecordPageSettings, useRecordPresentationState } from "@/canvas/right/record";
import { useRecordFormatSelection } from "@/canvas/right/format";

/**
 * Instantiate once per Record viewer. It composes the *existing* Record hooks
 * so the viewer has one state boundary regardless of which host displays it.
 *
 * This is Record-local state only. Loading, policy discovery, and rendering
 * effects must be moved out of Browse's workspace-controller before this
 * can replace its current Record hooks in production.
 *
 * The XSLT runner is intentionally not passed a session ID.
 */
export function useRecordSessionState(preferredLanguage: string) {
  const lifecycle = useRecordState();
  const core = useRecordCoreState();
  const presentation = useRecordPresentationState(preferredLanguage);
  const pagination = useRecordPageSettings();
  const format = useRecordFormatSelection();
  return { ...lifecycle, ...core, ...presentation, ...pagination, ...format };
}
