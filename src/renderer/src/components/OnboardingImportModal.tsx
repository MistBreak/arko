import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Bookmark,
  Check,
  CheckCircle2,
  Clock,
  FolderOpen,
  Globe,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  Sparkles,
  X
} from 'lucide-react'
import { tr } from '@shared/i18n'
import type {
  AppLanguage,
  AppSettings,
  BrowserImportResult,
  DetectedBrowserSource,
  ImportBrowserId,
  ImportDataScopes
} from '@shared/types'
import { AppIcon } from './AppIcon'

interface Props {
  isDark: boolean
  isClosing?: boolean
  mode: 'onboarding' | 'standalone'
  settings: AppSettings
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  onShowToast?: (msg: string) => void
  onClose: () => void
}

const BrowserBrandLogo: React.FC<{ id: ImportBrowserId; size?: number }> = ({
  id,
  size = 38
}) => {
  if (id === 'arc') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
        <defs>
          <linearGradient id="imp-arc-bg" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FF5E7E" />
            <stop offset="50%" stopColor="#6E56CF" />
            <stop offset="100%" stopColor="#3B82F6" />
          </linearGradient>
        </defs>
        <rect x="3" y="3" width="42" height="42" rx="12" fill="url(#imp-arc-bg)" />
        <path
          d="M14.5 34.5V24.5C14.5 18.701 18.753 14 24 14C29.247 14 33.5 18.701 33.5 24.5V34.5"
          stroke="#FFFDF9"
          strokeWidth="5.2"
          strokeLinecap="round"
        />
        <circle cx="24" cy="27.5" r="2.6" fill="#FFFDF9" fillOpacity="0.88" />
      </svg>
    )
  }

  if (id === 'dia') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
        <defs>
          <linearGradient id="imp-dia-bg" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#18181B" />
            <stop offset="100%" stopColor="#312E81" />
          </linearGradient>
        </defs>
        <rect x="3" y="3" width="42" height="42" rx="12" fill="url(#imp-dia-bg)" />
        <rect
          x="3.75"
          y="3.75"
          width="40.5"
          height="40.5"
          rx="11.25"
          stroke="#FFFFFF"
          strokeOpacity="0.16"
          strokeWidth="1.5"
        />
        <path
          d="M16 14.5H23.2C29.165 14.5 33.5 18.62 33.5 24C33.5 29.38 29.165 33.5 23.2 33.5H16V14.5Z"
          stroke="#F8FAFC"
          strokeWidth="4.2"
          strokeLinejoin="round"
        />
        <path
          d="M23.5 19.5L25.1 22.4L28 24L25.1 25.6L23.5 28.5L21.9 25.6L19 24L21.9 22.4L23.5 19.5Z"
          fill="#A5B4FC"
        />
      </svg>
    )
  }

  // Google Chrome
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <rect x="3" y="3" width="42" height="42" rx="12" fill="#FFFFFF" />
      <rect
        x="3.5"
        y="3.5"
        width="41"
        height="41"
        rx="11.5"
        stroke="#000000"
        strokeOpacity="0.08"
      />
      <circle cx="24" cy="24" r="14" fill="#FACC15" />
      <path d="M24 10C18.66 10 14.02 12.99 11.66 17.39L18.6 29.4L24 24H37.85C36.68 16.08 30.94 10 24 10Z" fill="#EF4444" />
      <path d="M11.66 17.39C10.6 19.36 10 21.61 10 24C10 31.32 15.62 37.33 22.78 37.94L29.4 26.5L24 24L18.6 29.4L11.66 17.39Z" fill="#22C55E" />
      <circle cx="24" cy="24" r="6.6" fill="#FFFFFF" />
      <circle cx="24" cy="24" r="5.1" fill="#3B82F6" />
    </svg>
  )
}

