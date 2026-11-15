/*
 * Colorful Profiles Client
 *
 * Avatar upload with a square crop selector (the file itself is kept, so animations survive).
 *
 * Authors:
 * MoyuZJ <moyuzj@evarentha.com> @LinearTeam - Made in China with ♥
 * worryzu <worryzu@evarentha.com> @LinearTeam
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
(() => {
  const card = document.querySelector('[data-cp-avatar]');
  const dialog = document.querySelector('[data-cp-dialog]');
  if (!card || !dialog) return;
  const LP = window.LinearPress;
  const input = card.querySelector('[data-cp-file]');
  const image = dialog.querySelector('[data-cp-image]');
  const stage = dialog.querySelector('[data-cp-stage]');
  const frame = dialog.querySelector('[data-cp-crop-frame]');
  const zoom = dialog.querySelector('[data-cp-zoom]');
  const maxMb = Number(card.dataset.maxMb) || 10;
  const maxPx = Number(card.dataset.maxPx) || 1024;
  let file = null;
  // Selection in image fractions: a square of `side` image pixels at (x, y).
  const sel = { x: 0, y: 0, side: 0 };
  const natural = () => ({ w: image.naturalWidth, h: image.naturalHeight });

  const layout = () => {
    const { w, h } = natural();
    const scale = image.clientWidth / w;
    Object.assign(frame.style, { left: `${sel.x * scale}px`, top: `${sel.y * scale}px`, width: `${sel.side * scale}px`, height: `${sel.side * scale}px` });
    void h;
  };
  const clamp = () => {
    const { w, h } = natural();
    sel.side = Math.max(16, Math.min(sel.side, w, h));
    sel.x = Math.min(Math.max(0, sel.x), w - sel.side);
    sel.y = Math.min(Math.max(0, sel.y), h - sel.side);
    layout();
  };

  input.addEventListener('change', () => {
    file = input.files?.[0] || null;
    input.value = '';
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) { LP.toast(`图片不能超过 ${maxMb}MB`, 'danger'); return; }
    image.onload = () => {
      const { w, h } = natural();
      if (w > maxPx || h > maxPx) { LP.toast(`图片尺寸 ${w}×${h} 超过上限 ${maxPx}×${maxPx}`, 'danger'); return; }
      sel.side = Math.min(w, h); sel.x = (w - sel.side) / 2; sel.y = (h - sel.side) / 2;
      zoom.value = '100';
      dialog.showModal();
      requestAnimationFrame(layout);
    };
    image.src = URL.createObjectURL(file);
  });

  zoom.addEventListener('input', () => {
    const { w, h } = natural();
    const cx = sel.x + sel.side / 2; const cy = sel.y + sel.side / 2;
    sel.side = Math.min(w, h) * Number(zoom.value) / 100;
    sel.x = cx - sel.side / 2; sel.y = cy - sel.side / 2;
    clamp();
  });
  let drag = null;
  frame.addEventListener('pointerdown', (event) => { drag = { x: event.clientX, y: event.clientY, sx: sel.x, sy: sel.y }; frame.setPointerCapture(event.pointerId); });
  frame.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const scale = image.clientWidth / natural().w;
    sel.x = drag.sx + (event.clientX - drag.x) / scale; sel.y = drag.sy + (event.clientY - drag.y) / scale;
    clamp();
  });
  frame.addEventListener('pointerup', () => { drag = null; });
  frame.addEventListener('keydown', (event) => {
    const step = (event.shiftKey ? 0.1 : 0.02) * natural().w;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!moves[event.key]) return;
    event.preventDefault(); sel.x += moves[event.key][0]; sel.y += moves[event.key][1]; clamp();
  });
  window.addEventListener('resize', () => { if (dialog.open) layout(); });
  dialog.querySelector('[data-cp-cancel]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src); });

  dialog.querySelector('[data-cp-save]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const { w, h } = natural();
    const crop = { x: sel.x / w, y: sel.y / h, size: sel.side / w, sizeY: sel.side / h };
    const body = new FormData();
    body.append('crop', JSON.stringify(crop));
    body.append('avatar', file);
    button.disabled = true;
    try {
      const response = await fetch('/account/profile/avatar', { method: 'POST', body, headers: { accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || '上传失败');
      card.querySelector('[data-cp-preview]').innerHTML = data.html;
      document.querySelectorAll('.site-header .avatar, .user-menu .avatar').forEach((el) => { el.outerHTML = data.html.replace('--size:96px', `--size:${el.style.getPropertyValue('--size') || '28px'}`); });
      dialog.close();
      LP.toast(data.message);
    } catch (error) { LP.toast(error.message, 'danger'); }
    finally { button.disabled = false; }
  });
})();
