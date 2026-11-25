import type { WebContents } from 'electron'
import { isInternalArkoUrl, isSensitiveUrl, NEW_TAB_URL } from '@shared/constants'
import type {
  InlineEditableTargetInfo,
  ViewportBounds,
  WebFormFieldInfo
} from '@shared/types'

const ISOLATED_WORLD_ID = 999

export async function inspectEditableAndForms(params: {
  tabId: string
  url: string
  pageTitle: string
  webContents: WebContents | undefined
  viewportBounds: ViewportBounds
  sensitiveGuardEnabled: boolean
  clickPoint?: { x: number; y: number }
  preferredMode?: 'inline' | 'form'
}): Promise<InlineEditableTargetInfo> {
  const {
    tabId,
    url,
    pageTitle,
    webContents,
    viewportBounds,
    sensitiveGuardEnabled,
    clickPoint,
    preferredMode
  } = params

  const defaultAnchor = {
    x: Math.round(viewportBounds.x + viewportBounds.width * 0.5 - 220),
    y: Math.round(viewportBounds.y + 72),
    width: 440,
    height: 36
  }

  if (!url || isInternalArkoUrl(url) || !webContents || webContents.isDestroyed()) {
    return {
      found: false,
      initialMode: preferredMode || 'inline',
      tabId,
      url: url || NEW_TAB_URL,
      pageTitle: pageTitle || 'New Tab',
      isSensitive: false,
      tagName: '',
      fieldLabel: '',
      placeholder: '',
      selectedText: '',
      surroundingValue: '',
      anchorRect: defaultAnchor,
      formFields: []
    }
  }

  if (sensitiveGuardEnabled && isSensitiveUrl(url)) {
    return {
      found: false,
      initialMode: preferredMode || 'inline',
      tabId,
      url,
      pageTitle,
      isSensitive: true,
      tagName: '',
      fieldLabel: '',
      placeholder: '',
      selectedText: '',
      surroundingValue: '',
      anchorRect: defaultAnchor,
      formFields: []
    }
  }

  const pointArg = clickPoint ? JSON.stringify(clickPoint) : 'null'

  const script = `
  (() => {
    try {
      const clickPt = ${pointArg};
      const SENSITIVE_ATTR_RE = /(password|passwd|passcode|cvv|cvc|cc-number|card[-_]?number|ssn|totp|otp)/i;

      const isSafeTextInput = (el) => {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        if (el.disabled || el.readOnly) return false;
        const tag = el.tagName.toLowerCase();
        const nameAndId = [
          el.getAttribute('name') || '',
          el.getAttribute('id') || '',
          el.getAttribute('autocomplete') || ''
        ].join(' ');
        if (SENSITIVE_ATTR_RE.test(nameAndId)) return false;

        if (tag === 'textarea') return true;
        if (tag === 'input') {
          const t = (el.getAttribute('type') || 'text').toLowerCase();
          return ['text', 'search', 'email', 'url', 'tel', 'number', ''].includes(t);
        }
        return false;
      };

      const isEditableRich = (el) => {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        if (el.isContentEditable) return true;
        const role = (el.getAttribute('role') || '').toLowerCase();
        if (role === 'textbox' && el.getAttribute('contenteditable') !== 'false') return true;
        return false;
      };

      const resolveEditableRoot = (startEl) => {
        let cur = startEl;
        while (cur && cur !== document.body && cur !== document.documentElement) {
          if (isSafeTextInput(cur)) return { el: cur, kind: cur.tagName.toLowerCase() };
          if (isEditableRich(cur)) {
            // Walk up to highest contenteditable host container
            let host = cur;
            while (host.parentElement && host.parentElement.isContentEditable) {
              host = host.parentElement;
            }
            return { el: host, kind: 'contenteditable' };
          }
          cur = cur.parentElement;
        }
        return null;
      };

      const getFieldLabel = (el) => {
        if (!el) return '';
        const ariaLabel = (el.getAttribute('aria-label') || '').trim();
        if (ariaLabel) return ariaLabel.slice(0, 80);

        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const refEl = document.getElementById(labelledBy.split(/\\s+/)[0]);
          if (refEl && refEl.textContent) return refEl.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80);
        }

        const id = el.getAttribute('id');
        if (id) {
          try {
            const lbl = document.querySelector('label[for="' + CSS.escape(id) + '"]');
            if (lbl && lbl.textContent) return lbl.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80);
          } catch {}
        }

        const parentLabel = el.closest('label');
        if (parentLabel) {
          const clone = parentLabel.cloneNode(true);
          clone.querySelectorAll('input, textarea, select').forEach(n => n.remove());
          const t = (clone.textContent || '').replace(/\\s+/g, ' ').trim();
          if (t) return t.slice(0, 80);
        }

        const placeholder = (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '').trim();
        if (placeholder) return placeholder.slice(0, 80);

        const name = (el.getAttribute('name') || '').trim();
        return name.slice(0, 60);
      };

      // 1) Resolve active or right-clicked editable target
      let candidate = null;
      if (clickPt && typeof clickPt.x === 'number' && typeof clickPt.y === 'number') {
        const hit = document.elementFromPoint(clickPt.x, clickPt.y);
        candidate = resolveEditableRoot(hit);
      }
      if (!candidate) {
        let active = document.activeElement;
        while (active && active.shadowRoot && active.shadowRoot.activeElement) {
          active = active.shadowRoot.activeElement;
        }
        if (active && active.tagName && active.tagName.toLowerCase() === 'iframe') {
          try {
            if (active.contentDocument && active.contentDocument.activeElement) {
              active = active.contentDocument.activeElement;
            }
          } catch {}
        }
        candidate = resolveEditableRoot(active);
      }

      let found = false;
      let tagName = '';
      let inputType = '';
      let fieldLabel = '';
      let placeholder = '';
      let selectedText = '';
      let surroundingValue = '';
      let localRect = { left: Math.max(24, window.innerWidth / 2 - 200), top: 64, width: 400, height: 36 };

      if (candidate && candidate.el) {
        found = true;
        const el = candidate.el;
        const kind = candidate.kind;
        tagName = kind;
        inputType = (el.getAttribute('type') || '').toLowerCase();
        fieldLabel = getFieldLabel(el);
        placeholder = (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '').trim();

        const elBox = el.getBoundingClientRect();
        localRect = {
          left: Math.max(8, Math.min(window.innerWidth - 60, elBox.left)),
          top: Math.max(8, Math.min(window.innerHeight - 36, elBox.top)),
          width: Math.max(120, Math.min(window.innerWidth - 16, elBox.width)),
          height: Math.max(24, Math.min(220, elBox.height))
        };

        if (kind === 'input' || kind === 'textarea') {
          const val = String(el.value || '');
          const selStart = typeof el.selectionStart === 'number' ? el.selectionStart : val.length;
          const selEnd = typeof el.selectionEnd === 'number' ? el.selectionEnd : val.length;
          selectedText = val.slice(selStart, selEnd).slice(0, 3000);
          surroundingValue = val.slice(0, 4000);
          window.__diaInlineTarget = {
            el,
            kind,
            selStart,
            selEnd,
            savedRange: null
          };
        } else {
          const fullText = String(el.innerText || el.textContent || '');
          surroundingValue = fullText.slice(0, 4000);
          const sel = window.getSelection ? window.getSelection() : null;
          let savedRange = null;
          if (sel && sel.rangeCount > 0) {
            const r = sel.getRangeAt(0);
            if (el.contains(r.commonAncestorContainer)) {
              savedRange = r.cloneRange();
              selectedText = sel.toString().slice(0, 3000);
              const caretBox = r.getBoundingClientRect();
              if (caretBox && (caretBox.width > 0 || caretBox.height > 0)) {
                localRect = {
                  left: Math.max(8, Math.min(window.innerWidth - 60, caretBox.left)),
                  top: Math.max(8, Math.min(window.innerHeight - 36, caretBox.top)),
                  width: Math.max(120, elBox.width),
                  height: Math.max(22, caretBox.height)
                };
              }
            }
          }
          window.__diaInlineTarget = {
            el,
            kind: 'contenteditable',
            selStart: 0,
            selEnd: 0,
            savedRange
          };
        }
      }

      // 2) Scan visible, non-sensitive form fields for Form Preview Fill
      const rawControls = Array.from(document.querySelectorAll('input, textarea, select'));
      const formFieldMap = {};
      const formFields = [];

      for (const ctrl of rawControls) {
        if (formFields.length >= 28) break;
        if (ctrl.disabled || ctrl.readOnly) continue;
        const tag = ctrl.tagName.toLowerCase();
        const type = (ctrl.getAttribute('type') || (tag === 'input' ? 'text' : tag)).toLowerCase();
        if (tag === 'input' && ['password', 'hidden', 'submit', 'reset', 'button', 'file', 'image', 'checkbox', 'radio'].includes(type)) {
          continue;
        }
        const metaStr = [
          ctrl.getAttribute('name') || '',
          ctrl.getAttribute('id') || '',
          ctrl.getAttribute('autocomplete') || ''
        ].join(' ');
        if (SENSITIVE_ATTR_RE.test(metaStr)) continue;

        const rect = ctrl.getBoundingClientRect();
        if (rect.width < 24 || rect.height < 14) continue;
        const style = window.getComputedStyle(ctrl);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

        const fieldId = 'field-' + (formFields.length + 1);
        formFieldMap[fieldId] = ctrl;

        let options = undefined;
        if (tag === 'select') {
          options = Array.from(ctrl.options || []).slice(0, 30).map(opt => ({
            value: String(opt.value || ''),
            label: String(opt.text || opt.label || opt.value || '').trim()
          }));
        }

        formFields.push({
          fieldId,
          tagName: tag,
          inputType: type,
          name: (ctrl.getAttribute('name') || ctrl.getAttribute('id') || '').trim(),
          label: getFieldLabel(ctrl) || ('字段 #' + (formFields.length + 1)),
          placeholder: (ctrl.getAttribute('placeholder') || '').trim(),
          currentValue: String(ctrl.value || '').slice(0, 500),
          options
        });
      }

      window.__diaFormFieldMap = formFieldMap;

      return {
        found,
        pageTitle: document.title || '',
        url: location.href || '',
        tagName,
        inputType,
        fieldLabel,
        placeholder,
        selectedText,
        surroundingValue,
        localRect,
        formFields
      };
    } catch (err) {
      return {
        found: false,
        pageTitle: document.title || '',
        url: location.href || '',
        tagName: '',
        inputType: '',
        fieldLabel: '',
        placeholder: '',
        selectedText: '',
        surroundingValue: '',
        localRect: { left: 100, top: 72, width: 380, height: 32 },
        formFields: []
      };
    }
  })();
  `

  try {
    const res = await webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
      { code: script }
    ])
    const localRect = res?.localRect || { left: 100, top: 72, width: 380, height: 32 }
    const found = Boolean(res?.found)
    const formFields: WebFormFieldInfo[] = Array.isArray(res?.formFields) ? res.formFields : []

    const resolvedInitialMode: 'inline' | 'form' =
      preferredMode === 'form'
        ? 'form'
        : preferredMode === 'inline'
          ? found
            ? 'inline'
            : formFields.length > 0
              ? 'form'
              : 'inline'
          : found
            ? 'inline'
            : formFields.length > 0
              ? 'form'
              : 'inline'

    return {
      found,
      initialMode: resolvedInitialMode,
      tabId,
      url: res?.url || url,
      pageTitle: res?.pageTitle || pageTitle,
      isSensitive: false,
      tagName: res?.tagName || '',
      inputType: res?.inputType || '',
      fieldLabel: res?.fieldLabel || '',
      placeholder: res?.placeholder || '',
      selectedText: res?.selectedText || '',
      surroundingValue: res?.surroundingValue || '',
      anchorRect: {
        x: Math.round(viewportBounds.x + Number(localRect.left || 0)),
        y: Math.round(viewportBounds.y + Number(localRect.top || 0)),
        width: Math.round(Number(localRect.width || 320)),
        height: Math.round(Number(localRect.height || 32))
      },
      formFields
    }
  } catch (err) {
    console.warn('[InlineWrite] inspectEditableAndForms failed:', err)
    return {
      found: false,
      initialMode: preferredMode || 'inline',
      tabId,
      url,
      pageTitle,
      isSensitive: false,
      tagName: '',
      fieldLabel: '',
      placeholder: '',
      selectedText: '',
      surroundingValue: '',
      anchorRect: defaultAnchor,
      formFields: []
    }
  }
}

