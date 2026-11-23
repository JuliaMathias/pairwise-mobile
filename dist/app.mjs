import { groupInOrder, makeZip, moveImage, outputFilename, safePrefix, sortByFilename, validOffset } from './core.mjs';
import { createCropEditor } from './crop-editor.mjs';
import { joinComposition } from './composer.mjs';
import { android, downloadBlob, encodePng, readPhotos, sampleFiles, saveImageFiles } from './photos.mjs';
import { createCollage } from './collage.mjs';
import { createCutout } from './cutout.mjs';

const $ = id => document.getElementById(id);
const groupField = $('group-size');
const offsetField = $('number-offset');
const nameField = $('output-name');
const fileField = $('files');
const directions = ['vertical', 'horizontal'];
const busyControls = ['browse', 'sample', 'add', 'clear', 'sort', ...directions, 'group-size', 'output-name', 'number-offset', 'files', 'bundle', 'save-all', 'join-fill', 'join-color', 'join-border', 'join-border-color'];
let images = [];
let outputs = [];
let direction = 'vertical';
let busy = false;
let nextId = 0;
let manualOrder = false;
let previewIndex = 0;
let previewRevision = 0;
const openCrop = createCropEditor();

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function message(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

function saveMessage(text, error = false) {
  $('save-status').textContent = text;
  $('save-status').classList.toggle('error', error);
}

function groupSize() {
  const value = Number(groupField.value);
  return Number.isSafeInteger(value) && value >= 2 ? value : null;
}

function offset() {
  return offsetField.validity.badInput ? NaN : Number(offsetField.value);
}

function updateControls() {
  const size = groupSize();
  const namingValid = validOffset(offset());
  $('filename-preview').textContent = namingValid
    ? outputFilename(nameField.value, 0, offset(), direction)
    : 'Enter a whole-number offset from 0 to 999999999.';
  $('generate').disabled = busy || images.length < 2 || size === null || !namingValid;
  $('decrease').disabled = busy || size === null || size === 2;
  $('increase').disabled = busy || size === Number.MAX_SAFE_INTEGER;
  const total = Math.ceil(images.length / (size ?? 2));
  let note = `${total} PNG ${total === 1 ? 'image' : 'images'}`;
  if (busy) note = 'Working…';
  else if (size === null) note = 'Enter a whole number of at least 2';
  else if (!namingValid) note = 'Enter a valid numbering offset';
  else if (images.length < 2) note = 'Add at least 2 images';
  $('ready-note').textContent = note;
  $('queue').hidden = images.length === 0;
  $('empty-queue').hidden = images.length !== 0;
  $('clear').hidden = images.length === 0;
  $('count').hidden = images.length === 0;
  $('count').textContent = images.length;
  $('join-color').disabled = busy || $('join-fill').value !== 'solid';
  $('join-border-color').disabled = busy || Number($('join-border').value) === 0;
  $('sort').disabled = busy || !manualOrder;
  $('order-note').textContent = manualOrder ? 'Custom order' : 'Sorted by filename';
}

function setBusy(value) {
  busy = value;
  for (const id of busyControls) $(id).disabled = value;
  document.querySelectorAll('.file-item button').forEach(button => {
    button.disabled = value || button.dataset.edge === 'true';
  });
  updateControls();
}

function clearOutputs() {
  for (const output of outputs) URL.revokeObjectURL(output.url);
  outputs = [];
  $('result-grid').replaceChildren();
  saveMessage('');
  $('results').hidden = true;
}

function queueButton(label, icon, action, className = '', atEdge = false) {
  const button = node('button', `icon-button ${className}`, icon);
  button.setAttribute('aria-label', label);
  button.title = label;
  button.dataset.edge = String(atEdge);
  button.disabled = busy || atEdge;
  button.onclick = action;
  return button;
}

function moveInQueue(from, to, focus = '.grip') {
  if (busy || from === to || to < 0 || to >= images.length) return;
  const image = images[from];
  images = moveImage(images, from, to);
  manualOrder = true;
  clearOutputs();
  renderQueue();
  message(`Moved ${image.name} to position ${to + 1}.`);
  const row = document.querySelector(`[data-image-id="${image.id}"]`);
  const control = row.querySelector(focus);
  (control.disabled ? row.querySelector('.grip') : control).focus();
}

function enableDrag(grip, item, index) {
  let drag;
  let target;
  grip.onpointerdown = event => {
    if (!event.isPrimary || event.button !== 0 || busy) return;
    drag = { id: event.pointerId, y: event.clientY };
    grip.setPointerCapture(event.pointerId);
  };
  grip.onpointermove = event => {
    if (drag?.id !== event.pointerId || Math.abs(event.clientY - drag.y) < 5 && !target) return;
    item.classList.add('is-dragging');
    target?.classList.remove('drag-target');
    target = [...document.querySelectorAll('.file-item')].find(row => {
      const bounds = row.getBoundingClientRect();
      return event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    });
    if (target !== item) target?.classList.add('drag-target');
  };
  grip.onpointerup = event => {
    if (drag?.id === event.pointerId && target) moveInQueue(index, Number(target.dataset.index));
  };
  grip.onlostpointercapture = () => {
    item.classList.remove('is-dragging');
    target?.classList.remove('drag-target');
    target = null;
    drag = null;
  };
  grip.onkeydown = event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    moveInQueue(index, index + (event.key === 'ArrowUp' ? -1 : 1));
  };
}

