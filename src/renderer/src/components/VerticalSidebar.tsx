import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownCircle,
  ChevronDown,
  Clock,
  Columns2,
  Download,
  Folder,
  FolderKanban,
  FolderOpen,
  Link2,
  Loader2,
  PanelLeft,
  PanelTop,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Star,
  Trash2,
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
  isProfileMenuOpen?: boolean
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
    insertBeforeTabId?: string | null,
    groupId?: string | null
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
  onAssignTabToGroup?: (tabId: string, groupId: string | null) => void
  onUpdateTabGroup?: (
    groupId: string,
    partial: Partial<Pick<TabGroup, 'title' | 'color' | 'collapsed'>>
  ) => void
  onDeleteTabGroup?: (groupId: string) => void
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

// Dia / Arc tactile Space swipe & critically-damped rubber-band physics
const SWIPE_LOCK_X_PX = 5
const SWIPE_LOCK_Y_PX = 6.5
const SWIPE_AXIS_RATIO = 1.35
const SWIPE_TRACKING_GAIN = 0.86
const SWIPE_SNAP_RATIO = 0.34
const SWIPE_PROJECTION_SEC = 0.14
const SWIPE_FLICK_MIN_DIST_RATIO = 0.16
const SWIPE_MAX_REF_WIDTH = 260

// Taut NSScrollView-style boundary rubber-band (< 18px asymptotic ceiling so pills never clip)
const BOUNDARY_RUBBER_MAX_PX = 18
const BOUNDARY_RUBBER_COEFF = 0.48

// Critically-damped harmonic oscillator (zeta = 1.0 -> zero overshoot, zero multi-bounce)
const SPRING_OMEGA_BOUNDARY = 25
const SPRING_OMEGA_REBOUND = 23
const SPRING_OMEGA_SWITCH = 22

function computeBoundaryRubberBand(rawOverscrollPx: number): number {
  const abs = Math.abs(rawOverscrollPx)
  if (abs <= 0) return 0
  const damped =
    (BOUNDARY_RUBBER_MAX_PX * BOUNDARY_RUBBER_COEFF * abs) /
    (BOUNDARY_RUBBER_MAX_PX + BOUNDARY_RUBBER_COEFF * abs)
  return Math.sign(rawOverscrollPx) * damped
}

function invertBoundaryRubberBand(dampedPx: number): number {
  const abs = Math.min(BOUNDARY_RUBBER_MAX_PX - 0.2, Math.abs(dampedPx))
  if (abs <= 0) return 0
  const raw =
    (BOUNDARY_RUBBER_MAX_PX * abs) /
    (BOUNDARY_RUBBER_COEFF * Math.max(0.2, BOUNDARY_RUBBER_MAX_PX - abs))
  return Math.sign(dampedPx) * raw
}

function rawDragToVisualOffset(
  rawPx: number,
  baseIndex: number,
  profileCount: number,
  sidebarWidth: number
): number {
  if (rawPx === 0 || profileCount <= 0) return 0
  const w = Math.max(1, sidebarWidth)
  if (rawPx > 0) {
    if (baseIndex <= 0) return computeBoundaryRubberBand(rawPx)
    if (rawPx <= w) return rawPx
    return w + computeBoundaryRubberBand(rawPx - w)
  }
  if (baseIndex >= profileCount - 1) return computeBoundaryRubberBand(rawPx)
  if (rawPx >= -w) return rawPx
  return -w + computeBoundaryRubberBand(rawPx + w)
}

function visualOffsetToRawDrag(
  offsetPx: number,
  baseIndex: number,
  profileCount: number,
  sidebarWidth: number
): number {
  if (Math.abs(offsetPx) < 0.01 || profileCount <= 0) return 0
  const w = Math.max(1, sidebarWidth)
  if (offsetPx > 0) {
    if (baseIndex <= 0) return invertBoundaryRubberBand(offsetPx)
    if (offsetPx <= w) return offsetPx
    return w + invertBoundaryRubberBand(offsetPx - w)
  }
  if (baseIndex >= profileCount - 1) return invertBoundaryRubberBand(offsetPx)
  if (offsetPx >= -w) return offsetPx
  return -w + invertBoundaryRubberBand(offsetPx + w)
}

function clampCriticallyDampedVelocity(x0: number, rawVx: number, omega: number): number {
  if (Math.abs(x0) < 0.05) return 0
  if (x0 > 0) {
    return Math.max(-omega * x0, Math.min(0, rawVx))
  }
  return Math.min(-omega * x0, Math.max(0, rawVx))
}

