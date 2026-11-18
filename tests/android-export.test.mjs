import assert from 'node:assert/strict';
import test from 'node:test';

test('Android export sends exact bytes in bounded chunks and handles cancellation', async () => {
  const payload = Uint8Array.from({ length: 400_000 }, (_, index) => index % 251);
  const chunks = [];
  let nextStatus = 'saved';
  let cancelled;
  globalThis.FileReader = class {
    async readAsDataURL(blob) {
      this.result = `data:application/octet-stream;base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
      this.onload();
    }
  };
  globalThis.PairwiseAndroid = {
    beginSave(name) {
      assert.equal(name, 'joined.png');
      return 'export-id';
    },
    appendSave(id, data) {
      assert.equal(id, 'export-id');
      assert.ok(data.length <= 262_144);
      chunks.push(Buffer.from(data, 'base64'));
      return true;
    },
    finishSave(id) {
      queueMicrotask(() => globalThis.pairwiseAndroidSaveResult(id, nextStatus));
      return true;
    },
    cancelSave(id) { cancelled = id; },
  };

  const { downloadBlob } = await import('../dist/photos.mjs');
  assert.equal(await downloadBlob(new Blob([payload]), 'joined.png'), 'saved');
  assert.equal(chunks.length, 3);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(payload));
  nextStatus = 'cancelled';
  assert.equal(await downloadBlob(new Blob(['test']), 'joined.png'), 'cancelled');
  nextStatus = 'Write failed.';
  await assert.rejects(downloadBlob(new Blob(['test']), 'joined.png'), /Write failed/);
  assert.equal(cancelled, 'export-id');
});
