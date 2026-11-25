import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Clock,
  Columns2,
  Compass,
  Globe,
  MoreHorizontal,
  Search,
  Sparkles,
  Wand2
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
  HistoryItem,
  InputIntentType,
  SlashSkill,
  TabState
} from '@shared/types'
import { FaviconIcon } from './FaviconIcon'

export type OmniboxMode = 'new-tab' | 'current-tab'

interface Props {
  mode?: OmniboxMode
  focusTrigger?: number
  isDark: boolean
  lang?: AppLanguage
  activeTabId?: string | null
  initialUrl?: string
  recentlyClosedCount?: number
  tabs: TabState[]
  bookmarks: BookmarkItem[]
  history: HistoryItem[]
  customSkills?: SlashSkill[]
  onNavigate: (input: string) => void
  onOpenInNewTab?: (input: string) => void
  onSwitchTab: (tabId: string) => void
  onOpenTabInSplit: (tabId: string) => void
  onAskAI: (prompt: string, openInNewTab?: boolean) => void
  onNewChatTab: () => void
  onOrganizeTabs: () => void
  onOpenReader: () => void
  onToggleSplitView: () => void
  onReopenClosedTab: () => void
  onToggleTheme: () => void
  onToggleLanguage?: () => void
  onCheckUpdates?: () => void
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

export const CommandOmniboxModal: React.FC<Props> = ({
  mode = 'current-tab',
  focusTrigger = 0,
  isDark,
  lang,
  activeTabId,
  initialUrl,
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
  isClosing = false,
  onClose
}) => {
  const isNewTabMode = mode === 'new-tab'
  const startValue =
    !isNewTabMode && initialUrl && !isInternalArkoUrl(initialUrl) ? initialUrl : ''
  const [query, setQuery] = useState(startValue)
  const [subView, setSubView] = useState<SubView>('root')
  const [showAllTabs, setShowAllTabs] = useState(false)
  const [intentOverride, setIntentOverride] = useState<'ai' | 'web' | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const allSkills = useMemo(() => getAllSlashSkills(customSkills, lang), [customSkills, lang])

  // Reliable focus & selection even when transitioning from WebContentsView or repeated ⌘T
  useEffect(() => {
    const focusInput = (selectAll = false): void => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      if (selectAll && el.value) {
        el.select()
      }
    }
    const shouldSelect = subView === 'root' && Boolean(startValue)
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
  }, [subView, mode, startValue, focusTrigger])

  // Real open tabs (never list blank New Tab placeholders); put recently accessed tabs first
  const openTabsList = useMemo(() => {
    const realTabs = tabs.filter((t) => t.url !== NEW_TAB_URL)
    return [...realTabs].sort((a, b) => {
      if (isNewTabMode) {
        // Put non-active recent tabs first for instant Arc-style "Switch to Tab"
        const aIsCurrent = a.id === activeTabId ? 1 : 0
        const bIsCurrent = b.id === activeTabId ? 1 : 0
        if (aIsCurrent !== bIsCurrent) return aIsCurrent - bIsCurrent
      }
      return (b.lastAccessedAt || 0) - (a.lastAccessedAt || 0)
    })
  }, [tabs, isNewTabMode, activeTabId])

  const trimmedQuery = query.trim()
  const autoIntent: InputIntentType = classifyInputIntent(trimmedQuery)
  const effectiveIntent: InputIntentType = useMemo(() => {
    if (!trimmedQuery) return 'search'
    if (intentOverride === 'ai') return 'ai'
    if (intentOverride === 'web') return autoIntent === 'url' ? 'url' : 'search'
    return autoIntent
  }, [trimmedQuery, intentOverride, autoIntent])

  const toggleIntentMode = (): void => {
    if (!trimmedQuery) return
    setIntentOverride(effectiveIntent === 'ai' ? 'web' : 'ai')
  }

  const suggestions = useMemo<SuggestionItem[]>(() => {
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
        .slice(0, 25)
        .map((h) => ({
          id: `hist-${h.id}`,
          kind: 'history' as const,
          title: h.title || h.url,
          subtitle: h.url,
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
        .slice(0, 25)
        .map((b) => ({
          id: `bm-${b.id}`,
          kind: 'bookmark' as const,
          title: b.title || b.url,
          subtitle: b.url,
          url: b.url,
          favicon: b.favicon
        }))
    }

    // Arc-style overview when query is empty: Open Tabs ("Switch to Tab →") + History / Bookmarks
    if (!q) {
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
            subtitle: bm.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 42),
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
              subtitle: h.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 42),
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

    // Active URL / Search / AI / Skill suggestions
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
      if (!q.startsWith('/')) {
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
        if (list.length < 8) {
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
          subtitle: bm.url,
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
            subtitle: h.url,
            url: h.url,
            favicon: h.favicon
          })
        }
      }
    }

