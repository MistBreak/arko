import type { WebContents } from 'electron'
import { isSensitiveUrl, NEW_TAB_URL } from '@shared/constants'
import type { PageExtractedContext, SplitPaneSide } from '@shared/types'

const ISOLATED_WORLD_ID = 999

const DOM_EXTRACT_SCRIPT = `
(() => {
  try {
    const title = document.title || '';
    const url = location.href || '';
    const metaDesc = document.querySelector('meta[name="description"], meta[property="og:description"]');
    const description = metaDesc ? (metaDesc.getAttribute('content') || '').trim() : '';
    const selectedText = (window.getSelection ? window.getSelection().toString() : '').trim().slice(0, 4000);

    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(el => (el.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 25);

    const rootCandidate =
      document.querySelector('article') ||
      document.querySelector('main') ||
      document.querySelector('[role="main"]') ||
      document.querySelector('.markdown-body') ||
      document.body;

    if (!rootCandidate) {
      return { title, url, description, selectedText, headings, content: '' };
    }

    const clone = rootCandidate.cloneNode(true);
    const junkSelectors = [
      'script', 'style', 'noscript', 'svg', 'canvas', 'iframe',
      'nav', 'footer', '[aria-hidden="true"]', '.cookie-banner', '.ad', '.ads'
    ];
    for (const sel of junkSelectors) {
      clone.querySelectorAll(sel).forEach(n => n.remove());
    }

    // Preserve basic Markdown structure for headings, code blocks, lists & tables
    clone.querySelectorAll('h1, h2, h3, h4').forEach(h => {
      const level = Number(h.tagName.slice(1)) || 2;
      h.textContent = '\\n' + '#'.repeat(level) + ' ' + (h.textContent || '').trim() + '\\n';
    });
    clone.querySelectorAll('li').forEach(li => {
      li.textContent = '\\n- ' + (li.textContent || '').trim();
    });
    clone.querySelectorAll('pre').forEach(pre => {
      pre.textContent = '\\n\`\`\`\\n' + (pre.textContent || '').trim() + '\\n\`\`\`\\n';
    });
    clone.querySelectorAll('tr').forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('th, td')).map(c => (c.textContent || '').replace(/\\s+/g, ' ').trim());
      if (cells.length > 0) {
        tr.textContent = '\\n| ' + cells.join(' | ') + ' |';
      }
    });

    const rawText = (clone.innerText || clone.textContent || '')
      .replace(/\\r/g, '')
      .replace(/[ \\t]+\\n/g, '\\n')
      .replace(/\\n{3,}/g, '\\n\\n')
      .trim();

    const content = rawText.slice(0, 16000);
    return { title, url, description, selectedText, headings, content };
  } catch (err) {
    return {
      title: document.title || '',
      url: location.href || '',
      description: '',
      selectedText: '',
      headings: [],
      content: (document.body ? document.body.innerText : '').slice(0, 12000)
    };
  }
})();
`