export async function injectInlineWriteText(params: {
  webContents: WebContents | undefined
  text: string
  mode: 'replace-or-insert' | 'append' | 'replace-all'
}): Promise<boolean> {
  const { webContents, text, mode } = params
  if (!webContents || webContents.isDestroyed() || !text) return false

  const payloadJson = JSON.stringify({ text, mode })

  const script = `
  (() => {
    try {
      const { text, mode } = ${payloadJson};
      const target = window.__diaInlineTarget;
      if (!target || !target.el || !document.contains(target.el)) {
        return false;
      }

      const el = target.el;
      el.focus({ preventScroll: true });

      const flashHighlight = (node) => {
        try {
          const prevTransition = node.style.transition;
          const prevShadow = node.style.boxShadow;
          node.style.transition = 'box-shadow 0.25s ease';
          node.style.boxShadow = '0 0 0 2px rgba(99, 102, 241, 0.65)';
          setTimeout(() => {
            node.style.boxShadow = prevShadow;
            node.style.transition = prevTransition;
          }, 950);
        } catch {}
      };

      if (target.kind === 'input' || target.kind === 'textarea') {
        const curVal = String(el.value || '');
        let start = typeof target.selStart === 'number' ? Math.min(target.selStart, curVal.length) : curVal.length;
        let end = typeof target.selEnd === 'number' ? Math.min(target.selEnd, curVal.length) : curVal.length;

        if (mode === 'replace-all') {
          start = 0;
          end = curVal.length;
        } else if (mode === 'append') {
          start = end;
        }

        const insertStr =
          mode === 'append' && start > 0 && !/\\s$/.test(curVal.slice(0, start)) && !/^\\s/.test(text)
            ? '\\n' + text
            : text;

        try {
          el.setSelectionRange(start, end);
        } catch {}

        const expectedVal = curVal.slice(0, start) + insertStr + curVal.slice(end);
        let appliedViaExec = false;
        try {
          appliedViaExec = document.execCommand('insertText', false, insertStr);
        } catch {
          appliedViaExec = false;
        }

        if (!appliedViaExec || el.value !== expectedVal) {
          const proto = target.kind === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && desc.set) {
            desc.set.call(el, expectedVal);
          } else {
            el.value = expectedVal;
          }
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: insertStr, inputType: 'insertText' }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const nextCaret = start + insertStr.length;
        try {
          el.setSelectionRange(nextCaret, nextCaret);
        } catch {}
        target.selStart = nextCaret;
        target.selEnd = nextCaret;
        flashHighlight(el);
        return true;
      }

      // Contenteditable / Rich text editor
      const sel = window.getSelection ? window.getSelection() : null;
      if (sel) {
        sel.removeAllRanges();
        if (mode === 'replace-all') {
          const allRange = document.createRange();
          allRange.selectNodeContents(el);
          sel.addRange(allRange);
        } else if (target.savedRange) {
          const r = target.savedRange.cloneRange();
          if (mode === 'append') {
            r.collapse(false);
          }
          sel.addRange(r);
        } else {
          const endRange = document.createRange();
          endRange.selectNodeContents(el);
          endRange.collapse(false);
          sel.addRange(endRange);
        }
      }

      const richText = mode === 'append' ? '\\n' + text : text;
      let ok = false;
      try {
        ok = document.execCommand('insertText', false, richText);
      } catch {
        ok = false;
      }

      if (!ok && sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(richText);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: richText, inputType: 'insertText' }));
        ok = true;
      }

      if (sel && sel.rangeCount > 0) {
        target.savedRange = sel.getRangeAt(0).cloneRange();
      }
      flashHighlight(el);
      return ok;
    } catch (e) {
      return false;
    }
  })();
  `

  try {
    webContents.focus()
    const ok = await webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
      { code: script }
    ])
    return Boolean(ok)
  } catch (err) {
    console.warn('[InlineWrite] injectInlineWriteText failed:', err)
    return false
  }
}

