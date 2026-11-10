"use client";

import { useRef, useState } from "react";
import type { EndpointOption, EndpointStatus } from "@/canvas/top/appbar";

/** State owned by the graph-servers subsystem. Query-tree mutations still use the authoritative FCT store. */
export function useGraphServersState() {
  const [endpointReloadRevision, setEndpointReloadRevision] = useState(0);
  const [queryRefreshRevision, setQueryRefreshRevision] = useState(0);
  const [fctEndpoints, setFctEndpoints] = useState<EndpointOption[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState("");
  const [endpointStatuses, setEndpointStatuses] = useState<
    Record<string, EndpointStatus>
  >({});
  const [isCheckingEndpoints, setIsCheckingEndpoints] = useState(false);
  const [checkingEndpointIds, setCheckingEndpointIds] = useState<Record<string, boolean>>({});
  const [endpointChecksCompleted, setEndpointChecksCompleted] = useState(0);
  const [endpointChecksTotal, setEndpointChecksTotal] = useState(0);
  const [endpointMenuError, setEndpointMenuError] = useState("");
  const [endpointHealthToast, setEndpointHealthToast] = useState<{ endpointId: string; message: string } | null>(null);
  const [isRefreshingFailedEndpoint, setIsRefreshingFailedEndpoint] = useState(false);

  return {
    endpointReloadRevision,
    setEndpointReloadRevision,
    queryRefreshRevision,
    setQueryRefreshRevision,
    fctEndpoints,
    setFctEndpoints,
    selectedEndpointId,
    setSelectedEndpointId,
    endpointStatuses,
    setEndpointStatuses,
    isCheckingEndpoints,
    setIsCheckingEndpoints,
    checkingEndpointIds,
    setCheckingEndpointIds,
    endpointChecksCompleted,
    setEndpointChecksCompleted,
    endpointChecksTotal,
    setEndpointChecksTotal,
    endpointMenuError,
    setEndpointMenuError,
    endpointHealthToast,
    setEndpointHealthToast,
    isRefreshingFailedEndpoint,
    setIsRefreshingFailedEndpoint,
  };
}