    return list.slice(0, 10)
  }, [
    trimmedQuery,
    subView,
    showAllTabs,
    effectiveIntent,
    autoIntent,
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

  const openTargetUrlOrQuery = (target: string): void => {
    if (!target.trim()) return
    if (isNewTabMode && onOpenInNewTab) {
      onOpenInNewTab(target)
    } else {
      onNavigate(target)
    }
  }

  const executeItem = (item: SuggestionItem | undefined): void => {
    if (!item) {
      if (trimmedQuery) {
        if (effectiveIntent === 'ai') onAskAI(trimmedQuery, isNewTabMode)
        else openTargetUrlOrQuery(trimmedQuery)
        onClose()
      }
      return
    }

    if (item.kind === 'show-all-tabs') {
      setShowAllTabs(true)
      return
    }
    if (item.kind === 'nav-history') {
      setQuery('')
      setSubView('history')
      return
    }
    if (item.kind === 'nav-bookmarks') {
      setQuery('')
      setSubView('bookmarks')
      return
    }
    if (item.kind === 'skill' && item.skillCommand) {
      onClose()
      if (item.skillCommand === '/organize') onOrganizeTabs()
      else onAskAI(item.skillCommand, isNewTabMode)
    } else if (item.kind === 'action-ai') {
      if (!trimmedQuery) return
      onAskAI(trimmedQuery, isNewTabMode)
      onClose()
    } else if (item.kind === 'split-tab' && item.tabId) {
      onOpenTabInSplit(item.tabId)
      onClose()
    } else if (item.kind === 'tab' && item.tabId) {
      onSwitchTab(item.tabId)
      onClose()
    } else if (item.url) {
      openTargetUrlOrQuery(item.url)
      onClose()
    } else if (trimmedQuery) {
      openTargetUrlOrQuery(trimmedQuery)
      onClose()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return

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
      e.preventDefault()
      setSelectedIdx((i) => (suggestions.length ? (i + 1) % suggestions.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) =>
        suggestions.length ? (i - 1 + suggestions.length) % suggestions.length : 0
      )
    } else if (e.key === 'Enter') {
      e.preventDefault()
      executeItem(suggestions[selectedIdx])
    }
  }

  const isEmptyQueryRoot = subView === 'root' && !trimmedQuery
  const detectedIntent = trimmedQuery ? effectiveIntent : null

  return (
    <div
      onClick={onClose}
      className={`fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/28 backdrop-blur-[3px] px-4 ${
        isClosing ? 'arc-backdrop-exit' : 'arc-backdrop-enter'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-[568px] rounded-[20px] border backdrop-blur-2xl shadow-[0_28px_80px_-8px_rgba(0,0,0,0.52)] overflow-hidden select-none ${
          isClosing ? 'arc-omnibox-exit' : 'arc-omnibox-enter'
        } ${
          isDark
            ? 'bg-[#222228]/95 border-white/[0.13] text-zinc-100'
            : 'bg-white/95 border-black/[0.09] text-zinc-900'
        }`}
      >
        {/* Arc-Style URL / Search / AI Input Header */}
        <div
          className={`flex items-center gap-2.5 px-4 h-[50px] border-b ${
            isDark ? 'border-white/[0.07]' : 'border-black/[0.06]'
          }`}
        >
          {subView !== 'root' ? (
            <button
              type="button"
              onClick={() => {
                setSubView('root')
                setQuery('')
              }}
              className="p-0.5 -ml-1 rounded-md opacity-55 hover:opacity-100 transition"
            >
              <ChevronLeft size={16} />
            </button>
          ) : detectedIntent === 'url' ? (
            <Globe size={16} className="text-indigo-500 shrink-0" />
          ) : detectedIntent === 'ai' ? (
            <Sparkles size={16} className="text-indigo-500 shrink-0" />
          ) : (
            <Search size={16} className="opacity-45 shrink-0" />
          )}

          <input
            ref={inputRef}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIntentOverride(null)
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              subView === 'history'
                ? tr(lang, 'Search History…', '搜索浏览历史…')
                : subView === 'bookmarks'
                  ? tr(lang, 'Search Bookmarks…', '搜索收藏夹…')
                  : isNewTabMode
                    ? tr(
                        lang,
                        'Search, enter URL, or ask AI…',
                        '输入网址、搜索，或直接向 AI 提问…'
                      )
                    : tr(lang, 'Search or enter URL…', '搜索或输入网址…')
            }
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:opacity-40"
          />

          {trimmedQuery ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={toggleIntentMode}
                title={tr(
                  lang,
                  'Press Tab to toggle between Web and AI Chat',
                  '按 Tab 键在打开网页/搜索与 AI 对话之间切换'
                )}
                className={`h-6 px-2 rounded-md text-[10.5px] font-medium inline-flex items-center gap-1 transition ${
                  effectiveIntent === 'ai'
                    ? isDark
                      ? 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30'
                      : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                    : isDark
                      ? 'bg-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.10]'
                      : 'bg-black/[0.045] text-zinc-600 hover:text-zinc-900 hover:bg-black/[0.08]'
                }`}
              >
                <span>
                  {effectiveIntent === 'ai'
                    ? tr(lang, 'Tab · Web', 'Tab 切网页')
                    : tr(lang, 'Tab · Ask AI', 'Tab 问 AI')}
                </span>
              </button>

              <button
                type="button"
                onClick={() => executeItem(suggestions[selectedIdx])}
                title={tr(lang, 'Confirm (Enter)', '回车打开 (Enter)')}
                className={`h-6 px-2 rounded-lg text-[11px] font-medium inline-flex items-center gap-1 transition ${
                  isDark
                    ? 'bg-white/12 hover:bg-white/18 text-zinc-100'
                    : 'bg-zinc-900 hover:bg-zinc-800 text-white'
                }`}
              >
                <span>
                  {effectiveIntent === 'ai'
                    ? tr(lang, 'Ask', '提问')
                    : isNewTabMode
                      ? tr(lang, 'Open', '打开')
                      : tr(lang, 'Go', '前往')}
                </span>
                <ArrowRight size={11} />
              </button>
            </div>
          ) : (
            <span
              className={`px-1.5 py-0.5 rounded-md text-[10.5px] font-medium tracking-wide shrink-0 ${
                isNewTabMode
                  ? isDark
                    ? 'bg-white/[0.07] text-zinc-300'
                    : 'bg-black/[0.05] text-zinc-600'
                  : 'opacity-35'
              }`}
            >
              {isNewTabMode ? '⌘T' : '⌘L'}
            </span>
          )}
        </div>

        {/* Categorized Results Body */}
        <div className="px-1.5 py-1.5 max-h-[380px] overflow-y-auto">
          {isEmptyQueryRoot && (openTabsList.length > 0 || bookmarks.length > 0 || history.length > 0) && (
            <div className="px-2.5 pt-0.5 pb-1 text-[11px] font-medium opacity-40">
              {openTabsList.length > 0
                ? tr(lang, 'Open Tabs', '已打开标签页')
                : tr(lang, 'Quick Access', '常用与最近访问')}
            </div>
          )}

          {suggestions.length === 0 && (
            <div className="py-8 text-center text-xs opacity-40">
              {tr(lang, 'No results', '暂无匹配项')}
            </div>
          )}

          {suggestions.map((item, idx) => {
            const active = idx === selectedIdx
            const isFooterSectionStart = isEmptyQueryRoot && item.kind === 'nav-history'

            return (
              <React.Fragment key={item.id}>
                {isFooterSectionStart && (
                  <div
                    className={`my-1.5 mx-2 border-t ${
                      isDark ? 'border-white/[0.06]' : 'border-black/[0.06]'
                    }`}
                  />
                )}
                <button
                  type="button"
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => executeItem(item)}
                  className={`w-full flex items-center gap-2.5 px-2.5 h-[37px] rounded-[10px] text-left text-[13px] transition-colors ${
                    active
                      ? isDark
                        ? 'bg-[#343946]/85 text-white'
                        : 'bg-indigo-500/[0.09] text-zinc-900'
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
                        <Clock size={14} className="opacity-55" />
                      )
                    ) : item.kind === 'nav-bookmarks' || item.kind === 'bookmark' ? (
                      item.url ? (
                        <FaviconIcon url={item.url} favicon={item.favicon} size={14} />
                      ) : (
                        <Bookmark size={14} className="opacity-55" />
                      )
                    ) : item.kind === 'skill' ? (
                      <Wand2 size={14} className="text-indigo-400" />
                    ) : item.kind === 'action-ai' ? (
                      <Sparkles size={14} className="text-indigo-400" />
                    ) : item.kind === 'split-tab' ? (
                      <Columns2 size={14} className="opacity-65" />
                    ) : item.kind === 'action-url' ? (
                      <Compass size={14} className="text-indigo-400" />
                    ) : item.kind === 'action-search' ? (
                      <Search size={14} className="opacity-55" />
                    ) : (
                      <FaviconIcon url={item.url} favicon={item.favicon} size={14} />
                    )}
                  </div>

                  <span className="truncate flex-1 font-medium">{item.title}</span>

                  {item.kind === 'tab' ? (
                    <span
                      className={`inline-flex items-center gap-1.5 text-[11.5px] font-medium shrink-0 ${
                        active ? 'opacity-95' : 'opacity-45'
                      }`}
                    >
                      <span>{tr(lang, 'Switch to Tab', '切换到标签')}</span>
                      <span
                        className={`w-5 h-5 rounded-md inline-flex items-center justify-center ${
                          active
                            ? isDark
                              ? 'bg-white text-zinc-900'
                              : 'bg-zinc-900 text-white'
                            : isDark
                              ? 'bg-white/10 text-zinc-300'
                              : 'bg-black/8 text-zinc-600'
                        }`}
                      >
                        <ArrowRight size={11.5} />
                      </span>
                    </span>
                  ) : item.subtitle ? (
                    <span className="text-[11px] opacity-50 truncate max-w-[180px] shrink-0">
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
      </div>
    </div>
  )
}
