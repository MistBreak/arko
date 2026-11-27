import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Bookmark,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns2,
  Copy,
  GripVertical,
  Lock,
  MessageSquare,
  PanelLeft,
  PenLine,
  Plug,
  RotateCw,
  Search,
  ShieldAlert,
  Sparkles,
  UserRound,
  X
} from 'lucide-react'
import {
  getAllSlashSkills,
  getChatThreadIdFromUrl,
  isChatTabUrl,
  isInternalArkoUrl,
  makeChatTabUrl,
  NEW_TAB_URL
} from '@shared/constants'
import { tr } from '@shared/i18n'
import { getArcSpaceTheme } from '@shared/space-theme'
import type {
  AgentToolStep,
  AppSettings,
  AppUpdateState,
  BrowserProfile,
  BrowserSnapshotState,
  ChatMention,
  ChatThread,
  ConnectedToolId,
  FindInPageResultPayload,
  InlineEditableTargetInfo,
  OverlaySnapshotResult,
  QuotedSelectionPayload,
  ReaderArticle,
  StreamChunkPayload,
  TabGroupColor,
  TabPinMode,
  TabState
} from '@shared/types'
import { HorizontalChrome } from './components/HorizontalChrome'
import { VerticalSidebar } from './components/VerticalSidebar'
import { NewTabView } from './components/NewTabView'
import { ChatTabView } from './components/ChatTabView'
import { AISidebar } from './components/AISidebar'
import { CommandOmniboxModal, type OmniboxMode } from './components/CommandOmniboxModal'
import { SettingsModal, type SettingsTabId } from './components/SettingsModal'
import { LibraryModal } from './components/LibraryModal'
import { DownloadsModal } from './components/DownloadsModal'
import { ReaderModal } from './components/ReaderModal'
import { TabContextMenu } from './components/TabContextMenu'
import { InlineWriteOverlay } from './components/InlineWriteOverlay'
import { FaviconIcon } from './components/FaviconIcon'
import { ConnectToolsModal, ToolBrandIcon } from './components/ConnectToolsModal'
import { SpaceEditorPopover, type SpacePopoverRequest } from './components/SpaceEditorPopover'
import { OnboardingImportModal } from './components/OnboardingImportModal'

/**
 * Keeps boolean-controlled overlays mounted briefly during their CSS exit animation
 * so popups dissolve smoothly instead of vanishing in 1 frame.
 */
function useAnimatedBool(open: boolean, exitMs = 135): { mounted: boolean; isClosing: boolean } {
  const [mounted, setMounted] = useState(open)
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setIsClosing(false)
      return
    }
    if (!mounted) return
    setIsClosing(true)
    const timer = window.setTimeout(() => {
      setMounted(false)
      setIsClosing(false)
    }, exitMs)
    return () => window.clearTimeout(timer)
  }, [open, mounted, exitMs])

  return { mounted: open || mounted, isClosing: !open && isClosing }
}

/**
 * Keeps payload-driven modals/popovers mounted with their last non-null value
 * during their CSS exit animation.
 */
function useAnimatedValue<T>(
  value: T | null,
  exitMs = 130
): { rendered: T | null; isClosing: boolean } {
  const [cached, setCached] = useState<T | null>(value)
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    if (value !== null) {
      setCached(value)
      setIsClosing(false)
      return
    }
    if (cached === null) return
    setIsClosing(true)
    const timer = window.setTimeout(() => {
      setCached(null)
      setIsClosing(false)
    }, exitMs)
    return () => window.clearTimeout(timer)
  }, [value, cached, exitMs])

  return {
    rendered: value ?? cached,
    isClosing: value === null && cached !== null && isClosing
  }
}

