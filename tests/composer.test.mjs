import test from 'node:test';
import assert from 'node:assert/strict';
import { collageCells, exportSizes, framedImage, joinComposition, templates } from '../dist/composer.mjs';

test('join can preserve crop dimensions or fill the shared axis proportionally', () => {
  const photos = [{ width: 300, height: 200 }, { width: 350, height: 250, crop: { x: 40, y: 20, width: 100, height: 50 } }];
  const solid = joinComposition(photos, 'vertical', { fill: 'solid', color: '#123456', border: 10 });
  assert.deepEqual([solid.width, solid.height], [320, 280]);
  assert.deepEqual(solid.positions, [[10, 10], [110, 220]]);
  assert.deepEqual(solid.frame.at(-1), [10, 210, 300, 10]);
  assert.equal(solid.background, '#123456');
  const fit = joinComposition(photos, 'horizontal', { fill: 'resize', border: 10 });
  assert.deepEqual([fit.width, fit.height], [730, 220]);
  assert.deepEqual(fit.sizes, [{ width: 300, height: 200 }, { width: 400, height: 200 }]);
  assert.deepEqual(fit.positions, [[10, 10], [320, 10]]);
  assert.deepEqual(fit.regions[1], photos[1].crop);
  assert.equal(fit.background, null);
});

test('mixed-size cells share pixel-accurate gaps at phone export dimensions', () => {
  const phone = exportSizes.find(size => size.id === 'phone');
  const layout = templates.find(template => template.id === 'feature');
  assert.deepEqual(collageCells(layout, phone, 12), [
    { x: 12, y: 12, width: 1056, height: 942 },
    { x: 12, y: 966, width: 522, height: 942 },
    { x: 546, y: 966, width: 522, height: 942 },
  ]);
  for (const size of exportSizes) {
    for (const template of templates) {
      for (const border of [0, 12, 64]) {
        const cells = collageCells(template, size, border);
        assert.ok(cells.every(cell => cell.width > 0 && cell.height > 0
          && cell.x >= border && cell.y >= border
          && cell.x + cell.width <= size.width - border && cell.y + cell.height <= size.height - border));
        if (border === 0) assert.equal(cells.reduce((area, cell) => area + cell.width * cell.height, 0), size.width * size.height);
      }
    }
  }
});

test('collage framing covers the slot and preserves proportions while zooming or panning', () => {
  const cell = { width: 100, height: 100 };
  const photo = { width: 200, height: 100, zoom: 1, panX: .5, panY: .5 };
  assert.deepEqual(framedImage(photo, cell), { x: -50, y: 0, width: 200, height: 100 });
  assert.deepEqual(framedImage({ ...photo, zoom: 2, panX: 1, panY: .2 }, cell), { x: -300, y: -20, width: 400, height: 200 });
});
