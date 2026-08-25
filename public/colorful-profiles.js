/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 * Colorful Profiles —— 用户菜单 / 头像裁剪上传 / 保存确认 / 媒体库选择 / 时间线 lazyload
 */
(function () {
  'use strict';

  var CF = window.__CF_CONFIG__ || {};
  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };

  /* ------------------------------------------------------------- 用户菜单 */
  function initMenu() {
    var menu = $('.cf-user-menu');
    if (!menu) return;
    document.addEventListener('click', function (e) {
      if (!menu.contains(e.target)) { menu.classList.remove('open'); return; }
      if (e.target.closest('.cf-menu-trigger')) menu.classList.toggle('open');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') $$('.cf-user-menu.open').forEach(function (m) { m.classList.remove('open'); });
    });
  }

  /* ------------------------------------------------------------- 头像预览渲染 */
  function avatarStyle(url, crop) {
    var style = "background-image:url('" + String(url).replace(/'/g, "\\'") + "');";
    if (crop && crop.size > 0) {
      var sx = crop.size, sy = crop.sizeY || crop.size;
      style += 'background-size:' + ((1 / sx) * 100).toFixed(2) + '%;';
      style += 'background-position:' + ((crop.x / (1 - sx)) * 100).toFixed(2) + '% ' + ((crop.y / (1 - sy)) * 100).toFixed(2) + '%;';
    } else {
      style += 'background-size:cover;background-position:center;';
    }
    return style;
  }
  function renderAvatarInto(el, url, crop, px) {
    var initial = (window.__CF_INITIAL__ || '?').charAt(0).toUpperCase();
    if (!url) {
      el.innerHTML = '<span class="cf-avatar" style="width:' + px + 'px;height:' + px + 'px;font-size:' + Math.round(px * 0.42) + 'px">' + esc(initial) + '</span>';
      return;
    }
    el.innerHTML = '<span class="cf-avatar cf-avatar-img" style="width:' + px + 'px;height:' + px + 'px;' + avatarStyle(url, crop) + '" role="img" aria-label="avatar"></span>';
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------- 头像选取 + 裁剪 */
  function initAvatarEditor() {
    var editBtn = $('#cf-avatar-edit');
    var fileInput = $('#cf-avatar-file');
    var preview = $('#cf-avatar-preview');
    var status = $('#cf-avatar-status');
    var removeBtn = $('#cf-avatar-remove');
    var modal = $('#cf-crop-modal');
    var wrap = $('#cf-crop-wrap');
    var img = $('#cf-crop-image');
    var rect = $('#cf-crop-rect');
    var confirmBtn = $('#cf-crop-confirm');
    var cancelBtn = $('#cf-crop-cancel');
    var uploadBtn = $('#cf-upload-new');
    if (!editBtn || !modal) return;

    var limitPx = Number(CF.sizeLimitPx) || 1024;
    var limitMb = Number(CF.sizeLimitMb) || 10;
    var allowedTypes = ['image/png', 'image/gif', 'image/jpeg', 'image/webp'];

    var state = null; // { file, imgW, imgH, crop }

    function setStatus(message, ok) {
      status.textContent = message || '';
      status.className = 'cf-avatar-status ' + (ok ? 'ok' : 'err');
    }

    function showModal() { modal.hidden = false; }
    function hideModal() { modal.hidden = true; }

    editBtn.addEventListener('click', function () { fileInput.click(); });

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (allowedTypes.indexOf(file.type) === -1) { setStatus('不支持的图片格式：仅支持 JPG / PNG / GIF / WebP。', false); return; }
      if (file.size / 1024 / 1024 > limitMb) { setStatus('文件不能超过 ' + limitMb + 'MB。', false); return; }

      var url = URL.createObjectURL(file);
      var probe = new Image();
      probe.onload = function () {
        var w = probe.naturalWidth, h = probe.naturalHeight;
        if (w > limitPx || h > limitPx) {
          setStatus('画面尺寸不能超过 ' + limitPx + '×' + limitPx + '，当前 ' + w + '×' + h + '。', false);
          URL.revokeObjectURL(url);
          return;
        }
        openCropper(file, url, w, h);
      };
      probe.onerror = function () { setStatus('无法读取图片文件。', false); URL.revokeObjectURL(url); };
      probe.src = url;
      fileInput.value = '';
    });

    function openCropper(file, url, imgW, imgH) {
      img.src = url;
      state = { file: file, imgW: imgW, imgH: imgH, crop: null, uploaded: false };
      showModal();
      // 等待图片加载后初始化
      img.onload = function () { initCrop(); };
      // 恢复默认按钮状态
      confirmBtn.hidden = false; cancelBtn.hidden = false; uploadBtn.hidden = true;
      rect.style.display = '';
      wrap.style.display = '';
      $$('.cf-modal-sub', modal).forEach(function (p) { p.hidden = false; });
    }

    /* ---- 裁剪几何 ---- */
    var cropGeom = null; // { imgLeft, imgTop, imgW, imgH, rx, ry, rs }
    var pointers = {};
    var mode = null; // 'move' | 'resize' | 'pinch'
    var pinchStart = null;

    function wrapSize() { return wrap.clientWidth; }
    function initCrop() {
      var stage = wrapSize();
      var scale = Math.min(stage / state.imgW, stage / state.imgH);
      var dw = state.imgW * scale, dh = state.imgH * scale;
      var left = (stage - dw) / 2, top = (stage - dh) / 2;
      var s = Math.min(dw, dh) * 0.72;
      s = Math.max(48, Math.min(s, Math.min(dw, dh)));
      var rx = left + (dw - s) / 2, ry = top + (dh - s) / 2;
      cropGeom = { imgLeft: left, imgTop: top, imgW: dw, imgH: dh, rx: rx, ry: ry, rs: s };
      applyCropGeom();
    }

    function applyCropGeom() {
      var g = cropGeom;
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
      var g = cropGeom;
      g.rx = Math.max(g.imgLeft, Math.min(g.rx, g.imgLeft + g.imgW - g.rs));
      g.ry = Math.max(g.imgTop, Math.min(g.ry, g.imgTop + g.imgH - g.rs));
    }

    wrap.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var target = e.target;
      if (target === img) {
        if (Object.keys(pointers).length === 2) { mode = 'pinch'; return; }
        mode = null; // 点按图片空白：无操作（避免与拖动矩形冲突）
        return;
      }
      if (target === rect || target.closest('.cf-crop-rect')) {
        var r = rect.getBoundingClientRect();
        if (e.clientX > r.right - 24 && e.clientY > r.bottom - 24) mode = 'resize';
        else mode = 'move';
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      }
      wrap.setPointerCapture(e.pointerId);
    });

    wrap.addEventListener('pointermove', function (e) {
      if (!(e.pointerId in pointers)) return;
      var prev = pointers[e.pointerId];
      var dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };

      if (mode === 'pinch') {
        var ids = Object.keys(pointers);
        if (ids.length >= 2) {
          var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
          var dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          if (pinchStart) {
            var ratio = dist / pinchStart.dist;
            var stage = wrapSize();
            var g = cropGeom;
            var cx = g.rx + g.rs / 2, cy = g.ry + g.rs / 2;
            var newW = g.imgW * ratio, newH = g.imgH * ratio;
            var minW = Math.max(g.rs, stage * 0.5);
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
        var g = cropGeom;
        g.rs += Math.max(dx, dy);
        var minS = Math.max(32, wrapSize() * 0.12);
        var maxS = Math.min(g.imgLeft + g.imgW - g.rx, g.imgTop + g.imgH - g.ry);
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
      var g = cropGeom;
      var x = (g.rx - g.imgLeft) / g.imgW;
      var y = (g.ry - g.imgTop) / g.imgH;
      var size = g.rs / g.imgW;
      var sizeY = g.rs / g.imgH;
      return { x: x, y: y, size: size, sizeY: sizeY };
    }

    cancelBtn.addEventListener('click', function () { hideModal(); URL.revokeObjectURL(img.src); state = null; });

    confirmBtn.addEventListener('click', function () {
      if (!state) return;
      state.crop = normalizedCrop();
      // 裁剪完成：进入“上传新头像”步骤
      confirmBtn.hidden = true; cancelBtn.hidden = true;
      uploadBtn.hidden = false;
      $$('.cf-modal-sub', modal).forEach(function (p) { p.hidden = true; });
      rect.style.display = 'none';
    });

    uploadBtn.addEventListener('click', async function () {
      if (!state || !state.crop) return;
      uploadBtn.disabled = true;
      uploadBtn.textContent = '上传中…';
      var fd = new FormData();
      fd.append('avatar', state.file);
      fd.append('width', String(state.imgW));
      fd.append('height', String(state.imgH));
      fd.append('crop', JSON.stringify(state.crop));
      try {
        var res = await fetch(CF.uploadUrl, { method: 'POST', body: fd });
        var data = await res.json();
        if (!data.ok) throw new Error(data.message || '上传失败');
        // 更新预览
        renderAvatarInto(preview, data.avatarUrl, data.crop, 96);
        $('#cf-avatar-hidden').value = data.avatarUrl;
        removeBtn.hidden = false;
        setStatus('新头像已上传。', true);
        hideModal();
        state = null;
      } catch (err) {
        setStatus(err.message || '上传失败，请重试。', false);
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = '上传新头像';
      }
    });

    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        $('#cf-avatar-hidden').value = '';
        $('#cf-avatar-removed').value = '1';
        renderAvatarInto(preview, null, null, 96);
        removeBtn.hidden = true;
        setStatus('头像已标记移除，保存后生效。', true);
      });
    }
  }

  /* ------------------------------------------------------------- 媒体库选择 */
  function initMediaPicker() {
    var pickBtn = $('#cf-avatar-pick');
    if (!pickBtn || !CF.mediaEnabled) return;
    var modal = $('#cf-media-modal');
    var grid = $('#cf-media-grid');
    var cancelBtn = $('#cf-media-cancel');
    var preview = $('#cf-avatar-preview');
    var limitPx = Number(CF.sizeLimitPx) || 1024;
    var limitMb = Number(CF.sizeLimitMb) || 10;

    pickBtn.addEventListener('click', async function () {
      modal.hidden = false;
      grid.innerHTML = '<p class="cf-media-loading">加载中…</p>';
      try {
        var res = await fetch(CF.mediaApi);
        var data = await res.json();
        if (!data.ok || !data.items) throw new Error('媒体库加载失败');
        grid.innerHTML = '';
        data.items.forEach(function (item) {
          if (item.kind !== 'image') return;
          if (item.size / 1024 / 1024 > limitMb) return; // 超过大小上限的不展示
          var el = document.createElement('div');
          el.className = 'cf-media-item';
          var imgEl = document.createElement('img');
          imgEl.src = item.url; imgEl.alt = item.original_name || '';
          el.appendChild(imgEl);
          el.addEventListener('click', function () {
            // 校验画面尺寸
            var probe = new Image();
            probe.onload = function () {
              if (probe.naturalWidth > limitPx || probe.naturalHeight > limitPx) {
                alert('该图片画面尺寸（' + probe.naturalWidth + '×' + probe.naturalHeight + '）超过 ' + limitPx + '×' + limitPx + '，请选择其它图片。');
                return;
              }
              $$('.cf-media-item', grid).forEach(function (x) { x.classList.remove('selected'); });
              el.classList.add('selected');
              $('#cf-avatar-hidden').value = item.url;
              $('#cf-avatar-removed').value = '';
              renderAvatarInto(preview, item.url, null, 96);
              $('#cf-avatar-remove').hidden = false;
              modal.hidden = true;
            };
            probe.onerror = function () { alert('无法读取该图片。'); };
            probe.src = item.url;
          });
          grid.appendChild(el);
        });
        if (!grid.children.length) grid.innerHTML = '<p class="cf-media-loading">媒体库中没有可用的图片。</p>';
      } catch (err) {
        grid.innerHTML = '<p class="cf-media-loading">加载失败：' + esc(err.message) + '</p>';
      }
    });
    cancelBtn.addEventListener('click', function () { modal.hidden = true; });
  }

  /* ------------------------------------------------------------- 保存二次确认 */
  function initSaveFlow() {
    var saveBtn = $('#cf-save-btn');
    if (!saveBtn) return;
    var form = $('#cf-profile-form');
    var confirmPop = $('#cf-confirm-pop');
    var confirmOk = $('#cf-confirm-ok');
    var confirmCancel = $('#cf-confirm-cancel');
    var emailModal = $('#cf-email-modal');
    var emailOk = $('#cf-email-ok');
    var emailCancel = $('#cf-email-cancel');
    var emailOld = $('#cf-email-old');
    var emailNew = $('#cf-email-new');
    var emailInput = $('#cf-email');
    var originalEmail = (emailInput && emailInput.getAttribute('data-original-email')) || '';
    var statusLine = document.createElement('p');
    statusLine.className = 'cf-notice';
    statusLine.style.marginTop = '12px';
    form.parentNode.insertBefore(statusLine, form.nextSibling);

    function showEl(el) { el.hidden = false; }
    function hideEl(el) { el.hidden = true; }
    function confirm(modal, okBtn, cancelBtn) {
      return new Promise(function (resolve) {
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

    saveBtn.addEventListener('click', async function () {
      statusLine.textContent = '';
      var emailChanged = emailInput && emailInput.value.trim() !== originalEmail;
      var proceed = true;

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
        var payload = {
          nickname: $('#cf-nickname').value,
          email: emailInput.value.trim(),
          website: $('#cf-website').value.trim(),
          bio: $('#cf-bio').value,
          contact: $('#cf-contact').value.trim(),
          representative: $('#cf-representative').value.trim(),
          avatar: $('#cf-avatar-hidden').value,
          avatar_removed: $('#cf-avatar-removed').value || ''
        };
        var res = await fetch(CF.saveUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
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
    var loadMore = $('#cf-load-more');
    var timeline = $('#cf-timeline');
    if (!loadMore || !timeline) return;
    var username = timeline.getAttribute('data-username');
    var pageSize = Number(timeline.getAttribute('data-page-size')) || 10;
    var offset = $$('.cf-tl-item', timeline).length;

    function itemHtml(p) {
      var date = String(p.created_at || '').slice(0, 10).replace(/-/g, '/');
      var month = String(p.created_at || '').slice(0, 7);
      return { month: month, html: '<div class="cf-tl-item" data-date="' + date + '"><span class="cf-tl-marker"></span><a class="cf-tl-link" href="' + esc(p.url) + '">' + esc(p.title) + '</a><span class="cf-tl-date">' + date + '</span></div>' };
    }

    loadMore.addEventListener('click', async function () {
      loadMore.disabled = true;
      loadMore.textContent = '加载中…';
      try {
        var res = await fetch('/api/profiles/' + encodeURIComponent(username) + '/posts?offset=' + offset + '&limit=' + pageSize);
        var data = await res.json();
        if (!data.ok || !data.posts || !data.posts.length) { loadMore.hidden = true; return; }
        var tl = $('#cf-tl');
        data.posts.forEach(function (p) {
          var item = itemHtml(p);
          var group = tl.querySelector('.cf-tl-group[data-month="' + item.month + '"]');
          if (!group) {
            group = document.createElement('div');
            group.className = 'cf-tl-group';
            group.setAttribute('data-month', item.month);
            group.innerHTML = '<div class="cf-tl-month"><span class="cf-tl-dot"></span><span class="cf-tl-month-text">' + item.month.replace(/^(\d{4})-(\d{2})$/, function (m, y, mo) { return y + '年' + Number(mo) + '月'; }) + '</span></div><div class="cf-tl-items"></div>';
            tl.appendChild(group);
          }
          var holder = group.querySelector('.cf-tl-items');
          var temp = document.createElement('div');
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
      // 记录当前头像初始字母供移除后兜底
      var preview = $('#cf-avatar-preview');
      if (preview && preview.querySelector('.cf-avatar')) {
        window.__CF_INITIAL__ = preview.querySelector('.cf-avatar').textContent || '?';
      }
      initAvatarEditor();
      initMediaPicker();
      initSaveFlow();
    }
    initTimeline();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();