function median3(values: number[]): number {
  if (values.length === 0) return 0
  if (values.length === 1) return values[0]
  if (values.length === 2) return (values[0] + values[1]) * 0.5
  const a = values[values.length - 3]
  const b = values[values.length - 2]
  const c = values[values.length - 1]
  return a + b + c - Math.min(a, b, c) - Math.max(a, b, c)
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

type WheelGesturePhase = 'idle' | 'undecided' | 'vertical' | 'dragging' | 'absorbing'

interface WheelGestureState {
  phase: WheelGesturePhase
  intentX: number
  intentAbsY: number
  rawDragPx: number
  velocityPx: number
  lastEventAt: number
  lastDxSign: 1 | -1 | 0
  rawAbsWindow: number[]
  prevMedAbsX: number
  peakMedAbsX: number
  decayRatios: number[]
  decayStreak: number
  absorbDir: 1 | -1 | 0
  absorbEnteredAt: number
  minAbsorbedMed: number
  reengageStreak: number
  oppositeStreak: number
  dragIdleTimer: number | null
  streamEndTimer: number | null
}

interface CarouselPhysicsState {
  baseIndex: number
  offsetPx: number
  velocityPx: number
  omega: number
  rafId: number | null
  lastFrameAt: number
  liveVarsActive: boolean
}

function clearGestureTimers(g: WheelGestureState): void {
  if (g.dragIdleTimer !== null) {
    window.clearTimeout(g.dragIdleTimer)
    g.dragIdleTimer = null
  }
  if (g.streamEndTimer !== null) {
    window.clearTimeout(g.streamEndTimer)
    g.streamEndTimer = null
  }
}

function resetWheelGestureToIdle(g: WheelGestureState): void {
  clearGestureTimers(g)
  g.phase = 'idle'
  g.intentX = 0
  g.intentAbsY = 0
  g.rawDragPx = 0
  g.velocityPx = 0
  g.lastDxSign = 0
  g.rawAbsWindow = []
  g.prevMedAbsX = 0
  g.peakMedAbsX = 0
  g.decayRatios = []
  g.decayStreak = 0
  g.absorbDir = 0
  g.absorbEnteredAt = 0
  g.minAbsorbedMed = Infinity
  g.reengageStreak = 0
  g.oppositeStreak = 0
}

function areSidebarPropsEqual(prev: Props, next: Props): boolean {
  const keys = Object.keys(next) as Array<keyof Props>
  if (Object.keys(prev).length !== keys.length) return false
  for (const k of keys) {
    const pv = prev[k]
    const nv = next[k]
    if (typeof pv === 'function' && typeof nv === 'function') continue
    if (!Object.is(pv, nv)) return false
  }
  return true
}

const VerticalSidebarInner: React.FC<Props> = ({
  platform = 'darwin',
  isDark,
  lang,
  width = DEFAULT_SIDEBAR_WIDTH,
  isPeekOverlay = false,
  isProfileMenuOpen = false,
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
  onAssignTabToGroup,
  onUpdateTabGroup,
  onDeleteTabGroup,
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
  const [previewProfileId, setPreviewProfileId] = useState<string>(activeProfile.id)
  const [isCarouselMoving, setIsCarouselMoving] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [footerMenuOpen, setFooterMenuOpen] = useState(false)
  const [hoveredDotId, setHoveredDotId] = useState<string | null>(null)
  const [renamingSpaceId, setRenamingSpaceId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [groupRenameDraft, setGroupRenameDraft] = useState('')
  const [folderMenuState, setFolderMenuState] = useState<{
    group: TabGroup
    zone: 'pinned' | 'unpinned'
    y: number
  } | null>(null)

  const [dragOverHint, setDragOverHint] = useState<{
    tabId: string
    pos: 'before' | 'after'
    zone: TabPinMode
  } | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null)
  const [dropZoneHover, setDropZoneHover] = useState<TabPinMode | null>(null)
  const [favPreviewIndex, setFavPreviewIndex] = useState<number | null>(null)
  const [pinnedPreviewIndex, setPinnedPreviewIndex] = useState<number | null>(null)
  const [isExternalLinkHovering, setIsExternalLinkHovering] = useState(false)

  const asideRef = useRef<HTMLElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const favGridRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const groupRenameInputRef = useRef<HTMLInputElement | null>(null)

  const initialIdx = Math.max(
    0,
    profiles.findIndex((p) => p.id === activeProfile.id)
  )
  const optimisticIdRef = useRef<string>(activeProfile.id)
  const previewIdRef = useRef<string>(activeProfile.id)
  const carouselMovingRef = useRef<boolean>(false)

  const physicsRef = useRef<CarouselPhysicsState>({
    baseIndex: initialIdx,
    offsetPx: 0,
    velocityPx: 0,
    omega: SPRING_OMEGA_BOUNDARY,
    rafId: null,
    lastFrameAt: 0,
    liveVarsActive: false
  })

  const wheelGestureRef = useRef<WheelGestureState>({
    phase: 'idle',
    intentX: 0,
    intentAbsY: 0,
    rawDragPx: 0,
    velocityPx: 0,
    lastEventAt: 0,
    lastDxSign: 0,
    rawAbsWindow: [],
    prevMedAbsX: 0,
    peakMedAbsX: 0,
    decayRatios: [],
    decayStreak: 0,
    absorbDir: 0,
    absorbEnteredAt: 0,
    minAbsorbedMed: Infinity,
    reengageStreak: 0,
    oppositeStreak: 0,
    dragIdleTimer: null,
    streamEndTimer: null
  })

  const latestPropsRef = useRef({
    profiles,
    activeProfile,
    width,
    isDark,
    isPeekOverlay,
    draggingTabId,
    isResizing,
    renamingSpaceId: renamingSpaceId || renamingGroupId,
    onSwitchProfile
  })
  latestPropsRef.current = {
    profiles,
    activeProfile,
    width,
    isDark,
    isPeekOverlay,
    draggingTabId,
    isResizing,
    renamingSpaceId: renamingSpaceId || renamingGroupId,
    onSwitchProfile
  }

  const setCarouselMovingSync = useCallback((moving: boolean) => {
    if (carouselMovingRef.current !== moving) {
      carouselMovingRef.current = moving
      setIsCarouselMoving(moving)
    }
  }, [])

  const setPreviewProfileSync = useCallback((id: string) => {
    if (previewIdRef.current !== id) {
      previewIdRef.current = id
      setPreviewProfileId(id)
    }
  }, [])

  const clearLiveShellVars = useCallback(() => {
    const p = physicsRef.current
    if (!p.liveVarsActive) return
    p.liveVarsActive = false
    const root = document.documentElement
    root.style.removeProperty('--arko-live-shell-bg')
    root.style.removeProperty('--arko-live-peek-border')
    root.style.removeProperty('--arko-live-topbar-bg')
    root.style.removeProperty('--arko-live-topbar-border')
  }, [])

  // Direct 120fps DOM transform & live Space color sync without per-frame React re-renders
  const applyVisualFrame = useCallback(
    (offsetPx: number, baseIdx: number) => {
      const {
        profiles: curProfiles,
        activeProfile: curActive,
        width: curWidth,
        isDark: curDark
      } = latestPropsRef.current
      const clampedIdx = Math.max(0, Math.min(Math.max(0, curProfiles.length - 1), baseIdx))
      const baseProfile = curProfiles[clampedIdx] || curActive

      const trackEl = trackRef.current
      if (trackEl) {
        if (Math.abs(offsetPx) < 0.05) {
          trackEl.style.transform = `translate3d(${-clampedIdx * 100}%, 0, 0)`
        } else {
          trackEl.style.transform = `translate3d(calc(${-clampedIdx * 100}% + ${offsetPx.toFixed(2)}px), 0, 0)`
        }
      }

      const neighborIdx =
        Math.abs(offsetPx) >= 0.5 && curProfiles.length > 1
          ? offsetPx < 0
            ? clampedIdx + 1
            : clampedIdx - 1
          : -1
      const neighborProfile =
        neighborIdx >= 0 && neighborIdx < curProfiles.length ? curProfiles[neighborIdx] : null

      if (neighborProfile) {
        const progress = Math.min(1, Math.abs(offsetPx) / Math.max(1, curWidth))
        const blendedHex = interpolateSpaceHex(
          baseProfile.accentColor,
          neighborProfile.accentColor,
          progress
        )
        const blendedTheme = getArcSpaceTheme(blendedHex, curDark)
        const root = document.documentElement
        root.style.setProperty('--arko-live-shell-bg', blendedTheme.sidebarBackground)
        root.style.setProperty('--arko-live-peek-border', blendedTheme.sidebarBorderColor)
        root.style.setProperty('--arko-live-topbar-bg', blendedTheme.topBarBackground)
        root.style.setProperty('--arko-live-topbar-border', blendedTheme.topBarBorderColor)
        physicsRef.current.liveVarsActive = true

        setPreviewProfileSync(
          progress >= SWIPE_SNAP_RATIO ? neighborProfile.id : baseProfile.id
        )
      } else {
        clearLiveShellVars()
        if (baseProfile) {
          setPreviewProfileSync(baseProfile.id)
        }
      }
    },
    [clearLiveShellVars, setPreviewProfileSync]
  )

  const stopSpringLoop = useCallback(() => {
    const p = physicsRef.current
    if (p.rafId !== null) {
      window.cancelAnimationFrame(p.rafId)
      p.rafId = null
    }
  }, [])

  const startSpringSettle = useCallback(
    (omega: number, rawInitialVelocity = 0) => {
      const p = physicsRef.current
      stopSpringLoop()

      if (Math.abs(p.offsetPx) < 0.12 && Math.abs(rawInitialVelocity) < 3) {
        p.offsetPx = 0
        p.velocityPx = 0
        applyVisualFrame(0, p.baseIndex)
        setCarouselMovingSync(false)
        return
      }

      p.omega = omega
      p.velocityPx = clampCriticallyDampedVelocity(p.offsetPx, rawInitialVelocity, omega)
      p.lastFrameAt = performance.now()
      setCarouselMovingSync(true)

      const step = (now: number): void => {
        const dt = Math.min(0.034, Math.max(0.001, (now - p.lastFrameAt) / 1000))
        p.lastFrameAt = now

        const w = p.omega
        const x0 = p.offsetPx
        const v0 = p.velocityPx
        const expTerm = Math.exp(-w * dt)
        const c2 = v0 + w * x0
        const nextX = (x0 + c2 * dt) * expTerm
        const nextV = (v0 - w * c2 * dt) * expTerm

        if (Math.abs(nextX) < 0.12 && Math.abs(nextV) < 4) {
          p.offsetPx = 0
          p.velocityPx = 0
          p.rafId = null
          applyVisualFrame(0, p.baseIndex)
          setCarouselMovingSync(false)
          return
        }

        p.offsetPx = nextX
        p.velocityPx = nextV
        applyVisualFrame(p.offsetPx, p.baseIndex)
        p.rafId = window.requestAnimationFrame(step)
      }

      p.rafId = window.requestAnimationFrame(step)
    },
    [applyVisualFrame, setCarouselMovingSync, stopSpringLoop]
  )

  const commitProfileSwitch = useCallback(
    (targetProfileId: string, direction?: 'left' | 'right', releaseVelocityPx = 0) => {
      const {
        profiles: curProfiles,
        activeProfile: curActive,
        width: curWidth,
        onSwitchProfile: curOnSwitch
      } = latestPropsRef.current
      const p = physicsRef.current
      const prevIdx = p.baseIndex
      const nextIdx = curProfiles.findIndex((pr) => pr.id === targetProfileId)
      if (nextIdx < 0) return

      const resolvedDir =
        direction ?? (nextIdx > prevIdx ? 'right' : nextIdx < prevIdx ? 'left' : undefined)

      if (nextIdx !== prevIdx) {
        p.offsetPx = (nextIdx - prevIdx) * curWidth + p.offsetPx
        p.baseIndex = nextIdx
      }

      optimisticIdRef.current = targetProfileId
      setOptimisticProfileId(targetProfileId)
      setPreviewProfileSync(targetProfileId)
      applyVisualFrame(p.offsetPx, p.baseIndex)
      startSpringSettle(SPRING_OMEGA_SWITCH, releaseVelocityPx)

      if (targetProfileId !== curActive.id) {
        curOnSwitch(targetProfileId, resolvedDir)
      }
    },
    [applyVisualFrame, setPreviewProfileSync, startSpringSettle]
  )

  const releaseDragIntoSpring = useCallback(
    (releaseVelocityPx: number) => {
      const { profiles: curProfiles, width: curWidth } = latestPropsRef.current
      const p = physicsRef.current
      const curIdx = p.baseIndex
      const offset = p.offsetPx

      const atLeftBoundary = curIdx <= 0 && offset > 0
      const atRightBoundary = curIdx >= curProfiles.length - 1 && offset < 0

      if (atLeftBoundary || atRightBoundary || curProfiles.length <= 1) {
        startSpringSettle(SPRING_OMEGA_BOUNDARY, releaseVelocityPx)
        return
      }

      const gestureWidth = Math.min(curWidth, SWIPE_MAX_REF_WIDTH)
      const projected = offset + releaseVelocityPx * SWIPE_PROJECTION_SEC
      const step: 1 | -1 = offset < 0 ? 1 : -1
      const candidateIdx = curIdx + step
      const movedEnoughForFlick = Math.abs(offset) >= gestureWidth * SWIPE_FLICK_MIN_DIST_RATIO
      const shouldSwitch =
        candidateIdx >= 0 &&
        candidateIdx < curProfiles.length &&
        (Math.abs(offset) >= gestureWidth * SWIPE_SNAP_RATIO ||
          (movedEnoughForFlick &&
            Math.sign(projected) === Math.sign(offset) &&
            Math.abs(projected) >= gestureWidth * SWIPE_SNAP_RATIO))

      if (shouldSwitch) {
        commitProfileSwitch(
          curProfiles[candidateIdx].id,
          step === 1 ? 'right' : 'left',
          releaseVelocityPx
        )
      } else {
        startSpringSettle(SPRING_OMEGA_REBOUND, releaseVelocityPx)
      }
    },
    [commitProfileSwitch, startSpringSettle]
  )

  // Sync external profile changes (keyboard shortcuts, profile menu) via smooth continuous spring
  useEffect(() => {
    const nextIdx = profiles.findIndex((pr) => pr.id === activeProfile.id)
    if (nextIdx < 0) return

    const p = physicsRef.current
    if (activeProfile.id !== optimisticIdRef.current) {
      if (nextIdx !== p.baseIndex) {
        p.offsetPx = (nextIdx - p.baseIndex) * width + p.offsetPx
        p.baseIndex = nextIdx
      }
      optimisticIdRef.current = activeProfile.id
      setOptimisticProfileId(activeProfile.id)
      setPreviewProfileSync(activeProfile.id)
      applyVisualFrame(p.offsetPx, p.baseIndex)
      startSpringSettle(SPRING_OMEGA_SWITCH, 0)
    } else if (p.baseIndex !== nextIdx) {
      // Profile array reordered/deleted while keeping same active ID
      p.baseIndex = nextIdx
      applyVisualFrame(p.offsetPx, p.baseIndex)
    }
  }, [activeProfile.id, profiles, width, applyVisualFrame, setPreviewProfileSync, startSpringSettle])

  // Initialize track transform synchronously before paint; trackRef transform is owned imperatively
  useLayoutEffect(() => {
    const p = physicsRef.current
    applyVisualFrame(p.offsetPx, p.baseIndex)
  }, [applyVisualFrame])

  useEffect(() => {
    const g = wheelGestureRef.current
    return () => {
      clearGestureTimers(g)
      stopSpringLoop()
      clearLiveShellVars()
    }
  }, [clearLiveShellVars, stopSpringLoop])

  useEffect(() => {
    if (renamingSpaceId) {
      window.requestAnimationFrame(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      })
    }
  }, [renamingSpaceId])

  useEffect(() => {
    if (renamingGroupId) {
      window.requestAnimationFrame(() => {
        groupRenameInputRef.current?.focus()
        groupRenameInputRef.current?.select()
      })
    }
  }, [renamingGroupId])

  const commitGroupRename = useCallback(
    (grp: TabGroup) => {
      const trimmed = groupRenameDraft.trim()
      setRenamingGroupId(null)
      if (trimmed && trimmed !== grp.title) {
        onUpdateTabGroup?.(grp.id, { title: trimmed })
      }
    },
    [groupRenameDraft, onUpdateTabGroup]
  )

  const resetAllDragPreviews = useCallback(() => {
    setDragOverHint(null)
    setDragOverGroupId(null)
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
  const headerPreviewProfile =
    profiles.find((p) => p.id === previewProfileId) || visualProfile

  const liveSpaceTheme = useMemo(
    () => getArcSpaceTheme(visualProfile.accentColor, isDark),
    [visualProfile.accentColor, isDark]
  )

  // Native non-passive wheel listener for silky 120fps trackpad swipe & zero multi-bounce momentum shielding
  useEffect(() => {
    const el = asideRef.current
    if (!el) return

    const enterAbsorbing = (g: WheelGestureState, dir: 1 | -1 | 0, now: number, curMed: number): void => {
      if (g.dragIdleTimer !== null) {
        window.clearTimeout(g.dragIdleTimer)
        g.dragIdleTimer = null
      }
      g.phase = 'absorbing'
      g.absorbDir = dir
      g.absorbEnteredAt = now
      g.minAbsorbedMed = curMed
      g.reengageStreak = 0
      g.oppositeStreak = 0
    }

    const scheduleStreamEnd = (g: WheelGestureState, delayMs = 170): void => {
      if (g.streamEndTimer !== null) window.clearTimeout(g.streamEndTimer)
      g.streamEndTimer = window.setTimeout(() => {
        resetWheelGestureToIdle(g)
      }, delayMs)
    }

    const beginDraggingFromCurrentOffset = (g: WheelGestureState, initialRawStepPx: number): void => {
      const { profiles: curProfiles, width: curWidth } = latestPropsRef.current
      const p = physicsRef.current
      stopSpringLoop()
      g.phase = 'dragging'
      g.rawDragPx =
        visualOffsetToRawDrag(p.offsetPx, p.baseIndex, curProfiles.length, curWidth) +
        initialRawStepPx
      g.velocityPx = 0
      g.decayRatios = []
      g.decayStreak = 0
      g.peakMedAbsX = 0
      setCarouselMovingSync(true)
      p.offsetPx = rawDragToVisualOffset(g.rawDragPx, p.baseIndex, curProfiles.length, curWidth)
      applyVisualFrame(p.offsetPx, p.baseIndex)
    }

    const onWheel = (e: WheelEvent): void => {
      const {
        draggingTabId: curDraggingTab,
        isResizing: curResizing,
        renamingSpaceId: curRenaming,
        profiles: curProfiles,
        width: curWidth
      } = latestPropsRef.current

      if (
        e.ctrlKey ||
        curDraggingTab ||
        curResizing ||
        curRenaming ||
        curProfiles.length === 0
      ) {
        return
      }

      const unitScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? curWidth : 1
      const dx = e.deltaX * unitScale
      const dy = e.deltaY * unitScale
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)

      const g = wheelGestureRef.current
      const now = e.timeStamp > 0 ? e.timeStamp : performance.now()
      const dtMs = g.lastEventAt > 0 ? now - g.lastEventAt : 10
      g.lastEventAt = now

      if (dtMs > 175 || dtMs < 0) {
        resetWheelGestureToIdle(g)
      }

      // Normalize per-10ms velocity + 3-sample median filter to eliminate 2x VSync/HID beat-frequency spikes
      const normDtMs = dtMs > 0 ? Math.max(4, Math.min(36, dtMs)) : 10
      const normAbsX = (absX / normDtMs) * 10
      g.rawAbsWindow.push(normAbsX)
      if (g.rawAbsWindow.length > 3) g.rawAbsWindow.shift()
      const medAbsX = median3(g.rawAbsWindow)
      const dxSign: 1 | -1 | 0 = dx > 0.05 ? 1 : dx < -0.05 ? -1 : 0

      if (g.phase === 'idle') {
        g.phase = 'undecided'
        g.intentX = 0
        g.intentAbsY = 0
      }

      // Post-release momentum shield: swallow all inertial coasting frames so long swipes never bounce twice
      if (g.phase === 'absorbing') {
        scheduleStreamEnd(g, 180)

        if (absX > absY) {
          e.preventDefault()
        }

        const reversedDir =
          dxSign !== 0 && g.absorbDir !== 0 && dxSign !== g.absorbDir && absX > absY * 1.3
        if (reversedDir) {
          g.oppositeStreak += 1
        } else {
          g.oppositeStreak = 0
        }

        // Track genuine sustained finger re-push after inertia has decayed (immune to coalesced spikes)
        if (dxSign === g.absorbDir || g.absorbDir === 0) {
          const threshold = Math.max(g.minAbsorbedMed * 1.8 + 4, 9.5)
          if (
            now - g.absorbEnteredAt >= 135 &&
            g.minAbsorbedMed < 11 &&
            medAbsX > threshold &&
            medAbsX > g.prevMedAbsX * 1.06 &&
            absX > absY * 1.4
          ) {
            g.reengageStreak += 1
          } else {
            g.reengageStreak = 0
            if (medAbsX < g.minAbsorbedMed) {
              g.minAbsorbedMed = medAbsX
            }
          }
        }

        g.prevMedAbsX = medAbsX
        if (dxSign !== 0) g.lastDxSign = dxSign

        if ((g.oppositeStreak >= 2 && medAbsX >= 2) || g.reengageStreak >= 3) {
          g.rawAbsWindow = [normAbsX]
          g.prevMedAbsX = normAbsX
          beginDraggingFromCurrentOffset(g, -dx * SWIPE_TRACKING_GAIN)
          g.peakMedAbsX = normAbsX
          return
        }

        return
      }

      if (g.phase === 'vertical') {
        scheduleStreamEnd(g, 145)
        g.prevMedAbsX = medAbsX
        return
      }

      if (g.phase === 'undecided') {
        scheduleStreamEnd(g, 145)
        g.intentX += -dx
        g.intentAbsY += absY

        if ((absY > absX * 1.15 && absY > 2.2) || g.intentAbsY >= SWIPE_LOCK_Y_PX) {
          g.phase = 'vertical'
          g.prevMedAbsX = medAbsX
          return
        }

        if (
          Math.abs(g.intentX) >= SWIPE_LOCK_X_PX &&
          Math.abs(g.intentX) >= g.intentAbsY * SWIPE_AXIS_RATIO
        ) {
          e.preventDefault()
          const excessPx =
            Math.sign(g.intentX) *
            Math.max(0, Math.abs(g.intentX) - SWIPE_LOCK_X_PX) *
            SWIPE_TRACKING_GAIN
          beginDraggingFromCurrentOffset(g, excessPx)
          g.peakMedAbsX = medAbsX
          g.prevMedAbsX = medAbsX
          if (dxSign !== 0) g.lastDxSign = dxSign

          g.dragIdleTimer = window.setTimeout(() => {
            if (g.phase === 'dragging') {
              releaseDragIntoSpring(0)
              enterAbsorbing(g, g.lastDxSign, now + 95, 0)
              scheduleStreamEnd(g, 165)
            }
          }, 95)
        } else {
          g.prevMedAbsX = medAbsX
        }
        return
      }

      // Active horizontal manipulation ('dragging')
      e.preventDefault()
      scheduleStreamEnd(g, 185)

      const clampedDtSec = Math.min(0.05, Math.max(0.004, normDtMs / 1000))
      const stepX = -dx * SWIPE_TRACKING_GAIN
      const instVx = stepX / clampedDtSec
      g.velocityPx = g.velocityPx === 0 ? instVx : g.velocityPx * 0.55 + instVx * 0.45

      // Detect macOS synthetic trackpad momentum onset (fingers lifted off glass)
      const sameSign = dxSign !== 0 && (g.lastDxSign === 0 || dxSign === g.lastDxSign)
      if (!sameSign && dxSign !== 0) {
        g.decayRatios = []
        g.decayStreak = 0
        g.peakMedAbsX = medAbsX
      } else if (medAbsX > g.peakMedAbsX) {
        g.peakMedAbsX = medAbsX
        g.decayRatios = []
        g.decayStreak = 0
      } else if (g.prevMedAbsX > 0.35 && medAbsX <= g.prevMedAbsX * 1.01 + 0.06) {
        const ratio = medAbsX / g.prevMedAbsX
        g.decayStreak += 1
        if (ratio >= 0.78 && ratio <= 0.985) {
          g.decayRatios.push(ratio)
          if (g.decayRatios.length > 6) g.decayRatios.shift()
        } else if (ratio < 0.78) {
          g.decayRatios = []
        }
        // Note: ratio in (0.985, 1.01] is a 1-frame median plateau — preserve existing decayRatios
      } else if (medAbsX > g.prevMedAbsX * 1.06 + 0.4) {
        g.decayRatios = []
        g.decayStreak = 0
      }

      g.prevMedAbsX = medAbsX
      if (dxSign !== 0) g.lastDxSign = dxSign

      let enteredSyntheticMomentum = false
      if (g.decayRatios.length >= 6 && medAbsX <= g.peakMedAbsX * 0.76) {
        const maxR = Math.max(...g.decayRatios)
        const minR = Math.min(...g.decayRatios)
        if (maxR - minR <= 0.052) {
          enteredSyntheticMomentum = true
        }
      }

      // Secondary catch for custom scroll smoothers or fast Space-switch flicks
      const p = physicsRef.current
      const gestureWidth = Math.min(curWidth, SWIPE_MAX_REF_WIDTH)
      const isNonBoundaryFlick =
        curProfiles.length > 1 &&
        !((p.baseIndex <= 0 && g.rawDragPx > 0) || (p.baseIndex >= curProfiles.length - 1 && g.rawDragPx < 0)) &&
        g.peakMedAbsX >= 18 &&
        Math.abs(g.rawDragPx) >= gestureWidth * 0.28 &&
        g.decayRatios.length >= 4 &&
        medAbsX <= g.peakMedAbsX * 0.72

      const isLowTailDecay =
        g.peakMedAbsX >= 4 &&
        g.decayStreak >= 5 &&
        medAbsX <= Math.min(1.8, g.peakMedAbsX * 0.28)

      if (enteredSyntheticMomentum || isNonBoundaryFlick || isLowTailDecay) {
        releaseDragIntoSpring(g.velocityPx)
        enterAbsorbing(g, g.lastDxSign, now, medAbsX)
        return
      }

      g.rawDragPx += stepX
      p.offsetPx = rawDragToVisualOffset(g.rawDragPx, p.baseIndex, curProfiles.length, curWidth)
      applyVisualFrame(p.offsetPx, p.baseIndex)

      if (g.dragIdleTimer !== null) window.clearTimeout(g.dragIdleTimer)
      g.dragIdleTimer = window.setTimeout(() => {
        if (g.phase === 'dragging') {
          releaseDragIntoSpring(0)
          const ts = e.timeStamp > 0 ? e.timeStamp + 95 : performance.now()
          enterAbsorbing(g, g.lastDxSign, ts, 0)
          scheduleStreamEnd(g, 165)
        }
      }, 95)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
    }
  }, [applyVisualFrame, releaseDragIntoSpring, setCarouselMovingSync, stopSpringLoop])

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
    let baseRawPx = 0
    let lastClientX = startX
    let lastMoveAt = performance.now()
    let vxPxPerSec = 0

    const onMove = (moveEvt: MouseEvent): void => {
      const dx = moveEvt.clientX - startX
      const dy = moveEvt.clientY - startY
      const now = performance.now()
      const dtSec = Math.min(0.05, Math.max(0.004, (now - lastMoveAt) / 1000))
      const stepDx = moveEvt.clientX - lastClientX
      lastClientX = moveEvt.clientX
      lastMoveAt = now

      if (axis === 'none') {
        if (Math.abs(dy) > 9 && Math.abs(dy) > Math.abs(dx) * 0.85) {
          axis = 'vertical'
          cleanup()
          return
        }
        if (Math.abs(dx) > SWIPE_LOCK_X_PX + 3 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          axis = 'horizontal'
          stopSpringLoop()
          const p = physicsRef.current
          baseRawPx = visualOffsetToRawDrag(p.offsetPx, p.baseIndex, profiles.length, width)
          setCarouselMovingSync(true)
        } else {
          return
        }
      }

      if (axis === 'horizontal') {
        const rawPastDeadzone =
          Math.sign(dx) * Math.max(0, Math.abs(dx) - (SWIPE_LOCK_X_PX + 3)) * SWIPE_TRACKING_GAIN
        const instVx = (stepDx * SWIPE_TRACKING_GAIN) / dtSec
        vxPxPerSec = vxPxPerSec === 0 ? instVx : vxPxPerSec * 0.55 + instVx * 0.45

        const p = physicsRef.current
        p.offsetPx = rawDragToVisualOffset(
          baseRawPx + rawPastDeadzone,
          p.baseIndex,
          profiles.length,
          width
        )
        applyVisualFrame(p.offsetPx, p.baseIndex)
      }
    }

    const onUp = (): void => {
      cleanup()
      if (axis !== 'horizontal') return
      const sinceLastMove = performance.now() - lastMoveAt
      releaseDragIntoSpring(sinceLastMove > 80 ? 0 : vxPxPerSec)
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

  const triggerProfileMenu = (
    el: HTMLElement,
    placement: 'bottom-left' | 'top-left' | 'top-center' | 'right-top' = 'bottom-left'
  ): void => {
    if (onOpenSpacePopover) {
      const rect = el.getBoundingClientRect()
      const anchor =
        placement === 'bottom-left'
          ? { x: Math.max(8, rect.left - 2), y: rect.bottom + 5, placement }
          : placement === 'top-center'
            ? { x: rect.left + rect.width / 2, y: rect.top - 2, placement }
            : placement === 'top-left'
              ? { x: rect.left, y: rect.top, placement }
              : { x: Math.min(rect.right + 6, width + 6), y: rect.top, placement }
      onOpenSpacePopover({
        mode: 'menu',
        profileId: headerPreviewProfile.id,
        anchor
      })
    } else {
      onEditProfilePrompt(headerPreviewProfile)
    }
  }

  const triggerEditSpace = (
    profile: BrowserProfile,
    el: HTMLElement,
    placement: 'bottom-left' | 'top-left' | 'top-center' | 'right-top' = 'right-top'
  ): void => {
    if (onOpenSpacePopover) {
      const rect = el.getBoundingClientRect()
      const anchor =
        placement === 'right-top'
          ? { x: Math.min(rect.right + 6, width + 6), y: rect.top, placement }
          : placement === 'top-center'
            ? { x: rect.left + rect.width / 2, y: rect.top - 2, placement }
            : placement === 'top-left'
              ? { x: rect.left, y: rect.top, placement }
              : { x: Math.max(8, rect.left - 2), y: rect.bottom + 5, placement }
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
    placement: 'bottom-left' | 'top-left' | 'top-center' | 'right-top' = 'top-left'
  ): void => {
    if (onOpenSpacePopover) {
      const rect = el.getBoundingClientRect()
      onOpenSpacePopover({
        mode: 'create',
        anchor: {
          x:
            placement === 'right-top'
              ? width + 6
              : placement === 'top-center'
                ? rect.left + rect.width / 2
                : rect.left,
          y: placement === 'bottom-left' ? rect.bottom + 5 : rect.top,
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
    const ungroupedSlideWebCount = todayTabs.filter(
      (t) => !t.groupId && !isInternalArkoUrl(t.url)
    ).length
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
        dragOverHint?.tabId === tab.id && dragOverHint?.zone === zone
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
            const linkDrag = Boolean(externalDragLink) || hasExternalLinkDragPayload(e.dataTransfer)
            if (!draggingTabId && !linkDrag) return
            e.preventDefault()
            e.stopPropagation()
            if (linkDrag && !isExternalLinkHovering) setIsExternalLinkHovering(true)
            if (dragOverGroupId !== null) setDragOverGroupId(null)
            if (pinnedPreviewIndex !== null) setPinnedPreviewIndex(null)
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
            } else if (droppedUrl) {
              onDropExternalUrl?.(
                droppedUrl,
                zone,
                pos === 'before' ? tab.id : null,
                tab.groupId ?? null
              )
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
          style={
            isActive
              ? {
                  backgroundColor: slideTheme.activeTabBg,
                  boxShadow: slideTheme.activeTabShadow
                }
              : undefined
          }
          className={`arc-pressable group relative flex items-center gap-2.5 h-[32px] ${
            indented ? 'pl-6 pr-2.5' : 'px-2.5'
          } rounded-[10px] text-[12.5px] cursor-pointer ${
            isBeingDragged ? 'opacity-45 scale-[0.98]' : ''
          } ${
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
                : zone === 'pinned' && tab.isLoaded
                  ? isDark
                    ? 'text-zinc-100/95 hover:bg-white/[0.07] hover:text-white'
                    : 'text-zinc-800 hover:bg-black/[0.045] hover:text-zinc-950'
                  : isDark
                    ? 'text-zinc-200/85 hover:bg-white/[0.07] hover:text-white'
                    : 'text-zinc-700 hover:bg-black/[0.045] hover:text-zinc-950'
          }`}
        >
          {isActive && (
            <span
              style={{ backgroundColor: slideTheme.accentHex }}
              className={`absolute ${
                indented ? 'left-2.5' : 'left-1'
              } top-1/2 -translate-y-1/2 w-[2.5px] h-3.5 rounded-full pointer-events-none`}
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

    const renderFolderBlock = (
      grp: TabGroup,
      groupTabs: TabState[],
      zone: 'pinned' | 'unpinned'
    ): React.ReactNode => {
      const isDropTarget = isVisualSlide && dragOverGroupId === grp.id
      const isRenamingThis = renamingGroupId === grp.id
      const isTabKeptWhenCollapsed = (t: TabState): boolean =>
        t.id === pActiveTabId ||
        Boolean(
          pSplit?.enabled && (t.id === pSplit.leftTabId || t.id === pSplit.rightTabId)
        )
      const hasOpenVisibleInGroup = groupTabs.some(isTabKeptWhenCollapsed)

      return (
        <div
          key={`vgrp-${zone}-${grp.id}`}
          onDragOver={(e) => {
            const linkDrag = Boolean(externalDragLink) || hasExternalLinkDragPayload(e.dataTransfer)
            if (!draggingTabId && !linkDrag) return
            e.preventDefault()
            e.stopPropagation()
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            resetAllDragPreviews()
            onTabDragStateChange?.(null)
          }}
          className={
            zone === 'unpinned'
              ? `rounded-xl p-1 my-1 transition-colors ${
                  isDropTarget
                    ? isDark
                      ? 'bg-indigo-500/[0.12] ring-1 ring-indigo-400/45'
                      : 'bg-indigo-500/[0.08] ring-1 ring-indigo-500/35'
                    : isDark
                      ? 'bg-white/[0.035]'
                      : 'bg-black/[0.03]'
                }`
              : `rounded-[10px] transition-colors ${
                  isDropTarget
                    ? isDark
                      ? 'bg-indigo-500/[0.12] ring-1 ring-indigo-400/45'
                      : 'bg-indigo-500/[0.08] ring-1 ring-indigo-500/35'
                    : ''
                }`
          }
        >
          {isRenamingThis ? (
            <div
              data-no-swipe="true"
              className="flex items-center gap-2 h-[31px] px-2.5"
              onClick={(e) => e.stopPropagation()}
            >
              <FolderOpen
                size={13}
                strokeWidth={1.75}
                className="shrink-0 opacity-55"
              />
              <input
                ref={groupRenameInputRef}
                value={groupRenameDraft}
                onChange={(e) => setGroupRenameDraft(e.target.value)}
                onBlur={() => commitGroupRename(grp)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitGroupRename(grp)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setRenamingGroupId(null)
                  }
                }}
                className={`flex-1 min-w-0 h-[24px] px-2 rounded-md text-[12px] font-medium outline-none border ${
                  isDark
                    ? 'bg-white/[0.10] border-white/20 text-white'
                    : 'bg-white/95 border-black/20 text-zinc-900'
                }`}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onToggleGroupCollapsed(grp.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const asideRect = asideRef.current?.getBoundingClientRect()
                setFolderMenuState({
                  group: grp,
                  zone,
                  y: asideRect ? e.clientY - asideRect.top : e.clientY
                })
              }}
              onDragOver={(e) => {
                const linkDrag =
                  Boolean(externalDragLink) || hasExternalLinkDragPayload(e.dataTransfer)
                if (!draggingTabId && !linkDrag) return
                e.preventDefault()
                e.stopPropagation()
                if (linkDrag && !isExternalLinkHovering) setIsExternalLinkHovering(true)
                if (dragOverHint !== null) setDragOverHint(null)
                if (pinnedPreviewIndex !== null) setPinnedPreviewIndex(null)
                if (dragOverGroupId !== grp.id) setDragOverGroupId(grp.id)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  if (dragOverGroupId === grp.id) setDragOverGroupId(null)
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const srcId =
                  e.dataTransfer.getData('application/x-dia-tab-id') || draggingTabId
                const droppedUrl = !srcId
                  ? extractDroppedExternalUrl(e.dataTransfer) || externalDragLink?.url
                  : null
                resetAllDragPreviews()
                onTabDragStateChange?.(null)
                if (srcId) {
                  onAssignTabToGroup?.(srcId, grp.id)
                } else if (droppedUrl) {
                  onDropExternalUrl?.(droppedUrl, zone, null, grp.id)
                }
              }}
              title={tr(
                lang,
                `${grp.title} (${groupTabs.length}) — Click to ${grp.collapsed ? 'expand' : 'collapse'} · Right-click for folder options`,
                `${grp.title}（${groupTabs.length} 个标签）— 点击${grp.collapsed ? '展开' : '收起'} · 右键管理文件夹`
              )}
              className={`arc-pressable group/fhdr w-full flex items-center gap-2.5 ${
                zone === 'pinned'
                  ? 'h-[32px] px-2.5 rounded-[10px] text-[12.5px]'
                  : 'h-[30px] px-2 rounded-lg text-[12px]'
              } font-medium ${
                isDark
                  ? 'text-zinc-200/90 hover:bg-white/[0.06]'
                  : 'text-zinc-700 hover:bg-black/[0.04]'
              }`}
            >
              {grp.collapsed ? (
                <Folder
                  size={zone === 'pinned' ? 13.5 : 13}
                  strokeWidth={1.75}
                  className={`shrink-0 ${hasOpenVisibleInGroup ? 'opacity-75' : 'opacity-50'}`}
                />
              ) : (
                <FolderOpen
                  size={zone === 'pinned' ? 13.5 : 13}
                  strokeWidth={1.75}
                  className="shrink-0 opacity-55"
                />
              )}
              <span className="truncate flex-1 text-left">{grp.title}</span>
              {grp.collapsed && (
                <span
                  className={`text-[10.5px] tabular-nums px-1.5 py-0.2 rounded-full shrink-0 ${
                    isDark ? 'bg-white/[0.07] text-zinc-300/80' : 'bg-black/[0.05] text-zinc-600/85'
                  }`}
                >
                  {groupTabs.length}
                </span>
              )}
              <ChevronDown
                size={12}
                className={`opacity-45 group-hover/fhdr:opacity-80 shrink-0 transition-transform duration-200 ${
                  grp.collapsed ? '-rotate-90' : 'rotate-0'
                }`}
              />
            </button>
          )}

          <div>
            {groupTabs.map((child) => {
              const isRowOpen = !grp.collapsed || isTabKeptWhenCollapsed(child)
              return (
                <div
                  key={child.id}
                  className="arc-collapse-grid"
                  data-open={isRowOpen}
                >
                  <div className="arc-collapse-inner">
                    <div className="pt-0.5">{renderTabRow(child, zone, true)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    const buildPinnedRows = (sourceTabs: TabState[]): React.ReactNode[] => {
      const renderedGroupIds = new Set<string>()
      const nodes: React.ReactNode[] = []

      for (const tab of sourceTabs) {
        const grp = tab.groupId ? pGroups.find((g) => g.id === tab.groupId) : undefined
        if (grp) {
          if (renderedGroupIds.has(grp.id)) continue
          renderedGroupIds.add(grp.id)
          const groupTabs = sourceTabs.filter((t) => t.groupId === grp.id)
          nodes.push(renderFolderBlock(grp, groupTabs, 'pinned'))
          continue
        }

        nodes.push(renderTabRow(tab, 'pinned', false))
      }

      if (isPinnedLivePreviewActive) {
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
          nodes.push(renderFolderBlock(grp, groupTabs, 'unpinned'))
          continue
        }

        nodes.push(renderTabRow(tab, 'unpinned', false))
      }
      return nodes
    }

    const pinnedNodes = buildPinnedRows(pinnedTabs)
    const todayNodes = buildTodayRows(todayTabs)

    return (
      <div
        key={profile.id}
        style={
          isCarouselMoving && profiles.length > 1
            ? {
                background: `radial-gradient(100% 45% at 50% 0%, rgba(${slideTheme.rgbString}, ${
                  isDark ? 0.16 : 0.12
                }) 0%, transparent 75%)`
              }
            : undefined
        }
        className="w-full shrink-0 basis-full h-full flex flex-col min-w-0 min-h-0 pt-1"
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
          className={`px-3 shrink-0 ${
            favRenderSlots.length > 0 || hasAnyIncomingDrag ? 'pt-0.5 pb-3' : 'pb-0.5'
          }`}
        >
          {favRenderSlots.length > 0 ? (
            <div
              ref={isVisualSlide ? favGridRef : undefined}
              className={`grid ${favGridColsClass} gap-2 rounded-2xl transition-all duration-150 ${
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
                const isCompactFavTile = effectiveFavCols >= 4
                const tileHeightClass = isCompactFavTile ? 'h-[40px]' : 'h-[44px]'
                const favIconSize = isCompactFavTile ? 17 : 18

                if (slot.kind === 'preview') {
                  return (
                    <div
                      key="__fav-live-preview__"
                      className={`relative ${tileHeightClass} rounded-[13px] border border-dashed flex items-center justify-center gap-2 px-2 pointer-events-none transition-all duration-150 ${
                        isDark
                          ? 'border-indigo-400/65 bg-indigo-500/[0.14] text-indigo-100 shadow-xs'
                          : 'border-indigo-500/55 bg-indigo-500/[0.09] text-indigo-900 shadow-2xs'
                      }`}
                    >
                      {slot.url ? (
                        <FaviconIcon url={slot.url} favicon={slot.favicon} size={favIconSize} />
                      ) : (
                        <Link2 size={15} className="opacity-80 shrink-0" />
                      )}
                      {favRenderSlots.length === 1 && (
                        <span className="text-[11.5px] font-medium truncate min-w-0">
                          {slot.title}
                        </span>
                      )}
                      <span
                        className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
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
                    data-active={isActive ? 'true' : undefined}
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
                            background: slideTheme.favActiveBg,
                            boxShadow: slideTheme.favActiveShadow
                          }
                        : inSplit
                          ? undefined
                          : {
                              background: slideTheme.favIdleBg,
                              boxShadow: slideTheme.favIdleShadow
                            }
                    }
                    className={`dia-liquid-card arc-fav-pressable group relative ${tileHeightClass} rounded-[13px] flex items-center justify-center gap-2 px-2.5 cursor-pointer ${
                      isActive
                        ? ''
                        : inSplit
                          ? isDark
                            ? 'bg-white/[0.12] ring-1 ring-white/22'
                            : 'bg-white/80 ring-1 ring-black/10'
                          : ''
                    }`}
                  >
                    {tab.isLoading ? (
                      <Loader2 size={16} className="animate-spin opacity-65 shrink-0" />
                    ) : (
                      <FaviconIcon
                        url={tab.url}
                        favicon={tab.favicon}
                        size={favIconSize}
                        className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                      />
                    )}

                    {favRenderSlots.length === 1 && (
                      <span className="text-[12px] font-medium truncate min-w-0">
                        {tab.title || tr(lang, 'Favorite', '常驻标签')}
                      </span>
                    )}

                    {tab.isAudioPlaying && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          onMuteTab(tab.id)
                        }}
                        className={`absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full flex items-center justify-center ${
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
                        className="absolute bottom-1 left-1/2 -translate-x-1/2 w-3 h-[2px] rounded-full opacity-85"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          ) : hasAnyIncomingDrag ? (
            <div
              className={`h-[42px] rounded-[13px] border border-dashed flex items-center justify-center gap-2 px-3 text-[11.5px] font-medium transition-all ${
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
        <div className="flex-1 overflow-y-auto px-2.5 pb-2 space-y-1 min-h-0">
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
                if (
                  pinnedTabs.length === 0 ||
                  !draggedTab ||
                  !draggedTab.isPinned ||
                  draggedTab.isFavorite ||
                  Boolean(draggedTab.groupId)
                ) {
                  if (pinnedPreviewIndex !== pinnedTabs.length) {
                    setPinnedPreviewIndex(pinnedTabs.length)
                  }
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

                resetAllDragPreviews()
                onTabDragStateChange?.(null)

                if (srcId) {
                  const srcTab = pTabs.find((t) => t.id === srcId) || allTabs.find((t) => t.id === srcId)
                  if (
                    !srcTab ||
                    !srcTab.isPinned ||
                    srcTab.isFavorite ||
                    Boolean(srcTab.groupId)
                  ) {
                    onMoveTabToZone(srcId, 'pinned')
                  }
                } else if (droppedUrl) {
                  onDropExternalUrl?.(droppedUrl, 'pinned', null)
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

          {/* Subtle Space-Tinted Divider with Hover "Tidy" & "Clear" */}
          <div className="group/divider flex items-center gap-1.5 px-2 py-1">
            <div
              style={{ borderTopColor: slideTheme.dividerColor }}
              className="flex-1 border-t transition-colors"
            />
            {ungroupedSlideWebCount >= 3 && (
              <button
                type="button"
                onClick={onOrganizeTabs}
                disabled={organizingTabs}
                title={tr(lang, 'Tidy tabs into folders (/organize)', 'AI 智能整理分组 (/organize)')}
                className="arc-pressable inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md opacity-0 group-hover/divider:opacity-65 hover:!opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
              >
                {organizingTabs ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <FolderKanban size={10} />
                )}
                <span>{tr(lang, 'Tidy', '整理')}</span>
              </button>
            )}
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
                const srcTab = pTabs.find((t) => t.id === srcId) || allTabs.find((t) => t.id === srcId)
                if (
                  !srcTab ||
                  srcTab.isPinned ||
                  srcTab.isFavorite ||
                  Boolean(srcTab.groupId)
                ) {
                  onMoveTabToZone(srcId, 'unpinned')
                }
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
      ref={asideRef}
      onMouseDown={handleMouseSwipeStart}
      style={{
        width,
        background: isPeekOverlay
          ? `var(--arko-live-shell-bg, ${liveSpaceTheme.sidebarBackground})`
          : 'transparent',
        borderColor: isPeekOverlay
          ? `var(--arko-live-peek-border, ${liveSpaceTheme.sidebarBorderColor})`
          : 'transparent',
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

      {/* Row 1: Dia Top-Left Profile Pill beside macOS Traffic Lights */}
      <div
        className={`group/spacehdr relative z-10 ${isPeekOverlay ? '' : 'app-drag'} h-[46px] flex items-center justify-between gap-1.5 shrink-0 ${
          platform === 'darwin' && !isPeekOverlay ? 'pl-[86px] pr-3' : 'pl-3 pr-3'
        }`}
      >
        {renamingSpaceId === headerPreviewProfile.id ? (
          <div className="app-no-drag flex items-center gap-1.5 flex-1 min-w-0">
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
              className={`flex-1 min-w-0 h-[25px] px-2.5 rounded-full text-[12px] font-medium outline-none border ${
                isDark
                  ? 'bg-white/[0.12] border-white/22 text-white'
                  : 'bg-white/95 border-black/18 text-zinc-900'
              }`}
            />
          </div>
        ) : (
          <div className="app-no-drag flex items-center min-w-0">
            <button
              type="button"
              onClick={(e) => triggerProfileMenu(e.currentTarget, 'bottom-left')}
              onContextMenu={(e) => {
                e.preventDefault()
                triggerEditSpace(headerPreviewProfile, e.currentTarget, 'bottom-left')
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setRenameDraft(headerPreviewProfile.name)
                setRenamingSpaceId(headerPreviewProfile.id)
              }}
              title={tr(
                lang,
                `${headerPreviewProfile.name} — Click to switch Profile · Right-click for Profile Settings`,
                `${headerPreviewProfile.name} — 点击切换个人资料 · 右键打开资料设置`
              )}
              className={`dia-liquid-pill arc-pressable h-[25px] max-w-[112px] px-2.5 rounded-full flex items-center justify-center text-[12px] font-medium tracking-[-0.01em] leading-none truncate ${
                isProfileMenuOpen
                  ? isDark
                    ? 'bg-white/[0.16] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_4px_rgba(0,0,0,0.25)]'
                    : 'bg-white/88 text-zinc-950 shadow-[inset_0_1px_0_#fff,0_0_0_0.5px_rgba(15,23,42,0.08),0_2px_6px_rgba(15,23,42,0.06)]'
                  : isDark
                    ? 'bg-white/[0.075] text-zinc-100/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-white/[0.14] hover:text-white'
                    : 'bg-white/55 text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.90),0_0_0_0.5px_rgba(15,23,42,0.055),0_1px_2px_rgba(15,23,42,0.03)] hover:bg-white/85 hover:text-zinc-950'
              }`}
            >
              <span className="truncate">{headerPreviewProfile.name}</span>
            </button>
          </div>
        )}

        <div className="app-no-drag flex items-center gap-0.5 shrink-0">
          {ungroupedActiveSpaceWebCount >= 3 && (
            <button
              type="button"
              onClick={onOrganizeTabs}
              disabled={organizingTabs}
              title={tr(lang, 'Tidy tabs into folders (/organize)', 'AI 智能整理分组 (/organize)')}
              className={`arc-pressable p-1 rounded-md opacity-0 group-hover/spacehdr:opacity-65 hover:!opacity-100 transition-opacity duration-150 ${
                isDark ? 'hover:bg-white/10' : 'hover:bg-black/6'
              }`}
            >
              {organizingTabs ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <FolderKanban size={12} />
              )}
            </button>
          )}

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
        <div ref={trackRef} className="flex w-full h-full will-change-transform">
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

      {/* Folder Header Right-Click Context Menu */}
      {folderMenuState && (
        <>
          <div onClick={() => setFolderMenuState(null)} className="fixed inset-0 z-30" />
          <div
            data-no-swipe="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              top: Math.max(44, Math.min(folderMenuState.y, 420)),
              transformOrigin: 'top left'
            }}
            className={`arc-popover-enter absolute left-2.5 right-2.5 z-40 rounded-2xl border p-1.5 shadow-2xl backdrop-blur-2xl text-[12px] space-y-0.5 ${
              isDark
                ? 'bg-[#25252B]/96 border-white/12 text-zinc-200'
                : 'bg-white/96 border-black/10 text-zinc-800'
            }`}
          >
            <div className="px-2.5 py-1 text-[11px] font-medium opacity-50 truncate border-b border-black/5 dark:border-white/8 mb-1">
              {folderMenuState.group.title}
            </div>

            <button
              type="button"
              onClick={() => {
                const grp = folderMenuState.group
                setFolderMenuState(null)
                setGroupRenameDraft(grp.title)
                setRenamingGroupId(grp.id)
              }}
              className={`arc-pressable w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl ${
                isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.05]'
              }`}
            >
              <Pencil size={12.5} className="opacity-65" />
              <span>{tr(lang, 'Rename Folder…', '重命名文件夹…')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const grp = folderMenuState.group
                setFolderMenuState(null)
                onToggleGroupCollapsed(grp.id)
              }}
              className={`arc-pressable w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl ${
                isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.05]'
              }`}
            >
              {folderMenuState.group.collapsed ? (
                <FolderOpen size={12.5} className="opacity-65" />
              ) : (
                <Folder size={12.5} className="opacity-65" />
              )}
              <span>
                {folderMenuState.group.collapsed
                  ? tr(lang, 'Expand Folder', '展开文件夹')
                  : tr(lang, 'Collapse Folder', '收起文件夹')}
              </span>
            </button>

            <div className={`my-1 border-t ${isDark ? 'border-white/8' : 'border-black/6'}`} />

            <button
              type="button"
              onClick={() => {
                const grpId = folderMenuState.group.id
                setFolderMenuState(null)
                onDeleteTabGroup?.(grpId)
              }}
              className={`arc-pressable w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl ${
                isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.05]'
              }`}
            >
              <FolderKanban size={12.5} className="opacity-65" />
              <span>{tr(lang, 'Ungroup (Keep Tabs)', '解散文件夹（保留页面）')}</span>
            </button>

            {folderMenuState.zone === 'unpinned' && (
              <button
                type="button"
                onClick={() => {
                  const grpId = folderMenuState.group.id
                  setFolderMenuState(null)
                  const members = allTabs.filter((t) => t.groupId === grpId && !t.isPinned)
                  for (const m of members) {
                    onCloseTab(m.id)
                  }
                }}
                className="arc-pressable w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-rose-500 hover:bg-rose-500/10"
              >
                <Trash2 size={12.5} />
                <span>{tr(lang, 'Close Folder & Tabs', '关闭文件夹内全部页面')}</span>
              </button>
            )}
          </div>
        </>
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
                  {accountState?.authenticated && accountState.user && (
                    <span className="text-[10.5px] font-mono text-emerald-500 shrink-0 ml-1.5">
                      {accountState.user.effectiveUnlimited
                        ? '∞'
                        : `$${(accountState.user.remainingUsd ?? 0).toFixed(2)}`}
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
              <span>{tr(lang, 'New Profile…', '新建个人资料…')}</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                const target = e.currentTarget
                setFooterMenuOpen(false)
                triggerEditSpace(headerPreviewProfile, target, 'top-left')
              }}
              className={`arc-pressable w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl ${
                isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.05]'
              }`}
            >
              <SlidersHorizontal size={12.5} className="opacity-60" />
              <span>{tr(lang, 'Profile Settings…', '个人资料设置…')}</span>
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

      {/* Row 4: Dia-Style Calm Bottom Dock ([Archive Icon] ... [• ● •] ... [⌄]) */}
      <div className="relative z-10 h-[36px] px-3 flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={activeDownloads > 0 ? onOpenDownloads : onOpenLibrary}
          title={
            activeDownloads > 0
              ? tr(lang, 'Downloads in progress', '查看正在进行的下载')
              : tr(lang, 'Archive, History & Bookmarks', '归档、历史记录与收藏夹')
          }
          className="arc-pressable p-1 rounded-md opacity-40 hover:opacity-90 hover:bg-black/5 dark:hover:bg-white/8 shrink-0"
        >
          {activeDownloads > 0 ? (
            <Download size={13.5} className="animate-pulse" />
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="2" width="10" height="12" rx="2.2" />
              <path d="M5.6 5.6h4.8" />
              <path d="M5.6 8.3h3.2" />
            </svg>
          )}
        </button>

        {/* Dia-Authentic Minimalist Profile Pagination Dots */}
        <div
          onMouseLeave={() => setHoveredDotId(null)}
          className="relative flex items-center justify-center min-w-0 py-1"
        >
          {(() => {
            const hoveredIdx = hoveredDotId
              ? profiles.findIndex((p) => p.id === hoveredDotId)
              : -1
            const hoveredProfile = hoveredIdx >= 0 ? profiles[hoveredIdx] : null
            if (!hoveredProfile) return null
            const shortcut =
              hoveredIdx < 9
                ? platform === 'darwin'
                  ? `⌃${hoveredIdx + 1}`
                  : `Alt+${hoveredIdx + 1}`
                : ''
            return (
              <div
                className={`pointer-events-none absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full border backdrop-blur-xl flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap shadow-lg ${
                  isDark
                    ? 'bg-[#26262C]/95 border-white/12 text-zinc-100'
                    : 'bg-white/95 border-black/10 text-zinc-800'
                }`}
              >
                <span
                  style={{
                    backgroundColor: hoveredProfile.accentColor || '#52525B',
                    boxShadow: isDark
                      ? 'inset 0 0 0 1px rgba(255,255,255,0.28)'
                      : 'inset 0 0 0 1px rgba(0,0,0,0.14)'
                  }}
                  className="w-2 h-2 rounded-full shrink-0"
                />
                <span>{hoveredProfile.name}</span>
                {shortcut && <span className="opacity-45 text-[10.5px]">{shortcut}</span>}
              </div>
            )
          })()}

          <div className="flex items-center justify-center gap-0.5 overflow-x-auto no-scrollbar">
            {profiles.map((p) => {
              const isSelected = p.id === headerPreviewProfile.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onMouseEnter={() => setHoveredDotId(p.id)}
                  onFocus={() => setHoveredDotId(p.id)}
                  onBlur={() => setHoveredDotId((cur) => (cur === p.id ? null : cur))}
                  onClick={(e) => {
                    setHoveredDotId(null)
                    if (isSelected) {
                      triggerProfileMenu(e.currentTarget, 'top-center')
                    } else {
                      commitProfileSwitch(p.id)
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setHoveredDotId(null)
                    triggerEditSpace(p, e.currentTarget, 'top-center')
                  }}
                  aria-label={p.name}
                  className="group/dot relative w-[14px] h-[20px] flex items-center justify-center shrink-0 cursor-pointer"
                >
                  <span
                    className={`rounded-full transition-all duration-200 ${
                      isSelected
                        ? isDark
                          ? 'w-[6px] h-[6px] bg-white shadow-[0_0_5px_rgba(255,255,255,0.22)]'
                          : 'w-[6px] h-[6px] bg-zinc-900'
                        : isDark
                          ? 'w-[5.5px] h-[5.5px] bg-white/[0.26] group-hover/dot:bg-white/[0.62] group-hover/dot:scale-110'
                          : 'w-[5.5px] h-[5.5px] bg-black/[0.22] group-hover/dot:bg-black/[0.55] group-hover/dot:scale-110'
                    }`}
                  />
                </button>
              )
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setFooterMenuOpen((v) => !v)}
          title={tr(lang, 'More options & Settings', '更多功能与设置')}
          className={`arc-pressable p-1 rounded-md shrink-0 ${
            footerMenuOpen
              ? 'opacity-90 bg-black/5 dark:bg-white/10'
              : 'opacity-40 hover:opacity-90 hover:bg-black/5 dark:hover:bg-white/8'
          }`}
        >
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${footerMenuOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
    </aside>
  )
}

export const VerticalSidebar = React.memo(VerticalSidebarInner, areSidebarPropsEqual)
