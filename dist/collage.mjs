import { collageCells, exportSizes, framedImage, templates } from './composer.mjs';
import { downloadBlob, encodePng, readPhotos, sampleFiles } from './photos.mjs';

const center = { zoom: 1, panX: .5, panY: .5 };
const clamp = value => Math.max(0, Math.min(1, value));

export function createCollage() {
  const get = id => document.getElementById(id);
  const board = get('collage-board');
  const picker = get('collage-files');
  const sizePicker = get('collage-size');
  const countPicker = get('collage-count');
  const borderInput = get('collage-border');
  const borderColor = get('collage-border-color');
  const zoom = get('collage-zoom');
  let template = templates[0];
  let slots = Array(template.cells.length).fill(null);
  let tray = [];
  let selected = -1;
  let moveFrom = -1;
  let trayPick = null;
  let importSlot = null;
  let layoutChosen = false;
  let busy = false;

  for (const size of exportSizes) sizePicker.add(new Option(size.name, size.id));

  function element(tag, className, text) {
    const item = document.createElement(tag);
    item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  function size() {
    return exportSizes.find(item => item.id === sizePicker.value);
  }

  function cells() {
    return collageCells(template, size(), Number(borderInput.value));
  }

  function setStatus(text = '', error = false) {
    const status = get('collage-status');
    status.textContent = text;
    status.classList.toggle('error', error);
  }

  function resizeSlots(next) {
    template = next;
    if (slots.length > next.cells.length) tray = [...slots.splice(next.cells.length).filter(Boolean), ...tray];
    while (slots.length < next.cells.length) slots.push(null);
    fillFromTray();
    if (selected >= slots.length || !slots[selected]) selected = -1;
    moveFrom = -1;
    trayPick = null;
    countPicker.value = String(next.cells.length);
  }

  function fillFromTray() {
    slots = slots.map(photo => photo ?? tray.shift() ?? null);
  }

  function renderTemplates() {
    const list = get('collage-templates');
    const choices = templates.filter(item => item.cells.length === Number(countPicker.value));
    list.replaceChildren(...choices.map(choice => {
      const button = element('button', 'collage-layout');
      button.dataset.template = choice.id;
      button.disabled = busy;
      button.setAttribute('aria-pressed', String(choice === template));
      const icon = element('span', 'layout-symbol');
      icon.setAttribute('aria-hidden', 'true');
      icon.style.gridTemplate = `repeat(${choice.rows}, 1fr) / repeat(${choice.columns}, 1fr)`;
      for (const [x, y, width, height] of choice.cells) {
        const block = document.createElement('i');
        block.style.gridArea = `${y + 1} / ${x + 1} / span ${height} / span ${width}`;
        icon.append(block);
      }
      button.append(icon, document.createTextNode(choice.name));
      button.onclick = () => {
        layoutChosen = true;
        resizeSlots(choice);
        render();
        list.querySelector(`[data-template="${choice.id}"]`).focus({ preventScroll: true });
      };
      return button;
    }));
  }

  function photoPosition(img, photo, cell) {
    const frame = framedImage(photo, cell);
    img.style.left = `${frame.x / cell.width * 100}%`;
    img.style.top = `${frame.y / cell.height * 100}%`;
    img.style.width = `${frame.width / cell.width * 100}%`;
    img.style.height = `${frame.height / cell.height * 100}%`;
  }

  function openPicker(index = null) {
    if (busy) return;
    importSlot = index;
    picker.multiple = index === null;
    picker.click();
  }

  function activateSlot(index) {
    if (busy) return;
    if (trayPick) {
      const photo = trayPick;
      tray.splice(tray.indexOf(photo), 1);
      if (slots[index]) tray.push(slots[index]);
      slots[index] = photo;
      trayPick = null;
      selected = index;
      setStatus(`Placed ${photo.name} in slot ${index + 1}.`);
      render();
    } else if (moveFrom !== -1) {
      if (moveFrom !== index) {
        [slots[index], slots[moveFrom]] = [slots[moveFrom], slots[index]];
        setStatus(`Moved ${slots[index].name} to slot ${index + 1}.`);
      }
      moveFrom = -1;
      selected = index;
      render();
    } else if (!slots[index]) {
      openPicker(index);
    } else {
      selected = index;
      renderSelection();
    }
  }

  function makeSlot(index) {
    const button = element('button', 'collage-slot');
    button.type = 'button';
    let drag;
    let suppressClick = false;
    button.onclick = event => {
      if (suppressClick && event.detail) return;
      activateSlot(index);
    };
    button.onpointerdown = event => {
      suppressClick = false;
      const photo = slots[index];
      if (!photo || moveFrom !== -1 || trayPick || busy || !event.isPrimary || event.button !== 0) return;
      const cell = cells()[index];
      const visible = button.getBoundingClientRect();
      const frame = framedImage(photo, cell);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, visible, cell, frame };
      button.setPointerCapture(event.pointerId);
    };
    button.onpointermove = event => {
      if (drag?.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!suppressClick && Math.hypot(dx, dy) < 4) return;
      suppressClick = true;
      selected = index;
      const photo = slots[index];
      const slackX = drag.cell.width - drag.frame.width;
      const slackY = drag.cell.height - drag.frame.height;
      if (slackX < 0) photo.panX = clamp((drag.frame.x + dx * drag.cell.width / drag.visible.width) / slackX);
      if (slackY < 0) photo.panY = clamp((drag.frame.y + dy * drag.cell.height / drag.visible.height) / slackY);
      photoPosition(button.firstElementChild, photo, drag.cell);
      renderSelection();
    };
    button.onlostpointercapture = () => { drag = null; };
    button.onkeydown = event => {
      if (!slots[index] || moveFrom !== -1 || trayPick || busy) return;
      const offsets = { ArrowLeft: ['panX', .05], ArrowRight: ['panX', -.05], ArrowUp: ['panY', .05], ArrowDown: ['panY', -.05] };
      if (!offsets[event.key]) return;
      event.preventDefault();
      const [key, amount] = offsets[event.key];
      const photo = slots[index];
      photo[key] = clamp(photo[key] + amount);
      selected = index;
      photoPosition(button.firstElementChild, photo, cells()[index]);
      renderSelection();
    };
    return button;
  }

  function renderBoard() {
    const dimensions = size();
    const aspect = dimensions.width / dimensions.height;
    board.style.width = `min(100%, ${aspect * 420}px, ${aspect * 53}dvh)`;
    board.style.aspectRatio = `${dimensions.width} / ${dimensions.height}`;
    board.style.backgroundColor = borderColor.value;
    get('collage-dimensions').textContent = `${dimensions.width} × ${dimensions.height} px`;
    get('collage-border-value').textContent = `${borderInput.value} px`;
    while (board.children.length > slots.length) board.lastElementChild.remove();
    while (board.children.length < slots.length) board.append(makeSlot(board.children.length));
    cells().forEach((cell, index) => {
      const button = board.children[index];
      button.disabled = busy;
      Object.assign(button.style, {
        left: `${cell.x / dimensions.width * 100}%`, top: `${cell.y / dimensions.height * 100}%`,
        width: `${cell.width / dimensions.width * 100}%`, height: `${cell.height / dimensions.height * 100}%`,
      });
      const photo = slots[index];
      button.classList.toggle('filled', Boolean(photo));
      button.setAttribute('aria-label', photo ? `Slot ${index + 1}: ${photo.name}` : `Add photo to slot ${index + 1}`);
      if (photo) {
        const img = button.firstElementChild?.tagName === 'IMG' ? button.firstElementChild : new Image();
        img.alt = '';
        img.draggable = false;
        if (img.src !== photo.url) img.src = photo.url;
        photoPosition(img, photo, cell);
        if (!button.contains(img)) button.replaceChildren(img);
      } else if (button.firstElementChild?.tagName !== 'SPAN') {
        const placeholder = element('span', '');
        placeholder.append(element('b', '', '+'), document.createTextNode('Add photo'));
        button.replaceChildren(placeholder);
      }
    });
    renderSelection();
  }

  function renderSelection() {
    const photo = slots[selected];
    for (const [index, button] of [...board.children].entries()) {
      button.setAttribute('aria-pressed', String(selected === index && Boolean(photo)));
    }
    get('collage-edit').hidden = !photo || Boolean(trayPick);
    get('collage-swap').setAttribute('aria-pressed', String(moveFrom !== -1));
    get('collage-swap').textContent = moveFrom === -1 ? 'Move / swap' : 'Cancel move';
    const hint = get('collage-hint');
    if (trayPick) hint.textContent = 'Tap a slot to place the selected photo.';
    else if (moveFrom !== -1) hint.textContent = 'Tap another slot to move or swap this photo.';
    else if (photo) hint.textContent = 'Drag inside the photo to reposition it. Use Zoom to change the crop.';
    else hint.textContent = 'Tap an empty slot to add a photo.';
    if (!photo) return;
    get('collage-selected-name').textContent = photo.name;
    zoom.value = photo.zoom;
    get('collage-zoom-value').textContent = `${Math.round(photo.zoom * 100)}%`;
  }

  function renderTray() {
    get('collage-tray').hidden = tray.length === 0;
    get('collage-tray-items').replaceChildren(...tray.map(photo => {
      const button = element('button', 'tray-photo');
      button.disabled = busy;
      button.setAttribute('aria-label', `Place ${photo.name}`);
      button.setAttribute('aria-pressed', String(photo === trayPick));
      const img = new Image();
      img.src = photo.url;
      img.alt = '';
      button.append(img);
      button.onclick = () => {
        trayPick = trayPick === photo ? null : photo;
        moveFrom = -1;
        renderSelection();
        renderTray();
        [...get('collage-tray-items').children][tray.indexOf(photo)].focus({ preventScroll: true });
      };
      return button;
    }));
  }

  function render() {
    renderTemplates();
    renderBoard();
    renderTray();
    const filled = slots.filter(Boolean).length;
    get('collage-ready').textContent = busy ? 'Working…' : `${filled} of ${slots.length} slots filled`;
    get('collage-save').disabled = busy || filled !== slots.length;
    get('collage-clear').hidden = filled === 0 && tray.length === 0;
    get('collage-samples').hidden = !get('collage-clear').hidden;
    for (const control of [
      'collage-count', 'collage-size', 'collage-border', 'collage-add', 'collage-samples',
      'collage-clear', 'collage-replace', 'collage-swap', 'collage-remove', 'collage-reset-view', 'collage-zoom',
    ]) get(control).disabled = busy;
    borderColor.disabled = busy || Number(borderInput.value) === 0;
  }

  async function ingest(source, index = null) {
    if (busy) return;
    busy = true;
    render();
    setStatus('Reading photos…');
    try {
      const files = typeof source === 'function' ? await source() : source;
      const { photos, errors } = await readPhotos(files);
      const additions = photos.map(photo => ({ ...photo, ...center }));
      if (index !== null && additions.length) {
        layoutChosen = true;
        if (slots[index]) tray.push(slots[index]);
        slots[index] = additions[0];
        selected = index;
        moveFrom = -1;
        trayPick = null;
      } else {
        tray.push(...additions);
        const total = slots.filter(Boolean).length + tray.length;
        if (!layoutChosen && total > slots.length) {
          resizeSlots(templates.find(choice => choice.cells.length === Math.min(total, 9)));
        } else fillFromTray();
      }
      const warning = errors.length ? `Skipped ${errors.length} file(s):\n${errors.join('\n')}` : '';
      setStatus(warning, Boolean(errors.length));
    } catch {
      setStatus('Could not load these photos.', true);
    } finally {
      busy = false;
      picker.value = '';
      render();
      if (index !== null) board.children[index]?.focus({ preventScroll: true });
    }
  }

  picker.onchange = () => {
    if (picker.files.length) ingest([...picker.files], importSlot);
  };
  get('collage-add').onclick = () => openPicker();
  get('collage-samples').onclick = () => ingest(sampleFiles);
  countPicker.onchange = () => {
    layoutChosen = true;
    resizeSlots(templates.find(choice => choice.cells.length === Number(countPicker.value)));
    render();
  };
  sizePicker.onchange = renderBoard;
  borderInput.oninput = () => {
    borderColor.disabled = Number(borderInput.value) === 0;
    renderBoard();
  };
  borderColor.oninput = () => { board.style.backgroundColor = borderColor.value; };
  zoom.oninput = () => {
    const photo = slots[selected];
    photo.zoom = Number(zoom.value);
    photoPosition(board.children[selected].firstElementChild, photo, cells()[selected]);
    get('collage-zoom-value').textContent = `${Math.round(photo.zoom * 100)}%`;
  };
  get('collage-reset-view').onclick = () => {
    Object.assign(slots[selected], center);
    renderBoard();
  };
  get('collage-replace').onclick = () => openPicker(selected);
  get('collage-swap').onclick = () => {
    moveFrom = moveFrom === -1 ? selected : -1;
    renderSelection();
  };
  get('collage-remove').onclick = () => {
    const index = selected;
    tray.push(slots[index]);
    slots[index] = null;
    selected = moveFrom = -1;
    render();
    board.children[index].focus({ preventScroll: true });
  };
  get('collage-clear').onclick = () => {
    for (const photo of [...slots, ...tray].filter(Boolean)) URL.revokeObjectURL(photo.url);
    slots = slots.map(() => null);
    tray = [];
    selected = moveFrom = -1;
    trayPick = null;
    setStatus();
    render();
    get('collage-add').focus();
  };
  get('collage-jump').onclick = () => {
    get('collage-canvas-title').focus({ preventScroll: true });
    get('collage-canvas-title').scrollIntoView({ block: 'start' });
  };

  get('collage-save').onclick = async () => {
    if (busy || slots.some(photo => !photo)) return;
    busy = true;
    render();
    const canvas = document.createElement('canvas');
    const { width, height } = size();
    canvas.width = width;
    canvas.height = height;
    try {
      const context = canvas.getContext('2d');
      context.fillStyle = borderColor.value;
      context.fillRect(0, 0, width, height);
      for (const [index, cell] of cells().entries()) {
        const photo = slots[index];
        const image = new Image();
        image.src = photo.url;
        await image.decode();
        const frame = framedImage(photo, cell);
        context.save();
        context.beginPath();
        context.rect(cell.x, cell.y, cell.width, cell.height);
        context.clip();
        context.fillStyle = '#ffffff';
        context.fillRect(cell.x, cell.y, cell.width, cell.height);
        context.drawImage(image, cell.x + frame.x, cell.y + frame.y, frame.width, frame.height);
        context.restore();
      }
      downloadBlob(await encodePng(canvas), `pairwise-collage-${width}x${height}.png`);
      setStatus('Collage download started.');
    } catch {
      setStatus('Could not save this collage.', true);
    } finally {
      canvas.width = canvas.height = 1;
      busy = false;
      render();
      get('collage-save').focus({ preventScroll: true });
    }
  };
  render();
}
