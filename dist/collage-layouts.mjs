// Each letter labels one rectangular opening. Reading order determines initial photo order.
function pattern(id, name, rows) {
  const bounds = new Map();
  rows.forEach((row, y) => [...row].forEach((letter, x) => {
    const cell = bounds.get(letter);
    if (cell) {
      cell[2] = Math.max(cell[2], x - cell[0] + 1);
      cell[3] = Math.max(cell[3], y - cell[1] + 1);
    } else {
      bounds.set(letter, [x, y, 1, 1]);
    }
  }));
  return { id, name, columns: rows[0].length, rows: rows.length, cells: [...bounds.values()] };
}

function transpose(layout, id, name) {
  const cells = layout.cells.map(([x, y, w, h]) => [y, x, h, w]);
  cells.sort(([ax, ay], [bx, by]) => ay - by || ax - bx);
  return { id, name, columns: layout.rows, rows: layout.columns, cells };
}

const pairs = [
  ['duo', 'Side by side', ['AB'], 'stack', 'Stacked pair'],
  ['triptych', 'Three columns', ['ABC'], 'three-rows', 'Three rows'],
  ['feature', 'Wide lead', ['AA', 'BC'], 'feature-left', 'Tall lead'],
  ['four-feature', 'Wide lead + three', ['AAA', 'BCD'], 'four-tall', 'Tall lead + three'],
  ['four-columns', 'Four columns', ['ABCD'], 'four-strips', 'Four rows'],
  ['four-step', 'Stepped panels', ['AAB', 'CCB', 'DDB'], 'four-step-side', 'Offset columns'],
  ['four-edges', 'Split center', ['AAAA', 'BBCC', 'DDDD'], 'four-edges-side', 'Split spine'],
  ['five', 'Two + three', ['AAABBB', 'CCDDEE'], 'five-tall', 'Two beside three'],
  ['five-lead', 'Header + four', ['AAAA', 'BCDE'], 'five-spine', 'Spine + four'],
  ['five-pinwheel', 'Pinwheel', ['AAB', 'DCB', 'DEE'], 'five-wheel-left', 'Reverse pinwheel'],
  ['five-stairs', 'Stepped story', ['AAAB', 'CCDB', 'EEEB'], 'five-stairs-side', 'Side staircase'],
  ['five-ribbon', 'Center ribbon', ['AABB', 'CCCC', 'DDEE'], 'five-column', 'Center column'],
  ['six-wide', '3 × 2 grid', ['ABC', 'DEF'], 'six', '2 × 3 grid'],
  ['six-feature', 'Wide centerpiece', ['AAAA', 'BCDE', 'FFFF'], 'six-spine', 'Framed spine'],
  ['six-step', 'Stepped mosaic', ['AAAB', 'CCDB', 'EEFB'], 'six-step-side', 'Offset mosaic'],
  ['six-band', 'Two + four', ['AABB', 'CDEF'], 'six-band-side', 'Two beside four'],
  ['six-zigzag', 'Zigzag', ['AAB', 'CCD', 'EED', 'FFF'], 'six-zigzag-side', 'Side zigzag'],
  ['seven', 'Wide lead + six', ['AAA', 'BCD', 'EFG'], 'seven-side', 'Tall lead + six'],
  ['seven-two', 'Two + five', ['AAAAABBBBB', 'CCDDEEFFGG'], 'seven-two-side', 'Two beside five'],
  ['seven-editorial', 'Editorial steps', ['AABC', 'DEEC', 'FGGC'], 'seven-ed-side', 'Editorial columns'],
  ['seven-strip', 'Wraparound strip', ['AAA', 'BCD', 'EFG', 'EFG'], 'seven-strip-side', 'Side strip'],
  ['seven-center', 'Two caps + five', ['AABBB', 'CDEFG', 'CDEFG'], 'seven-center-side', 'Split rail'],
  ['seven-columns', 'Three + one + three', ['ABC', 'DDD', 'EFG'], 'seven-rail', 'Three along each side'],
  ['eight', '2 × 4 grid', ['AB', 'CD', 'EF', 'GH'], 'eight-wide', '4 × 2 grid'],
  ['eight-columns', 'Three + five', ['AAAAABBBBBCCCCC', 'DDDEEEFFFGGGHHH'], 'eight-rows', 'Three beside five'],
  ['eight-center', 'Large center', ['AABBCC', 'DEEEEF', 'GGHHHF'], 'eight-center-side', 'Center column mosaic'],
  ['eight-tiers', 'Two + four + two', ['AABB', 'CDEF', 'GGHH'], 'eight-tiers-side', 'Two side rails'],
  ['eight-steps', 'Offset tiles', ['AABC', 'DDBC', 'EFGH'], 'eight-steps-side', 'Offset rows'],
  ['eight-sides', 'Three + two + three', ['AABBCC', 'DDDEEE', 'FFGGHH'], 'eight-sides-vertical', 'Triple side panels'],
  ['eight-ribbon', 'Ribbon stack', ['ABCD', 'EEEE', 'FGGH'], 'eight-ribbon-side', 'Ribbon spine'],
  ['nine-feature', 'Wide lead + eight', ['AAAA', 'BCDE', 'FGHI'], 'nine-feature-side', 'Tall lead + eight'],
  ['nine-levels', 'Four + five', ['AAAAABBBBBCCCCCDDDDD', 'EEEEFFFFGGGGHHHHIIII'], 'nine-levels-side', 'Four beside five'],
  ['nine-tier', 'Two + three + four', ['AAAAAABBBBBB', 'CCCCDDDDEEEE', 'FFFGGGHHHIII'], 'nine-tier-side', 'Three staggered columns'],
  ['nine-mosaic', 'Center mosaic', ['AABBCC', 'DEEEFF', 'DGGGFF', 'DHHIII'], 'nine-mosaic-side', 'Side mosaic'],
  ['nine-strip', 'Three story bands', ['AAAABBBB', 'CCDDEEFF', 'GGGHHHII'], 'nine-strip-side', 'Three story columns'],
  ['nine-stairs', 'Stepped grid', ['AABC', 'DEEC', 'FGHI'], 'nine-stairs-side', 'Side steps'],
  ['nine-solo', 'End-to-end story', ['AAAA', 'BCDE', 'FGHH', 'IIII'], 'nine-solo-side', 'Framed side story'],
];

export const templates = [
  pattern('solo', 'Full frame', ['A']),
  pattern('quad', '2 × 2 grid', ['AB', 'CD']),
  pattern('nine', '3 × 3 grid', ['ABC', 'DEF', 'GHI']),
  ...pairs.flatMap(([id, name, rows, alternateId, alternateName]) => {
    const layout = pattern(id, name, rows);
    return [layout, transpose(layout, alternateId, alternateName)];
  }),
];

export function matchingLayouts(count, size) {
  const ratio = size.width / size.height;
  const score = ({ cells, rows, columns }) => {
    const deviations = cells.map(([, , width, height]) => {
      const aspect = ratio * (width / columns) / (height / rows);
      return Math.abs(Math.log(aspect));
    });
    return deviations.reduce((total, value) => total + value, 0) / cells.length + .3 * Math.max(...deviations);
  };
  return templates.filter(template => template.cells.length === count)
    .map(template => ({ template, score: score(template) }))
    .sort((first, second) => first.score - second.score)
    .map(({ template }) => template);
}
