import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  AtSign,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Clock,
  Columns2,
  Compass,
  CornerDownLeft,
  FileText,
  History,
  Layers,
  Mic,
  MicOff,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  Wand2,
  X
} from 'lucide-react'
import {
  classifyInputIntent,
  getAllSlashSkills,
  isInternalArkoUrl,
  NEW_TAB_URL
} from '@shared/constants'
import { tr } from '@shared/i18n'
import type {
  AppLanguage,
  BookmarkItem,
  ChatMention,
  ConnectedToolItem,
  HistoryItem,
  InputIntentType,
  SlashSkill,
  TabState
} from '@shared/types'
import { FaviconIcon } from './FaviconIcon'
import { ToolBrandIcon } from './ConnectToolsModal'

export type OmniboxMode = 'new-tab' | 'current-tab'

interface AttachedTextFile {
  name: string
  content: string
}

interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionInstance {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

interface Props {
  mode?: OmniboxMode
  focusTrigger?: number
  isDark: boolean
  lang?: AppLanguage
  activeTabId?: string | null
  initialUrl?: string
  memoryCount?: number
  connectedTools?: ConnectedToolItem[]
  tabs: TabState[]
  bookmarks: BookmarkItem[]
  history: HistoryItem[]
  customSkills?: SlashSkill[]
  onNavigate: (input: string) => void
  onOpenInNewTab?: (input: string) => void
  onSwitchTab: (tabId: string) => void
  onOpenTabInSplit: (tabId: string) => void
  onAskAI: (prompt: string, openInNewTab?: boolean, mentions?: ChatMention[]) => void
  onOrganizeTabs: () => void
  onShowToast?: (msg: string) => void
  isClosing?: boolean
  onClose: () => void
}

type SubView = 'root' | 'history' | 'bookmarks'

interface SuggestionItem {
  id: string
  kind:
    | 'action-url'
    | 'action-search'
    | 'action-ai'
    | 'skill'
    | 'tab'
    | 'split-tab'
    | 'show-all-tabs'
    | 'nav-history'
    | 'nav-bookmarks'
    | 'bookmark'
    | 'history'
  title: string
  subtitle?: string
  url?: string
  favicon?: string
  tabId?: string
  skillCommand?: string
}

interface AnchorPosition {
  top: number
  left: number
  width: number
}

function stripDisplayProtocol(rawUrl?: string): string {
  if (!rawUrl || isInternalArkoUrl(rawUrl)) return ''
  return rawUrl.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, (slash, offset, str) => {
    // Strip trailing slash only when URL is bare domain without path/query/hash
    return str.slice(0, offset).includes('/') ? slash : ''
  })
}

function computeSmartBarPosition(): AnchorPosition {
  const vw = window.innerWidth
  const anchorEl = document.querySelector<HTMLElement>('[data-arko-urlbar-anchor="true"]')
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect()
    if (rect.width > 40) {
      const mainEl = anchorEl.closest('main') || anchorEl.closest('header')
      const containerRect = mainEl
        ? mainEl.getBoundingClientRect()
        : { left: 0, right: vw, width: vw }

      // Match Dia's top-bar expansion: cover the resting URL bar cleanly while keeping left nav (< >) & right Chat button visible
      const maxAvailableInBar = Math.max(420, containerRect.width - 208)
      const desiredWidth = Math.min(
        740,
        Math.max(rect.width + 96, 560),
        maxAvailableInBar,
        vw - 24
      )
      const centerX = rect.left + rect.width / 2
      const minLeft = Math.max(12, containerRect.left + 86)
      const maxLeft = Math.min(vw - desiredWidth - 12, Math.max(minLeft, containerRect.right - desiredWidth - 96))
      const clampedLeft = Math.max(
        12,
        Math.min(vw - desiredWidth - 12, Math.max(minLeft, Math.min(maxLeft, centerX - desiredWidth / 2)))
      )
      const top = Math.max(5, Math.round(rect.top - 3))
      return {
        top,
        left: Math.round(clampedLeft),
        width: Math.round(desiredWidth)
      }
    }
  }

  const fallbackWidth = Math.min(680, vw - 32)
  return {
    top: 6,
    left: Math.round((vw - fallbackWidth) / 2),
    width: Math.round(fallbackWidth)
  }
}