const FULL_MARKDOWN_EXPORT_SCRIPT = `
(() => {
  try {
    const pageTitle = (document.title || 'Untitled Page').trim();
    const pageUrl = location.href || '';
    const metaDesc = document.querySelector('meta[name="description"], meta[property="og:description"]');
    const description = metaDesc ? (metaDesc.getAttribute('content') || '').trim() : '';

    const root =
      document.querySelector('article') ||
      document.querySelector('main') ||
      document.querySelector('[role="main"]') ||
      document.querySelector('.markdown-body') ||
      document.querySelector('.post-content') ||
      document.body;

    if (!root) {
      return { title: pageTitle, url: pageUrl, description, bodyMarkdown: '' };
    }

    const clone = root.cloneNode(true);
    const junk = [
      'script', 'style', 'noscript', 'svg', 'canvas', 'iframe', 'button',
      'nav', 'footer', 'aside', '[aria-hidden="true"]', '[role="navigation"]',
      '.cookie-banner', '.ad', '.ads', '.sidebar'
    ];
    for (const sel of junk) {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    }

    const absUrl = (raw) => {
      if (!raw) return '';
      try {
        return new URL(raw, pageUrl).href;
      } catch {
        return raw;
      }
    };

    const serializeInline = (node) => {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.nodeValue || '').replace(/\\s+/g, ' ');
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName.toLowerCase();
      if (tag === 'br') return '\\n';
      if (tag === 'code' && (!node.parentElement || node.parentElement.tagName.toLowerCase() !== 'pre')) {
        const t = (node.textContent || '').trim();
        return t ? '\`' + t.replace(/\`/g, "'") + '\`' : '';
      }
      if (tag === 'strong' || tag === 'b') {
        const inner = Array.from(node.childNodes).map(serializeInline).join('').trim();
        return inner ? '**' + inner + '**' : '';
      }
      if (tag === 'em' || tag === 'i') {
        const inner = Array.from(node.childNodes).map(serializeInline).join('').trim();
        return inner ? '*' + inner + '*' : '';
      }
      if (tag === 'del' || tag === 's') {
        const inner = Array.from(node.childNodes).map(serializeInline).join('').trim();
        return inner ? '~~' + inner + '~~' : '';
      }
      if (tag === 'a') {
        const text = Array.from(node.childNodes).map(serializeInline).join('').trim();
        const href = absUrl(node.getAttribute('href') || '');
        if (!text) return '';
        if (!href || href.startsWith('javascript:')) return text;
        return '[' + text + '](' + href + ')';
      }
      if (tag === 'img') {
        const src = absUrl(node.getAttribute('src') || node.getAttribute('data-src') || '');
        const alt = (node.getAttribute('alt') || '').replace(/\\s+/g, ' ').trim();
        if (!src || src.startsWith('data:image/svg')) return '';
        return '![' + alt + '](' + src + ')';
      }
      return Array.from(node.childNodes).map(serializeInline).join('');
    };

    const serializeTable = (tableEl) => {
      const rows = Array.from(tableEl.querySelectorAll('tr'));
      if (rows.length === 0) return '';
      const matrix = rows
        .map(r => Array.from(r.querySelectorAll('th, td')).map(c => (c.textContent || '').replace(/\\s+/g, ' ').replace(/\\|/g, '\\\\|').trim()))
        .filter(r => r.length > 0 && r.some(Boolean));
      if (matrix.length === 0) return '';
      const colCount = Math.max(...matrix.map(r => r.length));
      const padRow = (r) => {
        const copy = [...r];
        while (copy.length < colCount) copy.push('');
        return '| ' + copy.join(' | ') + ' |';
      };
      const header = padRow(matrix[0]);
      const sep = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
      const body = matrix.slice(1).map(padRow);
      return '\\n\\n' + [header, sep, ...body].join('\\n') + '\\n\\n';
    };

    const serializeBlock = (node, listDepth = 0) => {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.nodeValue || '').replace(/\\s+/g, ' ');
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const tag = node.tagName.toLowerCase();

      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1)) || 2;
        const text = Array.from(node.childNodes).map(serializeInline).join('').replace(/\\s+/g, ' ').trim();
        return text ? '\\n\\n' + '#'.repeat(level) + ' ' + text + '\\n\\n' : '';
      }
      if (tag === 'hr') {
        return '\\n\\n---\\n\\n';
      }
      if (tag === 'pre') {
        const codeEl = node.querySelector('code');
        const cls = (codeEl ? codeEl.className : node.className) || '';
        const langMatch = cls.match(/language-([a-z0-9_+-]+)/i);
        const lang = langMatch ? langMatch[1] : '';
        const rawCode = (codeEl ? codeEl.textContent : node.textContent) || '';
        return '\\n\\n\`\`\`' + lang + '\\n' + rawCode.replace(/^\\n+|\\n+$/g, '') + '\\n\`\`\`\\n\\n';
      }
      if (tag === 'blockquote') {
        const inner = Array.from(node.childNodes).map(c => serializeBlock(c, listDepth)).join('').trim();
        if (!inner) return '';
        const quoted = inner.split('\\n').map(l => '> ' + l).join('\\n');
        return '\\n\\n' + quoted + '\\n\\n';
      }
      if (tag === 'table') {
        return serializeTable(node);
      }
      if (tag === 'ul' || tag === 'ol') {
        const isOrdered = tag === 'ol';
        const items = Array.from(node.children).filter(c => c.tagName && c.tagName.toLowerCase() === 'li');
        const lines = items.map((li, i) => {
          const indent = '  '.repeat(listDepth);
          const bullet = isOrdered ? (i + 1) + '. ' : '- ';
          const parts = [];
          for (const child of Array.from(li.childNodes)) {
            const cTag = child.nodeType === Node.ELEMENT_NODE ? child.tagName.toLowerCase() : '';
            if (cTag === 'ul' || cTag === 'ol') {
              parts.push('\\n' + serializeBlock(child, listDepth + 1).trimEnd());
            } else {
              parts.push(serializeInline(child));
            }
          }
          const lineBody = parts.join('').replace(/[ \\t]+/g, ' ').trim();
          return lineBody ? indent + bullet + lineBody : '';
        }).filter(Boolean);
        return lines.length ? (listDepth === 0 ? '\\n\\n' : '\\n') + lines.join('\\n') + (listDepth === 0 ? '\\n\\n' : '') : '';
      }
      if (tag === 'p') {
        const text = Array.from(node.childNodes).map(serializeInline).join('').replace(/[ \\t]+/g, ' ').trim();
        return text ? '\\n\\n' + text + '\\n\\n' : '';
      }
      if (tag === 'img') {
        const imgMd = serializeInline(node);
        return imgMd ? '\\n\\n' + imgMd + '\\n\\n' : '';
      }

      return Array.from(node.childNodes).map(c => serializeBlock(c, listDepth)).join('');
    };

    const bodyMarkdown = serializeBlock(clone, 0)
      .replace(/\\r/g, '')
      .replace(/[ \\t]+\\n/g, '\\n')
      .replace(/\\n{3,}/g, '\\n\\n')
      .trim()
      .slice(0, 400000);

    return {
      title: pageTitle,
      url: pageUrl,
      description,
      bodyMarkdown
    };
  } catch (e) {
    return {
      title: document.title || 'Untitled',
      url: location.href || '',
      description: '',
      bodyMarkdown: (document.body ? document.body.innerText : '').slice(0, 200000)
    };
  }
})();
`

