import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordFormatMemoryController } from '../src/lib/app-lifecycle/record-format-memory';

test('record category format memory is opt-in, pinned only, and isolated per workspace', () => {
  const first = createRecordFormatMemoryController();
  const second = createRecordFormatMemoryController();
  first.start(); second.start();
  assert.equal(first.captureMode().ready, false);
  assert.equal(first.setPinned(true), false, 'UI cannot pin until preference hydration settles');
  assert.equal(first.restore(false, first.captureMode().isCurrent), true);
  assert.equal(second.restore(false, second.captureMode().isCurrent), true);
  assert.equal(first.isPinned(), false);
  first.setPinned(true);
  assert.equal(first.isPinned(), true);
  assert.equal(second.isPinned(), false);
  const pinned = first.getSnapshot();
  first.setPinned(false);
  assert.equal(first.isPinned(), false);
  first.setPinned(true);
  assert.notEqual(first.getSnapshot(), pinned, 'old in-flight preference reads cannot outlive an unpin/repin');
  first.stop(); second.stop();
  first.start();
  assert.equal(first.isPinned(), false);
  first.stop();
});


test('restoration, pinned reads and automatic furl permissions are invalidated by transitions', () => {
  const controller = createRecordFormatMemoryController();
  controller.start();
  const hydration = controller.captureMode();
  assert.equal(controller.restore(true, hydration.isCurrent), true);
  assert.equal(hydration.isCurrent(), false);
  const pinnedRead = controller.captureMode();
  assert.equal(pinnedRead.pinned, true);
  assert.equal(controller.restore(false, hydration.isCurrent), false, 'late restoration cannot overwrite current pin');
  controller.setPinned(false);
  const automatic = controller.captureMode();
  assert.equal(automatic.ready, true);
  assert.equal(automatic.pinned, false);
  controller.setPinned(true);
  assert.equal(pinnedRead.isCurrent(), false, 'unpin/repin does not resurrect old IndexedDB reads');
  assert.equal(automatic.isCurrent(), false, 'old automatic formatting cannot furl the header after pin');
  const current = controller.captureMode();
  controller.setPinned(true);
  assert.equal(current.isCurrent(), true, 'no-op pin does not invalidate active work');
  controller.stop(); controller.start();
  assert.equal(current.isCurrent(), false, 'restart invalidates all old leases');
  assert.equal(controller.captureMode().ready, false);
  assert.equal(controller.restore(false, hydration.isCurrent), false, 'old restoration cannot cross actor lifetimes');
  assert.equal(controller.restore(false, controller.captureMode().isCurrent), true);
  controller.stop();
});
