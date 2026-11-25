// Load the actual browser observation module in the test's isolated runtime.
// The only substituted resource is the test's network transport.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function loadTransportObservation(globals = {}) {
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/proxy-transport-observation.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: mod, exports: mod.exports, URL, Request, Response, Headers, Error, Event, DOMException, AbortController, AbortSignal, ...globals });
  return mod.exports;
}
module.exports = { loadTransportObservation };
