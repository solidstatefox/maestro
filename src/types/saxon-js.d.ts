/** SaxonJS 2.7 XPath API used for in-process dynamic XSLT execution. */
declare module "saxon-js" {
  interface XPathEvaluationOptions {
    params?: Record<string, string>;
  }
  const SaxonJS: {
    XPath: {
      evaluate(xpath: string, contextItem: null, options: XPathEvaluationOptions): unknown;
    };
  };
  export = SaxonJS;
}
