import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  Check,
  CheckCircle2,
  Clock,
  Command,
  Compass,
  FolderOpen,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  PanelLeft,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X
} from 'lucide-react'
import { tr } from '@shared/i18n'
import {
  IMPORT_BROWSER_IDS,
  emptyImportProfileSelection,
  importBrowserSupportsAccountData,
  importBrowserTagline,
  importBrowserTitle
} from '@shared/import-browsers'
import type {
  AppLanguage,
  AppSettings,
  BrowserImportProgressPayload,
  BrowserImportResult,
  DetectedBrowserSource,
  ImportBrowserId,
  ImportDataScopes,
  ImportProgressStage
} from '@shared/types'
import { AppIcon } from './AppIcon'
import { BrowserBrandLogo } from './BrowserBrandLogo'

interface Props {
  isDark: boolean
  isClosing?: boolean
  mode: 'onboarding' | 'standalone'
  settings: AppSettings
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  onShowToast?: (msg: string) => void
  onOpenExtensions?: () => void
  onClose: () => void
}

type WizardPhase = 'configure' | 'animating' | 'completed'

interface StageDef {
  id: ImportProgressStage
  threshold: number
  titleEn: string
  titleZh: string
  subEn: string
  subZh: string
}

const ANIMATION_STAGES: StageDef[] = [
  {
    id: 'spaces',
    threshold: 18,
    titleEn: 'Aligning Spaces & Exact Sidebar Order',
    titleZh: '解析空间拓扑与 1:1 原始顺序对齐',
    subEn: 'Preserving Space icons, theme palettes & profile bindings',
    subZh: '还原 Arc 空间配色、图标与底层 Profile 映射关系'
  },
  {
    id: 'sessions',
    threshold: 44,
    titleEn: 'Migrating Profiles & Account Login Sessions',
    titleZh: '迁移 Profile 隔离环境与账号免登状态',
    subEn: 'Syncing Cookies, LocalStorage & IndexedDB tokens',
    subZh: '安全注入登录 Cookie、LocalStorage 与 IndexedDB 会话'
  },
  {
    id: 'tabs',
    threshold: 68,
    titleEn: 'Restoring Favorites, Nested Folders & Today Tabs',
    titleZh: '同步顶部常驻网格、嵌套目录与打开标签',
    subEn: 'Zero-memory tab hibernation with offline HD favicons',
    subZh: '恢复多级文件夹层级与高清站点图标，按需唤醒零占内存'
  },
  {
    id: 'extensions',
    threshold: 85,
    titleEn: 'Activating Browser Extensions & Ecosystem',
    titleZh: '装载浏览器扩展插件生态与本地配置',
    subEn: 'Mounting unpacked extensions & local extension storage',
    subZh: '复制扩展包与插件偏好配置，挂载至对应会话空间'
  },
  {
    id: 'library',
    threshold: 96,
    titleEn: 'Indexing Bookmarks & @History AI Recall',
    titleZh: '构建书签收藏与 @History 智能检索索引',
    subEn: 'Ready for instant ⌘T search and cross-tab AI queries',
    subZh: '赋能 ⌘T 统一智能栏联想与跨历史语义提问'
  }
]

