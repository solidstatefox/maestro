"use client";

import { useRef, useState } from "react";

/** State owned by the publish subsystem. Query-tree mutations still use the authoritative FCT store. */
export function usePublishState() {
  const [isRdfLoaderOpen, setIsRdfLoaderOpen] = useState(false);
  const [rdfSourceUrl, setRdfSourceUrl] = useState("");
  const [rdfTargetGraph, setRdfTargetGraph] = useState(
    "http://example.org/graph/imported",
  );
  const [isRdfLoading, setIsRdfLoading] = useState(false);

  return {
    isRdfLoaderOpen,
    setIsRdfLoaderOpen,
    rdfSourceUrl,
    setRdfSourceUrl,
    rdfTargetGraph,
    setRdfTargetGraph,
    isRdfLoading,
    setIsRdfLoading,
  };
}