function renderQueue() {
  const list = $('pair-list');
  list.replaceChildren();
  if (images.length === 0) manualOrder = false;
  updateControls();
  const size = groupSize();
  let index = 0;
  groupInOrder(images, size ?? Number.MAX_SAFE_INTEGER).forEach((group, groupIndex) => {
    const row = node('div', 'pair-row');
    if (size) row.append(node('span', 'pair-number', `Group ${groupIndex + 1} · ${group.length}`));
    for (const image of group) {
      const position = index++;
      const item = node('div', 'file-item');
      item.dataset.imageId = image.id;
      item.dataset.index = position;
      const thumbnail = node('img');
      thumbnail.src = image.url;
      thumbnail.alt = '';
      thumbnail.loading = 'lazy';
      const label = node('div', 'file-label');
      const name = node('span', 'file-name', image.name);
      name.title = image.name;
      label.append(name);
      if (image.crop) label.append(node('span', 'hint', 'Cropped'));
      const grip = queueButton(`Reorder ${image.name} with the arrow keys`, '⠿', null, 'grip');
      enableDrag(grip, item, position);
      const crop = queueButton(`Crop ${image.name}`, 'Crop', () => openCrop(image, selection => {
        image.crop = selection;
        clearOutputs();
        renderQueue();
        document.querySelector(`[data-image-id="${image.id}"] .edit-crop`).focus();
      }), 'edit-crop');
      const up = queueButton(`Move ${image.name} up`, '↑', () => moveInQueue(position, position - 1, '.move-up'), 'move-up', position === 0);
      const down = queueButton(`Move ${image.name} down`, '↓', () => moveInQueue(position, position + 1, '.move-down'), 'move-down', position === images.length - 1);
      const remove = queueButton(`Remove ${image.name}`, '×', () => {
        URL.revokeObjectURL(image.url);
        images = images.filter(candidate => candidate.id !== image.id);
        clearOutputs();
        renderQueue();
        message('');
        $(images.length ? 'add' : 'browse').focus();
      }, 'remove');
      item.append(grip, thumbnail, label, crop, up, down, remove);
      row.append(item);
    }
    list.append(row);
  });
  renderPreview();
}

async function addFiles(source) {
  if (busy) return;
  setBusy(true);
  message('Reading images…');
  const errors = [];
  try {
    const files = typeof source === 'function' ? await source() : source;
    const decoded = await readPhotos(files);
    errors.push(...decoded.errors);
    if (decoded.photos.length) {
      clearOutputs();
      images.push(...decoded.photos.map(photo => ({ ...photo, id: nextId++ })));
    }
    if (!manualOrder) images = sortByFilename(images);
    renderQueue();
    message(errors.length ? `Skipped ${errors.length} file(s):\n${errors.join('\n')}` : '', Boolean(errors.length));
  } catch {
    message('Could not load the images. Try selecting files from your device.', true);
  } finally {
    fileField.value = '';
    setBusy(false);
  }
}

function joinedPlan(group) {
  return joinComposition(group, direction, {
    fill: $('join-fill').value,
    color: $('join-color').value,
    border: Number($('join-border').value),
  });
}

async function drawComposition(canvas, group, plan, isCurrent = () => true) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.scale(canvas.width / plan.width, canvas.height / plan.height);
  if (plan.background) {
    context.fillStyle = plan.background;
    context.fillRect(0, 0, plan.width, plan.height);
  }
  context.fillStyle = $('join-border-color').value;
  for (const rect of plan.frame) context.fillRect(...rect);
  for (const [index, source] of group.entries()) {
    if (!isCurrent()) return;
    const image = new Image();
    image.src = source.url;
    await image.decode();
    if (!isCurrent()) return;
    const { x, y, width, height } = plan.regions[index];
    const destination = plan.sizes[index];
    context.drawImage(image, x, y, width, height, ...plan.positions[index], destination.width, destination.height);
  }
}

function fitsExport(plan) {
  return plan.width <= 16384 && plan.height <= 16384 && plan.width * plan.height <= 40_000_000;
}

