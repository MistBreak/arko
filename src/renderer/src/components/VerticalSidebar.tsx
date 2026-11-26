import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownCircle,
  ChevronDown,
  Clock,
  Columns2,
  Download,
  Folder,
  FolderKanban,
  Link2,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  PanelTop,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Settings,
  Star,
  UserRound,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import { isInternalArkoUrl, NEW_TAB_URL } from '@shared/constants'
import { tr } from '@shared/i18n'
import { getArcSpaceTheme, interpolateSpaceHex } from '@shared/space-theme'
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
import type { SpacePopoverRequest } from './SpaceEditorPopover'

interface Props {
  platform?: 'darwin' | 'win32' | 'linux'
  isDark: boolean
  lang?: AppLanguage
  width?: number
  isPeekOverlay?: boolean
  onResizeWidth?: (width: number, commit?: boolean) => void
  onResizeDragChange?: (dragging: boolean) => void
  updateState?: AppUpdateState
  accountState?: ArkoAccountState
  profiles: BrowserProfile[]
  activeProfile: BrowserProfile
  tabs: TabState[]
  tabGroups: TabGroup[]
  allTabs: TabState[]
  allTabGroups: TabGroup[]
  activeTabByProfile: Record<string, string>
  splitByProfile: Record<string, SplitViewState>
  activeTab: TabState | undefined
  splitView: SplitViewState
  bookmarks: BookmarkItem[]
  downloads: DownloadItemState[]
  aiSidebarOpen: boolean
  newTabPromptOpen?: boolean
  organizingTabs?: boolean
  draggingTabId?: string | null
  externalDragLink?: { url: string; title?: string } | null
  onDropExternalUrl?: (
    url: string,
    zone: TabPinMode,
    insertBeforeTabId?: string | null
  ) => void
  onSwitchLayout: () => void
  onCollapseSidebar: () => void
  onSwitchProfile: (profileId: string, direction?: 'left' | 'right') => void
  onCreateProfilePrompt: () => void
  onEditProfilePrompt: (profile: BrowserProfile) => void
  onOpenSpacePopover?: (req: SpacePopoverRequest) => void
  onRenameProfileInline?: (profileId: string, name: string) => void
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onSetTabPinState: (tabId: string, mode: TabPinMode) => void
  onResetPinnedTab: (tabId: string) => void
  onClearUnpinnedTabs: (profileId: string) => void
  onMoveTabToZone: (tabId: string, targetZone: TabPinMode) => void
  onReorderTab?: (
    sourceTabId: string,
    targetTabId: string,
    position: 'before' | 'after',
    targetZone?: TabPinMode
  ) => void
  onMuteTab: (tabId: string) => void
  onTabDragStateChange?: (draggingTabId: string | null) => void
  onTabContextMenu: (tab: TabState, pos: { x: number; y: number }) => void
  onToggleGroupCollapsed: (groupId: string) => void
  onOrganizeTabs: () => void
  onNewTab: () => void
  onToggleSplitView: () => void
  onOpenTabInSplit: (tabId: string) => void
  onOpenInlineWrite: () => void
  onOpenReader: () => void
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

const DEFAULT_SIDEBAR_WIDTH = 232
const MIN_SIDEBAR_WIDTH = 188
const MAX_SIDEBAR_WIDTH = 420

// Deliberate low-frequency Space swipe tuning
const SWIPE_DEADZONE_PX = 16
const SWIPE_AXIS_RATIO = 1.9
const SWIPE_VERTICAL_LOCK_PX = 8
const SWIPE_TRACKING_GAIN = 0.6
const SWIPE_SNAP_RATIO = 0.38
const SWIPE_PASS_COMMIT_RATIO = 0.65
const SWIPE_FLICK_MIN_PEAK = 30
const SWIPE_FLICK_MIN_OFFSET_RATIO = 0.28
const SWIPE_MAX_REF_WIDTH = 260

// Taut boundary rubber-band resistance (< 26px asymptotic ceiling)
const BOUNDARY_RUBBER_MAX_PX = 26
const BOUNDARY_RUBBER_STIFFNESS = 0.24

function computeBoundaryRubberBand(rawOverscrollPx: number): number {
  const abs = Math.abs(rawOverscrollPx)
  if (abs <= 0) return 0
  const damped =
    (BOUNDARY_RUBBER_MAX_PX * BOUNDARY_RUBBER_STIFFNESS * abs) /
    (BOUNDARY_RUBBER_MAX_PX + BOUNDARY_RUBBER_STIFFNESS * abs)
  return Math.sign(rawOverscrollPx) * damped
}

function getFavColCount(itemCount: number, sidebarWidth: number): number {
  if (itemCount <= 1) return 1
  if (itemCount === 2) return 2
  if (itemCount === 3) return 3
  if (sidebarWidth >= 320 && itemCount >= 5) return 5
  if (sidebarWidth < 196 && itemCount >= 4) return 3
  return 4
}

function getFavGridColsClass(cols: number): string {
  if (cols <= 1) return 'grid-cols-1'
  if (cols === 2) return 'grid-cols-2'
  if (cols === 3) return 'grid-cols-3'
  if (cols === 5) return 'grid-cols-5'
  return 'grid-cols-4'
}

function hasExternalLinkDragPayload(dt: DataTransfer): boolean {
  const types = Array.from(dt.types || [])
  if (types.includes('application/x-dia-tab-id')) return false
  return types.includes('text/uri-list') || types.includes('text/plain')
}

function extractDroppedExternalUrl(dt: DataTransfer): string | null {
  const uriList = dt.getData('text/uri-list')
  if (uriList) {
    const first = uriList
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#'))
    if (first && /^(https?:\/\/|file:\/\/)/i.test(first)) {
      return first
    }
  }
  const plain = dt.getData('text/plain')?.trim()
  if (
    plain &&
    !/\s/.test(plain) &&
    /^(https?:\/\/|[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#].*)?)$/i.test(plain)
  ) {
    return /^https?:\/\//i.test(plain) ? plain : `https://${plain}`
  }
  return null
}

function formatPreviewDomainLabel(url?: string, title?: string, fallback?: string): string {
  if (title && title.trim() && title.trim() !== url) return title.trim()
  if (url) {
    try {
      const parsed = new URL(url)
      return parsed.hostname.replace(/^www\./, '') || url
    } catch {
      return url
    }
  }
  return fallback || 'Link'
}

interface WheelGestureState {
  lockedAxis: 'none' | 'horizontal' | 'vertical'
  intentX: number
  intentAbsY: number
  rawOffset: number
  peakAbsDeltaX: number
  decayFrames: number
  committed: boolean
  committedDir: 1 | -1 | 0
  coastingReleased: boolean
  coastingDir: 1 | -1 | 0
  lastEventAt: number
  lastAbsDeltaX: number
  endTimer: number | null
}

function resetWheelGestureState(g: WheelGestureState): void {
  g.lockedAxis = 'none'
  g.intentX = 0
  g.intentAbsY = 0
  g.rawOffset = 0
  g.peakAbsDeltaX = 0
  g.decayFrames = 0
  g.committed = false
  g.committedDir = 0
  g.coastingReleased = false
  g.coastingDir = 0
  g.lastAbsDeltaX = 0
}

export const VerticalSidebar: React.FC<Props> = ({
  platform = 'darwin',
  isDark,
  lang,
  width = DEFAULT_SIDEBAR_WIDTH,
  isPeekOverlay = false,
  onResizeWidth,
  onResizeDragChange,
  updateState,
  accountState,
  profiles,
  activeProfile,
  allTabs,
  allTabGroups,
  activeTabByProfile,
  splitByProfile,
  splitView,
  downloads,
  newTabPromptOpen,
  organizingTabs,
  draggingTabId,
  externalDragLink,
  onDropExternalUrl,
  onSwitchLayout,
  onCollapseSidebar,
  onSwitchProfile,
  onCreateProfilePrompt,
  onEditProfilePrompt,
  onOpenSpacePopover,
  onRenameProfileInline,
  onSelectTab,
  onCloseTab,
  onSetTabPinState,
  onResetPinnedTab,
  onClearUnpinnedTabs,
  onMoveTabToZone,
  onReorderTab,
  onMuteTab,
  onTabDragStateChange,
  onTabContextMenu,
  onToggleGroupCollapsed,
  onOrganizeTabs,
  onNewTab,
  onOpenTabInSplit,
  onOpenLibrary,
  onOpenDownloads,
  onOpenSettings,
  onOpenAccount,
  onOpenUpdatePanel
}) => {
  const [optimisticProfileId, setOptimisticProfileId] = useState<string>(activeProfile.id)
  const [dragOffsetPx, setDragOffsetPx] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const [snapMode, setSnapMode] = useState<'switch' | 'rebound' | 'boundary'>('switch')
  const [isResizing, setIsResizing] = useState(false)
  const [footerMenuOpen, setFooterMenuOpen] = useState(false)
  const [renamingSpaceId, setRenamingSpaceId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const [dragOverHint, setDragOverHint] = useState<{
    tabId: string
    pos: 'before' | 'after'
    zone: TabPinMode
  } | null>(null)
  const [dropZoneHover, setDropZoneHover] = useState<TabPinMode | null>(null)
  const [favPreviewIndex, setFavPreviewIndex] = useState<number | null>(null)
  const [pinnedPreviewIndex, setPinnedPreviewIndex] = useState<number | null>(null)
  const [isExternalLinkHovering, setIsExternalLinkHovering] = useState(false)

  const favGridRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  const wheelGestureRef = useRef<WheelGestureState>({
    lockedAxis: 'none',
    intentX: 0,
    intentAbsY: 0,
    rawOffset: 0,
    peakAbsDeltaX: 0,
    decayFrames: 0,
    committed: false,
    committedDir: 0,
    coastingReleased: false,
    coastingDir: 0,
    lastEventAt: 0,
    lastAbsDeltaX: 0,
    endTimer: null
  })

  useEffect(() => {
    setSnapMode('switch')
    setOptimisticProfileId(activeProfile.id)
  }, [activeProfile.id])

  useEffect(() => {
    const g = wheelGestureRef.current
    return () => {
      if (g.endTimer !== null) window.clearTimeout(g.endTimer)
    }
  }, [])

  useEffect(() => {
    if (renamingSpaceId) {
      window.requestAnimationFrame(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      })
    }
  }, [renamingSpaceId])

  const resetAllDragPreviews = useCallback(() => {
    setDragOverHint(null)
    setDropZoneHover(null)
    setFavPreviewIndex(null)
    setPinnedPreviewIndex(null)
    setIsExternalLinkHovering(false)
  }, [])

  useEffect(() => {
    if (!draggingTabId && !externalDragLink) {
      resetAllDragPreviews()
    }
  }, [draggingTabId, externalDragLink, resetAllDragPreviews])

  useEffect(() => {
    const onGlobalEnd = (): void => {
      resetAllDragPreviews()
    }
    window.addEventListener('dragend', onGlobalEnd)
    window.addEventListener('drop', onGlobalEnd)
    return () => {
      window.removeEventListener('dragend', onGlobalEnd)
      window.removeEventListener('drop', onGlobalEnd)
    }
  }, [resetAllDragPreviews])

  const currentProfileIndex = Math.max(
    0,
    profiles.findIndex((p) => p.id === optimisticProfileId)
  )
  const visualProfile = profiles[currentProfileIndex] || activeProfile

  // Live Arc Space color interpolation during two-finger horizontal swipe
  const swipeNeighborProfile = useMemo(() => {
    if (!isSwiping || dragOffsetPx === 0 || profiles.length <= 1) return null
    const neighborIdx = dragOffsetPx < 0 ? currentProfileIndex + 1 : currentProfileIndex - 1
    return profiles[neighborIdx] || null
  }, [isSwiping, dragOffsetPx, profiles, currentProfileIndex])

  const swipeProgress = useMemo(() => {
    if (!swipeNeighborProfile) return 0
    return Math.min(1, Math.abs(dragOffsetPx) / Math.max(1, width))
  }, [swipeNeighborProfile, dragOffsetPx, width])

  const headerPreviewProfile =
    swipeNeighborProfile && swipeProgress >= SWIPE_SNAP_RATIO
      ? swipeNeighborProfile
      : visualProfile

  const liveAccentHex = useMemo(() => {
    if (!swipeNeighborProfile || swipeProgress <= 0) {
      return visualProfile.accentColor
    }
    return interpolateSpaceHex(
      visualProfile.accentColor,
      swipeNeighborProfile.accentColor,
      swipeProgress
    )
  }, [swipeNeighborProfile, swipeProgress, visualProfile.accentColor])

  const liveSpaceTheme = useMemo(
    () => getArcSpaceTheme(liveAccentHex, isDark),
    [liveAccentHex, isDark]
  )

  // Sync window shell & top frame bar at 120fps during trackpad swipe without re-rendering App
  useEffect(() => {
    const root = document.documentElement
    if (isSwiping && dragOffsetPx !== 0) {
      root.style.setProperty('--arko-live-shell-bg', liveSpaceTheme.sidebarBackground)
      root.style.setProperty('--arko-live-topbar-bg', liveSpaceTheme.topBarBackground)
      root.style.setProperty('--arko-live-topbar-border', liveSpaceTheme.topBarBorderColor)
    } else {
      root.style.removeProperty('--arko-live-shell-bg')
      root.style.removeProperty('--arko-live-topbar-bg')
      root.style.removeProperty('--arko-live-topbar-border')
    }
    return () => {
      root.style.removeProperty('--arko-live-shell-bg')
      root.style.removeProperty('--arko-live-topbar-bg')
      root.style.removeProperty('--arko-live-topbar-border')
    }
  }, [
    isSwiping,
    dragOffsetPx,
    liveSpaceTheme.sidebarBackground,
    liveSpaceTheme.topBarBackground,
    liveSpaceTheme.topBarBorderColor
  ])

  const commitProfileSwitch = useCallback(
    (targetProfileId: string, direction?: 'left' | 'right') => {
      const prevIdx = profiles.findIndex((p) => p.id === optimisticProfileId)
      const nextIdx = profiles.findIndex((p) => p.id === targetProfileId)
      const resolvedDir =
        direction ?? (nextIdx > prevIdx ? 'right' : nextIdx < prevIdx ? 'left' : undefined)

      setSnapMode('switch')
      setOptimisticProfileId(targetProfileId)
      setIsSwiping(false)
      setDragOffsetPx(0)

      if (targetProfileId !== activeProfile.id) {
        onSwitchProfile(targetProfileId, resolvedDir)
      }
    },
    [profiles, optimisticProfileId, activeProfile.id, onSwitchProfile]
  )

  // Weighted, low-sensitivity macOS two-finger swipe with taut boundary rubber-band & spring settle
  const handleWheelSwipe = useCallback(
    (e: React.WheelEvent<HTMLElement>) => {
      if (draggingTabId || isResizing || renamingSpaceId || profiles.length === 0) return

      const g = wheelGestureRef.current
      const now = performance.now()
      const gap = now - g.lastEventAt
      g.lastEventAt = now

      if (gap > 130) {
        resetWheelGestureState(g)
      }

      const absX = Math.abs(e.deltaX)
      const absY = Math.abs(e.deltaY)

      if (g.committed) {
        const reversed =
          (e.deltaX > 8 && g.committedDir === -1) ||
          (e.deltaX < -8 && g.committedDir === 1)
        const freshStrongSwipe = absX > g.lastAbsDeltaX + 18 && absX > 32
        g.lastAbsDeltaX = absX

        if (reversed || freshStrongSwipe) {
          resetWheelGestureState(g)
          g.peakAbsDeltaX = absX
          g.lastAbsDeltaX = absX
          g.lockedAxis = 'horizontal'
        } else {
          if (g.endTimer !== null) window.clearTimeout(g.endTimer)
          g.endTimer = window.setTimeout(() => {
            resetWheelGestureState(g)
          }, 120)
          return
        }
      }

      if (g.coastingReleased) {
        const reversed =
          (e.deltaX > 5 && g.coastingDir === -1) ||
          (e.deltaX < -5 && g.coastingDir === 1)
        const freshPush = absX > g.lastAbsDeltaX + 8 && absX > 15
        g.lastAbsDeltaX = absX

        if (reversed || freshPush) {
          resetWheelGestureState(g)
          g.peakAbsDeltaX = absX
          g.lastAbsDeltaX = absX
          g.lockedAxis = 'horizontal'
        } else {
          if (g.endTimer !== null) window.clearTimeout(g.endTimer)
          g.endTimer = window.setTimeout(() => {
            resetWheelGestureState(g)
          }, 110)
          return
        }
      }

      if (g.lockedAxis === 'vertical') return

      if (g.lockedAxis === 'none') {
        g.intentX -= e.deltaX
        g.intentAbsY += absY

        if ((absY > absX * 0.9 && absY > 1.5) || g.intentAbsY >= SWIPE_VERTICAL_LOCK_PX) {
          g.lockedAxis = 'vertical'
          return
        }

        if (
          Math.abs(g.intentX) >= SWIPE_DEADZONE_PX &&
          Math.abs(g.intentX) >= g.intentAbsY * SWIPE_AXIS_RATIO
        ) {
          g.lockedAxis = 'horizontal'
          const excess = Math.sign(g.intentX) * (Math.abs(g.intentX) - SWIPE_DEADZONE_PX)
          g.rawOffset = excess * SWIPE_TRACKING_GAIN
          g.peakAbsDeltaX = absX
          g.lastAbsDeltaX = absX
          g.decayFrames = 0
        } else {
          return
        }
      } else {
        if (absX > 0 && absX < g.lastAbsDeltaX * 0.96) {
          g.decayFrames += 1
        } else if (absX > g.lastAbsDeltaX * 1.04) {
          g.decayFrames = 0
        }
        g.lastAbsDeltaX = absX
        if (absX > g.peakAbsDeltaX) g.peakAbsDeltaX = absX
        g.rawOffset -= e.deltaX * SWIPE_TRACKING_GAIN
      }

      const atStart = currentProfileIndex === 0 && g.rawOffset > 0
      const atEnd = currentProfileIndex === profiles.length - 1 && g.rawOffset < 0
      const isBoundary = atStart || atEnd
      const gestureWidth = Math.min(width, SWIPE_MAX_REF_WIDTH)

      // Detect finger lift into macOS trackpad inertial coasting so tail events don't over-pull or false-switch
      const enteredInertialCoasting =
        g.peakAbsDeltaX >= 16 &&
        g.decayFrames >= 3 &&
        absX < g.peakAbsDeltaX * 0.6

      if (isBoundary) {
        if (enteredInertialCoasting) {
          g.coastingReleased = true
          g.coastingDir = g.rawOffset < 0 ? 1 : -1
          g.rawOffset = 0
          setSnapMode('boundary')
          setIsSwiping(false)
          setDragOffsetPx(0)

          if (g.endTimer !== null) window.clearTimeout(g.endTimer)
          g.endTimer = window.setTimeout(() => {
            resetWheelGestureState(g)
          }, 110)
          return
        }

        const rawOverscroll = g.rawOffset / SWIPE_TRACKING_GAIN
        const effectiveOffset = computeBoundaryRubberBand(rawOverscroll)
        setIsSwiping(true)
        setDragOffsetPx(effectiveOffset)

        const settleDelay = absX < 3 ? 52 : 82
        if (g.endTimer !== null) window.clearTimeout(g.endTimer)
        g.endTimer = window.setTimeout(() => {
          if (!g.committed && !g.coastingReleased) {
            setSnapMode('boundary')
            setIsSwiping(false)
            setDragOffsetPx(0)
          }
          resetWheelGestureState(g)
        }, settleDelay)
        return
      }

      // Non-boundary Space transition: require deliberate pull or strong purposeful flick
      const earnedFlickSwitch =
        g.peakAbsDeltaX >= SWIPE_FLICK_MIN_PEAK &&
        Math.abs(g.rawOffset) >= gestureWidth * SWIPE_FLICK_MIN_OFFSET_RATIO
      const earnedDistanceSwitch = Math.abs(g.rawOffset) >= gestureWidth * SWIPE_SNAP_RATIO
      const passedAutoCommit = Math.abs(g.rawOffset) >= gestureWidth * SWIPE_PASS_COMMIT_RATIO

      if (passedAutoCommit || (enteredInertialCoasting && (earnedFlickSwitch || earnedDistanceSwitch))) {
        const step: 1 | -1 = g.rawOffset < 0 ? 1 : -1
        const nextIdx = currentProfileIndex + step
        if (nextIdx >= 0 && nextIdx < profiles.length) {
          g.committed = true
          g.committedDir = step
          g.rawOffset = 0
          g.peakAbsDeltaX = 0
          commitProfileSwitch(profiles[nextIdx].id, step === 1 ? 'right' : 'left')

          if (g.endTimer !== null) window.clearTimeout(g.endTimer)
          g.endTimer = window.setTimeout(() => {
            resetWheelGestureState(g)
          }, 125)
          return
        }
      }

      if (enteredInertialCoasting) {
        // Finger lifted before reaching switch threshold — rebound immediately instead of coasting further
        g.coastingReleased = true
        g.coastingDir = g.rawOffset < 0 ? 1 : -1
        g.rawOffset = 0
        setSnapMode('rebound')
        setIsSwiping(false)
        setDragOffsetPx(0)

        if (g.endTimer !== null) window.clearTimeout(g.endTimer)
        g.endTimer = window.setTimeout(() => {
          resetWheelGestureState(g)
        }, 110)
        return
      }

      const effectiveOffset = Math.max(-width, Math.min(width, g.rawOffset))
      setIsSwiping(true)
      setDragOffsetPx(effectiveOffset)

      const settleDelay = absX < 3 ? 52 : 88
      if (g.endTimer !== null) window.clearTimeout(g.endTimer)
      g.endTimer = window.setTimeout(() => {
        if (!g.committed && !g.coastingReleased) {
          const snapThreshold = gestureWidth * SWIPE_SNAP_RATIO
          const nextStep: 1 | -1 = g.rawOffset < 0 ? 1 : -1
          const candidateIdx = currentProfileIndex + nextStep
          if (
            Math.abs(g.rawOffset) >= snapThreshold &&
            candidateIdx >= 0 &&
            candidateIdx < profiles.length
          ) {
            commitProfileSwitch(profiles[candidateIdx].id, nextStep === 1 ? 'right' : 'left')
          } else {
            setSnapMode('rebound')
            setIsSwiping(false)
            setDragOffsetPx(0)
          }
        }
        resetWheelGestureState(g)
      }, settleDelay)
    },
    [
      draggingTabId,
      isResizing,
      renamingSpaceId,
      profiles,
      width,
      currentProfileIndex,
      commitProfileSwitch
    ]
  )

  const handleMouseSwipeStart = (e: React.MouseEvent<HTMLElement>): void => {
    if (e.button !== 0 || draggingTabId || isResizing || renamingSpaceId || profiles.length === 0) {
      return
    }
    const target = e.target as HTMLElement | null
    if (!target) return
    if (
      target.closest('[data-no-swipe="true"]') ||
      target.closest('[draggable="true"]') ||
      target.closest('input, textarea, button')
    ) {
      return
    }

    const startX = e.clientX
    const startY = e.clientY
    let axis: 'none' | 'horizontal' | 'vertical' = 'none'
    let latestEffectiveDx = 0
    let endedAtBoundary = false

    const onMove = (moveEvt: MouseEvent): void => {
      const dx = moveEvt.clientX - startX
      const dy = moveEvt.clientY - startY

      if (axis === 'none') {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 0.8) {
          axis = 'vertical'
          cleanup()
          return
        }
        if (Math.abs(dx) > SWIPE_DEADZONE_PX && Math.abs(dx) > Math.abs(dy) * 1.8) {
          axis = 'horizontal'
          setIsSwiping(true)
        } else {
          return
        }
      }

      if (axis === 'horizontal') {
        const rawPastDeadzone =
          Math.sign(dx) * Math.max(0, Math.abs(dx) - SWIPE_DEADZONE_PX)
        const dampedDx = rawPastDeadzone * 0.72
        latestEffectiveDx = dampedDx

        const atStart = currentProfileIndex === 0 && rawPastDeadzone > 0
        const atEnd = currentProfileIndex === profiles.length - 1 && rawPastDeadzone < 0
        endedAtBoundary = atStart || atEnd

        const clamped = endedAtBoundary
          ? computeBoundaryRubberBand(rawPastDeadzone)
          : Math.max(-width, Math.min(width, dampedDx))
        setDragOffsetPx(clamped)
      }
    }

    const onUp = (): void => {
      cleanup()
      if (axis !== 'horizontal') return
      if (endedAtBoundary) {
        setSnapMode('boundary')
        setIsSwiping(false)
        setDragOffsetPx(0)
        return
      }
      const gestureWidth = Math.min(width, SWIPE_MAX_REF_WIDTH)
      const threshold = gestureWidth * SWIPE_SNAP_RATIO
      const step: 1 | -1 = latestEffectiveDx < 0 ? 1 : -1
      const nextIdx = currentProfileIndex + step
      if (Math.abs(latestEffectiveDx) >= threshold && nextIdx >= 0 && nextIdx < profiles.length) {
        commitProfileSwitch(profiles[nextIdx].id, step === 1 ? 'right' : 'left')
      } else {
        setSnapMode('rebound')
        setIsSwiping(false)
        setDragOffsetPx(0)
      }
    }

    const cleanup = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleStartSidebarResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = width
    let latestWidth = startWidth
    setIsResizing(true)
    onResizeDragChange?.(true)

    const onMove = (moveEvt: MouseEvent): void => {
      const delta = moveEvt.clientX - startX
      latestWidth = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, Math.round(startWidth + delta))
      )
      onResizeWidth?.(latestWidth, false)
    }

    const onUp = (): void => {
      setIsResizing(false)
      onResizeDragChange?.(false)
      onResizeWidth?.(latestWidth, true)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const triggerEditSpace = (
    profile: BrowserProfile,
    el: HTMLElement,
    placement: 'bottom-left' | 'top-left' | 'right-top' = 'right-top'
  ): void => {
    if (onOpenSpacePopover) {
      const rect = el.getBoundingClientRect()
      const anchor =
        placement === 'right-top'
          ? { x: Math.min(rect.right + 6, width + 6), y: rect.top, placement }
          : placement === 'top-left'
            ? { x: rect.left, y: rect.top, placement }
            : { x: rect.left, y: rect.bottom + 6, placement }
      onOpenSpacePopover({
        mode: 'edit',
        profileId: profile.id,
        anchor
      })
    } else {
      onEditProfilePrompt(profile)
    }
  }

  const triggerCreateSpace = (
    el: HTMLElement,
    placement: 'bottom-left' | 'top-left' | 'right-top' = 'top-left'
  ): void => {
    if (onOpenSpacePopover) {
      const rect = el.getBoundingClientRect()
      onOpenSpacePopover({
        mode: 'create',
        anchor: {
          x: placement === 'right-top' ? width + 6 : rect.left,
          y: placement === 'bottom-left' ? rect.bottom + 6 : rect.top,
          placement
        }
      })
    } else {
      onCreateProfilePrompt()
    }
  }

  const commitInlineRename = (profile: BrowserProfile): void => {
    const trimmed = renameDraft.trim()
    setRenamingSpaceId(null)
    if (trimmed && trimmed !== profile.name) {
      onRenameProfileInline?.(profile.id, trimmed)
    }
  }

  const activeDownloads = downloads.filter((d) => d.state === 'progressing').length
  const ungroupedActiveSpaceWebCount = useMemo(
    () =>
      allTabs.filter(
        (t) =>
          t.profileId === headerPreviewProfile.id &&
          !t.isFavorite &&
          !t.isPinned &&
          t.url !== NEW_TAB_URL &&
          !t.groupId &&
          !isInternalArkoUrl(t.url)
      ).length,
    [allTabs, headerPreviewProfile.id]
  )

  const renderProfileSlide = (profile: BrowserProfile): React.ReactNode => {
    const isVisualSlide = profile.id === visualProfile.id
    const slideTheme = getArcSpaceTheme(profile.accentColor, isDark)
    const pTabs = allTabs.filter((t) => t.profileId === profile.id)
    const pGroups = allTabGroups.filter((g) => g.profileId === profile.id)
    const pActiveTabId = activeTabByProfile[profile.id]
    const pSplit = splitByProfile[profile.id] || splitView

    const favoriteTabs = pTabs.filter((t) => t.isFavorite)
    const pinnedTabs = pTabs.filter((t) => !t.isFavorite && t.isPinned)
    const todayTabs = pTabs.filter(
      (t) => !t.isFavorite && !t.isPinned && t.url !== NEW_TAB_URL
    )
    const pActiveTab = pTabs.find((t) => t.id === pActiveTabId) || pTabs[0]
    const isNewTabPromptOnSlide = Boolean(newTabPromptOpen && profile.id === activeProfile.id)
    const isNewTabRowActive =
      isNewTabPromptOnSlide ||
      Boolean(
        pActiveTab &&
          pActiveTab.url === NEW_TAB_URL &&
          !pActiveTab.isPinned &&
          !pActiveTab.isFavorite
      )

    const draggedTab = draggingTabId
      ? pTabs.find((t) => t.id === draggingTabId) ||
        allTabs.find((t) => t.id === draggingTabId)
      : undefined
    const hasAnyIncomingDrag = Boolean(
      draggedTab || externalDragLink || isExternalLinkHovering
    )

    const canClearToday =
      todayTabs.some((t) => t.url !== NEW_TAB_URL) ||
      (todayTabs.length > 0 && (favoriteTabs.length > 0 || pinnedTabs.length > 0))

    // Live Tiled Preview computation for Zone 1 (Top Pin Bar)
    const isFavLivePreviewActive =
      isVisualSlide &&
      dropZoneHover === 'favorite' &&
      favPreviewIndex !== null &&
      hasAnyIncomingDrag

    type FavSlotItem =
      | { kind: 'tab'; tab: TabState }
      | { kind: 'preview'; url?: string; favicon?: string; title: string }

    let favRenderSlots: FavSlotItem[] = favoriteTabs.map((tab) => ({ kind: 'tab', tab }))

    if (isFavLivePreviewActive) {
      const baseFavorites = draggedTab
        ? favoriteTabs.filter((t) => t.id !== draggedTab.id)
        : favoriteTabs
      const clampedIdx = Math.max(0, Math.min(baseFavorites.length, favPreviewIndex!))
      const previewSlot: FavSlotItem = {
        kind: 'preview',
        url: draggedTab?.url ?? externalDragLink?.url,
        favicon: draggedTab?.favicon,
        title: formatPreviewDomainLabel(
          draggedTab?.url ?? externalDragLink?.url,
          draggedTab?.title ?? externalDragLink?.title,
          tr(lang, 'Pinned Link', '新固定链接')
        )
      }
      favRenderSlots = baseFavorites.map((tab) => ({ kind: 'tab' as const, tab }))
      favRenderSlots.splice(clampedIdx, 0, previewSlot)
    }

    const effectiveFavCols = getFavColCount(favRenderSlots.length, width)
    const favGridColsClass = getFavGridColsClass(effectiveFavCols)

    const renderTabRow = (
      tab: TabState,
      zone: 'pinned' | 'unpinned',
      indented = false
    ): React.ReactNode => {
      const isActive = !isNewTabPromptOnSlide && tab.id === pActiveTabId
      const isBeingDragged = tab.id === draggingTabId
      const splitRole = pSplit?.enabled
        ? tab.id === pSplit.leftTabId
          ? tr(lang, 'L', '左')
          : tab.id === pSplit.rightTabId
            ? tr(lang, 'R', '右')
            : null
        : null

      const dropSide =
        zone !== 'pinned' && dragOverHint?.tabId === tab.id && dragOverHint?.zone === zone
          ? dragOverHint.pos
          : null
      const hasDriftedFromPinned =
        zone === 'pinned' && Boolean(tab.pinnedUrl && tab.url !== tab.pinnedUrl)

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
            resetAllDragPreviews()
            onTabDragStateChange?.(null)
          }}
          onDragOver={(e) => {
            if (zone === 'pinned') return
            const linkDrag = Boolean(externalDragLink) || hasExternalLinkDragPayload(e.dataTransfer)
            if (!draggingTabId && !linkDrag) return
            e.preventDefault()
            e.stopPropagation()
            if (linkDrag && !isExternalLinkHovering) setIsExternalLinkHovering(true)
            const rect = e.currentTarget.getBoundingClientRect()
            const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
            if (
              dragOverHint?.tabId !== tab.id ||
              dragOverHint.pos !== pos ||
              dragOverHint.zone !== zone
            ) {
              setDragOverHint({ tabId: tab.id, pos, zone })
            }
          }}
          onDragLeave={() => {
            if (dragOverHint?.tabId === tab.id) setDragOverHint(null)
          }}
          onDrop={(e) => {
            if (zone === 'pinned') return
            e.preventDefault()
            e.stopPropagation()
            const srcId = e.dataTransfer.getData('application/x-dia-tab-id') || draggingTabId
            const droppedUrl = !srcId
              ? extractDroppedExternalUrl(e.dataTransfer) || externalDragLink?.url
              : null
            const rect = e.currentTarget.getBoundingClientRect()
            const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
            resetAllDragPreviews()
            onTabDragStateChange?.(null)

            if (srcId && srcId !== tab.id) {
              onReorderTab?.(srcId, tab.id, pos, zone)
            } else if (srcId === tab.id) {
              onSetTabPinState(srcId, zone)
            } else if (droppedUrl) {
              onDropExternalUrl?.(droppedUrl, zone, pos === 'before' ? tab.id : null)
            }
          }}
          onClick={() => onSelectTab(tab.id)}
          onAuxClick={(e) => {
            if (e.button === 1) {
              if (zone === 'pinned') {
                onSetTabPinState(tab.id, 'unpinned')
              } else {
                onCloseTab(tab.id)
              }
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            onTabContextMenu(tab, { x: e.clientX, y: e.clientY })
          }}
          onDoubleClick={() => {
            if (!splitRole && tab.id !== pActiveTabId) {
              onOpenTabInSplit(tab.id)
            }
          }}
          style={
            isActive
              ? {
                  backgroundColor: slideTheme.activeTabBg,
                  boxShadow: slideTheme.activeTabShadow
                }
              : undefined
          }
          className={`arc-pressable group relative flex items-center gap-2.5 h-[32px] px-2.5 rounded-[10px] text-[12.5px] cursor-pointer ${
            indented ? 'pl-4' : ''
          } ${isBeingDragged ? 'opacity-45 scale-[0.98]' : ''} ${
            dropSide === 'before'
              ? isDark
                ? 'border-t border-t-zinc-300'
                : 'border-t border-t-zinc-700'
              : dropSide === 'after'
                ? isDark
                  ? 'border-b border-b-zinc-300'
                  : 'border-b border-b-zinc-700'
                : ''
          } ${
            isActive
              ? isDark
                ? 'text-white font-medium'
                : 'text-zinc-900 font-medium'
              : splitRole
                ? isDark
                  ? 'bg-white/[0.07] text-zinc-200'
                  : 'bg-white/60 text-zinc-800'
                : isDark
                  ? 'text-zinc-200/85 hover:bg-white/[0.07] hover:text-white'
                  : 'text-zinc-700 hover:bg-black/[0.045] hover:text-zinc-950'
          }`}
        >
          {isActive && (
            <span
              style={{ backgroundColor: slideTheme.accentHex }}
              className="w-[2.5px] h-3.5 rounded-full shrink-0 -ml-1"
            />
          )}

          {tab.isLoading ? (
            <Loader2 size={13.5} className="animate-spin opacity-60 shrink-0" />
          ) : (
            <FaviconIcon url={tab.url} favicon={tab.favicon} size={14} />
          )}

          {splitRole && (
            <span
              className={`px-1 rounded text-[9.5px] font-medium shrink-0 ${
                isDark ? 'bg-white/12 text-zinc-200' : 'bg-black/8 text-zinc-700'
              }`}
            >
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
              title={
                tab.isMuted ? tr(lang, 'Unmute', '取消静音') : tr(lang, 'Mute tab', '静音此标签页')
              }
              className="opacity-70 hover:opacity-100 p-0.5 rounded shrink-0"
            >
              {tab.isMuted ? <VolumeX size={11.5} /> : <Volume2 size={11.5} />}
            </button>
          )}

          {zone === 'pinned' ? (
            <div className="flex items-center gap-0.5 shrink-0">
              {hasDriftedFromPinned && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onResetPinnedTab(tab.id)
                  }}
                  title={tr(
                    lang,
                    'Reset to initial pinned URL',
                    '已偏离初始固定页 · 点击还原初始网址'
                  )}
                  className="opacity-60 hover:opacity-100 p-0.5 rounded"
                >
                  <RotateCcw size={11} />
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onSetTabPinState(tab.id, 'favorite')
                }}
                title={tr(
                  lang,
                  'Promote to Top Favorites Grid',
                  '升格到顶部常驻图标栏 (Favorites)'
                )}
                className="opacity-0 group-hover:opacity-55 hover:!opacity-100 p-0.5 rounded transition"
              >
                <Star size={11} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onSetTabPinState(tab.id, 'unpinned')
                }}
                title={tr(lang, 'Unpin tab', '取消固定（移回下方临时标签）')}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 rounded transition"
              >
                <PinOff size={11.5} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onSetTabPinState(tab.id, 'pinned')
                }}
                title={tr(
                  lang,
                  'Pin to Space (or drag above divider)',
                  '固定到上方 Pin 栏（也可向上拖拽）'
                )}
                className="opacity-0 group-hover:opacity-55 hover:!opacity-100 p-0.5 rounded transition"
              >
                <Pin size={11} />
              </button>

              {!splitRole && tab.id !== pActiveTabId && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenTabInSplit(tab.id)
                  }}
                  title={tr(lang, 'Open in Right Split View', '在右侧分屏中打开')}
                  className="opacity-0 group-hover:opacity-55 hover:!opacity-100 p-0.5 rounded transition"
                >
                  <Columns2 size={11} />
                </button>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
                title={tr(lang, 'Close Tab (⌘W)', '关闭标签 (⌘W)')}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 rounded transition"
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>
      )
    }

    const renderPinnedPreviewRow = (): React.ReactNode => {
      const previewUrl = draggedTab?.url ?? externalDragLink?.url
      const previewTitle = formatPreviewDomainLabel(
        previewUrl,
        draggedTab?.title ?? externalDragLink?.title,
        tr(lang, 'Drop to pin link here', '松开固定到此位置')
      )
      return (
        <div
          key="__pinned-live-preview__"
          className={`flex items-center gap-2.5 h-[32px] px-2.5 rounded-[10px] text-[12.5px] border border-dashed pointer-events-none transition-all ${
            isDark
              ? 'border-indigo-400/55 bg-indigo-500/[0.11] text-indigo-200'
              : 'border-indigo-500/45 bg-indigo-500/[0.07] text-indigo-800'
          }`}
        >
          {previewUrl ? (
            <FaviconIcon url={previewUrl} favicon={draggedTab?.favicon} size={14} />
          ) : (
            <Link2 size={13.5} className="opacity-75 shrink-0" />
          )}
          <span className="truncate flex-1 font-medium">{previewTitle}</span>
          <Pin size={11} className="opacity-70 shrink-0" />
        </div>
      )
    }

    const isPinnedLivePreviewActive =
      isVisualSlide &&
      dropZoneHover === 'pinned' &&
      pinnedPreviewIndex !== null &&
      hasAnyIncomingDrag

    const basePinnedTabs =
      isPinnedLivePreviewActive && draggedTab
        ? pinnedTabs.filter((t) => t.id !== draggedTab.id)
        : pinnedTabs

    const buildPinnedRows = (sourceTabs: TabState[]): React.ReactNode[] => {
      const renderedGroupIds = new Set<string>()
      const nodes: React.ReactNode[] = []
      const clampedPinnedPreview = isPinnedLivePreviewActive
        ? Math.max(0, Math.min(sourceTabs.length, pinnedPreviewIndex!))
        : null

      sourceTabs.forEach((tab, idx) => {
        if (clampedPinnedPreview === idx) {
          nodes.push(renderPinnedPreviewRow())
        }

        const grp = tab.groupId ? pGroups.find((g) => g.id === tab.groupId) : undefined
        if (grp) {
          if (renderedGroupIds.has(grp.id)) return
          renderedGroupIds.add(grp.id)
          const groupTabs = sourceTabs.filter((t) => t.groupId === grp.id)
          const activeInCollapsed = grp.collapsed
            ? groupTabs.find((t) => t.id === pActiveTabId)
            : undefined

          nodes.push(
            <div key={`vgrp-pinned-${grp.id}`} className="space-y-0.5">
              <button
                type="button"
                onClick={() => onToggleGroupCollapsed(grp.id)}
                className={`arc-pressable w-full flex items-center gap-2.5 h-[31px] px-2.5 rounded-[10px] text-[12.5px] font-medium ${
                  isDark
                    ? 'text-zinc-200/90 hover:bg-white/[0.06]'
                    : 'text-zinc-700 hover:bg-black/[0.04]'
                }`}
              >
                <Folder size={13.5} className="opacity-60 shrink-0 fill-current" />
                <span className="truncate flex-1 text-left">{grp.title}</span>
                <ChevronDown
                  size={12}
                  className={`opacity-45 shrink-0 transition-transform duration-200 ${
                    grp.collapsed ? '-rotate-90' : 'rotate-0'
                  }`}
                />
              </button>
              <div className="arc-collapse-grid" data-open={!grp.collapsed}>
                <div className="arc-collapse-inner space-y-0.5">
                  {groupTabs.map((child) => renderTabRow(child, 'pinned', true))}
                </div>
              </div>
              {activeInCollapsed && renderTabRow(activeInCollapsed, 'pinned', true)}
            </div>
          )
          return
        }

        nodes.push(renderTabRow(tab, 'pinned', false))
      })

      if (clampedPinnedPreview === sourceTabs.length) {
        nodes.push(renderPinnedPreviewRow())
      }

      return nodes
    }

    const buildTodayRows = (sourceTabs: TabState[]): React.ReactNode[] => {
      const renderedGroupIds = new Set<string>()
      const nodes: React.ReactNode[] = []

      for (const tab of sourceTabs) {
        const grp = tab.groupId ? pGroups.find((g) => g.id === tab.groupId) : undefined
        if (grp) {
          if (renderedGroupIds.has(grp.id)) continue
          renderedGroupIds.add(grp.id)
          const groupTabs = sourceTabs.filter((t) => t.groupId === grp.id)
          const activeInCollapsed = grp.collapsed
            ? groupTabs.find((t) => t.id === pActiveTabId)
            : undefined

          nodes.push(
            <div
              key={`vgrp-today-${grp.id}`}
              className={`rounded-xl p-1 my-1 transition-colors ${
                isDark ? 'bg-white/[0.035]' : 'bg-black/[0.03]'
              }`}
            >
              <button
                type="button"
                onClick={() => onToggleGroupCollapsed(grp.id)}
                className={`arc-pressable w-full flex items-center gap-2 h-[29px] px-2 rounded-lg text-[12px] font-medium ${
                  isDark
                    ? 'text-zinc-300 hover:bg-white/[0.05]'
                    : 'text-zinc-700 hover:bg-black/[0.04]'
                }`}
              >
                <Folder size={12.5} className="opacity-55 shrink-0" />
                <span className="truncate flex-1 text-left">{grp.title}</span>
                <ChevronDown
                  size={12}
                  className={`opacity-45 shrink-0 transition-transform duration-200 ${
                    grp.collapsed ? '-rotate-90' : 'rotate-0'
                  }`}
                />
              </button>
              <div className="arc-collapse-grid" data-open={!grp.collapsed}>
                <div className="arc-collapse-inner space-y-0.5 pt-0.5">
                  {groupTabs.map((child) => renderTabRow(child, 'unpinned', true))}
                </div>
              </div>
              {activeInCollapsed && (
                <div className="pt-0.5">{renderTabRow(activeInCollapsed, 'unpinned', true)}</div>
              )}
            </div>
          )
          continue
        }

        nodes.push(renderTabRow(tab, 'unpinned', false))
      }
      return nodes
    }

    const pinnedNodes = buildPinnedRows(basePinnedTabs)
    const todayNodes = buildTodayRows(todayTabs)

    return (
      <div
        key={profile.id}
        style={
          isSwiping
            ? {
                background: `radial-gradient(100% 45% at 50% 0%, rgba(${slideTheme.rgbString}, ${
                  isDark ? 0.16 : 0.12
                }) 0%, transparent 75%)`
              }
            : undefined
        }
        className="w-full shrink-0 basis-full h-full flex flex-col min-w-0 min-h-0 pt-0.5"
      >
        {/* ==================== Zone 1: Top Favorites / Pin Bar ==================== */}
        <div
          onDragOver={(e) => {
            const linkDrag = Boolean(externalDragLink) || hasExternalLinkDragPayload(e.dataTransfer)
            if (!draggedTab && !linkDrag) return

            e.preventDefault()
            e.dataTransfer.dropEffect = draggedTab ? 'move' : 'copy'
            if (linkDrag && !isExternalLinkHovering) setIsExternalLinkHovering(true)
            if (dropZoneHover !== 'favorite') setDropZoneHover('favorite')
            if (pinnedPreviewIndex !== null) setPinnedPreviewIndex(null)

            const baseCount = draggedTab
              ? favoriteTabs.filter((t) => t.id !== draggedTab.id).length
              : favoriteTabs.length
            const totalCount = baseCount + 1
            const cols = getFavColCount(totalCount, width)
            const rows = Math.max(1, Math.ceil(totalCount / cols))

            const boxEl = isVisualSlide && favGridRef.current ? favGridRef.current : e.currentTarget
            const rect = boxEl.getBoundingClientRect()
            const relX = Math.max(
              0,
              Math.min(0.9999, (e.clientX - rect.left) / Math.max(1, rect.width))
            )
            const relY = Math.max(
              0,
              Math.min(0.9999, (e.clientY - rect.top) / Math.max(1, rect.height))
            )
            const col = Math.floor(relX * cols)
            const row = rows <= 1 ? 0 : Math.floor(relY * rows)
            const nextIdx = Math.max(0, Math.min(baseCount, row * cols + col))

            if (favPreviewIndex !== nextIdx) {
              setFavPreviewIndex(nextIdx)
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              if (dropZoneHover === 'favorite') setDropZoneHover(null)
              setFavPreviewIndex(null)
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            const srcId = e.dataTransfer.getData('application/x-dia-tab-id') || draggingTabId
            const droppedUrl = !srcId
              ? extractDroppedExternalUrl(e.dataTransfer) || externalDragLink?.url
              : null

            const baseFavorites = srcId
              ? favoriteTabs.filter((t) => t.id !== srcId)
              : favoriteTabs
            const targetIdx = Math.max(
              0,
              Math.min(baseFavorites.length, favPreviewIndex ?? baseFavorites.length)
            )

            resetAllDragPreviews()
            onTabDragStateChange?.(null)

            if (srcId) {
              if (baseFavorites.length === 0) {
                onMoveTabToZone(srcId, 'favorite')
              } else if (targetIdx < baseFavorites.length) {
                onReorderTab?.(srcId, baseFavorites[targetIdx].id, 'before', 'favorite')
              } else {
                onReorderTab?.(
                  srcId,
                  baseFavorites[baseFavorites.length - 1].id,
                  'after',
                  'favorite'
                )
              }
            } else if (droppedUrl) {
              const insertBeforeId =
                targetIdx < baseFavorites.length ? baseFavorites[targetIdx].id : null
              onDropExternalUrl?.(droppedUrl, 'favorite', insertBeforeId)
            }
          }}
          className="px-2.5 pb-1.5 shrink-0"
        >
          {favRenderSlots.length > 0 ? (
            <div
              ref={isVisualSlide ? favGridRef : undefined}
              className={`grid ${favGridColsClass} gap-1.5 rounded-xl transition-all duration-150 ${
                isFavLivePreviewActive
                  ? isDark
                    ? 'p-1 -m-1 ring-1 ring-indigo-400/30 bg-indigo-500/[0.04]'
                    : 'p-1 -m-1 ring-1 ring-indigo-500/25 bg-indigo-500/[0.03]'
                  : hasAnyIncomingDrag && isVisualSlide
                    ? isDark
                      ? 'p-0.5 -m-0.5 ring-1 ring-dashed ring-white/15'
                      : 'p-0.5 -m-0.5 ring-1 ring-dashed ring-black/15'
                    : ''
              }`}
            >
              {favRenderSlots.map((slot) => {
                if (slot.kind === 'preview') {
                  return (
                    <div
                      key="__fav-live-preview__"
                      className={`relative h-[38px] rounded-[11px] border border-dashed flex items-center justify-center gap-2 px-2 pointer-events-none transition-all duration-150 ${
                        isDark
                          ? 'border-indigo-400/65 bg-indigo-500/[0.14] text-indigo-100 shadow-xs'
                          : 'border-indigo-500/55 bg-indigo-500/[0.09] text-indigo-900 shadow-2xs'
                      }`}
                    >
                      {slot.url ? (
                        <FaviconIcon url={slot.url} favicon={slot.favicon} size={16} />
                      ) : (
                        <Link2 size={15} className="opacity-80 shrink-0" />
                      )}
                      {favRenderSlots.length === 1 && (
                        <span className="text-[11.5px] font-medium truncate min-w-0">
                          {slot.title}
                        </span>
                      )}
                      <span
                        className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${
                          isDark ? 'bg-indigo-300' : 'bg-indigo-500'
                        }`}
                      />
                    </div>
                  )
                }

                const tab = slot.tab
                const isActive = !isNewTabPromptOnSlide && tab.id === pActiveTabId
                const inSplit =
                  pSplit?.enabled &&
                  (tab.id === pSplit.leftTabId || tab.id === pSplit.rightTabId)
                const drifted = Boolean(tab.pinnedUrl && tab.url !== tab.pinnedUrl)

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
                      resetAllDragPreviews()
                      onTabDragStateChange?.(null)
                    }}
                    onClick={() => onSelectTab(tab.id)}
                    onDoubleClick={() => {
                      if (drifted) onResetPinnedTab(tab.id)
                    }}
                    onAuxClick={(e) => {
                      if (e.button === 1) onSetTabPinState(tab.id, 'unpinned')
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      onTabContextMenu(tab, { x: e.clientX, y: e.clientY })
                    }}
                    title={`${tab.title || tab.url}${drifted ? ' (双击还原初始固定页)' : ''} · 拖拽排序或右键管理`}
                    style={
                      isActive
                        ? {
                            backgroundColor: slideTheme.favActiveBg,
                            boxShadow: slideTheme.favActiveShadow
                          }
                        : inSplit
                          ? undefined
                          : {
                              backgroundColor: slideTheme.favIdleBg,
                              boxShadow: slideTheme.favIdleShadow
                            }
                    }
                    className={`arc-fav-pressable group relative h-[38px] rounded-[11px] flex items-center justify-center gap-2 px-2 cursor-pointer ${
                      isActive
                        ? ''
                        : inSplit
                          ? isDark
                            ? 'bg-white/[0.10] ring-1 ring-white/20'
                            : 'bg-white/85 ring-1 ring-black/10'
                          : isDark
                            ? 'hover:!bg-white/[0.12]'
                            : 'hover:!bg-white/85'
                    }`}
                  >
                    {tab.isLoading ? (
                      <Loader2 size={15} className="animate-spin opacity-60 shrink-0" />
                    ) : (
                      <FaviconIcon url={tab.url} favicon={tab.favicon} size={16} />
                    )}

                    {favRenderSlots.length === 1 && (
                      <span className="text-[11.5px] font-medium truncate min-w-0">
                        {tab.title || tr(lang, 'Favorite', '常驻标签')}
                      </span>
                    )}

                    {tab.isAudioPlaying && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          onMuteTab(tab.id)
                        }}
                        className={`absolute top-1 right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                          isDark ? 'bg-zinc-200 text-zinc-900' : 'bg-zinc-800 text-white'
                        }`}
                      >
                        {tab.isMuted ? <VolumeX size={8} /> : <Volume2 size={8} />}
                      </span>
                    )}

                    {drifted && !tab.isAudioPlaying && (
                      <span
                        title={tr(
                          lang,
                          'Drifted from pinned URL (double-click to reset)',
                          '已偏离初始固定网址（双击还原）'
                        )}
                        className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
                          isDark ? 'bg-zinc-300/75' : 'bg-zinc-600/75'
                        }`}
                      />
                    )}

                    {isActive && (
                      <span
                        style={{ backgroundColor: slideTheme.accentHex }}
                        className="absolute bottom-1 left-1/2 -translate-x-1/2 w-3.5 h-[2.5px] rounded-full"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          ) : hasAnyIncomingDrag ? (
            <div
              className={`h-[38px] rounded-[11px] border border-dashed flex items-center justify-center gap-2 px-3 text-[11.5px] font-medium transition-all ${
                isDark
                  ? 'border-white/20 bg-white/[0.03] text-zinc-300'
                  : 'border-black/15 bg-black/[0.025] text-zinc-600'
              }`}
            >
              <Star size={12} className="opacity-75 shrink-0" />
              <span className="truncate">
                {tr(lang, 'Drag here to pin to Favorites', '拖至此处固定到顶部常驻')}
              </span>
            </div>
          ) : null}
        </div>

        {/* ==================== Zone 2: Pinned Tabs + Hairline Divider + Today Tabs ==================== */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5 min-h-0">
          {(pinnedNodes.length > 0 || hasAnyIncomingDrag) && (
            <div
              onDragOver={(e) => {
                const linkDrag =
                  Boolean(externalDragLink) || hasExternalLinkDragPayload(e.dataTransfer)
                if (!draggedTab && !linkDrag) return

                e.preventDefault()
                e.dataTransfer.dropEffect = draggedTab ? 'move' : 'copy'
                if (linkDrag && !isExternalLinkHovering) setIsExternalLinkHovering(true)
                if (dropZoneHover !== 'pinned') setDropZoneHover('pinned')
                if (favPreviewIndex !== null) setFavPreviewIndex(null)

                const baseList = draggedTab
                  ? pinnedTabs.filter((t) => t.id !== draggedTab.id)
                  : pinnedTabs
                const rect = e.currentTarget.getBoundingClientRect()
                const rowHeight = 33
                const relY = Math.max(0, e.clientY - rect.top)
                const nextIdx = Math.max(
                  0,
                  Math.min(baseList.length, Math.floor(relY / rowHeight))
                )
                if (pinnedPreviewIndex !== nextIdx) {
                  setPinnedPreviewIndex(nextIdx)
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  if (dropZoneHover === 'pinned') setDropZoneHover(null)
                  setPinnedPreviewIndex(null)
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                const srcId =
                  e.dataTransfer.getData('application/x-dia-tab-id') || draggingTabId
                const droppedUrl = !srcId
                  ? extractDroppedExternalUrl(e.dataTransfer) || externalDragLink?.url
                  : null

                const baseList = srcId
                  ? pinnedTabs.filter((t) => t.id !== srcId)
                  : pinnedTabs
                const targetIdx = Math.max(
                  0,
                  Math.min(baseList.length, pinnedPreviewIndex ?? baseList.length)
                )

                resetAllDragPreviews()
                onTabDragStateChange?.(null)

                if (srcId) {
                  if (baseList.length === 0) {
                    onMoveTabToZone(srcId, 'pinned')
                  } else if (targetIdx < baseList.length) {
                    onReorderTab?.(srcId, baseList[targetIdx].id, 'before', 'pinned')
                  } else {
                    onReorderTab?.(srcId, baseList[baseList.length - 1].id, 'after', 'pinned')
                  }
                } else if (droppedUrl) {
                  const insertBeforeId =
                    targetIdx < baseList.length ? baseList[targetIdx].id : null
                  onDropExternalUrl?.(droppedUrl, 'pinned', insertBeforeId)
                }
              }}
              className={`space-y-0.5 rounded-xl transition-all ${
                isPinnedLivePreviewActive
                  ? isDark
                    ? 'bg-white/[0.04] ring-1 ring-indigo-400/25 p-1 -mx-1'
                    : 'bg-black/[0.03] ring-1 ring-indigo-500/20 p-1 -mx-1'
                  : ''
              }`}
            >
              {pinnedNodes}
              {pinnedNodes.length === 0 && hasAnyIncomingDrag && !isPinnedLivePreviewActive && (
                <div
                  className={`h-7 rounded-lg border border-dashed flex items-center justify-center gap-1.5 text-[10.5px] ${
                    isDark
                      ? 'border-white/14 text-zinc-400/80'
                      : 'border-black/12 text-zinc-500/85'
                  }`}
                >
                  <Pin size={10.5} />
                  <span>{tr(lang, 'Drop to pin to Space', '拖拽至此固定到本空间列表')}</span>
                </div>
              )}
            </div>
          )}

          {/* Subtle Space-Tinted Divider with Hover "Clear" */}
          <div className="group/divider flex items-center gap-2 px-2 py-1">
            <div
              style={{ borderTopColor: slideTheme.dividerColor }}
              className="flex-1 border-t transition-colors"
            />
            {canClearToday && (
              <button
                type="button"
                onClick={() => onClearUnpinnedTabs(profile.id)}
                title={tr(
                  lang,
                  'Clear unpinned tabs (⇧⌘T to undo)',
                  '清理下方临时标签页（支持 ⇧⌘T 恢复）'
                )}
                className="arc-pressable text-[10px] font-medium px-1.5 py-0.5 rounded-md opacity-0 group-hover/divider:opacity-65 hover:!opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
              >
                {tr(lang, 'Clear', '清理')}
              </button>
            )}
          </div>

          {/* "+ New Tab" Action Row & Today Unpinned Zone */}
          <div
            onDragOver={(e) => {
              const linkDrag =
                Boolean(externalDragLink) || hasExternalLinkDragPayload(e.dataTransfer)
              if (!draggedTab && !linkDrag) return
              e.preventDefault()
              if (linkDrag && !isExternalLinkHovering) setIsExternalLinkHovering(true)
              if (dropZoneHover !== 'unpinned') setDropZoneHover('unpinned')
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                if (dropZoneHover === 'unpinned') setDropZoneHover(null)
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              const srcId =
                e.dataTransfer.getData('application/x-dia-tab-id') || draggingTabId
              const droppedUrl = !srcId
                ? extractDroppedExternalUrl(e.dataTransfer) || externalDragLink?.url
                : null
              resetAllDragPreviews()
              onTabDragStateChange?.(null)
              if (srcId) {
                onMoveTabToZone(srcId, 'unpinned')
              } else if (droppedUrl) {
                onDropExternalUrl?.(droppedUrl, 'unpinned', null)
              }
            }}
            className="space-y-0.5 min-h-[72px]"
          >
            <button
              type="button"
              onClick={onNewTab}
              title={tr(
                lang,
                'New Tab — Enter URL, Search, or Ask AI (⌘T)',
                '新建标签页 — 输入网址、搜索或向 AI 提问 (⌘T)'
              )}
              style={
                isNewTabRowActive
                  ? {
                      backgroundColor: slideTheme.activeTabBg,
                      boxShadow: slideTheme.activeTabShadow
                    }
                  : undefined
              }
              className={`arc-pressable group/newtab w-full h-[32px] px-2.5 rounded-[10px] flex items-center justify-between gap-2 text-[12.5px] ${
                isNewTabRowActive
                  ? isDark
                    ? 'text-white font-medium'
                    : 'text-zinc-900 font-medium'
                  : isDark
                    ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]'
                    : 'text-zinc-500 hover:text-zinc-800 hover:bg-black/[0.04]'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                {isNewTabRowActive && (
                  <span
                    style={{ backgroundColor: slideTheme.accentHex }}
                    className="w-[2.5px] h-3.5 rounded-full shrink-0 -ml-1"
                  />
                )}
                <Plus
                  size={14}
                  className={isNewTabRowActive ? 'opacity-95 shrink-0' : 'opacity-75 shrink-0'}
                />
                <span className="truncate">{tr(lang, 'New Tab', '新建标签页')}</span>
              </span>
              <span
                className={`text-[10.5px] font-mono transition shrink-0 ${
                  isNewTabRowActive
                    ? 'opacity-55'
                    : 'opacity-0 group-hover/newtab:opacity-45'
                }`}
              >
                ⌘T
              </span>
            </button>

            {todayNodes}
          </div>
        </div>
      </div>
    )
  }

  return (
    <aside
      onWheel={handleWheelSwipe}
      onMouseDown={handleMouseSwipeStart}
      style={{
        width,
        background: isPeekOverlay ? liveSpaceTheme.sidebarBackground : 'transparent',
        borderColor: isPeekOverlay ? liveSpaceTheme.sidebarBorderColor : 'transparent',
        boxShadow: isPeekOverlay
          ? isDark
            ? '0 24px 56px -12px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(255, 255, 255, 0.08)'
            : '0 20px 48px -10px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(0, 0, 0, 0.06)'
          : undefined
      }}
      className={`relative shrink-0 h-full flex flex-col select-none overflow-hidden ${
        isPeekOverlay ? 'rounded-2xl border backdrop-blur-2xl' : ''
      } ${isDark ? 'text-zinc-100' : 'text-zinc-800'}`}
    >
      {/* Right-Edge Draggable Width Resize Handle */}
      {!isPeekOverlay && (
        <div
          data-no-swipe="true"
          onMouseDown={handleStartSidebarResize}
          onDoubleClick={(e) => {
            e.stopPropagation()
            onResizeWidth?.(DEFAULT_SIDEBAR_WIDTH, true)
          }}
          title={tr(
            lang,
            'Drag to resize tab sidebar · Double-click to reset width',
            '拖拽调整左侧标签栏宽度 · 双击恢复默认宽度'
          )}
          style={isResizing ? { backgroundColor: liveSpaceTheme.accentHex } : undefined}
          className={`app-no-drag absolute right-0 top-2 bottom-2 w-1.5 rounded-full z-30 cursor-col-resize transition-colors ${
            isResizing
              ? 'opacity-80'
              : isDark
                ? 'hover:bg-white/20'
                : 'hover:bg-black/15'
          }`}
        />
      )}

      {/* Row 1: Dia Top-Left Space Header beside macOS Traffic Lights */}
      <div
        className={`group/spacehdr relative z-10 ${isPeekOverlay ? '' : 'app-drag'} h-[40px] flex items-center justify-between gap-1 shrink-0 ${
          platform === 'darwin' && !isPeekOverlay ? 'pl-[76px] pr-2.5' : 'pl-3 pr-2.5'
        }`}
      >
        {renamingSpaceId === headerPreviewProfile.id ? (
          <div className="app-no-drag flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-[13px] leading-none shrink-0">{headerPreviewProfile.emoji}</span>
            <input
              ref={renameInputRef}
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => commitInlineRename(headerPreviewProfile)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitInlineRename(headerPreviewProfile)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setRenamingSpaceId(null)
                }
              }}
              className={`flex-1 min-w-0 h-6 px-1.5 rounded-md text-[12px] font-semibold outline-none border ${
                isDark
                  ? 'bg-black/30 border-white/20 text-white'
                  : 'bg-white/90 border-black/20 text-zinc-900'
              }`}
            />
          </div>
        ) : (
          <div className="app-no-drag flex items-center gap-1 min-w-0 flex-1">
            <button
              type="button"
              onClick={(e) => triggerEditSpace(headerPreviewProfile, e.currentTarget, 'right-top')}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setRenameDraft(headerPreviewProfile.name)
                setRenamingSpaceId(headerPreviewProfile.id)
              }}
              title={tr(
                lang,
                `${headerPreviewProfile.name} — Click for Space theme · Double-click to rename`,
                `${headerPreviewProfile.name} — 点击调整空间主题 · 双击直接重命名`
              )}
              className={`arc-pressable px-1.5 py-1 -ml-1 rounded-lg flex items-center gap-1.5 min-w-0 text-[12.5px] font-semibold tracking-tight opacity-85 hover:opacity-100 transition ${
                isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.045]'
              }`}
            >
              <span className="text-[12.5px] leading-none shrink-0">
                {headerPreviewProfile.emoji}
              </span>
              <span className="truncate">{headerPreviewProfile.name}</span>
            </button>
          </div>
        )}

        <div className="app-no-drag flex items-center gap-0.5 shrink-0">
          <div className="flex items-center gap-0.5 opacity-0 group-hover/spacehdr:opacity-100 transition-opacity duration-150">
            {ungroupedActiveSpaceWebCount >= 3 && (
              <button
                type="button"
                onClick={onOrganizeTabs}
                disabled={organizingTabs}
                title={tr(lang, 'Tidy tabs into folders (/organize)', 'AI 智能整理分组 (/organize)')}
                className={`arc-pressable p-1 rounded-md opacity-65 hover:opacity-100 ${
                  isDark ? 'hover:bg-white/10' : 'hover:bg-black/6'
                }`}
              >
                {organizingTabs ? (
                  <Loader2 size={11.5} className="animate-spin" />
                ) : (
                  <FolderKanban size={11.5} />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setRenameDraft(headerPreviewProfile.name)
                setRenamingSpaceId(headerPreviewProfile.id)
              }}
              title={tr(lang, 'Rename Space', '重命名空间')}
              className={`arc-pressable p-1 rounded-md opacity-60 hover:opacity-100 ${
                isDark ? 'hover:bg-white/10' : 'hover:bg-black/6'
              }`}
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              onClick={(e) => triggerEditSpace(headerPreviewProfile, e.currentTarget, 'right-top')}
              title={tr(lang, 'Space theme, icon & options', '空间主题、图标与设置')}
              className={`arc-pressable p-1 rounded-md opacity-65 hover:opacity-100 ${
                isDark ? 'hover:bg-white/10' : 'hover:bg-black/6'
              }`}
            >
              <MoreHorizontal size={13} />
            </button>
          </div>

          {isPeekOverlay && (
            <button
              type="button"
              onClick={onCollapseSidebar}
              title={tr(lang, 'Pin Sidebar Open (⇧⌘S)', '固定展开侧边栏 (⇧⌘S)')}
              className="arc-pressable p-1.5 rounded-lg opacity-65 hover:opacity-100 hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
            >
              <PanelLeft size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Horizontal Space / Profile Carousel Viewport */}
      <div className="relative z-10 flex-1 min-h-0 overflow-hidden">
        <div
          style={{
            transform: `translate3d(calc(${-currentProfileIndex * 100}% + ${dragOffsetPx}px), 0, 0)`,
            transition: isSwiping
              ? 'none'
              : snapMode === 'boundary'
                ? 'transform 420ms cubic-bezier(0.24, 1.56, 0.38, 1)'
                : snapMode === 'rebound'
                  ? 'transform 360ms cubic-bezier(0.22, 1.22, 0.36, 1)'
                  : 'transform 320ms cubic-bezier(0.16, 1, 0.3, 1)'
          }}
          className="flex w-full h-full will-change-transform"
        >
          {profiles.map((profile) => renderProfileSlide(profile))}
        </div>
      </div>

      {/* Subtle One-Click Update Pill Banner */}
      {onOpenUpdatePanel &&
        (updateState?.status === 'available' ||
          updateState?.status === 'downloading' ||
          updateState?.status === 'downloaded') && (
          <div className="relative z-10 px-2.5 pb-1.5 shrink-0">
            <button
              type="button"
              onClick={onOpenUpdatePanel}
              className={`arc-pressable w-full px-2.5 py-1.5 rounded-lg border text-[11px] font-medium flex items-center justify-between gap-2 ${
                updateState.status === 'downloaded'
                  ? isDark
                    ? 'bg-zinc-100 text-zinc-900 border-white/20 hover:bg-white'
                    : 'bg-zinc-900 text-white border-black/20 hover:bg-zinc-800'
                  : isDark
                    ? 'bg-white/[0.06] border-white/10 text-zinc-200 hover:bg-white/[0.10]'
                    : 'bg-black/[0.04] border-black/8 text-zinc-700 hover:bg-black/[0.07]'
              }`}
            >
              <span className="flex items-center gap-1.5 truncate">
                <ArrowDownCircle size={12.5} className="shrink-0 opacity-80" />
                <span className="truncate">
                  {updateState.status === 'downloaded'
                    ? tr(
                        lang,
                        `Restart to Update (v${updateState.latestVersion})`,
                        `重启完成更新 (v${updateState.latestVersion})`
                      )
                    : updateState.status === 'downloading'
                      ? tr(
                          lang,
                          `Downloading v${updateState.latestVersion} (${updateState.progressPercent || 0}%)…`,
                          `正在下载 v${updateState.latestVersion} (${updateState.progressPercent || 0}%)…`
                        )
                      : tr(
                          lang,
                          `Update v${updateState.latestVersion} available`,
                          `新版本 v${updateState.latestVersion} 可用`
                        )}
                </span>
              </span>
            </button>
          </div>
        )}

      {/* Compact Upward Sidebar Utility Menu */}
      {footerMenuOpen && (
        <>
          <div onClick={() => setFooterMenuOpen(false)} className="fixed inset-0 z-30" />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ transformOrigin: 'bottom right' }}
            className={`arc-popover-up-enter absolute bottom-10 left-2.5 right-2.5 z-40 rounded-2xl border p-1.5 shadow-2xl backdrop-blur-2xl text-[12px] space-y-0.5 ${
              isDark
                ? 'bg-[#25252B]/96 border-white/12 text-zinc-200'
                : 'bg-white/96 border-black/10 text-zinc-800'
            }`}
          >
            {onOpenAccount && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setFooterMenuOpen(false)
                    onOpenAccount()
                  }}
                  className={`arc-pressable w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl ${
                    isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.05]'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <UserRound
                      size={13}
                      className={
                        accountState?.authenticated ? 'text-emerald-500 shrink-0' : 'opacity-60 shrink-0'
                      }
                    />
                    <span className="truncate font-medium">
                      {accountState?.authenticated && accountState.user
                        ? accountState.user.email || accountState.user.username
                        : tr(lang, 'Sign in to Arko Account…', '登录 / 注册 Arko 账号…')}
                    </span>
                  </span>
                  {accountState?.authenticated && typeof accountState.user?.remainingUsd === 'number' && (
                    <span className="text-[10.5px] font-mono text-emerald-500 shrink-0 ml-1.5">
                      ${accountState.user.remainingUsd.toFixed(2)}
                    </span>
                  )}
                </button>
                <div className={`my-1 border-t ${isDark ? 'border-white/8' : 'border-black/6'}`} />
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setFooterMenuOpen(false)
                onOpenLibrary()
              }}
              className={`arc-pressable w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl ${
                isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.05]'
              }`}
            >
              <Clock size={13} className="opacity-60" />
              <span>{tr(lang, 'Archive, History & Bookmarks', '历史记录与收藏夹')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setFooterMenuOpen(false)
                onOpenDownloads()
              }}
              className={`arc-pressable w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl ${
                isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.05]'
              }`}
            >
              <span className="flex items-center gap-2">
                <Download size={13} className="opacity-60" />
                <span>{tr(lang, 'Downloads', '下载管理')}</span>
              </span>
              {downloads.length > 0 && (
                <span className="text-[10.5px] opacity-50">{downloads.length}</span>
              )}
            </button>

            <div className={`my-1 border-t ${isDark ? 'border-white/8' : 'border-black/6'}`} />

            <button
              type="button"
              onClick={(e) => {
                const target = e.currentTarget
                setFooterMenuOpen(false)
                triggerCreateSpace(target, 'top-left')
              }}
              className={`arc-pressable w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl ${
                isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.05]'
              }`}
            >
              <Plus size={13} className="opacity-60" />
              <span>{tr(lang, 'New Space…', '新建隔离空间…')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setFooterMenuOpen(false)
                onSwitchLayout()
              }}
              className={`arc-pressable w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl ${
                isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.05]'
              }`}
            >
              <span className="flex items-center gap-2">
                <PanelTop size={13} className="opacity-60" />
                <span>{tr(lang, 'Top Tab Bar Layout', '切换顶部水平标签栏')}</span>
              </span>
              <span className="text-[10.5px] opacity-40 font-mono">⌘\</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setFooterMenuOpen(false)
                onOpenSettings()
              }}
              className={`arc-pressable w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl ${
                isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.05]'
              }`}
            >
              <span className="flex items-center gap-2">
                <Settings size={13} className="opacity-60" />
                <span>{tr(lang, 'Settings', '设置')}</span>
              </span>
              <span className="text-[10.5px] opacity-40 font-mono">⌘,</span>
            </button>
          </div>
        </>
      )}

      {/* Row 4: Arc-Style Bottom Space Switcher Dock & Utility Trigger */}
      <div
        style={{ borderTopColor: liveSpaceTheme.dividerColor }}
        className="relative z-10 h-[36px] px-2.5 border-t flex items-center justify-between gap-1 shrink-0"
      >
        <button
          type="button"
          onClick={activeDownloads > 0 ? onOpenDownloads : onOpenLibrary}
          title={
            activeDownloads > 0
              ? tr(lang, 'Downloads in progress', '查看正在进行的下载')
              : tr(lang, 'Library — History & Bookmarks', '历史记录与收藏夹')
          }
          className="arc-pressable p-1 rounded-md opacity-50 hover:opacity-95 hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
        >
          {activeDownloads > 0 ? (
            <Download size={12.5} className="animate-pulse" />
          ) : (
            <Clock size={12.5} />
          )}
        </button>

        {/* Arc-Style Color-Coded Space Switcher Icons */}
        <div
          title={tr(
            lang,
            'Click Space icon or two-finger swipe to switch · Right-click to customize theme',
            '点击空间图标或双指左右滑动切换 · 右键自定义空间氛围色'
          )}
          className="flex items-center justify-center gap-1 overflow-x-auto no-scrollbar min-w-0 py-0.5"
        >
          {profiles.map((p) => {
            const isSelected = p.id === headerPreviewProfile.id
            const pTheme = getArcSpaceTheme(p.accentColor, isDark)
            return (
              <button
                key={p.id}
                type="button"
                onClick={(e) => {
                  if (isSelected) {
                    triggerEditSpace(p, e.currentTarget, 'top-left')
                  } else {
                    commitProfileSwitch(p.id)
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  triggerEditSpace(p, e.currentTarget, 'top-left')
                }}
                title={
                  isSelected
                    ? tr(
                        lang,
                        `${p.name} (Click or right-click to edit Space theme)`,
                        `${p.name}（再次点击或右键调整空间主题色）`
                      )
                    : tr(
                        lang,
                        `${p.name} (Click to switch · Right-click for theme)`,
                        `${p.name}（点击切换 · 右键调整主题色）`
                      )
                }
                style={
                  isSelected
                    ? {
                        backgroundColor: pTheme.spaceBadgeBg,
                        boxShadow: `inset 0 0 0 1px ${pTheme.spaceBadgeBorder}`
                      }
                    : undefined
                }
                className={`arc-fav-pressable relative h-[24px] min-w-[24px] px-1.5 rounded-[7px] flex items-center justify-center shrink-0 group/sp ${
                  isSelected
                    ? 'opacity-100'
                    : isDark
                      ? 'opacity-50 hover:opacity-95 hover:bg-white/[0.08]'
                      : 'opacity-55 hover:opacity-95 hover:bg-black/[0.05]'
                }`}
              >
                <span className="text-[12px] leading-none">{p.emoji}</span>
                <span
                  style={{ backgroundColor: pTheme.accentHex }}
                  className={`absolute bottom-[2px] left-1/2 -translate-x-1/2 rounded-full transition-all duration-200 ${
                    isSelected ? 'w-3 h-[2px] opacity-100' : 'w-1 h-1 opacity-75 group-hover/sp:w-2'
                  }`}
                />
              </button>
            )
          })}
          <button
            type="button"
            onClick={(e) => triggerCreateSpace(e.currentTarget, 'top-left')}
            title={tr(lang, 'New Space…', '新建隔离空间…')}
            className={`arc-fav-pressable h-[22px] w-[22px] rounded-[7px] flex items-center justify-center shrink-0 ${
              isDark
                ? 'opacity-40 hover:opacity-95 hover:bg-white/[0.08]'
                : 'opacity-45 hover:opacity-95 hover:bg-black/[0.05]'
            }`}
          >
            <Plus size={11.5} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setFooterMenuOpen((v) => !v)}
          title={tr(lang, 'More options & Settings', '更多功能与设置')}
          className={`arc-pressable p-1 rounded-md shrink-0 ${
            footerMenuOpen
              ? 'opacity-95 bg-black/5 dark:bg-white/10'
              : 'opacity-50 hover:opacity-95 hover:bg-black/5 dark:hover:bg-white/10'
          }`}
        >
          <MoreHorizontal size={13.5} />
        </button>
      </div>
    </aside>
  )
}
