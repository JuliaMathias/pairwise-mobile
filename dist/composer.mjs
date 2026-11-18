import { composition, layout } from './core.mjs';

export function joinComposition(images, direction, { fill = 'transparent', color = '#ffffff', border = 0 } = {}) {
  const original = composition(images, direction);
  const vertical = direction === 'vertical';
  const sizes = original.regions.map(({ width, height }) => {
    if (fill !== 'resize') return { width, height };
    return vertical
      ? { width: original.width, height: Math.max(1, Math.round(height * original.width / width)) }
      : { width: Math.max(1, Math.round(width * original.height / height)), height: original.height };
  });
  const plan = layout(sizes, direction);
  const width = plan.width + border * (vertical ? 2 : images.length + 1);
  const height = plan.height + border * (vertical ? images.length + 1 : 2);
  const positions = plan.positions.map(([x, y], i) => [
    x + border * (vertical ? 1 : i + 1),
    y + border * (vertical ? i + 1 : 1),
  ]);
  const frame = [
    [0, 0, width, border],
    [0, height - border, width, border],
    [0, border, border, height - 2 * border],
    [width - border, border, border, height - 2 * border],
  ];
  for (const [x, y] of positions.slice(1)) {
    frame.push(vertical
      ? [border, y - border, plan.width, border]
      : [x - border, border, border, plan.height]);
  }
  return { width, height, positions, sizes, regions: original.regions, background: fill === 'solid' ? color : null, frame };
}

export { matchingLayouts, templates } from './collage-layouts.mjs';

export const exportSizes = [
  { id: 'square', name: 'Square · 1:1', width: 1080, height: 1080 },
  { id: 'phone', name: 'Phone / Story · 9:16', width: 1080, height: 1920 },
  { id: 'portrait', name: 'Portrait · 4:5', width: 1080, height: 1350 },
  { id: 'landscape', name: 'Landscape · 3:2', width: 1800, height: 1200 },
  { id: 'wide', name: 'Widescreen · 16:9', width: 1920, height: 1080 },
  { id: 'phone-tall', name: 'Tall phone · 19.5:9 portrait', width: 1080, height: 2340 },
];

export function collageCells(template, { width, height }, border) {
  const axis = (offset, span, length, divisions) => {
    const usable = length - 2 * border;
    const half = Math.floor(border / 2);
    const start = border + Math.round(usable * offset / divisions) + (offset === 0 ? 0 : border - half);
    const end = border + Math.round(usable * (offset + span) / divisions) - (offset + span === divisions ? 0 : half);
    return [start, end - start];
  };
  return template.cells.map(([column, row, columns, rows]) => {
    const [x, w] = axis(column, columns, width, template.columns);
    const [y, h] = axis(row, rows, height, template.rows);
    return { x, y, width: w, height: h };
  });
}

export function framedImage(photo, cell) {
  const scale = Math.max(cell.width / photo.width, cell.height / photo.height) * photo.zoom;
  const width = photo.width * scale;
  const height = photo.height * scale;
  return {
    x: (cell.width - width) * photo.panX,
    y: (cell.height - height) * photo.panY,
    width,
    height,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Keep the image point under the initial touch midpoint anchored during a pinch. */
export function gestureFraming(photo, cell, start, end, scale) {
  const before = framedImage(photo, cell);
  const zoom = clamp(photo.zoom * scale, 1, 4);
  const after = framedImage({ ...photo, zoom }, cell);
  const pan = (sourceStart, destinationStart, oldOffset, oldLength, newLength, cellLength, current) => {
    const slack = cellLength - newLength;
    if (slack >= -1e-8) return current;
    const relative = (sourceStart - oldOffset) / oldLength;
    return clamp((destinationStart - relative * newLength) / slack, 0, 1);
  };
  return {
    zoom,
    panX: pan(start.x, end.x, before.x, before.width, after.width, cell.width, photo.panX),
    panY: pan(start.y, end.y, before.y, before.height, after.height, cell.height, photo.panY),
  };
}
