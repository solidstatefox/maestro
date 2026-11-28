const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,"../src/lib/query-queue-observation.ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,WeakMap});
module.exports = mod.exports;
