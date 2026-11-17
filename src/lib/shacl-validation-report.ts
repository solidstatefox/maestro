/** Domain-neutral W3C SHACL validation report projection, shared by all Maestro viewers. */
export type ShaclValidationReport = {
  complete: boolean;
  conforms: boolean;
  message: string;
  violations: Array<{ path: string; message: string; value?: string }>;
  optionalMissing?: Array<{ path: string; name: string }>;
  unsupportedConstraints: string[];
  /** Standards-compliant RDF validation graph (N-Triples). */
  reportNTriples?: string;
  /** XSLT-friendly projection of the validation report. */
  reportXml?: string;
  standard?: "SHACL Core";
};
