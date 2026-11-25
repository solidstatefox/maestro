import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Sankey 3 uses shadcn form controls without redesigning the existing toolbar', () => {
  const d3=read('src/canvas/tab/analyze/d3-sankey.tsx');
  const checkbox=read('src/components/ui/checkbox.tsx');
  for(const control of ['Select','SelectContent','SelectItem','SelectTrigger','SelectValue','Slider','Checkbox','Label','Button'])
    assert.match(d3,new RegExp(`\\b${control}\\b`),control);
  assert.match(checkbox,/Checkbox as CheckboxPrimitive.*from "radix-ui"/);
  assert.match(d3,/role="group" aria-label="D3 Sankey layout controls" className="flex w-full flex-wrap items-end gap-3 rounded-md border bg-muted\/20 px-3 py-2"/);
  assert.doesNotMatch(d3,/<Card|<CardHeader|<CardContent|<Switch|<ButtonGroup/);
  const markup=d3.split('<div role="group" aria-label="D3 Sankey layout controls"')[1]?.split('{graph.error ?')[0];
  assert.ok(markup,'expected original D3 toolbar region');
  assert.doesNotMatch(markup,/<(?:button|input|select|option)\b/);
  const ordered=['Node alignment','Link color','Multicolor columns','Show all streams','Colors by node stage','Node order',
    'Node width','Node padding','Label padding','Node border','Iterations','Ribbons','Nodes','Ribbon blend mode',
    'Chart width','Chart height','Labels','Zoom out','Zoom in','Reset zoom and pan'];
  let position=-1;
  for(const item of ordered){const next=markup.indexOf(item,position+1);assert.ok(next>position,`${item}: order changed`);position=next;}
  assert.match(markup,/selectedNode!==null && <Button/);
  assert.doesNotMatch(markup,/multicolorColumns && selectedNode/);
  assert.match(d3,/const streamFocus=useMemo\(\(\)=>selectedNode!==null/);
  assert.match(d3,/\[graph\.links,selectedNode\]/);
  for(const expr of [
    'min={4} max={40} step={2} value={nodeWidth}',
    'min={0} max={40} step={2} value={nodePadding}',
    'min={0} max={24} step={2} value={labelPadding}',
    'min={0} max={3} step={0.5} value={nodeStrokeWidth}',
    'min={0} max={64} step={4} value={iterations}',
    'min={0.1} max={1} step={0.05} value={linkOpacity}',
    'min={0.2} max={1} step={0.05} value={nodeOpacity}',
    'min={100} max={200} step={10} value={widthMultiplier}',
    'setZoom(v=>clamp(v/1.25,0.3,4))',
    'setZoom(v=>clamp(v*1.25,0.3,4))',
    'onClick={reset}',
  ])assert.ok(markup.includes(expr),`altered original control configuration: ${expr}`);
  for(const guard of ['sankey<Node,Link>()','traceSankeyStreams','setPointerCapture','onOpenResource(node.uri)'])
    assert.ok(d3.includes(guard),`changed analysis logic: ${guard}`);
});

test('outer Sankey provider pagination and navigation are unchanged',()=>{
  const source=read('src/canvas/tab/analyze/sankey.tsx');
  assert.doesNotMatch(source,/ButtonGroup aria-label="Sankey page navigation"/);
  assert.match(source,/<button type="button" className="rounded border px-3 py-1.5 disabled:opacity-40" aria-label="Previous Sankey page"/);
  assert.match(source,/workspace.changeResultsPage\(-1\)/);
  assert.match(source,/workspace.changeResultsPage\(1\)/);
});
