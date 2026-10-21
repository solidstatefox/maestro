"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeftRight, ArrowRight, GitBranch, Play, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { proxyDebugHeaders } from "@/lib/proxy-debug";

type Facet = {
  id: string;
  uri: string;
  shortform: string;
  label: string;
  count?: string;
};

type PathStep = {
  direction: "property" | "property-of";
  iri: string;
  label: string;
};

type Result = {
  id: string;
  uri: string;
  shortform: string;
  label: string;
  excerpt: string;
  graph: string;
};

type ApiResponse = {
  facets?: Facet[];
  rows?: Result[];
  sparql?: string;
  error?: string;
  details?: string;
};

export default function PathExplorer({ query }: { query: string }) {
  const [path, setPath] = useState<PathStep[]>([]);
  const [direction, setDirection] =
    useState<"property" | "property-of">("property");
  const [facets, setFacets] = useState<Facet[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [sparql, setSparql] = useState("");
  const [loadingFacets, setLoadingFacets] = useState(false);
  const [loadingResults, setLoadingResults] = useState(false);
  const [error, setError] = useState("");
  const [showQuery, setShowQuery] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadProperties() {
      setLoadingFacets(true);
      setError("");

      try {
        const params = new URLSearchParams({
          q: query,
          view: "properties",
          limit: "40",
          path: JSON.stringify(path.map(({ direction, iri }) => ({
            direction,
            iri,
          }))),
        });

        const response = await fetch(`/proxy/api/fct?${params}`, {
          headers: proxyDebugHeaders("path-explorer-facets", "PathExplorer.facets"),
          signal: controller.signal,
        });
        const data: ApiResponse = await response.json();

        if (!response.ok || data.error) {
          throw new Error(data.details || data.error || "Could not load properties");
        }

        setFacets(data.facets ?? []);
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err.message);
          setFacets([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoadingFacets(false);
      }
    }

    loadProperties();
    return () => controller.abort();
  }, [query, path]);

  function addStep(facet: Facet) {
    const iri = facet.shortform || facet.uri;

    if (!iri) return;

    setResults([]);
    setPath((current) => [
      ...current,
      {
        direction,
        iri,
        label: facet.shortform || facet.label || iri,
      },
    ]);
  }

  function removeFrom(index: number) {
    setPath((current) => current.slice(0, index));
    setResults([]);
  }

  async function runPath() {
    setLoadingResults(true);
    setError("");

    try {
      const params = new URLSearchParams({
        q: query,
        view: "text",
        limit: "30",
        offset: "0",
        path: JSON.stringify(path.map(({ direction, iri }) => ({
          direction,
          iri,
        }))),
      });

      const response = await fetch(`/proxy/api/fct?${params}`, { headers: proxyDebugHeaders("path-explorer-results", "PathExplorer.results") });
      const data: ApiResponse = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.details || data.error || "Path query failed");
      }

      setResults(data.rows ?? []);
      setSparql(data.sparql ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Path query failed");
    } finally {
      setLoadingResults(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="size-5" />
                RDF path explorer
              </CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                Follow relationships through the graph. Each step scopes the next.
              </p>
            </div>
            <Badge variant="outline">
              {path.length} {path.length === 1 ? "step" : "steps"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Current path
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={path.length === 0 ? "default" : "outline"}
                onClick={() => removeFrom(0)}
              >
                Search results
              </Button>

              {path.map((step, index) => (
                <div key={`${step.direction}-${step.iri}-${index}`} className="flex items-center gap-2">
                  <ArrowRight className="size-4 text-muted-foreground" />
                  <Button
                    size="sm"
                    variant={index === path.length - 1 ? "default" : "outline"}
                    onClick={() => removeFrom(index + 1)}
                    title={`Return to this step: ${step.iri}`}
                  >
                    {step.direction === "property-of" ? "← " : ""}
                    {step.label}
                    {step.direction === "property" ? " →" : ""}
                  </Button>
                  <button
                    type="button"
                    aria-label={`Remove ${step.label} and following steps`}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => removeFrom(index)}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}

              {path.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  Choose a property below to start building a path.
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-52 flex-1">
              <label className="mb-2 block text-sm font-medium">
                Relationship direction
              </label>
              <select
                value={direction}
                onChange={(event) =>
                  setDirection(event.target.value as "property" | "property-of")
                }
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="property">
                  Outgoing — resource has property
                </option>
                <option value="property-of">
                  Incoming — resource is the property's value
                </option>
              </select>
            </div>

            <Button onClick={runPath} disabled={loadingResults}>
              <Play className="mr-2 size-4" />
              {loadingResults ? "Running..." : "Run path"}
            </Button>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-semibold">Available properties</h3>
              <Badge variant="secondary">{facets.length}</Badge>
            </div>

            {loadingFacets && (
              <p className="text-sm text-muted-foreground">
                Loading properties for this path...
              </p>
            )}

            {!loadingFacets && facets.length === 0 && !error && (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No properties returned at this level. Try another search or remove a path step.
              </p>
            )}

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {facets.map((facet, index) => (
                <button
                  type="button"
                  key={`${facet.uri}-${index}`}
                  onClick={() => addStep(facet)}
                  className="group flex min-w-0 items-center justify-between gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-accent"
                  title={facet.uri}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {facet.shortform || facet.label || facet.uri}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {facet.uri}
                    </p>
                  </div>
                  <ArrowDown className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Path results</CardTitle>
              <Badge variant="secondary">{results.length} returned</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {results.map((result, index) => (
              <div
                key={result.uri || index}
                className="rounded-lg border p-4"
              >
                <p className="font-medium">
                  {result.label || result.shortform || "RDF resource"}
                </p>
                <a
                  href={result.uri}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block break-all text-xs text-primary hover:underline"
                >
                  {result.uri}
                </a>
                {result.excerpt && (
                  <p className="mt-2 break-words text-sm text-muted-foreground">
                    {result.excerpt.replace(/<[^>]*>/g, "")}
                  </p>
                )}
                {result.graph && (
                  <p className="mt-2 break-all text-xs text-muted-foreground">
                    Graph: {result.graph}
                  </p>
                )}
              </div>
            ))}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowQuery((current) => !current)}
                disabled={!sparql}
              >
                {showQuery ? "Hide SPARQL" : "Inspect SPARQL"}
              </Button>
              <Button
                variant="outline"
                onClick={() => navigator.clipboard.writeText(sparql)}
                disabled={!sparql}
              >
                Copy SPARQL
              </Button>
            </div>

            {showQuery && (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-4 text-xs text-green-300">
                {sparql}
              </pre>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}