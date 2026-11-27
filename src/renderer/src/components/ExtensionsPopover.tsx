import React, { useMemo, useState } from 'react'
import {
  AlertCircle,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  Play,
  Puzzle,
  Settings,
  Sparkles,
  Store,
  Trash2,
  X
} from 'lucide-react'
import { tr } from '@shared/i18n'
import type { AppLanguage, InstalledExtensionItem } from '@shared/types'

function extractWebStoreIdFromUrl(url?: string | null): string | null {
  if (!url) return null
  const m = url.match(
    /^https?:\/\/(?:chromewebstore\.google\.com|chrome\.google\.com\/webstore)\/detail\/(?:[^/]+\/)?([a-p]{32})(?:[/?#]|$)/i
  )
  return m?.[1]?.toLowerCase() || null
}

interface ManagerPanelProps {
  isDark: boolean
  lang?: AppLanguage
  extensions: InstalledExtensionItem[]
  activeTabUrl?: string
  activeTabTitle?: string
  compact?: boolean
  anchorPos?: { x: number; y: number }
  onOpenPopup: (extId: string, anchor?: { x: number; y: number }) => Promise<void>
  onOpenOptions: (extId: string) => Promise<void>
  onToggleExtension: (extId: string, enabled: boolean) => Promise<void>
  onRemoveExtension: (extId: string) => Promise<void>
  onInstallUnpacked: () => Promise<void>
  onInstallWebStore: (urlOrId: string) => Promise<boolean>
  onOpenWebStoreHome: () => void
  onOpenBrowserImport?: () => void
}

export const ExtensionsManagerPanel: React.FC<ManagerPanelProps> = ({
  isDark,
  lang,
  extensions,
  activeTabUrl,
  activeTabTitle,
  compact = false,
  anchorPos,
  onOpenPopup,
  onOpenOptions,
  onToggleExtension,
  onRemoveExtension,
  onInstallUnpacked,
  onInstallWebStore,
  onOpenWebStoreHome,
  onOpenBrowserImport
}) => {
  const [storeInput, setStoreInput] = useState('')
  const [installingStore, setInstallingStore] = useState(false)
  const [installingUnpacked, setInstallingUnpacked] = useState(false)

  const currentPageStoreExtId = useMemo(
    () => extractWebStoreIdFromUrl(activeTabUrl),
    [activeTabUrl]
  )
  const isCurrentStoreExtInstalled = useMemo(
    () =>
      Boolean(
        currentPageStoreExtId &&
          extensions.some(
            (e) => e.id === currentPageStoreExtId || e.sourceExtensionId === currentPageStoreExtId
          )
      ),
    [currentPageStoreExtId, extensions]
  )

  const handleInstallFromInput = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault()
    const val = storeInput.trim()
    if (!val || installingStore) return
    setInstallingStore(true)
    try {
      const ok = await onInstallWebStore(val)
      if (ok) {
        setStoreInput('')
      }
    } finally {
      setInstallingStore(false)
    }
  }

  const handleInstallCurrentPage = async (): Promise<void> => {
    if (!currentPageStoreExtId || installingStore) return
    setInstallingStore(true)
    try {
      await onInstallWebStore(currentPageStoreExtId)
    } finally {
      setInstallingStore(false)
    }
  }

  return (
    <div className="space-y-3 text-xs">
      {/* Contextual 1-Click Install Banner when viewing Chrome Web Store */}
      {currentPageStoreExtId && !isCurrentStoreExtInstalled && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between gap-2.5 ${
            isDark
              ? 'bg-indigo-500/14 border-indigo-400/35 text-zinc-100'
              : 'bg-indigo-50 border-indigo-300 text-indigo-950'
          }`}
        >
          <div className="min-w-0">
            <div className="font-semibold text-[11.5px] flex items-center gap-1.5">
              <Sparkles size={12.5} className="text-indigo-500 shrink-0" />
              <span className="truncate">
                {tr(lang, 'Chrome Web Store Extension Detected', '检测到当前商店页面扩展')}
              </span>
            </div>
            <div className="text-[10.5px] opacity-70 truncate mt-0.5">
              {activeTabTitle || currentPageStoreExtId}
            </div>
          </div>
          <button
            type="button"
            disabled={installingStore}
            onClick={() => void handleInstallCurrentPage()}
            className="h-7 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition"
          >
            {installingStore ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Download size={12} />
            )}
            <span>{tr(lang, 'Add to Arko', '一键安装')}</span>
          </button>
        </div>
      )}

      {/* Installed Extensions List */}
      {extensions.length === 0 ? (
        <div
          className={`py-7 px-4 rounded-2xl border text-center space-y-2 ${
            isDark ? 'bg-white/[0.02] border-white/8' : 'bg-zinc-50/80 border-black/6'
          }`}
        >
          <div className="w-10 h-10 rounded-2xl bg-indigo-500/12 text-indigo-500 flex items-center justify-center mx-auto">
            <Puzzle size={19} />
          </div>
          <div className="font-semibold text-[12.5px]">
            {tr(lang, 'No extensions installed in this Space yet', '当前空间暂未安装扩展插件')}
          </div>
          <p className="text-[11px] opacity-60 max-w-xs mx-auto leading-relaxed">
            {tr(
              lang,
              'Import extensions directly from Arc / Chrome, browse the Chrome Web Store, or load an unpacked extension folder.',
              '可从 Arc / Chrome 一键批量迁移插件，或从 Chrome 应用商店与本地解压目录安装。'
            )}
          </p>
        </div>
      ) : (
        <div
          className={`space-y-1.5 ${
            compact ? 'max-h-[290px] overflow-y-auto pr-0.5' : ''
          }`}
        >
          {extensions.map((ext) => (
            <div
              key={ext.id}
              className={`p-2.5 rounded-xl border flex items-center justify-between gap-2.5 transition ${
                ext.enabled
                  ? isDark
                    ? 'bg-white/[0.035] border-white/10 hover:border-white/18'
                    : 'bg-white border-black/8 shadow-2xs hover:border-black/15'
                  : isDark
                    ? 'bg-white/[0.015] border-white/6 opacity-60'
                    : 'bg-zinc-50 border-black/6 opacity-65'
              }`}
            >
              <button
                type="button"
                disabled={!ext.enabled}
                onClick={() => void onOpenPopup(ext.id, anchorPos)}
                title={
                  ext.popupPath
                    ? tr(lang, `Click to open ${ext.name} popup`, `点击打开「${ext.name}」插件弹窗`)
                    : ext.name
                }
                className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer disabled:cursor-default"
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden border ${
                    isDark ? 'bg-white/[0.06] border-white/10' : 'bg-zinc-100 border-black/8'
                  }`}
                >
                  {ext.iconDataUrl ? (
                    <img src={ext.iconDataUrl} alt="" className="w-5 h-5 object-contain" />
                  ) : (
                    <Puzzle size={15} className="text-indigo-500" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-[12px] truncate">{ext.name}</span>
                    <span className="text-[10px] font-mono opacity-45 shrink-0">
                      v{ext.version}
                    </span>
                    {!compact && (
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9.5px] font-mono ${
                          isDark ? 'bg-white/8 text-zinc-300' : 'bg-black/5 text-zinc-600'
                        }`}
                      >
                        MV{ext.manifestVersion}
                      </span>
                    )}
                  </div>
                  {ext.loadError ? (
                    <div className="text-[10.5px] text-amber-500 flex items-center gap-1 truncate mt-0.5">
                      <AlertCircle size={10.5} className="shrink-0" />
                      <span className="truncate">{ext.loadError}</span>
                    </div>
                  ) : (
                    <div className="text-[10.5px] opacity-55 truncate mt-0.5">
                      {ext.description ||
                        (ext.popupPath
                          ? tr(lang, 'Click to open extension popup', '点击可唤出插件交互弹窗')
                          : tr(lang, 'Active on webpages', '已在网页上下文中生效'))}
                    </div>
                  )}
                </div>
              </button>

              <div className="flex items-center gap-1 shrink-0">
                {ext.enabled && ext.popupPath && (
                  <button
                    type="button"
                    onClick={() => void onOpenPopup(ext.id, anchorPos)}
                    title={tr(lang, 'Open Popup', '打开插件弹窗')}
                    className={`p-1.5 rounded-lg transition cursor-pointer ${
                      isDark
                        ? 'hover:bg-white/10 text-indigo-400'
                        : 'hover:bg-indigo-50 text-indigo-600'
                    }`}
                  >
                    <Play size={12} />
                  </button>
                )}

                {ext.enabled && (ext.optionsPath || ext.homepageUrl) && (
                  <button
                    type="button"
                    onClick={() => void onOpenOptions(ext.id)}
                    title={tr(lang, 'Extension Options', '插件选项设置')}
                    className={`p-1.5 rounded-lg opacity-65 hover:opacity-100 transition cursor-pointer ${
                      isDark ? 'hover:bg-white/10' : 'hover:bg-black/6'
                    }`}
                  >
                    <Settings size={12.5} />
                  </button>
                )}

                <input
                  type="checkbox"
                  checked={ext.enabled}
                  onChange={(e) => void onToggleExtension(ext.id, e.target.checked)}
                  title={tr(lang, 'Enable / Disable extension', '启用 / 停用插件')}
                  className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer mx-0.5"
                />

                <button
                  type="button"
                  onClick={() => void onRemoveExtension(ext.id)}
                  title={tr(lang, 'Remove extension', '卸载移除此插件')}
                  className="p-1.5 rounded-lg opacity-50 hover:opacity-100 hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Install by Web Store URL / ID */}
      <form onSubmit={(e) => void handleInstallFromInput(e)} className="flex items-center gap-1.5">
        <input
          value={storeInput}
          onChange={(e) => setStoreInput(e.target.value)}
          placeholder={tr(
            lang,
            'Paste Chrome Web Store URL or 32-char Extension ID…',
            '粘贴 Chrome 应用商店插件链接或 32 位 ID 直接安装…'
          )}
          className={`flex-1 h-8 px-2.5 rounded-xl border text-[11.5px] outline-none ${
            isDark
              ? 'bg-black/30 border-white/10 focus:border-indigo-500/60 placeholder:text-zinc-500'
              : 'bg-zinc-50 border-black/10 focus:border-indigo-500 placeholder:text-zinc-400'
          }`}
        />
        <button
          type="submit"
          disabled={!storeInput.trim() || installingStore}
          className="h-8 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-semibold inline-flex items-center gap-1 shrink-0 cursor-pointer transition"
        >
          {installingStore ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Download size={12} />
          )}
          <span>{tr(lang, 'Install', '安装')}</span>
        </button>
      </form>

      {/* Action Buttons Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={onOpenWebStoreHome}
            className={`h-7 px-2.5 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1.5 transition cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-zinc-200'
                : 'bg-white border-black/10 hover:bg-zinc-100 text-zinc-700'
            }`}
          >
            <Store size={12} className="text-indigo-500" />
            <span>{tr(lang, 'Chrome Web Store', 'Chrome 应用商店')}</span>
            <ExternalLink size={10} className="opacity-55" />
          </button>

          <button
            type="button"
            disabled={installingUnpacked}
            onClick={() => {
              setInstallingUnpacked(true)
              void onInstallUnpacked().finally(() => setInstallingUnpacked(false))
            }}
            className={`h-7 px-2.5 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1.5 transition cursor-pointer ${
              isDark
                ? 'bg-white/[0.04] border-white/10 hover:bg-white/10 text-zinc-200'
                : 'bg-white border-black/10 hover:bg-zinc-100 text-zinc-700'
            }`}
          >
            <FolderOpen size={12} className="text-amber-500" />
            <span>{tr(lang, 'Load Unpacked…', '加载已解压扩展…')}</span>
          </button>
        </div>

        {onOpenBrowserImport && (
          <button
            type="button"
            onClick={onOpenBrowserImport}
            className="text-[11px] font-medium text-indigo-500 hover:underline cursor-pointer"
          >
            {tr(lang, 'Import from Arc / Chrome →', '从 Arc / Chrome 导入 →')}
          </button>
        )}
      </div>
    </div>
  )
}

interface PopoverProps {
  isDark: boolean
  lang?: AppLanguage
  isClosing?: boolean
  spaceName: string
  anchor: { x: number; y: number }
  extensions: InstalledExtensionItem[]
  activeTabUrl?: string
  activeTabTitle?: string
  onOpenPopup: (extId: string, anchor?: { x: number; y: number }) => Promise<void>
  onOpenOptions: (extId: string) => Promise<void>
  onToggleExtension: (extId: string, enabled: boolean) => Promise<void>
  onRemoveExtension: (extId: string) => Promise<void>
  onInstallUnpacked: () => Promise<void>
  onInstallWebStore: (urlOrId: string) => Promise<boolean>
  onOpenWebStoreHome: () => void
  onOpenBrowserImport: () => void
  onOpenFullSettings: () => void
  onClose: () => void
}

export const ExtensionsPopover: React.FC<PopoverProps> = ({
  isDark,
  lang,
  isClosing = false,
  spaceName,
  anchor,
  extensions,
  activeTabUrl,
  activeTabTitle,
  onOpenPopup,
  onOpenOptions,
  onToggleExtension,
  onRemoveExtension,
  onInstallUnpacked,
  onInstallWebStore,
  onOpenWebStoreHome,
  onOpenBrowserImport,
  onOpenFullSettings,
  onClose
}) => {
  const cardWidth = 372
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1280
  const left = Math.max(12, Math.min(winW - cardWidth - 12, anchor.x - cardWidth + 32))
  const top = Math.max(44, anchor.y + 6)

  return (
    <div
      onClick={onClose}
      className={`fixed inset-0 z-50 select-none ${
        isClosing ? 'arc-backdrop-exit' : 'arc-backdrop-enter'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left,
          top,
          width: cardWidth,
          transformOrigin: 'top right'
        }}
        className={`rounded-2xl border p-4 shadow-2xl backdrop-blur-2xl ${
          isClosing ? 'arc-popover-exit' : 'arc-popover-enter'
        } ${
          isDark
            ? 'bg-[#202028]/96 border-white/14 text-zinc-100'
            : 'bg-white/97 border-black/10 text-zinc-900'
        }`}
      >
        <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-black/6 dark:border-white/8">
          <div className="flex items-center gap-2 min-w-0">
            <Puzzle size={15} className="text-violet-500 shrink-0" />
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold truncate">
                {tr(lang, 'Extensions', '扩展插件中心')}
              </div>
              <div className="text-[10.5px] opacity-55 truncate">
                {tr(
                  lang,
                  `Active in "${spaceName}" · ${extensions.filter((e) => e.enabled).length} enabled`,
                  `当前空间「${spaceName}」· 已启用 ${extensions.filter((e) => e.enabled).length} 个`
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                onClose()
                onOpenFullSettings()
              }}
              title={tr(lang, 'Manage all extensions in Settings', '打开完整扩展设置页')}
              className="p-1.5 rounded-lg opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
            >
              <Settings size={13.5} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
            >
              <X size={13.5} />
            </button>
          </div>
        </div>

        <ExtensionsManagerPanel
          isDark={isDark}
          lang={lang}
          compact
          anchorPos={anchor}
          extensions={extensions}
          activeTabUrl={activeTabUrl}
          activeTabTitle={activeTabTitle}
          onOpenPopup={async (extId, pos) => {
            onClose()
            await onOpenPopup(extId, pos)
          }}
          onOpenOptions={async (extId) => {
            onClose()
            await onOpenOptions(extId)
          }}
          onToggleExtension={onToggleExtension}
          onRemoveExtension={onRemoveExtension}
          onInstallUnpacked={onInstallUnpacked}
          onInstallWebStore={onInstallWebStore}
          onOpenWebStoreHome={() => {
            onClose()
            onOpenWebStoreHome()
          }}
          onOpenBrowserImport={() => {
            onClose()
            onOpenBrowserImport()
          }}
        />
      </div>
    </div>
  )
}
