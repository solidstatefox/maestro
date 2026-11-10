"use client";

import { useRef, useState } from "react";
import { useGraphFacetNavigationState } from "@/canvas/left/filter";

/** State owned by the graph-scope subsystem. Query-tree mutations still use the authoritative FCT store. */
export function useGraphScopeState() {
  const [personalSparqlEndpoint, setPersonalSparqlEndpoint] = useState("");
  const [graphInfoOpen, setGraphInfoOpen] = useState(false);
  const graphInfoRequestRef = useRef(0);

  return {
    personalSparqlEndpoint,
    setPersonalSparqlEndpoint,
    graphInfoOpen,
    setGraphInfoOpen,
    graphInfoRequestRef,
  };
}

/** Graph selection and Graphs-list state share one navigation owner. */
export function useGraphScopeNavigation() {
  return useGraphFacetNavigationState();
}