export const CommandOmniboxModal: React.FC<Props> = ({
  mode = 'current-tab',
  focusTrigger = 0,
  isDark,
  lang,
  activeTabId,
  initialUrl,
  memoryCount = 0,
  connectedTools = [],
  tabs,
  bookmarks,
  history,
  customSkills,
  onNavigate,
  onOpenInNewTab,
  onSwitchTab,
  onOpenTabInSplit,
  onAskAI,
  onOrganizeTabs,
  onShowToast,
  isClosing = false,
  onClose
}) => {
  const isNewTabMode = mode === 'new-tab'
  const rawInitialUrl =
    !isNewTabMode && initialUrl && !isInternalArkoUrl(initialUrl) ? initialUrl : ''
  const startValue = useMemo(() => stripDisplayProtocol(rawInitialUrl), [rawInitialUrl])

  const [query, setQuery] = useState(startValue)
  const [hasEdited, setHasEdited] = useState(false)
  const [subView, setSubView] = useState<SubView>('root')
  const [showAllTabs, setShowAllTabs] = useState(false)
  const [intentOverride, setIntentOverride] = useState<'ai' | 'web' | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)

  // Dia "+ Add tabs or files" & @mention state
  const [mentions, setMentions] = useState<ChatMention[]>([])
  const [attachedFiles, setAttachedFiles] = useState<AttachedTextFile[]>([])
  const [contextPickerOpen, setContextPickerOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIdx, setMentionIdx] = useState(0)

  // Voice dictation state
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  const [anchorPos, setAnchorPos] = useState<AnchorPosition>(() => computeSmartBarPosition())

  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const syncAnchor = useCallback(() => {
    setAnchorPos(computeSmartBarPosition())
  }, [])

  useLayoutEffect(() => {
    syncAnchor()
    window.addEventListener('resize', syncAnchor)
    return () => window.removeEventListener('resize', syncAnchor)
  }, [syncAnchor, mode, focusTrigger])

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop()
      } catch {
        // ignore
      }
    }
  }, [])

  const allSkills = useMemo(() => getAllSlashSkills(customSkills, lang), [customSkills, lang])

  // Reliable focus & full URL selection on open (matching Dia screenshot)
  useEffect(() => {
    const focusInput = (selectAll = false): void => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      if (selectAll && el.value) {
        el.select()
      }
    }
    const shouldSelect = subView === 'root' && Boolean(startValue) && !hasEdited
    focusInput(shouldSelect)
    const raf = window.requestAnimationFrame(() => focusInput(shouldSelect))
    const timer = window.setTimeout(() => {
      if (document.activeElement !== inputRef.current) {
        focusInput(shouldSelect)
      }
    }, 45)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [subView, mode, startValue, focusTrigger, hasEdited])

  const openTabsList = useMemo(() => {
    const realTabs = tabs.filter((t) => t.url !== NEW_TAB_URL)
    return [...realTabs].sort((a, b) => {
      if (isNewTabMode) {
        const aIsCurrent = a.id === activeTabId ? 1 : 0
        const bIsCurrent = b.id === activeTabId ? 1 : 0
        if (aIsCurrent !== bIsCurrent) return aIsCurrent - bIsCurrent
      }
      return (b.lastAccessedAt || 0) - (a.lastAccessedAt || 0)
    })
  }, [tabs, isNewTabMode, activeTabId])

  const realWebTabs = useMemo(
    () => tabs.filter((t) => !isInternalArkoUrl(t.url)),
    [tabs]
  )

  const activeConnectedTools = useMemo(
    () => connectedTools.filter((t) => t.status !== 'disconnected'),
    [connectedTools]
  )

  const mentionCandidates = useMemo<ChatMention[]>(() => {
    const q = (mentionQuery ?? '').toLowerCase().trim()
    const items: ChatMention[] = [
      ...realWebTabs.map((t) => ({
        type: 'tab' as const,
        tabId: t.id,
        title: t.title || t.url,
        url: t.url,
        favicon: t.favicon
      })),
      {
        type: 'all-tabs',
        title: tr(
          lang,
          `All Open Tabs (${realWebTabs.length})`,
          `全部打开标签页 (${realWebTabs.length})`
        )
      },
      ...activeConnectedTools.map((t) => ({
        type: 'tool' as const,
        toolId: t.id,
        title: t.name,
        url: t.homeUrl
      })),
      {
        type: 'history',
        title: tr(lang, 'Browsing History', '浏览历史记录')
      },
      {
        type: 'memory',
        title: tr(lang, `Personal Memory (${memoryCount})`, `个人记忆库 (${memoryCount})`)
      }
    ]
    if (!q) return items
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.toolId && i.toolId.toLowerCase().includes(q)) ||
        (i.url && i.url.toLowerCase().includes(q))
    )
  }, [mentionQuery, realWebTabs, activeConnectedTools, memoryCount, lang])

  const hasAttachments = mentions.length > 0 || attachedFiles.length > 0
  const trimmedQuery = query.trim()

  // If unchanged prefilled URL and user attaches tabs/files, clear URL or treat query appropriately
  const isUnchangedInitialUrl = Boolean(!isNewTabMode && startValue && !hasEdited && query === startValue)

  const autoIntent: InputIntentType = useMemo(() => {
    if (hasAttachments) return 'ai'
    if (isUnchangedInitialUrl) return 'url'
    return classifyInputIntent(trimmedQuery)
  }, [hasAttachments, isUnchangedInitialUrl, trimmedQuery])

  const effectiveIntent: InputIntentType = useMemo(() => {
    if (hasAttachments) return 'ai'
    if (!trimmedQuery) return 'search'
    if (intentOverride === 'ai') return 'ai'
    if (intentOverride === 'web') return autoIntent === 'url' ? 'url' : 'search'
    return autoIntent
  }, [hasAttachments, trimmedQuery, intentOverride, autoIntent])

  const toggleIntentMode = (): void => {
    if (!trimmedQuery && !hasAttachments) return
    setIntentOverride(effectiveIntent === 'ai' ? 'web' : 'ai')
  }

  const showMentionMenu =
    (contextPickerOpen || mentionQuery !== null) && mentionCandidates.length > 0

  // Dia's signature calm behavior: when clicking the URL bar on an existing page,
  // show ONLY the sleek 2-row URL + Action box until the user edits, clears, or opens context!
  const shouldShowSuggestions = useMemo(() => {
    if (showMentionMenu) return false
    if (hasAttachments && isUnchangedInitialUrl) return false
    if (isUnchangedInitialUrl && subView === 'root') return false
    return true
  }, [showMentionMenu, hasAttachments, isUnchangedInitialUrl, subView])

  const suggestions = useMemo<SuggestionItem[]>(() => {
    if (!shouldShowSuggestions) return []

    const q = trimmedQuery
    const lower = q.toLowerCase()

    if (subView === 'history') {
      return history
        .filter(
          (h) =>
            !lower ||
            h.title.toLowerCase().includes(lower) ||
            h.url.toLowerCase().includes(lower)
        )
        .slice(0, 20)
        .map((h) => ({
          id: `hist-${h.id}`,
          kind: 'history' as const,
          title: h.title || h.url,
          subtitle: stripDisplayProtocol(h.url),
          url: h.url,
          favicon: h.favicon
        }))
    }

    if (subView === 'bookmarks') {
      return bookmarks
        .filter(
          (b) =>
            !lower ||
            b.title.toLowerCase().includes(lower) ||
            b.url.toLowerCase().includes(lower)
        )
        .slice(0, 20)
        .map((b) => ({
          id: `bm-${b.id}`,
          kind: 'bookmark' as const,
          title: b.title || b.url,
          subtitle: stripDisplayProtocol(b.url),
          url: b.url,
          favicon: b.favicon
        }))
    }

    if (!q) {
      if (hasAttachments) return []
      const list: SuggestionItem[] = []
      const visibleTabs = showAllTabs ? openTabsList : openTabsList.slice(0, 5)

      for (const t of visibleTabs) {
        list.push({
          id: `tab-${t.id}`,
          kind: 'tab',
          title: t.title || t.url,
          subtitle: tr(lang, 'Switch to Tab', '切换到标签页'),
          url: t.url,
          favicon: t.favicon,
          tabId: t.id
        })
      }

      if (!showAllTabs && openTabsList.length > 5) {
        list.push({
          id: 'show-all-tabs',
          kind: 'show-all-tabs',
          title: tr(lang, 'Show All Open Tabs', '显示全部已打开标签页')
        })
      }

      if (openTabsList.length === 0) {
        for (const bm of bookmarks.slice(0, 4)) {
          list.push({
            id: `bm-quick-${bm.id}`,
            kind: 'bookmark',
            title: bm.title || bm.url,
            subtitle: stripDisplayProtocol(bm.url).slice(0, 42),
            url: bm.url,
            favicon: bm.favicon
          })
        }
        for (const h of history.slice(0, 4)) {
          if (!list.some((x) => x.url === h.url)) {
            list.push({
              id: `hist-quick-${h.id}`,
              kind: 'history',
              title: h.title || h.url,
              subtitle: stripDisplayProtocol(h.url).slice(0, 42),
              url: h.url,
              favicon: h.favicon
            })
          }
          if (list.length >= 5) break
        }
      }

      list.push({
        id: 'nav-history',
        kind: 'nav-history',
        title: tr(lang, 'History', '浏览历史')
      })
      list.push({
        id: 'nav-bookmarks',
        kind: 'nav-bookmarks',
        title: tr(lang, 'Bookmarks', '收藏夹')
      })
      return list
    }

    const list: SuggestionItem[] = []

    if (lower.startsWith('/')) {
      for (const sk of allSkills) {
        if (
          sk.command.toLowerCase().startsWith(lower) ||
          lower.startsWith(`${sk.command.toLowerCase()} `)
        ) {
          list.push({
            id: `skill-${sk.id || sk.command}`,
            kind: 'skill',
            title: `${sk.command} — ${sk.label}`,
            subtitle: sk.description,
            skillCommand: q.length > sk.command.length ? q : sk.command
          })
        }
      }
    }

    if (effectiveIntent === 'url') {
      list.push({
        id: 'act-url',
        kind: 'action-url',
        title: q,
        subtitle: isNewTabMode
          ? tr(lang, 'Open URL in New Tab ↵', '新标签打开网址 ↵')
          : tr(lang, 'Open URL ↵', '打开网址 ↵')
      })
      list.push({
        id: 'act-ai',
        kind: 'action-ai',
        title: tr(lang, `Ask AI: “${q}”`, `向 AI 提问：“${q}”`),
        subtitle: isNewTabMode ? tr(lang, 'New AI Tab', '新建 AI 标签页') : undefined
      })
    } else if (effectiveIntent === 'ai') {
      list.push({
        id: 'act-ai',
        kind: 'action-ai',
        title: q,
        subtitle: isNewTabMode
          ? tr(lang, 'Ask AI in New Tab ↵', '新标签开启 AI 对话 ↵')
          : tr(lang, 'Ask AI ↵', '开启 AI 解答 ↵')
      })
      if (!q.startsWith('/') && !hasAttachments) {
        if (autoIntent === 'url') {
          list.push({
            id: 'act-url',
            kind: 'action-url',
            title: tr(lang, `Open URL “${q}”`, `打开网址 “${q}”`),
            subtitle: isNewTabMode ? tr(lang, 'New Tab', '新标签页') : undefined
          })
        } else {
          list.push({
            id: 'act-search',
            kind: 'action-search',
            title: tr(lang, `Search Web for “${q}”`, `网页搜索 “${q}”`),
            subtitle: isNewTabMode ? tr(lang, 'New Tab', '新标签页') : undefined
          })
        }
      }
    } else {
      list.push({
        id: 'act-search',
        kind: 'action-search',
        title: q,
        subtitle: isNewTabMode
          ? tr(lang, 'Search in New Tab ↵', '新标签网页搜索 ↵')
          : tr(lang, 'Search Web ↵', '网页搜索 ↵')
      })
      list.push({
        id: 'act-ai',
        kind: 'action-ai',
        title: tr(lang, `Ask AI: “${q}”`, `向 AI 提问：“${q}”`),
        subtitle: isNewTabMode ? tr(lang, 'New AI Tab', '新建 AI 标签页') : undefined
      })
    }

    if (!hasAttachments) {
      for (const t of openTabsList) {
        if (!isNewTabMode && t.id === activeTabId && q === startValue) continue
        if (t.title.toLowerCase().includes(lower) || t.url.toLowerCase().includes(lower)) {
          list.push({
            id: `tab-${t.id}`,
            kind: 'tab',
            title: t.title || t.url,
            subtitle: tr(lang, 'Switch to Tab', '切换到标签页'),
            url: t.url,
            favicon: t.favicon,
            tabId: t.id
          })
          if (list.length < 7) {
            list.push({
              id: `split-${t.id}`,
              kind: 'split-tab',
              title: t.title || t.url,
              subtitle: tr(lang, 'Open in Split View', '右侧分屏打开'),
              url: t.url,
              favicon: t.favicon,
              tabId: t.id
            })
          }
        }
      }

      for (const bm of bookmarks) {
        if (bm.title.toLowerCase().includes(lower) || bm.url.toLowerCase().includes(lower)) {
          list.push({
            id: `bm-${bm.id}`,
            kind: 'bookmark',
            title: bm.title,
            subtitle: stripDisplayProtocol(bm.url),
            url: bm.url,
            favicon: bm.favicon
          })
        }
      }

      for (const h of history.slice(0, 40)) {
        if (h.title.toLowerCase().includes(lower) || h.url.toLowerCase().includes(lower)) {
          if (!list.some((x) => x.url === h.url)) {
            list.push({
              id: `hist-${h.id}`,
              kind: 'history',
              title: h.title,
              subtitle: stripDisplayProtocol(h.url),
              url: h.url,
              favicon: h.favicon
            })
          }
        }
      }
    }

    return list.slice(0, 9)
  }, [
    shouldShowSuggestions,
    trimmedQuery,
    subView,
    showAllTabs,
    effectiveIntent,
    autoIntent,
    hasAttachments,
    isNewTabMode,
    startValue,
    lang,
    activeTabId,
    openTabsList,
    bookmarks,
    history,
    allSkills
  ])

  useEffect(() => {
    setSelectedIdx(0)
  }, [trimmedQuery, effectiveIntent, subView, mode])

  const handleInputChange = (val: string): void => {
    setQuery(val)
    setHasEdited(true)
    setIntentOverride(null)

    const atMatch = val.match(/(?:^|\s)@([^\s@]*)$/)
    if (atMatch) {
      setContextPickerOpen(false)
      setMentionQuery(atMatch[1])
      setMentionIdx(0)
    } else {
      setMentionQuery(null)
    }
  }

  const applyMention = (cand: ChatMention): void => {
    // If user clicked "+ Add tabs or files" while initial URL was untouched, clear the URL so they can type their prompt cleanly!
    if (isUnchangedInitialUrl) {
      setQuery('')
      setHasEdited(true)
    } else {
      const cleaned = query.replace(/(?:^|\s)@([^\s@]*)$/, (m) => (m.startsWith(' ') ? ' ' : ''))
      setQuery(cleaned)
    }
    setMentionQuery(null)
    setContextPickerOpen(false)
    setIntentOverride('ai')

    if (
      !mentions.some(
        (m) => m.type === cand.type && m.tabId === cand.tabId && m.toolId === cand.toolId
      ) &&
      mentions.length < 8
    ) {
      setMentions((prev) => [...prev, cand])
    }
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files
    if (!files || files.length === 0) return
    if (isUnchangedInitialUrl) {
      setQuery('')
      setHasEdited(true)
    }
    setContextPickerOpen(false)
    Array.from(files)
      .slice(0, 3)
      .forEach((file) => {
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            const snippet = reader.result.slice(0, 24000)
            setAttachedFiles((prev) =>
              prev.some((f) => f.name === file.name)
                ? prev
                : [...prev, { name: file.name, content: snippet }]
            )
            setIntentOverride('ai')
          }
        }
        reader.readAsText(file)
      })
    e.target.value = ''
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  const toggleVoiceDictation = (): void => {
    if (isListening) {
      try {
        recognitionRef.current?.stop()
      } catch {
        // ignore
      }
      setIsListening(false)
      return
    }

    const SpeechCtor = (
      window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionInstance
        webkitSpeechRecognition?: new () => SpeechRecognitionInstance
      }
    ).SpeechRecognition ||
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => SpeechRecognitionInstance
        }
      ).webkitSpeechRecognition

    if (!SpeechCtor) {
      onShowToast?.(
        tr(
          lang,
          'Voice dictation is unavailable in this system environment',
          '当前系统环境暂不支持语音听写输入'
        )
      )
      return
    }

    try {
      const rec = new SpeechCtor()
      rec.lang = lang === 'zh-CN' ? 'zh-CN' : 'en-US'
      rec.interimResults = true
      rec.continuous = false
      const baseText = isUnchangedInitialUrl ? '' : query

      rec.onresult = (evt) => {
        let transcript = ''
        for (let i = evt.resultIndex; i < evt.results.length; i++) {
          transcript += evt.results[i][0]?.transcript || ''
        }
        if (transcript) {
          setHasEdited(true)
          setQuery(baseText ? `${baseText.trimEnd()} ${transcript.trim()}` : transcript.trim())
        }
      }
      rec.onerror = () => {
        setIsListening(false)
      }
      rec.onend = () => {
        setIsListening(false)
        inputRef.current?.focus()
      }

      recognitionRef.current = rec
      setIsListening(true)
      rec.start()
    } catch {
      setIsListening(false)
    }
  }

  const buildFinalAiPayload = (rawPrompt: string): { prompt: string; mentions: ChatMention[] } => {
    const promptBase =
      rawPrompt.trim() ||
      tr(lang, 'Analyze the attached context.', '请结合我添加的标签页或文件进行分析。')
    if (attachedFiles.length === 0) {
      return { prompt: promptBase, mentions }
    }
    const fileBlocks = attachedFiles
      .map((f) => `<file name="${f.name}">\n${f.content}\n</file>`)
      .join('\n\n')
    return {
      prompt: `${promptBase}\n\n${fileBlocks}`,
      mentions
    }
  }

  const openTargetUrlOrQuery = (target: string): void => {
    const resolved = isUnchangedInitialUrl && rawInitialUrl ? rawInitialUrl : target
    if (!resolved.trim()) return
    if (isNewTabMode && onOpenInNewTab) {
      onOpenInNewTab(resolved)
    } else {
      onNavigate(resolved)
    }
  }

  const executePrimarySubmit = (): void => {
    if (hasAttachments || effectiveIntent === 'ai') {
      const promptCandidate = isUnchangedInitialUrl ? '' : trimmedQuery
      if (!promptCandidate && !hasAttachments) return
      const payload = buildFinalAiPayload(promptCandidate)
      onAskAI(payload.prompt, isNewTabMode, payload.mentions)
      onClose()
      return
    }

    if (isUnchangedInitialUrl && rawInitialUrl) {
      openTargetUrlOrQuery(rawInitialUrl)
      onClose()
      return
    }

    if (shouldShowSuggestions && suggestions[selectedIdx]) {
      executeItem(suggestions[selectedIdx])
      return
    }

    if (trimmedQuery) {
      openTargetUrlOrQuery(trimmedQuery)
      onClose()
    }
  }

  const executeItem = (item: SuggestionItem | undefined): void => {
    if (!item) {
      executePrimarySubmit()
      return
    }

    if (item.kind === 'show-all-tabs') {
      setShowAllTabs(true)
      return
    }
    if (item.kind === 'nav-history') {
      setQuery('')
      setHasEdited(true)
      setSubView('history')
      return
    }
    if (item.kind === 'nav-bookmarks') {
      setQuery('')
      setHasEdited(true)
      setSubView('bookmarks')
      return
    }
    if (item.kind === 'skill' && item.skillCommand) {
      onClose()
      if (item.skillCommand === '/organize') {
        onOrganizeTabs()
      } else {
        const payload = buildFinalAiPayload(item.skillCommand)
        onAskAI(payload.prompt, isNewTabMode, payload.mentions)
      }
    } else if (item.kind === 'action-ai') {
      if (!trimmedQuery && !hasAttachments) return
      const payload = buildFinalAiPayload(trimmedQuery)
      onAskAI(payload.prompt, isNewTabMode, payload.mentions)
      onClose()
    } else if (item.kind === 'split-tab' && item.tabId) {
      onOpenTabInSplit(item.tabId)
      onClose()
    } else if (item.kind === 'tab' && item.tabId) {
      onSwitchTab(item.tabId)
      onClose()
    } else if (item.url) {
      if (isNewTabMode && onOpenInNewTab) {
        onOpenInNewTab(item.url)
      } else {
        onNavigate(item.url)
      }
      onClose()
    } else if (trimmedQuery) {
      openTargetUrlOrQuery(trimmedQuery)
      onClose()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return

    if (showMentionMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx((i) => (i + 1) % mentionCandidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        applyMention(mentionCandidates[mentionIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setContextPickerOpen(false)
        setMentionQuery(null)
        return
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      if (subView !== 'root') {
        setSubView('root')
        setQuery('')
      } else {
        onClose()
      }
    } else if (e.key === 'Backspace' && !query && subView !== 'root') {
      setSubView('root')
    } else if (e.key === 'Tab') {
      e.preventDefault()
      toggleIntentMode()
    } else if (e.key === 'ArrowDown') {
      if (!shouldShowSuggestions) {
        setHasEdited(true)
        return
      }
      e.preventDefault()
      setSelectedIdx((i) => (suggestions.length ? (i + 1) % suggestions.length : 0))
    } else if (e.key === 'ArrowUp') {
      if (!shouldShowSuggestions) return
      e.preventDefault()
      setSelectedIdx((i) =>
        suggestions.length ? (i - 1 + suggestions.length) % suggestions.length : 0
      )
    } else if (e.key === 'Enter') {
      e.preventDefault()
      executePrimarySubmit()
    }
  }

  const handleCopyFullUrl = (e: React.ClipboardEvent<HTMLInputElement>): void => {
    if (!isUnchangedInitialUrl || !rawInitialUrl) return
    const el = e.currentTarget
    if (el.selectionStart === 0 && el.selectionEnd === el.value.length) {
      e.preventDefault()
      e.clipboardData.setData('text/plain', rawInitialUrl)
    }
  }

  const isEmptyQueryRoot = subView === 'root' && !trimmedQuery && !hasAttachments
  const canSubmit = Boolean(trimmedQuery || hasAttachments)
  const isAiAction = hasAttachments || effectiveIntent === 'ai'

  return (
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-50 bg-transparent"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          top: anchorPos.top,
          left: anchorPos.left,
          width: anchorPos.width,
          transformOrigin: 'top center'
        }}
        className={`fixed rounded-[16px] border select-none overflow-hidden ${
          isClosing ? 'dia-smartbar-exit' : 'dia-smartbar-enter'
        } ${
          isDark
            ? 'bg-[#252528] border-white/[0.13] text-zinc-100 shadow-[0_22px_58px_-8px_rgba(0,0,0,0.68),0_0_0_0.5px_rgba(255,255,255,0.06)]'
            : 'bg-white border-black/[0.11] text-zinc-900 shadow-[0_18px_50px_-8px_rgba(15,23,42,0.22),0_0_0_0.5px_rgba(0,0,0,0.04)]'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.py,.html,.css,.yml,.yaml,.xml,.log"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Row 1: Dia Clean URL / Search / AI Input Row */}
        <div className="flex items-center gap-2.5 px-3.5 pt-2.5 pb-1.5">
          {subView !== 'root' ? (
            <button
              type="button"
              onClick={() => {
                setSubView('root')
                setQuery('')
              }}
              className="p-0.5 -ml-1 rounded-md opacity-60 hover:opacity-100 transition"
            >
              <ChevronLeft size={15} />
            </button>
          ) : isAiAction && !isUnchangedInitialUrl ? (
            <Sparkles size={14.5} className="text-indigo-400 shrink-0" />
          ) : (
            <Search size={14.5} className="opacity-55 shrink-0" />
          )}

          <input
            ref={inputRef}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            value={query}
            onCopy={handleCopyFullUrl}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              subView === 'history'
                ? tr(lang, 'Search History…', '搜索浏览历史…')
                : subView === 'bookmarks'
                  ? tr(lang, 'Search Bookmarks…', '搜索收藏夹…')
                  : hasAttachments
                    ? tr(
                        lang,
                        'Ask anything about the added tabs or files…',
                        '针对已添加的标签页或文件提问…'
                      )
                    : isNewTabMode
                      ? tr(
                          lang,
                          'Enter a URL, search, or ask anything…',
                          '输入网址、搜索网页，或直接提问…'
                        )
                      : tr(
                          lang,
                          'Search, enter a URL, or ask anything…',
                          '搜索网页、输入网址，或直接提问…'
                        )
            }
            className={`flex-1 min-w-0 bg-transparent outline-none text-[13.5px] leading-[1.4] placeholder:opacity-40 ${
              isDark ? 'selection:bg-white/[0.22]' : 'selection:bg-indigo-500/20'
            }`}
          />
        </div>

        {/* Attached @Mentions & File Context Chips */}
        {hasAttachments && (
          <div className="flex flex-wrap items-center gap-1.5 px-3.5 pb-1.5 pt-0.5">
            {mentions.map((m, i) => (
              <span
                key={`${m.type}-${m.tabId || m.toolId || i}`}
                className={`inline-flex items-center gap-1.5 h-[24px] px-2.5 rounded-full text-[11.5px] border ${
                  isDark
                    ? 'bg-white/[0.07] border-white/[0.10] text-zinc-200'
                    : 'bg-black/[0.04] border-black/[0.08] text-zinc-700'
                }`}
              >
                {m.type === 'tool' && m.toolId ? (
                  <ToolBrandIcon id={m.toolId} size={11.5} />
                ) : m.type === 'tab' ? (
                  <FaviconIcon url={m.url} favicon={m.favicon} size={11.5} />
                ) : (
                  <AtSign size={10.5} className="opacity-60" />
                )}
                <span className="max-w-[165px] truncate">{m.title}</span>
                <button
                  type="button"
                  onClick={() => setMentions((prev) => prev.filter((_, idx) => idx !== i))}
                  className="opacity-55 hover:opacity-100"
                >
                  <X size={10.5} />
                </button>
              </span>
            ))}
            {attachedFiles.map((f, idx) => (
              <span
                key={`file-${f.name}-${idx}`}
                className={`inline-flex items-center gap-1.5 h-[24px] px-2.5 rounded-full text-[11.5px] border ${
                  isDark
                    ? 'bg-white/[0.07] border-white/[0.10] text-zinc-200'
                    : 'bg-black/[0.04] border-black/[0.08] text-zinc-700'
                }`}
              >
                <FileText size={11} className="opacity-65" />
                <span className="max-w-[150px] truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))
                  }
                  className="opacity-55 hover:opacity-100"
                >
                  <X size={10.5} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Row 2: Dia Signature Action Bar ("+ Add tabs or files" ... Mic + "Go ↵") */}
        <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-2.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setContextPickerOpen((v) => !v)
                setMentionIdx(0)
              }}
              className={`h-[28px] px-3 rounded-full border text-[12px] font-medium inline-flex items-center gap-1.5 transition ${
                contextPickerOpen
                  ? isDark
                    ? 'bg-white/[0.11] border-white/[0.22] text-white'
                    : 'bg-black/[0.07] border-black/[0.18] text-zinc-900'
                  : isDark
                    ? 'border-white/[0.11] text-zinc-300/85 hover:text-zinc-100 hover:bg-white/[0.06] hover:border-white/[0.18]'
                    : 'border-black/[0.10] text-zinc-600 hover:text-zinc-900 hover:bg-black/[0.04]'
              }`}
            >
              <Plus size={13} className="opacity-75" />
              <span>{tr(lang, 'Add tabs or files', '添加标签页或文件')}</span>
            </button>

            {trimmedQuery && !isUnchangedInitialUrl && !hasAttachments && (
              <button
                type="button"
                onClick={toggleIntentMode}
                title={tr(
                  lang,
                  'Press Tab to switch between Web and AI Chat',
                  '按 Tab 键在网页跳转与 AI 提问之间切换'
                )}
                className={`h-[26px] px-2.5 rounded-full text-[11px] font-medium inline-flex items-center gap-1 transition ${
                  isDark
                    ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]'
                    : 'text-zinc-500 hover:text-zinc-800 hover:bg-black/[0.05]'
                }`}
              >
                <span>
                  {effectiveIntent === 'ai'
                    ? tr(lang, 'Tab · Web', 'Tab · 网页')
                    : tr(lang, 'Tab · Ask AI', 'Tab · 问 AI')}
                </span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleVoiceDictation}
              title={
                isListening
                  ? tr(lang, 'Stop voice input', '停止语音输入')
                  : tr(lang, 'Voice input', '语音听写输入')
              }
              className={`w-[28px] h-[28px] rounded-full flex items-center justify-center transition ${
                isListening
                  ? 'bg-rose-500/20 text-rose-400 animate-pulse'
                  : isDark
                    ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.07]'
                    : 'text-zinc-500 hover:text-zinc-800 hover:bg-black/[0.05]'
              }`}
            >
              {isListening ? <MicOff size={14} /> : <Mic size={14} />}
            </button>

            <button
              type="button"
              disabled={!canSubmit}
              onClick={executePrimarySubmit}
              title={
                isAiAction
                  ? tr(lang, 'Ask AI (Enter)', '发送提问 (Enter)')
                  : tr(lang, 'Go (Enter)', '前往 (Enter)')
              }
              className={`h-[30px] px-4 rounded-full text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition ${
                canSubmit
                  ? isDark
                    ? 'bg-[#E4E4E7] hover:bg-white text-[#18181B] shadow-2xs'
                    : 'bg-[#18181B] hover:bg-[#27272A] text-white shadow-2xs'
                  : isDark
                    ? 'bg-white/[0.08] text-zinc-500 cursor-default'
                    : 'bg-black/[0.06] text-zinc-400 cursor-default'
              }`}
            >
              <span>
                {isAiAction
                  ? tr(lang, 'Ask', '提问')
                  : tr(lang, 'Go', '前往')}
              </span>
              <CornerDownLeft size={12} strokeWidth={2.2} className="opacity-75" />
            </button>
          </div>
        </div>

        {/* Context Picker List (Opened via "+ Add tabs or files" or typing "@") */}
        {showMentionMenu && (
          <div
            className={`px-1.5 py-1.5 border-t max-h-[300px] overflow-y-auto ${
              isDark ? 'border-white/[0.08]' : 'border-black/[0.07]'
            }`}
          >
            <div className="px-2.5 pt-0.5 pb-1 text-[11px] font-medium opacity-45">
              {tr(lang, 'Add tabs or context', '添加标签页或上下文')}
            </div>
            {mentionCandidates.map((cand, idx) => {
              const active = idx === mentionIdx
              return (
                <button
                  key={`${cand.type}-${cand.tabId || cand.toolId || idx}`}
                  type="button"
                  onMouseEnter={() => setMentionIdx(idx)}
                  onClick={() => applyMention(cand)}
                  className={`w-full flex items-center gap-2.5 px-2.5 h-[34px] rounded-[10px] text-[12.5px] text-left transition ${
                    active
                      ? isDark
                        ? 'bg-white/[0.09] text-white'
                        : 'bg-black/[0.06] text-zinc-900'
                      : isDark
                        ? 'text-zinc-300 hover:bg-white/[0.05]'
                        : 'text-zinc-700 hover:bg-black/[0.04]'
                  }`}
                >
                  {cand.type === 'tool' && cand.toolId ? (
                    <ToolBrandIcon id={cand.toolId} size={14} />
                  ) : cand.type === 'all-tabs' ? (
                    <Layers size={13.5} className="opacity-60 shrink-0" />
                  ) : cand.type === 'history' ? (
                    <History size={13.5} className="opacity-60 shrink-0" />
                  ) : cand.type === 'memory' ? (
                    <Sparkles size={13.5} className="opacity-60 shrink-0" />
                  ) : (
                    <FaviconIcon url={cand.url} favicon={cand.favicon} size={14} />
                  )}
                  <span className="truncate flex-1 font-medium">{cand.title}</span>
                  {cand.type === 'tool' && (
                    <span className="text-[10.5px] opacity-45 shrink-0">
                      {tr(lang, 'Connected', '已连接')}
                    </span>
                  )}
                </button>
              )
            })}
            <div
              className={`my-1 mx-2 border-t ${
                isDark ? 'border-white/[0.07]' : 'border-black/[0.06]'
              }`}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`w-full flex items-center gap-2.5 px-2.5 h-[34px] rounded-[10px] text-[12.5px] text-left transition ${
                isDark
                  ? 'text-zinc-300 hover:bg-white/[0.06]'
                  : 'text-zinc-700 hover:bg-black/[0.04]'
              }`}
            >
              <Paperclip size={13.5} className="opacity-60 shrink-0" />
              <span className="font-medium">
                {tr(lang, 'Attach local text / code file…', '添加本地文本或代码文件…')}
              </span>
            </button>
          </div>
        )}

        {/* Categorized Autocomplete & Quick Switch Results */}
        {shouldShowSuggestions && suggestions.length > 0 && (
          <div
            className={`px-1.5 py-1.5 border-t max-h-[340px] overflow-y-auto ${
              isDark ? 'border-white/[0.08]' : 'border-black/[0.07]'
            }`}
          >
            {isEmptyQueryRoot &&
              (openTabsList.length > 0 || bookmarks.length > 0 || history.length > 0) && (
                <div className="px-2.5 pt-0.5 pb-1 text-[11px] font-medium opacity-40">
                  {openTabsList.length > 0
                    ? tr(lang, 'Open Tabs', '已打开标签页')
                    : tr(lang, 'Quick Access', '常用与最近访问')}
                </div>
              )}

            {suggestions.map((item, idx) => {
              const active = idx === selectedIdx
              const isFooterSectionStart = isEmptyQueryRoot && item.kind === 'nav-history'

              return (
                <React.Fragment key={item.id}>
                  {isFooterSectionStart && (
                    <div
                      className={`my-1 mx-2 border-t ${
                        isDark ? 'border-white/[0.06]' : 'border-black/[0.06]'
                      }`}
                    />
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setSelectedIdx(idx)}
                    onClick={() => executeItem(item)}
                    className={`w-full flex items-center gap-2.5 px-2.5 h-[35px] rounded-[10px] text-left text-[12.5px] transition-colors ${
                      active
                        ? isDark
                          ? 'bg-white/[0.09] text-white'
                          : 'bg-black/[0.06] text-zinc-900'
                        : isDark
                          ? 'text-zinc-300/90 hover:bg-white/[0.05]'
                          : 'text-zinc-700 hover:bg-black/[0.04]'
                    }`}
                  >
                    <div className="shrink-0 flex items-center justify-center w-4">
                      {item.kind === 'show-all-tabs' ? (
                        <MoreHorizontal size={14} className="opacity-55" />
                      ) : item.kind === 'nav-history' || item.kind === 'history' ? (
                        item.url ? (
                          <FaviconIcon url={item.url} favicon={item.favicon} size={14} />
                        ) : (
                          <Clock size={13.5} className="opacity-55" />
                        )
                      ) : item.kind === 'nav-bookmarks' || item.kind === 'bookmark' ? (
                        item.url ? (
                          <FaviconIcon url={item.url} favicon={item.favicon} size={14} />
                        ) : (
                          <Bookmark size={13.5} className="opacity-55" />
                        )
                      ) : item.kind === 'skill' ? (
                        <Wand2 size={13.5} className="text-indigo-400" />
                      ) : item.kind === 'action-ai' ? (
                        <Sparkles size={13.5} className="text-indigo-400" />
                      ) : item.kind === 'split-tab' ? (
                        <Columns2 size={13.5} className="opacity-65" />
                      ) : item.kind === 'action-url' ? (
                        <Compass size={13.5} className="text-indigo-400" />
                      ) : item.kind === 'action-search' ? (
                        <Search size={13.5} className="opacity-55" />
                      ) : (
                        <FaviconIcon url={item.url} favicon={item.favicon} size={14} />
                      )}
                    </div>

                    <span className="truncate flex-1 font-medium">{item.title}</span>

                    {item.kind === 'tab' ? (
                      <span
                        className={`inline-flex items-center gap-1.5 text-[11px] font-medium shrink-0 ${
                          active ? 'opacity-95' : 'opacity-45'
                        }`}
                      >
                        <span>{tr(lang, 'Switch to Tab', '切换到标签')}</span>
                        <span
                          className={`w-4.5 h-4.5 rounded-md inline-flex items-center justify-center ${
                            active
                              ? isDark
                                ? 'bg-white text-zinc-900'
                                : 'bg-zinc-900 text-white'
                              : isDark
                                ? 'bg-white/10 text-zinc-300'
                                : 'bg-black/8 text-zinc-600'
                          }`}
                        >
                          <ArrowRight size={11} />
                        </span>
                      </span>
                    ) : item.subtitle ? (
                      <span className="text-[11px] opacity-45 truncate max-w-[200px] shrink-0">
                        {item.subtitle}
                      </span>
                    ) : null}

                    {(item.kind === 'show-all-tabs' ||
                      item.kind === 'nav-history' ||
                      item.kind === 'nav-bookmarks') && (
                      <ChevronRight size={13} className="opacity-35 shrink-0" />
                    )}
                  </button>
                </React.Fragment>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
