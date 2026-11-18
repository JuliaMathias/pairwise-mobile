export function encodePng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode this image.'));
    }, 'image/png');
  });
}

export async function sampleFiles() {
  const scenes = [
    ['sample-2.png', 300, 200, ['#c6dbc8', '#f4e4a9', '#71917d', '#3c6054']],
    ['sample-10.png', 250, 220, ['#d9d0e8', '#f7ddb9', '#8c83a5', '#564f75']],
    ['sample-1.png', 300, 190, ['#efd4ae', '#fff0c7', '#c18368', '#795956']],
    ['sample-3.png', 290, 210, ['#bedee4', '#f7ebca', '#6f9dad', '#346f82']],
  ];
  return Promise.all(scenes.map(async ([name, width, height, [sky, sun, far, near]]) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);
    context.fillStyle = sun;
    context.beginPath();
    context.arc(width * .68, height * .31, height * .14, 0, Math.PI * 2);
    context.fill();
    for (const [color, start, crest, trough] of [[far, .64, .28, .70], [near, .84, .48, .92]]) {
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(0, height * start);
      context.bezierCurveTo(width * .36, height * crest, width * .45, height * trough, width, height * (start - .07));
      context.lineTo(width, height);
      context.lineTo(0, height);
      context.fill();
    }
    return new File([await encodePng(canvas)], name, { type: 'image/png' });
  }));
}

export async function readPhotos(files) {
  const photos = [];
  const errors = [];
  for (const file of files) {
    const knownType = /^image\/(png|jpeg|webp|gif|avif|bmp|x-ms-bmp)$/.test(file.type);
    const knownExtension = /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name);
    if (!knownType && !(knownExtension && ['', 'application/octet-stream'].includes(file.type))) {
      errors.push(`${file.name}: unsupported image type`);
      continue;
    }
    if (file.size > 100 * 1024 * 1024) {
      errors.push(`${file.name}: larger than 100 MB`);
      continue;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const { naturalWidth: width, naturalHeight: height } = image;
      if (width * height > 40_000_000) throw new Error();
      photos.push({ name: file.name, url, width, height });
    } catch {
      URL.revokeObjectURL(url);
      errors.push(`${file.name}: unreadable or larger than 40 megapixels`);
    }
  }
  return { photos, errors };
}

export const android = globalThis.PairwiseAndroid;

const pendingSaves = new Map();

if (android) {
  globalThis.pairwiseAndroidSaveResult = (id, status) => {
    const pending = pendingSaves.get(id);
    if (!pending) return;
    pendingSaves.delete(id);
    if (status === 'saved' || status === 'cancelled') pending.resolve(status);
    else pending.reject(new Error(status));
  };
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not prepare the export.'));
    reader.readAsDataURL(blob);
  });
}

async function saveOnAndroid(blob, filename) {
  const id = android.beginSave(filename);
  if (!id) throw new Error('Could not start saving the file.');
  try {
    const chunkSize = 192 * 1024;
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const encoded = await blobDataUrl(blob.slice(offset, offset + chunkSize));
      if (!android.appendSave(id, encoded.split(',')[1])) throw new Error('Could not stage the export.');
    }
    return await new Promise((resolve, reject) => {
      pendingSaves.set(id, { resolve, reject });
      if (!android.finishSave(id)) reject(new Error('Could not open the save dialog.'));
    });
  } catch (error) {
    pendingSaves.delete(id);
    android.cancelSave(id);
    throw error;
  }
}

export async function downloadBlob(blob, filename) {
  if (android) return saveOnAndroid(blob, filename);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'download';
}
