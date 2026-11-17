import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../src");
function* sourceFiles(directory) {
  for (const dirent of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, dirent.name);
    if (dirent.isDirectory()) yield* sourceFiles(file);
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file)) yield file;
  }
}

test("application logging is routed through Maestro logger, not raw console", () => {
  const bypasses = [];
  for (const file of sourceFiles(root)) {
    const name = relative(root, file).replaceAll("\\", "/");
    if (name.startsWith("scripts/migration/")) continue; // intentional CLI progress
    const code = readFileSync(file, "utf8");
    for (const match of code.matchAll(/\b(?:console\.(?:log|debug|info|warn|error|trace|table)|process\.(?:stdout|stderr)\.write)\s*\(/g)) {
      bypasses.push(`${name}:${code.slice(0, match.index).split("\n").length}`);
    }
  }
  assert.deepEqual(bypasses, []);
});

test("the browser facade uses Pino and respects Sheet severity preferences", () => {
  const source = readFileSync(join(root, "lib/maestro-client-logging.ts"), "utf8");
  assert.match(source, /import pino from "pino"/);
  assert.match(source, /logger\.level = active \? level : "silent"/);
  assert.match(source, /response\.status === 504 \? "debug"/);
  assert.doesNotMatch(source, /response\.clone\(\)\.text\(\)/);
});
