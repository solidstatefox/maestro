const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

// Model the important RDF/JS types precisely: N3 DataFactory.quad's declared
// result permits arbitrary Term positions (BaseQuad), but N3 Writer.addQuads
// accepts a narrower Quad with a resource subject and NamedNode predicate.
const n3Declarations = `
declare module "n3" {
  export interface NamedNode { termType: "NamedNode"; value: string }
  export interface BlankNode { termType: "BlankNode"; value: string }
  export interface DefaultGraph { termType: "DefaultGraph"; value: string }
  export interface Literal { termType: "Literal"; value: string; language: string; datatype: NamedNode }
  export type Term = NamedNode | BlankNode | DefaultGraph | Literal;
  export interface BaseQuad { subject: Term; predicate: Term; object: Term; graph: Term }
  export interface Quad { subject: NamedNode | BlankNode; predicate: NamedNode; object: Term; graph: Term }
  export const DataFactory: {
    namedNode(value: string): NamedNode;
    blankNode(value: string): BlankNode;
    literal(value: string, languageOrDatatype?: string | NamedNode): Literal;
    quad(subject: NamedNode | BlankNode, predicate: NamedNode, object: Term): BaseQuad;
  };
  export class Writer {
    constructor(options: { format: string });
    addQuads(quads: Quad[]): void;
    end(done: (error: Error | null, output: string) => void): void;
  }
}
`;
function diagnosticsFor(source) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-record-quad-'));
  try {
    const modulePath = path.join(folder, 'record-export.ts');
    const stubsPath = path.join(folder, 'n3.d.ts');
    fs.writeFileSync(modulePath, source);
    fs.writeFileSync(stubsPath, n3Declarations);
    const program = ts.createProgram([modulePath, stubsPath], {
      strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts']
    });
    return ts.getPreEmitDiagnostics(program).map(d => ({
      code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, ' ')
    }));
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
test('Record exporter uses writer-compatible RDF/JS Quad instead of BaseQuad', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src/canvas/right/record-export.ts'), 'utf8');
  const errors = diagnosticsFor(source);
  assert.deepEqual(errors, [], `Record export TypeScript diagnostics: ${JSON.stringify(errors)}`);
});

test('type guard catches the original BaseQuad[] writer mismatch', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src/canvas/right/record-export.ts'), 'utf8');
  const regression = source
    .replace('type Quad = Parameters<Writer["addQuads"]>[0][number];', 'type Quad = ReturnType<typeof DataFactory.quad>;')
    .replace('DataFactory.quad(subjectTerm, DataFactory.namedNode(p), objectTerm) as Quad', 'DataFactory.quad(subjectTerm, DataFactory.namedNode(p), objectTerm)');
  const errors = diagnosticsFor(regression);
  assert.ok(errors.some(d => d.code === 2345 && /BaseQuad\[\]/.test(d.message)), `Expected TS2345 for old code; got: ${JSON.stringify(errors)}`);
});
