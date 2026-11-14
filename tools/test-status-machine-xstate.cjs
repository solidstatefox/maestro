/* Run after npm.cmd install xstate@^5:
   node --experimental-strip-types tools/test-status-machine-xstate.cjs */
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
(async () => {
  const {STATUS_MUI: M, STATUS_RDFS: R, compileStatusMachines, clearCompiledStatusMachines,
    machineForTarget, effectiveStatus, transitionStatus} = await import(pathToFileURL(path.resolve(__dirname, '../src/lib/status-machine-runtime.ts')).href);
  const uri = item => M + item;
  const row = (machine, target, dimension, initial, from, trigger, to) => ({
    machine: uri(machine), target: uri(target), dimension: uri(dimension),
    initial: uri(initial), from: uri(from), trigger: uri(trigger), to: uri(to),
  });
  const rows = [
    {...row('ResourceFSM', 'Provider', 'ReadStatus', 'Unseen', 'Unseen', 'ViewRecord', 'Seen'), target: R + 'Resource'},
    {...row('ResourceFSM', 'Provider', 'ReadStatus', 'Unseen', 'Seen', 'MarkUnread', 'Unseen'), target: R + 'Resource'},
    {...row('ResourceFSM', 'Provider', 'VisibilityStatus', 'Visible', 'Visible', 'Hide', 'Hidden'), target: R + 'Resource'},
    {...row('ResourceFSM', 'Provider', 'VisibilityStatus', 'Visible', 'Hidden', 'Unhide', 'Visible'), target: R + 'Resource', assertState:'false'},
    {...row('ResourceFSM', 'Provider', 'StarStatus', 'Unstarred', 'Unstarred', 'Star', 'Starred'), target: R + 'Resource'},
    {...row('ResourceFSM', 'Provider', 'StarStatus', 'Unstarred', 'Starred', 'Unstar', 'Unstarred'), target: R + 'Resource', assertState:'false'},
    row('ApprovalFSM','Provider','ApprovalStatus','Pending','Pending','Approve','Approved'),
    row('ApprovalFSM','Provider','ApprovalStatus','Pending','Approved','RevokeApproval','Pending'),
    {...row('ApprovalFSM','Provider','ApprovalStatus','Pending','Pending','Approve','Approved'),target:uri('ClassPolicy')},
    {...row('ApprovalFSM','Provider','ApprovalStatus','Pending','Approved','RevokeApproval','Pending'),target:uri('ClassPolicy')},
  ];
  const machines = compileStatusMachines(rows);
  assert.equal(compileStatusMachines([...rows]), machines, 'same definitions reuse compiled machine');
  const resource = machineForTarget(machines, R+'Resource');
  assert.deepEqual(effectiveStatus(resource, []), {
    [uri('ReadStatus')]:uri('Unseen'),
    [uri('VisibilityStatus')]:uri('Visible'),
    [uri('StarStatus')]:uri('Unstarred'),
  });
  const seen = transitionStatus(resource, [], uri('ViewRecord'));
  assert.equal(seen.add, uri('Seen'));
  assert.deepEqual(seen.remove, []);
  const hidden = transitionStatus(resource, [uri('Seen')], uri('Hide'));
  assert.equal(hidden.add, uri('Hidden'));
  assert.deepEqual(hidden.remove, []);
  const unhidden = transitionStatus(resource, [uri('Seen'),uri('Hidden')],uri('Unhide'));
  assert.equal(unhidden.add, null, 'virtual Visible is not written');
  assert.deepEqual(unhidden.remove, [uri('Hidden')]);
  const unstarred = transitionStatus(resource,[uri('Starred'),uri('Seen')],uri('Unstar'));
  assert.equal(unstarred.add, null);
  assert.deepEqual(unstarred.remove,[uri('Starred')]);
  assert.throws(()=>transitionStatus(resource,[uri('Seen')],uri('ViewRecord')), /not allowed/);
  assert.throws(()=>effectiveStatus(resource,[uri('Seen'),uri('Unseen')]), /Conflicting/);
  const approval = machineForTarget(machines,uri('ClassPolicy'));
  assert.equal(approval, machineForTarget(machines,uri('Provider')));
  assert.equal(effectiveStatus(approval,[])[uri('ApprovalStatus')],uri('Pending'));
  assert.equal(transitionStatus(approval,[],uri('Approve')).add,uri('Approved'));
  clearCompiledStatusMachines();
  assert.notEqual(compileStatusMachines(rows),machines,'clear invalidates cached definitions');
  console.log('XState v5: RDF adapter, parallel tracks, effective initials, protected transitions and cache passed.');
})().catch(error => { console.error(error); process.exitCode=1; });
