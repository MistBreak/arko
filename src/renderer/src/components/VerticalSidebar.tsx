import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownCircle,
  ChevronDown,
  Clock,
  Columns2,
  CornerLeftUp,
  Download,
  Folder,
  FolderKanban,
  FolderOpen,
  FolderPlus,
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
  TabGroupColor,
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
  onCreateTabGroup?: (
    title: string,
    color: TabGroupColor,
    tabIds?: string[],
    options?: {
      parentId?: string | null
      profileId?: string
      zone?: 'pinned' | 'unpinned'
      keepEmpty?: boolean
    }
  ) => Promise<TabGroup>
  onUpdateTabGroup?: (
    groupId: string,
    partial: Partial<Pick<TabGroup, 'title' | 'color' | 'collapsed' | 'parentId'>>
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
const SWIPE_LOCK_X_PX = 10
const SWIPE_LOCK_Y_PX = 7.5
const SWIPE_AXIS_RATIO = 1.6
const SWIPE_TRACKING_GAIN = 0.92
const SWIPE_SNAP_RATIO = 0.28
const SWIPE_PROJECTION_SEC = 0.16
const SWIPE_FLICK_MIN_DIST_RATIO = 0.095
const SWIPE_FLICK_MIN_VELOCITY = 140
const SWIPE_MAX_REF_WIDTH = 260

// Taut NSScrollView-style boundary rubber-band (clear tactile edge feedback without clipping)
const BOUNDARY_RUBBER_MAX_PX = 15
const BOUNDARY_RUBBER_COEFF = 0.45

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
  if (sidebarWidth >= 340 && itemCount >= 5) return 5
  return 4
}

interface FaviconBrandSample {
  kind: 'opaque-brand' | 'glyph-brand' | 'neutral'
  rgb: [number, number, number]
}

const faviconBrandCache = new Map<string, FaviconBrandSample>()
const faviconBrandPending = new Set<string>()

function mixRgbTuple(
  a: [number, number, number],
  b: [number, number, number],
  weightB: number
): [number, number, number] {
  const w = Math.max(0, Math.min(1, weightB))
  return [
    Math.round(a[0] * (1 - w) + b[0] * w),
    Math.round(a[1] * (1 - w) + b[1] * w),
    Math.round(a[2] * (1 - w) + b[2] * w)
  ]
}

function rgbCss([r, g, b]: [number, number, number], alpha = 1): string {
  return alpha >= 0.999 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function extractFaviconBrandSampleFromImage(img: HTMLImageElement): FaviconBrandSample {
  try {
    const size = 32
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return { kind: 'neutral', rgb: [128, 128, 128] }
    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(img, 0, 0, size, size)
    const data = ctx.getImageData(0, 0, size, size).data

    // 1. Sample inset perimeter bands (safely inside rounded-square & circle favicons, outside center glyph)
    const edgeCoords: Array<[number, number]> = []
    for (let i = 10; i <= 21; i += 2) {
      edgeCoords.push([i, 4], [i, 27], [4, i], [27, i])
    }

    const opaqueEdges: Array<[number, number, number]> = []
    for (const [x, y] of edgeCoords) {
      const idx = (y * size + x) * 4
      const a = data[idx + 3]
      if (a >= 205) {
        opaqueEdges.push([data[idx], data[idx + 1], data[idx + 2]])
      }
    }

    if (opaqueEdges.length >= Math.ceil(edgeCoords.length * 0.72)) {
      let sumR = 0
      let sumG = 0
      let sumB = 0
      for (const [r, g, b] of opaqueEdges) {
        sumR += r
        sumG += g
        sumB += b
      }
      const meanR = sumR / opaqueEdges.length
      const meanG = sumG / opaqueEdges.length
      const meanB = sumB / opaqueEdges.length

      let consistentCount = 0
      for (const [r, g, b] of opaqueEdges) {
        const dist = Math.abs(r - meanR) + Math.abs(g - meanG) + Math.abs(b - meanB)
        if (dist <= 48) consistentCount++
      }

      if (consistentCount >= Math.ceil(opaqueEdges.length * 0.8)) {
        const r = Math.round(meanR)
        const g = Math.round(meanG)
        const b = Math.round(meanB)
        const maxC = Math.max(r, g, b)
        const minC = Math.min(r, g, b)
        const sat = maxC > 0 ? (maxC - minC) / maxC : 0
        const val = maxC / 255
        if (sat >= 0.16 && val >= 0.18 && val <= 0.95) {
          return { kind: 'opaque-brand', rgb: [r, g, b] }
        }
      }
    }

    // 2. Otherwise inspect chromatic foreground glyph pixels on transparent/multi-tone icons
    let wSum = 0
    let wR = 0
    let wG = 0
    let wB = 0
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]
      if (a < 120) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const maxC = Math.max(r, g, b)
      const minC = Math.min(r, g, b)
      const sat = maxC > 0 ? (maxC - minC) / maxC : 0
      const val = maxC / 255
      if (sat < 0.26 || val < 0.22 || val > 0.98) continue
      const w = sat * (a / 255)
      wSum += w
      wR += r * w
      wG += g * w
      wB += b * w
    }

    if (wSum >= 10) {
      return {
        kind: 'glyph-brand',
        rgb: [Math.round(wR / wSum), Math.round(wG / wSum), Math.round(wB / wSum)]
      }
    }
  } catch {
    // Tainted canvas or decode failure -> calm neutral fallback
  }
  return { kind: 'neutral', rgb: [128, 128, 128] }
}

