# Maestro OTC transcoder — execution skill

This skill defines the execution protocol for the RDF vocabulary at `gttp://ggg.openlink.sw/nlp/transcoder#`. It does **not** replace the rules with a fixed set of prompts. Load and discover rule definitions from the RDF graph using SPARQL.

## Rule contract

Each `otc:Transcoder` has one or more `otc:hasRule` resources. Evaluate a rule in this order:

0. **`otc:ask` (optional)** — CDATA containing a read-only SPARQL `ASK`; if it returns false, skip the rule without executing `otc:target`. This is an existence filter, not a change detector.
1. **`otc:target`** — CDATA containing a **read-only SPARQL `SELECT`**. Execute it against the explicitly selected source dataset. The projected RDF terms (including their IRI/literal types, language tags, and datatypes) provide the initial variable bindings. Never let a rule invoke `UPDATE`, `LOAD`, or service endpoints not authorized for this run. Respect `LIMIT`, timeout, and result budgets.
2. **`otc:validator` — mandatory SHACL gate.** Each transcoder links to a `sh:NodeShape` using `otc:validator`. Before the LLM is called, validate the `?message` focus node returned by each SELECT row against the attached shape **in the source dataset**. Reject invalid nodes, record their SHACL violations, and never include their text in the LLM survey. In this phase, the runner implements the declared SHACL Core subset (`sh:class`, `sh:path`, `sh:minCount`, `sh:nodeKind sh:Literal`, `sh:datatype`, `sh:minLength`, `sh:hasValue`); it is not a complete SHACL implementation. Unsupported constraints must fail closed, never silently pass.
3. **`otc:assume`** — background statements to interpret each result row, *not* assertions proven by that row. If an assumption limits the intended rows (e.g., assistant author role), verify it using available bindings or source data; do not silently treat absent evidence as proof. Rule authors can tighten `otc:target` as the source vocabulary becomes known.
4. **`otc:query`** — the natural-language survey question, answered from the row's bound resources and available text. Preserve the target bindings, and add LLM-derived projected bindings. The reserved variable **`?resp`** holds the primary survey answer. Other `?name` variables may be used when the rule requests them. Keep an explicit RDF term type for each binding.
5. **`otc:template`** — expand the survey results deterministically using RDF-aware escaping and existing OTC `<IF is_uri("?var")> ... <ELSE> ... </IF>` conditional behavior. A `<...>` slot is an IRI only when the binding is an IRI; a quoted slot is a properly escaped RDF literal. Do not interpolate untrusted strings as raw Turtle syntax. Parse generated Turtle before accepting it.

The combined target and survey binding row is a SPARQL-like projection. The LLM determines answers; the execution engine owns SPARQL, binding types, substitution, parsing, and storage. Retain each stage's selected rule, bindings, Turtle, diagnostics, and graph IRI in an execution trace.

## Named graph for transcoded output

**Before running a transcoding operation, require the user to provide the output graph namespace IRI and an authorized writable graph server.** Do not invent a default namespace, place output in the default graph, or silently use the Personal graph server. If the user is not authenticated for the chosen graph server, explain that publication requires login. Never send a session token or password to the LLM.

Generate one unique nonempty, URI-safe local identifier `id` **per transcoding run**, and construct the named graph IRI by appending `#` plus that identifier to the user-provided namespace. To avoid double fragments, require a base namespace IRI with no fragment (`#`) already present. Example: input `https://example.org/maestro/transcoded` and `id=8e47b1` produces graph `<https://example.org/maestro/transcoded#8e47b1>`. The exact IRI is a **named graph**, not the namespace of the RDF resources in its body. Never use the example IRI as a default. Use the same graph IRI for *all* outputs and intermediate results in that run; generate a new identifier for a new run.

For each successfully parsed template expansion:

1. Convert the Turtle into safely serialized RDF triples for a SPARQL `INSERT DATA { GRAPH <runGraphIRI> { ... } }` request, with prefix declarations correctly handled; do not concatenate unchecked strings into SPARQL.
2. Verify write authorization **server-side**, and execute the update only on the user's selected writable graph server. Do not publish to unrelated graphsites, other graphs, or other users' stores.
3. Confirm the inserted triples can be retrieved from that named graph before treating the stage as persisted.
4. For the next stage, select this run's named graph as the source dataset, discover applicable rules through SPARQL in the transcoder-rule store, and execute their `otc:target` against the run graph. Read-only discovery must not modify any graph. Stop when no successor rule matches or a configured chain-depth/loop limit is reached.

Do not overwrite or clear an existing run graph unless the user explicitly authorizes that operation. On failure, retain the stage error and do not say the output was saved. A run is complete only when its required outputs have been persisted and verified. Publication to a separate Format/Validator graph is **not** implied by storing OTC work; that is a distinct, authorized action.

## Result and safety rules

- Show or record the run graph IRI so the user can inspect the transcoded RDF.
- Keep SPARQL execution bounded and reject unsafe forms or arbitrary `SERVICE` calls.
- Validate generated RDF terms and their types; do not use unescaped `?resp` in a URI or literal slot.
- Preserve graph-server authorization even if the LLM reports the user as logged in: authentication must be checked by Maestro's server.
- If an `otc:target` returns no rows, report that condition; do not manufacture bindings.
- If the input dataset lacks the content or author-role property required by a survey, ask for or discover the correct predicate rather than claim the rule definitely applies.

## Deployed phase 1 (single-stage)

The first Maestro implementation provides an authenticated `/proxy/api/otc` route with explicit `seed`, `list`, and `run` actions. It does not automatically chain output to other surveys, poll, or register watches. A `sourceGraph` may be supplied to set `default-graph-uri` for the selected source endpoint; `source` may be `personal` or the ID of an endpoint in Maestro's registry. Each run is bounded to five target rows per rule, eight rules, and 300 output triples. The Personal graph server is the only supported write destination in this phase. A dry run creates Turtle and parses it but does not write. The runtime returns a trace and only reports published success after a SPARQL read-back. There is no automatic Format/Validator installation yet: subsequent transcoders must be authored to create valid XSLT RDF templates, and publishing those templates to the policy graph requires an additional authorized action.

## SHACL validation requirements

The three chatlog transcoders use two types of input shape: assistant messages for topic/response-mode extraction, and user messages for sentiment extraction. Each requires `rdf:type schema:Message`, a literal `schema:text` with at least one character and `xsd:string` datatype, and `schema:author` with the appropriate role. These shapes are attached at the **transcoder** level through `otc:validator` (not automatically applied to all `schema:Message` nodes). The runtime selects the ?message IRI as the focus node. `otc:ask` and `otc:target` additionally filter roles and text for efficiency, but **neither replaces validation**. Invalid messages are skipped before Qwen requests. No transcoders run without an attached validator. In a future generic OTC implementation, replace the limited Core subset with a standards-complete SHACL engine while retaining the same shape IRIs.