export const OnboardingImportModal: React.FC<Props> = ({
  isDark,
  isClosing = false,
  mode,
  settings,
  onUpdateSettings,
  onShowToast,
  onOpenExtensions,
  onClose
}) => {
  const lang: AppLanguage = settings.language === 'zh-CN' ? 'zh-CN' : 'en'
  const isOnboarding = mode === 'onboarding'

  const [scanning, setScanning] = useState(true)
  const [sources, setSources] = useState<DetectedBrowserSource[]>([])
  const [selectedBrowserId, setSelectedBrowserId] = useState<ImportBrowserId>('arc')
  const [selectedProfileIdsByBrowser, setSelectedProfileIdsByBrowser] = useState<
    Record<ImportBrowserId, string[]>
  >(emptyImportProfileSelection)

  const [scopes, setScopes] = useState<ImportDataScopes>({
    spacesAndPinned: true,
    openTabs: true,
    sessions: true,
    extensions: true,
    bookmarks: true,
    history: true
  })
  const [createSpacesFromProfiles, setCreateSpacesFromProfiles] = useState(true)
  const [replaceStarterSpaces, setReplaceStarterSpaces] = useState(true)

  const [phase, setPhase] = useState<WizardPhase>('configure')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [completedResult, setCompletedResult] = useState<BrowserImportResult | null>(null)

  // Progress animation state
  const [displayPercent, setDisplayPercent] = useState(0)
  const [liveProgressHint, setLiveProgressHint] = useState<{ en: string; zh: string } | null>(null)
  const [celebrating, setCelebrating] = useState(false)

  const backendTargetPctRef = useRef(12)
  const backendResultRef = useRef<BrowserImportResult | null>(null)
  const backendErrorRef = useRef<string | null>(null)
  const animRafRef = useRef<number | null>(null)

  const runScan = async (preserveCustom = true): Promise<void> => {
    setScanning(true)
    setErrorMsg(null)
    try {
      const detected = await window.arko.detectImportBrowsers()
      setSources((prev) => {
        return detected.map((d) => {
          if (preserveCustom) {
            const existingCustom = prev.find((p) => p.id === d.id && p.isCustomPath && p.detected)
            if (existingCustom) return existingCustom
          }
          return d
        })
      })

      const initSelection = emptyImportProfileSelection()
      for (const src of detected) {
        initSelection[src.id] = src.profiles.map((p) => p.id)
      }
      setSelectedProfileIdsByBrowser((prev) => {
        const next = emptyImportProfileSelection()
        for (const id of IMPORT_BROWSER_IDS) {
          next[id] = prev[id]?.length ? prev[id] : initSelection[id]
        }
        return next
      })

      const firstDetected = detected.find((d) => d.detected)
      if (firstDetected) {
        setSelectedBrowserId((prev) =>
          detected.some((d) => d.id === prev && d.detected) ? prev : firstDetected.id
        )
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to scan local browsers')
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    void runScan(false)
  }, [])

  useEffect(() => {
    const unsub = window.arko.onImportProgress((payload: BrowserImportProgressPayload) => {
      backendTargetPctRef.current = Math.max(backendTargetPctRef.current, payload.percent)
      if (payload.detail || payload.detailZh) {
        setLiveProgressHint({
          en: payload.detail || '',
          zh: payload.detailZh || payload.detail || ''
        })
      }
    })
    return () => {
      unsub()
      if (animRafRef.current !== null) {
        window.cancelAnimationFrame(animRafRef.current)
      }
    }
  }, [])

  const selectedSource = useMemo(
    () => sources.find((s) => s.id === selectedBrowserId),
    [sources, selectedBrowserId]
  )

  const activeProfileIds = selectedProfileIdsByBrowser[selectedBrowserId] || []

  // Keep selected profiles strictly in source's canonical order!
  const selectedProfilesOrdered = useMemo(() => {
    if (!selectedSource) return []
    const set = new Set(activeProfileIds)
    return selectedSource.profiles.filter((p) => set.has(p.id))
  }, [selectedSource, activeProfileIds])

  const toggleProfileSelection = (profileId: string): void => {
    if (!selectedSource) return
    setSelectedProfileIdsByBrowser((prev) => {
      const curSet = new Set(prev[selectedBrowserId] || [])
      if (curSet.has(profileId)) {
        curSet.delete(profileId)
      } else {
        curSet.add(profileId)
      }
      const orderedNext = selectedSource.profiles
        .map((p) => p.id)
        .filter((id) => curSet.has(id))
      return { ...prev, [selectedBrowserId]: orderedNext }
    })
  }

  const handleSelectAllProfiles = (): void => {
    if (!selectedSource) return
    const allIds = selectedSource.profiles.map((p) => p.id)
    const allSelected = allIds.length > 0 && allIds.every((id) => activeProfileIds.includes(id))
    setSelectedProfileIdsByBrowser((prev) => ({
      ...prev,
      [selectedBrowserId]: allSelected ? (allIds[0] ? [allIds[0]] : []) : allIds
    }))
  }

  const handlePickCustomPath = async (): Promise<void> => {
    setErrorMsg(null)
    const inspected = await window.arko.pickCustomBrowserImportPath(selectedBrowserId)
    if (!inspected) return
    if (!inspected.detected) {
      setErrorMsg(
        tr(
          lang,
          'No recognizable browser profile, StorableSidebar.json, or Bookmarks file was found in the selected path.',
          '所选路径中未识别到有效的浏览器配置目录、StorableSidebar.json 或书签文件，请重新选择。'
        )
      )
      return
    }
    setSources((prev) => prev.map((s) => (s.id === selectedBrowserId ? inspected : s)))
    setSelectedProfileIdsByBrowser((prev) => ({
      ...prev,
      [selectedBrowserId]: inspected.profiles.map((p) => p.id)
    }))
  }

  const handleSkipOrDismiss = async (): Promise<void> => {
    if (isOnboarding) {
      await window.arko.completeOnboarding()
      onShowToast?.(
        tr(
          lang,
          'You can import browser data anytime from Settings or the app menu.',
          '随时可在「设置 → 外观与常规」或顶部菜单栏重新导入浏览器数据'
        )
      )
    }
    onClose()
  }

  const supportsAccountData = importBrowserSupportsAccountData(selectedBrowserId)
  const effectiveScopes: ImportDataScopes = supportsAccountData
    ? scopes
    : { ...scopes, sessions: false, extensions: false }

  const anyScopeEnabled = Boolean(
    effectiveScopes.spacesAndPinned ||
      effectiveScopes.openTabs ||
      effectiveScopes.sessions ||
      effectiveScopes.extensions ||
      effectiveScopes.bookmarks ||
      effectiveScopes.history
  )

  const handleRequestStartImport = (): void => {
    if (!selectedSource || !selectedSource.detected || !anyScopeEnabled) return
    setErrorMsg(null)
    setConfirmOpen(true)
  }

  const handleConfirmedExecuteImport = (): void => {
    if (!selectedSource || !selectedSource.detected || !anyScopeEnabled) return
    setConfirmOpen(false)
    setErrorMsg(null)
    setCelebrating(false)
    setDisplayPercent(0)
    setLiveProgressHint(null)
    backendTargetPctRef.current = 15
    backendResultRef.current = null
    backendErrorRef.current = null
    setPhase('animating')

    const startTime = performance.now()
    const MIN_CINEMATIC_DURATION_MS = 3100
    let currentVisual = 0

    // Fire real backend import asynchronously
    void window.arko
      .executeBrowserImport({
        browserId: selectedBrowserId,
        customPath: selectedSource.isCustomPath ? selectedSource.dataRootPath : null,
        selectedProfileIds:
          selectedProfilesOrdered.length > 0
            ? selectedProfilesOrdered.map((p) => p.id)
            : undefined,
        scopes: effectiveScopes,
        createSpacesFromProfiles,
        replaceStarterSpaces
      })
      .then((res) => {
        if (!res.ok) {
          backendErrorRef.current =
            res.error ||
            tr(
              lang,
              'Import failed. Please check the browser data directory.',
              '导入失败，请检查浏览器数据目录是否可访问。'
            )
        } else {
          backendTargetPctRef.current = 100
          backendResultRef.current = res
        }
      })
      .catch((err: any) => {
        backendErrorRef.current = err?.message || 'Unexpected error during import'
      })

    const tick = (now: number): void => {
      if (backendErrorRef.current) {
        setErrorMsg(backendErrorRef.current)
        setPhase('configure')
        return
      }

      const elapsed = now - startTime
      const timeLinearCap = Math.min(100, (elapsed / MIN_CINEMATIC_DURATION_MS) * 100)
      const isDoneOnBackend = backendResultRef.current !== null

      // While backend is still working (e.g. waiting for macOS Keychain approval), smoothly glide up to max(backendPct, 82) without stalling at 99% prematurely
      const allowedCeiling = isDoneOnBackend
        ? timeLinearCap
        : Math.min(86, Math.max(backendTargetPctRef.current, timeLinearCap * 0.82))

      const delta = allowedCeiling - currentVisual
      if (delta > 0) {
        currentVisual += Math.max(0.28, delta * (isDoneOnBackend ? 0.16 : 0.08))
      }
      if (isDoneOnBackend && elapsed >= MIN_CINEMATIC_DURATION_MS && currentVisual >= 99.1) {
        currentVisual = 100
      }

      setDisplayPercent(Math.min(100, currentVisual))

      if (currentVisual >= 100 && backendResultRef.current) {
        setCelebrating(true)
        const finalResult = backendResultRef.current
        window.setTimeout(() => {
          setCompletedResult(finalResult)
          setCelebrating(false)
          setPhase('completed')
        }, 620)
        return
      }

      animRafRef.current = window.requestAnimationFrame(tick)
    }

    animRafRef.current = window.requestAnimationFrame(tick)
  }

  const handleLaunchExperience = (): void => {
    onShowToast?.(
      tr(
        lang,
        '✨ Welcome to Arko! Swipe the sidebar or press ⌘T to start.',
        '✨ 欢迎来到全新浏览体验！双指左右滑动侧栏切换空间，按 ⌘T 开启探索。'
      )
    )
    onClose()
  }

  const selectedPinnedCount = useMemo(
    () =>
      selectedProfilesOrdered.reduce(
        (sum, p) => sum + (p.favoriteCount || 0) + (p.pinnedCount || 0),
        0
      ),
    [selectedProfilesOrdered]
  )

  const selectedOpenTabsCount = useMemo(
    () => selectedProfilesOrdered.reduce((sum, p) => sum + (p.openTabCount || 0), 0),
    [selectedProfilesOrdered]
  )

  const selectedDistinctProfiles = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of selectedProfilesOrdered) {
      const key = p.profileDir || p.id
      if (!map.has(key)) {
        map.set(key, p.profileName || p.name)
      }
    }
    return [...map.values()]
  }, [selectedProfilesOrdered])

  const previewAccentColors = useMemo(() => {
    const cols = selectedProfilesOrdered
      .map((p) => p.accentColor)
      .filter((c): c is string => Boolean(c))
    return cols.length > 0 ? cols : ['#6366F1', '#EC4899', '#0EA5E9']
  }, [selectedProfilesOrdered])

  const browserDisplayLabel = importBrowserTitle(
    selectedBrowserId,
    lang,
    selectedSource?.dataRootPath
  )

  return (
    <div
      onClick={() => {
        if (!isOnboarding && phase !== 'animating' && !confirmOpen) onClose()
      }}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-md p-4 select-none ${
        isClosing ? 'arc-backdrop-exit' : 'arc-backdrop-enter'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-[840px] max-h-[92vh] rounded-3xl border shadow-2xl flex flex-col overflow-hidden transition-all ${
          isClosing ? 'arc-modal-exit' : 'arc-modal-enter'
        } ${
          isDark
            ? 'bg-[#18181F] border-white/12 text-zinc-100'
            : 'bg-[#FAF9F6] border-black/10 text-zinc-900'
        }`}
      >
        {/* Top Header */}
        <div
          className={`px-7 pt-5 pb-4 border-b flex items-start justify-between gap-4 shrink-0 ${
            isDark
              ? 'border-white/8 bg-gradient-to-b from-indigo-500/[0.09] to-transparent'
              : 'border-black/6 bg-gradient-to-b from-indigo-500/[0.06] to-transparent'
          }`}
        >
          <div className="flex items-center gap-4">
            <AppIcon size={48} className="shrink-0 rounded-2xl shadow-sm" />
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-indigo-500/12 text-indigo-500 mb-1">
                <Sparkles size={11} />
                <span>
                  {phase === 'animating'
                    ? tr(lang, 'Seamless Migration Engine', '全量生态迁移引擎运行中')
                    : phase === 'completed'
                      ? tr(lang, 'Migration Complete · Ready to Explore', '全量迁移就绪 · 开启全新浏览体验')
                      : isOnboarding
                        ? tr(lang, 'Welcome · Full Ecosystem Setup', '初次启动 · 全量数据与生态无缝迁移')
                        : tr(lang, 'Browser Data & Ecosystem Migration', '浏览器全量数据、账号与插件迁移')}
                </span>
              </div>
              <h1 className="text-lg font-semibold tracking-tight">
                {phase === 'completed'
                  ? tr(
                      lang,
                      'Everything Is Right Where You Left It!',
                      '你的数字空间、账号与插件已悉数就位！'
                    )
                  : phase === 'animating'
                    ? tr(
                        lang,
                        `Bringing ${browserDisplayLabel} into Arko…`,
                        `正在从 ${browserDisplayLabel} 构建你的专属空间…`
                      )
                    : tr(
                        lang,
                        'Bring your Spaces, Logins & Extensions into Arko',
                        '选择要导入的内容，一键接力你的数字工作台'
                      )}
              </h1>
              <p className="text-xs opacity-65 mt-0.5">
                {phase === 'completed'
                  ? tr(
                      lang,
                      'Spaces match your exact Arc order, accounts stay signed in, and extensions are mounted.',
                      '空间顺序已与原浏览器严格对齐，Profile 登录态与扩展插件生态已无损激活。'
                    )
                  : phase === 'animating'
                    ? tr(
                        lang,
                        '100% local read-only transfer — your original browser remains completely untouched.',
                        '全程本地只读提取与安全加密注入，原浏览器数据不受任何影响。'
                      )
                    : tr(
                        lang,
                        'Choose Spaces, Today Tabs, Account Sessions, Extensions, Bookmarks, and History to migrate.',
                        '自由勾选空间目录、打开标签、Profile 账号免登会话、扩展插件、书签与历史记录。'
                      )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={phase === 'animating'}
              onClick={() =>
                void onUpdateSettings({ language: lang === 'zh-CN' ? 'en' : 'zh-CN' })
              }
              title={tr(lang, 'Switch UI Language', '切换界面语言 (中文 / English)')}
              className={`h-7 px-2.5 rounded-full text-[11px] font-medium inline-flex items-center gap-1 border transition ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-zinc-300 disabled:opacity-40'
                  : 'bg-white border-black/10 hover:bg-zinc-100 text-zinc-700 disabled:opacity-40'
              }`}
            >
              <Globe size={11.5} className="opacity-70" />
              <span>{lang === 'zh-CN' ? '中文' : 'EN'}</span>
            </button>

            {!isOnboarding && phase !== 'animating' && (
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-xl opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* ==================== PHASE 2: COOL CINEMATIC PROGRESS ANIMATION ==================== */}
        {phase === 'animating' && (
          <div className="relative flex-1 min-h-[430px] px-8 py-7 flex flex-col justify-between overflow-hidden">
            {/* Dynamic Aurora Background Glows */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div
                style={{ backgroundColor: previewAccentColors[0] || '#6366F1' }}
                className="arko-aurora-blob absolute -top-20 left-12 w-72 h-72 rounded-full blur-[95px] opacity-25"
              />
              <div
                style={{
                  backgroundColor: previewAccentColors[1] || previewAccentColors[0] || '#EC4899',
                  animationDelay: '-2.4s'
                }}
                className="arko-aurora-blob absolute -bottom-24 right-10 w-80 h-80 rounded-full blur-[105px] opacity-25"
              />
            </div>

            {/* Energy Bridge Hero: Source Browser ===[Particles]===> Orbital Arko Core */}
            <div className="relative z-10 flex flex-col items-center pt-1">
              <div className="w-full max-w-[540px] flex items-center justify-between gap-3">
                {/* Left Node: Source Browser */}
                <div className="flex flex-col items-center gap-2 shrink-0">
                  <div
                    className={`relative w-16 h-16 rounded-2xl border flex items-center justify-center shadow-lg ${
                      isDark
                        ? 'bg-white/[0.06] border-white/15'
                        : 'bg-white border-black/10'
                    }`}
                  >
                    <BrowserBrandLogo id={selectedBrowserId} size={42} />
                  </div>
                  <span className="text-[11px] font-semibold opacity-75">{browserDisplayLabel}</span>
                </div>

                {/* Animated SVG Particle & Beam Conduit */}
                <div className="flex-1 h-20 relative flex items-center justify-center">
                  <svg
                    viewBox="0 0 280 72"
                    className="w-full h-full overflow-visible"
                    fill="none"
                    aria-hidden
                  >
                    <defs>
                      <linearGradient id="arko-beam-grad" x1="0" y1="36" x2="280" y2="36" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor="#FF5E7E" stopOpacity="0.85" />
                        <stop offset="50%" stopColor="#818CF8" stopOpacity="1" />
                        <stop offset="100%" stopColor="#34D399" stopOpacity="0.95" />
                      </linearGradient>
                    </defs>

                    {/* Base guide tracks */}
                    <path
                      d="M 6 36 C 85 10, 195 10, 274 36"
                      stroke={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}
                      strokeWidth="1.5"
                    />
                    <path
                      d="M 6 36 L 274 36"
                      stroke={isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.09)'}
                      strokeWidth="2"
                      strokeDasharray="4 6"
                    />
                    <path
                      d="M 6 36 C 85 62, 195 62, 274 36"
                      stroke={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}
                      strokeWidth="1.5"
                    />

                    {/* Streaming energy beams */}
                    <path
                      d="M 6 36 C 85 10, 195 10, 274 36"
                      stroke="url(#arko-beam-grad)"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      className="arko-stream-beam"
                    />
                    <path
                      d="M 6 36 L 274 36"
                      stroke="url(#arko-beam-grad)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      style={{ animationDelay: '-0.5s' }}
                      className="arko-stream-beam"
                    />
                    <path
                      d="M 6 36 C 85 62, 195 62, 274 36"
                      stroke="url(#arko-beam-grad)"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      style={{ animationDelay: '-1.05s' }}
                      className="arko-stream-beam"
                    />
                  </svg>

                  {/* Center Percentage Readout Pill */}
                  <div
                    className={`absolute px-3.5 py-1 rounded-2xl border backdrop-blur-xl shadow-lg flex items-baseline gap-0.5 ${
                      celebrating
                        ? 'bg-emerald-500 text-white border-emerald-400 scale-110 transition-transform duration-300'
                        : isDark
                          ? 'bg-[#20202A]/90 border-indigo-400/35 text-white'
                          : 'bg-white/95 border-indigo-500/30 text-indigo-950'
                    }`}
                  >
                    <span className="text-xl font-bold font-mono tabular-nums tracking-tight">
                      {Math.round(displayPercent)}
                    </span>
                    <span className="text-xs font-semibold opacity-80">%</span>
                  </div>
                </div>

                {/* Right Node: Orbital Arko Destination */}
                <div className="flex flex-col items-center gap-2 shrink-0">
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    <span
                      className={`arko-pulse-ring absolute inset-0 rounded-2xl border-2 ${
                        celebrating ? 'border-emerald-400' : 'border-indigo-500/50'
                      }`}
                    />
                    <svg
                      className="arko-orbit-cw absolute -inset-2 w-20 h-20 pointer-events-none"
                      viewBox="0 0 80 80"
                      fill="none"
                    >
                      <circle
                        cx="40"
                        cy="40"
                        r="36"
                        stroke={celebrating ? '#10B981' : '#6366F1'}
                        strokeOpacity="0.45"
                        strokeWidth="1.5"
                        strokeDasharray="10 8"
                      />
                    </svg>
                    <AppIcon size={48} className="relative z-10 rounded-2xl shadow-md" />
                    {celebrating && (
                      <div className="arko-celebrate-pop absolute -right-1.5 -bottom-1.5 z-20 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md">
                        <Check size={14} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-indigo-500">Arko Browser</span>
                </div>
              </div>

              {/* Luminous Progress Bar */}
              <div className="w-full max-w-[580px] mt-5 space-y-1.5">
                <div
                  className={`h-2.5 w-full rounded-full overflow-hidden p-0.5 ${
                    isDark ? 'bg-white/[0.07]' : 'bg-black/[0.06]'
                  }`}
                >
                  <div
                    style={{
                      width: `${Math.max(4, displayPercent)}%`,
                      backgroundImage: celebrating
                        ? 'linear-gradient(90deg, #10B981, #34D399, #10B981)'
                        : 'linear-gradient(90deg, #6366F1, #A855F7, #EC4899, #6366F1)'
                    }}
                    className="arko-shimmer-bar h-full rounded-full transition-[width] duration-100 ease-out shadow-[0_0_14px_rgba(99,102,241,0.55)]"
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] opacity-70 px-0.5">
                  <span className="truncate">
                    {celebrating
                      ? tr(lang, '✨ All browser data & extensions mounted!', '✨ 全量数据、登录态与扩展生态已挂载完毕！')
                      : liveProgressHint
                        ? lang === 'zh-CN'
                          ? liveProgressHint.zh
                          : liveProgressHint.en
                        : tr(lang, 'Preparing workspace…', '正在准备全新工作空间…')}
                  </span>
                  <span className="font-mono tabular-nums shrink-0">
                    {celebrating
                      ? tr(lang, 'READY', '已完成')
                      : `${Math.round(displayPercent)}%`}
                  </span>
                </div>
              </div>
            </div>

            {/* 5 Sequenced Migration Stage Cards */}
            <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-5">
              {ANIMATION_STAGES.map((st, idx) => {
                const nextThreshold = ANIMATION_STAGES[idx + 1]?.threshold ?? 100
                const isDone = celebrating || displayPercent >= nextThreshold
                const isActive = !isDone && displayPercent >= st.threshold - 14
                return (
                  <div
                    key={st.id}
                    className={`px-3.5 py-2.5 rounded-2xl border flex items-center gap-3 transition-all duration-300 ${
                      idx === ANIMATION_STAGES.length - 1 ? 'sm:col-span-2' : ''
                    } ${
                      isDone
                        ? isDark
                          ? 'bg-emerald-500/[0.09] border-emerald-500/30'
                          : 'bg-emerald-50/90 border-emerald-300/70'
                        : isActive
                          ? isDark
                            ? 'bg-indigo-500/[0.13] border-indigo-400/50 shadow-sm'
                            : 'bg-white border-indigo-400 shadow-sm'
                          : isDark
                            ? 'bg-white/[0.02] border-white/6 opacity-45'
                            : 'bg-white/60 border-black/6 opacity-50'
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                        isDone
                          ? 'bg-emerald-500 text-white arko-celebrate-pop'
                          : isActive
                            ? 'bg-indigo-600 text-white'
                            : isDark
                              ? 'bg-white/8 text-zinc-400'
                              : 'bg-black/6 text-zinc-500'
                      }`}
                    >
                      {isDone ? (
                        <Check size={14} strokeWidth={3} />
                      ) : isActive ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <span className="text-[11px] font-mono">{idx + 1}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold truncate">
                        {tr(lang, st.titleEn, st.titleZh)}
                      </div>
                      <div className="text-[11px] opacity-60 truncate">
                        {tr(lang, st.subEn, st.subZh)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ==================== PHASE 3: COMPLETION & NEW BROWSER EXPERIENCE GUIDE ==================== */}
        {phase === 'completed' && completedResult && (
          <div className="p-7 space-y-5 overflow-y-auto text-xs">
            {/* Success Hero + Ordered Spaces Ribbon */}
            <div
              className={`p-4 rounded-2xl border space-y-3.5 ${
                isDark
                  ? 'bg-gradient-to-r from-emerald-500/[0.10] via-indigo-500/[0.08] to-transparent border-emerald-500/25'
                  : 'bg-gradient-to-r from-emerald-50 via-indigo-50/50 to-white border-emerald-200'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div className="arko-celebrate-pop w-11 h-11 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                  <CheckCircle2 size={24} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">
                    {tr(
                      lang,
                      `All set! Imported seamlessly from ${browserDisplayLabel}`,
                      `导入圆满完成！已从 ${browserDisplayLabel} 无缝接力你的工作流`
                    )}
                  </div>
                  <div className="text-[11.5px] opacity-70 mt-0.5">
                    {tr(
                      lang,
                      'Your Spaces follow your exact original order, logins are active, and tabs hibernate at 0 MB until clicked.',
                      '所有空间已严格按原顺序排列，关联 Profile 登录态与插件已激活；导入标签采用零内存休眠，点击即醒。'
                    )}
                  </div>
                </div>
              </div>

              {completedResult.importedSpaces && completedResult.importedSpaces.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wider opacity-55 mr-1">
                    {tr(lang, 'Space Order:', '空间顺序：')}
                  </span>
                  {completedResult.importedSpaces.map((sp, i) => (
                    <span
                      key={sp.id}
                      className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border text-[11px] font-medium ${
                        isDark
                          ? 'bg-black/25 border-white/12 text-zinc-100'
                          : 'bg-white border-black/10 text-zinc-800 shadow-2xs'
                      }`}
                    >
                      <span className="text-[10px] font-mono opacity-45">{i + 1}</span>
                      <span
                        style={{ backgroundColor: sp.accentColor }}
                        className="w-2 h-2 rounded-full shrink-0"
                      />
                      <span>{sp.emoji}</span>
                      <span className="max-w-[110px] truncate">{sp.name}</span>
                      {sp.profileLabel && (
                        <span className="opacity-50 text-[10px]">· {sp.profileLabel}</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 6-Stat Bento Summary */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
              {[
                {
                  label: tr(lang, 'Spaces', '独立空间'),
                  value: completedResult.importedSpaces?.length || completedResult.spacesCreated,
                  sub: tr(lang, '1:1 Arc Order', '1:1 顺序还原')
                },
                {
                  label: tr(lang, 'Pinned & Favs', '常驻与固定'),
                  value: completedResult.favoritesImported + completedResult.pinnedTabsImported,
                  sub:
                    completedResult.tabGroupsCreated > 0
                      ? tr(lang, `${completedResult.tabGroupsCreated} folders`, `含 ${completedResult.tabGroupsCreated} 个目录`)
                      : tr(lang, 'Sidebar ready', '侧栏就绪')
                },
                {
                  label: tr(lang, 'Today Tabs', '打开标签'),
                  value: completedResult.openTabsImported ?? 0,
                  sub: tr(lang, '0 RAM sleep', '按需唤醒')
                },
                {
                  label: tr(lang, 'Login Cookies', '账号 Cookie'),
                  value: completedResult.cookiesImported ?? 0,
                  sub:
                    (completedResult.storageProfilesMigrated ?? 0) > 0
                      ? tr(lang, '+ LocalStorage', '+ 本地站点存储')
                      : tr(lang, 'Session sync', '会话隔离')
                },
                {
                  label: tr(lang, 'Extensions', '扩展插件'),
                  value: completedResult.extensionsImported ?? 0,
                  sub: tr(lang, 'Mounted live', '已挂载就绪')
                },
                {
                  label: tr(lang, 'Bookmarks/Hist', '书签与历史'),
                  value: completedResult.bookmarksImported + completedResult.historyImported,
                  sub: tr(lang, '⌘T & @History', '智能栏可搜')
                }
              ].map((stat, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-2xl border ${
                    isDark ? 'bg-white/[0.03] border-white/8' : 'bg-white border-black/7 shadow-2xs'
                  }`}
                >
                  <div className="text-xl font-bold tracking-tight text-indigo-500 font-mono tabular-nums">
                    {stat.value}
                  </div>
                  <div className="text-[11px] font-semibold mt-0.5 truncate">{stat.label}</div>
                  <div className="text-[10px] opacity-55 mt-0.5 truncate">{stat.sub}</div>
                </div>
              ))}
            </div>

            {completedResult.warnings && completedResult.warnings.length > 0 && (
              <div
                className={`px-3.5 py-2.5 rounded-xl border flex items-start gap-2.5 text-[11.5px] ${
                  isDark
                    ? 'bg-amber-500/10 border-amber-500/25 text-amber-200'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  {completedResult.warnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Guided Tour: Start Your New Browser Experience */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold flex items-center gap-1.5">
                  <Compass size={13.5} className="text-indigo-500" />
                  <span>
                    {tr(
                      lang,
                      'Quick Guide · Make the Most of Your New Browser',
                      '快速上手引导 · 开启全新 AI 原生浏览体验'
                    )}
                  </span>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div
                  className={`p-3.5 rounded-2xl border space-y-1.5 ${
                    isDark ? 'bg-white/[0.025] border-white/8' : 'bg-white border-black/8 shadow-2xs'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="w-7 h-7 rounded-xl bg-indigo-500/15 text-indigo-500 flex items-center justify-center">
                      <PanelLeft size={14} />
                    </span>
                    <kbd
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                        isDark ? 'bg-white/8 text-zinc-300' : 'bg-zinc-100 text-zinc-600'
                      }`}
                    >
                      ⌃1 · ⌃2 / Swipe
                    </kbd>
                  </div>
                  <div className="font-semibold text-[12.5px] pt-0.5">
                    {tr(lang, 'Fluid Spaces & Folders', '丝滑切换空间与目录')}
                  </div>
                  <p className="text-[11px] opacity-65 leading-relaxed">
                    {tr(
                      lang,
                      'Two-finger swipe left/right on the sidebar or click the bottom dots to glide across your Arc Spaces.',
                      '在左侧栏双指左右滑动或点击底部圆点即可丝滑切换空间，常驻网格与多级文件夹触手可及。'
                    )}
                  </p>
                </div>

                <div
                  className={`p-3.5 rounded-2xl border space-y-1.5 ${
                    isDark ? 'bg-white/[0.025] border-white/8' : 'bg-white border-black/8 shadow-2xs'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="w-7 h-7 rounded-xl bg-violet-500/15 text-violet-500 flex items-center justify-center">
                      <Puzzle size={14} />
                    </span>
                    {onOpenExtensions && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose()
                          onOpenExtensions()
                        }}
                        className="text-[10.5px] font-medium text-indigo-500 hover:underline cursor-pointer"
                      >
                        {tr(lang, 'Manage 🧩 →', '管理插件 🧩 →')}
                      </button>
                    )}
                  </div>
                  <div className="font-semibold text-[12.5px] pt-0.5">
                    {tr(lang, 'Logins & Extensions 🧩', '免登多账号与插件生态')}
                  </div>
                  <p className="text-[11px] opacity-65 leading-relaxed">
                    {tr(
                      lang,
                      'Each Profile keeps isolated logins. Click the top-right 🧩 icon anytime to open extension popups or install from Web Store.',
                      '各 Profile 独立保持账号登录态；点击顶栏右上角 🧩 图标即可唤出已导入插件弹窗或一键安装商店扩展。'
                    )}
                  </p>
                </div>

                <div
                  className={`p-3.5 rounded-2xl border space-y-1.5 ${
                    isDark ? 'bg-white/[0.025] border-white/8' : 'bg-white border-black/8 shadow-2xs'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="w-7 h-7 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
                      <Command size={14} />
                    </span>
                    <kbd
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                        isDark ? 'bg-white/8 text-zinc-300' : 'bg-zinc-100 text-zinc-600'
                      }`}
                    >
                      ⌘T · ⌘E · ⌘J
                    </kbd>
                  </div>
                  <div className="font-semibold text-[12.5px] pt-0.5">
                    {tr(lang, 'Smart Bar & Native AI', '智能命令栏与原生 AI')}
                  </div>
                  <p className="text-[11px] opacity-65 leading-relaxed">
                    {tr(
                      lang,
                      'Press ⌘T to jump to any bookmark/tab, ⌘E to chat with @All Tabs & @History, or ⌘J to write inline.',
                      '按 ⌘T 秒搜所有书签与标签，按 ⌘E 呼出 AI 结合 @All Tabs 与 @History 提问，按 ⌘J 网页内联帮写。'
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Completion CTA Bar */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => {
                  setCompletedResult(null)
                  setPhase('configure')
                }}
                className={`h-9 px-4 rounded-xl text-xs font-medium border transition cursor-pointer ${
                  isDark
                    ? 'border-white/12 hover:bg-white/8 text-zinc-300'
                    : 'border-black/10 bg-white hover:bg-zinc-100 text-zinc-700'
                }`}
              >
                {tr(lang, 'Import More Data…', '继续补充导入其他数据…')}
              </button>

              <button
                type="button"
                onClick={handleLaunchExperience}
                className="h-10 px-6 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-md shadow-indigo-500/20 inline-flex items-center gap-2 transition cursor-pointer"
              >
                <Sparkles size={14} />
                <span>
                  {tr(
                    lang,
                    'Start Your New Browser Experience',
                    '开启全新浏览器体验'
                  )}
                </span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* ==================== PHASE 1: CONFIGURE & SELECT CONTENT ==================== */}
        {phase === 'configure' && (
          <div className="flex-1 overflow-y-auto px-7 py-5 space-y-4 text-xs">
            {/* Step 1: Choose Source Browser */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[12.5px]">
                  {tr(lang, '1. Choose a browser to import from', '1. 选择要导入数据的源浏览器')}
                </span>
                <button
                  type="button"
                  disabled={scanning}
                  onClick={() => void runScan(true)}
                  className="text-[11px] opacity-65 hover:opacity-100 inline-flex items-center gap-1 transition cursor-pointer"
                >
                  <RefreshCw size={11} className={scanning ? 'animate-spin' : ''} />
                  <span>{tr(lang, 'Re-scan', '重新扫描本机')}</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {IMPORT_BROWSER_IDS.map((bid) => {
                  const src = sources.find((s) => s.id === bid)
                  const isSelected = selectedBrowserId === bid
                  const detected = Boolean(src?.detected)
                  const title = importBrowserTitle(bid, lang, src?.dataRootPath)

                  let badgeText = scanning
                    ? tr(lang, 'Scanning…', '正在检测…')
                    : tr(lang, 'Not detected', '未检测到默认目录')

                  if (!scanning && detected && src) {
                    if (bid === 'arc' && src.spacesCount) {
                      badgeText = tr(
                        lang,
                        `${src.spacesCount} Spaces · ${src.distinctProfilesCount || 1} Profile${
                          (src.distinctProfilesCount || 1) > 1 ? 's' : ''
                        }`,
                        `已检测 · ${src.spacesCount} 空间 · ${src.distinctProfilesCount || 1} 配置`
                      )
                    } else if (src.profiles.length > 1) {
                      badgeText = tr(
                        lang,
                        `Detected · ${src.profiles.length} Profiles`,
                        `已检测到 · ${src.profiles.length} 个配置`
                      )
                    } else {
                      badgeText = tr(lang, 'Detected', '已检测到本机数据')
                    }
                  }

                  return (
                    <button
                      key={bid}
                      type="button"
                      onClick={() => {
                        setSelectedBrowserId(bid)
                        setErrorMsg(null)
                      }}
                      className={`relative text-left p-3.5 rounded-2xl border transition-all flex flex-col gap-2.5 cursor-pointer ${
                        isSelected
                          ? isDark
                            ? 'bg-indigo-500/[0.13] border-indigo-500 ring-1 ring-indigo-500/50 shadow-sm'
                            : 'bg-white border-indigo-500 ring-1 ring-indigo-500/45 shadow-sm'
                          : isDark
                            ? 'bg-white/[0.025] border-white/8 hover:bg-white/[0.05] hover:border-white/15'
                            : 'bg-white/80 border-black/8 hover:bg-white hover:border-black/15'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <BrowserBrandLogo id={bid} size={36} />
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            detected
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : isDark
                                ? 'bg-white/8 text-zinc-400'
                                : 'bg-zinc-200/75 text-zinc-500'
                          }`}
                        >
                          {badgeText}
                        </span>
                      </div>

                      <div>
                        <div className="font-semibold text-[13px]">{title}</div>
                        <div className="text-[10.5px] opacity-60 mt-0.5 leading-relaxed">
                          {importBrowserTagline(bid, lang)}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Step 2 & 3: Spaces + Granular Data Scopes */}
            {selectedSource && (
              <div
                className={`p-4 rounded-2xl border space-y-4 ${
                  isDark ? 'bg-white/[0.025] border-white/8' : 'bg-white border-black/8 shadow-2xs'
                }`}
              >
                {selectedSource.detected ? (
                  <>
                    {/* Ordered Space / Profile Selector */}
                    {selectedSource.profiles.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold opacity-90">
                            {selectedBrowserId === 'arc'
                              ? tr(
                                  lang,
                                  `2. Select Arc Spaces (ordered 1:1 with Arc sidebar · ${selectedProfilesOrdered.length}/${selectedSource.profiles.length})`,
                                  `2. 选择要导入的 Arc 空间（已按 Arc 原始顺序排列 · ${selectedProfilesOrdered.length}/${selectedSource.profiles.length}）`
                                )
                              : tr(
                                  lang,
                                  `2. Select Browser Profiles (${selectedProfilesOrdered.length}/${selectedSource.profiles.length})`,
                                  `2. 选择要导入的浏览器配置空间 (${selectedProfilesOrdered.length}/${selectedSource.profiles.length})`
                                )}
                          </span>
                          <div className="flex items-center gap-3">
                            {selectedSource.profiles.length > 1 && (
                              <button
                                type="button"
                                onClick={handleSelectAllProfiles}
                                className="text-[11px] text-indigo-500 hover:underline cursor-pointer"
                              >
                                {selectedSource.profiles.every((p) =>
                                  activeProfileIds.includes(p.id)
                                )
                                  ? tr(lang, 'Select First Only', '仅选第一个')
                                  : tr(lang, 'Select All', '全选全部空间')}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handlePickCustomPath()}
                              className="text-[11px] opacity-65 hover:opacity-100 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <FolderOpen size={11} />
                              <span>{tr(lang, 'Change folder…', '更换目录/文件…')}</span>
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {selectedSource.profiles.map((prof, idx) => {
                            const checked = activeProfileIds.includes(prof.id)
                            const countBadge =
                              selectedBrowserId === 'arc'
                                ? (prof.favoriteCount || 0) +
                                  (prof.pinnedCount || 0) +
                                  (prof.openTabCount || 0)
                                : prof.bookmarkCount || 0

                            return (
                              <button
                                key={prof.id}
                                type="button"
                                onClick={() => toggleProfileSelection(prof.id)}
                                title={
                                  selectedBrowserId === 'arc' && prof.profileName
                                    ? tr(
                                        lang,
                                        `#${idx + 1} Arc Space "${prof.name}" · Profile "${prof.profileName}"`,
                                        `第 ${idx + 1} 个空间「${prof.name}」· 关联账号配置 Profile: ${prof.profileName}`
                                      )
                                    : prof.name
                                }
                                className={`h-8 px-2.5 rounded-xl border text-xs inline-flex items-center gap-1.5 transition cursor-pointer ${
                                  checked
                                    ? isDark
                                      ? 'bg-indigo-500/20 border-indigo-500/60 text-zinc-100 font-medium'
                                      : 'bg-indigo-50 border-indigo-400 text-indigo-950 font-medium'
                                    : isDark
                                      ? 'bg-white/[0.02] border-white/10 opacity-55 hover:opacity-95'
                                      : 'bg-zinc-50 border-black/8 opacity-60 hover:opacity-100'
                                }`}
                              >
                                <span
                                  className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 ${
                                    checked
                                      ? 'bg-indigo-600 text-white'
                                      : 'border border-current opacity-40'
                                  }`}
                                >
                                  {checked && <Check size={10} strokeWidth={3} />}
                                </span>
                                <span className="text-[10px] font-mono opacity-45">#{idx + 1}</span>
                                {prof.accentColor && (
                                  <span
                                    style={{ backgroundColor: prof.accentColor }}
                                    className="w-2 h-2 rounded-full shrink-0"
                                  />
                                )}
                                <span>{prof.emoji || '🌐'}</span>
                                <span className="truncate max-w-[130px]">{prof.name}</span>
                                {selectedBrowserId === 'arc' && prof.profileName && (
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-normal ${
                                      isDark
                                        ? 'bg-white/8 text-zinc-300'
                                        : 'bg-black/[0.05] text-zinc-600'
                                    }`}
                                  >
                                    {prof.profileName}
                                  </span>
                                )}
                                {countBadge > 0 && (
                                  <span className="text-[10px] opacity-55">({countBadge})</span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Step 3: Granular 6-Scope Content Selection Grid */}
                    <div className="space-y-2 pt-0.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold opacity-90">
                          {tr(
                            lang,
                            '3. Choose what content & ecosystem data to import',
                            '3. 选择要导入的数据内容与插件生态'
                          )}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {/* Scope 1: Spaces, Favorites & Pinned Folders */}
                        <label
                          className={`p-3 rounded-xl border flex items-start justify-between gap-2.5 cursor-pointer transition ${
                            scopes.spacesAndPinned
                              ? isDark
                                ? 'bg-white/[0.04] border-indigo-500/45'
                                : 'bg-indigo-50/40 border-indigo-300/80'
                              : isDark
                                ? 'bg-transparent border-white/8 opacity-60'
                                : 'bg-zinc-50/60 border-black/6 opacity-65'
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <Layers size={15} className="text-indigo-500 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <div className="font-medium flex items-center gap-1.5">
                                <span className="truncate">
                                  {tr(lang, 'Spaces, Favorites & Folders', '空间顺序、常驻网格与固定目录')}
                                </span>
                                {selectedPinnedCount > 0 && (
                                  <span className="text-[10.5px] opacity-60 font-mono">
                                    ({selectedPinnedCount})
                                  </span>
                                )}
                              </div>
                              <div className="text-[10.5px] opacity-60 mt-0.5 leading-snug">
                                {tr(
                                  lang,
                                  'Exact Space order, icons, colors, Top Apps & nested folders',
                                  '1:1 还原空间顺序、配色图标、Top Apps 与多级嵌套文件夹'
                                )}
                              </div>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={scopes.spacesAndPinned}
                            onChange={(e) =>
                              setScopes((s) => ({ ...s, spacesAndPinned: e.target.checked }))
                            }
                            className="w-4 h-4 accent-indigo-600 shrink-0 mt-0.5"
                          />
                        </label>

                        {/* Scope 2: Open Today Tabs */}
                        <label
                          className={`p-3 rounded-xl border flex items-start justify-between gap-2.5 cursor-pointer transition ${
                            scopes.openTabs
                              ? isDark
                                ? 'bg-white/[0.04] border-indigo-500/45'
                                : 'bg-indigo-50/40 border-indigo-300/80'
                              : isDark
                                ? 'bg-transparent border-white/8 opacity-60'
                                : 'bg-zinc-50/60 border-black/6 opacity-65'
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <PanelLeft size={15} className="text-sky-500 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <div className="font-medium flex items-center gap-1.5">
                                <span className="truncate">
                                  {tr(lang, 'Open Today Tabs', '当前打开的日常标签页 (Today)')}
                                </span>
                                {(selectedOpenTabsCount || selectedSource.openTabsEstimate || 0) > 0 && (
                                  <span className="text-[10.5px] opacity-60 font-mono">
                                    ({selectedOpenTabsCount || selectedSource.openTabsEstimate})
                                  </span>
                                )}
                              </div>
                              <div className="text-[10.5px] opacity-60 mt-0.5 leading-snug">
                                {tr(
                                  lang,
                                  'Brings over active unpinned tabs per Space (hibernated at 0 MB)',
                                  '完整保留各空间下未固定的打开标签页（休眠态导入不占内存）'
                                )}
                              </div>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={Boolean(scopes.openTabs)}
                            onChange={(e) =>
                              setScopes((s) => ({ ...s, openTabs: e.target.checked }))
                            }
                            className="w-4 h-4 accent-indigo-600 shrink-0 mt-0.5"
                          />
                        </label>

                        {/* Scope 3: Profiles & Account Login Sessions */}
                        {supportsAccountData && (
                        <label
                          className={`p-3 rounded-xl border flex items-start justify-between gap-2.5 cursor-pointer transition ${
                            scopes.sessions
                              ? isDark
                                ? 'bg-white/[0.04] border-indigo-500/45'
                                : 'bg-indigo-50/40 border-indigo-300/80'
                              : isDark
                                ? 'bg-transparent border-white/8 opacity-60'
                                : 'bg-zinc-50/60 border-black/6 opacity-65'
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <KeyRound size={15} className="text-rose-500 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <div className="font-medium flex items-center gap-1.5">
                                <span className="truncate">
                                  {tr(lang, 'Profiles & Account Logins', 'Profile 账号登录态与站点存储')}
                                </span>
                                {selectedDistinctProfiles.length > 0 && (
                                  <span className="px-1.5 py-0.2 rounded text-[10px] bg-rose-500/15 text-rose-500 font-medium">
                                    {selectedDistinctProfiles.length} Profile
                                    {selectedDistinctProfiles.length > 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10.5px] opacity-60 mt-0.5 leading-snug">
                                {tr(
                                  lang,
                                  'Migrates Cookies, LocalStorage & IndexedDB so accounts stay signed in',
                                  '迁移各 Profile 的 Cookie、LocalStorage 与 IndexedDB，常用网站免重新登录'
                                )}
                              </div>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={Boolean(scopes.sessions)}
                            onChange={(e) =>
                              setScopes((s) => ({ ...s, sessions: e.target.checked }))
                            }
                            className="w-4 h-4 accent-indigo-600 shrink-0 mt-0.5"
                          />
                        </label>
                        )}

                        {/* Scope 4: Browser Extensions & Ecosystem */}
                        {supportsAccountData && (
                        <label
                          className={`p-3 rounded-xl border flex items-start justify-between gap-2.5 cursor-pointer transition ${
                            scopes.extensions
                              ? isDark
                                ? 'bg-white/[0.04] border-indigo-500/45'
                                : 'bg-indigo-50/40 border-indigo-300/80'
                              : isDark
                                ? 'bg-transparent border-white/8 opacity-60'
                                : 'bg-zinc-50/60 border-black/6 opacity-65'
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <Puzzle size={15} className="text-violet-500 shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <div className="font-medium flex items-center gap-1.5">
                                <span className="truncate">
                                  {tr(lang, 'Extensions & Plugin Settings', '浏览器扩展插件生态与配置')}
                                </span>
                                {(selectedSource.extensionsEstimate || 0) > 0 && (
                                  <span className="text-[10.5px] opacity-60 font-mono">
                                    ({selectedSource.extensionsEstimate})
                                  </span>
                                )}
                              </div>
                              <div className="text-[10.5px] opacity-60 mt-0.5 leading-snug">
                                {tr(
                                  lang,
                                  'Copies installed Chrome/Arc extensions & local settings into Arko',
                                  '自动迁移已安装的扩展插件及本地插件配置，直接挂载至对应空间'
                                )}
                              </div>
                              {selectedSource.detectedExtensions &&
                                selectedSource.detectedExtensions.length > 0 && (
                                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                    {selectedSource.detectedExtensions.slice(0, 6).map((ext) => (
                                      <span
                                        key={ext.id}
                                        title={`${ext.name} (v${ext.version})`}
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] border max-w-[112px] ${
                                          isDark
                                            ? 'bg-white/[0.05] border-white/10 text-zinc-200'
                                            : 'bg-white border-black/8 text-zinc-700'
                                        }`}
                                      >
                                        {ext.iconDataUrl ? (
                                          <img
                                            src={ext.iconDataUrl}
                                            alt=""
                                            className="w-3 h-3 rounded-xs shrink-0"
                                          />
                                        ) : (
                                          <Puzzle size={10} className="opacity-60 shrink-0" />
                                        )}
                                        <span className="truncate">{ext.name}</span>
                                      </span>
                                    ))}
                                    {selectedSource.detectedExtensions.length > 6 && (
                                      <span className="text-[10px] opacity-55 pl-0.5">
                                        +{selectedSource.detectedExtensions.length - 6}
                                      </span>
                                    )}
                                  </div>
                                )}
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={Boolean(scopes.extensions)}
                            onChange={(e) =>
                              setScopes((s) => ({ ...s, extensions: e.target.checked }))
                            }
                            className="w-4 h-4 accent-indigo-600 shrink-0 mt-0.5"
                          />
                        </label>
                        )}

                        {/* Scope 5: Bookmarks */}
                        <label
                          className={`p-3 rounded-xl border flex items-start justify-between gap-2.5 cursor-pointer transition ${
                            scopes.bookmarks
                              ? isDark
                                ? 'bg-white/[0.04] border-indigo-500/45'
                                : 'bg-indigo-50/40 border-indigo-300/80'
                              : isDark
                                ? 'bg-transparent border-white/8 opacity-60'
                                : 'bg-zinc-50/60 border-black/6 opacity-65'
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <Bookmark size={15} className="text-amber-500 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <div className="font-medium flex items-center gap-1.5">
                                <span>{tr(lang, 'Bookmarks & Saved Links', '书签与收藏夹')}</span>
                                {selectedSource.bookmarksEstimate > 0 && (
                                  <span className="text-[10.5px] opacity-60 font-mono">
                                    ({selectedSource.bookmarksEstimate})
                                  </span>
                                )}
                              </div>
                              <div className="text-[10.5px] opacity-60 mt-0.5 leading-snug">
                                {tr(
                                  lang,
                                  'Full bookmark library searchable instantly in Command Bar (⌘T)',
                                  '完整导入收藏网页，支持在 ⌘T 统一智能栏秒级联想直达'
                                )}
                              </div>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={scopes.bookmarks}
                            onChange={(e) =>
                              setScopes((s) => ({ ...s, bookmarks: e.target.checked }))
                            }
                            className="w-4 h-4 accent-indigo-600 shrink-0 mt-0.5"
                          />
                        </label>

                        {/* Scope 6: History */}
                        <label
                          className={`p-3 rounded-xl border flex items-start justify-between gap-2.5 cursor-pointer transition ${
                            scopes.history
                              ? isDark
                                ? 'bg-white/[0.04] border-indigo-500/45'
                                : 'bg-indigo-50/40 border-indigo-300/80'
                              : isDark
                                ? 'bg-transparent border-white/8 opacity-60'
                                : 'bg-zinc-50/60 border-black/6 opacity-65'
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <Clock size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <div className="font-medium">
                                {tr(lang, 'Browsing History', '近期浏览历史记录')}
                              </div>
                              <div className="text-[10.5px] opacity-60 mt-0.5 leading-snug">
                                {tr(
                                  lang,
                                  'Powers URL autocomplete & @History AI recall across shared Profiles',
                                  '赋能智能补全与 @History AI 语义回溯（同 Profile 空间自动共享历史）'
                                )}
                              </div>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={scopes.history}
                            onChange={(e) =>
                              setScopes((s) => ({ ...s, history: e.target.checked }))
                            }
                            className="w-4 h-4 accent-indigo-600 shrink-0 mt-0.5"
                          />
                        </label>
                      </div>

                      {/* Space Layout Options */}
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-1.5">
                        <label className="inline-flex items-center gap-2 cursor-pointer opacity-85 hover:opacity-100">
                          <input
                            type="checkbox"
                            checked={createSpacesFromProfiles}
                            onChange={(e) => setCreateSpacesFromProfiles(e.target.checked)}
                            className="w-3.5 h-3.5 accent-indigo-600"
                          />
                          <span className="text-[11.5px]">
                            {tr(
                              lang,
                              'Create dedicated Spaces in exact source order (uncheck to merge into active Space)',
                              '按原浏览器的空间顺序创建对应的独立空间（取消勾选则合并至当前空间）'
                            )}
                          </span>
                        </label>

                        {createSpacesFromProfiles && (
                          <label className="inline-flex items-center gap-2 cursor-pointer opacity-80 hover:opacity-100">
                            <input
                              type="checkbox"
                              checked={replaceStarterSpaces}
                              onChange={(e) => setReplaceStarterSpaces(e.target.checked)}
                              className="w-3.5 h-3.5 accent-indigo-600"
                            />
                            <span className="text-[11.5px]">
                              {tr(
                                lang,
                                'Clean up empty default starter Spaces',
                                '自动移除空白的默认初始空间（保持侧栏清爽对齐）'
                              )}
                            </span>
                          </label>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  /* Not Detected Fallback Prompt */
                  <div className="py-4 px-2 flex flex-col items-center text-center gap-2.5">
                    <div className="text-sm font-semibold">
                      {tr(
                        lang,
                        `${selectedSource.name} was not found in the default installation folder`,
                        `未在系统默认路径检测到 ${browserDisplayLabel} 用户数据`
                      )}
                    </div>
                    <p className="text-[11.5px] opacity-65 max-w-lg leading-relaxed">
                      {tr(
                        lang,
                        'If it is stored in a custom directory, or if you exported a StorableSidebar.json / bookmarks.html file, you can select it manually below.',
                        '如果你的浏览器数据存放在其他路径，或者你已导出书签 HTML 文件 / StorableSidebar.json，可点击下方按钮手动选择导入。'
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handlePickCustomPath()}
                      className={`mt-1 h-9 px-4 rounded-xl border font-medium inline-flex items-center gap-2 transition cursor-pointer ${
                        isDark
                          ? 'bg-white/8 border-white/14 hover:bg-white/14 text-zinc-100'
                          : 'bg-zinc-100 border-black/10 hover:bg-zinc-200/80 text-zinc-800'
                      }`}
                    >
                      <FolderOpen size={14} className="text-indigo-500" />
                      <span>
                        {tr(
                          lang,
                          'Select User Data Folder or Bookmarks File…',
                          '手动选择数据文件夹或书签导出文件…'
                        )}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {errorMsg && (
              <div className="px-3.5 py-2.5 rounded-xl bg-rose-500/12 border border-rose-500/30 text-rose-500 text-xs">
                {errorMsg}
              </div>
            )}
          </div>
        )}

        {/* Footer Bar (Configure Phase Only) */}
        {phase === 'configure' && (
          <div
            className={`px-7 py-4 border-t flex items-center justify-between gap-4 shrink-0 ${
              isDark ? 'border-white/8 bg-[#14141A]' : 'border-black/6 bg-zinc-100/70'
            }`}
          >
            <div className="flex items-center gap-1.5 text-[11px] opacity-55 min-w-0 truncate">
              <Lock size={12} className="shrink-0" />
              <span className="truncate">
                {tr(
                  lang,
                  '100% local read-only parsing · Original browser files are never modified',
                  '100% 本地只读安全解析 · 绝不修改原浏览器任何数据'
                )}
              </span>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => void handleSkipOrDismiss()}
                className={`h-9 px-4 rounded-xl text-xs font-medium transition cursor-pointer ${
                  isDark
                    ? 'text-zinc-400 hover:text-zinc-100 hover:bg-white/8'
                    : 'text-zinc-600 hover:text-zinc-900 hover:bg-black/6'
                }`}
              >
                {isOnboarding
                  ? tr(lang, 'Skip, Start Fresh', '跳过，从空白开始')
                  : tr(lang, 'Cancel', '取消')}
              </button>

              <button
                type="button"
                disabled={
                  !selectedSource?.detected ||
                  !anyScopeEnabled ||
                  (selectedSource.profiles.length > 0 && selectedProfilesOrdered.length === 0)
                }
                onClick={handleRequestStartImport}
                className="h-9 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-semibold shadow-sm inline-flex items-center gap-2 transition cursor-pointer"
              >
                <span>
                  {tr(
                    lang,
                    `Start Import from ${selectedSource?.name || 'Browser'}`,
                    `开始从 ${selectedSource?.name || browserDisplayLabel} 导入`
                  )}
                </span>
                <ArrowRight size={13.5} />
              </button>
            </div>
          </div>
        )}

        {/* ==================== PRE-IMPORT CONFIRMATION DIALOG OVERLAY ==================== */}
        {confirmOpen && selectedSource && (
          <div
            onClick={() => setConfirmOpen(false)}
            className="arc-backdrop-enter absolute inset-0 z-30 bg-black/55 backdrop-blur-md flex items-center justify-center p-6"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`arc-modal-enter w-full max-w-[500px] rounded-2xl border p-6 shadow-2xl space-y-4 text-xs ${
                isDark
                  ? 'bg-[#1F1F28] border-white/14 text-zinc-100'
                  : 'bg-white border-black/10 text-zinc-900'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <BrowserBrandLogo id={selectedBrowserId} size={40} />
                  <div>
                    <div className="text-[11px] font-semibold text-indigo-500 uppercase tracking-wider">
                      {tr(lang, 'Confirm Migration Plan', '开始导入前确认')}
                    </div>
                    <h2 className="text-base font-semibold tracking-tight mt-0.5">
                      {tr(
                        lang,
                        `Ready to import from ${browserDisplayLabel}?`,
                        `确认将以下 ${browserDisplayLabel} 数据导入 Arko？`
                      )}
                    </h2>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="p-1 rounded-lg opacity-55 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Ordered Spaces Preview */}
              {selectedProfilesOrdered.length > 0 && (
                <div
                  className={`p-3 rounded-xl border space-y-2 ${
                    isDark ? 'bg-white/[0.03] border-white/8' : 'bg-zinc-50 border-black/6'
                  }`}
                >
                  <div className="text-[11px] font-medium opacity-70 flex items-center justify-between">
                    <span>
                      {createSpacesFromProfiles
                        ? tr(
                            lang,
                            `Spaces to create in exact order (${selectedProfilesOrdered.length})`,
                            `将按以下原始顺序创建空间 (${selectedProfilesOrdered.length} 个)`
                          )
                        : tr(
                            lang,
                            `Merging ${selectedProfilesOrdered.length} source space(s) into active Space`,
                            `将 ${selectedProfilesOrdered.length} 个源空间内容合并至当前空间`
                          )}
                    </span>
                    {selectedDistinctProfiles.length > 0 && (
                      <span className="text-indigo-500 font-medium">
                        {selectedDistinctProfiles.length} Profile
                        {selectedDistinctProfiles.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {selectedProfilesOrdered.map((p, idx) => (
                      <span
                        key={p.id}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-medium ${
                          isDark
                            ? 'bg-black/30 border-white/10'
                            : 'bg-white border-black/8 shadow-2xs'
                        }`}
                      >
                        <span className="opacity-45 font-mono text-[10px]">{idx + 1}.</span>
                        {p.accentColor && (
                          <span
                            style={{ backgroundColor: p.accentColor }}
                            className="w-1.5 h-1.5 rounded-full"
                          />
                        )}
                        <span>{p.emoji || '🌐'}</span>
                        <span className="max-w-[100px] truncate">{p.name}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Selected Scopes Summary Chips */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium opacity-70">
                  {tr(lang, 'Selected migration items:', '已确认勾选的导入内容：')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {scopes.spacesAndPinned && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/12 text-indigo-500 font-medium text-[11px]">
                      <Check size={11} strokeWidth={2.8} />
                      <span>
                        {tr(
                          lang,
                          `Spaces, Favorites & Folders (${selectedPinnedCount})`,
                          `常驻图标与固定文件夹 (${selectedPinnedCount})`
                        )}
                      </span>
                    </span>
                  )}
                  {scopes.openTabs && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500/12 text-sky-500 font-medium text-[11px]">
                      <Check size={11} strokeWidth={2.8} />
                      <span>
                        {tr(
                          lang,
                          `Today Open Tabs (${selectedOpenTabsCount || selectedSource.openTabsEstimate || 0})`,
                          `打开的日常标签 (${selectedOpenTabsCount || selectedSource.openTabsEstimate || 0})`
                        )}
                      </span>
                    </span>
                  )}
                  {effectiveScopes.sessions && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/12 text-rose-500 font-medium text-[11px]">
                      <Check size={11} strokeWidth={2.8} />
                      <span>
                        {tr(lang, 'Account Cookies & Logins', 'Profile 账号登录态与存储')}
                      </span>
                    </span>
                  )}
                  {effectiveScopes.extensions && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-500/12 text-violet-500 font-medium text-[11px]">
                      <Check size={11} strokeWidth={2.8} />
                      <span>
                        {tr(
                          lang,
                          `Extensions (${selectedSource.extensionsEstimate || 0})`,
                          `扩展插件生态 (${selectedSource.extensionsEstimate || 0})`
                        )}
                      </span>
                    </span>
                  )}
                  {scopes.bookmarks && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/12 text-amber-600 dark:text-amber-400 font-medium text-[11px]">
                      <Check size={11} strokeWidth={2.8} />
                      <span>
                        {tr(
                          lang,
                          `Bookmarks (${selectedSource.bookmarksEstimate})`,
                          `书签收藏 (${selectedSource.bookmarksEstimate})`
                        )}
                      </span>
                    </span>
                  )}
                  {scopes.history && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
                      <Check size={11} strokeWidth={2.8} />
                      <span>{tr(lang, 'Browsing History', '浏览历史记录')}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Safety & Keychain Note */}
              <div
                className={`p-3 rounded-xl border flex items-start gap-2.5 text-[11px] leading-relaxed ${
                  isDark
                    ? 'bg-indigo-500/[0.07] border-indigo-500/20 text-zinc-300'
                    : 'bg-indigo-50/70 border-indigo-200/70 text-zinc-700'
                }`}
              >
                <ShieldCheck size={15} className="text-indigo-500 shrink-0 mt-0.5" />
                <div>
                  {effectiveScopes.sessions
                    ? tr(
                        lang,
                        'Read-only local copy: your original browser is never altered. On macOS, Keychain may prompt once ("Safe Storage") to authorize decrypting login Cookies.',
                        '全程本地只读读取，绝不修改原浏览器。由于已勾选「账号登录态」，macOS 可能会弹出一次钥匙串（Safe Storage）授权框，点击「允许」即可自动完成免登迁移。'
                      )
                    : tr(
                        lang,
                        '100% read-only local migration. Your original browser files and settings will remain completely untouched.',
                        '100% 本地只读迁移，原浏览器的所有数据与配置均保持原样，不受任何影响。'
                      )}
                </div>
              </div>

              {/* Confirm Dialog Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className={`h-9 px-4 rounded-xl font-medium border transition cursor-pointer ${
                    isDark
                      ? 'border-white/12 hover:bg-white/8 text-zinc-300'
                      : 'border-black/10 bg-zinc-50 hover:bg-zinc-100 text-zinc-700'
                  }`}
                >
                  {tr(lang, 'Back to Edit', '返回调整')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmedExecuteImport}
                  className="h-9 px-5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold shadow-md shadow-indigo-500/25 inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Sparkles size={13} />
                  <span>{tr(lang, 'Confirm & Start Import', '确认无误，立即开始导入')}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
