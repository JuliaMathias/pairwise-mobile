import { detectCard, removeColor, spotifyShareLink, visibleBounds } from './cutout-core.mjs';
import { downloadBlob, encodePng, readPhotos } from './photos.mjs';
import { matchingLyrics, songLookupTitle } from './lyrics-search.mjs';
import { createShareCard } from './share-card.mjs';
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

const LYRIC_LINE_LIMIT = 15;
const DEFAULT_LYRIC_LINES = 5;

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
  let generatedCard = false;
  let metadata = null;
  let dirtyCard = false;
  let awaitingLink = '';
  let entryDraft = { lyrics: '', tracklist: '' };
  let queuedFrame = 0;
  let spotifyConnected = false;
  let lookupSequence = 0;
  let lyricsMatches = [];
  let selectedLyrics = null;
  let lyricsRequest = '';
  let spotifyRequest = '';

  function inform(text) { $('status').textContent = text; }

  function controls() {
    $('edit').hidden = !photo;
    $('edit').classList.toggle('song-card', generatedCard);
    $('tools-title').textContent = generatedCard ? 'Spotify card preview' : 'Cutout tools';
    $('card-options').hidden = !metadata;
    $('preview-card').disabled = busy;
    $('layout').disabled = busy;
    $('creator').disabled = busy;
    $('entries').disabled = busy;
    $('lookup').disabled = busy || Boolean(lyricsRequest || spotifyRequest);
    $('entry-list').querySelectorAll('input').forEach(box => { box.disabled = busy; });
    $('deselect-lyrics').disabled = busy || !$('entry-list').querySelector('input:checked');
    $('save').disabled = busy || !photo || (generatedCard && dirtyCard);
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
    generatedCard = generated;
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
    if (!photo || generatedCard || busy || !event.isPrimary || event.button !== 0) return;
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
      inform(generatedCard ? `${saved} Include the Spotify link in your post.` : saved);
    } catch (error) { inform(error.message); }
    finally { busy = false; controls(); }
  };

  $('copy').onclick = async () => {
    try {
      if (incoming?.copyLink) incoming.copyLink(sharedLink);
      else await navigator.clipboard.writeText(sharedLink);
      inform('Spotify link copied.');
    } catch {
      $('link').focus();
      $('link').select();
      inform('Copy the selected link.');
    }
  };

  function fetchShareCard() {
    if (!incoming?.fetchCard || !sharedLink || busy) return;
    busy = true;
    awaitingLink = sharedLink;
    controls();
    inform('Getting the title and cover from Spotify…');
    incoming.fetchCard(sharedLink);
  }

  function lookupStatus(message) {
    $('lookup-status').hidden = !message;
    $('lookup-status').textContent = message;
  }

  function updateEntryList() {
    const layout = $('layout').value;
    const lyrics = layout === 'lyrics';
    const limit = lyrics ? LYRIC_LINE_LIMIT : 4;
    $('entry-editor').hidden = layout === 'cover';
    $('lookup').hidden = lyrics ? !incoming?.fetchLyrics : layout !== 'tracklist' || !incoming?.connectSpotify;
    $('lookup').textContent = lyrics ? 'Find lyrics on LRCLIB' : spotifyConnected ? 'Load Spotify tracks' : 'Connect Spotify to load tracks';
    $('lyrics-source').hidden = !lyrics || lyricsMatches.length === 0;
    $('entry-label').textContent = lyrics ? 'Paste lyrics' : 'Add playlist tracks';
    $('entry-hint').textContent = lyrics ? `Choose 1 to ${LYRIC_LINE_LIMIT} lines for the card.`
      : 'Enter one track per line as Title — Artist, then choose up to 4.';
    $('entry-list').replaceChildren();
    $('deselect-lyrics').hidden = true;
    if (layout === 'cover') return;
    const entries = $('entries').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    $('deselect-lyrics').hidden = !lyrics || !entries.length;
    const occurrences = new Map();
    entries.forEach((line, index) => {
      const occurrence = (occurrences.get(line) ?? 0) + 1;
      occurrences.set(line, occurrence);
      const key = `${occurrence}:${line}`;
      const row = document.createElement('label');
      row.className = 'cutout-check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = line;
      box.dataset.lineKey = key;
      box.checked = lyrics ? selectedLyrics?.has(key) ?? index < DEFAULT_LYRIC_LINES : index < limit;
      box.onchange = () => {
        if ($('entry-list').querySelectorAll('input:checked').length > limit) {
          box.checked = false;
          inform(`Choose up to ${limit} ${lyrics ? 'lines' : 'tracks'}.`);
          return;
        }
        if (lyrics) {
          selectedLyrics = new Set(Array.from($('entry-list').querySelectorAll('input:checked'), input => input.dataset.lineKey));
        }
        markCardDirty();
      };
      row.append(box, document.createTextNode(line));
      $('entry-list').append(row);
    });
  }

  function markCardDirty() {
    dirtyCard = true;
    controls();
  }

  async function renderShareCard() {
    const layout = $('layout').value;
    const entries = Array.from($('entry-list').querySelectorAll('input:checked'), box => box.value);
    if (layout !== 'cover' && !entries.length) {
      throw new Error(layout === 'lyrics' ? 'Paste lyrics and choose at least one line.' : 'Add tracks and select at least one.');
    }
    const { blob, title, kind } = metadata;
    const card = await createShareCard(blob, { title, kind, layout, entries, subtitle: $('creator').value.trim() });
    await load(new File([card], `${safePrefix(title) || 'spotify'}-${layout}.png`, { type: 'image/png' }), { generated: true });
    dirtyCard = false;
    inform('Card ready. Save it and include the Spotify link in your post.');
  }

  $('song').onclick = fetchShareCard;
  $('deselect-lyrics').onclick = () => {
    selectedLyrics = new Set();
    $('entry-list').querySelectorAll('input:checked').forEach(box => { box.checked = false; });
    markCardDirty();
  };
  $('layout').onchange = () => {
    const layout = $('layout').value;
    $('entries').value = entryDraft[layout] ?? '';
    lookupStatus('');
    updateEntryList();
    if (layout === 'cover' || (layout === 'tracklist' && $('entries').value)) $('preview-card').click();
    else markCardDirty();
  };
  $('creator').oninput = markCardDirty;
  $('entries').oninput = () => {
    entryDraft[$('layout').value] = $('entries').value;
    updateEntryList();
    markCardDirty();
  };
  $('preview-card').onclick = async () => {
    if (busy || !metadata) return;
    busy = true;
    controls();
    try { await renderShareCard(); }
    catch (error) { inform(error.message); }
    finally { busy = false; controls(); }
  };

  function requestSpotifyDetails() {
    if (!metadata?.path || !spotifyConnected || spotifyRequest) return;
    spotifyRequest = String(++lookupSequence);
    $('spotify-status').textContent = 'Loading Spotify details…';
    if ($('layout').value === 'tracklist') lookupStatus('Loading Spotify tracks…');
    controls();
    incoming.fetchSpotifyDetails(spotifyRequest, metadata.path);
  }

  $('spotify-connect').onclick = () => {
    $('spotify-status').textContent = 'Opening Spotify sign-in…';
    incoming?.connectSpotify($('spotify-client').value.trim(), sharedLink);
  };
  $('spotify-disconnect').onclick = () => incoming?.disconnectSpotify();
  globalThis.pairwiseSpotifyStatus = (connected, message, clientId, resumeLink) => {
    if (clientId && !$('spotify-client').value.trim()) $('spotify-client').value = clientId;
    if (resumeLink && !sharedLink) globalThis.pairwiseReceiveShare({ text: resumeLink });
    spotifyConnected = connected;
    $('spotify-summary').textContent = connected ? 'Spotify connected' : 'Connect Spotify for artists and playlist tracks';
    $('spotify-connect').hidden = connected;
    $('spotify-disconnect').hidden = !connected;
    $('spotify-client').parentElement.hidden = connected;
    $('spotify-status').textContent = message;
    if (message && !connected) $('spotify-setup').open = true;
    if (connected) {
      $('spotify-setup').open = false;
      requestSpotifyDetails();
    } else {
      spotifyRequest = '';
    }
    $('lookup').textContent = $('layout').value === 'tracklist'
      ? connected ? 'Load Spotify tracks' : 'Connect Spotify to load tracks'
      : 'Find lyrics on LRCLIB';
    controls();
  };

  globalThis.pairwiseSpotifyDetails = (key, data, error) => {
    if (key !== spotifyRequest || !metadata) return;
    spotifyRequest = '';
    controls();
    const { creator, entries, leadArtist, duration, title } = JSON.parse(data);
    const layout = $('layout').value;
    if (error) {
      $('spotify-status').textContent = error;
      $('spotify-setup').open = true;
      if (layout === 'tracklist') lookupStatus(error);
      return;
    }
    $('spotify-status').textContent = '';
    metadata.leadArtist = leadArtist;
    metadata.duration = duration;
    metadata.lookupTitle = title;
    if (creator && !$('creator').value.trim()) {
      $('creator').value = creator;
      markCardDirty();
    }
    if (entries?.length && !entryDraft.tracklist) {
      entryDraft.tracklist = entries.join('\n');
      if (layout === 'tracklist') {
        $('entries').value = entryDraft.tracklist;
        updateEntryList();
        markCardDirty();
      }
    }
    if (layout === 'tracklist') lookupStatus(entries?.length ? 'Tracks loaded. Choose up to 4.'
      : 'Spotify returned no tracks. You can enter them below.');
    if ((layout === 'cover' && dirtyCard) || (layout === 'tracklist' && entries?.length && $('entries').value)) {
      $('preview-card').click();
    }
  };

  $('lookup').onclick = () => {
    if (!metadata || busy) return;
    if ($('layout').value === 'tracklist') {
      if (spotifyConnected) requestSpotifyDetails();
      else $('spotify-setup').open = true;
      return;
    }
    if (lyricsRequest) return;
    lyricsRequest = String(++lookupSequence);
    lyricsMatches = [];
    $('lyrics-source').hidden = true;
    const artist = metadata.leadArtist || $('creator').value.trim();
    lookupStatus('Searching LRCLIB…');
    incoming.fetchLyrics(lyricsRequest, songLookupTitle(metadata.lookupTitle || metadata.title), artist);
    controls();
  };

  globalThis.pairwiseLyrics = (key, result, error) => {
    if (key !== lyricsRequest || !metadata) return;
    lyricsRequest = '';
    controls();
    if ($('layout').value !== 'lyrics') return;
    if (error) {
      lookupStatus(error);
      return;
    }
    try {
      lyricsMatches = matchingLyrics(JSON.parse(result), {
        title: metadata.lookupTitle || metadata.title,
        artist: metadata.leadArtist || $('creator').value.trim(),
        duration: metadata.duration,
      });
      if (!lyricsMatches.length) {
        lookupStatus('LRCLIB found no matching lyrics. Try entering the artist, or paste lyrics below.');
        return;
      }
      $('lyrics-results').replaceChildren(new Option('Choose a recording', ''));
      lyricsMatches.forEach((recording, index) => {
        const details = [recording.artistName, recording.albumName].filter(Boolean).join(' · ');
        $('lyrics-results').append(new Option(details || recording.trackName, String(index)));
      });
      $('lyrics-source').hidden = false;
      lookupStatus('Choose a recording to load its lyrics, then select the lines you want.');
    } catch {
      lookupStatus('Couldn’t read the results from LRCLIB. You can still paste lyrics below.');
    }
  };

  $('lyrics-results').onchange = () => {
    const recording = lyricsMatches[$('lyrics-results').value];
    if (!recording) return;
    if (!$('creator').value.trim()) $('creator').value = recording.artistName;
    $('entries').value = recording.plainLyrics.slice(0, 16000);
    entryDraft.lyrics = $('entries').value;
    selectedLyrics = null;
    updateEntryList();
    markCardDirty();
    lookupStatus(`Lyrics from LRCLIB. Choose 1 to ${LYRIC_LINE_LIMIT} lines for the card.`);
  };

  globalThis.pairwiseShareCard = async (id, title, link, kind, creator, path, error) => {
    if (link !== awaitingLink) return;
    try {
      if (error) throw new Error(error);
      const response = await fetch(`./shared-${id}`);
      if (!response.ok) throw new Error('Couldn’t load the cover image.');
      const blob = await response.blob();
      if (link !== awaitingLink) return;
      metadata = { title, kind, blob, path };
      $('spotify-setup').hidden = !incoming?.connectSpotify;
      $('layout').value = 'cover';
      for (const [value, available] of [['lyrics', kind !== 'playlist'], ['tracklist', kind === 'playlist']]) {
        const option = $('layout').querySelector(`[value="${value}"]`);
        option.hidden = option.disabled = !available;
      }
      $('creator-label').textContent = kind === 'playlist' ? 'Playlist creator (optional)' : 'Artist (optional)';
      $('creator').value = creator;
      entryDraft = { lyrics: '', tracklist: '' };
      selectedLyrics = null;
      $('entries').value = '';
      updateEntryList();
      await renderShareCard();
      if (spotifyConnected) requestSpotifyDetails();
    } catch (failure) { inform(failure.message); }
    finally {
      if (link === awaitingLink) {
        awaitingLink = '';
        busy = false;
        controls();
      }
    }
  };

  globalThis.pairwiseReceiveShare = async payload => {
    const link = spotifyShareLink(payload.text);
    if (!payload.image && !link && !payload.error && !payload.text) return;
    location.hash = 'cutout';
    if (awaitingLink) {
      awaitingLink = '';
      busy = false;
    }
    metadata = null;
    lyricsMatches = [];
    lyricsRequest = spotifyRequest = '';
    lookupStatus('');
    dirtyCard = generatedCard;
    sharedLink = link;
    $('share').hidden = !link;
    $('link').value = link;
    $('song').hidden = Boolean(payload.image) || !incoming?.fetchCard;
    $('share-note').textContent = payload.image
      ? 'Pairwise received the image and Spotify link.'
      : 'Build a card from the link, or add a Spotify screenshot to keep its original design.';
    if (!payload.image) {
      controls();
      inform(payload.error || (link ? '' : 'Share a Spotify song, playlist link, or image.'));
      if (link && !payload.error) fetchShareCard();
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