export const App: React.FC = () => {
  const [state, setState] = useState<BrowserSnapshotState | null>(null)
  const [updateState, setUpdateState] = useState<AppUpdateState | undefined>(undefined)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(232)
  const [aiWidth, setAiWidth] = useState(392)

  // Overlays that sit above WebContentsView
  const [omniboxOpen, setOmniboxOpen] = useState(false)
  const [omniboxMode, setOmniboxMode] = useState<OmniboxMode>('current-tab')
  const [omniboxFocusSeq, setOmniboxFocusSeq] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [connectToolsOpen, setConnectToolsOpen] = useState(false)
  const [importModalMode, setImportModalMode] = useState<'onboarding' | 'standalone' | null>(null)
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabId>('ai')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [readerArticle, setReaderArticle] = useState<ReaderArticle | null>(null)
  const [tabMenuState, setTabMenuState] = useState<{
    tab: TabState
    pos: { x: number; y: number }
  } | null>(null)
  const [spacePopoverReq, setSpacePopoverReq] = useState<SpacePopoverRequest | null>(null)

  // Arc Left-Edge Floating Hover-Peek Sidebar when collapsed (⇧⌘S)
  const [sidebarPeekOpen, setSidebarPeekOpen] = useState(false)
  const peekEnterTimerRef = useRef<number | null>(null)
  const peekLeaveTimerRef = useRef<number | null>(null)

  const [spaceSwitchHud, setSpaceSwitchHud] = useState<{
    profile: BrowserProfile
    dir: 'left' | 'right'
    seq: number
  } | null>(null)
  const [spaceHudLeaving, setSpaceHudLeaving] = useState(false)
  const prevProfileIdRef = useRef<string | null>(null)
  const pendingSpaceDirRef = useRef<'left' | 'right' | null>(null)
  const pillSwipeLockedRef = useRef<boolean>(false)
  const pillSwipeResetTimerRef = useRef<number | null>(null)
  const spaceHudTimerRef = useRef<number | null>(null)
  const spaceHudOutTimerRef = useRef<number | null>(null)

  const [inlineWriteTarget, setInlineWriteTarget] = useState<InlineEditableTargetInfo | null>(null)
  const [quotedSelection, setQuotedSelection] = useState<QuotedSelectionPayload | null>(null)
  const [pendingSkillCmd, setPendingSkillCmd] = useState<string | null>(null)
  const [organizingTabs, setOrganizingTabs] = useState(false)

  // Split View & Sidebar interactive drag state
  const [draggingSplit, setDraggingSplit] = useState(false)
  const [draggingSidebarSash, setDraggingSidebarSash] = useState(false)
  const [draggingAiSash, setDraggingAiSash] = useState(false)
  const [liveSplitRatio, setLiveSplitRatio] = useState<number | null>(null)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [externalDragLink, setExternalDragLink] = useState<{
    url: string
    title?: string
  } | null>(null)
  const [splitDropHover, setSplitDropHover] = useState(false)

  const [snapshots, setSnapshots] = useState<OverlaySnapshotResult>({
    primary: null,
    secondary: null
  })

  // Animated Toast state
  const [toastState, setToastState] = useState<{
    msg: string
    seq: number
    leaving: boolean
  } | null>(null)
  const toastLeaveTimerRef = useRef<number | null>(null)
  const toastClearTimerRef = useRef<number | null>(null)

  // Docked Find-in-page bar
  const [findBarOpen, setFindBarOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [findMatchInfo, setFindMatchInfo] = useState<FindInPageResultPayload | null>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const [copiedTopUrl, setCopiedTopUrl] = useState(false)

  const singleViewportRef = useRef<HTMLDivElement>(null)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const leftViewportRef = useRef<HTMLDivElement>(null)
  const rightViewportRef = useRef<HTMLDivElement>(null)
  const hasStateRef = useRef(false)
  const splitEnabledRef = useRef(false)
  const lastSentBoundsKeyRef = useRef('')

  hasStateRef.current = Boolean(state)
  splitEnabledRef.current = Boolean(state?.splitView.enabled)

  // Animated overlay presence hooks
  const omniboxAnim = useAnimatedBool(omniboxOpen, 130)
  const settingsAnim = useAnimatedBool(settingsOpen, 140)
  const connectToolsAnim = useAnimatedBool(connectToolsOpen, 140)
  const importModalAnim = useAnimatedValue(importModalMode, 140)
  const libraryAnim = useAnimatedBool(libraryOpen, 140)
  const downloadsAnim = useAnimatedBool(downloadsOpen, 125)
  const readerAnim = useAnimatedValue(readerArticle, 140)
  const tabMenuAnim = useAnimatedValue(tabMenuState, 120)
  const spacePopoverAnim = useAnimatedValue(spacePopoverReq, 125)
  const inlineWriteAnim = useAnimatedValue(inlineWriteTarget, 130)
  const peekSidebarAnim = useAnimatedBool(sidebarPeekOpen, 200)
  const aiSidebarAnim = useAnimatedBool(Boolean(state?.aiSidebarOpen), 240)

  const showToast = useCallback((msg: string) => {
    if (toastLeaveTimerRef.current !== null) window.clearTimeout(toastLeaveTimerRef.current)
    if (toastClearTimerRef.current !== null) window.clearTimeout(toastClearTimerRef.current)
    const seq = Date.now()
    setToastState({ msg, seq, leaving: false })
    toastLeaveTimerRef.current = window.setTimeout(() => {
      setToastState((cur) => (cur && cur.seq === seq ? { ...cur, leaving: true } : cur))
    }, 2150)
    toastClearTimerRef.current = window.setTimeout(() => {
      setToastState((cur) => (cur && cur.seq === seq ? null : cur))
    }, 2320)
  }, [])

  // Load initial snapshot & subscribe
  useEffect(() => {
    let mounted = true
    void window.arko.getInitialState().then((initial) => {
      if (!mounted) return
      setState(initial)
      if (!initial.settings.onboardingCompleted) {
        setImportModalMode('onboarding')
      }
      if (initial.updateState) {
        setUpdateState(initial.updateState)
      }
      if (initial.settings.sidebarWidth) {
        setSidebarWidth(Math.max(188, Math.min(420, initial.settings.sidebarWidth)))
      }
      if (initial.settings.aiSidebarWidth) {
        setAiWidth(initial.settings.aiSidebarWidth)
      }
      if (initial.threads.length > 0) {
        setActiveThreadId(initial.threads[0].id)
      }
    })

    const unsubState = window.arko.onStateChanged((next) => {
      setState(next)
      if (next.updateState) {
        setUpdateState(next.updateState)
      }
      setActiveThreadId((prev) => {
        if (prev && next.threads.some((t) => t.id === prev)) return prev
        return next.threads[0]?.id ?? null
      })
    })

    const unsubUpdate = window.arko.onUpdateStateChanged((nextUpd) => {
      setUpdateState(nextUpd)
    })

    const unsubStream = window.arko.onChatStreamChunk((chunk: StreamChunkPayload) => {
      setState((prev) => {
        if (!prev) return prev
        const nextThreads = prev.threads.map((th) => {
          if (th.id !== chunk.threadId) return th
          const nextMessages = th.messages.map((m) => {
            if (m.id !== chunk.messageId) return m
            let mergedSteps: AgentToolStep[] | undefined = m.toolSteps
            if (chunk.toolStep) {
              const existing = m.toolSteps ? [...m.toolSteps] : []
              const hitIdx = existing.findIndex((s) => s.id === chunk.toolStep!.id)
              if (hitIdx >= 0) {
                existing[hitIdx] = chunk.toolStep
              } else {
                existing.push(chunk.toolStep)
              }
              mergedSteps = existing
            }
            return {
              ...m,
              content: m.content + (chunk.deltaContent || ''),
              reasoning: (m.reasoning || '') + (chunk.deltaReasoning || ''),
              toolSteps: mergedSteps,
              referencedUrls: chunk.referencedUrls || m.referencedUrls,
              followUps: chunk.followUps || m.followUps,
              error: chunk.error || m.error,
              isStreaming: chunk.done ? false : true
            }
          })
          return { ...th, messages: nextMessages }
        })
        return { ...prev, threads: nextThreads }
      })
    })

    const unsubInline = window.arko.onInlineWriteRequested((target) => {
      setInlineWriteTarget(target)
    })

    const unsubQuoted = window.arko.onSelectionQuoted((payload) => {
      setQuotedSelection(payload)
    })

    const unsubFind = window.arko.onFindInPageResult((payload) => {
      setFindMatchInfo(payload)
    })

    const unsubExtDrag = window.arko.onExternalLinkDrag((payload) => {
      setExternalDragLink(payload)
    })

    const clearExtDrag = (): void => setExternalDragLink(null)
    window.addEventListener('drop', clearExtDrag)
    window.addEventListener('dragend', clearExtDrag)

    return () => {
      mounted = false
      unsubState()
      unsubUpdate()
      unsubStream()
      unsubInline()
      unsubQuoted()
      unsubFind()
      unsubExtDrag()
      window.removeEventListener('drop', clearExtDrag)
      window.removeEventListener('dragend', clearExtDrag)
      for (const timerRef of [
        toastLeaveTimerRef,
        toastClearTimerRef,
        peekEnterTimerRef,
        peekLeaveTimerRef,
        spaceHudTimerRef,
        spaceHudOutTimerRef,
        pillSwipeResetTimerRef
      ]) {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current)
          timerRef.current = null
        }
      }
    }
  }, [])

  const lang = state?.settings.language

  const handleOpenReader = useCallback(async () => {
    const res = await window.arko.extractReaderArticle()
    if (!res.ok) {
      showToast(
        res.error || tr(lang, 'Reader View is unavailable on this page', '当前页面不支持沉浸阅读视图')
      )
      return
    }
    setReaderArticle(res)
  }, [showToast, lang])

  // Close peek sidebar automatically whenever pinned sidebar expands or layout switches
  useEffect(() => {
    if (!state?.settings.sidebarCollapsed || state?.settings.layoutMode !== 'vertical') {
      setSidebarPeekOpen(false)
    }
  }, [state?.settings.sidebarCollapsed, state?.settings.layoutMode])

  // Subscribe to Main Process global shortcuts
  useEffect(() => {
    const unsubShortcut = window.arko.onShortcut((cmd) => {
      if (cmd === 'new-tab') {
        setOmniboxMode('new-tab')
        setOmniboxOpen(true)
        setOmniboxFocusSeq((n) => n + 1)
      } else if (cmd === 'focus-omnibox') {
        setOmniboxMode('current-tab')
        setOmniboxOpen(true)
        setOmniboxFocusSeq((n) => n + 1)
      } else if (cmd === 'open-settings') {
        setSettingsInitialTab('ai')
        setSettingsOpen((v) => !v)
      } else if (cmd === 'open-account-settings') {
        setSettingsInitialTab('account')
        setSettingsOpen(true)
      } else if (cmd === 'open-connect-tools') {
        setConnectToolsOpen(true)
      } else if (cmd === 'open-import-data') {
        setSettingsOpen(false)
        setImportModalMode('standalone')
      } else if (cmd === 'open-skills-editor') {
        setSettingsInitialTab('skills')
        setSettingsOpen(true)
      } else if (cmd === 'open-memory-settings') {
        setSettingsInitialTab('memory')
        setSettingsOpen(true)
      } else if (cmd === 'open-general-settings') {
        setSettingsInitialTab('general')
        setSettingsOpen(true)
      } else if (cmd === 'check-for-updates') {
        setSettingsInitialTab('updates')
        setSettingsOpen(true)
      } else if (cmd === 'toggle-reader-view') {
        setReaderArticle((cur) => {
          if (cur) return null
          void handleOpenReader()
          return null
        })
      } else if (cmd === 'reopen-closed-tab') {
        showToast(tr(lang, '↩️ Reopened closed tab', '↩️ 已恢复刚关闭的标签页'))
      } else if (cmd === 'find-in-page') {
        setFindBarOpen(true)
        setTimeout(() => findInputRef.current?.focus(), 40)
      } else if (cmd === 'switch-profile-prev') {
        pendingSpaceDirRef.current = 'left'
      } else if (cmd === 'switch-profile-next') {
        pendingSpaceDirRef.current = 'right'
      } else if (cmd === 'bookmark-page') {
        setState((cur) => {
          const tab = cur?.tabs.find((t) => t.id === cur.activeTabId)
          if (tab && !isInternalArkoUrl(tab.url)) {
            void window.arko.toggleBookmark(tab.url, tab.title, tab.favicon).then((added) => {
              showToast(
                added
                  ? tr(cur?.settings.language, '★ Bookmarked page', '★ 已加入收藏夹')
                  : tr(cur?.settings.language, 'Removed bookmark', '已从收藏夹移除')
              )
            })
          }
          return cur
        })
      }
    })
    return unsubShortcut
  }, [showToast, handleOpenReader, lang])

  // Stay active across the entire animated lifecycle (including 130ms exit animation!)
  const anyOverlayOpen =
    omniboxAnim.mounted ||
    settingsAnim.mounted ||
    connectToolsAnim.mounted ||
    Boolean(importModalAnim.rendered) ||
    libraryAnim.mounted ||
    downloadsAnim.mounted ||
    Boolean(readerAnim.rendered) ||
    Boolean(tabMenuAnim.rendered) ||
    Boolean(spacePopoverAnim.rendered) ||
    Boolean(inlineWriteAnim.rendered) ||
    peekSidebarAnim.mounted ||
    draggingSplit ||
    draggingSidebarSash ||
    draggingAiSash ||
    Boolean(draggingTabId)

  // Zero-flash WebContentsView snapshot handoff
  useEffect(() => {
    let cancelled = false
    let rafId: number | null = null
    if (anyOverlayOpen) {
      void window.arko.setOverlayActive(true).then((snaps) => {
        if (!cancelled && (snaps.primary || snaps.secondary)) {
          setSnapshots(snaps)
        }
      })
    } else {
      void window.arko.setOverlayActive(false).then(() => {
        if (cancelled) return
        // Wait one animation frame after native WebContentsView becomes visible before clearing img
        rafId = window.requestAnimationFrame(() => {
          if (!cancelled) {
            setSnapshots({ primary: null, secondary: null })
          }
        })
      })
    }
    return () => {
      cancelled = true
      if (rafId !== null) window.cancelAnimationFrame(rafId)
    }
  }, [anyOverlayOpen])

  const syncBounds = useCallback(() => {
    if (!hasStateRef.current) return
    if (splitEnabledRef.current) {
      const leftEl = leftViewportRef.current
      const rightEl = rightViewportRef.current
      if (!leftEl || !rightEl) return
      const lRect = leftEl.getBoundingClientRect()
      const rRect = rightEl.getBoundingClientRect()
      const lx = Math.round(lRect.left)
      const ly = Math.round(lRect.top)
      const lw = Math.round(lRect.width)
      const lh = Math.round(lRect.height)
      const rx = Math.round(rRect.left)
      const ry = Math.round(rRect.top)
      const rw = Math.round(rRect.width)
      const rh = Math.round(rRect.height)
      const key = `split:${lx},${ly},${lw},${lh}|${rx},${ry},${rw},${rh}`
      if (lastSentBoundsKeyRef.current === key) return
      lastSentBoundsKeyRef.current = key
      void window.arko.updateViewportBounds({
        primary: { x: lx, y: ly, width: lw, height: lh },
        secondary: { x: rx, y: ry, width: rw, height: rh }
      })
    } else {
      const el = singleViewportRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = Math.round(rect.left)
      const y = Math.round(rect.top)
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      const key = `single:${x},${y},${width},${height}`
      if (lastSentBoundsKeyRef.current === key) return
      lastSentBoundsKeyRef.current = key
      void window.arko.updateViewportBounds({
        primary: { x, y, width, height },
        secondary: null
      })
    }
  }, [])

  const hasLoadedState = Boolean(state)

  useEffect(() => {
    if (!hasLoadedState) return
    lastSentBoundsKeyRef.current = ''
    syncBounds()
    const observer = new ResizeObserver(() => syncBounds())
    if (singleViewportRef.current) observer.observe(singleViewportRef.current)
    if (leftViewportRef.current) observer.observe(leftViewportRef.current)
    if (rightViewportRef.current) observer.observe(rightViewportRef.current)
    window.addEventListener('resize', syncBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
    }
  }, [hasLoadedState, state?.splitView.enabled, syncBounds])

  useEffect(() => {
    syncBounds()
  }, [
    syncBounds,
    state?.settings.layoutMode,
    state?.settings.sidebarCollapsed,
    state?.settings.compactTopBar,
    state?.aiSidebarOpen,
    aiSidebarAnim.mounted,
    state?.activeTabId,
    state?.splitView.leftTabId,
    state?.splitView.rightTabId,
    state?.splitView.ratio,
    liveSplitRatio,
    sidebarWidth,
    aiWidth,
    findBarOpen
  ])

  // High-frame-rate bounds tracking ONLY during sidebar collapse/expand & AI sidebar slide animations
  useEffect(() => {
    let rafId = 0
    const start = performance.now()
    const tick = (now: number): void => {
      syncBounds()
      if (now - start < 300) {
        rafId = window.requestAnimationFrame(tick)
      }
    }
    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [state?.settings.sidebarCollapsed, state?.settings.layoutMode, state?.aiSidebarOpen, syncBounds])

  const [prefersDark, setPrefersDark] = useState<boolean>(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  )

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = (e: MediaQueryListEvent): void => setPrefersDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!state) return
    const prevId = prevProfileIdRef.current
    if (!prevId) {
      prevProfileIdRef.current = state.activeProfileId
      return
    }
    if (prevId === state.activeProfileId) return

    const prevIdx = state.profiles.findIndex((p) => p.id === prevId)
    const nextIdx = state.profiles.findIndex((p) => p.id === state.activeProfileId)
    const nextProfile = state.profiles[nextIdx] || state.profiles[0]
    const inferredDir: 'left' | 'right' =
      pendingSpaceDirRef.current ?? (nextIdx >= prevIdx ? 'right' : 'left')

    pendingSpaceDirRef.current = null
    prevProfileIdRef.current = state.activeProfileId

    if (nextProfile) {
      setSpaceHudLeaving(false)
      setSpaceSwitchHud({
        profile: nextProfile,
        dir: inferredDir,
        seq: Date.now()
      })
      if (spaceHudTimerRef.current !== null) window.clearTimeout(spaceHudTimerRef.current)
      if (spaceHudOutTimerRef.current !== null) window.clearTimeout(spaceHudOutTimerRef.current)

      spaceHudTimerRef.current = window.setTimeout(() => {
        setSpaceHudLeaving(true)
      }, 980)
      spaceHudOutTimerRef.current = window.setTimeout(() => {
        setSpaceSwitchHud(null)
        setSpaceHudLeaving(false)
      }, 1150)
    }
  }, [state])

  if (!state) {
    return <div className="w-full h-full bg-[#19191B]" />
  }

  const isDark =
    state.settings.theme === 'dark' ||
    (state.settings.theme === 'system' && prefersDark)

  const activeProfile =
    state.profiles.find((p) => p.id === state.activeProfileId) || state.profiles[0]
  const activeSpaceTheme = getArcSpaceTheme(activeProfile.accentColor, isDark)
  const hudSpaceTheme = spaceSwitchHud
    ? getArcSpaceTheme(spaceSwitchHud.profile.accentColor, isDark)
    : null
  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) || state.tabs[0]
  const isInternalActive = !activeTab || isInternalArkoUrl(activeTab.url)

  const splitView = state.splitView
  const effectiveRatio = liveSplitRatio ?? splitView.ratio ?? 0.5
  const leftSplitTab = splitView.leftTabId
    ? state.tabs.find((t) => t.id === splitView.leftTabId)
    : undefined
  const rightSplitTab = splitView.rightTabId
    ? state.tabs.find((t) => t.id === splitView.rightTabId)
    : undefined

  const enabledMemoryCount = state.memories.filter((m) => m.enabled).length
  const connectedChromeTools = (state.connectedTools || []).filter(
    (t) => t.status !== 'disconnected'
  )
  const currentUpdateState = updateState ?? state.updateState

  const isVertical = state.settings.layoutMode === 'vertical'
  const isSidebarCollapsed = Boolean(state.settings.sidebarCollapsed)

  const handleUpdateSettings = async (partial: Partial<AppSettings>): Promise<AppSettings> => {
    return await window.arko.updateSettings(partial)
  }

  const handleToggleLanguage = (): void => {
    const nextLang = state.settings.language === 'zh-CN' ? 'en' : 'zh-CN'
    void handleUpdateSettings({ language: nextLang }).then(() => {
      showToast(nextLang === 'zh-CN' ? '🌐 已切换为简体中文' : '🌐 Switched to English')
    })
  }

  const handleOpenSettingsAt = (tabId: SettingsTabId = 'ai'): void => {
    setSettingsInitialTab(tabId)
    setSettingsOpen(true)
  }

  const handleOrganizeTabs = async (): Promise<void> => {
    if (organizingTabs) return
    setOrganizingTabs(true)
    const res = await window.arko.organizeTabsByAI()
    setOrganizingTabs(false)
    if (res.ok) {
      showToast(
        tr(
          lang,
          `🗂️ Organized tabs into ${res.groupCount} topic groups`,
          `🗂️ 已智能整理为 ${res.groupCount} 个主题标签分组`
        )
      )
    } else {
      showToast(
        res.error || tr(lang, 'Open at least 2 web tabs to group', '标签页数量不足以分组')
      )
    }
  }

  const handleAskAIFromNewTab = async (
    prompt: string,
    mentions: ChatMention[] = [],
    targetTabId?: string
  ): Promise<void> => {
    const newThread = await window.arko.createThread()
    setActiveThreadId(newThread.id)
    const chatUrl = makeChatTabUrl(newThread.id)
    await window.arko.navigate(chatUrl, targetTabId)
    await window.arko.sendChatMessage({
      threadId: newThread.id,
      prompt,
      mentions,
      includeActiveTab: true
    })
  }

  const handleAskAIFromBar = async (
    prompt: string,
    includeAllTabs = false,
    extraMentions: ChatMention[] = []
  ): Promise<void> => {
    const mentions: ChatMention[] = [...extraMentions]
    if (includeAllTabs && !mentions.some((m) => m.type === 'all-tabs')) {
      mentions.push({ type: 'all-tabs', title: tr(lang, 'All Open Tabs', '全部打开标签页') })
    }

    if (activeTab && activeTab.url === NEW_TAB_URL) {
      await handleAskAIFromNewTab(prompt, mentions, activeTab.id)
      return
    }

    if (activeTab && isChatTabUrl(activeTab.url)) {
      const tid = getChatThreadIdFromUrl(activeTab.url)
      if (tid) {
        await window.arko.sendChatMessage({
          threadId: tid,
          prompt,
          mentions,
          includeActiveTab: true
        })
        return
      }
    }

    await window.arko.setAISidebarOpen(true)
    let targetThread: ChatThread | undefined = state.threads[0]
    if (!targetThread) {
      targetThread = await window.arko.createThread()
    }
    setActiveThreadId(targetThread.id)

    await window.arko.sendChatMessage({
      threadId: targetThread.id,
      prompt,
      mentions,
      includeActiveTab: true
    })
  }

  const handleToggleSplitView = (): void => {
    if (splitView.enabled) {
      void window.arko.closeSplitView()
      showToast(tr(lang, 'Exited Split View', '已退出左右分屏'))
    } else {
      void window.arko.openSplitView()
      showToast(
        tr(
          lang,
          '◫ Split View enabled — compare pages or browse alongside AI chat',
          '◫ 已开启左右并排分屏（右侧可选择网页或对话标签并排对照）'
        )
      )
    }
  }

  const handleOpenTabInSplit = (tabId: string): void => {
    void window.arko.openSplitView(tabId)
  }

  const handleOpenInlineWrite = async (): Promise<void> => {
    const target = await window.arko.inspectInlineWriteTarget()
    if (target) {
      setInlineWriteTarget(target)
    }
  }

  const handleApplyInlineText = async (
    tabId: string,
    text: string,
    mode: 'replace-or-insert' | 'replace-all' | 'append'
  ): Promise<void> => {
    setInlineWriteTarget(null)
    await window.arko.setOverlayActive(false)
    const ok = await window.arko.applyInlineWriteResult({ tabId, text, mode })
    if (ok) {
      showToast(tr(lang, '✓ Inserted at webpage cursor', '✓ 已注入回网页输入框光标处'))
    } else {
      await navigator.clipboard.writeText(text)
      showToast(
        tr(
          lang,
          'Copied to clipboard — press ⌘V to paste',
          '已复制结果到剪贴板，可直接 ⌘V 粘贴'
        )
      )
    }
  }

  const handleApplyFormFills = async (
    tabId: string,
    fills: Array<{ fieldId: string; value: string }>
  ): Promise<void> => {
    setInlineWriteTarget(null)
    await window.arko.setOverlayActive(false)
    const res = await window.arko.applyFormFillValues({ tabId, fills })
    if (res.ok) {
      showToast(
        tr(
          lang,
          `✓ Filled ${res.appliedCount} webpage form field(s)`,
          `✓ 已成功回填 ${res.appliedCount} 个网页表单字段`
        )
      )
    } else {
      showToast(
        tr(
          lang,
          'Could not write to target form fields',
          '未能写入目标表单字段，请确认表单仍处于打开状态'
        )
      )
    }
  }

  const handleStartSplitResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const container = splitContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.width < 200) return

    setDraggingSplit(true)
    let latestRatio = effectiveRatio

    const onMove = (moveEvt: MouseEvent): void => {
      const raw = (moveEvt.clientX - rect.left) / rect.width
      latestRatio = Math.max(0.24, Math.min(0.76, raw))
      setLiveSplitRatio(latestRatio)
    }

    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDraggingSplit(false)
      setLiveSplitRatio(null)
      void window.arko.setSplitRatio(latestRatio)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleToggleBookmarkCurrent = (): void => {
    if (!activeTab || isInternalArkoUrl(activeTab.url)) return
    void window.arko.toggleBookmark(activeTab.url, activeTab.title, activeTab.favicon).then((added) => {
      showToast(
        added
          ? tr(lang, '★ Bookmarked current page', '★ 已收藏当前网页')
          : tr(lang, 'Removed bookmark', '已取消收藏')
      )
    })
  }

  const handleSwitchOrOpenUrl = (url: string, openInSplit = false): void => {
    const existing = state.tabs.find((t) => t.url === url)
    if (openInSplit) {
      if (existing) {
        void window.arko.openSplitView(existing.id)
      } else {
        void window.arko.createTab(url, { background: true }).then((newId) => {
          void window.arko.openSplitView(newId)
        })
      }
      return
    }
    if (existing) {
      void window.arko.switchTab(existing.id)
    } else {
      void window.arko.createTab(url)
    }
  }

  const handleOpenOmniboxNewTab = (): void => {
    setOmniboxMode('new-tab')
    setOmniboxOpen(true)
    setOmniboxFocusSeq((n) => n + 1)
  }

  const handleOpenOmniboxCurrentTab = (): void => {
    setOmniboxMode('current-tab')
    setOmniboxOpen(true)
    setOmniboxFocusSeq((n) => n + 1)
  }

  const handleOpenInputInNewTab = (input: string): void => {
    if (
      activeTab &&
      activeTab.url === NEW_TAB_URL &&
      !activeTab.isPinned &&
      !activeTab.isFavorite
    ) {
      void window.arko.navigate(input, activeTab.id)
    } else {
      void window.arko.createTab(input)
    }
  }

  const handleAskAIFromOmnibox = async (
    prompt: string,
    openInNewTab = false,
    extraMentions: ChatMention[] = []
  ): Promise<void> => {
    const trimmed = prompt.trim()
    if (!trimmed && extraMentions.length === 0) return

    if (trimmed === '/organize') {
      await handleOrganizeTabs()
      return
    }
    if (
      trimmed === '/markdown' ||
      trimmed.startsWith('/markdown ') ||
      trimmed === '/screenshot' ||
      trimmed.startsWith('/screenshot ')
    ) {
      await handleAskAIFromBar(trimmed, false, extraMentions)
      return
    }

    if (!openInNewTab) {
      await handleAskAIFromBar(trimmed, false, extraMentions)
      return
    }

    const mentions: ChatMention[] = [...extraMentions]
    if (trimmed.startsWith('/')) {
      const cmdToken = trimmed.split(/\s+/)[0].toLowerCase()
      const matchedSkill = getAllSlashSkills(state.settings.customSkills, lang).find(
        (s) => s.command.toLowerCase() === cmdToken
      )
      if (matchedSkill?.includeAllTabs || matchedSkill?.contextScope === 'all-tabs') {
        if (!mentions.some((m) => m.type === 'all-tabs')) {
          mentions.push({
            type: 'all-tabs',
            title: tr(lang, 'All Open Tabs', '全部打开标签页')
          })
        }
      } else if (
        matchedSkill?.contextScope === 'active' &&
        activeTab &&
        !isInternalArkoUrl(activeTab.url) &&
        !mentions.some((m) => m.type === 'tab' && m.tabId === activeTab.id)
      ) {
        mentions.push({
          type: 'tab',
          tabId: activeTab.id,
          title: activeTab.title || activeTab.url,
          url: activeTab.url,
          favicon: activeTab.favicon
        })
      }
    }

    if (
      activeTab &&
      activeTab.url === NEW_TAB_URL &&
      !activeTab.isPinned &&
      !activeTab.isFavorite
    ) {
      await handleAskAIFromNewTab(trimmed, mentions, activeTab.id)
      return
    }

    const newThread = await window.arko.createThread()
    setActiveThreadId(newThread.id)
    await window.arko.createTab(makeChatTabUrl(newThread.id))
    await window.arko.sendChatMessage({
      threadId: newThread.id,
      prompt: trimmed,
      mentions,
      includeActiveTab: false
    })
  }

  const handleDropExternalUrl = (
    url: string,
    zone: TabPinMode,
    insertBeforeTabId?: string | null,
    groupId?: string | null
  ): void => {
    setExternalDragLink(null)
    void window.arko.createTab(url, {
      favorite: zone === 'favorite',
      pinned: zone === 'favorite' || zone === 'pinned',
      insertBeforeTabId,
      groupId
    })
    if (zone === 'favorite') {
      showToast(tr(lang, '📌 Pinned link to Top Favorites', '📌 已将链接固定到顶部常驻栏'))
    } else if (zone === 'pinned') {
      showToast(tr(lang, '📌 Pinned link to Space', '📌 已将链接固定到当前空间'))
    }
  }

  const handleJumpCitationTitle = (titleQuery: string): void => {
    const q = titleQuery.toLowerCase().trim()
    const matched = state.tabs.find(
      (t) =>
        !isInternalArkoUrl(t.url) &&
        (t.title.toLowerCase().includes(q) || q.includes(t.title.toLowerCase().slice(0, 12)))
    )
    if (matched) {
      void window.arko.switchTab(matched.id)
    }
  }

  const handleSaveMemoryQuick = (text: string): void => {
    void window.arko.addMemory(text, 'fact', tr(lang, 'Chat Excerpt', '对话摘录')).then(() => {
      showToast(tr(lang, '📌 Saved to Arko Personal Memory', '📌 已存入 Arko 长期记忆库'))
    })
  }

  const handleTrySkillFromSettings = (command: string): void => {
    if (command === '/organize') {
      void handleOrganizeTabs()
      return
    }
    if (command === '/markdown' || command === '/screenshot') {
      void handleAskAIFromBar(command)
      return
    }
    void window.arko.setAISidebarOpen(true)
    setPendingSkillCmd(command)
  }

  const handleClearUnpinnedForSpace = (pid: string): void => {
    void window.arko.clearUnpinnedTabs(pid).then((count) => {
      if (count > 0) {
        showToast(
          tr(
            lang,
            `Cleared ${count} unpinned tab(s) (⇧⌘T to undo)`,
            `已清理 ${count} 个临时标签页（⇧⌘T 恢复）`
          )
        )
      }
    })
  }

  const renderViewportPaneContent = (
    paneTab: TabState | undefined,
    snapshotUrl: string | null,
    options?: {
      isSplitPane?: boolean
      otherSplitTabId?: string
      paneSide?: 'left' | 'right'
    }
  ): React.ReactNode => {
    if (!paneTab || paneTab.url === NEW_TAB_URL) {
      return (
        <NewTabView
          key={paneTab?.id || 'newtab'}
          isDark={isDark}
          activeProfile={activeProfile}
          settings={state.settings}
          bookmarks={state.bookmarks}
          openTabs={state.tabs}
          recentThreads={state.threads}
          memoryCount={enabledMemoryCount}
          connectedTools={state.connectedTools}
          accountState={state.accountState}
          isSplitPane={options?.isSplitPane}
          splitCandidateTabs={
            options?.isSplitPane
              ? state.tabs.filter(
                  (t) =>
                    t.id !== paneTab?.id &&
                    t.id !== options.otherSplitTabId &&
                    t.url !== NEW_TAB_URL
                )
              : []
          }
          onPickSplitTab={
            options?.isSplitPane
              ? (tid) => {
                  if (options.paneSide === 'left') {
                    void window.arko.setSplitActivePane('left').then(() => {
                      void window.arko.switchTab(tid)
                    })
                  } else {
                    void window.arko.openSplitView(tid)
                  }
                }
              : undefined
          }
          onNavigate={(q) => void window.arko.navigate(q, paneTab?.id)}
          onAskAI={(prompt, mentions) =>
            void handleAskAIFromNewTab(prompt, mentions, paneTab?.id)
          }
          onOpenChatThreadAsTab={(threadId) => {
            if (paneTab) {
              void window.arko.navigate(makeChatTabUrl(threadId), paneTab.id)
            } else {
              void window.arko.openChatAsTab(threadId)
            }
          }}
          onOrganizeTabs={() => void handleOrganizeTabs()}
          onOpenSettings={() => handleOpenSettingsAt('ai')}
          onOpenAccount={() => handleOpenSettingsAt('account')}
          onOpenConnectTools={() => setConnectToolsOpen(true)}
          onOpenSkillsEditor={() => handleOpenSettingsAt('skills')}
          onToggleLanguage={handleToggleLanguage}
        />
      )
    }

    if (isChatTabUrl(paneTab.url)) {
      const chatTid = getChatThreadIdFromUrl(paneTab.url)
      const threadObj = chatTid
        ? state.threads.find((th) => th.id === chatTid)
        : state.threads[0]

      return (
        <ChatTabView
          isDark={isDark}
          tabId={paneTab.id}
          thread={threadObj}
          threads={state.threads}
          tabs={state.tabs}
          splitView={splitView}
          settings={state.settings}
          memoryCount={enabledMemoryCount}
          connectedTools={state.connectedTools}
          quotedSelection={quotedSelection}
          onClearQuotedSelection={() => setQuotedSelection(null)}
          onSelectThreadInTab={(tid) => void window.arko.navigate(makeChatTabUrl(tid), paneTab.id)}
          onNewChatTab={async () => {
            const created = await window.arko.createThread()
            setActiveThreadId(created.id)
            await window.arko.navigate(makeChatTabUrl(created.id), paneTab.id)
          }}
          onDeleteThread={(tid) => void window.arko.deleteThread(tid)}
          onDockToSidebar={() => {
            if (threadObj) {
              setActiveThreadId(threadObj.id)
              void window.arko.dockChatTabToSidebar(paneTab.id, threadObj.id)
            }
          }}
          onUpdateSettings={(p) => void handleUpdateSettings(p)}
          onSendMessage={(params) => window.arko.sendChatMessage(params)}
          onEditUserMessage={(tid, mid, text) =>
            void window.arko.editAndResendUserMessage({
              threadId: tid,
              messageId: mid,
              newPrompt: text
            })
          }
          onCaptureVisionSnapshot={() => window.arko.captureActiveTabScreenshot()}
          onShowToast={showToast}
          onRegenerate={(tid) => void window.arko.regenerateLastReply(tid)}
          onAbortStream={(tid) => void window.arko.abortChatStream(tid)}
          onSaveMemory={handleSaveMemoryQuick}
          onSwitchToTabUrl={handleSwitchOrOpenUrl}
          onJumpCitationTitle={handleJumpCitationTitle}
          onOpenSettings={() => handleOpenSettingsAt('ai')}
          onOpenAccount={() => handleOpenSettingsAt('account')}
          onOpenConnectTools={() => setConnectToolsOpen(true)}
          onOpenSkillsEditor={() => handleOpenSettingsAt('skills')}
        />
      )
    }

    if (snapshotUrl) {
      return (
        <img
          src={snapshotUrl}
          alt=""
          className="w-full h-full object-fill select-none pointer-events-none"
        />
      )
    }

    return null
  }

  const isCurrentBookmarked =
    Boolean(activeTab?.url) &&
    !isInternalArkoUrl(activeTab!.url) &&
    state.bookmarks.some((b) => b.url === activeTab!.url)

  const sharedSidebarProps = {
    platform: state.platform,
    isDark,
    lang,
    width: sidebarWidth,
    isProfileMenuOpen: Boolean(spacePopoverReq),
    onResizeWidth: (w: number, commit?: boolean) => {
      setSidebarWidth(w)
      if (commit) {
        void handleUpdateSettings({ sidebarWidth: w })
      }
    },
    onResizeDragChange: setDraggingSidebarSash,
    updateState: currentUpdateState,
    accountState: state.accountState,
    profiles: state.profiles,
    activeProfile,
    tabs: state.tabs,
    tabGroups: state.tabGroups,
    allTabs: state.allTabs,
    allTabGroups: state.allTabGroups,
    activeTabByProfile: state.activeTabByProfile,
    splitByProfile: state.splitByProfile,
    activeTab,
    splitView,
    bookmarks: state.bookmarks,
    downloads: state.downloads,
    aiSidebarOpen: state.aiSidebarOpen,
    newTabPromptOpen: omniboxOpen && omniboxMode === 'new-tab',
    organizingTabs,
    draggingTabId,
    externalDragLink,
    onDropExternalUrl: handleDropExternalUrl,
    onSwitchLayout: () => void handleUpdateSettings({ layoutMode: 'horizontal' }),
    onSwitchProfile: (pid: string, dir?: 'left' | 'right') => {
      pendingSpaceDirRef.current = dir ?? null
      void window.arko.switchProfile(pid)
    },
    onCreateProfilePrompt: () => {
      setSpacePopoverReq({
        mode: 'create',
        anchor: { x: 18, y: window.innerHeight - 52, placement: 'top-left' }
      })
    },
    onEditProfilePrompt: (p: BrowserProfile) => {
      setSpacePopoverReq({
        mode: 'edit',
        profileId: p.id,
        anchor: { x: sidebarWidth + 6, y: 84, placement: 'right-top' }
      })
    },
    onOpenSpacePopover: (req: SpacePopoverRequest) =>
      setSpacePopoverReq((cur) =>
        cur && cur.mode === 'menu' && req.mode === 'menu' ? null : req
      ),
    onRenameProfileInline: (pid: string, nextName: string) => {
      void window.arko.updateProfile(pid, { name: nextName })
    },
    onSelectTab: (id: string) => {
      void window.arko.switchTab(id)
      setSidebarPeekOpen(false)
    },
    onCloseTab: (id: string) => void window.arko.closeTab(id),
    onSetTabPinState: (id: string, mode: TabPinMode) => void window.arko.setTabPinState(id, mode),
    onResetPinnedTab: (id: string) => {
      void window.arko.resetPinnedTab(id)
      showToast(tr(lang, '↩ Reset to initial pinned URL', '↩ 已还原至初始固定网址'))
    },
    onClearUnpinnedTabs: handleClearUnpinnedForSpace,
    onMoveTabToZone: (id: string, zone: TabPinMode) => void window.arko.moveTabToZone(id, zone),
    onReorderTab: (src: string, dst: string, pos: 'before' | 'after', zone?: TabPinMode) =>
      void window.arko.reorderTab(src, dst, pos, zone),
    onMuteTab: (id: string) => void window.arko.toggleMuteTab(id),
    onTabDragStateChange: (tid: string | null) => {
      setDraggingTabId(tid)
      if (!tid) setSplitDropHover(false)
    },
    onTabContextMenu: (tab: TabState, pos: { x: number; y: number }) =>
      setTabMenuState({ tab, pos }),
    onToggleGroupCollapsed: (gid: string) => void window.arko.toggleTabGroupCollapsed(gid),
    onAssignTabToGroup: (tid: string, gid: string | null) =>
      void window.arko.assignTabToGroup(tid, gid),
    onUpdateTabGroup: (
      gid: string,
      partial: Partial<{ title: string; color: TabGroupColor; collapsed: boolean }>
    ) => void window.arko.updateTabGroup(gid, partial),
    onDeleteTabGroup: (gid: string) => void window.arko.deleteTabGroup(gid),
    onOrganizeTabs: () => void handleOrganizeTabs(),
    onNewTab: handleOpenOmniboxNewTab,
    onToggleSplitView: handleToggleSplitView,
    onOpenTabInSplit: handleOpenTabInSplit,
    onOpenInlineWrite: () => void handleOpenInlineWrite(),
    onOpenReader: () => void handleOpenReader(),
    onBack: () => void window.arko.goBack(),
    onForward: () => void window.arko.goForward(),
    onReload: () => void window.arko.reload(),
    onOpenOmnibox: handleOpenOmniboxCurrentTab,
    onToggleBookmark: handleToggleBookmarkCurrent,
    onOpenLibrary: () => setLibraryOpen(true),
    onOpenDownloads: () => setDownloadsOpen(true),
    onOpenSettings: () => handleOpenSettingsAt('ai'),
    onOpenAccount: () => handleOpenSettingsAt('account'),
    onOpenUpdatePanel: () => handleOpenSettingsAt('updates'),
    onToggleAISidebar: () => void window.arko.setAISidebarOpen(!state.aiSidebarOpen)
  }

  const popoverTargetId = spacePopoverAnim.rendered?.profileId || activeProfile.id
  const popoverUnpinnedCount = state.allTabs.filter(
    (t) =>
      t.profileId === popoverTargetId &&
      !t.isFavorite &&
      !t.isPinned &&
      t.url !== NEW_TAB_URL
  ).length

  return (
    <div
      style={{
        background: `var(--arko-live-shell-bg, ${activeSpaceTheme.sidebarBackground})`,
        transition: 'background 360ms cubic-bezier(0.22, 1, 0.36, 1)'
      }}
      className={`w-full h-full flex flex-col overflow-hidden ${
        isDark ? 'dark text-zinc-100' : 'text-zinc-900'
      }`}
    >
      {/* Horizontal Top Chrome */}
      {state.settings.layoutMode === 'horizontal' && (
        <HorizontalChrome
          platform={state.platform}
          isDark={isDark}
          lang={lang}
          compactTopBar={Boolean(state.settings.compactTopBar)}
          activeProfile={activeProfile}
          tabs={state.tabs}
          tabGroups={state.tabGroups}
          activeTab={activeTab}
          splitView={splitView}
          bookmarks={state.bookmarks}
          downloads={state.downloads}
          aiSidebarOpen={state.aiSidebarOpen}
          omniboxOpen={omniboxAnim.mounted}
          newTabPromptOpen={omniboxOpen && omniboxMode === 'new-tab'}
          organizingTabs={organizingTabs}
          draggingTabId={draggingTabId}
          externalDragLink={externalDragLink}
          updateState={currentUpdateState}
          accountState={state.accountState}
          onSwitchLayout={() =>
            void handleUpdateSettings({ layoutMode: 'vertical', sidebarCollapsed: false })
          }
          onToggleCompactBar={() =>
            void handleUpdateSettings({ compactTopBar: !state.settings.compactTopBar })
          }
          onOpenProfileMenu={(pos, mode = 'menu') =>
            setSpacePopoverReq((cur) =>
              cur
                ? null
                : {
                    mode,
                    profileId: activeProfile.id,
                    anchor: { x: pos.x, y: pos.y, placement: 'bottom-left' }
                  }
            )
          }
          onCycleProfile={(dir) => {
            pendingSpaceDirRef.current = dir === 1 ? 'right' : 'left'
            void window.arko.cycleProfile(dir)
          }}
          onSelectTab={(id) => void window.arko.switchTab(id)}
          onCloseTab={(id) => void window.arko.closeTab(id)}
          onPinTab={(id, pinned) => void window.arko.pinTab(id, pinned)}
          onMoveTabToZone={(id, zone) => void window.arko.moveTabToZone(id, zone)}
          onDropExternalUrl={handleDropExternalUrl}
          onReorderTab={(src, dst, pos, zone) =>
            void window.arko.reorderTab(src, dst, pos, zone)
          }
          onTabDragStateChange={(tid) => {
            setDraggingTabId(tid)
            if (!tid) setSplitDropHover(false)
          }}
          onMuteTab={(id) => void window.arko.toggleMuteTab(id)}
          onTabContextMenu={(tab, pos) => setTabMenuState({ tab, pos })}
          onToggleGroupCollapsed={(gid) => void window.arko.toggleTabGroupCollapsed(gid)}
          onOrganizeTabs={() => void handleOrganizeTabs()}
          onNewTab={handleOpenOmniboxNewTab}
          onToggleSplitView={handleToggleSplitView}
          onOpenTabInSplit={handleOpenTabInSplit}
          onOpenInlineWrite={() => void handleOpenInlineWrite()}
          onOpenReader={() => void handleOpenReader()}
          onResetZoom={() => {
            void window.arko
              .setPageZoom('reset')
              .then(() => showToast(tr(lang, 'Page zoom reset to 100%', '网页缩放已恢复 100%')))
          }}
          onBack={() => void window.arko.goBack()}
          onForward={() => void window.arko.goForward()}
          onReload={() => void window.arko.reload()}
          onOpenOmnibox={handleOpenOmniboxCurrentTab}
          onToggleBookmark={handleToggleBookmarkCurrent}
          onOpenLibrary={() => setLibraryOpen(true)}
          onOpenDownloads={() => setDownloadsOpen(true)}
          onOpenSettings={() => handleOpenSettingsAt('ai')}
          onOpenAccount={() => handleOpenSettingsAt('account')}
          onOpenUpdatePanel={() => handleOpenSettingsAt('updates')}
          onToggleAISidebar={() => void window.arko.setAISidebarOpen(!state.aiSidebarOpen)}
        />
      )}

      {/* Main Workspace Area */}
      <div className="flex-1 flex min-h-0 min-w-0 relative">
        {/* Smooth Animated Docked Left Vertical Sidebar */}
        {isVertical && (
          <div
            style={{
              width: isSidebarCollapsed ? 0 : sidebarWidth,
              opacity: isSidebarCollapsed ? 0 : 1,
              transition: draggingSidebarSash
                ? 'none'
                : 'width 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 190ms ease'
            }}
            className={`shrink-0 h-full overflow-hidden ${
              isSidebarCollapsed ? 'pointer-events-none' : ''
            }`}
          >
            <div
              style={{
                width: sidebarWidth,
                transform: isSidebarCollapsed ? 'translate3d(-14px, 0, 0)' : 'translate3d(0, 0, 0)',
                transition: draggingSidebarSash
                  ? 'none'
                  : 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1)'
              }}
              className="h-full"
            >
              <VerticalSidebar
                {...sharedSidebarProps}
                onCollapseSidebar={() => void handleUpdateSettings({ sidebarCollapsed: true })}
              />
            </div>
          </div>
        )}

        {/* Arc Left-Edge Hover Sensor & Floating Peek Sidebar when Collapsed */}
        {isVertical && isSidebarCollapsed && (
          <>
            <div
              onMouseEnter={() => {
                if (peekLeaveTimerRef.current !== null) {
                  window.clearTimeout(peekLeaveTimerRef.current)
                }
                peekEnterTimerRef.current = window.setTimeout(() => {
                  setSidebarPeekOpen(true)
                }, 75)
              }}
              onMouseLeave={() => {
                if (peekEnterTimerRef.current !== null) {
                  window.clearTimeout(peekEnterTimerRef.current)
                }
              }}
              className="fixed left-0 top-[46px] bottom-3 w-[7px] z-30"
            />

            {peekSidebarAnim.mounted && (
              <div
                onMouseEnter={() => {
                  if (peekLeaveTimerRef.current !== null) {
                    window.clearTimeout(peekLeaveTimerRef.current)
                  }
                }}
                onMouseLeave={() => {
                  if (tabMenuState || spacePopoverReq) return
                  peekLeaveTimerRef.current = window.setTimeout(() => {
                    setSidebarPeekOpen(false)
                  }, 150)
                }}
                style={{
                  transform: peekSidebarAnim.isClosing
                    ? 'translate3d(-106%, 0, 0)'
                    : 'translate3d(0, 0, 0)',
                  opacity: peekSidebarAnim.isClosing ? 0 : 1,
                  transition:
                    'transform 220ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease'
                }}
                className="fixed left-2 top-[46px] bottom-2.5 z-40"
              >
                <VerticalSidebar
                  {...sharedSidebarProps}
                  isPeekOverlay
                  onCollapseSidebar={() => {
                    setSidebarPeekOpen(false)
                    void handleUpdateSettings({ sidebarCollapsed: false })
                  }}
                />
              </div>
            )}
          </>
        )}

        {/* Center Browser Canvas inside Arc Space Frame */}
        <main
          className={`flex-1 flex flex-col min-w-0 min-h-0 transition-[padding] duration-200 ${
            isVertical
              ? `${isSidebarCollapsed ? 'pl-[6px]' : 'pl-0'} ${
                  state.aiSidebarOpen ? 'pr-0' : 'pr-[6px]'
                } pb-[6px]`
              : 'px-[6px] pb-[6px] pt-[5px]'
          }`}
        >
          {/* Dia-Style Unified Top Bar in Vertical Mode */}
          {isVertical && (
            <div
              className={`relative app-drag h-[46px] flex items-center justify-between gap-3 shrink-0 ${
                state.platform === 'darwin' && isSidebarCollapsed
                  ? 'pl-[86px] pr-2.5'
                  : state.platform !== 'darwin' && !state.aiSidebarOpen
                    ? 'pl-2 pr-[142px]'
                    : 'pl-1.5 pr-2.5'
              }`}
            >
              {/* Left Navigation Cluster: (Profile Pill when collapsed) [Sidebar Toggle] [<] [>] [↻] */}
              <div className="app-no-drag flex items-center gap-1 shrink-0">
                {isSidebarCollapsed && (
                  <button
                    type="button"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setSpacePopoverReq((cur) =>
                        cur && cur.mode === 'menu'
                          ? null
                          : {
                              mode: 'menu',
                              profileId: activeProfile.id,
                              anchor: {
                                x: Math.max(8, rect.left - 2),
                                y: rect.bottom + 5,
                                placement: 'bottom-left'
                              }
                            }
                      )
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      const rect = e.currentTarget.getBoundingClientRect()
                      setSpacePopoverReq({
                        mode: 'edit',
                        profileId: activeProfile.id,
                        anchor: {
                          x: Math.max(8, rect.left - 2),
                          y: rect.bottom + 5,
                          placement: 'bottom-left'
                        }
                      })
                    }}
                    onWheel={(e) => {
                      if (pillSwipeResetTimerRef.current !== null) {
                        window.clearTimeout(pillSwipeResetTimerRef.current)
                      }
                      pillSwipeResetTimerRef.current = window.setTimeout(() => {
                        pillSwipeLockedRef.current = false
                      }, 180)
                      if (
                        !pillSwipeLockedRef.current &&
                        Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.4 &&
                        Math.abs(e.deltaX) > 16
                      ) {
                        pillSwipeLockedRef.current = true
                        pendingSpaceDirRef.current = e.deltaX > 0 ? 'right' : 'left'
                        void window.arko.cycleProfile(e.deltaX > 0 ? 1 : -1)
                      }
                    }}
                    title={tr(
                      lang,
                      `${activeProfile.name} — Click to switch Profile · Right-click for Profile Settings`,
                      `${activeProfile.name} — 点击切换个人资料 · 右键打开资料设置`
                    )}
                    className={`dia-liquid-pill arc-pressable mr-1 h-[25px] max-w-[104px] px-2.5 rounded-full flex items-center justify-center text-[12px] font-medium tracking-[-0.01em] leading-none truncate shrink-0 ${
                      spacePopoverReq
                        ? isDark
                          ? 'bg-white/[0.16] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_4px_rgba(0,0,0,0.25)]'
                          : 'bg-white/88 text-zinc-950 shadow-[inset_0_1px_0_#fff,0_0_0_0.5px_rgba(15,23,42,0.08),0_2px_6px_rgba(15,23,42,0.06)]'
                        : isDark
                          ? 'bg-white/[0.075] text-zinc-100/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-white/[0.14] hover:text-white'
                          : 'bg-white/55 text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.90),0_0_0_0.5px_rgba(15,23,42,0.055),0_1px_2px_rgba(15,23,42,0.03)] hover:bg-white/85 hover:text-zinc-950'
                    }`}
                  >
                    <span className="truncate">{activeProfile.name}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    void handleUpdateSettings({ sidebarCollapsed: !isSidebarCollapsed })
                  }
                  title={
                    isSidebarCollapsed
                      ? tr(lang, 'Show Sidebar (⇧⌘S)', '展开侧边栏 (⇧⌘S)')
                      : tr(lang, 'Hide Sidebar (⇧⌘S)', '收起侧边栏 (⇧⌘S)')
                  }
                  className="arc-pressable w-7 h-7 flex items-center justify-center rounded-lg opacity-60 hover:opacity-100 hover:bg-black/[0.055] dark:hover:bg-white/[0.08]"
                >
                  <PanelLeft size={15} />
                </button>

                <button
                  type="button"
                  onClick={() => void window.arko.goBack()}
                  disabled={!activeTab?.canGoBack}
                  title={tr(lang, 'Back (⌘[)', '后退 (⌘[)')}
                  className="arc-pressable w-7 h-7 flex items-center justify-center rounded-lg opacity-55 hover:opacity-100 disabled:opacity-20 hover:bg-black/[0.055] dark:hover:bg-white/[0.08]"
                >
                  <ChevronLeft size={15.5} />
                </button>
                <button
                  type="button"
                  onClick={() => void window.arko.goForward()}
                  disabled={!activeTab?.canGoForward}
                  title={tr(lang, 'Forward (⌘])', '前进 (⌘])')}
                  className="arc-pressable w-7 h-7 flex items-center justify-center rounded-lg opacity-55 hover:opacity-100 disabled:opacity-20 hover:bg-black/[0.055] dark:hover:bg-white/[0.08]"
                >
                  <ChevronRight size={15.5} />
                </button>
                <button
                  type="button"
                  onClick={() => void window.arko.reload()}
                  disabled={!activeTab || isInternalArkoUrl(activeTab.url)}
                  title={tr(lang, 'Reload (⌘R)', '刷新页面 (⌘R)')}
                  className="arc-pressable w-7 h-7 flex items-center justify-center rounded-lg opacity-55 hover:opacity-100 disabled:opacity-20 hover:bg-black/[0.055] dark:hover:bg-white/[0.08]"
                >
                  <RotateCw size={13.5} className={activeTab?.isLoading ? 'animate-spin' : ''} />
                </button>
              </div>

              {/* Center Dia Smart URL Bar (Expands In-Place on Click / ⌘L) */}
              <div
                data-arko-urlbar-anchor="true"
                onClick={handleOpenOmniboxCurrentTab}
                className={`app-no-drag dia-liquid-pill arc-pressable group relative max-w-[600px] flex-1 mx-auto h-[31px] px-3.5 rounded-[11px] border flex items-center gap-2 text-[12.5px] cursor-text overflow-hidden transition-all ${
                  omniboxAnim.mounted ? 'opacity-0 pointer-events-none' : ''
                } ${
                  isDark
                    ? 'bg-white/[0.06] hover:bg-white/[0.10] border-white/[0.08] hover:border-white/[0.15] shadow-[inset_0_1px_0_rgba(255,255,255,0.09)] text-zinc-200'
                    : 'bg-white/58 hover:bg-white/88 border-black/[0.05] hover:border-black/[0.10] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_1px_2px_rgba(15,23,42,0.03)] text-zinc-800'
                }`}
              >
                {activeTab?.isSensitive ? (
                  <ShieldAlert size={12.5} className="text-amber-500 shrink-0" />
                ) : activeTab && isChatTabUrl(activeTab.url) ? (
                  <Sparkles size={12.5} className="opacity-65 shrink-0" />
                ) : activeTab && !isInternalArkoUrl(activeTab.url) ? (
                  <Lock size={11.5} className="opacity-40 shrink-0" />
                ) : (
                  <Search size={12.5} className="opacity-45 shrink-0" />
                )}

                {activeTab && activeTab.url !== NEW_TAB_URL ? (
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className="truncate opacity-85 group-hover:hidden font-medium">
                      {activeTab.title || activeTab.url}
                    </span>
                    <span className="hidden group-hover:inline truncate opacity-90 font-normal">
                      {activeTab.url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')}
                    </span>
                  </div>
                ) : (
                  <span className="truncate flex-1 opacity-45 group-hover:opacity-75">
                    {tr(
                      lang,
                      'Search, enter a URL, or ask anything…',
                      '搜索网页、输入网址，或直接提问…'
                    )}
                  </span>
                )}

                {activeTab && !isInternalArkoUrl(activeTab.url) ? (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="hidden group-hover:flex items-center gap-0.5 pl-1 shrink-0"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(activeTab.url)
                        setCopiedTopUrl(true)
                        window.setTimeout(() => setCopiedTopUrl(false), 1300)
                      }}
                      title={tr(lang, 'Copy URL', '复制网址')}
                      className="p-1 rounded-md opacity-65 hover:opacity-100 hover:bg-black/8 dark:hover:bg-white/10"
                    >
                      {copiedTopUrl ? (
                        <Check size={11.5} className="text-emerald-500" />
                      ) : (
                        <Copy size={11.5} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenReader()}
                      title={tr(lang, 'Reader View (⇧⌘R)', '沉浸阅读视图 (⇧⌘R)')}
                      className="p-1 rounded-md opacity-65 hover:opacity-100 hover:bg-black/8 dark:hover:bg-white/10"
                    >
                      <BookOpen size={11.5} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenInlineWrite()}
                      title={tr(lang, 'Inline Write (⌘J)', '网页内联帮写 (⌘J)')}
                      className="p-1 rounded-md opacity-65 hover:opacity-100 hover:bg-black/8 dark:hover:bg-white/10"
                    >
                      <PenLine size={11.5} />
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleBookmarkCurrent}
                      title={tr(lang, 'Bookmark (⌘D)', '收藏网页 (⌘D)')}
                      className={`p-1 rounded-md hover:bg-black/8 dark:hover:bg-white/10 ${
                        isCurrentBookmarked ? 'text-amber-500 opacity-100' : 'opacity-65 hover:opacity-100'
                      }`}
                    >
                      <Bookmark
                        size={11.5}
                        fill={isCurrentBookmarked ? 'currentColor' : 'none'}
                      />
                    </button>
                  </div>
                ) : (
                  <span className="text-[10.5px] font-mono opacity-40 shrink-0">⌘L</span>
                )}

                {activeTab?.isLoading && <div className="dia-loading-bar" />}
              </div>

              {/* Right utility cluster and Chat pill */}
              <div className="app-no-drag flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setConnectToolsOpen(true)}
                  title={tr(
                    lang,
                    connectedChromeTools.length > 0
                      ? `${connectedChromeTools.length} Connected Tools`
                      : 'Connect Tools',
                    connectedChromeTools.length > 0
                      ? `已连接 ${connectedChromeTools.length} 个常用工具`
                      : '连接常用工具'
                  )}
                  className="arc-pressable p-1.5 rounded-lg opacity-70 hover:opacity-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.07] flex items-center"
                >
                  {connectedChromeTools.length > 0 ? (
                    <span className="flex items-center gap-1">
                      {connectedChromeTools.slice(0, 3).map((t) => (
                        <ToolBrandIcon key={t.id} id={t.id} size={13} />
                      ))}
                    </span>
                  ) : (
                    <Plug size={13.5} />
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleToggleSplitView}
                  title={tr(lang, 'Split View (⌘⇧\\)', '左右分屏 (⌘⇧\\)')}
                  className={`arc-pressable p-1.5 rounded-lg ${
                    splitView.enabled
                      ? 'opacity-100 bg-black/[0.07] dark:bg-white/[0.11]'
                      : 'opacity-55 hover:opacity-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.07]'
                  }`}
                >
                  <Columns2 size={14} />
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenSettingsAt('account')}
                  title={
                    state.accountState?.authenticated && state.accountState.user
                      ? `${state.accountState.user.email || state.accountState.user.username} · ${
                          state.accountState.user.effectiveUnlimited
                            ? '∞'
                            : `$${(state.accountState.user.remainingUsd ?? 0).toFixed(2)}`
                        }`
                      : tr(lang, 'Arko Account (Sign in / Register)', 'Arko 账号（邮箱登录 / 注册）')
                  }
                  className={`arc-pressable relative p-1.5 rounded-lg ${
                    state.accountState?.authenticated
                      ? 'opacity-90 hover:opacity-100 text-indigo-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.07]'
                      : 'opacity-55 hover:opacity-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.07]'
                  }`}
                >
                  <UserRound size={14} />
                  {state.accountState?.authenticated && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => void window.arko.setAISidebarOpen(!state.aiSidebarOpen)}
                  title={tr(lang, 'Toggle Chat Sidebar (⌘E)', '切换右侧对话侧栏 (⌘E)')}
                  className={`dia-liquid-pill arc-pressable h-[28px] px-2.5 rounded-[9px] text-[12px] font-medium flex items-center gap-1.5 border transition ${
                    state.aiSidebarOpen
                      ? isDark
                        ? 'bg-zinc-100 text-zinc-900 border-white/20'
                        : 'bg-zinc-900 text-white border-black/20'
                      : isDark
                        ? 'bg-white/[0.07] hover:bg-white/[0.13] border-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] text-zinc-200'
                        : 'bg-white/65 hover:bg-white/92 border-black/[0.06] shadow-[inset_0_1px_0_#fff,0_1px_2px_rgba(15,23,42,0.035)] text-zinc-800'
                  }`}
                >
                  <MessageSquare size={12} className="fill-current opacity-85" />
                  <span>{tr(lang, 'Chat', '对话')}</span>
                </button>
              </div>
            </div>
          )}

          {/* Optional Find-in-Page Bar (⌘F) */}
          {findBarOpen && !isInternalActive && (
            <div
              className={`arc-bar-enter mb-1.5 h-9 px-3 rounded-xl border flex items-center gap-2 text-xs shrink-0 ${
                isDark
                  ? 'bg-[#232328]/95 border-white/10 text-zinc-100 backdrop-blur-md'
                  : 'bg-white/95 border-black/8 text-zinc-800 shadow-2xs backdrop-blur-md'
              }`}
            >
              <Search size={13} className="opacity-50" />
              <input
                ref={findInputRef}
                value={findText}
                onChange={(e) => {
                  const val = e.target.value
                  setFindText(val)
                  if (val.trim()) {
                    void window.arko.findInPage(val, true)
                  } else {
                    setFindMatchInfo(null)
                    void window.arko.stopFindInPage()
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void window.arko.findInPage(findText, !e.shiftKey)
                  } else if (e.key === 'Escape') {
                    setFindBarOpen(false)
                    setFindMatchInfo(null)
                    void window.arko.stopFindInPage()
                  }
                }}
                placeholder={tr(lang, 'Find in page…', '在页面中查找…')}
                className="flex-1 bg-transparent outline-none"
              />
              {findText.trim() && findMatchInfo && (
                <span
                  className={`px-2 py-0.5 rounded-md font-mono text-[11px] ${
                    findMatchInfo.matches === 0
                      ? 'bg-rose-500/15 text-rose-500 font-medium'
                      : 'opacity-65 bg-black/5 dark:bg-white/8'
                  }`}
                >
                  {findMatchInfo.matches === 0
                    ? tr(lang, 'No matches', '无匹配')
                    : `${findMatchInfo.activeMatchOrdinal} / ${findMatchInfo.matches}`}
                </span>
              )}
              <button
                onClick={() => void window.arko.findInPage(findText, false)}
                className="p-1 rounded hover:bg-black/6 dark:hover:bg-white/10"
                title={tr(lang, 'Previous (⇧Enter)', '上一个 (⇧Enter)')}
              >
                <ChevronUp size={14} />
              </button>
              <button
                onClick={() => void window.arko.findInPage(findText, true)}
                className="p-1 rounded hover:bg-black/6 dark:hover:bg-white/10"
                title={tr(lang, 'Next (Enter)', '下一个 (Enter)')}
              >
                <ChevronDown size={14} />
              </button>
              <button
                onClick={() => {
                  setFindBarOpen(false)
                  setFindMatchInfo(null)
                  void window.arko.stopFindInPage()
                }}
                className="p-1 rounded hover:bg-black/6 dark:hover:bg-white/10"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {splitView.enabled && leftSplitTab && rightSplitTab ? (
            /* ==================== Split View Dual Viewport ==================== */
            <div
              ref={splitContainerRef}
              className="flex-1 flex min-w-0 min-h-0 select-none"
            >
              {/* Left Split Pane */}
              <div
                style={{ width: `calc(${effectiveRatio * 100}% - 5px)` }}
                className="flex flex-col min-w-0 min-h-0"
              >
                <div
                  onClick={() => void window.arko.setSplitActivePane('left')}
                  className={`h-7 mb-1 px-2.5 rounded-lg border flex items-center justify-between gap-2 text-[11px] cursor-pointer transition ${
                    splitView.activePane === 'left'
                      ? isDark
                        ? 'bg-[#25252A]/90 border-white/16 text-zinc-100'
                        : 'bg-white/95 border-black/14 text-zinc-900 shadow-2xs'
                      : isDark
                        ? 'bg-black/25 border-white/6 text-zinc-400 hover:text-zinc-200'
                        : 'bg-white/60 border-black/6 text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        splitView.activePane === 'left'
                          ? isDark
                            ? 'bg-zinc-200'
                            : 'bg-zinc-800'
                          : 'bg-zinc-500/35'
                      }`}
                    />
                    <FaviconIcon url={leftSplitTab.url} favicon={leftSplitTab.favicon} size={12} />
                    <span className="truncate font-medium">
                      {leftSplitTab.title || tr(lang, 'Left Tab', '左侧标签页')}
                    </span>
                  </div>

                  <div
                    className="flex items-center gap-0.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        void window.arko.setSplitActivePane('left')
                        handleOpenOmniboxCurrentTab()
                      }}
                      title={tr(lang, 'Navigate left pane', '导航左侧页面')}
                      className="p-1 rounded hover:bg-black/6 dark:hover:bg-white/10 opacity-65 hover:opacity-100"
                    >
                      <Search size={11} />
                    </button>
                    <button
                      onClick={() => void window.arko.swapSplitPanes()}
                      title={tr(lang, 'Swap left & right panes', '互换左右分屏位置')}
                      className="p-1 rounded hover:bg-black/6 dark:hover:bg-white/10 opacity-65 hover:opacity-100"
                    >
                      <ArrowLeftRight size={11} />
                    </button>
                    <button
                      onClick={() => void window.arko.closeSplitView('right')}
                      title={tr(lang, 'Close left pane (keep right)', '关闭左侧分屏（保留右侧）')}
                      className="p-1 rounded hover:bg-black/6 dark:hover:bg-white/10 opacity-65 hover:opacity-100"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>

                <div
                  ref={leftViewportRef}
                  onMouseDown={() => {
                    if (splitView.activePane !== 'left') {
                      void window.arko.setSplitActivePane('left')
                    }
                  }}
                  className={`relative flex-1 rounded-[10px] overflow-hidden border transition ${
                    splitView.activePane === 'left'
                      ? isDark
                        ? 'bg-[#19191B] border-white/16 shadow-sm'
                        : 'bg-white border-black/14 shadow-sm'
                      : isDark
                        ? 'bg-[#19191B] border-white/8'
                        : 'bg-white border-black/8'
                  }`}
                >
                  {renderViewportPaneContent(leftSplitTab, snapshots.primary, {
                    isSplitPane: true,
                    otherSplitTabId: rightSplitTab.id,
                    paneSide: 'left'
                  })}
                </div>
              </div>

              {/* Center Draggable Splitter Sash */}
              <div
                onMouseDown={handleStartSplitResize}
                onDoubleClick={() => void window.arko.setSplitRatio(0.5)}
                title={tr(
                  lang,
                  'Drag to resize Split View · Double-click for 50:50',
                  '拖拽调节左右分屏宽度 · 双击恢复 50:50'
                )}
                className="w-[10px] shrink-0 flex items-center justify-center cursor-col-resize group"
              >
                <div
                  className={`w-1 h-12 rounded-full transition-all flex items-center justify-center ${
                    draggingSplit
                      ? isDark
                        ? 'bg-zinc-200 h-20'
                        : 'bg-zinc-800 h-20'
                      : isDark
                        ? 'bg-white/14 group-hover:bg-white/40'
                        : 'bg-black/14 group-hover:bg-black/40'
                  }`}
                >
                  <GripVertical size={10} className="opacity-0 group-hover:opacity-70 text-white" />
                </div>
              </div>

              {/* Right Split Pane */}
              <div className="flex-1 flex flex-col min-w-0 min-h-0">
                <div
                  onClick={() => void window.arko.setSplitActivePane('right')}
                  className={`h-7 mb-1 px-2.5 rounded-lg border flex items-center justify-between gap-2 text-[11px] cursor-pointer transition ${
                    splitView.activePane === 'right'
                      ? isDark
                        ? 'bg-[#25252A]/90 border-white/16 text-zinc-100'
                        : 'bg-white/95 border-black/14 text-zinc-900 shadow-2xs'
                      : isDark
                        ? 'bg-black/25 border-white/6 text-zinc-400 hover:text-zinc-200'
                        : 'bg-white/60 border-black/6 text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        splitView.activePane === 'right'
                          ? isDark
                            ? 'bg-zinc-200'
                            : 'bg-zinc-800'
                          : 'bg-zinc-500/35'
                      }`}
                    />
                    <FaviconIcon
                      url={rightSplitTab.url}
                      favicon={rightSplitTab.favicon}
                      size={12}
                    />
                    <span className="truncate font-medium">
                      {rightSplitTab.title || tr(lang, 'Right Tab', '右侧标签页')}
                    </span>
                  </div>

                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!isInternalArkoUrl(leftSplitTab.url) &&
                      !isInternalArkoUrl(rightSplitTab.url) && (
                        <button
                          onClick={() =>
                            void handleAskAIFromBar(
                              tr(
                                lang,
                                'Compare the core content, key differences, and strengths of the two pages open in Split View.',
                                '请详细对比我当前左右分屏中打开的这两个网页的核心内容、关键异同点与各自优势。'
                              )
                            )
                          }
                          title={tr(
                            lang,
                            'Compare both panes with AI',
                            '让 AI 同时读取并对比左右两页'
                          )}
                          className={`px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1 transition ${
                            isDark
                              ? 'bg-white/8 text-zinc-200 hover:bg-white/15'
                              : 'bg-black/6 text-zinc-800 hover:bg-black/10'
                          }`}
                        >
                          <Sparkles size={10} />
                          <span>{tr(lang, 'Compare', '对比双屏')}</span>
                        </button>
                      )}
                    <button
                      onClick={() => {
                        void window.arko.setSplitActivePane('right')
                        handleOpenOmniboxCurrentTab()
                      }}
                      title={tr(lang, 'Navigate right pane', '导航右侧页面')}
                      className="p-1 rounded hover:bg-black/6 dark:hover:bg-white/10 opacity-65 hover:opacity-100"
                    >
                      <Search size={11} />
                    </button>
                    <button
                      onClick={() => void window.arko.closeSplitView('left')}
                      title={tr(lang, 'Close right pane (keep left)', '关闭右侧分屏（保留左侧）')}
                      className="p-1 rounded hover:bg-black/6 dark:hover:bg-white/10 opacity-65 hover:opacity-100"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>

                <div
                  ref={rightViewportRef}
                  onMouseDown={() => {
                    if (splitView.activePane !== 'right') {
                      void window.arko.setSplitActivePane('right')
                    }
                  }}
                  className={`relative flex-1 rounded-[10px] overflow-hidden border transition ${
                    splitView.activePane === 'right'
                      ? isDark
                        ? 'bg-[#19191B] border-white/16 shadow-sm'
                        : 'bg-white border-black/14 shadow-sm'
                      : isDark
                        ? 'bg-[#19191B] border-white/8'
                        : 'bg-white border-black/8'
                  }`}
                >
                  {renderViewportPaneContent(rightSplitTab, snapshots.secondary, {
                    isSplitPane: true,
                    otherSplitTabId: leftSplitTab.id,
                    paneSide: 'right'
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* ==================== Arc Framed Rounded Single Viewport ==================== */
            <div
              ref={singleViewportRef}
              id="browser-viewport"
              className={`relative flex-1 rounded-[10px] overflow-hidden ${
                isDark
                  ? 'bg-[#19191B] ring-1 ring-white/[0.09] shadow-[0_4px_20px_rgba(0,0,0,0.34)]'
                  : 'bg-[#FAFAFB] ring-1 ring-black/[0.075] shadow-[0_2px_14px_rgba(15,23,42,0.07)]'
              }`}
            >
              <div
                key={`vp-${state.activeProfileId}-${spaceSwitchHud?.seq ?? 0}`}
                className={`w-full h-full ${
                  spaceSwitchHud
                    ? spaceSwitchHud.dir === 'right'
                      ? 'dia-space-slide-right'
                      : 'dia-space-slide-left'
                    : ''
                }`}
              >
                {renderViewportPaneContent(activeTab, snapshots.primary)}
              </div>

              {/* Drag-Tab-to-Split-View Right Drop Zone */}
              {draggingTabId && draggingTabId !== activeTab?.id && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setSplitDropHover(true)
                  }}
                  onDragLeave={() => setSplitDropHover(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    const srcId =
                      e.dataTransfer.getData('application/x-dia-tab-id') || draggingTabId
                    setSplitDropHover(false)
                    setDraggingTabId(null)
                    if (srcId && srcId !== activeTab?.id) {
                      void window.arko.openSplitView(srcId)
                      showToast(
                        tr(
                          lang,
                          'Opened tab in Right Split View',
                          '已在右侧并排分屏中打开标签页'
                        )
                      )
                    }
                  }}
                  className={`arc-modal-enter absolute top-3 bottom-3 right-3 w-[44%] rounded-2xl border border-dashed z-30 flex flex-col items-center justify-center gap-2 transition-all backdrop-blur-xs ${
                    splitDropHover
                      ? isDark
                        ? 'bg-white/14 border-white/45 text-zinc-100 scale-[0.99]'
                        : 'bg-black/8 border-black/35 text-zinc-900 scale-[0.99]'
                      : isDark
                        ? 'bg-black/35 border-white/18 text-zinc-300'
                        : 'bg-white/80 border-black/18 text-zinc-700'
                  }`}
                >
                  <Columns2 size={22} className="opacity-80" />
                  <span className="text-xs font-medium">
                    {tr(lang, 'Drop to open in Right Split View', '松开以在右侧并排分屏打开')}
                  </span>
                </div>
              )}
            </div>
          )}
        </main>

        {/* Smooth Sliding Right Docked Arko AI Sidebar (⌘E) */}
        {aiSidebarAnim.mounted && (
          <div
            style={{
              width: state.aiSidebarOpen ? aiWidth : 0,
              opacity: state.aiSidebarOpen ? 1 : 0,
              transition: draggingAiSash
                ? 'none'
                : 'width 250ms cubic-bezier(0.16, 1, 0.3, 1), opacity 190ms ease'
            }}
            className={`shrink-0 h-full overflow-hidden ${
              !state.aiSidebarOpen ? 'pointer-events-none' : ''
            }`}
          >
            <div
              style={{
                width: aiWidth,
                transform: state.aiSidebarOpen ? 'translate3d(0, 0, 0)' : 'translate3d(18px, 0, 0)',
                transition: draggingAiSash
                  ? 'none'
                  : 'transform 250ms cubic-bezier(0.16, 1, 0.3, 1)'
              }}
              className="h-full"
            >
              <AISidebar
                isDark={isDark}
                width={aiWidth}
                onResizeWidth={(w, commit) => {
                  setAiWidth(w)
                  if (commit) {
                    void handleUpdateSettings({ aiSidebarWidth: w })
                  }
                }}
                onResizeDragChange={setDraggingAiSash}
                tabs={state.tabs}
                activeTab={activeTab}
                splitView={splitView}
                threads={state.threads}
                activeThreadId={activeThreadId}
                memoryCount={enabledMemoryCount}
                connectedTools={state.connectedTools}
                quotedSelection={quotedSelection}
                onClearQuotedSelection={() => setQuotedSelection(null)}
                onSelectThread={setActiveThreadId}
                onNewThread={async () => {
                  const th = await window.arko.createThread()
                  setActiveThreadId(th.id)
                  return th
                }}
                onDeleteThread={(tid) => void window.arko.deleteThread(tid)}
                onPopOutToTab={(tid) => {
                  void window.arko.openChatAsTab(tid).then(() => {
                    void window.arko.setAISidebarOpen(false)
                  })
                }}
                settings={state.settings}
                onUpdateSettings={(p) => void handleUpdateSettings(p)}
                onSendMessage={(params) => window.arko.sendChatMessage(params)}
                onEditUserMessage={(tid, mid, text) =>
                  void window.arko.editAndResendUserMessage({
                    threadId: tid,
                    messageId: mid,
                    newPrompt: text
                  })
                }
                onCaptureVisionSnapshot={() => window.arko.captureActiveTabScreenshot()}
                onShowToast={showToast}
                onRegenerate={(tid) => void window.arko.regenerateLastReply(tid)}
                onAbortStream={(tid) => void window.arko.abortChatStream(tid)}
                onSaveMemory={handleSaveMemoryQuick}
                onSwitchToTabUrl={handleSwitchOrOpenUrl}
                onJumpCitationTitle={handleJumpCitationTitle}
                onOpenSettings={() => handleOpenSettingsAt('ai')}
                onOpenAccount={() => handleOpenSettingsAt('account')}
                onOpenConnectTools={() => setConnectToolsOpen(true)}
                onOpenSkillsEditor={() => handleOpenSettingsAt('skills')}
                pendingSkillCommand={pendingSkillCmd}
                onConsumePendingSkill={() => setPendingSkillCmd(null)}
                onClose={() => void window.arko.setAISidebarOpen(false)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Dia-Style Profile Switch Floating HUD Pill */}
      {spaceSwitchHud && hudSpaceTheme && !anyOverlayOpen && (
        <div
          key={spaceSwitchHud.seq}
          style={{
            backgroundColor: isDark ? 'rgba(34, 34, 39, 0.90)' : 'rgba(255, 255, 255, 0.92)',
            borderColor: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)',
            boxShadow: `0 14px 36px -6px rgba(0, 0, 0, ${isDark ? 0.6 : 0.16})`
          }}
          className={`${
            spaceHudLeaving ? 'dia-space-hud-out' : 'dia-space-hud'
          } fixed bottom-6 left-1/2 z-40 px-3.5 py-1.5 rounded-full border backdrop-blur-xl flex items-center gap-2 text-xs font-medium pointer-events-none ${
            isDark ? 'text-zinc-100' : 'text-zinc-800'
          }`}
        >
          <span
            style={{
              backgroundColor: spaceSwitchHud.profile.accentColor || '#52525B',
              boxShadow: isDark
                ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.28)'
                : 'inset 0 0 0 1px rgba(0, 0, 0, 0.14)'
            }}
            className="w-2.5 h-2.5 rounded-full shrink-0"
          />
          <span>{spaceSwitchHud.profile.name}</span>
          <div className="flex items-center gap-1.5 pl-1">
            {state.profiles.map((p) => {
              const isCur = p.id === spaceSwitchHud.profile.id
              return (
                <span
                  key={p.id}
                  className={`rounded-full transition-all duration-200 ${
                    isCur
                      ? isDark
                        ? 'w-[6px] h-[6px] bg-white'
                        : 'w-[6px] h-[6px] bg-zinc-900'
                      : isDark
                        ? 'w-[5px] h-[5px] bg-white/30'
                        : 'w-[5px] h-[5px] bg-black/25'
                  }`}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Calm Animated Toast Pill */}
      {toastState && (
        <div
          key={toastState.seq}
          className={`${
            toastState.leaving ? 'arc-toast-exit' : 'arc-toast-enter'
          } fixed bottom-5 left-1/2 z-50 px-4 py-2 rounded-full text-xs font-medium bg-zinc-900/95 text-white dark:bg-zinc-100/95 dark:text-zinc-900 backdrop-blur-md shadow-xl flex items-center gap-1.5 pointer-events-none`}
        >
          <span>{toastState.msg}</span>
        </div>
      )}

      {/* Dia-Style Floating Profile Menu & Settings Popover */}
      {spacePopoverAnim.rendered && (
        <SpaceEditorPopover
          platform={state.platform}
          isDark={isDark}
          lang={lang}
          isClosing={spacePopoverAnim.isClosing}
          request={spacePopoverAnim.rendered}
          profiles={state.profiles}
          activeProfileId={activeProfile.id}
          unpinnedCount={popoverUnpinnedCount}
          onSwitchProfile={(pid) => void window.arko.switchProfile(pid)}
          onUpdateProfile={(pid, partial) => {
            void window.arko.updateProfile(pid, partial)
          }}
          onCreateProfile={(name, emoji, accentColor) => {
            void window.arko.createProfile(name, emoji, accentColor)
          }}
          onDeleteProfile={(pid) => {
            const target = state.profiles.find((p) => p.id === pid)
            void window.arko.deleteProfile(pid).then((deleted) => {
              if (deleted && target) {
                showToast(
                  tr(
                    lang,
                    `Removed Space "${target.name}"`,
                    `已移除空间「${target.name}」`
                  )
                )
              }
            })
          }}
          onClearUnpinnedTabs={handleClearUnpinnedForSpace}
          onClose={() => setSpacePopoverReq(null)}
        />
      )}

      {/* Rich Tab Right-Click Context Menu */}
      {tabMenuAnim.rendered && (
        <TabContextMenu
          isDark={isDark}
          lang={lang}
          isClosing={tabMenuAnim.isClosing}
          tab={tabMenuAnim.rendered.tab}
          tabGroups={state.allTabGroups.filter(
            (g) => g.profileId === tabMenuAnim.rendered!.tab.profileId
          )}
          position={tabMenuAnim.rendered.pos}
          onOpenInSplit={handleOpenTabInSplit}
          onSetTabPinState={(id, mode) => void window.arko.setTabPinState(id, mode)}
          onResetPinnedTab={(id) => {
            void window.arko.resetPinnedTab(id)
            showToast(tr(lang, '↩ Reset to initial pinned URL', '↩ 已还原至初始固定网址'))
          }}
          onDuplicateTab={(id) => void window.arko.duplicateTab(id)}
          onMuteTab={(id) => void window.arko.toggleMuteTab(id)}
          onAssignGroup={(id, gid) => void window.arko.assignTabToGroup(id, gid)}
          onCreateGroupWithTab={(title: string, color: TabGroupColor, tabId: string) =>
            void window.arko.createTabGroup(title, color, [tabId])
          }
          onCloseOtherTabs={(id) => void window.arko.closeOtherTabs(id)}
          onCloseTab={(id) => void window.arko.closeTab(id)}
          onCloseMenu={() => setTabMenuState(null)}
        />
      )}

      {/* Floating Inline Write & Form Preview Fill Overlay (⌘J) */}
      {inlineWriteAnim.rendered && (
        <InlineWriteOverlay
          isDark={isDark}
          lang={lang}
          isClosing={inlineWriteAnim.isClosing}
          target={inlineWriteAnim.rendered}
          splitViewActive={splitView.enabled}
          activeModelId={state.settings.activeModelId}
          onApplyInlineText={handleApplyInlineText}
          onApplyFormFills={handleApplyFormFills}
          onOpenSettings={() => {
            setInlineWriteTarget(null)
            handleOpenSettingsAt('ai')
          }}
          onClose={() => setInlineWriteTarget(null)}
        />
      )}

      {/* Calm Reader View Modal (⇧⌘R) */}
      {readerAnim.rendered && (
        <ReaderModal
          isDark={isDark}
          lang={lang}
          isClosing={readerAnim.isClosing}
          article={readerAnim.rendered}
          onSummarizeWithAI={() => void handleAskAIFromBar('/summarize')}
          onExportMarkdown={() =>
            void window.arko.executeLocalSkill('/markdown', readerAnim.rendered!.tabId)
          }
          onOpenLink={handleSwitchOrOpenUrl}
          onClose={() => setReaderArticle(null)}
        />
      )}

      {/* Downloads Manager Modal */}
      {downloadsAnim.mounted && (
        <DownloadsModal
          isDark={isDark}
          lang={lang}
          isClosing={downloadsAnim.isClosing}
          downloads={state.downloads}
          onRevealInFinder={(fp) => void window.arko.revealInFinder(fp)}
          onClearCompleted={() => void window.arko.clearCompletedDownloads()}
          onClose={() => setDownloadsOpen(false)}
        />
      )}

      {/* Dia Smart URL Bar Popover (⌘T / ⌘L) */}
      {omniboxAnim.mounted && (
        <CommandOmniboxModal
          key={`${omniboxMode}-${state.activeTabId || 'none'}`}
          mode={omniboxMode}
          focusTrigger={omniboxFocusSeq}
          isDark={isDark}
          lang={lang}
          isClosing={omniboxAnim.isClosing}
          activeTabId={state.activeTabId}
          initialUrl={activeTab?.url}
          memoryCount={enabledMemoryCount}
          connectedTools={state.connectedTools}
          tabs={state.tabs}
          bookmarks={state.bookmarks}
          history={state.history}
          customSkills={state.settings.customSkills}
          onNavigate={(q) => void window.arko.navigate(q)}
          onOpenInNewTab={handleOpenInputInNewTab}
          onSwitchTab={(tid) => void window.arko.switchTab(tid)}
          onOpenTabInSplit={(tid) => void window.arko.openSplitView(tid)}
          onAskAI={(p, inNewTab, mentions) => void handleAskAIFromOmnibox(p, inNewTab, mentions)}
          onOrganizeTabs={() => void handleOrganizeTabs()}
          onShowToast={showToast}
          onClose={() => setOmniboxOpen(false)}
        />
      )}

      {connectToolsAnim.mounted && (
        <ConnectToolsModal
          isDark={isDark}
          lang={lang}
          isClosing={connectToolsAnim.isClosing}
          spaceName={activeProfile.name}
          tools={state.connectedTools || []}
          autoConnectEnabled={state.settings.autoConnectLoggedInApps !== false}
          onConnectTool={async (tid: ConnectedToolId) => {
            const res = await window.arko.connectTool(tid)
            if (res.openedLoginTab) {
              setConnectToolsOpen(false)
              showToast(
                tr(
                  lang,
                  'Sign in on the opened tab — Arko will connect automatically',
                  '请在打开的页面完成登录，Arko 将自动完成连接'
                )
              )
            }
          }}
          onDisconnectTool={async (tid: ConnectedToolId) => {
            await window.arko.disconnectTool(tid)
          }}
          onToggleAutoConnect={async (en: boolean) => {
            await window.arko.setAutoConnectTools(en)
          }}
          onRefresh={async () => {
            await window.arko.getConnectedTools()
          }}
          onClose={() => setConnectToolsOpen(false)}
        />
      )}

      {settingsAnim.mounted && (
        <SettingsModal
          isDark={isDark}
          isClosing={settingsAnim.isClosing}
          initialTab={settingsInitialTab}
          settings={state.settings}
          memories={state.memories}
          connectedTools={state.connectedTools}
          accountState={state.accountState}
          updateState={currentUpdateState}
          onUpdateSettings={handleUpdateSettings}
          onConnectTool={async (tid) => {
            const res = await window.arko.connectTool(tid)
            if (res.openedLoginTab) {
              setSettingsOpen(false)
              showToast(
                tr(
                  lang,
                  'Sign in on the opened tab — Arko will connect automatically',
                  '请在打开的页面完成登录，Arko 将自动完成连接'
                )
              )
            }
          }}
          onDisconnectTool={async (tid) => {
            await window.arko.disconnectTool(tid)
          }}
          onToggleAutoConnectTools={async (en) => {
            await window.arko.setAutoConnectTools(en)
          }}
          onRefreshConnectedTools={async () => {
            await window.arko.getConnectedTools()
          }}
          onAddMemory={async (content, category) => {
            await window.arko.addMemory(content, category, tr(lang, 'Manual', '手动添加'))
          }}
          onToggleMemory={async (id, enabled) => {
            await window.arko.toggleMemory(id, enabled)
          }}
          onDeleteMemory={async (id) => {
            await window.arko.deleteMemory(id)
          }}
          onNavigateInBrowser={(url) => void window.arko.createTab(url)}
          onTrySkill={handleTrySkillFromSettings}
          onOpenBrowserImport={() => {
            setSettingsOpen(false)
            setImportModalMode('standalone')
          }}
          onResetOnboarding={async () => {
            const snap = await window.arko.resetOnboardingState()
            setState(snap)
            setSettingsOpen(false)
            setImportModalMode('onboarding')
          }}
          onCheckUpdates={async () => {
            await window.arko.checkForUpdates(false)
          }}
          onDownloadUpdate={async () => {
            await window.arko.downloadUpdate()
          }}
          onInstallUpdate={async () => {
            const res = await window.arko.installUpdateAndRestart()
            if (!res.ok && res.error) {
              showToast(res.error)
            }
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {libraryAnim.mounted && (
        <LibraryModal
          isDark={isDark}
          lang={lang}
          isClosing={libraryAnim.isClosing}
          bookmarks={state.bookmarks}
          history={state.history}
          onOpenUrl={(url) => void window.arko.createTab(url)}
          onRemoveBookmark={(id) => void window.arko.removeBookmark(id)}
          onClearHistory={() => void window.arko.clearHistory()}
          onClose={() => setLibraryOpen(false)}
        />
      )}

      {importModalAnim.rendered && (
        <OnboardingImportModal
          isDark={isDark}
          isClosing={importModalAnim.isClosing}
          mode={importModalAnim.rendered}
          settings={state.settings}
          onUpdateSettings={handleUpdateSettings}
          onShowToast={showToast}
          onClose={() => setImportModalMode(null)}
        />
      )}
    </div>
  )
}