function getDiaActivePinStyle(
  sample: FaviconBrandSample | undefined,
  isDark: boolean
): React.CSSProperties {
  if (sample?.kind === 'opaque-brand') {
    const borderRgb = mixRgbTuple(sample.rgb, [255, 255, 255], 0.56)
    return {
      backgroundColor: rgbCss(sample.rgb),
      boxShadow: `inset 0 0 0 2px ${rgbCss(borderRgb)}`
    }
  }

  if (sample?.kind === 'glyph-brand') {
    if (isDark) {
      const fillRgb = mixRgbTuple([44, 45, 48], sample.rgb, 0.34)
      const borderRgb = mixRgbTuple(sample.rgb, [255, 255, 255], 0.48)
      return {
        backgroundColor: rgbCss(fillRgb),
        boxShadow: `inset 0 0 0 2px ${rgbCss(borderRgb, 0.88)}`
      }
    }
    const fillRgb = mixRgbTuple([246, 246, 248], sample.rgb, 0.2)
    const borderRgb = mixRgbTuple(sample.rgb, [255, 255, 255], 0.12)
    return {
      backgroundColor: rgbCss(fillRgb),
      boxShadow: `inset 0 0 0 2px ${rgbCss(borderRgb, 0.62)}`
    }
  }

  if (isDark) {
    return {
      backgroundColor: 'rgba(255, 255, 255, 0.16)',
      boxShadow: 'inset 0 0 0 2px rgba(255, 255, 255, 0.46)'
    }
  }
  return {
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    boxShadow: 'inset 0 0 0 2px rgba(24, 24, 27, 0.24)'
  }
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
  peakVelocityPx: number
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
  absorbOppositePx: number
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
  g.peakVelocityPx = 0
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
  g.absorbOppositePx = 0
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
  onCreateTabGroup,
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
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
  const [dropZoneHover, setDropZoneHover] = useState<TabPinMode | null>(null)
  const [favPreviewIndex, setFavPreviewIndex] = useState<number | null>(null)
  const [pinnedPreviewIndex, setPinnedPreviewIndex] = useState<number | null>(null)
  const [isExternalLinkHovering, setIsExternalLinkHovering] = useState(false)
  const [, bumpFaviconBrandVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    for (const t of allTabs) {
      if (!(t.isFavorite || t.isPinned) || t.groupId || !t.favicon) continue
      const src = t.favicon
      if (faviconBrandCache.has(src) || faviconBrandPending.has(src)) continue
      faviconBrandPending.add(src)
      const img = new Image()
      if (!src.startsWith('data:')) {
        img.crossOrigin = 'anonymous'
      }
      img.onload = () => {
        faviconBrandPending.delete(src)
        faviconBrandCache.set(src, extractFaviconBrandSampleFromImage(img))
        if (!cancelled) {
          bumpFaviconBrandVersion((v) => v + 1)
        }
      }
      img.onerror = () => {
        faviconBrandPending.delete(src)
        faviconBrandCache.set(src, { kind: 'neutral', rgb: [128, 128, 128] })
      }
      img.src = src
    }
    return () => {
      cancelled = true
    }
  }, [allTabs])

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
    peakVelocityPx: 0,
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
    absorbOppositePx: 0,
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
      const movedEnoughForFlick =
        Math.abs(offset) >= gestureWidth * SWIPE_FLICK_MIN_DIST_RATIO &&
        Math.abs(releaseVelocityPx) >= SWIPE_FLICK_MIN_VELOCITY
      const shouldSwitch =
        candidateIdx >= 0 &&
        candidateIdx < curProfiles.length &&
        (Math.abs(offset) >= gestureWidth * SWIPE_SNAP_RATIO ||
          (movedEnoughForFlick &&
            Math.sign(releaseVelocityPx) === Math.sign(offset) &&
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
    setDraggingGroupId(null)
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
      g.absorbOppositePx = 0
    }

    const scheduleStreamEnd = (g: WheelGestureState, delayMs = 165): void => {
      if (g.streamEndTimer !== null) window.clearTimeout(g.streamEndTimer)
      g.streamEndTimer = window.setTimeout(() => {
        resetWheelGestureToIdle(g)
      }, delayMs)
    }

    const beginDraggingFromCurrentOffset = (
      g: WheelGestureState,
      initialRawStepPx: number,
      snapBaseToZero = false
    ): void => {
      const { profiles: curProfiles, width: curWidth } = latestPropsRef.current
      const p = physicsRef.current
      stopSpringLoop()
      if (snapBaseToZero) {
        p.offsetPx = 0
        p.velocityPx = 0
      }
      g.phase = 'dragging'
      g.rawDragPx =
        visualOffsetToRawDrag(p.offsetPx, p.baseIndex, curProfiles.length, curWidth) +
        initialRawStepPx
      g.velocityPx = 0
      g.peakVelocityPx = 0
      g.decayRatios = []
      g.decayStreak = 0
      g.peakMedAbsX = 0
      setCarouselMovingSync(true)
      p.offsetPx = rawDragToVisualOffset(g.rawDragPx, p.baseIndex, curProfiles.length, curWidth)
      applyVisualFrame(p.offsetPx, p.baseIndex)
    }

    const armDragIdleRelease = (g: WheelGestureState, refTime: number): void => {
      if (g.dragIdleTimer !== null) window.clearTimeout(g.dragIdleTimer)
      g.dragIdleTimer = window.setTimeout(() => {
        if (g.phase === 'dragging') {
          releaseDragIntoSpring(0)
          enterAbsorbing(g, g.lastDxSign, refTime + 115, 0)
          scheduleStreamEnd(g, 165)
        }
      }, 115)
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
        curProfiles.length <= 1
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

      if (dtMs > 170 || dtMs < 0) {
        resetWheelGestureToIdle(g)
      }

      // Normalize per-10ms velocity + 3-sample median filter to eliminate 2x VSync/HID beat-frequency spikes
      const normDtMs = dtMs > 0 ? Math.max(4, Math.min(36, dtMs)) : 10
      const normAbsX = (absX / normDtMs) * 10
      g.rawAbsWindow.push(normAbsX)
      if (g.rawAbsWindow.length > 3) g.rawAbsWindow.shift()
      const medAbsX = median3(g.rawAbsWindow)
      const dxSign: 1 | -1 | 0 = dx > 0.06 ? 1 : dx < -0.06 ? -1 : 0

      if (g.phase === 'idle') {
        g.phase = 'undecided'
        g.intentX = 0
        g.intentAbsY = 0
      }

      // Post-release momentum shield:
      // - Swallows passive inertial tail so 1 flick switches strictly 1 Space without bouncing twice
      // - Ignores tiny finger-lift reverse roll-off (< 15px) so settling springs never ping-pong back
      // - Immediately engages if the user performs a genuine consecutive swipe (same or opposite direction)
      if (g.phase === 'absorbing') {
        scheduleStreamEnd(g, 165)

        if (absX > absY) {
          e.preventDefault()
        }

        if (dxSign !== 0 && g.absorbDir !== 0 && dxSign !== g.absorbDir && absX > absY * 1.4) {
          g.absorbOppositePx += -dx
        } else if (dxSign === g.absorbDir) {
          g.absorbOppositePx = 0
        }

        // Detect a genuine fresh finger push in the same direction (velocity accelerates above decaying inertia)
        if (dxSign === g.absorbDir || g.absorbDir === 0) {
          const threshold = Math.max(g.minAbsorbedMed * 1.55 + 3.5, 8.5)
          if (
            now - g.absorbEnteredAt >= 110 &&
            medAbsX > threshold &&
            medAbsX > g.prevMedAbsX * 1.12 &&
            absX > absY * 1.5
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

        if (Math.abs(g.absorbOppositePx) >= 15) {
          const excessOpposite =
            Math.sign(g.absorbOppositePx) *
            Math.max(2, Math.abs(g.absorbOppositePx) - 10) *
            SWIPE_TRACKING_GAIN
          g.rawAbsWindow = [normAbsX]
          g.prevMedAbsX = normAbsX
          beginDraggingFromCurrentOffset(g, excessOpposite, true)
          g.peakMedAbsX = normAbsX
          armDragIdleRelease(g, now)
          return
        }

        if (g.reengageStreak >= 2) {
          g.rawAbsWindow = [normAbsX]
          g.prevMedAbsX = normAbsX
          beginDraggingFromCurrentOffset(g, -dx * SWIPE_TRACKING_GAIN, true)
          g.peakMedAbsX = normAbsX
          armDragIdleRelease(g, now)
          return
        }

        return
      }

      if (g.phase === 'vertical') {
        // Allow breaking out of vertical inertial coasting if the user initiates a clear horizontal swipe
        if (absX >= 8.5 && absX > absY * 2.1) {
          g.phase = 'undecided'
          g.intentX = 0
          g.intentAbsY = 0
        } else {
          scheduleStreamEnd(g, 150)
          g.prevMedAbsX = medAbsX
          return
        }
      }

      if (g.phase === 'undecided') {
        scheduleStreamEnd(g, 150)

        if (dxSign !== 0 && g.intentX !== 0 && Math.sign(-dx) !== Math.sign(g.intentX)) {
          g.intentX = 0
        }

        g.intentX += -dx
        g.intentAbsY += absY

        // Only lock vertical when vertical travel genuinely dominates horizontal travel
        if (g.intentAbsY >= SWIPE_LOCK_Y_PX && g.intentAbsY > Math.abs(g.intentX) * 1.15) {
          g.phase = 'vertical'
          g.prevMedAbsX = medAbsX
          return
        }

        if (
          Math.abs(g.intentX) >= SWIPE_LOCK_X_PX &&
          Math.abs(g.intentX) >= g.intentAbsY * SWIPE_AXIS_RATIO &&
          absX > absY * 1.25
        ) {
          e.preventDefault()
          const clampedDtSec = Math.min(0.05, Math.max(0.004, normDtMs / 1000))
          const excessPx =
            Math.sign(g.intentX) *
            Math.max(2, Math.abs(g.intentX) - SWIPE_LOCK_X_PX * 0.65) *
            SWIPE_TRACKING_GAIN
          beginDraggingFromCurrentOffset(g, excessPx)
          const initVx = (-dx * SWIPE_TRACKING_GAIN) / clampedDtSec
          g.velocityPx = initVx
          g.peakVelocityPx = initVx
          g.peakMedAbsX = medAbsX
          g.prevMedAbsX = medAbsX
          if (dxSign !== 0) g.lastDxSign = dxSign
          armDragIdleRelease(g, now)
        } else {
          g.prevMedAbsX = medAbsX
        }
        return
      }

      // Active horizontal manipulation ('dragging')
      const p = physicsRef.current
      if (Math.abs(p.offsetPx) < 14 && absY > absX * 2.0 && absY > 8) {
        releaseDragIntoSpring(0)
        clearGestureTimers(g)
        g.phase = 'vertical'
        scheduleStreamEnd(g, 150)
        g.prevMedAbsX = medAbsX
        return
      }

      e.preventDefault()
      scheduleStreamEnd(g, 180)

      const clampedDtSec = Math.min(0.05, Math.max(0.004, normDtMs / 1000))
      const stepX = -dx * SWIPE_TRACKING_GAIN
      const instVx = stepX / clampedDtSec
      g.velocityPx = g.velocityPx === 0 ? instVx : g.velocityPx * 0.52 + instVx * 0.48
      if (
        Math.sign(g.velocityPx) !== Math.sign(g.peakVelocityPx) ||
        Math.abs(g.velocityPx) >= Math.abs(g.peakVelocityPx)
      ) {
        g.peakVelocityPx = g.velocityPx
      } else {
        // Gently decay peak velocity when user slows fingers deliberately, while preserving flick impulse across 3-4 momentum detection frames
        g.peakVelocityPx = g.peakVelocityPx * 0.88 + g.velocityPx * 0.12
      }

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
      } else if (g.prevMedAbsX > 0.35 && medAbsX <= g.prevMedAbsX * 1.015 + 0.08) {
        const ratio = medAbsX / g.prevMedAbsX
        g.decayStreak += 1
        if (ratio >= 0.74 && ratio <= 0.985) {
          g.decayRatios.push(ratio)
          if (g.decayRatios.length > 5) g.decayRatios.shift()
        } else if (ratio < 0.74) {
          g.decayRatios = []
        }
      } else if (medAbsX > g.prevMedAbsX * 1.08 + 0.4) {
        g.decayRatios = []
        g.decayStreak = 0
      }

      g.prevMedAbsX = medAbsX
      if (dxSign !== 0) g.lastDxSign = dxSign

      let enteredSyntheticMomentum = false
      if (g.decayRatios.length >= 4 && medAbsX <= g.peakMedAbsX * 0.78) {
        const maxR = Math.max(...g.decayRatios)
        const minR = Math.min(...g.decayRatios)
        if (maxR - minR <= 0.075) {
          enteredSyntheticMomentum = true
        }
      }

      const gestureWidth = Math.min(curWidth, SWIPE_MAX_REF_WIDTH)
      const isCleanFlickRelease =
        g.peakMedAbsX >= 12 &&
        Math.abs(g.rawDragPx) >= gestureWidth * 0.16 &&
        g.decayStreak >= 3 &&
        medAbsX <= g.peakMedAbsX * 0.68

      const isLowTailDecay =
        g.peakMedAbsX >= 3.5 &&
        g.decayStreak >= 4 &&
        medAbsX <= Math.min(1.6, g.peakMedAbsX * 0.28)

      if (enteredSyntheticMomentum || isCleanFlickRelease || isLowTailDecay) {
        const effectiveVx =
          Math.abs(g.peakVelocityPx) > Math.abs(g.velocityPx) ? g.peakVelocityPx : g.velocityPx
        releaseDragIntoSpring(effectiveVx)
        enterAbsorbing(g, g.lastDxSign, now, medAbsX)
        return
      }

      g.rawDragPx += stepX
      p.offsetPx = rawDragToVisualOffset(g.rawDragPx, p.baseIndex, curProfiles.length, curWidth)
      applyVisualFrame(p.offsetPx, p.baseIndex)
      armDragIdleRelease(g, e.timeStamp > 0 ? e.timeStamp : now)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
    }
  }, [applyVisualFrame, releaseDragIntoSpring, setCarouselMovingSync, stopSpringLoop])

  const handleMouseSwipeStart = (e: React.MouseEvent<HTMLElement>): void => {
    if (e.button !== 0 || draggingTabId || isResizing || renamingSpaceId || profiles.length <= 1) {
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
    const MOUSE_DEADZONE_PX = 34
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
        if (Math.abs(dy) > 7 && Math.abs(dy) >= Math.abs(dx) * 0.8) {
          axis = 'vertical'
          cleanup()
          return
        }
        if (Math.abs(dx) > MOUSE_DEADZONE_PX && Math.abs(dx) > Math.abs(dy) * 2.5) {
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
          Math.sign(dx) * Math.max(0, Math.abs(dx) - MOUSE_DEADZONE_PX) * SWIPE_TRACKING_GAIN
        const instVx = (stepDx * SWIPE_TRACKING_GAIN) / dtSec
        vxPxPerSec = vxPxPerSec === 0 ? instVx : vxPxPerSec * 0.6 + instVx * 0.4

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

    const favoriteTabs = pTabs.filter((t) => (t.isFavorite || t.isPinned) && !t.groupId)
    const pinnedTabs = pTabs.filter((t) => t.isPinned && Boolean(t.groupId))
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
      indentDepth = 0
    ): React.ReactNode => {
      const clampedIndent = Math.max(0, Math.min(indentDepth, 6))
      const rowPaddingLeft = 10 + clampedIndent * 14
      const activeBarLeft = clampedIndent > 0 ? rowPaddingLeft - 10 : 4
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
          style={{
            paddingLeft: rowPaddingLeft,
            ...(isActive
              ? {
                  backgroundColor: slideTheme.activeTabBg,
                  boxShadow: slideTheme.activeTabShadow
                }
              : undefined)
          }}
          className={`arc-pressable group relative flex items-center gap-2 h-[32px] pr-2 hover:pr-1.5 rounded-[10px] text-[12.5px] cursor-pointer ${
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
              style={{ backgroundColor: slideTheme.accentHex, left: activeBarLeft }}
              className="absolute top-1/2 -translate-y-1/2 w-[2.5px] h-3.5 rounded-full pointer-events-none"
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

          <span className="dia-tab-title flex-1 min-w-0">
            {tab.title || tr(lang, 'New Tab', '新标签页')}
          </span>

          {tab.isAudioPlaying && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onMuteTab(tab.id)
              }}
              title={
                tab.isMuted ? tr(lang, 'Unmute', '取消静音') : tr(lang, 'Mute tab', '静音此标签页')
              }
              className="opacity-70 hover:opacity-100 w-[18px] h-[18px] flex items-center justify-center rounded-[5px] hover:bg-black/[0.07] dark:hover:bg-white/[0.12] shrink-0"
            >
              {tab.isMuted ? <VolumeX size={11.5} /> : <Volume2 size={11.5} />}
            </button>
          )}

          {zone === 'pinned' ? (
            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
              {hasDriftedFromPinned && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onResetPinnedTab(tab.id)
                  }}
                  title={tr(
                    lang,
                    'Reset to initial pinned URL',
                    '已偏离初始固定页 · 点击还原初始网址'
                  )}
                  className="opacity-65 hover:opacity-100 w-[18px] h-[18px] flex items-center justify-center rounded-[5px] hover:bg-black/[0.07] dark:hover:bg-white/[0.12] transition"
                >
                  <RotateCcw size={11} />
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onSetTabPinState(tab.id, 'unpinned')
                }}
                title={tr(lang, 'Unpin tab', '取消固定标签页')}
                className="opacity-65 hover:opacity-100 w-[18px] h-[18px] flex items-center justify-center rounded-[5px] hover:bg-black/[0.07] dark:hover:bg-white/[0.12] transition"
              >
                <PinOff size={11.5} />
              </button>
            </div>
          ) : (
            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onSetTabPinState(tab.id, 'favorite')
                }}
                title={tr(lang, 'Pin Tab', '固定到顶部 Pin 栏')}
                className="opacity-60 hover:opacity-100 w-[18px] h-[18px] flex items-center justify-center rounded-[5px] hover:bg-black/[0.07] dark:hover:bg-white/[0.12] transition"
              >
                <Pin size={11} />
              </button>

              {!splitRole && tab.id !== pActiveTabId && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenTabInSplit(tab.id)
                  }}
                  title={tr(lang, 'Open in Right Split View', '在右侧分屏中打开')}
                  className="opacity-60 hover:opacity-100 w-[18px] h-[18px] flex items-center justify-center rounded-[5px] hover:bg-black/[0.07] dark:hover:bg-white/[0.12] transition"
                >
                  <Columns2 size={11} />
                </button>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
                title={tr(lang, 'Close Tab (⌘W)', '关闭标签 (⌘W)')}
                className="opacity-65 hover:opacity-100 w-[18px] h-[18px] flex items-center justify-center rounded-[5px] hover:bg-black/[0.07] dark:hover:bg-white/[0.12] transition"
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

    const isTabKeptWhenCollapsed = (t: TabState): boolean =>
      t.id === pActiveTabId ||
      Boolean(pSplit?.enabled && (t.id === pSplit.leftTabId || t.id === pSplit.rightTabId))

    const groupById = new Map(pGroups.map((g) => [g.id, g]))
    const isGroupAncestorOf = (ancestorId: string, candidateId: string): boolean => {
      let cur = groupById.get(candidateId)?.parentId ?? null
      const seen = new Set<string>()
      while (cur && !seen.has(cur)) {
        if (cur === ancestorId) return true
        seen.add(cur)
        cur = groupById.get(cur)?.parentId ?? null
      }
      return false
    }

    const buildZoneRows = (
      sourceTabs: TabState[],
      zone: 'pinned' | 'unpinned'
    ): React.ReactNode[] => {
      const tabIndexById = new Map<string, number>()
      const directTabsByGroup = new Map<string, TabState[]>()
      sourceTabs.forEach((t, idx) => {
        tabIndexById.set(t.id, idx)
        if (t.groupId && groupById.has(t.groupId)) {
          const list = directTabsByGroup.get(t.groupId) || []
          list.push(t)
          directTabsByGroup.set(t.groupId, list)
        }
      })

      const oppositeTabs = zone === 'pinned' ? todayTabs : pinnedTabs
      const oppositeDirectGroupIds = new Set(
        oppositeTabs.map((t) => t.groupId).filter(Boolean) as string[]
      )

      const zoneGroupIds = new Set<string>()
      for (const g of pGroups) {
        const hasSourceTabs = (directTabsByGroup.get(g.id)?.length || 0) > 0
        const hasOppositeTabs = oppositeDirectGroupIds.has(g.id)
        if (hasSourceTabs || (!hasOppositeTabs && (g.zone || 'pinned') === zone)) {
          let cur: string | null | undefined = g.id
          const seen = new Set<string>()
          while (cur && !seen.has(cur)) {
            seen.add(cur)
            const curGrp = groupById.get(cur)
            if (!curGrp) break
            if (zone === 'unpinned' && pinnedTabs.some((pt) => pt.groupId === cur)) break
            zoneGroupIds.add(cur)
            cur = curGrp.parentId
          }
        }
      }

      // Prune empty ancestor groups that only belonged to the opposite zone
      let pruned = true
      while (pruned) {
        pruned = false
        for (const gid of [...zoneGroupIds]) {
          const g = groupById.get(gid)
          if (!g) {
            zoneGroupIds.delete(gid)
            pruned = true
            continue
          }
          const hasDirect = (directTabsByGroup.get(gid)?.length || 0) > 0
          const hasKeepEmpty = Boolean(g.keepEmpty && (g.zone || 'pinned') === zone)
          const hasChildInZone = pGroups.some(
            (cg) => cg.parentId === gid && cg.id !== gid && zoneGroupIds.has(cg.id)
          )
          if (!hasDirect && !hasKeepEmpty && !hasChildInZone) {
            zoneGroupIds.delete(gid)
            pruned = true
          }
        }
      }

      const effectiveParentById = new Map<string, string | null>()
      const childrenByParent = new Map<string, TabGroup[]>()
      const rootGroups: TabGroup[] = []

      for (const g of pGroups) {
        if (!zoneGroupIds.has(g.id)) continue
        let parentId =
          g.parentId && g.parentId !== g.id && zoneGroupIds.has(g.parentId) ? g.parentId : null
        if (parentId && isGroupAncestorOf(g.id, parentId)) {
          parentId = null
        }
        effectiveParentById.set(g.id, parentId)
        if (parentId) {
          const list = childrenByParent.get(parentId) || []
          list.push(g)
          childrenByParent.set(parentId, list)
        } else {
          rootGroups.push(g)
        }
      }

      const groupRankById = new Map(pGroups.map((g, idx) => [g.id, idx]))
      const subtreeCache = new Map<
        string,
        { subtreeTabs: TabState[]; minIdx: number }
      >()

      const getSubtreeInfo = (
        gid: string,
        visiting = new Set<string>()
      ): { subtreeTabs: TabState[]; minIdx: number } => {
        const cached = subtreeCache.get(gid)
        if (cached) return cached
        if (visiting.has(gid)) {
          return { subtreeTabs: [], minIdx: 1_000_000 }
        }
        visiting.add(gid)

        const direct = directTabsByGroup.get(gid) || []
        const children = childrenByParent.get(gid) || []

        type CombinedItem =
          | { kind: 'tab'; tab: TabState; order: number }
          | { kind: 'child'; tabs: TabState[]; order: number }

        const combined: CombinedItem[] = []
        let minIdx = 1_000_000 + (groupRankById.get(gid) ?? 0)

        for (const t of direct) {
          const idx = tabIndexById.get(t.id) ?? minIdx
          if (idx < minIdx) minIdx = idx
          combined.push({ kind: 'tab', tab: t, order: idx })
        }
        for (const cg of children) {
          const childInfo = getSubtreeInfo(cg.id, visiting)
          if (childInfo.minIdx < minIdx) minIdx = childInfo.minIdx
          combined.push({ kind: 'child', tabs: childInfo.subtreeTabs, order: childInfo.minIdx })
        }

        combined.sort((a, b) => a.order - b.order)
        const subtreeTabs: TabState[] = []
        for (const item of combined) {
          if (item.kind === 'tab') subtreeTabs.push(item.tab)
          else subtreeTabs.push(...item.tabs)
        }

        const result = { subtreeTabs, minIdx }
        subtreeCache.set(gid, result)
        return result
      }

      const getRootGroupForId = (gid: string): TabGroup | undefined => {
        let cur = gid
        const seen = new Set<string>()
        while (cur && !seen.has(cur)) {
          seen.add(cur)
          const p = effectiveParentById.get(cur)
          if (!p) return groupById.get(cur)
          cur = p
        }
        return groupById.get(gid)
      }

      const renderFolderBlock = (
        grp: TabGroup,
        depth: number,
        ancestorCollapsed: boolean
      ): React.ReactNode => {
        const isDropTarget = isVisualSlide && dragOverGroupId === grp.id
        const isRenamingThis = renamingGroupId === grp.id
        const isBeingDragged = draggingGroupId === grp.id
        const directTabs = directTabsByGroup.get(grp.id) || []
        const childGroups = childrenByParent.get(grp.id) || []
        const { subtreeTabs } = getSubtreeInfo(grp.id)
        const totalCount = subtreeTabs.length
        const keptTabsInSubtree = subtreeTabs.filter(isTabKeptWhenCollapsed)
        const hasOpenVisibleInGroup = keptTabsInSubtree.length > 0

        const clampedDepth = Math.max(0, Math.min(depth, 5))
        const headerPaddingLeft = (zone === 'pinned' ? 10 : 8) + clampedDepth * 14

        type FolderChildEntry =
          | { kind: 'group'; group: TabGroup; order: number }
          | { kind: 'tab'; tab: TabState; order: number }

        const entries: FolderChildEntry[] = [
          ...directTabs.map((t) => ({
            kind: 'tab' as const,
            tab: t,
            order: tabIndexById.get(t.id) ?? 0
          })),
          ...childGroups.map((cg) => ({
            kind: 'group' as const,
            group: cg,
            order: getSubtreeInfo(cg.id).minIdx
          }))
        ].sort((a, b) => a.order - b.order)

        return (
          <div
            key={`vgrp-${zone}-${grp.id}`}
            onDragOver={(e) => {
              const linkDrag =
                Boolean(externalDragLink) || hasExternalLinkDragPayload(e.dataTransfer)
              const folderDrag =
                draggingGroupId !== null &&
                draggingGroupId !== grp.id &&
                !isGroupAncestorOf(draggingGroupId, grp.id)
              if (!draggingTabId && !folderDrag && !linkDrag) return
              e.preventDefault()
              e.stopPropagation()
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              resetAllDragPreviews()
              onTabDragStateChange?.(null)
            }}
            className={`${isBeingDragged ? 'opacity-45' : ''} ${
              zone === 'unpinned' && depth === 0
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
            }`}
          >
            {isRenamingThis ? (
              <div
                data-no-swipe="true"
                style={{ paddingLeft: headerPaddingLeft }}
                className="flex items-center gap-2 h-[31px] pr-2.5"
                onClick={(e) => e.stopPropagation()}
              >
                <FolderOpen size={13} strokeWidth={1.75} className="shrink-0 opacity-55" />
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
                draggable
                onDragStart={(e) => {
                  e.stopPropagation()
                  e.dataTransfer.setData('application/x-arko-group-id', grp.id)
                  e.dataTransfer.effectAllowed = 'move'
                  const draggedGid = grp.id
                  window.setTimeout(() => setDraggingGroupId(draggedGid), 0)
                }}
                onDragEnd={() => {
                  resetAllDragPreviews()
                }}
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
                  const folderDrag =
                    draggingGroupId !== null &&
                    draggingGroupId !== grp.id &&
                    !isGroupAncestorOf(draggingGroupId, grp.id)
                  if (!draggingTabId && !folderDrag && !linkDrag) return
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
                  const srcGroupId =
                    e.dataTransfer.getData('application/x-arko-group-id') || draggingGroupId
                  const srcId =
                    !srcGroupId
                      ? e.dataTransfer.getData('application/x-dia-tab-id') || draggingTabId
                      : null
                  const droppedUrl =
                    !srcGroupId && !srcId
                      ? extractDroppedExternalUrl(e.dataTransfer) || externalDragLink?.url
                      : null
                  resetAllDragPreviews()
                  onTabDragStateChange?.(null)
                  if (
                    srcGroupId &&
                    srcGroupId !== grp.id &&
                    !isGroupAncestorOf(srcGroupId, grp.id)
                  ) {
                    onUpdateTabGroup?.(srcGroupId, { parentId: grp.id })
                  } else if (srcId) {
                    onAssignTabToGroup?.(srcId, grp.id)
                  } else if (droppedUrl) {
                    onDropExternalUrl?.(droppedUrl, zone, null, grp.id)
                  }
                }}
                style={{ paddingLeft: headerPaddingLeft }}
                title={tr(
                  lang,
                  `${grp.title} (${totalCount}) — Click to ${grp.collapsed ? 'expand' : 'collapse'} · Right-click for folder options`,
                  `${grp.title}（${totalCount} 个标签）— 点击${grp.collapsed ? '展开' : '收起'} · 右键管理文件夹`
                )}
                className={`arc-pressable group/fhdr w-full flex items-center gap-2 ${
                  zone === 'pinned'
                    ? 'h-[32px] pr-2 rounded-[10px] text-[12.5px]'
                    : 'h-[30px] pr-2 rounded-lg text-[12px]'
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
                <span
                  className={`dia-tab-title min-w-0 text-left ${zone === 'pinned' ? '' : 'flex-1'}`}
                >
                  {grp.title}
                </span>
                {zone === 'unpinned' && grp.collapsed && (
                  <span
                    className={`text-[10.5px] tabular-nums px-1.5 py-0.2 rounded-full shrink-0 ${
                      isDark
                        ? 'bg-white/[0.07] text-zinc-300/80'
                        : 'bg-black/[0.05] text-zinc-600/85'
                    }`}
                  >
                    {totalCount}
                  </span>
                )}
                <ChevronDown
                  size={12}
                  className={`shrink-0 transition-transform duration-200 ${
                    grp.collapsed
                      ? '-rotate-90 opacity-45 group-hover/fhdr:opacity-80'
                      : 'rotate-0 opacity-45 group-hover/fhdr:opacity-80'
                  }`}
                />
              </button>
            )}

            <div className="arc-collapse-grid" data-open={!grp.collapsed}>
              <div className="arc-collapse-inner">
                <div>
                  {entries.map((entry) =>
                    entry.kind === 'group' ? (
                      <div key={`sub-${entry.group.id}`} className="pt-0.5">
                        {renderFolderBlock(
                          entry.group,
                          depth + 1,
                          ancestorCollapsed || grp.collapsed
                        )}
                      </div>
                    ) : (
                      <div key={entry.tab.id} className="pt-0.5">
                        {renderTabRow(entry.tab, zone, depth + 1)}
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>

            {keptTabsInSubtree.length > 0 && (
              <div
                className="arc-collapse-grid"
                data-open={grp.collapsed && !ancestorCollapsed}
              >
                <div className="arc-collapse-inner">
                  {keptTabsInSubtree.map((keptTab) => (
                    <div key={`kept-${grp.id}-${keptTab.id}`} className="pt-0.5">
                      {renderTabRow(keptTab, zone, depth + 1)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      }

      const renderedRootIds = new Set<string>()
      const nodes: React.ReactNode[] = []

      for (const tab of sourceTabs) {
        if (tab.groupId && zoneGroupIds.has(tab.groupId)) {
          const rootGrp = getRootGroupForId(tab.groupId)
          if (rootGrp) {
            if (!renderedRootIds.has(rootGrp.id)) {
              renderedRootIds.add(rootGrp.id)
              nodes.push(renderFolderBlock(rootGrp, 0, false))
            }
            continue
          }
        }
        nodes.push(renderTabRow(tab, zone, 0))
      }

      for (const rootGrp of rootGroups) {
        if (!renderedRootIds.has(rootGrp.id)) {
          renderedRootIds.add(rootGrp.id)
          nodes.push(renderFolderBlock(rootGrp, 0, false))
        }
      }

      if (zone === 'pinned' && isPinnedLivePreviewActive) {
        nodes.push(renderPinnedPreviewRow())
      }

      return nodes
    }

    const pinnedNodes = buildZoneRows(pinnedTabs, 'pinned')
    const todayNodes = buildZoneRows(todayTabs, 'unpinned')

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
          className={`px-2.5 shrink-0 max-h-[44%] overflow-y-auto overflow-x-hidden overscroll-x-none no-scrollbar ${
            favRenderSlots.length > 0 || hasAnyIncomingDrag ? 'pt-0.5 pb-2' : 'pb-0.5'
          }`}
        >
          {favRenderSlots.length > 0 ? (
            <div
              ref={isVisualSlide ? favGridRef : undefined}
              className={`grid ${favGridColsClass} gap-1.5 rounded-xl transition-all duration-150 ${
                isFavLivePreviewActive
                  ? isDark
                    ? 'p-1 -m-1 ring-1 ring-white/20 bg-white/[0.03]'
                    : 'p-1 -m-1 ring-1 ring-black/15 bg-black/[0.025]'
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
                      className={`relative h-[40px] rounded-[11px] border border-dashed flex items-center justify-center pointer-events-none transition-all duration-150 ${
                        isDark
                          ? 'border-white/30 bg-white/[0.08] text-zinc-200'
                          : 'border-black/25 bg-black/[0.05] text-zinc-700'
                      }`}
                    >
                      {slot.url ? (
                        <FaviconIcon url={slot.url} favicon={slot.favicon} size={16} />
                      ) : (
                        <Link2 size={15} className="opacity-75 shrink-0" />
                      )}
                    </div>
                  )
                }

                const tab = slot.tab
                const isActive = !isNewTabPromptOnSlide && tab.id === pActiveTabId
                const inSplit =
                  pSplit?.enabled &&
                  (tab.id === pSplit.leftTabId || tab.id === pSplit.rightTabId)
                const drifted = Boolean(tab.pinnedUrl && tab.url !== tab.pinnedUrl)
                const brandSample = tab.favicon ? faviconBrandCache.get(tab.favicon) : undefined

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
                    title={`${tab.title || tab.url}${
                      drifted
                        ? tr(lang, ' (Double-click to reset URL)', '（双击还原初始固定网址）')
                        : ''
                    }`}
                    style={isActive ? getDiaActivePinStyle(brandSample, isDark) : undefined}
                    className={`dia-pin-tile group relative h-[40px] rounded-[11px] flex items-center justify-center cursor-pointer ${
                      isActive
                        ? ''
                        : inSplit
                          ? isDark
                            ? 'bg-white/[0.13] ring-1 ring-inset ring-white/25'
                            : 'bg-black/[0.08] ring-1 ring-inset ring-black/15'
                          : isDark
                            ? 'bg-white/[0.085] hover:bg-white/[0.125]'
                            : 'bg-black/[0.055] hover:bg-black/[0.09]'
                    }`}
                  >
                    {tab.isLoading ? (
                      <Loader2 size={15} className="animate-spin opacity-65 shrink-0" />
                    ) : (
                      <FaviconIcon url={tab.url} favicon={tab.favicon} size={16} />
                    )}

                    {tab.isAudioPlaying && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          onMuteTab(tab.id)
                        }}
                        className={`absolute top-1 right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                          isDark ? 'bg-zinc-900/75 text-white' : 'bg-white/85 text-zinc-900'
                        }`}
                      >
                        {tab.isMuted ? <VolumeX size={8} /> : <Volume2 size={8} />}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : hasAnyIncomingDrag ? (
            <div
              className={`h-[40px] rounded-[11px] border border-dashed flex items-center justify-center gap-2 px-3 text-[11.5px] font-medium transition-all ${
                isDark
                  ? 'border-white/20 bg-white/[0.04] text-zinc-300'
                  : 'border-black/15 bg-black/[0.03] text-zinc-600'
              }`}
            >
              <Pin size={12} className="opacity-75 shrink-0" />
              <span className="truncate">
                {tr(lang, 'Drag here to pin tab', '拖至此处固定标签页')}
              </span>
            </div>
          ) : null}
        </div>

        {/* ==================== Zone 2: Pinned Folders + Hairline Divider + Today Tabs ==================== */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-x-none px-2 pb-2 space-y-1 min-h-0">
          {pinnedNodes.length > 0 && (
            <div className="space-y-0.5 rounded-xl transition-all">{pinnedNodes}</div>
          )}

          {/* Subtle Space-Tinted Divider with Hover "Tidy" & "Clear" */}
          <div className="group/divider h-[18px] flex items-center gap-1.5 px-2">
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
                className="arc-pressable hidden group-hover/divider:inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md opacity-65 hover:!opacity-100 hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
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
                className="arc-pressable hidden group-hover/divider:inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-md opacity-65 hover:!opacity-100 hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
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
              className={`arc-pressable group/newtab w-full h-[32px] pl-2.5 pr-2 rounded-[10px] flex items-center justify-between gap-2 text-[12.5px] ${
                isNewTabRowActive
                  ? isDark
                    ? 'text-white font-medium'
                    : 'text-zinc-900 font-medium'
                  : isDark
                    ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]'
                    : 'text-zinc-500 hover:text-zinc-800 hover:bg-black/[0.04]'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0 flex-1">
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
                <span className="dia-tab-title flex-1 min-w-0">
                  {tr(lang, 'New Tab', '新建标签页')}
                </span>
              </span>
              <span
                className={`text-[10.5px] font-mono shrink-0 ${
                  isNewTabRowActive
                    ? 'inline opacity-55'
                    : 'hidden group-hover/newtab:inline opacity-45'
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
      className={`relative shrink-0 h-full flex flex-col select-none overflow-hidden overscroll-x-none ${
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
              className={`arc-pressable h-[25px] max-w-[128px] px-2 -ml-1.5 rounded-md flex items-center justify-center text-[13px] font-semibold tracking-[-0.01em] leading-none truncate ${
                isProfileMenuOpen
                  ? isDark
                    ? 'bg-white/[0.12] text-white'
                    : 'bg-black/[0.07] text-zinc-950'
                  : isDark
                    ? 'text-zinc-100/95 hover:bg-white/[0.08] hover:text-white'
                    : 'text-zinc-800 hover:bg-black/[0.05] hover:text-zinc-950'
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
              top: Math.max(44, Math.min(folderMenuState.y, 400)),
              transformOrigin: 'top left'
            }}
            className={`arc-popover-enter absolute left-2.5 right-2.5 z-40 rounded-2xl border p-1.5 shadow-2xl backdrop-blur-2xl text-[12px] space-y-0.5 ${
              isDark
                ? 'bg-[#25252B]/96 border-white/12 text-zinc-200'
                : 'bg-white/96 border-black/10 text-zinc-800'
            }`}
          >
            <div className="px-2.5 py-1 text-[11px] font-medium opacity-50 truncate border-b border-black/5 dark:border-white/8 mb-1">
              {(() => {
                const byId = new Map(allTabGroups.map((g) => [g.id, g]))
                const parts: string[] = []
                let cur: TabGroup | undefined = folderMenuState.group
                const seen = new Set<string>()
                while (cur && !seen.has(cur.id)) {
                  seen.add(cur.id)
                  parts.unshift(cur.title)
                  cur = cur.parentId ? byId.get(cur.parentId) : undefined
                }
                return parts.join(' / ')
              })()}
            </div>

            {onCreateTabGroup && (
              <button
                type="button"
                onClick={() => {
                  const parent = folderMenuState.group
                  const zone = folderMenuState.zone
                  setFolderMenuState(null)
                  const defaultName = tr(lang, 'New Folder', '新建文件夹')
                  void onCreateTabGroup(defaultName, parent.color, [], {
                    parentId: parent.id,
                    profileId: parent.profileId,
                    zone,
                    keepEmpty: true
                  }).then((created) => {
                    if (created?.id) {
                      setGroupRenameDraft(created.title)
                      setRenamingGroupId(created.id)
                    }
                  })
                }}
                className={`arc-pressable w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl ${
                  isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.05]'
                }`}
              >
                <FolderPlus size={12.5} className="opacity-65" />
                <span>{tr(lang, 'New Subfolder…', '新建子文件夹…')}</span>
              </button>
            )}

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

            {folderMenuState.group.parentId && (
              <button
                type="button"
                onClick={() => {
                  const grp = folderMenuState.group
                  setFolderMenuState(null)
                  onUpdateTabGroup?.(grp.id, { parentId: null })
                }}
                className={`arc-pressable w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl ${
                  isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-black/[0.05]'
                }`}
              >
                <CornerLeftUp size={12.5} className="opacity-65" />
                <span>{tr(lang, 'Move to Top Level', '移出到顶层目录')}</span>
              </button>
            )}

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
                  const subtreeIds = new Set<string>([grpId])
                  let grew = true
                  while (grew) {
                    grew = false
                    for (const g of allTabGroups) {
                      if (g.parentId && subtreeIds.has(g.parentId) && !subtreeIds.has(g.id)) {
                        subtreeIds.add(g.id)
                        grew = true
                      }
                    }
                  }
                  const members = allTabs.filter(
                    (t) => t.groupId && subtreeIds.has(t.groupId) && !t.isPinned
                  )
                  for (const m of members) {
                    onCloseTab(m.id)
                  }
                  if (members.length === 0) {
                    onDeleteTabGroup?.(grpId)
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

          <div className="flex items-center justify-center gap-0.5 overflow-x-auto overscroll-x-none no-scrollbar">
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