export async function extractTabContent(
  tabId: string,
  url: string,
  title: string,
  webContents: WebContents | undefined,
  sensitiveGuardEnabled: boolean,
  splitPaneRole?: SplitPaneSide
): Promise<PageExtractedContext> {
  const now = Date.now()

  if (!url || url.startsWith('arko://') || url.startsWith('dia://') || !webContents || webContents.isDestroyed()) {
    return {
      tabId,
      url: url || NEW_TAB_URL,
      title: title || 'New Tab',
      description: '',
      selectedText: '',
      content: '',
      headings: [],
      isSensitive: false,
      wordCount: 0,
      extractedAt: now,
      splitPaneRole
    }
  }

  if (sensitiveGuardEnabled && isSensitiveUrl(url)) {
    return {
      tabId,
      url,
      title,
      description: '',
      selectedText: '',
      content:
        '[Sensitive Site Protection Active: Arko privacy guard has blocked AI DOM extraction on this financial or password-management domain]',
      headings: [],
      isSensitive: true,
      wordCount: 0,
      extractedAt: now,
      splitPaneRole
    }
  }

  try {
    const res = await webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
      { code: DOM_EXTRACT_SCRIPT }
    ])
    const content: string = res?.content || ''
    return {
      tabId,
      url: res?.url || url,
      title: res?.title || title,
      description: res?.description || '',
      selectedText: res?.selectedText || '',
      content,
      headings: Array.isArray(res?.headings) ? res.headings : [],
      isSensitive: false,
      wordCount: content.length,
      extractedAt: now,
      splitPaneRole
    }
  } catch (err) {
    console.warn(`[DOMExtractor] Failed to extract tab ${tabId}:`, err)
    return {
      tabId,
      url,
      title,
      description: '',
      selectedText: '',
      content: '',
      headings: [],
      isSensitive: false,
      wordCount: 0,
      extractedAt: now,
      splitPaneRole
    }
  }
}

export async function extractCleanPageMarkdown(params: {
  url: string
  title: string
  webContents: WebContents | undefined
  sensitiveGuardEnabled: boolean
}): Promise<{
  ok: boolean
  title: string
  description?: string
  bodyMarkdown?: string
  markdown: string
  error?: string
}> {
  const { url, title, webContents, sensitiveGuardEnabled } = params

  if (!url || url.startsWith('arko://') || url.startsWith('dia://') || !webContents || webContents.isDestroyed()) {
    return { ok: false, title, markdown: '', error: 'Cannot export content from an internal browser view.' }
  }

  if (sensitiveGuardEnabled && isSensitiveUrl(url)) {
    return {
      ok: false,
      title,
      markdown: '',
      error: 'Sensitive Site Protection Active: DOM export is blocked on financial or password-manager domains.'
    }
  }

  try {
    const res = await webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
      { code: FULL_MARKDOWN_EXPORT_SCRIPT }
    ])
    const finalTitle = (res?.title || title || 'Untitled').trim()
    const finalUrl = res?.url || url
    const desc = (res?.description || '').trim()
    const body = (res?.bodyMarkdown || '').trim()

    const exportedAt = new Date().toISOString()
    const headerLines = [
      '---',
      `title: "${finalTitle.replace(/"/g, '\\"')}"`,
      `source: "${finalUrl}"`,
      `exported_at: "${exportedAt}"`,
      '---',
      '',
      `# ${finalTitle}`,
      '',
      `> 原文链接：[${finalUrl}](${finalUrl})`
    ]
    if (desc) {
      headerLines.push(`> 摘要：${desc}`)
    }
    headerLines.push('', body || '*（未提取到正文内容）*', '')

    return {
      ok: true,
      title: finalTitle,
      description: desc,
      bodyMarkdown: body,
      markdown: headerLines.join('\n')
    }
  } catch (err: any) {
    return {
      ok: false,
      title,
      markdown: '',
      error: err?.message || '提取页面 Markdown 失败'
    }
  }
}