export const OnboardingImportModal: React.FC<Props> = ({
  isDark,
  isClosing = false,
  mode,
  settings,
  onUpdateSettings,
  onShowToast,
  onClose
}) => {
  const lang: AppLanguage = settings.language === 'zh-CN' ? 'zh-CN' : 'en'
  const isOnboarding = mode === 'onboarding'

  const [scanning, setScanning] = useState(true)
  const [sources, setSources] = useState<DetectedBrowserSource[]>([])
  const [selectedBrowserId, setSelectedBrowserId] = useState<ImportBrowserId>('arc')
  const [selectedProfileIdsByBrowser, setSelectedProfileIdsByBrowser] = useState<
    Record<ImportBrowserId, string[]>
  >({
    arc: [],
    dia: [],
    chrome: []
  })

  const [scopes, setScopes] = useState<ImportDataScopes>({
    spacesAndPinned: true,
    bookmarks: true,
    history: true
  })
  const [createSpacesFromProfiles, setCreateSpacesFromProfiles] = useState(true)

  const [importing, setImporting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [completedResult, setCompletedResult] = useState<BrowserImportResult | null>(null)

  const runScan = async (preserveCustom = true): Promise<void> => {
    setScanning(true)
    setErrorMsg(null)
    try {
      const detected = await window.arko.detectImportBrowsers()
      setSources((prev) => {
        const next = detected.map((d) => {
          if (preserveCustom) {
            const existingCustom = prev.find((p) => p.id === d.id && p.isCustomPath && p.detected)
            if (existingCustom) return existingCustom
          }
          return d
        })
        return next
      })

      const initSelection: Record<ImportBrowserId, string[]> = {
        arc: [],
        dia: [],
        chrome: []
      }
      for (const src of detected) {
        initSelection[src.id] = src.profiles.map((p) => p.id)
      }
      setSelectedProfileIdsByBrowser((prev) => ({
        arc: prev.arc.length > 0 ? prev.arc : initSelection.arc,
        dia: prev.dia.length > 0 ? prev.dia : initSelection.dia,
        chrome: prev.chrome.length > 0 ? prev.chrome : initSelection.chrome
      }))

      const firstDetected = detected.find((d) => d.detected)
      if (firstDetected) {
        setSelectedBrowserId(firstDetected.id)
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

  const selectedSource = useMemo(
    () => sources.find((s) => s.id === selectedBrowserId),
    [sources, selectedBrowserId]
  )

  const activeProfileIds = selectedProfileIdsByBrowser[selectedBrowserId] || []

  const toggleProfileSelection = (profileId: string): void => {
    setSelectedProfileIdsByBrowser((prev) => {
      const cur = prev[selectedBrowserId] || []
      const exists = cur.includes(profileId)
      const next = exists ? cur.filter((id) => id !== profileId) : [...cur, profileId]
      return { ...prev, [selectedBrowserId]: next }
    })
  }

  const handleSelectAllProfiles = (): void => {
    if (!selectedSource) return
    const allIds = selectedSource.profiles.map((p) => p.id)
    const allSelected = allIds.length > 0 && allIds.every((id) => activeProfileIds.includes(id))
    setSelectedProfileIdsByBrowser((prev) => ({
      ...prev,
      [selectedBrowserId]: allSelected ? [allIds[0]] : allIds
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
          '随时可在「设置 → 界面与常规」或顶部菜单栏重新导入浏览器数据'
        )
      )
    }
    onClose()
  }

  const anyScopeEnabled = scopes.spacesAndPinned || scopes.bookmarks || scopes.history

  const handleStartImport = async (): Promise<void> => {
    if (!selectedSource || !selectedSource.detected || !anyScopeEnabled) return
    setImporting(true)
    setErrorMsg(null)
    try {
      const res = await window.arko.executeBrowserImport({
        browserId: selectedBrowserId,
        customPath: selectedSource.isCustomPath ? selectedSource.dataRootPath : null,
        selectedProfileIds: activeProfileIds.length > 0 ? activeProfileIds : undefined,
        scopes,
        createSpacesFromProfiles
      })
      if (!res.ok) {
        setErrorMsg(
          res.error ||
            tr(lang, 'Import failed. Please check the browser data directory.', '导入失败，请检查浏览器数据目录是否可访问。')
        )
      } else {
        setCompletedResult(res)
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unexpected error during import')
    } finally {
      setImporting(false)
    }
  }

  const getBrowserTagline = (id: ImportBrowserId): string => {
    if (id === 'arc') {
      return tr(
        lang,
        'Spaces · Favorites Grid · Pinned Folders · History',
        'Spaces 空间 · 顶部常驻图标 · 固定标签与文件夹 · 历史'
      )
    }
    if (id === 'dia') {
      return tr(
        lang,
        'Profiles · Bookmarks · Pinned Tabs · History',
        '多配置空间 · 书签收藏 · 固定标签页 · 浏览历史'
      )
    }
    return tr(
      lang,
      'Chrome Profiles · Bookmark Bar · Pinned · History',
      'Chrome 多账号配置 · 完整书签树 · 固定标签 · 历史'
    )
  }

  return (
    <div
      onClick={() => {
        if (!isOnboarding && !importing) onClose()
      }}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4 select-none ${
        isClosing ? 'arc-backdrop-exit' : 'arc-backdrop-enter'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-[780px] max-h-[90vh] rounded-3xl border shadow-2xl flex flex-col overflow-hidden transition-all ${
          isClosing ? 'arc-modal-exit' : 'arc-modal-enter'
        } ${
          isDark
            ? 'bg-[#191920] border-white/12 text-zinc-100'
            : 'bg-[#FAF9F6] border-black/10 text-zinc-900'
        }`}
      >
        {/* Top Header */}
        <div
          className={`px-7 pt-6 pb-5 border-b flex items-start justify-between gap-4 ${
            isDark
              ? 'border-white/8 bg-gradient-to-b from-indigo-500/[0.08] to-transparent'
              : 'border-black/6 bg-gradient-to-b from-indigo-500/[0.06] to-transparent'
          }`}
        >
          <div className="flex items-center gap-4">
            <AppIcon size={50} className="shrink-0 rounded-2xl shadow-sm" />
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-indigo-500/12 text-indigo-500 mb-1">
                <Sparkles size={11} />
                <span>
                  {isOnboarding
                    ? tr(lang, 'Welcome · Quick Setup', '初次启动 · 一键无缝迁移')
                    : tr(lang, 'Browser Data Migration', '浏览器数据迁移向导')}
                </span>
              </div>
              <h1 className="text-lg font-semibold tracking-tight">
                {completedResult
                  ? tr(lang, 'Your Browser Data Is Ready!', '数据导入完成，一切准备就绪！')
                  : isOnboarding
                    ? tr(
                        lang,
                        'Bring your digital home into Arko',
                        '从你常用的浏览器导入数据，即刻开始'
                      )
                    : tr(
                        lang,
                        'Import Data from Arc, Dia, or Google Chrome',
                        '从 Arc、Dia 或 Google Chrome 导入用户数据'
                      )}
              </h1>
              <p className="text-xs opacity-65 mt-0.5">
                {completedResult
                  ? tr(
                      lang,
                      'Your spaces, pinned tabs, bookmarks, and history have been merged cleanly.',
                      '空间、固定标签、书签与历史记录已无损合并至本地，原浏览器不受任何影响。'
                    )
                  : tr(
                      lang,
                      'Select Arc, Dia, or Google Chrome to migrate Spaces, Pinned Tabs, Bookmarks, and History in seconds.',
                      '支持选择 Arc 浏览器、Dia 浏览器或 Google Chrome，一键迁移空间、常驻标签、书签与历史记录。'
                    )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Quick Bilingual Switcher */}
            <button
              type="button"
              onClick={() =>
                void onUpdateSettings({ language: lang === 'zh-CN' ? 'en' : 'zh-CN' })
              }
              title={tr(lang, 'Switch UI Language', '切换界面语言 (中文 / English)')}
              className={`h-7 px-2.5 rounded-full text-[11px] font-medium inline-flex items-center gap-1 border transition ${
                isDark
                  ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-zinc-300'
                  : 'bg-white border-black/10 hover:bg-zinc-100 text-zinc-700'
              }`}
            >
              <Globe size={11.5} className="opacity-70" />
              <span>{lang === 'zh-CN' ? '中文' : 'EN'}</span>
            </button>

            {!isOnboarding && (
              <button
                type="button"
                onClick={onClose}
                disabled={importing}
                className="p-1.5 rounded-xl opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Body Content */}
        {completedResult ? (
          /* ==================== Completion Summary View ==================== */
          <div className="p-7 space-y-6 overflow-y-auto">
            <div
              className={`p-5 rounded-2xl border flex items-center gap-4 ${
                isDark
                  ? 'bg-emerald-500/[0.08] border-emerald-500/25'
                  : 'bg-emerald-50/80 border-emerald-200'
              }`}
            >
              <div className="w-11 h-11 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                <CheckCircle2 size={24} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {tr(
                    lang,
                    `Successfully imported from ${
                      completedResult.browserId === 'arc'
                        ? 'Arc Browser'
                        : completedResult.browserId === 'dia'
                          ? 'Dia Browser'
                          : 'Google Chrome'
                    }`,
                    `已成功从 ${
                      completedResult.browserId === 'arc'
                        ? 'Arc 浏览器'
                        : completedResult.browserId === 'dia'
                          ? 'Dia 浏览器'
                          : 'Google Chrome 谷歌浏览器'
                    } 导入数据`
                  )}
                </div>
                <div className="text-xs opacity-70 mt-0.5">
                  {tr(
                    lang,
                    'Imported tabs stay hibernated with zero memory usage until you click them.',
                    '所有导入的常驻与固定标签均采用按需唤醒机制，点击前零内存占用；双指左右滑动左侧栏即可切换空间。'
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              {[
                {
                  label: tr(lang, 'Spaces Created', '新增隔离空间'),
                  value: completedResult.spacesCreated,
                  sub: tr(lang, 'Profiles / Spaces', '独立主题与会话')
                },
                {
                  label: tr(lang, 'Favorites & Pinned', '常驻与固定标签'),
                  value: completedResult.favoritesImported + completedResult.pinnedTabsImported,
                  sub:
                    completedResult.tabGroupsCreated > 0
                      ? tr(
                          lang,
                          `Includes ${completedResult.tabGroupsCreated} folders`,
                          `含 ${completedResult.tabGroupsCreated} 个折叠文件夹`
                        )
                      : tr(lang, 'Sidebar ready', '已同步至左侧栏')
                },
                {
                  label: tr(lang, 'Bookmarks', '书签与收藏'),
                  value: completedResult.bookmarksImported,
                  sub: tr(lang, 'Omnibox searchable', '支持智能栏检索')
                },
                {
                  label: tr(lang, 'History Items', '浏览历史记录'),
                  value: completedResult.historyImported,
                  sub: tr(lang, '@History AI ready', '支持 @History 提问')
                }
              ].map((stat, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-2xl border ${
                    isDark ? 'bg-white/[0.03] border-white/8' : 'bg-white border-black/7 shadow-2xs'
                  }`}
                >
                  <div className="text-2xl font-bold tracking-tight text-indigo-500">
                    {stat.value}
                  </div>
                  <div className="text-xs font-semibold mt-1">{stat.label}</div>
                  <div className="text-[11px] opacity-55 mt-0.5 truncate">{stat.sub}</div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setCompletedResult(null)}
                className={`h-9 px-4 rounded-xl text-xs font-medium border transition ${
                  isDark
                    ? 'border-white/12 hover:bg-white/8 text-zinc-300'
                    : 'border-black/10 bg-white hover:bg-zinc-100 text-zinc-700'
                }`}
              >
                {tr(lang, 'Import from Another Browser…', '继续从其他浏览器补充导入…')}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="h-10 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm inline-flex items-center gap-2 transition cursor-pointer"
              >
                <span>{tr(lang, 'Start Browsing', '开始使用浏览器')}</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        ) : (
          /* ==================== Browser Picker & Scope Configuration View ==================== */
          <div className="flex-1 overflow-y-auto px-7 py-5 space-y-5 text-xs">
            {/* Step 1: Choose Source Browser (Arc / Dia / Chrome) */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[12.5px]">
                  {tr(lang, '1. Choose a browser to import from', '1. 选择要导入数据的浏览器')}
                </span>
                <button
                  type="button"
                  disabled={scanning}
                  onClick={() => void runScan(true)}
                  className="text-[11px] opacity-65 hover:opacity-100 inline-flex items-center gap-1 transition"
                >
                  <RefreshCw size={11} className={scanning ? 'animate-spin' : ''} />
                  <span>{tr(lang, 'Re-scan', '重新扫描本机')}</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {(['arc', 'dia', 'chrome'] as ImportBrowserId[]).map((bid) => {
                  const src = sources.find((s) => s.id === bid)
                  const isSelected = selectedBrowserId === bid
                  const detected = Boolean(src?.detected)
                  const title =
                    bid === 'arc'
                      ? tr(lang, 'Arc Browser', 'Arc 浏览器')
                      : bid === 'dia'
                        ? tr(lang, 'Dia Browser', 'Dia 浏览器')
                        : tr(lang, 'Google Chrome', 'Google Chrome')

                  let badgeText = scanning
                    ? tr(lang, 'Scanning…', '正在检测…')
                    : tr(lang, 'Not detected', '未检测到默认目录')

                  if (!scanning && detected && src) {
                    if (bid === 'arc' && src.spacesCount) {
                      badgeText = tr(
                        lang,
                        `Detected · ${src.spacesCount} Spaces`,
                        `已检测到 · ${src.spacesCount} 个空间`
                      )
                    } else if (src.profiles.length > 1) {
                      badgeText = tr(
                        lang,
                        `Detected · ${src.profiles.length} Profiles`,
                        `已检测到 · ${src.profiles.length} 个配置`
                      )
                    } else {
                      badgeText = tr(lang, 'Detected on Mac', '已检测到本机数据')
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
                      className={`relative text-left p-4 rounded-2xl border transition-all flex flex-col gap-3 cursor-pointer ${
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
                        <BrowserBrandLogo id={bid} size={38} />
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
                        <div className="font-semibold text-[13.5px] flex items-center gap-1.5">
                          <span>{title}</span>
                        </div>
                        <div className="text-[11px] opacity-60 mt-1 leading-relaxed">
                          {getBrowserTagline(bid)}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Step 2: Configure Profiles & Data Scopes */}
            {selectedSource && (
              <div
                className={`p-4 rounded-2xl border space-y-4 ${
                  isDark ? 'bg-white/[0.025] border-white/8' : 'bg-white border-black/8 shadow-2xs'
                }`}
              >
                {selectedSource.detected ? (
                  <>
                    {/* Profile / Space Selector */}
                    {selectedSource.profiles.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold opacity-85">
                            {selectedBrowserId === 'arc'
                              ? tr(
                                  lang,
                                  `2. Select Arc Spaces to import (${activeProfileIds.length}/${selectedSource.profiles.length})`,
                                  `2. 选择要导入的 Arc 空间 (${activeProfileIds.length}/${selectedSource.profiles.length})`
                                )
                              : tr(
                                  lang,
                                  `2. Select Browser Profiles (${activeProfileIds.length}/${selectedSource.profiles.length})`,
                                  `2. 选择要导入的浏览器配置空间 (${activeProfileIds.length}/${selectedSource.profiles.length})`
                                )}
                          </span>
                          <div className="flex items-center gap-3">
                            {selectedSource.profiles.length > 1 && (
                              <button
                                type="button"
                                onClick={handleSelectAllProfiles}
                                className="text-[11px] text-indigo-500 hover:underline"
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
                              className="text-[11px] opacity-65 hover:opacity-100 inline-flex items-center gap-1"
                            >
                              <FolderOpen size={11} />
                              <span>{tr(lang, 'Change folder…', '更换目录/文件…')}</span>
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {selectedSource.profiles.map((prof) => {
                            const checked = activeProfileIds.includes(prof.id)
                            const countBadge =
                              selectedBrowserId === 'arc'
                                ? (prof.favoriteCount || 0) + (prof.pinnedCount || 0)
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
                                        `Arc Space "${prof.name}" · Bound to Profile "${prof.profileName}"`,
                                        `Arc 空间「${prof.name}」· 关联底层配置 Profile: ${prof.profileName}`
                                      )
                                    : prof.name
                                }
                                className={`h-8 px-3 rounded-xl border text-xs inline-flex items-center gap-2 transition cursor-pointer ${
                                  checked
                                    ? isDark
                                      ? 'bg-indigo-500/20 border-indigo-500/60 text-zinc-100 font-medium'
                                      : 'bg-indigo-50 border-indigo-400 text-indigo-950 font-medium'
                                    : isDark
                                      ? 'bg-white/[0.02] border-white/10 opacity-60 hover:opacity-95'
                                      : 'bg-zinc-50 border-black/8 opacity-65 hover:opacity-100'
                                }`}
                              >
                                <span
                                  className={`w-3.5 h-3.5 rounded flex items-center justify-center ${
                                    checked
                                      ? 'bg-indigo-600 text-white'
                                      : 'border border-current opacity-40'
                                  }`}
                                >
                                  {checked && <Check size={10} strokeWidth={3} />}
                                </span>
                                <span>{prof.emoji || '🌐'}</span>
                                <span className="truncate max-w-[150px]">{prof.name}</span>
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

                    {/* Data Scopes Checkboxes */}
                    <div className="space-y-2 pt-1">
                      <div className="font-semibold opacity-85">
                        {tr(lang, '3. Choose what data to import', '3. 选择要导入的数据内容')}
                      </div>

                      <div className="grid grid-cols-1 gap-2">
                        <label
                          className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition ${
                            scopes.spacesAndPinned
                              ? isDark
                                ? 'bg-white/[0.04] border-indigo-500/40'
                                : 'bg-indigo-50/40 border-indigo-300/70'
                              : isDark
                                ? 'bg-transparent border-white/8 opacity-65'
                                : 'bg-zinc-50/60 border-black/6 opacity-70'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Layers size={16} className="text-indigo-500 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-medium">
                                {selectedBrowserId === 'arc'
                                  ? tr(
                                      lang,
                                      'Spaces, Favorites Grid & Pinned Folders',
                                      'Spaces 空间、顶部常驻图标网格与固定标签文件夹'
                                    )
                                  : tr(
                                      lang,
                                      'Pinned Tabs & Bookmark Bar Sidebar Layout',
                                      '固定标签页与书签栏精选侧边栏分组'
                                    )}
                              </div>
                              <div className="text-[11px] opacity-60 truncate">
                                {selectedBrowserId === 'arc'
                                  ? tr(
                                      lang,
                                      'Preserves Arc Space icons, colors, Top Apps, and collapsible folders',
                                      '完整还原 Arc 空间配色图标、Top Apps 大图标与可折叠文件夹结构'
                                    )
                                  : tr(
                                      lang,
                                      'Maps pinned tabs and top bookmark bar folders neatly into the sidebar',
                                      '将原浏览器的固定标签与书签栏常用目录自动整理到左侧栏'
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
                            className="w-4 h-4 accent-indigo-600 shrink-0"
                          />
                        </label>

                        <label
                          className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition ${
                            scopes.bookmarks
                              ? isDark
                                ? 'bg-white/[0.04] border-indigo-500/40'
                                : 'bg-indigo-50/40 border-indigo-300/70'
                              : isDark
                                ? 'bg-transparent border-white/8 opacity-65'
                                : 'bg-zinc-50/60 border-black/6 opacity-70'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Bookmark size={16} className="text-amber-500 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-medium">
                                {tr(lang, 'Bookmarks & Saved Links', '书签与收藏夹')}
                                {selectedSource.bookmarksEstimate > 0 && (
                                  <span className="ml-1.5 text-[11px] opacity-60 font-normal">
                                    ({selectedSource.bookmarksEstimate})
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] opacity-60 truncate">
                                {tr(
                                  lang,
                                  'Import all saved bookmarks for instant search in Command Bar (⌘K)',
                                  '完整导入所有收藏网页，支持在 ⌘K 统一智能栏中秒级联想直达'
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
                            className="w-4 h-4 accent-indigo-600 shrink-0"
                          />
                        </label>

                        <label
                          className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition ${
                            scopes.history
                              ? isDark
                                ? 'bg-white/[0.04] border-indigo-500/40'
                                : 'bg-indigo-50/40 border-indigo-300/70'
                              : isDark
                                ? 'bg-transparent border-white/8 opacity-65'
                                : 'bg-zinc-50/60 border-black/6 opacity-70'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Clock size={16} className="text-emerald-500 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-medium">
                                {tr(lang, 'Browsing History', '近期浏览历史记录')}
                              </div>
                              <div className="text-[11px] opacity-60 truncate">
                                {tr(
                                  lang,
                                  'Powers URL autocomplete and @History AI semantic recall (works while browser is open)',
                                  '赋能地址栏智能补全与 @History AI 历史回溯提问（无需关闭原浏览器即可读取）'
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
                            className="w-4 h-4 accent-indigo-600 shrink-0"
                          />
                        </label>
                      </div>

                      <label className="flex items-center gap-2 pt-1.5 cursor-pointer opacity-80 hover:opacity-100">
                        <input
                          type="checkbox"
                          checked={createSpacesFromProfiles}
                          onChange={(e) => setCreateSpacesFromProfiles(e.target.checked)}
                          className="w-3.5 h-3.5 accent-indigo-600"
                        />
                        <span className="text-[11.5px]">
                          {tr(
                            lang,
                            'Create dedicated isolated Spaces matching source Spaces / Profiles (uncheck to merge into current Space)',
                            '按原浏览器的空间 / 账号配置自动创建对应的独立空间（取消勾选则合并至当前空间）'
                          )}
                        </span>
                      </label>
                    </div>
                  </>
                ) : (
                  /* Not Detected Fallback Prompt */
                  <div className="py-4 px-2 flex flex-col items-center text-center gap-2.5">
                    <div className="text-sm font-semibold">
                      {tr(
                        lang,
                        `${selectedSource.name} was not found in the default installation folder`,
                        `未在系统默认路径检测到 ${
                          selectedBrowserId === 'arc'
                            ? 'Arc 浏览器'
                            : selectedBrowserId === 'dia'
                              ? 'Dia 浏览器'
                              : 'Google Chrome'
                        } 用户数据`
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

        {/* Footer Bar (Hidden on Completion View since Completion has its own CTA bar) */}
        {!completedResult && (
          <div
            className={`px-7 py-4 border-t flex items-center justify-between gap-4 ${
              isDark ? 'border-white/8 bg-[#15151B]' : 'border-black/6 bg-zinc-100/70'
            }`}
          >
            <div className="flex items-center gap-1.5 text-[11px] opacity-55 min-w-0 truncate">
              <Lock size={12} className="shrink-0" />
              <span className="truncate">
                {tr(
                  lang,
                  '100% local read-only parsing · Original browser files are never modified',
                  '100% 本地只读安全解析 · 绝不修改原浏览器数据，无需关闭原浏览器'
                )}
              </span>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                disabled={importing}
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
                  importing ||
                  !selectedSource?.detected ||
                  !anyScopeEnabled ||
                  (selectedSource.profiles.length > 0 && activeProfileIds.length === 0)
                }
                onClick={() => void handleStartImport()}
                className="h-9 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-semibold shadow-sm inline-flex items-center gap-2 transition cursor-pointer"
              >
                {importing ? (
                  <>
                    <Loader2 size={13.5} className="animate-spin" />
                    <span>{tr(lang, 'Importing…', '正在导入数据…')}</span>
                  </>
                ) : (
                  <>
                    <span>
                      {tr(
                        lang,
                        `Import from ${selectedSource?.name || 'Browser'}`,
                        `开始从 ${
                          selectedBrowserId === 'arc'
                            ? 'Arc'
                            : selectedBrowserId === 'dia'
                              ? 'Dia'
                              : 'Chrome'
                        } 导入`
                      )}
                    </span>
                    <ArrowRight size={13.5} />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
