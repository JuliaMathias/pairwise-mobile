export function visibleBounds(data, width, height) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!data[(y * width + x) * 4 + 3]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function removeColor(data, width, height, { color, tolerance, seed, connected }) {
  const total = width * height;
  const threshold = tolerance * tolerance;
  const matches = pixel => {
    const i = pixel * 4;
    return data[i + 3] > 0 && ((data[i] - color[0]) ** 2 + (data[i + 1] - color[1]) ** 2 + (data[i + 2] - color[2]) ** 2) <= threshold;
  };
  if (!connected) {
    for (let pixel = 0; pixel < total; pixel++) if (matches(pixel)) data[pixel * 4 + 3] = 0;
    return;
  }
  const queue = new Uint32Array(total);
  let end = 0;
  const visit = pixel => {
    if (!matches(pixel)) return;
    data[pixel * 4 + 3] = 0;
    queue[end++] = pixel;
  };
  visit(seed.y * width + seed.x);
  for (let start = 0; start < end; start++) {
    const pixel = queue[start];
    if (pixel % width) visit(pixel - 1);
    if (pixel % width < width - 1) visit(pixel + 1);
    if (pixel >= width) visit(pixel - width);
    if (pixel < total - width) visit(pixel + width);
  }
}

function peaks(values, from, to, limit) {
  const candidates = Array.from({ length: to - from }, (_, i) => from + i);
  candidates.sort((a, b) => values[b] - values[a]);
  const selected = [];
  for (const i of candidates) {
    if (values[i] < 2.8) continue;
    if (selected.every(other => Math.abs(other - i) > 3)) selected.push(i);
    if (selected.length === limit) break;
  }
  return selected;
}

/** Finds continuous, centered rectangular boundaries in a downscaled story image. */
export function detectCard(data, width, height, type = 'auto') {
  if (width < 28 || height < 28) return null;
  function difference(x1, y1, x2, y2) {
    const a = (y1 * width + x1) * 4;
    const b = (y2 * width + x2) * 4;
    return Math.min(60, (Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2])) / 3);
  }
  const row = Array.from({ length: height }, () => new Float32Array(width + 1));
  const col = Array.from({ length: width }, () => new Float32Array(height + 1));
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      row[y][x + 1] = row[y][x] + difference(x, y - 2, x, y + 1);
      col[x][y + 1] = col[x][y] + difference(x - 2, y, x + 1, y);
    }
  }
  const line = (values, first, last) => (values[last] - values[first]) / (last - first);
  const fromX = Math.round(width * .24), toX = Math.round(width * .76);
  const fromY = Math.round(height * .24), toY = Math.round(height * .65);
  const horizontals = row.map(values => line(values, fromX, toX));
  const verticals = col.map(values => line(values, fromY, toY));
  const ys = peaks(horizontals, Math.max(3, Math.round(height * .08)), Math.min(height - 3, Math.round(height * .94)), 40);
  const lefts = peaks(verticals, Math.max(3, Math.round(width * .035)), Math.round(width * .3), 14);
  const rights = peaks(verticals, Math.round(width * .7), Math.min(width - 3, Math.round(width * .965)), 14);
  const continuity = (values, first, last) => {
    const step = (last - first) / 3;
    const split1 = Math.round(first + step), split2 = Math.round(first + 2 * step);
    return Math.min(line(values, first, split1), line(values, split1, split2), line(values, split2, last));
  };
  const minAspect = type === 'lyrics' ? .83 : .60;
  const maxAspect = type === 'song' ? .89 : type === 'lyrics' ? 1.30 : 1.48;
  const storyRatio = Math.abs(width / height - 9 / 16) < .015;
  let result = null;
  let best = 0;
  for (const left of lefts) for (const right of rights) {
    const w = right - left;
    if (Math.abs(left + right - width) > width * .14) continue;
    for (const top of ys) for (const bottom of ys) {
      const h = bottom - top;
      if (h < height * .13 || w / h < minAspect || w / h > maxAspect) continue;
      const insetX = Math.max(2, Math.round(w * .08)), insetY = Math.max(2, Math.round(h * .08));
      const edge = [line(row[top], left + insetX, right - insetX), line(row[bottom], left + insetX, right - insetX),
        line(col[left], top + insetY, bottom - insetY), line(col[right], top + insetY, bottom - insetY)];
      if (Math.min(...edge) < 2.8) continue;
      const continuous = [
        continuity(row[top], left + insetX, right - insetX),
        continuity(row[bottom], left + insetX, right - insetX),
        continuity(col[left], top + insetY, bottom - insetY),
        continuity(col[right], top + insetY, bottom - insetY),
      ];
      if (Math.min(...continuous) < 1.8) continue;
      const score = Math.min(...edge) + Math.min(...continuous) + edge.reduce((sum, value) => sum + value, 0) / 12
        + 42 * Math.sqrt(w * h / (width * height)) - 100 * Math.abs(left + right - width) / width
        - (storyRatio ? 44 : 0) * Math.abs(top + bottom - height) / height;
      if (score <= best) continue;
      best = score;
      result = { x: left, y: top, width: w, height: h };
    }
  }
  return result;
}

export function spotifyTrackLink(text) {
  const match = String(text ?? '').match(/https:\/\/(?:open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]{22}|spotify\.link\/[A-Za-z0-9_-]+)(?=$|[\s?#<>"')\],.!])/i);
  return match ? new URL(match[0]).href : '';
}
