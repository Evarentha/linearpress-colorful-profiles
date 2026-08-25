/*
 * Author: MoyuZJ
 * Team: LinearTeam
 * Contact: linearteam@foxmail.com
 * Made by MoyuZJ in China with ♥
 */

/**
 * 极简 Markdown 渲染器（用于个人描述 bio）。
 * 先转义 HTML 再按块处理，避免 XSS；支持标题/粗斜体/行内代码/代码块/链接/列表/段落/换行。
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
    const safe = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) || url.startsWith('/') || url.startsWith('#') ? url : '#';
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
