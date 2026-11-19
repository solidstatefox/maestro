/** Read-only module reachability audit; no code is deleted. Run:
 *   node tools/audit-unused-sources.mjs
 * This is an import-graph audit, not a complete symbol-level proof. XSLT
 * providers are loaded from graph/manifest.json, not TypeScript imports. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanned = ['src', 'scripts', 'tools', 'tests'];
const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.scss'];
const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (extensions.some(ext => file.endsWith(ext))) files.push(file);
  }
}
for (const dir of scanned) walk(path.join(base, dir));
const all = new Set(files);
const imports = new Map();
const unresolved = [];
function resolveImport(origin, spec) {
  let target;
  if (spec.startsWith('@/')) target = path.join(base, 'src', spec.slice(2));
  else if (spec.startsWith('.')) target = path.resolve(path.dirname(origin), spec);
  else return undefined;
  return [target, ...extensions.map(ext => target + ext),
    ...extensions.map(ext => path.join(target, 'index' + ext))].find(candidate => all.has(candidate));
}
function add(origin, spec) {
  const resolved = resolveImport(origin, spec);
  if (resolved) imports.get(origin).add(resolved);
  else if (spec.startsWith('.') || spec.startsWith('@/')) {
    if (!spec.endsWith('.node')) unresolved.push([path.relative(base, origin), spec]);
  }
}
for (const file of files) {
  imports.set(file, new Set());
  const kind = path.extname(file);
  if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(kind)) continue;
  const code = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true,
    kind === '.tsx' || kind === '.jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) add(file, node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(callee) && callee.text === 'require')) add(file, node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const entry = files.filter(file => {
  const rel = path.relative(base, file).replaceAll('\\', '/');
  return /^src\/app\/(?:.*\/)?(?:page|layout|route|template|error|not-found|loading|default|global-error)\.[jt]sx?$/.test(rel) ||
    /^src\/(?:instrumentation|middleware|proxy)\.[jt]s$/.test(rel) ||
    rel === 'src/app/globals.css' || rel.startsWith('src/scripts/') ||
    rel.startsWith('scripts/') || rel.startsWith('tools/');
});
function reachable(start) {
  const known = new Set(start);
  const queue = [...start];
  for (let i = 0; i < queue.length; ++i) {
    for (const next of imports.get(queue[i]) ?? []) {
      if (!known.has(next)) { known.add(next); queue.push(next); }
    }
  }
  return known;
}
const used = reachable(entry);
const testOnly = reachable(files.filter(file => file.includes(`${path.sep}tests${path.sep}`)));
const modules = files.filter(file => file.includes(`${path.sep}src${path.sep}`));
const candidates = modules.filter(file => !used.has(file));
const ambient = candidates.filter(file => file.endsWith('.d.ts'));
const tested = candidates.filter(file => testOnly.has(file) && !ambient.includes(file));
const unused = candidates.filter(file => !testOnly.has(file) && !ambient.includes(file));
console.log(`Maestro: ${modules.length} source files, ${modules.length - candidates.length} entry-reachable, ${candidates.length} exceptions.`);
for (const [label, group] of [['Unused candidate', unused], ['Test-only', tested], ['Ambient declaration', ambient]]) {
  for (const file of group) console.log(`${label}: ${path.relative(base, file).replaceAll('\\', '/')}`);
}
for (const [file, spec] of unresolved) if (spec !== '../../package.json')
  console.log(`Unresolved import: ${file} -> ${spec}`);
console.log('Scope: native imports and literal dynamic imports only. RDF/XSLT providers, external packages, computed paths, individual exports, generated public assets, and manual CLI usage require separate review.');
