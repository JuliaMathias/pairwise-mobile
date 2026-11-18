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

function grid(columns, rows) {
  return Array.from({ length: columns * rows }, (_, i) => [i % columns, Math.floor(i / columns), 1, 1]);
}

export const templates = [
  { id: 'duo', name: 'Side by side', columns: 2, rows: 1, cells: grid(2, 1) },
  { id: 'stack', name: 'Stacked pair', columns: 1, rows: 2, cells: grid(1, 2) },
  { id: 'triptych', name: 'Three columns', columns: 3, rows: 1, cells: grid(3, 1) },
  { id: 'three-rows', name: 'Three rows', columns: 1, rows: 3, cells: grid(1, 3) },
  { id: 'feature', name: 'Wide lead', columns: 2, rows: 2, cells: [[0, 0, 2, 1], [0, 1, 1, 1], [1, 1, 1, 1]] },
  { id: 'feature-left', name: 'Tall lead', columns: 2, rows: 2, cells: [[0, 0, 1, 2], [1, 0, 1, 1], [1, 1, 1, 1]] },
  { id: 'quad', name: '2 × 2 grid', columns: 2, rows: 2, cells: grid(2, 2) },
  { id: 'four-feature', name: 'Wide lead + three', columns: 3, rows: 2, cells: [[0, 0, 3, 1], [0, 1, 1, 1], [1, 1, 1, 1], [2, 1, 1, 1]] },
  { id: 'four-strips', name: 'Four rows', columns: 1, rows: 4, cells: grid(1, 4) },
  { id: 'five', name: 'Two + three', columns: 6, rows: 2, cells: [[0, 0, 3, 1], [3, 0, 3, 1], [0, 1, 2, 1], [2, 1, 2, 1], [4, 1, 2, 1]] },
  { id: 'five-tall', name: 'Two beside three', columns: 2, rows: 6, cells: [[0, 0, 1, 3], [0, 3, 1, 3], [1, 0, 1, 2], [1, 2, 1, 2], [1, 4, 1, 2]] },
  { id: 'six', name: '2 × 3 grid', columns: 2, rows: 3, cells: grid(2, 3) },
  { id: 'six-wide', name: '3 × 2 grid', columns: 3, rows: 2, cells: grid(3, 2) },
  { id: 'seven', name: 'Wide lead + six', columns: 3, rows: 3, cells: [[0, 0, 3, 1], ...grid(3, 2).map(([x, y, w, h]) => [x, y + 1, w, h])] },
  { id: 'eight', name: '2 × 4 grid', columns: 2, rows: 4, cells: grid(2, 4) },
  { id: 'nine', name: '3 × 3 grid', columns: 3, rows: 3, cells: grid(3, 3) },
];

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
    const usable = length - (divisions + 1) * border;
    const start = Math.round(usable * offset / divisions) + (offset + 1) * border;
    const end = Math.round(usable * (offset + span) / divisions) + (offset + span) * border;
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
