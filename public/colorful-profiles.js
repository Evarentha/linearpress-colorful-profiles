/*
 * Colorful Profiles Front-End Script
 *
 * User menu, avatar crop and upload, save confirmation, media picker, timeline lazyload.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Colorful Profiles — user menu / avatar crop & upload / save confirmation /
 * media-library picking / timeline lazyload.
 *
 * @since 1.0.0
 */
(() => {

  let CF = window.__CF_CONFIG__ || {};
  const $ = (selector, root) => { return (root || document).querySelector(selector); };
  const $$ = (selector, root) => { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };

  /* ------------------------------------------------------------- 用户菜单 */
  function initMenu() {
    let menu = $('.cf-user-menu');
    if (!menu) return;
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target)) { menu.classList.remove('open'); return; }
      if (e.target.closest('.cf-menu-trigger')) menu.classList.toggle('open');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') $$('.cf-user-menu.open').forEach((m) => { m.classList.remove('open'); });
    });
  }

  /* ------------------------------------------------------------- 头像预览渲染 */
  function avatarStyle(url, crop) {
    let style = "background-image:url('" + String(url).replace(/'/g, "\\'") + "');";
    if (crop && crop.size > 0) {
      const sx = crop.size, sy = crop.sizeY || crop.size;
      style += 'background-size:' + ((1 / sx) * 100).toFixed(2) + '%;';
      // 裁剪框近乎铺满整图时 (1 - sx) 趋于 0，位置计算会除零：退回居中呈现。
      if (sx >= 0.999 || sy >= 0.999) style += 'background-position:center;';
      else style += 'background-position:' + ((crop.x / (1 - sx)) * 100).toFixed(2) + '% ' + ((crop.y / (1 - sy)) * 100).toFixed(2) + '%;';
    } else {
      style += 'background-size:cover;background-position:center;';
    }
    return style;
  }
  function renderAvatarInto(el, url, crop, px) {
    const initial = (window.__CF_INITIAL__ || '?').charAt(0).toUpperCase();
    if (!url) {
      el.innerHTML = '<span class="cf-avatar" style="width:' + px + 'px;height:' + px + 'px;font-size:' + Math.round(px * 0.42) + 'px">' + esc(initial) + '</span>';
      return;
    }
    el.innerHTML = '<span class="cf-avatar cf-avatar-img" style="width:' + px + 'px;height:' + px + 'px;' + avatarStyle(url, crop) + '" role="img" aria-label="avatar"></span>';
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------- 头像选取 + 裁剪 */
  function initAvatarEditor() {
    let editBtn = $('#cf-avatar-edit');
    let fileInput = $('#cf-avatar-file');
    let preview = $('#cf-avatar-preview');
    let status = $('#cf-avatar-status');
    let removeBtn = $('#cf-avatar-remove');
    let modal = $('#cf-crop-modal');
    let wrap = $('#cf-crop-wrap');
    let img = $('#cf-crop-image');
    let rect = $('#cf-crop-rect');
    let confirmBtn = $('#cf-crop-confirm');
    let cancelBtn = $('#cf-crop-cancel');
    let uploadBtn = $('#cf-upload-new');
    if (!editBtn || !modal) return;

    let limitPx = Number(CF.sizeLimitPx) || 1024;
    let limitMb = Number(CF.sizeLimitMb) || 10;
    let allowedTypes = ['image/png', 'image/gif', 'image/jpeg', 'image/webp'];

    let state = null; // { file, imgW, imgH, crop }

    function setStatus(message, ok) {
      status.textContent = message || '';
      status.className = 'cf-avatar-status ' + (ok ? 'ok' : 'err');
    }

    function showModal() { modal.hidden = false; }
    function hideModal() { modal.hidden = true; }

    editBtn.addEventListener('click', () => { fileInput.click(); });

    fileInput.addEventListener('change', () => {
      let file = fileInput.files && fileInput.files[0];
      if (file) handleCandidateFile(file);
      fileInput.value = '';
    });

    // 本地选择与媒体库选择共用的“校验 + 裁剪”入口
    function handleCandidateFile(file) {
      if (allowedTypes.indexOf(file.type) === -1) { setStatus('不支持的图片格式：仅支持 JPG / PNG / GIF / WebP。', false); return; }
      if (file.size / 1024 / 1024 > limitMb) { setStatus('文件不能超过 ' + limitMb + 'MB。', false); return; }

      let url = URL.createObjectURL(file);
      let probe = new Image();
      probe.onload = () => {
        let w = probe.naturalWidth, h = probe.naturalHeight;
        if (w > limitPx || h > limitPx) {
          setStatus('画面尺寸不能超过 ' + limitPx + '×' + limitPx + '，当前 ' + w + '×' + h + '。', false);
          URL.revokeObjectURL(url);
          return;
        }
        openCropper(file, url, w, h);
      };
      probe.onerror = () => { setStatus('无法读取图片文件。', false); URL.revokeObjectURL(url); };
      probe.src = url;
    }

    function openCropper(file, url, imgW, imgH) {
      img.src = url;
      state = { file: file, imgW: imgW, imgH: imgH, crop: null, uploaded: false };
      showModal();
      // 等待图片加载后初始化
      img.onload = () => { initCrop(); };
      // 恢复默认按钮状态
      confirmBtn.hidden = false; cancelBtn.hidden = false; uploadBtn.hidden = true;
      rect.style.display = '';
      wrap.style.display = '';
      $$('.cf-modal-sub', modal).forEach((p) => { p.hidden = false; });
    }

    /* ---- 裁剪几何 ---- */
    let cropGeom = null; // { imgLeft, imgTop, imgW, imgH, rx, ry, rs }
    let pointers = {};
    let mode = null; // 'move' | 'resize' | 'pinch'
    let pinchStart = null;

    function wrapSize() { return wrap.clientWidth; }
    function initCrop() {
      let stage = wrapSize();
      let scale = Math.min(stage / state.imgW, stage / state.imgH);
      let dw = state.imgW * scale, dh = state.imgH * scale;
      let left = (stage - dw) / 2, top = (stage - dh) / 2;
      let s = Math.min(dw, dh) * 0.72;
      s = Math.max(48, Math.min(s, Math.min(dw, dh)));
      let rx = left + (dw - s) / 2, ry = top + (dh - s) / 2;
      cropGeom = { imgLeft: left, imgTop: top, imgW: dw, imgH: dh, rx: rx, ry: ry, rs: s };
      applyCropGeom();
    }

    function applyCropGeom() {
      let g = cropGeom;
      img.style.left = g.imgLeft + 'px';
      img.style.top = g.imgTop + 'px';
      img.style.width = g.imgW + 'px';
      img.style.height = g.imgH + 'px';
      rect.style.left = g.rx + 'px';
      rect.style.top = g.ry + 'px';
      rect.style.width = g.rs + 'px';
      rect.style.height = g.rs + 'px';
    }

    function clampRect() {
      let g = cropGeom;
      g.rx = Math.max(g.imgLeft, Math.min(g.rx, g.imgLeft + g.imgW - g.rs));
      g.ry = Math.max(g.imgTop, Math.min(g.ry, g.imgTop + g.imgH - g.rs));
    }

    wrap.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      let target = e.target;
      if (target === img) {
        if (Object.keys(pointers).length === 2) { mode = 'pinch'; return; }
        mode = null; // 点按图片空白：无操作（避免与拖动矩形冲突）
        return;
      }
      if (target === rect || target.closest('.cf-crop-rect')) {
        let r = rect.getBoundingClientRect();
        if (e.clientX > r.right - 24 && e.clientY > r.bottom - 24) mode = 'resize';
        else mode = 'move';
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      }
      wrap.setPointerCapture(e.pointerId);
    });

    wrap.addEventListener('pointermove', (e) => {
      if (!(e.pointerId in pointers)) return;
      let prev = pointers[e.pointerId];
      let dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };

      if (mode === 'pinch') {
        let ids = Object.keys(pointers);
        if (ids.length >= 2) {
          let p1 = pointers[ids[0]], p2 = pointers[ids[1]];
          let dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          if (pinchStart) {
            let ratio = dist / pinchStart.dist;
            let stage = wrapSize();
            let g = cropGeom;
            let cx = g.rx + g.rs / 2, cy = g.ry + g.rs / 2;
            let newW = g.imgW * ratio, newH = g.imgH * ratio;
            let minW = Math.max(g.rs, stage * 0.5);
            if (newW >= minW && newW <= stage * 6) {
              g.imgLeft = cx - (cx - g.imgLeft) * (newW / g.imgW);
              g.imgTop = cy - (cy - g.imgTop) * (newH / g.imgH);
              g.imgW = newW; g.imgH = newH;
              applyCropGeom();
            }
          }
          pinchStart = { dist: dist };
        }
        return;
      }
      if (mode === 'move') { cropGeom.rx += dx; cropGeom.ry += dy; clampRect(); applyCropGeom(); }
      else if (mode === 'resize') {
        let g = cropGeom;
        g.rs += Math.max(dx, dy);
        let minS = Math.max(32, wrapSize() * 0.12);
        let maxS = Math.min(g.imgLeft + g.imgW - g.rx, g.imgTop + g.imgH - g.ry);
        g.rs = Math.max(minS, Math.min(g.rs, maxS));
        applyCropGeom();
      }
    });

    function endPointer(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) { mode = mode === 'pinch' ? null : mode; pinchStart = null; }
      if (Object.keys(pointers).length === 0) { mode = null; pinchStart = null; }
    }
    wrap.addEventListener('pointerup', endPointer);
    wrap.addEventListener('pointercancel', endPointer);

    function normalizedCrop() {
      let g = cropGeom;
      let x = (g.rx - g.imgLeft) / g.imgW;
      let y = (g.ry - g.imgTop) / g.imgH;
      let size = g.rs / g.imgW;
      let sizeY = g.rs / g.imgH;
      return { x: x, y: y, size: size, sizeY: sizeY };
    }

    cancelBtn.addEventListener('click', () => { hideModal(); URL.revokeObjectURL(img.src); state = null; });

    confirmBtn.addEventListener('click', () => {
      if (!state) return;
      state.crop = normalizedCrop();
      // 裁剪完成：进入“上传新头像”步骤
      confirmBtn.hidden = true; cancelBtn.hidden = true;
      uploadBtn.hidden = false;
      $$('.cf-modal-sub', modal).forEach((p) => { p.hidden = true; });
      rect.style.display = 'none';
    });

    uploadBtn.addEventListener('click', async () => {
      if (!state || !state.crop) return;
      uploadBtn.disabled = true;
      uploadBtn.textContent = '上传中…';
      let fd = new FormData();
      fd.append('avatar', state.file);
      fd.append('width', String(state.imgW));
      fd.append('height', String(state.imgH));
      fd.append('crop', JSON.stringify(state.crop));
      try {
        let res = await fetch(CF.uploadUrl, { method: 'POST', body: fd });
        let data = await res.json();
        if (!data.ok) throw new Error(data.message || '上传失败');
        // 更新预览
        renderAvatarInto(preview, data.avatarUrl, data.crop, 96);
        $('#cf-avatar-hidden').value = data.avatarUrl;
        removeBtn.hidden = false;
        setStatus('新头像已上传。', true);
        hideModal();
        URL.revokeObjectURL(img.src);
        state = null;
      } catch (err) {
        setStatus(err.message || '上传失败，请重试。', false);
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = '上传新头像';
      }
    });

    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        $('#cf-avatar-hidden').value = '';
        $('#cf-avatar-removed').value = '1';
        renderAvatarInto(preview, null, null, 96);
        removeBtn.hidden = true;
        setStatus('头像已标记移除，保存后生效。', true);
      });
    }

    return { editFile: handleCandidateFile };
  }

  /* ------------------------------------------------------------- 媒体库选择 */
  function initMediaPicker(picker) {
    let pickBtn = $('#cf-avatar-pick');
    if (!pickBtn || !CF.mediaEnabled || !picker) return;
    let modal = $('#cf-media-modal');
    let grid = $('#cf-media-grid');
    let cancelBtn = $('#cf-media-cancel');
    let limitPx = Number(CF.sizeLimitPx) || 1024;
    let limitMb = Number(CF.sizeLimitMb) || 10;

    pickBtn.addEventListener('click', async () => {
      modal.hidden = false;
      grid.innerHTML = '<p class="cf-media-loading">加载中…</p>';
      try {
        let res = await fetch(CF.mediaApi);
        let data = await res.json();
        if (!data.ok || !data.items) throw new Error('媒体库加载失败');
        grid.innerHTML = '';
        data.items.forEach((item) => {
          if (item.kind !== 'image') return;
          if (item.size / 1024 / 1024 > limitMb) return; // 超过大小上限的不展示
          let el = document.createElement('div');
          el.className = 'cf-media-item';
          let imgEl = document.createElement('img');
          imgEl.src = item.url; imgEl.alt = item.original_name || '';
          el.appendChild(imgEl);
          el.addEventListener('click', () => {
            // 校验画面尺寸
            let probe = new Image();
            probe.onload = () => {
              if (probe.naturalWidth > limitPx || probe.naturalHeight > limitPx) {
                alert('该图片画面尺寸（' + probe.naturalWidth + '×' + probe.naturalHeight + '）超过 ' + limitPx + '×' + limitPx + '，请选择其它图片。');
                return;
              }
              $$('.cf-media-item', grid).forEach((x) => { x.classList.remove('selected'); });
              el.classList.add('selected');
              modal.hidden = true;
              // 与本地上传走同一条“校验 + 正方形裁剪 + 上传”链路，而非直接引用媒体库 URL
              fetch(item.url)
                .then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r.blob(); })
                .then((blob) => { picker.editFile(new File([blob], item.original_name || 'avatar', { type: blob.type })); })
                .catch(() => { alert('无法读取该图片。'); });
            };
            probe.onerror = () => { alert('无法读取该图片。'); };
            probe.src = item.url;
          });
          grid.appendChild(el);
        });
        if (!grid.children.length) grid.innerHTML = '<p class="cf-media-loading">媒体库中没有可用的图片。</p>';
      } catch (err) {
        grid.innerHTML = '<p class="cf-media-loading">加载失败：' + esc(err.message) + '</p>';
      }
    });
    cancelBtn.addEventListener('click', () => { modal.hidden = true; });
  }

  /* ------------------------------------------------------------- 保存二次确认 */
  function initSaveFlow() {
    let saveBtn = $('#cf-save-btn');
    if (!saveBtn) return;
    let form = $('#cf-profile-form');
    let confirmPop = $('#cf-confirm-pop');
    let confirmOk = $('#cf-confirm-ok');
    let confirmCancel = $('#cf-confirm-cancel');
    let emailModal = $('#cf-email-modal');
    let emailOk = $('#cf-email-ok');
    let emailCancel = $('#cf-email-cancel');
    let emailOld = $('#cf-email-old');
    let emailNew = $('#cf-email-new');
    let emailInput = $('#cf-email');
    let originalEmail = (emailInput && emailInput.getAttribute('data-original-email')) || '';
    let statusLine = document.createElement('p');
    statusLine.className = 'cf-notice';
    statusLine.style.marginTop = '12px';
    form.parentNode.insertBefore(statusLine, form.nextSibling);

    function showEl(el) { el.hidden = false; }
    function hideEl(el) { el.hidden = true; }
    function confirm(modal, okBtn, cancelBtn) {
      return new Promise((resolve) => {
        showEl(modal);
        function done(value) {
          hideEl(modal);
          okBtn.removeEventListener('click', onOk);
          cancelBtn.removeEventListener('click', onCancel);
          resolve(value);
        }
        function onOk() { done(true); }
        function onCancel() { done(false); }
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
      });
    }

    saveBtn.addEventListener('click', async () => {
      statusLine.textContent = '';
      let emailChanged = emailInput && emailInput.value.trim() !== originalEmail;
      let proceed = true;

      // 改邮箱 → 侵入式提示（先）
      if (CF.emailVerifyEnabled && emailChanged && emailModal) {
        emailOld.textContent = originalEmail || '（空）';
        emailNew.textContent = emailInput.value.trim();
        proceed = await confirm(emailModal, emailOk, emailCancel);
      }
      if (!proceed) return; // 取消/关闭：保留更改，不保存

      // 非侵入式确认弹窗（后）
      $('#cf-confirm-text').textContent = emailChanged ? '包含邮箱变更，保存后按上述提示完成验证。' : '点击「确认保存」后立即生效。';
      proceed = await confirm(confirmPop, confirmOk, confirmCancel);
      if (!proceed) return;

      // 提交
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中…';
      try {
        let payload = {
          nickname: $('#cf-nickname').value,
          email: emailInput.value.trim(),
          website: $('#cf-website').value.trim(),
          bio: $('#cf-bio').value,
          contact: $('#cf-contact').value.trim(),
          representative: $('#cf-representative').value.trim(),
          avatar: $('#cf-avatar-hidden').value,
          avatar_removed: $('#cf-avatar-removed').value || ''
        };
        let res = await fetch(CF.saveUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        let data = await res.json();
        if (!data.ok) throw new Error(data.message || '保存失败');
        originalEmail = emailInput.value.trim();
        emailInput.setAttribute('data-original-email', originalEmail);
        $('#cf-avatar-removed').value = '';
        statusLine.textContent = data.message || '资料已保存。';
        statusLine.className = 'cf-notice';
      } catch (err) {
        statusLine.textContent = err.message || '保存失败，请重试。';
        statusLine.className = 'cf-notice cf-notice-error';
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
      }
    });
  }

  /* ------------------------------------------------------------- 时间线 lazyload */
  function initTimeline() {
    let loadMore = $('#cf-load-more');
    let timeline = $('#cf-timeline');
    if (!loadMore || !timeline) return;
    let username = timeline.getAttribute('data-username');
    let pageSize = Number(timeline.getAttribute('data-page-size')) || 10;
    let offset = $$('.cf-tl-item', timeline).length;

    function itemHtml(p) {
      let date = String(p.created_at || '').slice(0, 10).replace(/-/g, '/');
      let month = String(p.created_at || '').slice(0, 7);
      return { month: month, html: '<div class="cf-tl-item" data-date="' + date + '"><span class="cf-tl-marker"></span><a class="cf-tl-link" href="' + esc(p.url) + '">' + esc(p.title) + '</a><span class="cf-tl-date">' + date + '</span></div>' };
    }

    loadMore.addEventListener('click', async () => {
      loadMore.disabled = true;
      loadMore.textContent = '加载中…';
      try {
        let res = await fetch('/api/profiles/' + encodeURIComponent(username) + '/posts?offset=' + offset + '&limit=' + pageSize);
        let data = await res.json();
        if (!data.ok || !data.posts || !data.posts.length) { loadMore.hidden = true; return; }
        let tl = $('#cf-tl');
        data.posts.forEach((p) => {
          let item = itemHtml(p);
          let group = tl.querySelector('.cf-tl-group[data-month="' + item.month + '"]');
          if (!group) {
            group = document.createElement('div');
            group.className = 'cf-tl-group';
            group.setAttribute('data-month', item.month);
            group.innerHTML = '<div class="cf-tl-month"><span class="cf-tl-dot"></span><span class="cf-tl-month-text">' + item.month.replace(/^(\d{4})-(\d{2})$/, (m, y, mo) => { return y + '年' + Number(mo) + '月'; }) + '</span></div><div class="cf-tl-items"></div>';
            tl.appendChild(group);
          }
          let holder = group.querySelector('.cf-tl-items');
          let temp = document.createElement('div');
          temp.innerHTML = item.html;
          holder.appendChild(temp.firstChild);
        });
        offset += data.posts.length;
        if (!data.hasMore) { loadMore.hidden = true; return; }
      } catch (e) {
        loadMore.textContent = '加载失败，点击重试';
      } finally {
        loadMore.disabled = false;
        if (loadMore.textContent === '加载中…') loadMore.textContent = '加载更多';
      }
    });
  }

  /* ------------------------------------------------------------- 初始化 */
  function boot() {
    initMenu();
    if ($('#cf-profile-form')) {
      // 记录当前头像初始字母供移除后兜底：优先服务端渲染的 data-cf-initial（图片头像时 span 无文本）
      let preview = $('#cf-avatar-preview');
      if (preview) {
        window.__CF_INITIAL__ = preview.getAttribute('data-cf-initial')
          || (preview.querySelector('.cf-avatar') || {}).textContent
          || '?';
      }
      let avatarEditor = initAvatarEditor();
      initMediaPicker(avatarEditor);
      initSaveFlow();
    }
    initTimeline();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();