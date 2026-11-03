/** Minimal SaxonJS 2.7 Node transform API used by Maestro's XSLT endpoint. */
declare module "saxon-js" {
  interface TransformOptions {
    stylesheetText: string; // Compiled SEF JSON, not the original .xsl source.
    sourceText: string;
    destination: "serialized";
    stylesheetParams?: Record<string, string>;
  }
  interface TransformResult {
    principalResult?: unknown;
  }
  const SaxonJS: {
    transform(options: TransformOptions, execution: "async"): Promise<TransformResult>;
  };
  export = SaxonJS;
}
