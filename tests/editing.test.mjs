import test from 'node:test';
import assert from 'node:assert/strict';
import { composition, groupInOrder, moveImage } from '../dist/core.mjs';
import { cropFromTrims, dragCrop, fitCrop, fullCrop } from '../dist/crop.mjs';

test('moving an image across groups changes composition order without mutating inputs', () => {
  const first = { name: 'a.png', width: 12, height: 20 };
  const second = { name: 'b.png', width: 18, height: 30 };
  const third = { name: 'c.png', width: 10, height: 12, crop: { x: 2, y: 2, width: 8, height: 9 } };
  const original = [first, second, third];
  const groups = groupInOrder(moveImage(original, 2, 0), 2);
  assert.deepEqual(original, [first, second, third]);
  assert.deepEqual(groups, [[third, first], [second]]);
  assert.deepEqual(composition(groups[0], 'horizontal'), {
    width: 20,
    height: 20,
    positions: [[0, 5], [8, 0]],
    regions: [third.crop, fullCrop(first)],
  });
  assert.deepEqual(composition(groups[0], 'vertical'), {
    width: 12,
    height: 29,
    positions: [[2, 0], [0, 9]],
    regions: [third.crop, fullCrop(first)],
  });
});

test('free and fixed-ratio crop gestures stay within the original pixels', () => {
  const image = { width: 300, height: 190 };
  const original = fullCrop(image);
  assert.deepEqual(dragCrop(image, original, 'se', -40, -20), { x: 0, y: 0, width: 260, height: 170 });
  const square = fitCrop(image, original, [1, 1]);
  assert.deepEqual(square, { x: 55, y: 0, width: 190, height: 190 });
  const reduced = dragCrop(image, square, 'nw', 90, 40, [1, 1]);
  assert.deepEqual(reduced, { x: 120, y: 65, width: 125, height: 125 });
  assert.deepEqual(dragCrop(image, reduced, 'move', 500, -500), { x: 175, y: 0, width: 125, height: 125 });
  assert.equal(fitCrop({ width: 2, height: 2 }, { x: 0, y: 0, width: 2, height: 2 }, [4, 3]), null);
});

test('pixel trims reject invalid rectangles and allow a one-pixel crop', () => {
  const image = { width: 300, height: 190 };
  assert.deepEqual(cropFromTrims(image, [25, 10, 20, 30]), { x: 25, y: 10, width: 255, height: 150 });
  assert.deepEqual(cropFromTrims(image, [299, 189, 0, 0]), { x: 299, y: 189, width: 1, height: 1 });
  for (const input of [[-1, 0, 0, 0], [5, 10, 295, 0], [0, 0, 0, NaN], [2.5, 0, 0, 0]]) {
    assert.equal(cropFromTrims(image, input), null);
  }
});
