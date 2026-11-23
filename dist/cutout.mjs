import { detectCard, removeColor, spotifyTrackLink, visibleBounds } from './cutout-core.mjs';
import { downloadBlob, encodePng, readPhotos } from './photos.mjs';
import { safePrefix } from './core.mjs';

const incoming = globalThis.PairwiseShare;

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  const right = x + width, bottom = y + height;
  ctx.moveTo(x + radius, y);
  ctx.arcTo(right, y, right, bottom, radius);
  ctx.arcTo(right, bottom, x, bottom, radius);
  ctx.arcTo(x, bottom, x, y, radius);
  ctx.arcTo(x, y, right, y, radius);
  ctx.closePath();
}

export function createCutout(openCrop) {
  const $ = id => document.getElementById(`cutout-${id}`);
  const view = $('canvas');
  const work = document.createElement('canvas');
  const context = work.getContext('2d', { willReadFrequently: true });
  const preview = view.getContext('2d');
  let original, photo, stroke, sample;
  let steps = [];
  let mode = 'brush';
  let busy = false;
  let sharedLink = '';
  let songCard = false;
  let queuedFrame = 0;

  function inform(text) { $('status').textContent = text; }

  function controls() {
    $('edit').hidden = !photo;
    $('edit').classList.toggle('song-card', songCard);
    $('tools-title').textContent = songCard ? 'Song card preview' : 'Cutout tools';
    $('save').disabled = busy || !photo;
    $('load').disabled = busy;
    $('song').disabled = busy;
    for (const id of ['brush', 'color', 'find', 'crop', 'reset', 'radius', 'tolerance', 'connected', 'size', 'trim', 'card-type']) $(id).disabled = busy;
    $('undo').disabled = !steps.length || busy;
    $('apply-color').disabled = !sample || busy;
    $('radius-row').hidden = !photo?.crop;
    $('brush').setAttribute('aria-pressed', String(mode === 'brush'));
    $('color').setAttribute('aria-pressed', String(mode === 'color'));
    $('size-row').hidden = mode !== 'brush';
    $('color-controls').hidden = mode !== 'color';
  }

  function setMode(value) {
    mode = value;
    sample = null;
    $('help').textContent = value === 'brush'
      ? 'Draw on the image to erase pixels.'
      : 'Tap a color, adjust the tolerance, then remove it.';
    controls();
  }

  function cropRect() {
    return photo.crop ?? { x: 0, y: 0, width: work.width, height: work.height };
  }

  function render() {
    const { x, y, width, height } = cropRect();
    if (view.width !== width || view.height !== height) {
      view.width = width;
      view.height = height;
    }
    preview.clearRect(0, 0, width, height);
    preview.save();
    view.style.width = `min(100%, ${55 * width / height}dvh, ${width}px)`;
    view.style.height = 'auto';
    if (photo.crop && Number($('radius').value)) {
      roundedRect(preview, 0, 0, width, height, Math.min(width, height) * Number($('radius').value) / 100);
      preview.clip();
    }
    preview.drawImage(work, x, y, width, height, 0, 0, width, height);
    preview.restore();
  }

  function scheduleRender() {
    if (queuedFrame) return;
    queuedFrame = requestAnimationFrame(() => {
      queuedFrame = 0;
      render();
    });
  }

  function eraseLine(from, to, radius) {
    context.save();
    context.globalCompositeOperation = 'destination-out';
    context.lineWidth = 2 * radius;
    context.lineCap = 'round';
    context.beginPath();
    if (from.x === to.x && from.y === to.y) {
      context.arc(from.x, from.y, radius, 0, 2 * Math.PI);
      context.fill();
    } else {
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
    context.restore();
  }

  function apply(step) {
    if (step.points) {
      step.points.forEach((point, i) => eraseLine(step.points[Math.max(0, i - 1)], point, step.radius));
    } else {
      const pixels = context.getImageData(0, 0, work.width, work.height);
      removeColor(pixels.data, work.width, work.height, step);
      context.putImageData(pixels, 0, 0);
    }
  }

  function redraw() {
    context.clearRect(0, 0, work.width, work.height);
    context.drawImage(original, 0, 0);
    for (const step of steps) apply(step);
    render();
    controls();
  }

  async function load(file, { find = false, generated = false } = {}) {
    const { photos, errors } = await readPhotos([file]);
    const next = photos[0];
    if (!next) throw new Error(errors[0] || 'Could not open this image.');
    if (next.width * next.height > 16_000_000) {
      URL.revokeObjectURL(next.url);
      throw new Error('Use an image under 16 megapixels for Cutout.');
    }
    const image = new Image();
    image.src = next.url;
    try { await image.decode(); }
    catch (error) { URL.revokeObjectURL(next.url); throw error; }
    if (photo) URL.revokeObjectURL(photo.url);
    photo = next;
    original = image;
    songCard = generated;
    work.width = photo.width;
    work.height = photo.height;
    steps = [];
    $('radius').value = 5;
    $('radius-value').textContent = '5%';
    setMode('brush');
    redraw();
    inform('');
    if (find) findCard();
  }

  function findCard() {
    const small = document.createElement('canvas');
    const scale = Math.min(1, 420 / Math.max(photo.width, photo.height));
    small.width = Math.max(1, Math.round(photo.width * scale));
    small.height = Math.max(1, Math.round(photo.height * scale));
    const ctx = small.getContext('2d');
    ctx.drawImage(original, 0, 0, small.width, small.height);
    const { data } = ctx.getImageData(0, 0, small.width, small.height);
    const card = detectCard(data, small.width, small.height, $('card-type').value);
    if (!card) {
      inform('Couldn’t find a clear card edge. Use Adjust crop to outline the card.');
      return;
    }
    const sx = photo.width / small.width, sy = photo.height / small.height;
    const x = Math.round(card.x * sx), y = Math.round(card.y * sy);
    photo.crop = { x, y, width: Math.round((card.x + card.width) * sx) - x, height: Math.round((card.y + card.height) * sy) - y };
    sample = null;
    render();
    controls();
    inform('Card cropped. Use Adjust crop or Corner rounding to refine the edges.');
  }

  function position(event) {
    const bounds = view.getBoundingClientRect();
    const crop = cropRect();
    const x = Math.floor((event.clientX - bounds.left) * crop.width / bounds.width);
    const y = Math.floor((event.clientY - bounds.top) * crop.height / bounds.height);
    return {
      x: crop.x + Math.max(0, Math.min(crop.width - 1, x)),
      y: crop.y + Math.max(0, Math.min(crop.height - 1, y)),
    };
  }

  view.onpointerdown = event => {
    if (!photo || songCard || busy || !event.isPrimary || event.button !== 0) return;
    const point = position(event);
    if (mode === 'color') {
      const rgba = context.getImageData(point.x, point.y, 1, 1).data;
      if (rgba[3]) {
        sample = { color: Array.from(rgba.slice(0, 3)), seed: point };
        const hex = sample.color.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
        inform(`Selected #${hex}. Tap Remove selected color to apply.`);
      } else {
        sample = null;
        inform('That area is already transparent.');
      }
      controls();
      return;
    }
    const radius = Number($('size').value) * view.width / view.getBoundingClientRect().width / 2;
    stroke = { id: event.pointerId, points: [point], radius };
    view.setPointerCapture(event.pointerId);
    eraseLine(point, point, radius);
    scheduleRender();
  };
  view.onpointermove = event => {
    if (stroke?.id !== event.pointerId) return;
    const point = position(event);
    eraseLine(stroke.points.at(-1), point, stroke.radius);
    stroke.points.push(point);
    scheduleRender();
  };
  view.onlostpointercapture = event => {
    if (stroke?.id !== event.pointerId) return;
    steps.push(stroke);
    stroke = null;
    controls();
  };

  $('brush').onclick = () => setMode('brush');
  $('color').onclick = () => setMode('color');
  $('find').onclick = findCard;
  $('size').oninput = () => { $('size-value').textContent = `${$('size').value} px`; };
  $('tolerance').oninput = () => { $('tolerance-value').textContent = $('tolerance').value; };
  $('radius').oninput = () => {
    $('radius-value').textContent = `${$('radius').value}%`;
    render();
  };
  $('apply-color').onclick = () => {
    if (!sample) return;
    steps.push({ ...sample, tolerance: Number($('tolerance').value), connected: $('connected').checked });
    apply(steps.at(-1));
    sample = null;
    render();
    controls();
    inform('Color removed. Tap another color or use Undo erase.');
  };
  $('undo').onclick = () => {
    steps.pop();
    sample = null;
    redraw();
    inform('');
  };
  $('reset').onclick = () => {
    photo.crop = null;
    sample = null;
    steps = [];
    redraw();
    inform('');
  };
  $('crop').onclick = () => openCrop(photo, rect => {
    photo.crop = rect;
    sample = null;
    render();
    controls();
    $('crop').focus({ preventScroll: true });
  });
  $('load').onclick = () => $('file').click();
  $('file').onchange = async () => {
    const file = $('file').files[0];
    $('file').value = '';
    if (!file) return;
    busy = true;
    controls();
    try { await load(file, { find: Boolean(sharedLink) }); }
    catch (error) { inform(error.message); }
    finally { busy = false; controls(); }
  };

  $('save').onclick = async () => {
    if (!photo || busy) return;
    busy = true;
    controls();
    try {
      render();
      const { width, height } = view;
      const { data } = preview.getImageData(0, 0, width, height);
      const bounds = visibleBounds(data, width, height);
      if (!bounds) throw new Error('Nothing is left to save. Undo an erase or reset the edits.');
      let canvas = view;
      if ($('trim').checked && (bounds.width !== width || bounds.height !== height)) {
        canvas = document.createElement('canvas');
        canvas.width = bounds.width;
        canvas.height = bounds.height;
        canvas.getContext('2d').drawImage(view, -bounds.x, -bounds.y);
      }
      const base = safePrefix(photo.name.replace(/\.[^.]+$/, '')) || 'pairwise';
      const result = await downloadBlob(await encodePng(canvas), `${base}-cutout.png`);
      const saved = result === 'saved' ? 'PNG saved to Downloads.' : 'PNG download requested.';
      inform(songCard ? `${saved} Include the Spotify track link in your post.` : saved);
    } catch (error) { inform(error.message); }
    finally { busy = false; controls(); }
  };

  $('copy').onclick = async () => {
    try {
      if (incoming?.copyTrackLink) incoming.copyTrackLink(sharedLink);
      else await navigator.clipboard.writeText(sharedLink);
      inform('Track link copied.');
    } catch {
      $('link').focus();
      $('link').select();
      inform('Copy the selected link.');
    }
  };

  function makeSongCard() {
    if (!incoming?.makeSongCard || !sharedLink || busy) return;
    busy = true;
    controls();
    inform('Getting the song title and cover from Spotify…');
    incoming.makeSongCard(sharedLink);
  }

  $('song').onclick = makeSongCard;

  globalThis.pairwiseSongCard = async (id, title, track, error) => {
    try {
      if (error) throw new Error(error);
      const response = await fetch(`./shared-${id}`);
      if (!response.ok) throw new Error('Couldn’t load the song card.');
      const artUrl = URL.createObjectURL(await response.blob());
      try {
        const card = await createSongCard(artUrl, title, track);
        await load(new File([card], `${safePrefix(title) || 'spotify-song'}.png`, { type: 'image/png' }), { generated: true });
      } finally {
        URL.revokeObjectURL(artUrl);
      }
      inform('Song card ready. Save it and include the Spotify link in your post.');
    } catch (failure) { inform(failure.message); }
    finally { busy = false; controls(); }
  };

  globalThis.pairwiseReceiveShare = async payload => {
    const link = spotifyTrackLink(payload.text);
    if (!payload.image && !link && !payload.error && !payload.text) return;
    location.hash = 'cutout';
    sharedLink = link;
    $('share').hidden = !link;
    $('link').value = link;
    $('song').hidden = Boolean(payload.image) || !incoming?.makeSongCard;
    $('share-note').textContent = payload.image
      ? 'Pairwise received the image and track link.'
      : 'Spotify sent a link. Make a song card from the link, or add a screenshot to keep the exact Spotify card or selected lyrics.';
    if (!payload.image) {
      inform(payload.error || (link ? '' : 'Share a Spotify track link or an image.'));
      if (link && !payload.error) makeSongCard();
      return;
    }
    busy = true;
    controls();
    try {
      const response = await fetch(`./shared-${payload.image}`);
      if (!response.ok) throw new Error('Couldn’t open the shared image.');
      const blob = await response.blob();
      await load(new File([blob], payload.name || 'shared-image', { type: blob.type }), { find: true });
    } catch (error) { inform(error.message); }
    finally { busy = false; controls(); }
  };
  controls();
  incoming?.ready();
}


async function createSongCard(url, title, track) {
  const art = new Image();
  art.src = url;
  const logo = new Image();
  logo.src = './spotify-wordmark.png';
  await Promise.all([art.decode(), logo.decode()]);

  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 850;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4efe4';
  roundedRect(ctx, 0, 0, canvas.width, canvas.height, 36);
  ctx.fill();

  const scale = Math.min(560 / art.naturalWidth, 540 / art.naturalHeight);
  const w = art.naturalWidth * scale, h = art.naturalHeight * scale;
  const x = (canvas.width - w) / 2, y = 42 + (540 - h) / 2;
  ctx.save();
  roundedRect(ctx, x, y, w, h, Math.min(14, w / 2, h / 2));
  ctx.clip();
  ctx.drawImage(art, x, y, w, h);
  ctx.restore();

  const titleFont = `700 ${title.length > 45 ? 31 : 40}px system-ui`;
  ctx.font = titleFont;
  ctx.fillStyle = '#24332c';
  const lines = [];
  let line = '';
  for (const word of title.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > 608) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  lines.slice(0, 3).forEach((value, i) => ctx.fillText(lines.length > 3 && i === 2 ? `${value}…` : value, 56, 630 + i * 43, 608));
  ctx.drawImage(logo, 56, 746, 120, 120 * logo.naturalHeight / logo.naturalWidth);
  ctx.fillStyle = '#34463b';
  ctx.font = '18px system-ui';
  ctx.fillText(track.replace(/^https:\/\//, ''), 56, 816, 608);
  return encodePng(canvas);
}
