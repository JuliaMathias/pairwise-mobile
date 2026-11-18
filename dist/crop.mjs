const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(value, maximum));

export function fullCrop({ width, height }) {
  return { x: 0, y: 0, width, height };
}

export function fitCrop(bounds, rect, [wide, tall]) {
  const maximum = Math.floor(Math.min(bounds.width / wide, bounds.height / tall));
  if (!maximum) return null;
  const units = clamp(Math.floor(Math.min(rect.width / wide, rect.height / tall)), 1, maximum);
  const width = units * wide;
  const height = units * tall;
  return {
    x: clamp(Math.round(rect.x + (rect.width - width) / 2), 0, bounds.width - width),
    y: clamp(Math.round(rect.y + (rect.height - height) / 2), 0, bounds.height - height),
    width,
    height,
  };
}

export function dragCrop(bounds, rect, mode, dx, dy, ratio) {
  if (mode === 'move') {
    return {
      ...rect,
      x: clamp(rect.x + dx, 0, bounds.width - rect.width),
      y: clamp(rect.y + dy, 0, bounds.height - rect.height),
    };
  }
  const east = mode.endsWith('e');
  const south = mode.startsWith('s');
  const anchorX = east ? rect.x : rect.x + rect.width;
  const anchorY = south ? rect.y : rect.y + rect.height;
  const maxWidth = east ? bounds.width - anchorX : anchorX;
  const maxHeight = south ? bounds.height - anchorY : anchorY;
  let width = clamp(rect.width + (east ? dx : -dx), 1, maxWidth);
  let height = clamp(rect.height + (south ? dy : -dy), 1, maxHeight);
  if (ratio) {
    const [wide, tall] = ratio;
    const units = clamp(
      Math.round((width * wide + height * tall) / (wide * wide + tall * tall)),
      1,
      Math.floor(Math.min(maxWidth / wide, maxHeight / tall)),
    );
    width = units * wide;
    height = units * tall;
  }
  return { x: east ? anchorX : anchorX - width, y: south ? anchorY : anchorY - height, width, height };
}

export function cropFromTrims(bounds, [left, top, right, bottom]) {
  const width = bounds.width - left - right;
  const height = bounds.height - top - bottom;
  if ([left, top, right, bottom].some(value => !Number.isSafeInteger(value) || value < 0) || width < 1 || height < 1) return null;
  return { x: left, y: top, width, height };
}
