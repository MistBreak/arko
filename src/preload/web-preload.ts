import { ipcRenderer } from 'electron'

interface WebOverlayConfig {
  selectionToolbarEnabled: boolean
  isDark: boolean
  isSensitive: boolean
  lang?: 'en' | 'zh-CN'
}

const SENSITIVE_ATTR_RE =
  /(password|passwd|passcode|cvv|cvc|cc-number|card[-_]?number|ssn|totp|otp)/i

if (typeof window !== 'undefined' && window === window.top) {
  let config: WebOverlayConfig = {
    selectionToolbarEnabled: true,
    isDark: false,
    isSensitive: false,
    lang: 'en'
  }

  let shadowRoot: ShadowRoot | null = null
  let hostEl: HTMLElement | null = null
  let selectionBarEl: HTMLDivElement | null = null
  let inputBadgeEl: HTMLButtonElement | null = null
  let linkPreviewEl: HTMLDivElement | null = null
  let currentSelectedText = ''
  let activeEditableEl: HTMLElement | null = null
  let selectionTimer: ReturnType<typeof setTimeout> | null = null
  const buttonElsById = new Map<string, HTMLButtonElement>()

  const getLabels = () => {
    const isZh = config.lang === 'zh-CN'
    return {
      explain: '✨ Ask Arko',
      translate: isZh ? '🌐 翻译' : '🌐 Translate',
      summarize: isZh ? '📝 提炼' : '📝 Summarize',
      quote: isZh ? '💬 引用追问' : '💬 Quote',
      copy: isZh ? '复制' : 'Copy',
      copied: isZh ? '✓ 已复制' : '✓ Copied',
      writePill: isZh ? '✨ Arko 帮写 ⌘J' : '✨ Write ⌘J'
    }
  }

  const refreshOverlayLabels = (): void => {
    const labels = getLabels()
    for (const [id, btn] of buttonElsById.entries()) {
      if (id in labels) {
        btn.textContent = labels[id as keyof typeof labels]
      }
    }
    if (inputBadgeEl) {
      inputBadgeEl.textContent = labels.writePill
    }
  }

  const ensureOverlayMounted = (): boolean => {
    if (!document.documentElement) return false
    if (hostEl && shadowRoot && document.documentElement.contains(hostEl)) {
      applyThemeClass()
      refreshOverlayLabels()
      return true
    }

    hostEl = document.createElement('arko-browser-layer')
    hostEl.setAttribute('aria-hidden', 'true')
    hostEl.style.cssText =
      'position:fixed !important;inset:0 !important;width:0 !important;height:0 !important;overflow:visible !important;z-index:2147483646 !important;pointer-events:none !important;border:0 !important;margin:0 !important;padding:0 !important;'

    shadowRoot = hostEl.attachShadow({ mode: 'closed' })

    const styleEl = document.createElement('style')
    styleEl.textContent = `
      :host { all: initial; }
      .arko-root {
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "PingFang SC", sans-serif;
        font-size: 12px;
        line-height: 1.3;
        -webkit-font-smoothing: antialiased;
        user-select: none;
      }
      @keyframes arkoPopIn {
        from { opacity: 0; transform: translateY(4px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .arko-sel-bar {
        position: fixed;
        display: none;
        align-items: center;
        gap: 2px;
        padding: 4px 5px;
        border-radius: 9999px;
        pointer-events: auto;
        backdrop-filter: blur(18px) saturate(180%);
        -webkit-backdrop-filter: blur(18px) saturate(180%);
        background: rgba(255, 255, 255, 0.94);
        color: #18181b;
        border: 1px solid rgba(24, 24, 27, 0.1);
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16), 0 2px 6px rgba(15, 23, 42, 0.08);
        animation: arkoPopIn 130ms cubic-bezier(0.16, 1, 0.3, 1);
        z-index: 2147483646;
      }
      .arko-dark .arko-sel-bar {
        background: rgba(28, 28, 36, 0.94);
        color: #f4f4f5;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.48);
      }
      .arko-sel-btn {
        appearance: none;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 11.5px;
        font-weight: 500;
        padding: 5px 9px;
        border-radius: 9999px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
        transition: background 120ms ease, color 120ms ease;
      }
      .arko-sel-btn:hover {
        background: rgba(79, 70, 229, 0.11);
        color: #4f46e5;
      }
      .arko-dark .arko-sel-btn:hover {
        background: rgba(99, 102, 241, 0.22);
        color: #a5b4fc;
      }
      .arko-sel-btn-primary {
        background: #4f46e5;
        color: #ffffff !important;
        font-weight: 600;
      }
      .arko-sel-btn-primary:hover {
        background: #4338ca !important;
        color: #ffffff !important;
      }
      .arko-sep {
        width: 1px;
        height: 13px;
        background: rgba(120, 120, 135, 0.24);
        margin: 0 1px;
      }
      .arko-input-pill {
        position: fixed;
        display: none;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: 9999px;
        border: 1px solid rgba(79, 70, 229, 0.28);
        background: rgba(255, 255, 255, 0.92);
        color: #4f46e5;
        font: inherit;
        font-size: 10.5px;
        font-weight: 600;
        cursor: pointer;
        pointer-events: auto;
        opacity: 0.82;
        box-shadow: 0 4px 14px rgba(79, 70, 229, 0.15);
        transition: opacity 140ms ease, transform 140ms ease, background 140ms ease;
        z-index: 2147483645;
      }
      .arko-dark .arko-input-pill {
        background: rgba(30, 30, 40, 0.92);
        color: #a5b4fc;
        border-color: rgba(129, 140, 248, 0.35);
      }
      .arko-input-pill:hover {
        opacity: 1;
        transform: translateY(-1px);
        background: #4f46e5;
        color: #ffffff;
      }
      .arko-link-preview {
        position: fixed;
        left: 10px;
        bottom: 10px;
        max-width: min(460px, 72vw);
        padding: 4px 10px;
        border-radius: 9px;
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        pointer-events: none;
        display: none;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        background: rgba(24, 24, 29, 0.84);
        color: #f4f4f5;
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
        z-index: 2147483644;
      }
    `

    const rootWrap = document.createElement('div')
    rootWrap.className = 'arko-root'

    selectionBarEl = document.createElement('div')
    selectionBarEl.className = 'arko-sel-bar'

    const labels = getLabels()
    const actions: Array<{
      id: 'explain' | 'translate' | 'summarize' | 'quote' | 'copy'
      label: string
      primary?: boolean
    }> = [
      { id: 'explain', label: labels.explain, primary: true },
      { id: 'translate', label: labels.translate },
      { id: 'summarize', label: labels.summarize },
      { id: 'quote', label: labels.quote },
      { id: 'copy', label: labels.copy }
    ]

    buttonElsById.clear()
    actions.forEach((act, idx) => {
      if (idx === 1 || idx === 4) {
        const sep = document.createElement('span')
        sep.className = 'arko-sep'
        selectionBarEl!.appendChild(sep)
      }
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `arko-sel-btn${act.primary ? ' arko-sel-btn-primary' : ''}`
      btn.textContent = act.label
      buttonElsById.set(act.id, btn)

      btn.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
      })
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const text = currentSelectedText.trim()
        if (!text) return
        if (act.id === 'copy') {
          void navigator.clipboard?.writeText(text)
          const curLabels = getLabels()
          btn.textContent = curLabels.copied
          setTimeout(() => {
            btn.textContent = getLabels().copy
            hideSelectionBar()
          }, 550)
          return
        }
        ipcRenderer.send('arko-web:selection-action', {
          action: act.id,
          text: text.slice(0, 3500)
        })
        hideSelectionBar()
      })
      selectionBarEl!.appendChild(btn)
    })

    inputBadgeEl = document.createElement('button')
    inputBadgeEl.type = 'button'
    inputBadgeEl.className = 'arko-input-pill'
    inputBadgeEl.textContent = labels.writePill
    inputBadgeEl.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    inputBadgeEl.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      ipcRenderer.send('arko-web:open-inline-write')
      hideInputBadge()
    })

    linkPreviewEl = document.createElement('div')
    linkPreviewEl.className = 'arko-link-preview'

    rootWrap.appendChild(selectionBarEl)
    rootWrap.appendChild(inputBadgeEl)
    rootWrap.appendChild(linkPreviewEl)

    shadowRoot.appendChild(styleEl)
    shadowRoot.appendChild(rootWrap)
    document.documentElement.appendChild(hostEl)
    applyThemeClass()
    return true
  }

  const applyThemeClass = (): void => {
    if (!shadowRoot) return
    const wrap = shadowRoot.querySelector('.arko-root')
    if (!wrap) return
    if (config.isDark) {
      wrap.classList.add('arko-dark')
    } else {
      wrap.classList.remove('arko-dark')
    }
  }

  const hideSelectionBar = (): void => {
    if (selectionBarEl) {
      selectionBarEl.style.display = 'none'
    }
  }

  const hideInputBadge = (): void => {
    if (inputBadgeEl) {
      inputBadgeEl.style.display = 'none'
    }
  }

  const isInsideEditable = (node: Node | null): boolean => {
    let cur: Node | null = node
    while (cur && cur !== document.body) {
      if (cur.nodeType === Node.ELEMENT_NODE) {
        const el = cur as HTMLElement
        const tag = el.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || el.isContentEditable) {
          return true
        }
      }
      cur = cur.parentNode
    }
    return false
  }

  const isEligibleWriteInput = (el: Element | null): el is HTMLElement => {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false
    const htmlEl = el as HTMLInputElement
    if (htmlEl.disabled || htmlEl.readOnly) return false
    const tag = el.tagName.toLowerCase()
    const meta = [
      el.getAttribute('name') || '',
      el.getAttribute('id') || '',
      el.getAttribute('autocomplete') || '',
      el.getAttribute('type') || ''
    ].join(' ')
    if (SENSITIVE_ATTR_RE.test(meta)) return false

    if (tag === 'textarea') return true
    if ((el as HTMLElement).isContentEditable) return true
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase()
      if (!['text', 'email', 'url', ''].includes(t)) return false
      const r = el.getBoundingClientRect()
      return r.width >= 220
    }
    return false
  }

  const updateInputBadgePosition = (): void => {
    if (!config.selectionToolbarEnabled || config.isSensitive || !activeEditableEl) {
      hideInputBadge()
      return
    }
    if (!document.contains(activeEditableEl) || !ensureOverlayMounted() || !inputBadgeEl) {
      hideInputBadge()
      return
    }
    const rect = activeEditableEl.getBoundingClientRect()
    if (rect.width < 140 || rect.height < 26 || rect.bottom < 0 || rect.top > window.innerHeight) {
      hideInputBadge()
      return
    }
    const pillW = config.lang === 'zh-CN' ? 104 : 92
    const pillH = 24
    const left = Math.max(8, Math.min(window.innerWidth - pillW - 8, rect.right - pillW - 6))
    const top = Math.max(8, Math.min(window.innerHeight - pillH - 8, rect.bottom - pillH - 5))
    inputBadgeEl.style.left = `${Math.round(left)}px`
    inputBadgeEl.style.top = `${Math.round(top)}px`
    inputBadgeEl.style.display = 'inline-flex'
  }

  const evaluateSelection = (): void => {
    if (!config.selectionToolbarEnabled || config.isSensitive) {
      hideSelectionBar()
      return
    }
    const sel = window.getSelection ? window.getSelection() : null
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      hideSelectionBar()
      return
    }
    if (isInsideEditable(sel.anchorNode)) {
      hideSelectionBar()
      return
    }
    const text = sel.toString().trim()
    if (text.length < 2 || text.length > 3500) {
      hideSelectionBar()
      return
    }

    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hideSelectionBar()
      return
    }

    if (!ensureOverlayMounted() || !selectionBarEl) return
    currentSelectedText = text

    selectionBarEl.style.display = 'inline-flex'
    const barWidth = selectionBarEl.offsetWidth || 320
    const barHeight = selectionBarEl.offsetHeight || 34

    const centerX = rect.left + rect.width / 2
    const left = Math.max(10, Math.min(window.innerWidth - barWidth - 10, centerX - barWidth / 2))
    const preferAbove = rect.top - barHeight - 10
    const top =
      preferAbove >= 8
        ? preferAbove
        : Math.min(window.innerHeight - barHeight - 10, rect.bottom + 10)

    selectionBarEl.style.left = `${Math.round(left)}px`
    selectionBarEl.style.top = `${Math.round(top)}px`
  }

  window.addEventListener(
    'mouseup',
    () => {
      if (selectionTimer) clearTimeout(selectionTimer)
      selectionTimer = setTimeout(evaluateSelection, 75)
    },
    true
  )

  window.addEventListener(
    'keyup',
    (e) => {
      if (e.shiftKey && e.key.startsWith('Arrow')) {
        if (selectionTimer) clearTimeout(selectionTimer)
        selectionTimer = setTimeout(evaluateSelection, 90)
      }
    },
    true
  )

  window.addEventListener(
    'mousedown',
    (e) => {
      if (hostEl && e.target === hostEl) return
      hideSelectionBar()
    },
    true
  )

  window.addEventListener(
    'scroll',
    () => {
      hideSelectionBar()
      if (activeEditableEl) updateInputBadgePosition()
    },
    true
  )

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        hideSelectionBar()
        hideInputBadge()
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        hideSelectionBar()
      }
    },
    true
  )

  window.addEventListener(
    'focusin',
    (e) => {
      const target = e.target as Element | null
      if (isEligibleWriteInput(target)) {
        activeEditableEl = target
        updateInputBadgePosition()
      } else {
        activeEditableEl = null
        hideInputBadge()
      }
    },
    true
  )

  window.addEventListener(
    'focusout',
    () => {
      setTimeout(() => {
        if (!isEligibleWriteInput(document.activeElement)) {
          activeEditableEl = null
          hideInputBadge()
        }
      }, 120)
    },
    true
  )

  ipcRenderer.on('arko-web:config', (_e, nextConfig: Partial<WebOverlayConfig>) => {
    config = { ...config, ...nextConfig }
    applyThemeClass()
    refreshOverlayLabels()
    if (!config.selectionToolbarEnabled || config.isSensitive) {
      hideSelectionBar()
      hideInputBadge()
    }
  })

  ipcRenderer.on('arko-web:target-url', (_e, rawUrl: string) => {
    if (!rawUrl || rawUrl.startsWith('javascript:')) {
      if (linkPreviewEl) linkPreviewEl.style.display = 'none'
      return
    }
    if (!ensureOverlayMounted() || !linkPreviewEl) return
    let display = rawUrl
    try {
      const u = new URL(rawUrl)
      display = `${u.hostname}${u.pathname === '/' ? '' : u.pathname}${u.search}`.slice(0, 96)
    } catch {
      display = rawUrl.slice(0, 96)
    }
    linkPreviewEl.textContent = display
    linkPreviewEl.style.display = 'block'
  })

  window.addEventListener(
    'dragstart',
    (e) => {
      const target = e.target as Element | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (anchor?.href && /^https?:\/\//i.test(anchor.href)) {
        const title = (anchor.textContent || anchor.getAttribute('title') || '').trim().slice(0, 120)
        ipcRenderer.send('arko-web:link-drag-state', {
          url: anchor.href,
          title: title || anchor.href
        })
      }
    },
    true
  )

  window.addEventListener(
    'dragend',
    () => {
      ipcRenderer.send('arko-web:link-drag-state', null)
    },
    true
  )
}
