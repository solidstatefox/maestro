"use client";

import { useEffect } from "react";
import { installMaestroProviderBridge, mountMaestroProviderHtml, registerMaestroProviderMount, unregisterMaestroProviderMount } from "@/lib/maestro-provider-dom";
import { transformProviderXslt } from "@/lib/maestro-provider-xslt";

/** Wafer-thin React boundary for approved XSLT UI providers.
 * The stylesheet authors the markup, scripts, queries and interactions.
 * Maestro only supplies an addressable mount, the existing XML transform,
 * installed libraries, and the existing subscriber-driven refresh lifecycle.
 */
export function MaestroProviderHost({ providerUri, componentUrn, stylesheet, queryXml, resultXml,
  describeXml, approved, metadata, facetValues }: {
  providerUri: string;
  componentUrn: string;
  stylesheet: string;
  queryXml: string;
  resultXml?: string;
  describeXml?: string;
  approved: boolean;
  metadata?: Record<string, string>;
  facetValues?: Record<string, string[]>;
}) {
  useEffect(() => {
    const controller = new AbortController();
    const target = document.getElementById(componentUrn);
    if (!target) return () => controller.abort();
    if (!approved) { target.replaceChildren(); return () => controller.abort(); }
    installMaestroProviderBridge();
    registerMaestroProviderMount(componentUrn, controller.signal);
    void transformProviderXslt(stylesheet, {
      queryXml, describeXml, resultXml, componentUrn, metadata, facetValues,
    }, controller.signal).then(markup => {
      if (!controller.signal.aborted) mountMaestroProviderHtml(componentUrn, markup);
    }).catch(error => {
      if (!controller.signal.aborted) {
        target.textContent = error instanceof Error ? error.message : "Provider rendering failed.";
        target.setAttribute("role", "alert");
      }
    });
    return () => {
      controller.abort();
      unregisterMaestroProviderMount(componentUrn, controller.signal);
      window.MaestroProvider?.clearFacetDecorations(providerUri);
    };
  }, [providerUri, componentUrn, stylesheet, queryXml, resultXml, describeXml, approved, metadata, facetValues]);

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col" id={componentUrn} data-maestro-provider={providerUri} data-approved={approved ? "true" : "false"} />;
}
