"use client";

import { useRef, useState } from "react";
import { useFacetListState } from "@/canvas/left/filter";
import type { OntologyClassMetadata, PersonalWidget } from "@/canvas/left/filter";

/** State owned by the facets subsystem. Query-tree mutations still use the authoritative FCT store. */
export function useFacetsState() {
  const [defaultLeftTab, setDefaultLeftTab] = useState<"facets" | "personal" | "community">("personal");
  const [personalWidgets, setPersonalWidgets] = useState<PersonalWidget[]>([]);
  const [tutorialMode, setTutorialMode] = useState(false);
  const [facetHoverPreview, setFacetHoverPreview] = useState<{
    kind: "facet" | "record";
    uri: string;
    label: string;
    direction: "forward" | "reverse";
    source: "personal" | "configure" | "record";
    successorNodeId?: string | null;
  } | null>(null);
  const [focusWidgetsSuppressed, setFocusWidgetsSuppressed] = useState(false);
  const personalWidgetCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const roleWidgetCardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const categoriesWidgetRef = useRef<HTMLElement | null>(null);
  const facetListsLoadingObservedRef = useRef(false);
  const facetListsLoadKeyRef = useRef("");
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  const [isLoadingGraphs, setIsLoadingGraphs] = useState(false);
  const [roleFacetError, setRoleFacetError] = useState("");
  const [expandedCategoryNodes, setExpandedCategoryNodes] = useState<Set<string>>(() => new Set());
  const [ontologyClassMetadata, setOntologyClassMetadata] = useState<Record<string, OntologyClassMetadata>>({});
  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const [isLoadingClasses, setIsLoadingClasses] = useState(false);
  const [configureQueryTransition, setConfigureQueryTransition] = useState(false);
  const pendingConfigureFacetIdentityRef = useRef<string | null>(null);
  const [propertyFacetError, setPropertyFacetError] = useState("");
  const [classFacetError, setClassFacetError] = useState("");
  const [propertyFacetWarning, setPropertyFacetWarning] = useState("");
  const [classFacetWarning, setClassFacetWarning] = useState("");
  const [categoriesIncomplete, setCategoriesIncomplete] = useState(false);
  const [roleFacetWarning, setRoleFacetWarning] = useState("");
  const [expandedUris, setExpandedUris] = useState<Set<string>>(new Set());

  return {
    defaultLeftTab,
    setDefaultLeftTab,
    personalWidgets,
    setPersonalWidgets,
    tutorialMode,
    setTutorialMode,
    facetHoverPreview,
    setFacetHoverPreview,
    focusWidgetsSuppressed,
    setFocusWidgetsSuppressed,
    personalWidgetCardRefs,
    roleWidgetCardRefs,
    categoriesWidgetRef,
    facetListsLoadingObservedRef,
    facetListsLoadKeyRef,
    isLoadingRoles,
    setIsLoadingRoles,
    isLoadingGraphs,
    setIsLoadingGraphs,
    roleFacetError,
    setRoleFacetError,
    expandedCategoryNodes,
    setExpandedCategoryNodes,
    ontologyClassMetadata,
    setOntologyClassMetadata,
    isLoadingProperties,
    setIsLoadingProperties,
    isLoadingClasses,
    setIsLoadingClasses,
    configureQueryTransition,
    setConfigureQueryTransition,
    pendingConfigureFacetIdentityRef,
    propertyFacetError,
    setPropertyFacetError,
    classFacetError,
    setClassFacetError,
    propertyFacetWarning,
    setPropertyFacetWarning,
    classFacetWarning,
    setClassFacetWarning,
    categoriesIncomplete,
    setCategoriesIncomplete,
    roleFacetWarning,
    setRoleFacetWarning,
    expandedUris,
    setExpandedUris,
  };
}

/** Existing facet lists and counts remain the shared left-pane state. */
export function useFacetRuntimeState() {
  return useFacetListState();
}