async function renderPreview() {
  const revision = ++previewRevision;
  const active = () => revision === previewRevision;
  const size = groupSize();
  const visible = images.length >= 2 && size !== null;
  $('preview').hidden = $('show-preview').hidden = !visible;
  if (!visible) {
    previewIndex = 0;
    return;
  }
  const groups = groupInOrder(images, size);
  previewIndex = Math.min(previewIndex, groups.length - 1);
  const group = groups[previewIndex];
  const plan = joinedPlan(group);
  const canvas = $('preview-canvas');
  $('preview-size').textContent = `${plan.width} × ${plan.height} px`;
  $('preview-group').textContent = `Group ${previewIndex + 1} of ${groups.length}`;
  $('preview-nav').hidden = groups.length === 1;
  $('previous-group').disabled = previewIndex === 0;
  $('next-group').disabled = previewIndex === groups.length - 1;
  canvas.hidden = true;
  $('preview-status').textContent = 'Updating preview…';

  const scratch = node('canvas');
  const scale = Math.min(1, 768 / Math.max(plan.width, plan.height));
  scratch.width = Math.max(1, Math.round(scale * plan.width));
  scratch.height = Math.max(1, Math.round(scale * plan.height));
  try {
    await drawComposition(scratch, group, plan, active);
    if (!active()) return;
    canvas.width = scratch.width;
    canvas.height = scratch.height;
    canvas.getContext('2d').drawImage(scratch, 0, 0);
    canvas.setAttribute('aria-label', `${direction} preview of ${group.map(image => image.name).join(', ')}`);
    canvas.hidden = false;
    $('preview-status').textContent = fitsExport(plan) ? '' : 'Too large to export. Try fewer images per group or a tighter crop.';
  } catch {
    if (active()) $('preview-status').textContent = 'This preview could not be displayed.';
  } finally {
    scratch.width = scratch.height = 1;
  }
}

$('previous-group').onclick = () => { previewIndex--; renderPreview(); };
$('next-group').onclick = () => { previewIndex++; renderPreview(); };
$('show-preview').onclick = () => {
  $('preview-title').focus({ preventScroll: true });
  $('preview').scrollIntoView({ block: 'start' });
};

async function joinGroup(group, name) {
  const plan = joinedPlan(group);
  if (!fitsExport(plan)) throw new Error('Output is too large. Try fewer images per group or a tighter crop.');
  const canvas = node('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  try {
    await drawComposition(canvas, group, plan);
    const blob = await encodePng(canvas);
    return { name, blob, url: URL.createObjectURL(blob), width: plan.width, height: plan.height, sources: group.map(source => source.name) };
  } finally {
    canvas.width = canvas.height = 1;
  }
}

function resultCard(output) {
  const card = node('article', 'result-card');
  const preview = node('div', 'result-preview');
  const image = node('img');
  image.src = output.url;
  image.alt = `Joined images: ${output.sources.join(', ')}`;
  image.loading = 'lazy';
  preview.append(image);
  const meta = node('div', 'result-meta');
  const link = node('a', 'button add-secondary', 'Save PNG ↓');
  link.href = output.url;
  link.download = output.name;
  if (android) {
    link.addEventListener('click', async event => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      saveMessage('Saving PNG…');
      try {
        const result = await downloadBlob(output.blob, output.name);
        saveMessage(result === 'saved' ? 'PNG saved to Downloads.' : '');
      } catch (error) {
        saveMessage(error.message, true);
      } finally {
        setBusy(false);
      }
    });
  }
  link.setAttribute('aria-label', `Save ${output.name}`);
  meta.append(node('strong', '', output.name), node('p', 'hint', `${output.width} × ${output.height} px`), link);
  card.append(preview, meta);
  return card;
}

$('generate').onclick = async () => {
  clearOutputs();
  setBusy(true);
  const groups = groupInOrder(images, groupSize());
  const errors = [];
  for (const [index, group] of groups.entries()) {
    message(`Joining group ${index + 1} of ${groups.length}…`);
    try {
      outputs.push(await joinGroup(group, outputFilename(nameField.value, index, offset(), direction)));
    } catch (error) {
      errors.push(`Group ${index + 1}: ${error.message}`);
    }
  }
  $('result-grid').append(...outputs.map(resultCard));
  $('results').hidden = outputs.length === 0;
  $('result-summary').textContent = `${outputs.length} PNG ${outputs.length === 1 ? 'image' : 'images'}`;
  setBusy(false);
  message(errors.length ? `${outputs.length} created.\n${errors.join('\n')}` : '', Boolean(errors.length));
  if (outputs.length) {
    $('results-title').focus({ preventScroll: true });
    $('results').scrollIntoView({ block: 'start' });
  }
};