export async function applyWebFormFills(params: {
  webContents: WebContents | undefined
  fills: Array<{ fieldId: string; value: string }>
}): Promise<number> {
  const { webContents, fills } = params
  if (!webContents || webContents.isDestroyed() || fills.length === 0) return 0

  const fillsJson = JSON.stringify(fills)
  const script = `
  (() => {
    try {
      const fills = ${fillsJson};
      const map = window.__diaFormFieldMap || {};
      let count = 0;
      let firstEl = null;

      for (const item of fills) {
        const el = map[item.fieldId];
        if (!el || !document.contains(el) || el.disabled || el.readOnly) continue;
        const tag = el.tagName.toLowerCase();
        const val = String(item.value ?? '');

        if (tag === 'select') {
          const opts = Array.from(el.options || []);
          const exact = opts.find(o => o.value === val || o.text.trim() === val.trim());
          const fuzzy = exact || opts.find(o => o.text.toLowerCase().includes(val.toLowerCase()) || val.toLowerCase().includes(o.text.toLowerCase()));
          if (fuzzy) {
            el.value = fuzzy.value;
          } else {
            el.value = val;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && desc.set) {
            desc.set.call(el, val);
          } else {
            el.value = val;
          }
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: val, inputType: 'insertReplacementText' }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        try {
          const prevShadow = el.style.boxShadow;
          el.style.boxShadow = '0 0 0 2px rgba(16, 185, 129, 0.6)';
          setTimeout(() => { el.style.boxShadow = prevShadow; }, 1400);
        } catch {}

        if (!firstEl) firstEl = el;
        count++;
      }

      if (firstEl) {
        try { firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
      }
      return count;
    } catch {
      return 0;
    }
  })();
  `

  try {
    const applied = await webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
      { code: script }
    ])
    return Number(applied) || 0
  } catch (err) {
    console.warn('[InlineWrite] applyWebFormFills failed:', err)
    return 0
  }
}
