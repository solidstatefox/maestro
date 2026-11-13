# Run once against the user's personal SPARQL store after reviewing graphs.
# Rewrites references to the legacy Map provider in every accessible named graph.
# Does not rewrite literals containing the URI (for example, saved share URLs).
DELETE { GRAPH ?g { <urn:maestro:perspective:map> ?p ?o } }
INSERT { GRAPH ?g { <gttp://ggg.maestro.ui/provider/map> ?p ?o } }
WHERE  { GRAPH ?g { <urn:maestro:perspective:map> ?p ?o } } ;

DELETE { GRAPH ?g { ?s ?p <urn:maestro:perspective:map> } }
INSERT { GRAPH ?g { ?s ?p <gttp://ggg.maestro.ui/provider/map> } }
WHERE  { GRAPH ?g { ?s ?p <urn:maestro:perspective:map> } } ;
