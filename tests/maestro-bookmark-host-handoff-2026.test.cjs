const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const source=fs.readFileSync('src/lib/bookmark-host-handoff.ts','utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};
vm.runInNewContext(code,{module:mod,exports:mod.exports,URL}, {filename:'bookmark-host-handoff.ts'});
const {bookmarkAtCurrentHost}=mod.exports;
const parse=xml=>xml.startsWith('<query ') && xml.includes('addr=');
const xml='<query addr="$ALL$@https://cordis.europa.eu/datalab/sparql" id="a"><property id="t" iri="urn:test"/><view type="text" id="s"/></query>';

test('cross-host handoff retains exact q/addr/filter IDs, UI state, History cursor, hash',()=>{
 const saved=new URL('https://maestro.example.org/');
 saved.searchParams.set('q',xml);saved.searchParams.set('tab','1');saved.searchParams.set('state','{"resultsUiPage":3}');saved.searchParams.set('history','gttp://history#abc');saved.hash='#bookmark';
 const restored=bookmarkAtCurrentHost(saved.href,'http://localhost:3000/?q=old','',parse);
 const u=new URL(restored);
 assert.equal(u.origin,'http://localhost:3000');
 assert.equal(u.searchParams.get('q'),xml);
 assert.equal(u.searchParams.get('state'),'{"resultsUiPage":3}');
 assert.equal(u.searchParams.get('history'),'gttp://history#abc');
 assert.equal(u.searchParams.get('tab'),'1');assert.equal(u.hash,'#bookmark');
});

test('invalid q recovers only from its own Bookmarks stored XML',()=>{
 const url='https://maestro.example.org/?q=%3Cmalformed%3E&tab=0';
 const fixed=bookmarkAtCurrentHost(url,'http://localhost:3000/',xml,parse);
 assert.equal(new URL(fixed).searchParams.get('q'),xml);
 assert.equal(bookmarkAtCurrentHost(url,'http://localhost:3000/','',parse),null);
 assert.equal(bookmarkAtCurrentHost('javascript:alert(1)','http://localhost:3000/',xml,parse),null);
});

test('a throwing malformed q parser still falls back to the saved Bookmark XML',()=>{
 const current='http://localhost:3000/', saved='https://demo.example.org/?q=broken&tab=0';
 const canonical='<query xmlns="http://openlinksw.com/services/facets/1.0" addr="$ALL$@https://cordis.europa.eu/datalab/sparql"/>';
 const restored=bookmarkAtCurrentHost(saved,current,canonical,xml=>{if(xml==='broken')throw Error('malformed XML');return xml.includes('<query ')});
 assert.equal(new URL(restored).searchParams.get('q'),canonical);
});
