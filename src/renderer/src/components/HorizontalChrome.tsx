import React, { useEffect, useState } from 'react'
import {
  ArrowDownCircle,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Columns2,
  Copy,
  Download,
  FolderKanban,
  Link2,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  PanelLeft,
  PenLine,
  Pin,
  Plus,
  RotateCw,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  UserRound,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import {
  isChatTabUrl,
  isInternalArkoUrl,
  NEW_TAB_URL,
  TAB_GROUP_COLOR_STYLES
} from '@shared/constants'
import { tr } from '@shared/i18n'
import { getArcSpaceTheme } from '@shared/space-theme'
import type {
  AppLanguage,
  AppUpdateState,
  ArkoAccountState,
  BookmarkItem,
  BrowserProfile,
  DownloadItemState,
  SplitViewState,
  TabGroup,
  TabPinMode,
  TabState
} from '@shared/types'
import { FaviconIcon } from './FaviconIcon'

interface Props {
  platform?: 'darwin' | 'win32' | 'linux'
  isDark: boolean
  lang?: AppLanguage
  compactTopBar: boolean
  activeProfile: BrowserProfile
  tabs: TabState[]
  tabGroups: TabGroup[]
  activeTab: TabState | undefined
  splitView: SplitViewState
  bookmarks: BookmarkItem[]
  downloads: DownloadItemState[]
  aiSidebarOpen: boolean
  omniboxOpen?: boolean
  newTabPromptOpen?: boolean
  organizingTabs?: boolean
  draggingTabId?: string | null
  externalDragLink?: { url: string; title?: string } | null
  updateState?: AppUpdateState
  accountState?: ArkoAccountState
  onSwitchLayout: () => void
  onToggleCompactBar: () => void
  onOpenProfileMenu: (anchor: { x: number; y: number }) => void
  onCycleProfile?: (direction: 1 | -1) => void
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onPinTab: (tabId: string, pinned: boolean) => void
  onMoveTabToZone?: (tabId: string, targetZone: TabPinMode) => void
  onDropExternalUrl?: (
    url: string,
    zone: TabPinMode,
    insertBeforeTabId?: string | null
  ) => void
  onReorderTab?: (
    sourceTabId: string,
    targetTabId: string,
    position: 'before' | 'after',
    targetZone?: TabPinMode
  ) => void
  onTabDragStateChange?: (draggingTabId: string | null) => void
  onMuteTab: (tabId: string) => void
  onTabContextMenu: (tab: TabState, pos: { x: number; y: number }) => void
  onToggleGroupCollapsed: (groupId: string) => void
  onOrganizeTabs: () => void
  onNewTab: () => void
  onToggleSplitView: () => void
  onOpenTabInSplit: (tabId: string) => void
  onOpenInlineWrite: () => void
  onOpenReader: () => void
  onResetZoom: () => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onOpenOmnibox: () => void
  onToggleBookmark: () => void
  onOpenLibrary: () => void
  onOpenDownloads: () => void
  onOpenSettings: () => void
  onOpenAccount?: () => void
  onOpenUpdatePanel?: () => void
  onToggleAISidebar: () => void
}

function formatCalmSmartBar(
  tab: TabState | undefined,
  lang?: AppLanguage
): {
  domain: string
  cleanTitle: string
  cleanUrl: string
} {
  const url = tab?.url
  if (!url || url === NEW_TAB_URL) {
    return {
      domain: '',
      cleanTitle: tr(
        lang,
        'Search the web, enter a URL, or ask Arko…',
        '搜索网页、输入网址，或直接向 Arko 提问…'
      ),
      cleanUrl: ''
    }
  }
  if (isChatTabUrl(url)) {
    return {
      domain: 'Arko Chat',
      cleanTitle: tab?.title || tr(lang, 'AI Chat Tab', '独立 AI 对话'),
      cleanUrl: url
    }
  }
  try {
    const parsed = new URL(url)
    const domain = parsed.hostname.replace(/^www\./, '') || parsed.protocol
    const pathPart =
      parsed.pathname && parsed.pathname !== '/' ? `${parsed.pathname}${parsed.search}` : ''
    return {
      domain,
      cleanTitle: tab?.title && tab.title !== url ? tab.title : domain,
      cleanUrl: `${domain}${pathPart}`.slice(0, 78)
    }
  } catch {
    return {
      domain: '',
      cleanTitle: tab?.title || url,
      cleanUrl: url
    }
  }
}

export const HorizontalChrome: React.FC<Props> = ({
  platform = 'darwin',
  isDark,
  lang,
  compactTopBar,
  activeProfile,
  tabs,
  tabGroups,
  activeTab,
  splitView,
  bookmarks,
  downloads,
  aiSidebarOpen,
  omniboxOpen,
  newTabPromptOpen,
  organizingTabs,
  draggingTabId,
  externalDragLink,
  updateState,
  accountState,
  onSwitchLayout,
  onToggleCompactBar,
  onOpenProfileMenu,
  onCycleProfile,
  onSelectTab,
  onCloseTab,
  onPinTab,
  onMoveTabToZone,
  onDropExternalUrl,
  onReorderTab,
  onTabDragStateChange,
  onMuteTab,
  onTabContextMenu,
  onToggleGroupCollapsed,
  onOrganizeTabs,
  onNewTab,
  onToggleSplitView,
  onOpenTabInSplit,
  onOpenInlineWrite,
  onOpenReader,
  onResetZoom,
  onBack,
  onForward,
  onReload,
  onOpenOmnibox,
  onToggleBookmark,
  onOpenLibrary,
  onOpenDownloads,
  onOpenSettings,
  onOpenAccount,
  onOpenUpdatePanel,
  onToggleAISidebar
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [dragOverHint, setDragOverHint] = useState<{
    tabId: string
    pos: 'before' | 'after'
  } | null>(null)
  const [pinnedPreviewIndex, setPinnedPreviewIndex] = useState<number | null>(null)
  const [isExternalLinkHovering, setIsExternalLinkHovering] = useState(false)

  useEffect(() => {
    const clear = (): void => {
      setPinnedPreviewIndex(null)
      setIsExternalLinkHovering(false)
      setDragOverHint(null)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  const [lastWheelSwitchAt, setLastWheelSwitchAt] = useState(0)
  const spaceTheme = getArcSpaceTheme(activeProfile.accentColor, isDark)

  const pinnedTabs = tabs.filter((t) => t.isPinned || t.isFavorite)
  const normalTabs = tabs.filter(
    (t) => !t.isPinned && !t.isFavorite && t.url !== NEW_TAB_URL
  )
  const isNewTabActive =
    Boolean(newTabPromptOpen) ||
    Boolean(
      activeTab &&
        activeTab.url === NEW_TAB_URL &&
        !activeTab.isPinned &&
        !activeTab.isFavorite
    )
  const ungroupedWebCount = normalTabs.filter(
    (t) => !t.groupId && !isInternalArkoUrl(t.url)
  ).length

  const isBookmarked =
    Boolean(activeTab?.url) &&
    !isInternalArkoUrl(activeTab!.url) &&
    bookmarks.some((b) => b.url === activeTab!.url)

  const activeDownloads = downloads.filter((d) => d.state === 'progressing').length
  const zoomPct = Math.round((activeTab?.zoomFactor || 1) * 100)
  const { domain, cleanTitle, cleanUrl } = formatCalmSmartBar(activeTab, lang)

  const hasUpdateBadge =
    updateState?.status === 'available' ||
    updateState?.status === 'downloading' ||
    updateState?.status === 'downloaded'

  const renderedGroupIds = new Set<string>()
  const tabStripNodes: React.ReactNode[] = []

  for (const tab of normalTabs) {
    const grp = tab.groupId ? tabGroups.find((g) => g.id === tab.groupId) : undefined
    if (grp && !renderedGroupIds.has(grp.id)) {
      renderedGroupIds.add(grp.id)
      const countInGroup = normalTabs.filter((t) => t.groupId === grp.id).length
      const style = TAB_GROUP_COLOR_STYLES[grp.color]
      tabStripNodes.push(
        <button
          key={`grp-pill-${grp.id}`}
          type="button"
          onClick={() => onToggleGroupCollapsed(grp.id)}
          title={tr(
            lang,
            `${grp.title} (${countInGroup} tabs · Click to collapse/expand)`,
            `${grp.title} (${countInGroup} 个标签 · 点击折叠/展开)`
          )}
          className={`app-no-drag h-[26px] px-2 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1 shrink-0 transition ${style.badgeBg} ${style.badgeText}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
          <span className="max-w-[96px] truncate">{grp.title}</span>
          <span className="opacity-65 text-[10px]">{countInGroup}</span>
          {grp.collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        </button>
      )
    }

    if (grp && grp.collapsed && tab.id !== activeTab?.id) {
      continue
    }

    const isActive = tab.id === activeTab?.id
    const splitRole = splitView.enabled
      ? tab.id === splitView.leftTabId
        ? tr(lang, 'L', '左')
        : tab.id === splitView.rightTabId
          ? tr(lang, 'R', '右')
          : null
      : null

    const dropSide = dragOverHint?.tabId === tab.id ? dragOverHint.pos : null

    tabStripNodes.push(
      <div
        key={tab.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-dia-tab-id', tab.id)
          e.dataTransfer.effectAllowed = 'move'
          const draggedId = tab.id
          window.setTimeout(() => onTabDragStateChange?.(draggedId), 0)
        }}
        onDragEnd={() => {
          setDragOverHint(null)
          onTabDragStateChange?.(null)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          const pos = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
          if (dragOverHint?.tabId !== tab.id || dragOverHint.pos !== pos) {
            setDragOverHint({ tabId: tab.id, pos })
          }
        }}
        onDragLeave={() => {
          if (dragOverHint?.tabId === tab.id) setDragOverHint(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          const srcId = e.dataTransfer.getData('application/x-dia-tab-id')
          const rect = e.currentTarget.getBoundingClientRect()
          const pos = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
          setDragOverHint(null)
          onTabDragStateChange?.(null)
          if (srcId && srcId !== tab.id) {
            onReorderTab?.(srcId, tab.id, pos, 'unpinned')
          }
        }}
        onClick={() => onSelectTab(tab.id)}
        onAuxClick={(e) => {
          if (e.button === 1) onCloseTab(tab.id)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onTabContextMenu(tab, { x: e.clientX, y: e.clientY })
        }}
        style={
          isActive
            ? {
                backgroundColor: spaceTheme.activeTabBg,
                boxShadow: spaceTheme.activeTabShadow
              }
            : undefined
        }
        className={`app-no-drag group relative flex items-center gap-1.5 h-[30px] px-2.5 rounded-lg min-w-[108px] max-w-[215px] text-xs cursor-pointer transition-all ${
          dropSide === 'before'
            ? 'border-l-2 border-l-indigo-500'
            : dropSide === 'after'
              ? 'border-r-2 border-r-indigo-500'
              : ''
        } ${
          isActive
            ? isDark
              ? 'text-white font-medium'
              : 'text-zinc-900 font-medium'
            : splitRole
              ? isDark
                ? 'bg-indigo-500/12 text-indigo-200 ring-1 ring-indigo-500/30'
                : 'bg-indigo-50/80 text-indigo-900 ring-1 ring-indigo-300/60'
              : isDark
                ? 'text-zinc-300/85 hover:bg-white/8 hover:text-white'
                : 'text-zinc-600 hover:bg-white/55 hover:text-zinc-900'
        }`}
      >
        {grp ? (
          <span
            className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full opacity-80"
            style={{ backgroundColor: TAB_GROUP_COLOR_STYLES[grp.color].hex }}
          />
        ) : isActive ? (
          <span
            className="absolute left-2.5 right-2.5 bottom-0 h-[2px] rounded-full opacity-85"
            style={{ backgroundColor: spaceTheme.accentHex }}
          />
        ) : null}

        {tab.isLoading ? (
          <Loader2 size={13} className="animate-spin text-indigo-500 shrink-0" />
        ) : (
          <FaviconIcon url={tab.url} favicon={tab.favicon} size={14} />
        )}

        {splitRole && (
          <span className="px-1 rounded text-[9.5px] font-semibold bg-indigo-500/20 text-indigo-500 shrink-0">
            {splitRole}
          </span>
        )}

        <span className="truncate flex-1">{tab.title || tr(lang, 'New Tab', '新标签页')}</span>

        {tab.isAudioPlaying && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onMuteTab(tab.id)
            }}
            className="opacity-75 hover:opacity-100 p-0.5 rounded"
            title={tab.isMuted ? tr(lang, 'Unmute', '取消静音') : tr(lang, 'Mute tab', '静音此标签页')}
          >
            {tab.isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
          </button>
        )}

        {!splitRole && tab.id !== activeTab?.id && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onOpenTabInSplit(tab.id)
            }}
            title={tr(lang, 'Open in Right Split View', '在右侧分屏中并排打开')}
            className="opacity-0 group-hover:opacity-65 hover:!opacity-100 p-0.5 rounded transition"
          >
            <Columns2 size={11} />
          </button>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation()
            onCloseTab(tab.id)
          }}
          title={tr(lang, 'Close Tab (⌘W)', '关闭标签页 (⌘W)')}
          className={`opacity-0 group-hover:opacity-75 hover:!opacity-100 p-0.5 rounded transition ${
            isActive ? 'opacity-55' : ''
          }`}
        >
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <header
      style={{
        background: spaceTheme.horizontalHeaderBackground,
        borderBottomColor: spaceTheme.sidebarBorderColor,
        transition: 'background 320ms cubic-bezier(0.22, 1, 0.36, 1), border-color 320ms ease'
      }}
      className={`relative shrink-0 select-none border-b ${
        isDark ? 'text-zinc-100' : 'text-zinc-800'
      }`}
    >
      {/* Row 1 */}
      <div
        className={`app-drag h-[39px] flex items-center gap-1.5 ${
          platform === 'darwin' ? 'pl-[78px] pr-2.5' : 'pl-2.5 pr-[142px]'
        }`}
      >
        <button
          onClick={onSwitchLayout}
          title={tr(lang, 'Switch to Arc-style Vertical Sidebar (⌘\\)', '切换为垂直侧边栏标签 (⌘\\)')}
          className={`app-no-drag p-1.5 rounded-lg transition ${
            isDark ? 'hover:bg-white/10 text-zinc-400' : 'hover:bg-black/6 text-zinc-600'
          }`}
        >
          <PanelLeft size={15} />
        </button>

        {compactTopBar && (
          <div className="app-no-drag flex items-center gap-0.5">
            <button
              onClick={onBack}
              disabled={!activeTab?.canGoBack}
              className="p-1 rounded-lg disabled:opacity-25 hover:bg-black/6 dark:hover:bg-white/10"
            >
              <ArrowLeft size={14} />
            </button>
            <button
              onClick={onForward}
              disabled={!activeTab?.canGoForward}
              className="p-1 rounded-lg disabled:opacity-25 hover:bg-black/6 dark:hover:bg-white/10"
            >
              <ArrowRight size={14} />
            </button>
          </div>
        )}

        <button
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            onOpenProfileMenu({ x: rect.left, y: rect.bottom + 6 })
          }}
          onWheel={(e) => {
            if (!onCycleProfile) return
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 18) {
              const now = Date.now()
              if (now - lastWheelSwitchAt > 360) {
                setLastWheelSwitchAt(now)
                onCycleProfile(e.deltaX > 0 ? 1 : -1)
              }
            }
          }}
          title={tr(
            lang,
            'Switch Space (click or two-finger swipe · ⌃⌥←/→)',
            '切换物理隔离空间 (点击选择或触控板双指左右滑动 · ⌃⌥←/→)'
          )}
          style={{
            backgroundColor: spaceTheme.spaceBadgeBg,
            borderColor: spaceTheme.spaceBadgeBorder
          }}
          className={`app-no-drag flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition border shrink-0 hover:brightness-105 ${
            isDark ? 'text-zinc-100' : 'text-zinc-800 shadow-2xs'
          }`}
        >
          <span>{activeProfile.emoji}</span>
          {!compactTopBar && <span className="max-w-[76px] truncate">{activeProfile.name}</span>}
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              backgroundColor: spaceTheme.accentHex,
              boxShadow: `0 0 6px rgba(${spaceTheme.rgbString}, 0.55)`
            }}
          />
        </button>

        {compactTopBar && (
          <button
            data-arko-urlbar-anchor="true"
            onClick={onOpenOmnibox}
            className={`app-no-drag w-56 sm:w-72 h-[28px] px-2.5 rounded-full flex items-center gap-1.5 text-xs border transition shrink-0 ${
              omniboxOpen ? 'opacity-0 pointer-events-none' : ''
            } ${
              isDark
                ? 'bg-[#22222A] border-white/10 hover:border-white/20 text-zinc-200'
                : 'bg-white/90 border-black/8 hover:bg-white text-zinc-800 shadow-2xs'
            }`}
          >
            <Search size={12} className="opacity-45 shrink-0" />
            <span className="truncate flex-1 text-left font-medium">
              {domain ? `${domain} · ${cleanTitle}` : cleanTitle}
            </span>
          </button>
        )}

        {(pinnedTabs.length > 0 || draggingTabId || externalDragLink || isExternalLinkHovering) && (
          <div
            onDragOver={(e) => {
              const types = Array.from(e.dataTransfer.types || [])
              const linkDrag =
                Boolean(externalDragLink) ||
                (!types.includes('application/x-dia-tab-id') &&
                  (types.includes('text/uri-list') || types.includes('text/plain')))
              if (!draggingTabId && !linkDrag) return

              e.preventDefault()
              if (linkDrag && !isExternalLinkHovering) setIsExternalLinkHovering(true)

              const basePins = draggingTabId
                ? pinnedTabs.filter((t) => t.id !== draggingTabId)
                : pinnedTabs
              const rect = e.currentTarget.getBoundingClientRect()
              const slotWidth = 36
              const relX = Math.max(0, e.clientX - rect.left)
              const nextIdx = Math.max(
                0,
                Math.min(basePins.length, Math.floor(relX / slotWidth))
              )
              if (pinnedPreviewIndex !== nextIdx) {
                setPinnedPreviewIndex(nextIdx)
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setPinnedPreviewIndex(null)
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              const srcId = e.dataTransfer.getData('application/x-dia-tab-id') || draggingTabId
              const uriList = e.dataTransfer.getData('text/uri-list')
              const plain = e.dataTransfer.getData('text/plain')?.trim()
              const rawDropUrl =
                uriList
                  ?.split(/\r?\n/)
                  .map((l) => l.trim())
                  .find((l) => l && !l.startsWith('#')) ||
                (plain && !/\s/.test(plain) && /\./.test(plain) ? plain : '') ||
                externalDragLink?.url ||
                ''
              const droppedUrl = rawDropUrl
                ? /^https?:\/\//i.test(rawDropUrl)
                  ? rawDropUrl
                  : `https://${rawDropUrl}`
                : ''

              const basePins = srcId
                ? pinnedTabs.filter((t) => t.id !== srcId)
                : pinnedTabs
              const targetIdx = Math.max(
                0,
                Math.min(basePins.length, pinnedPreviewIndex ?? basePins.length)
              )

              setPinnedPreviewIndex(null)
              setIsExternalLinkHovering(false)
              setDragOverHint(null)
              onTabDragStateChange?.(null)

              if (srcId) {
                if (basePins.length === 0) {
                  onMoveTabToZone?.(srcId, 'favorite')
                } else if (targetIdx < basePins.length) {
                  onReorderTab?.(
                    srcId,
                    basePins[targetIdx].id,
                    'before',
                    basePins[targetIdx].isFavorite ? 'favorite' : 'pinned'
                  )
                } else {
                  const last = basePins[basePins.length - 1]
                  onReorderTab?.(
                    srcId,
                    last.id,
                    'after',
                    last.isFavorite ? 'favorite' : 'pinned'
                  )
                }
              } else if (droppedUrl) {
                const insertBeforeId =
                  targetIdx < basePins.length ? basePins[targetIdx].id : null
                onDropExternalUrl?.(droppedUrl, 'favorite', insertBeforeId)
              }
            }}
            className={`app-no-drag flex items-center gap-1 pl-0.5 shrink-0 rounded-lg transition-all ${
              pinnedPreviewIndex !== null
                ? isDark
                  ? 'bg-indigo-500/[0.08] ring-1 ring-indigo-400/35 px-1 py-0.5'
                  : 'bg-indigo-500/[0.06] ring-1 ring-indigo-500/30 px-1 py-0.5'
                : ''
            }`}
          >
            {(() => {
              const draggedTab = draggingTabId
                ? tabs.find((t) => t.id === draggingTabId)
                : undefined
              const basePins =
                pinnedPreviewIndex !== null && draggedTab
                  ? pinnedTabs.filter((t) => t.id !== draggedTab.id)
                  : pinnedTabs

              type PinSlot =
                | { kind: 'tab'; tab: TabState }
                | { kind: 'preview'; url?: string; favicon?: string }

              const slots: PinSlot[] = basePins.map((tab) => ({ kind: 'tab', tab }))
              if (pinnedPreviewIndex !== null) {
                const clamped = Math.max(0, Math.min(slots.length, pinnedPreviewIndex))
                slots.splice(clamped, 0, {
                  kind: 'preview',
                  url: draggedTab?.url ?? externalDragLink?.url,
                  favicon: draggedTab?.favicon
                })
              }

              if (slots.length === 0) {
                return (
                  <div
                    className={`h-7 px-2 rounded-lg border border-dashed flex items-center gap-1 text-[11px] ${
                      isDark
                        ? 'border-white/20 text-zinc-400'
                        : 'border-black/15 text-zinc-500'
                    }`}
                  >
                    <Pin size={11} />
                    <span>{tr(lang, 'Pin', '拖入固定')}</span>
                  </div>
                )
              }

              return slots.map((slot) => {
                if (slot.kind === 'preview') {
                  return (
                    <div
                      key="__hpin-preview__"
                      className={`h-7 w-8 rounded-lg border border-dashed flex items-center justify-center pointer-events-none transition-all ${
                        isDark
                          ? 'border-indigo-400/65 bg-indigo-500/15 text-indigo-200'
                          : 'border-indigo-500/55 bg-indigo-500/10 text-indigo-700'
                      }`}
                    >
                      {slot.url ? (
                        <FaviconIcon url={slot.url} favicon={slot.favicon} size={15} />
                      ) : (
                        <Link2 size={13.5} />
                      )}
                    </div>
                  )
                }

                const tab = slot.tab
                const isActive = tab.id === activeTab?.id
                const inSplit =
                  splitView.enabled &&
                  (tab.id === splitView.leftTabId || tab.id === splitView.rightTabId)
                return (
                  <div
                    key={tab.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-dia-tab-id', tab.id)
                      e.dataTransfer.effectAllowed = 'move'
                      const draggedId = tab.id
                      window.setTimeout(() => onTabDragStateChange?.(draggedId), 0)
                    }}
                    onDragEnd={() => {
                      setPinnedPreviewIndex(null)
                      setDragOverHint(null)
                      onTabDragStateChange?.(null)
                    }}
                    onClick={() => onSelectTab(tab.id)}
                    onAuxClick={(e) => {
                      if (e.button === 1) onPinTab(tab.id, false)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      onTabContextMenu(tab, { x: e.clientX, y: e.clientY })
                    }}
                    title={tr(
                      lang,
                      `${tab.title} (Pinned · Drag to reorder or right-click)`,
                      `${tab.title} (固定标签 · 拖拽排序或右键管理)`
                    )}
                    className={`h-7 w-8 rounded-lg flex items-center justify-center cursor-pointer transition-all ${
                      isActive
                        ? isDark
                          ? 'bg-[#2A2A32] shadow-xs ring-1 ring-white/12'
                          : 'bg-white shadow-xs ring-1 ring-black/6'
                        : inSplit
                          ? 'ring-1 ring-indigo-500/40 bg-indigo-500/10'
                          : isDark
                            ? 'hover:bg-white/8 opacity-75 hover:opacity-100'
                            : 'hover:bg-black/5 opacity-75 hover:opacity-100'
                    }`}
                  >
                    {tab.isLoading ? (
                      <Loader2 size={14} className="animate-spin text-indigo-500" />
                    ) : (
                      <FaviconIcon url={tab.url} favicon={tab.favicon} size={15} />
                    )}
                  </div>
                )
              })
            })()}
            <div className={`h-4 w-[1px] mx-0.5 ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
          </div>
        )}

        <div className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0">
          {tabStripNodes}

          <button
            onClick={onNewTab}
            title={tr(lang, 'New Tab (⌘T)', '新建标签页 (⌘T)')}
            className={`app-no-drag h-[28px] px-2 rounded-lg shrink-0 inline-flex items-center gap-1 text-xs transition ${
              isNewTabActive
                ? isDark
                  ? 'bg-white/14 text-white font-medium ring-1 ring-white/15'
                  : 'bg-white text-zinc-900 font-medium shadow-2xs ring-1 ring-black/8'
                : isDark
                  ? 'hover:bg-white/10 text-zinc-400'
                  : 'hover:bg-black/6 text-zinc-600'
            }`}
          >
            <Plus size={14} />
            {isNewTabActive && <span>{tr(lang, 'New Tab', '新建标签页')}</span>}
          </button>

          {ungroupedWebCount >= 3 && (
            <button
              onClick={onOrganizeTabs}
              disabled={organizingTabs}
              title={tr(
                lang,
                'AI Organize Open Tabs into Groups (/organize)',
                'AI 自动按主题整理打开的标签页分组 (/organize)'
              )}
              className={`app-no-drag h-[26px] px-2 rounded-lg text-[11px] font-medium inline-flex items-center gap-1 shrink-0 transition ${
                isDark
                  ? 'bg-indigo-500/12 text-indigo-300 hover:bg-indigo-500/22'
                  : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
              }`}
            >
              {organizingTabs ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <FolderKanban size={11} />
              )}
              <span>{tr(lang, 'Group', '智能分组')}</span>
            </button>
          )}
        </div>

        {compactTopBar && (
          <div className="app-no-drag flex items-center gap-1 shrink-0">
            <button
              onClick={onToggleCompactBar}
              title={tr(lang, 'Expand Smart Bar (⇧⌘S)', '展开完整智能地址栏 (⇧⌘S)')}
              className="p-1.5 rounded-lg opacity-65 hover:opacity-100"
            >
              <Maximize2 size={13} />
            </button>
            <button
              onClick={onToggleSplitView}
              title={tr(lang, 'Split View (⌘⇧\\)', '左右分屏 (⌘⇧\\)')}
              className={`p-1.5 rounded-lg transition ${
                splitView.enabled
                  ? 'bg-indigo-500/20 text-indigo-500'
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              <Columns2 size={14} />
            </button>
            <button
              onClick={onToggleAISidebar}
              title="Chat (⌘E)"
              className={`h-[26px] px-2.5 rounded-lg text-xs font-medium flex items-center gap-1 transition ${
                aiSidebarOpen
                  ? isDark
                    ? 'bg-zinc-100 text-zinc-900'
                    : 'bg-zinc-900 text-white'
                  : isDark
                    ? 'bg-white/8 text-zinc-200'
                    : 'bg-white text-zinc-800 border border-black/8'
              }`}
            >
              <Sparkles size={12} />
              <span>Chat</span>
            </button>
          </div>
        )}
      </div>

      {/* Row 2: Arko Calm Title-First Smart Bar */}
      {!compactTopBar && (
        <div className="h-[37px] px-3 pb-1 flex items-center gap-2">
          <div className="flex items-center gap-0.5">
            <button
              onClick={onBack}
              disabled={!activeTab?.canGoBack}
              title={tr(lang, 'Back (⌘[)', '后退 (⌘[)')}
              className={`p-1.5 rounded-lg transition disabled:opacity-30 ${
                isDark ? 'hover:bg-white/8' : 'hover:bg-black/6'
              }`}
            >
              <ArrowLeft size={15} />
            </button>
            <button
              onClick={onForward}
              disabled={!activeTab?.canGoForward}
              title={tr(lang, 'Forward (⌘])', '前进 (⌘])')}
              className={`p-1.5 rounded-lg transition disabled:opacity-30 ${
                isDark ? 'hover:bg-white/8' : 'hover:bg-black/6'
              }`}
            >
              <ArrowRight size={15} />
            </button>
            <button
              onClick={onReload}
              disabled={!activeTab || isInternalArkoUrl(activeTab.url)}
              title={tr(lang, 'Reload (⌘R)', '重新加载 (⌘R)')}
              className={`p-1.5 rounded-lg transition disabled:opacity-30 ${
                isDark ? 'hover:bg-white/8' : 'hover:bg-black/6'
              }`}
            >
              <RotateCw size={14} className={activeTab?.isLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div
            data-arko-urlbar-anchor="true"
            onClick={onOpenOmnibox}
            className={`group relative flex-1 max-w-3xl mx-auto h-[30px] px-3 rounded-full flex items-center gap-2 text-xs cursor-text transition-all border overflow-hidden ${
              omniboxOpen ? 'opacity-0 pointer-events-none' : ''
            } ${
              isDark
                ? 'bg-[#222229] border-white/8 hover:border-white/18 text-zinc-200'
                : 'bg-white/88 border-black/7 hover:bg-white hover:border-black/15 text-zinc-800 shadow-2xs'
            }`}
          >
            {activeTab?.isSensitive ? (
              <span
                title={tr(
                  lang,
                  'Sensitive Site Protection active: AI reading is blocked on this page',
                  '敏感站点隐私护栏已生效：AI 已自动停止读取此页面'
                )}
                className="flex items-center gap-1 text-amber-500 font-medium shrink-0"
              >
                <ShieldAlert size={13} />
              </span>
            ) : activeTab?.url && !isInternalArkoUrl(activeTab.url) ? (
              <Lock size={11.5} className="opacity-40 shrink-0" />
            ) : (
              <Search size={13} className="opacity-45 shrink-0" />
            )}

            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              {splitView.enabled && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-indigo-500/15 text-indigo-500 shrink-0">
                  {splitView.activePane === 'left'
                    ? tr(lang, 'Left', '左屏')
                    : tr(lang, 'Right', '右屏')}
                </span>
              )}

              <div className="flex items-center gap-1.5 truncate group-hover:hidden">
                {domain && (
                  <>
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400 shrink-0">
                      {domain}
                    </span>
                    <span className="opacity-30">·</span>
                  </>
                )}
                <span
                  className={`truncate ${
                    !activeTab?.url || activeTab.url === NEW_TAB_URL
                      ? 'opacity-50'
                      : 'opacity-85 font-medium'
                  }`}
                >
                  {cleanTitle}
                </span>
              </div>

              <div className="hidden group-hover:flex items-center gap-1 truncate font-mono text-[11.5px] opacity-85">
                <span className="truncate">{cleanUrl || cleanTitle}</span>
              </div>
            </div>

            {zoomPct !== 100 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onResetZoom()
                }}
                title={tr(lang, 'Reset zoom to 100% (⌘0)', '点击恢复 100% 网页缩放 (⌘0)')}
                className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-indigo-500/15 text-indigo-500 shrink-0"
              >
                {zoomPct}%
              </button>
            )}

            <div
              className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              {activeTab?.url && !isInternalArkoUrl(activeTab.url) && (
                <>
                  <button
                    onClick={onOpenReader}
                    title={tr(lang, 'Arko Calm Reader (⇧⌘R)', 'Arko 沉浸阅读视图 (⇧⌘R)')}
                    className="p-1 rounded hover:bg-black/8 dark:hover:bg-white/10 opacity-75 hover:opacity-100"
                  >
                    <BookOpen size={12} />
                  </button>
                  <button
                    onClick={onOpenInlineWrite}
                    title={tr(
                      lang,
                      'Inline Write & Form Fill Preview (⌘J)',
                      '网页输入框内联帮写与表单填充 (⌘J)'
                    )}
                    className="p-1 rounded hover:bg-black/8 dark:hover:bg-white/10 text-indigo-500 opacity-85 hover:opacity-100"
                  >
                    <PenLine size={12} />
                  </button>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(activeTab.url)
                      setCopiedUrl(true)
                      setTimeout(() => setCopiedUrl(false), 1300)
                    }}
                    title={tr(lang, 'Copy URL', '复制网址')}
                    className="p-1 rounded hover:bg-black/8 dark:hover:bg-white/10 opacity-75 hover:opacity-100"
                  >
                    {copiedUrl ? (
                      <Check size={12} className="text-emerald-500" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                  <button
                    onClick={onToggleBookmark}
                    title={
                      isBookmarked
                        ? tr(lang, 'Remove Bookmark (⌘D)', '取消收藏 (⌘D)')
                        : tr(lang, 'Bookmark Page (⌘D)', '收藏此页面 (⌘D)')
                    }
                    className={`p-1 rounded hover:bg-black/8 dark:hover:bg-white/10 ${
                      isBookmarked ? 'text-amber-500 opacity-100' : 'opacity-75 hover:opacity-100'
                    }`}
                  >
                    <Bookmark size={12} fill={isBookmarked ? 'currentColor' : 'none'} />
                  </button>
                </>
              )}
              <kbd
                onClick={onOpenOmnibox}
                className={`px-1.5 py-0.5 text-[10px] rounded font-mono opacity-55 ${
                  isDark ? 'bg-white/8' : 'bg-black/5'
                }`}
              >
                ⌘L
              </kbd>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {hasUpdateBadge && onOpenUpdatePanel && (
              <button
                onClick={onOpenUpdatePanel}
                title={tr(
                  lang,
                  `New version v${updateState?.latestVersion} available · Click to update`,
                  `发现新版本 v${updateState?.latestVersion} · 点击一键更新`
                )}
                className="h-[26px] px-2.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1 hover:bg-emerald-500 hover:text-white transition"
              >
                <ArrowDownCircle size={12} />
                <span>
                  {updateState?.status === 'downloaded'
                    ? tr(lang, 'Restart to Update', '重启完成更新')
                    : `v${updateState?.latestVersion}`}
                </span>
              </button>
            )}

            <button
              onClick={onToggleCompactBar}
              title={tr(lang, 'Compact Single-Row Bar (⇧⌘S)', '切换单栏极简融合顶栏 (⇧⌘S)')}
              className={`p-1.5 rounded-lg transition ${
                isDark ? 'hover:bg-white/8 text-zinc-400' : 'hover:bg-black/6 text-zinc-500'
              }`}
            >
              <Minimize2 size={14} />
            </button>

            <button
              onClick={onToggleSplitView}
              title={tr(lang, 'Split View (⌘⇧\\)', '左右并排分屏视图 (⌘⇧\\)')}
              className={`p-1.5 rounded-lg transition ${
                splitView.enabled
                  ? 'bg-indigo-500/18 text-indigo-500 ring-1 ring-indigo-500/35'
                  : isDark
                    ? 'hover:bg-white/8 text-zinc-300'
                    : 'hover:bg-black/6 text-zinc-600'
              }`}
            >
              <Columns2 size={15} />
            </button>

            {downloads.length > 0 && (
              <button
                onClick={onOpenDownloads}
                title={tr(lang, 'Downloads', '下载管理')}
                className={`relative p-1.5 rounded-lg transition ${
                  activeDownloads > 0
                    ? 'text-indigo-500 bg-indigo-500/12'
                    : isDark
                      ? 'hover:bg-white/8 text-zinc-300'
                      : 'hover:bg-black/6 text-zinc-600'
                }`}
              >
                <Download size={15} className={activeDownloads > 0 ? 'animate-bounce' : ''} />
              </button>
            )}

            <button
              onClick={onOpenLibrary}
              title={tr(lang, 'Bookmarks & History', '收藏夹与浏览历史')}
              className={`p-1.5 rounded-lg transition ${
                isDark ? 'hover:bg-white/8 text-zinc-300' : 'hover:bg-black/6 text-zinc-600'
              }`}
            >
              <Clock size={15} />
            </button>

            {onOpenAccount && (
              <button
                onClick={onOpenAccount}
                title={
                  accountState?.authenticated && accountState.user
                    ? `${accountState.user.email || accountState.user.username} · $${(accountState.user.remainingUsd ?? 0).toFixed(2)}`
                    : tr(lang, 'Sign in to Arko Account', '登录 / 注册 Arko 账号')
                }
                className={`relative p-1.5 rounded-lg transition ${
                  accountState?.authenticated
                    ? 'text-indigo-500 hover:bg-indigo-500/12'
                    : isDark
                      ? 'hover:bg-white/8 text-zinc-300'
                      : 'hover:bg-black/6 text-zinc-600'
                }`}
              >
                <UserRound size={15} />
                {accountState?.authenticated && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-500" />
                )}
              </button>
            )}

            <button
              onClick={onOpenSettings}
              title={tr(lang, 'Models, Memory, /Skills & Updates (⌘,)', '模型、记忆库、/Skills 与更新设置 (⌘,)')}
              className={`p-1.5 rounded-lg transition ${
                isDark ? 'hover:bg-white/8 text-zinc-300' : 'hover:bg-black/6 text-zinc-600'
              }`}
            >
              <Settings size={15} />
            </button>

            <button
              onClick={onToggleAISidebar}
              title={tr(lang, 'Toggle Chat Sidebar (⌘E)', '切换对话侧边栏 (⌘E)')}
              className={`flex items-center gap-1.5 h-[28px] px-2.5 rounded-lg text-xs font-medium transition-all ${
                aiSidebarOpen
                  ? isDark
                    ? 'bg-zinc-100 text-zinc-900'
                    : 'bg-zinc-900 text-white'
                  : isDark
                    ? 'bg-white/7 hover:bg-white/12 text-zinc-200'
                    : 'bg-white hover:bg-black/5 text-zinc-800 border border-black/8 shadow-2xs'
              }`}
            >
              <Sparkles size={12.5} />
              <span>Chat</span>
            </button>
          </div>
        </div>
      )}

      {activeTab?.isLoading && <div className="dia-loading-bar" />}
    </header>
  )
}
