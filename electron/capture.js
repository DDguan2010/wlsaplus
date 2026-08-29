const canvas = document.querySelector('canvas');
const context = canvas.getContext('2d');
let token = '';
let image = null;
let start = null;
let current = null;

function redraw() {
  if (!image) return;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(0,0,0,.34)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!start || !current) return;
  const scaleX = canvas.width / canvas.clientWidth;
  const scaleY = canvas.height / canvas.clientHeight;
  const x = Math.min(start.x, current.x) * scaleX;
  const y = Math.min(start.y, current.y) * scaleY;
  const width = Math.abs(current.x - start.x) * scaleX;
  const height = Math.abs(current.y - start.y) * scaleY;
  context.drawImage(image, x, y, width, height, x, y, width, height);
  context.strokeStyle = '#79d7e8';
  context.lineWidth = Math.max(2, scaleX * 2);
  context.strokeRect(x, y, width, height);
}

window.captureSelection.onInit((value) => {
  token = value.token;
  image = new Image();
  image.onload = () => { canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; redraw(); };
  image.src = value.image;
});

canvas.addEventListener('pointerdown', (event) => { start = { x: event.clientX, y: event.clientY }; current = start; canvas.setPointerCapture(event.pointerId); redraw(); });
canvas.addEventListener('pointermove', (event) => { if (!start) return; current = { x: event.clientX, y: event.clientY }; redraw(); });
canvas.addEventListener('pointerup', (event) => {
  if (!start || !image) return;
  current = { x: event.clientX, y: event.clientY };
  const cssWidth = Math.abs(current.x - start.x);
  const cssHeight = Math.abs(current.y - start.y);
  if (cssWidth < 6 || cssHeight < 6) { start = null; current = null; redraw(); return; }
  const scaleX = canvas.width / canvas.clientWidth;
  const scaleY = canvas.height / canvas.clientHeight;
  const x = Math.round(Math.min(start.x, current.x) * scaleX);
  const y = Math.round(Math.min(start.y, current.y) * scaleY);
  const width = Math.max(1, Math.round(cssWidth * scaleX));
  const height = Math.max(1, Math.round(cssHeight * scaleY));
  const crop = document.createElement('canvas'); crop.width = width; crop.height = height;
  crop.getContext('2d').drawImage(image, x, y, width, height, 0, 0, width, height);
  window.captureSelection.complete({ token, image: crop.toDataURL('image/png') });
});
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') window.captureSelection.complete({ token, image: null }); });
window.addEventListener('contextmenu', (event) => { event.preventDefault(); window.captureSelection.complete({ token, image: null }); });
