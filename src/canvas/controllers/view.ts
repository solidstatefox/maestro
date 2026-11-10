"use client";

import { useRef, useState } from "react";
import type { FeatureKind } from "@/lib/feature-view-xslt";

/** State owned by the view subsystem. Query-tree mutations still use the authoritative FCT store. */
export function useViewState() {
  const [selectedViewUri, setSelectedViewUri] = useState("");
  const [viewDiscoveryLoading, setViewDiscoveryLoading] = useState(false);
  const [viewDiscoveryError, setViewDiscoveryError] = useState("");
  const [viewPanel, setViewPanel] = useState<"trail" | "perspectives" | "features">("features");
  const [viewFeature, setViewFeature] = useState<FeatureKind | null>(null);
  const [viewFeatureHtml, setViewFeatureHtml] = useState("");
  const [viewFeatureLoading, setViewFeatureLoading] = useState(false);
  const [viewFeatureError, setViewFeatureError] = useState("");
  const [viewFeatureCount, setViewFeatureCount] = useState(0);
  const [viewHtml, setViewHtml] = useState("");
  const [viewXsltMetadata, setViewXsltMetadata] = useState<{ title?: string; icon?: string }>({});
  const [viewDomainRanks, setViewDomainRanks] = useState<Record<string, string>>({});
  const [viewRenderError, setViewRenderError] = useState("");
  const [viewServerSoftware, setViewServerSoftware] = useState<Record<string, { product: string; version: string }>>({});
  const [viewServerDescriptions, setViewServerDescriptions] = useState<Record<string, string>>({});

  return {
    selectedViewUri,
    setSelectedViewUri,
    viewDiscoveryLoading,
    setViewDiscoveryLoading,
    viewDiscoveryError,
    setViewDiscoveryError,
    viewPanel,
    setViewPanel,
    viewFeature,
    setViewFeature,
    viewFeatureHtml,
    setViewFeatureHtml,
    viewFeatureLoading,
    setViewFeatureLoading,
    viewFeatureError,
    setViewFeatureError,
    viewFeatureCount,
    setViewFeatureCount,
    viewHtml,
    setViewHtml,
    viewXsltMetadata,
    setViewXsltMetadata,
    viewDomainRanks,
    setViewDomainRanks,
    viewRenderError,
    setViewRenderError,
    viewServerSoftware,
    setViewServerSoftware,
    viewServerDescriptions,
    setViewServerDescriptions,
  };
}
