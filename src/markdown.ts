/*
 * Minimal Markdown Renderer
 *
 * Escapes-first minimal Markdown renderer for profile bios.
 *
 * Authors:
 * MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
 *
 * Copyright (C) 2026 Evarentha
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Minimal Markdown renderer (used for profile bios).
 *
 * <p>HTML is escaped first and the input is then processed block by block to avoid XSS; supports
 * headings, bold/italic, inline code, fenced code blocks, links, lists, paragraphs and line
 * breaks.</p>
 *
 * @since 1.0.0
 */

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function inline(text: string): string {
  let out = escapeHtml(text);
  // 行内代码（先于其它转义已做）
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);
  // 链接 [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const safe = /^https?:\/\//i.test(url) || /^mailto:[^\s@]+@[^\s@]+$/i.test(url) || url.startsWith('/') || url.startsWith('#') ? url : '#';
    return `<a href="${safe}" target="_blank" rel="noopener">${label}</a>`;
  });
  // 粗体
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 斜体
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return out;
}

export function renderMarkdown(source: string): string {
  const text = String(source ?? '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let list: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };
  const openList = (kind: 'ul' | 'ol') => {
    if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 围栏代码块
    if (/^```/.test(line)) {
      if (!inCode) { closeList(); inCode = true; codeBuf = []; out.push('<pre><code>'); }
      else { inCode = false; out.push(escapeHtml(codeBuf.join('\n')), '</code></pre>'); }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const trimmed = line.trim();
    if (!trimmed) { closeList(); continue; }

    // 标题
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); const lv = h[1].length; out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); continue; }

    // 有序列表
    const ol = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ol) { openList('ol'); out.push(`<li>${inline(ol[1])}</li>`); continue; }

    // 无序列表
    const ul = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ul) { openList('ul'); out.push(`<li>${inline(ul[1])}</li>`); continue; }

    closeList();
    out.push(`<p>${inline(trimmed)}</p>`);
  }
  if (inCode) out.push(escapeHtml(codeBuf.join('\n')), '</code></pre>');
  closeList();
  return out.join('\n');
}
