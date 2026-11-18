import { cropFromTrims, dragCrop, fitCrop, fullCrop } from './crop.mjs';

export function createCropEditor() {
  const get = id => document.getElementById(id);
  const dialog = get('crop-dialog');
  const stage = get('crop-stage');
  const source = get('crop-image');
  const box = get('crop-box');
  const ratioField = get('crop-ratio');
  const apply = get('crop-apply');
  const trims = ['left', 'top', 'right', 'bottom'].map(edge => get(`crop-${edge}`));
  let image;
  let selection;
  let drag;
  let onApply;

  function ratio() {
    return ratioField.value ? ratioField.value.split(':').map(Number) : null;
  }

  function render(syncFields = true) {
    const { x, y, width, height } = selection;
    box.style.left = `${x / image.width * 100}%`;
    box.style.top = `${y / image.height * 100}%`;
    box.style.width = `${width / image.width * 100}%`;
    box.style.height = `${height / image.height * 100}%`;
    get('crop-size').textContent = `${width} × ${height} px`;
    apply.disabled = false;
    if (syncFields) {
      [x, y, image.width - x - width, image.height - y - height].forEach((value, index) => {
        trims[index].value = value;
        trims[index].removeAttribute('aria-invalid');
      });
    }
  }

  ratioField.onchange = () => {
    if (ratio()) selection = fitCrop(image, selection, ratio());
    render();
  };

  for (const field of trims) {
    field.oninput = () => {
      const candidate = cropFromTrims(image, trims.map(input => input.valueAsNumber));
      for (const input of trims) input.removeAttribute('aria-invalid');
      if (!candidate) {
        field.setAttribute('aria-invalid', 'true');
        get('crop-size').textContent = 'Invalid crop';
        apply.disabled = true;
        return;
      }
      ratioField.value = '';
      selection = candidate;
      render(false);
    };
  }

  stage.onpointerdown = event => {
    if (!event.isPrimary || event.button !== 0 || !box.contains(event.target)) return;
    const bounds = stage.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, bounds, start: selection, mode: event.target.dataset.corner ?? 'move' };
    stage.setPointerCapture(event.pointerId);
  };

  stage.onpointermove = event => {
    if (drag?.id !== event.pointerId) return;
    const dx = Math.round((event.clientX - drag.x) * image.width / drag.bounds.width);
    const dy = Math.round((event.clientY - drag.y) * image.height / drag.bounds.height);
    selection = dragCrop(image, drag.start, drag.mode, dx, dy, ratio());
    render();
  };

  stage.onlostpointercapture = () => { drag = null; };
  get('crop-close').onclick = () => dialog.close();
  get('crop-reset').onclick = () => {
    ratioField.value = '';
    selection = fullCrop(image);
    render();
  };
  apply.onclick = () => {
    const applied = selection.width === image.width && selection.height === image.height ? null : selection;
    dialog.close();
    onApply(applied);
  };
  dialog.addEventListener('close', () => {
    if (!dialog.open) source.removeAttribute('src');
  });

  return (item, callback) => {
    image = item;
    onApply = callback;
    drag = null;
    selection = image.crop ?? fullCrop(image);
    ratioField.value = '';
    for (const option of ratioField.options) {
      const [wide, tall] = option.value.split(':').map(Number);
      option.disabled = Boolean(option.value) && (wide > image.width || tall > image.height);
    }
    const aspect = image.width / image.height;
    stage.style.width = `min(100%, ${aspect * 42}dvh, ${aspect * 370}px)`;
    stage.style.aspectRatio = `${image.width} / ${image.height}`;
    source.src = image.url;
    get('crop-filename').textContent = image.name;
    dialog.querySelector('details').open = false;
    render();
    dialog.showModal();
  };
}
