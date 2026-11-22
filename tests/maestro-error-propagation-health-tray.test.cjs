'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function compileTs(file, injected = {}) {
  const compiled = ts.transpileModule(read(file), { fileName: file, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  }});
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)(
    name => Object.hasOwn(injected, name) ? injected[name] : require(name), mod, mod.exports,
  );
  return mod.exports;
}
const upstream = compileTs('src/lib/upstream-error.ts');
const health = compileTs('src/lib/sparql-health-probe.ts', { '@/lib/upstream-error': upstream });

test('nested network cause is preserved instead of status:null/unreachable alone', async () => {
  const err = new TypeError('fetch failed', {
    cause: Object.assign(new Error('getaddrinfo ENOTFOUND linkeddata.uriburner.com'), { code: 'ENOTFOUND' }),
  });
  const result = await health.probeSparqlEndpoint('https://linkeddata.uriburner.com/sparql', {
    fetcher: async () => { throw err; }, timeoutMs: 1200,
  });
  assert.equal(result.state, 'unreachable');
  assert.equal(result.status, null);
  assert.equal(result.attempts.length, 4);
  assert.ok(result.attempts.every(a => a.error.includes('ENOTFOUND')));
  assert.match(result.diagnostic, /linkeddata\.uriburner\.com/);
  assert.equal(result.attempts[0].errorName, 'TypeError');
});

test('HTTP status, original message, headers, redirect and safe body reach the health result', async () => {
  const result = await health.probeSparqlEndpoint('https://linkeddata.uriburner.com/sparql', {
    fetcher: async () => new Response('Virtuoso SR619: Authorization: Bearer secret-xyz\n?', {
      status: 503, statusText: 'Service Unavailable',
      headers: { 'content-type': 'text/plain', 'server': 'Virtuoso', 'set-cookie': 'sid=secret',
        'location': 'https://linkeddata.uriburner.com/sparql?access_token=secret123',
        'x-session-token': 'dont-echo-this' },
    }),
  });
  assert.equal(result.status, 503);
  assert.equal(result.state, 'server-error');
  assert.match(result.attempts[0].responseBody, /SR619/);
  assert.doesNotMatch(result.attempts[0].responseBody, /secret-xyz/);
  assert.equal(result.attempts[0].statusText, 'Service Unavailable');
  assert.equal(result.attempts[0].responseHeaders.server, 'Virtuoso');
  assert.equal(result.attempts[0].responseHeaders['set-cookie'], undefined);
  assert.equal(result.attempts[0].responseHeaders['x-session-token'], undefined);
  assert.doesNotMatch(result.attempts[0].location, /secret123/);
});

test('HTTP 200 HTML editor is probe-error with actual HTTP 200, not success or unreachable', async () => {
  const result = await health.probeSparqlEndpoint('https://linkeddata.uriburner.com/sparql', {
    fetcher: async () => new Response('<html>SPARQL editor</html>', {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  });
  assert.equal(result.state, 'probe-error');
  assert.equal(result.status, 200);
  assert.equal(result.attempts[0].responseBody, '<html>SPARQL editor</html>');
  assert.match(read('src/canvas/top/appbar.tsx'), /httpStatus === 200 && status\.state === "ok"/);
});

test('no approved regex derivation -> the tray action is filtered before allocating quota', () => {
  const src = read('src/canvas/left/derived-facet-button.tsx');
  assert.match(src, /when: Boolean\(source && fields\.length\)/);
  assert.match(src, /approval\.revision === approvalRevision && approval\.sessionKey === sessionKey/);
  assert.match(src, /discoverApprovedRegexDerivations\(property, controller\.signal\)/);
  assert.match(read('src/canvas/left/personal-widget-cards.tsx'), /<PersonalFacetButtonTray source=\{boundNode\}/);
});

test('four visible tray actions, then ellipsis, all direct controls obey header hover', () => {
  const tray = read('src/components/ui/left-widget-button-tray.tsx');
  assert.match(tray, /threshold = 4/);
  assert.match(tray, /available\.slice\(0, directButtons\)/);
  assert.match(tray, /available\.slice\(directButtons\)/);
  assert.match(tray, /data-tray-action=\{action\.id\}.*opacity-0.*group-hover\/header:opacity-100/);
});

test('health client preserves HTTP response and thrown transport cause', () => {
  const client = read('src/canvas/utils/workspace-controller.tsx');
  assert.match(client, /diagnostic: sanitizeUpstreamDiagnostic\(\[`Proxy HTTP/);
  assert.match(client, /diagnostic: describeUpstreamError\(error, "Health proxy request failed"\)/);
  // The health ledger moved from the workspace controller into the XState
  // actor. It must preserve all probe evidence (including attempts) and
  // suppress only identical *complete* status snapshots.
  const healthActor = read('src/lib/app-lifecycle/graph-server-health-actor.ts');
  const healthState = read('src/canvas/controllers/graph-servers.ts');
  assert.match(client, /reportGraphHealthProbe\(status, probeStartedAt\)/);
  assert.match(healthState, /healthController\.reportProbe\(status, startedAt\)/);
  assert.match(healthActor, /JSON\.stringify\(current\) === JSON\.stringify\(status\)/);
  assert.match(healthActor, /statuses: \{ \.\.\.context\.statuses, \[status\.id\]: status \}/);

});


test('fullscreen Record normal-click highlight pads only the selected RDFa value', () => {
  const css = read('src/canvas/right/record-source-highlight.css');
  assert.match(css, /\[data-maestro-followed-source="true"\][\s\S]*?padding:\s*0\.125rem 0\.375rem/);
  assert.match(css, /box-decoration-break:\s*clone/);
  const code = read('src/canvas/controllers/record-rdfa-decoration.ts');
  assert.match(code, /selected\.setAttribute\("data-maestro-followed-source", "true"\)/);
});


test('a response-body read failure retains the upstream HTTP status and its actual error', async () => {
  const result = await health.probeSparqlEndpoint('https://linkeddata.uriburner.com/sparql', {
    fetcher: async () => ({ status: 503, statusText: 'Service Unavailable', ok: false,
      headers: new Headers({ 'content-type': 'application/sparql-results+json' }),
      url: 'https://linkeddata.uriburner.com/sparql',
      text: async () => { throw Object.assign(new Error('body stream disconnected'), { code: 'ECONNRESET' }); },
    }),
  });
  assert.equal(result.status, 503);
  assert.equal(result.state, 'server-error');
  assert.match(result.attempts[0].error, /ECONNRESET/);
  assert.equal(result.attempts[0].statusText, 'Service Unavailable');
});
