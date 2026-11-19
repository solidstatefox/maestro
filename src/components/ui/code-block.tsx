"use client";

import { useMemo, useState } from "react";
import xmlFormat from "xml-formatter";
import hljs from "highlight.js/lib/core";
import xml from "highlight.js/lib/languages/xml";
import sql from "highlight.js/lib/languages/sql";
// The CodeBlock is self-contained; other widgets must not have to register
// these languages before View opens its Turtle source.
if (!hljs.getLanguage("xml")) hljs.registerLanguage("xml", xml);
if (!hljs.getLanguage("sparql")) hljs.registerLanguage("sparql", sql);
// highlight.js does not ship a bundled Turtle grammar. Register only the
// constructs needed by this source viewer, without an extra dependency.
if (!hljs.getLanguage("turtle")) {
  hljs.registerLanguage("turtle", (hl) => ({
    name: "Turtle",
    aliases: ["ttl"],
    contains: [
      { scope: "string", begin: /"""/, end: /"""/, contains: [hl.BACKSLASH_ESCAPE] },
      { scope: "string", begin: /'''/, end: /'''/, contains: [hl.BACKSLASH_ESCAPE] },
      hl.QUOTE_STRING_MODE,
      hl.APOS_STRING_MODE,
      { scope: "link", begin: /</, end: />/ },
      hl.COMMENT("#", "$"),
      { scope: "keyword", match: /(?:@prefix|@base|PREFIX|BASE)\b/i },
      { scope: "keyword", match: /\ba\b/ },
      { scope: "symbol", match: /(?:[A-Za-z][\w.-]*)?:[A-Za-z0-9_~.%-]*/ },
      { scope: "meta", match: /@[A-Za-z]+(?:-[A-Za-z0-9]+)*/ },
      hl.C_NUMBER_MODE,
    ],
  }));
}
import { Check, Copy, Download, WrapText, Play } from "lucide-react";
import { sparqlEditorUrl } from "@/lib/fct-execution-address";
import type { HTMLAttributes } from "react";

type CodeBlockProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  code: string;
  language?: "xml" | "sparql" | string;
  filename?: string;
  /** Graph@endpoint of this particular displayed query; never inferred from Browse. */
  executionAddr?: string;
};

/** Read-only, line-numbered source viewer with syntax highlighting and copy/download actions. */
export function CodeBlock({
  className = "",
  code,
  language = "xml",
  filename = "query.txt",
  executionAddr,
  ...props
}: CodeBlockProps) {
  const editorUrl = useMemo(() => language.trim().toLowerCase() === "sparql"
    ? sparqlEditorUrl(executionAddr, code) : null, [executionAddr, language, code]);
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  // Use the same xml-formatter settings as the center pane for every XML CodeBlock.
  // Non-XML (including SPARQL) and incomplete/error text are left untouched.
  const displayedCode = useMemo(() => {
    if (language.trim().toLowerCase() !== "xml") return code;
    try { return xmlFormat(code, { indentation: "  " }); }
    catch { return code; }
  }, [code, language]);
  const lines = useMemo(() => {
    const sourceLines = displayedCode.replace(/\r\n?/g, "\n").split("\n");
    const languageName = language.trim().toLowerCase();
    const supported = Boolean(hljs.getLanguage(languageName));
    const escapeText = (text:string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    return sourceLines.map((line) => {
      if (!line) return "&nbsp;";
      if (!supported) return escapeText(line);
      try {
        return hljs.highlight(line, { language: languageName, ignoreIllegals: true }).value;
      } catch { return escapeText(line); }
    });
  }, [displayedCode, language]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(displayedCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  function downloadCode() {
    const blob = new Blob([displayedCode], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden rounded-md border bg-[#0d1117] text-xs text-[#e6edf3] [&_.hljs-tag]:text-sky-300 [&_.hljs-name]:text-sky-200 [&_.hljs-attr]:text-amber-200 [&_.hljs-string]:text-emerald-300 [&_.hljs-keyword]:text-violet-300 [&_.hljs-built_in]:text-cyan-300 [&_.hljs-comment]:text-slate-500 [&_.hljs-number]:text-orange-300 ${className}`}
      {...props}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
        <span className="truncate font-mono text-[11px] text-slate-300">{filename}</span>
        <div className="flex shrink-0 items-center gap-2">
          {editorUrl && <a href={editorUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex h-7 items-center gap-1 rounded border border-white/15 px-2 text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            aria-label="Open SPARQL in Virtuoso query editor" title="Open in Virtuoso SPARQL editor (does not execute automatically)">
            <Play className="size-3.5" aria-hidden="true" />Execute
          </a>}

          <button
            type="button"
            onClick={() => setWrap((current) => !current)}
            className={`inline-flex size-7 items-center justify-center rounded border border-white/15 text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${wrap ? "bg-white/15" : ""}`}
            aria-label={wrap ? "Disable line wrapping" : "Enable line wrapping"}
            aria-pressed={wrap}
            title={wrap ? "Disable line wrapping" : "Enable line wrapping"}
          >
            <WrapText className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void copyCode()}
            className="inline-flex size-7 items-center justify-center rounded border border-white/15 text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            aria-label={copied ? "Copied code" : "Copy code"}
            title={copied ? "Copied" : "Copy code"}
          >
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={downloadCode}
            className="inline-flex size-7 items-center justify-center rounded border border-white/15 text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            aria-label="Download code"
            title="Download code"
          >
            <Download className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={`min-h-0 flex-1 overflow-auto py-2 font-mono leading-6 ${wrap ? "overflow-x-hidden" : ""}`}>
        <pre className={wrap ? "w-full min-w-0" : "min-w-max"}><code>
          {lines.map((line, index) => (
            <span key={index} className="grid grid-cols-[3.5rem_minmax(0,1fr)] pr-4 hover:bg-white/[0.035]">
              <span aria-hidden="true" className="select-none border-r border-white/10 pr-3 text-right text-slate-500">{index + 1}</span>
              <span className={`pl-4 ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`} dangerouslySetInnerHTML={{ __html: line }} />
            </span>
          ))}
        </code></pre>
      </div>
    </div>
  );
}