$('save-all').onclick = async () => {
  if (busy || !outputs.length) return;
  setBusy(true);
  saveMessage('Saving images…');
  try {
    const outcomes = await saveImageFiles(outputs, current => {
      saveMessage(`Saving image ${current} of ${outputs.length}…`);
    });
    const completed = outcomes.filter(outcome => outcome === (android ? 'saved' : 'download')).length;
    const failed = outcomes.length - completed;
    const summary = android
      ? `Saved ${completed} of ${outcomes.length} images to Downloads.`
      : `Requested ${completed} downloads. Allow multiple downloads if your browser asks.`;
    saveMessage(failed ? `${summary} ${failed} couldn’t be saved.` : summary, failed > 0);
  } finally {
    setBusy(false);
    $('save-all').focus({ preventScroll: true });
  }
};

$('bundle').onclick = async () => {
  if (busy || !outputs.length) return;
  setBusy(true);
  saveMessage('Preparing your ZIP…');
  try {
    const prefix = safePrefix(nameField.value);
    const result = await downloadBlob(await makeZip(outputs), prefix ? `${prefix}.zip` : 'pairwise-images.zip');
    saveMessage(result === 'saved' ? 'ZIP saved to Downloads.' : result === 'download' ? 'ZIP download requested.' : '');
  } catch (error) {
    saveMessage(error.message, true);
  } finally {
    setBusy(false);
    $('bundle').focus({ preventScroll: true });
  }
};

$('browse').onclick = $('add').onclick = () => fileField.click();
$('sample').onclick = () => addFiles(sampleFiles);
fileField.onchange = event => { if (event.target.files.length) addFiles(event.target.files); };
const dropzone = $('dropzone');
for (const type of ['dragenter', 'dragover']) {
  dropzone.addEventListener(type, event => {
    event.preventDefault();
    if (!busy) dropzone.classList.add('drag');
  });
}
dropzone.addEventListener('dragleave', event => {
  if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('drag');
});
dropzone.addEventListener('drop', event => {
  dropzone.classList.remove('drag');
  if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
});
for (const type of ['dragover', 'drop']) window.addEventListener(type, event => event.preventDefault());

$('clear').onclick = () => {
  for (const image of images) URL.revokeObjectURL(image.url);
  images = [];
  clearOutputs();
  renderQueue();
  message('');
  $('browse').focus();
};

$('sort').onclick = () => {
  manualOrder = false;
  images = sortByFilename(images);
  clearOutputs();
  renderQueue();
  message('Sorted by filename.');
};

for (const value of directions) {
  $(value).onclick = () => {
    if (direction === value) return;
    direction = value;
    for (const option of directions) $(option).setAttribute('aria-pressed', String(option === direction));
    clearOutputs();
    updateControls();
    renderPreview();
    message('');
  };
}

function regroup() {
  clearOutputs();
  renderQueue();
  message('');
}
groupField.oninput = regroup;
$('decrease').onclick = () => {
  groupField.value = groupSize() - 1;
  regroup();
};
$('increase').onclick = () => {
  groupField.value = groupSize() === null ? 2 : groupSize() + 1;
  regroup();
};
for (const field of [nameField, offsetField]) {
  field.oninput = () => {
    clearOutputs();
    updateControls();
    message('');
  };
}
updateControls();

const fitHints = {
  transparent: 'Keep original sizes and leave the extra space transparent.',
  resize: 'Scale proportionally to the widest image for a stack, or the tallest for a row.',
  solid: 'Keep original sizes and fill the extra space with a color.',
};

for (const id of ['join-fill', 'join-color', 'join-border', 'join-border-color']) {
  $(id).oninput = () => {
    $('join-border-value').textContent = `${$('join-border').value} px`;
    $('join-fit-hint').textContent = fitHints[$('join-fill').value];
    $('join-color-row').hidden = $('join-fill').value !== 'solid';
    clearOutputs();
    updateControls();
    renderPreview();
    message('');
  };
}

createCollage();
createCutout(openCrop);

function showMode() {
  const mode = location.hash.slice(1);
  const titles = { home: 'mode-title', join: 'title', collage: 'collage-title', cutout: 'cutout-title' };
  const active = Object.hasOwn(titles, mode) ? mode : 'home';
  $('mode-home').hidden = active !== 'home';
  $('join-mode').hidden = $('join-actions').hidden = active !== 'join';
  $('collage-mode').hidden = $('collage-actions').hidden = active !== 'collage';
  $('cutout-mode').hidden = $('cutout-actions').hidden = active !== 'cutout';
  $('back-to-modes').hidden = active === 'home';
  window.scrollTo(0, 0);
  $(titles[active]).focus({ preventScroll: true });
}

window.addEventListener('hashchange', showMode);
showMode();
