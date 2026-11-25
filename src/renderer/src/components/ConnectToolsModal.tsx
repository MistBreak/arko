import React, { useState } from 'react'
import { Check, Info, Loader2, RefreshCw, X } from 'lucide-react'
import { tr } from '@shared/i18n'
import type {
  AppLanguage,
  ConnectedToolId,
  ConnectedToolItem
} from '@shared/types'

export const ToolBrandIcon: React.FC<{ id: ConnectedToolId; size?: number }> = ({
  id,
  size = 18
}) => {
  switch (id) {
    case 'amplitude':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="10" fill="#1E61F0" />
          <path
            d="M7.2 15.6L10.9 7.5C11.15 6.95 11.95 6.95 12.2 7.5L15.9 15.6M8.7 13.1H14.4"
            stroke="#FFFFFF"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'atlassian':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M8.55 11.45C8.15 10.95 7.4 11 7.1 11.55L4.15 17.45C3.9 17.95 4.25 18.55 4.8 18.55H8.95C9.3 18.55 9.6 18.35 9.75 18.02C10.55 16.15 10.1 13.4 8.55 11.45Z"
            fill="#2684FF"
          />
          <path
            d="M11.65 5.3C10.25 7.55 10.05 10.5 11.2 13.1L13.5 18.12C13.65 18.38 13.92 18.55 14.22 18.55H19.18C19.74 18.55 20.1 17.95 19.84 17.45L12.95 5.3C12.68 4.8 11.95 4.8 11.65 5.3Z"
            fill="#0052CC"
          />
        </svg>
      )
    case 'figma':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M8.5 3H12V9H8.5C6.84 9 5.5 7.66 5.5 6C5.5 4.34 6.84 3 8.5 3Z" fill="#F24E1E" />
          <path d="M12 3H15.5C17.16 3 18.5 4.34 18.5 6C18.5 7.66 17.16 9 15.5 9H12V3Z" fill="#FF7262" />
          <path d="M12 12C12 10.34 13.34 9 15 9H15.5C17.16 9 18.5 10.34 18.5 12C18.5 13.66 17.16 15 15.5 15H15C13.34 15 12 13.66 12 12Z" fill="#1ABCFE" />
          <path d="M8.5 9H12V15H8.5C6.84 15 5.5 13.66 5.5 12C5.5 10.34 6.84 9 8.5 9Z" fill="#A259FF" />
          <path d="M8.5 15H12V18C12 19.66 10.66 21 9 21H8.5C6.84 21 5.5 19.66 5.5 18C5.5 16.34 6.84 15 8.5 15Z" fill="#0ACF83" />
        </svg>
      )
    case 'github':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 2C6.475 2 2 6.588 2 12.253C2 16.785 4.862 20.626 8.838 21.983C9.338 22.078 9.52 21.762 9.52 21.489C9.52 21.246 9.512 20.601 9.507 19.746C6.726 20.365 6.139 18.372 6.139 18.372C5.685 17.189 5.029 16.874 5.029 16.874C4.122 16.238 5.098 16.251 5.098 16.251C6.101 16.323 6.629 17.308 6.629 17.308C7.521 18.875 8.969 18.422 9.54 18.16C9.631 17.497 9.889 17.045 10.175 16.789C7.955 16.53 5.62 15.651 5.62 11.722C5.62 10.602 6.01 9.687 6.649 8.97C6.546 8.711 6.203 7.67 6.747 6.261C6.747 6.261 7.586 5.986 9.497 7.311C10.295 7.084 11.15 6.97 12 6.966C12.85 6.97 13.705 7.084 14.505 7.311C16.414 5.986 17.251 6.261 17.251 6.261C17.797 7.67 17.454 8.711 17.351 8.97C17.992 9.687 18.38 10.602 18.38 11.722C18.38 15.661 16.041 16.527 13.813 16.781C14.172 17.098 14.492 17.726 14.492 18.686C14.492 20.061 14.48 21.17 14.48 21.489C14.48 21.765 14.66 22.085 15.17 21.982C19.14 20.622 22 16.783 22 12.253C22 6.588 17.523 2 12 2Z"
          />
        </svg>
      )
    case 'gmail':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M3 7.2V18C3 19.1 3.9 20 5 20H7V10.4L12 14.15L17 10.4V20H19C20.1 20 21 19.1 21 18V7.2C21 5.65 19.23 4.77 18 5.7L12 10.2L6 5.7C4.77 4.77 3 5.65 3 7.2Z" fill="#EA4335" />
          <path d="M3 7.2V18C3 19.1 3.9 20 5 20H7V10.4L3 7.4V7.2Z" fill="#4285F4" />
          <path d="M21 7.2V18C21 19.1 20.1 20 19 20H17V10.4L21 7.4V7.2Z" fill="#34A853" />
          <path d="M17 10.4V5.95L18 5.2C19.23 4.27 21 5.15 21 6.7V7.4L17 10.4Z" fill="#FBBC04" />
        </svg>
      )
    case 'google-calendar':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3" y="4" width="18" height="17" rx="3.5" fill="#4285F4" />
          <path d="M3 8.5H21V17.5C21 19.43 19.43 21 17.5 21H6.5C4.57 21 3 19.43 3 17.5V8.5Z" fill="#FFFFFF" fillOpacity="0.95" />
          <text
            x="12"
            y="17.2"
            textAnchor="middle"
            fill="#1A73E8"
            fontSize="8.8"
            fontWeight="700"
            fontFamily="-apple-system, BlinkMacSystemFont, Inter, sans-serif"
          >
            31
          </text>
        </svg>
      )
    case 'google-chat':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M5.5 4.5H16.5C18.16 4.5 19.5 5.84 19.5 7.5V14.5C19.5 16.16 18.16 17.5 16.5 17.5H9.2L5.35 20.4C4.85 20.78 4.15 20.42 4.15 19.8V7.5C4.15 5.84 4.75 4.5 5.5 4.5Z"
            fill="#00AC47"
          />
          <circle cx="9.2" cy="11" r="1.25" fill="#FFFFFF" />
          <circle cx="12.2" cy="11" r="1.25" fill="#FFFFFF" />
          <circle cx="15.2" cy="11" r="1.25" fill="#FFFFFF" />
        </svg>
      )
    case 'google-drive':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M9.15 3.8H14.85L21.3 15H15.6L9.15 3.8Z" fill="#FBBC04" />
          <path d="M2.7 15L9.15 3.8L12 8.75L5.55 19.95L2.7 15Z" fill="#0F9D58" />
          <path d="M5.55 19.95L8.4 15H21.3L18.45 19.95H5.55Z" fill="#4285F4" />
        </svg>
      )
    case 'granola':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#C7D96B" />
          <path
            d="M15.4 9.5C14.6 8.2 13.1 7.5 11.4 7.6C8.8 7.8 7 9.9 7.2 12.5C7.4 15.1 9.6 16.8 12.2 16.6C14.5 16.4 16.1 14.8 16.2 12.6H12.1"
            stroke="#1F2B12"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'linear':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9.5" fill="#5E6AD2" />
          <path
            d="M5.6 14.2L9.8 18.4M4.8 10.6L13.4 19.2M6.8 7.2L16.8 17.2"
            stroke="#FFFFFF"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'notion':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="4" fill="#FFFFFF" stroke="#27272A" strokeWidth="1.5" />
          <path
            d="M8.2 16.5V7.6H9.9L14.3 13.8V7.6H15.8V16.5H14.2L9.7 10.1V16.5H8.2Z"
            fill="#18181B"
          />
        </svg>
      )
    case 'slack':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="13" y="3" width="3.4" height="8" rx="1.7" fill="#2EB67D" />
          <circle cx="18.4" cy="9.3" r="1.7" fill="#2EB67D" />
          <rect x="13" y="13" width="8" height="3.4" rx="1.7" fill="#ECB22E" />
          <circle cx="14.7" cy="18.4" r="1.7" fill="#ECB22E" />
          <rect x="7.6" y="13" width="3.4" height="8" rx="1.7" fill="#E01E5A" />
          <circle cx="5.6" cy="14.7" r="1.7" fill="#E01E5A" />
          <rect x="3" y="7.6" width="8" height="3.4" rx="1.7" fill="#36C5F0" />
          <circle cx="9.3" cy="5.6" r="1.7" fill="#36C5F0" />
        </svg>
      )
  }
}

interface ConnectToolsPanelProps {
  isDark: boolean
  lang?: AppLanguage
  tools: ConnectedToolItem[]
  autoConnectEnabled: boolean
  compact?: boolean
  onConnectTool: (toolId: ConnectedToolId) => Promise<void>
  onDisconnectTool: (toolId: ConnectedToolId) => Promise<void>
  onToggleAutoConnect: (enabled: boolean) => Promise<void>
  onRefresh?: () => Promise<void>
}

export const ConnectToolsListPanel: React.FC<ConnectToolsPanelProps> = ({
  isDark,
  lang,
  tools,
  autoConnectEnabled,
  compact = false,
  onConnectTool,
  onDisconnectTool,
  onToggleAutoConnect,
  onRefresh
}) => {
  const [busyId, setBusyId] = useState<ConnectedToolId | null>(null)
  const [hoveredConnectedId, setHoveredConnectedId] = useState<ConnectedToolId | null>(null)
  const [showInfoTip, setShowInfoTip] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const handleAction = async (tool: ConnectedToolItem): Promise<void> => {
    setBusyId(tool.id)
    try {
      if (tool.status === 'disconnected') {
        await onConnectTool(tool.id)
      } else {
        await onDisconnectTool(tool.id)
      }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="w-full">
      {/* Divided Rows matching Dia's Connect your Tools list */}
      <div
        className={`divide-y ${
          isDark ? 'divide-white/[0.06] border-y border-white/[0.06]' : 'divide-black/[0.06] border-y border-black/[0.06]'
        }`}
      >
        {tools.map((tool) => {
          const isConnected = tool.status !== 'disconnected'
          const isAuto = tool.status === 'auto-connected'
          const isBusy = busyId === tool.id
          const isHovered = hoveredConnectedId === tool.id

          return (
            <div
              key={tool.id}
              className={`flex items-center justify-between gap-3 ${
                compact ? 'py-2.5 px-1' : 'py-3 px-1'
              } transition-colors`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-6 h-6 flex items-center justify-center shrink-0">
                  <ToolBrandIcon id={tool.id} size={19} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium tracking-[-0.01em] truncate">
                      {tool.name}
                    </span>
                    {tool.accountHint && (
                      <span className="text-[11px] opacity-45 font-mono truncate">
                        {tool.accountHint}
                      </span>
                    )}
                  </div>
                  {compact && (
                    <div className="text-[11.5px] opacity-50 truncate">
                      {tr(lang, tool.description, tool.descriptionZh)}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                disabled={isBusy}
                onMouseEnter={() => setHoveredConnectedId(tool.id)}
                onMouseLeave={() => setHoveredConnectedId(null)}
                onClick={() => void handleAction(tool)}
                title={
                  isConnected
                    ? tr(
                        lang,
                        `Click to disconnect ${tool.name} from AI context`,
                        `点击断开 ${tool.name} 的 AI 上下文访问`
                      )
                    : tool.isLoggedIn
                      ? tr(lang, `Enable ${tool.name}`, `立即启用 ${tool.name}`)
                      : tr(
                          lang,
                          `Open ${tool.name} sign-in tab to connect`,
                          `打开 ${tool.name} 登录页进行连接`
                        )
                }
                className={`h-[30px] px-3.5 rounded-[8px] text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5 shrink-0 transition ${
                  isConnected
                    ? isHovered
                      ? isDark
                        ? 'bg-rose-500/16 text-rose-300 border border-rose-500/30'
                        : 'bg-rose-50 text-rose-600 border border-rose-200'
                      : isDark
                        ? 'bg-white/[0.08] text-zinc-300/90 border border-white/[0.04]'
                        : 'bg-zinc-200/75 text-zinc-700 border border-black/[0.04]'
                    : isDark
                      ? 'bg-[#F4F4F5] text-[#18181B] hover:bg-white shadow-2xs'
                      : 'bg-[#18181B] text-white hover:bg-zinc-800 shadow-2xs'
                }`}
              >
                {isBusy ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : isConnected ? (
                  isHovered ? (
                    <span>{tr(lang, 'Disconnect', '断开连接')}</span>
                  ) : (
                    <>
                      <Check size={13} className="opacity-75" strokeWidth={2.3} />
                      <span>
                        {isAuto
                          ? tr(lang, 'Auto-Connected', '已自动连接')
                          : tr(lang, 'Connected', '已连接')}
                      </span>
                    </>
                  )
                ) : (
                  <span>{tr(lang, 'Connect', '连接')}</span>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* Checkbox & Trust Footnote matching Dia screenshot */}
      <div className="pt-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoConnectEnabled}
              onChange={(e) => void onToggleAutoConnect(e.target.checked)}
              className="w-4 h-4 rounded accent-[#3B82F6] cursor-pointer"
            />
            <span className="text-[13px] font-medium opacity-90">
              {tr(
                lang,
                'Automatically connect my logged-in apps',
                '自动连接我在浏览器中已登录的应用'
              )}
            </span>
          </label>

          {onRefresh && (
            <button
              type="button"
              onClick={async () => {
                setRefreshing(true)
                try {
                  await onRefresh()
                } finally {
                  setRefreshing(false)
                }
              }}
              className="text-[11.5px] opacity-50 hover:opacity-95 inline-flex items-center gap-1 transition"
              title={tr(lang, 'Re-scan browser login sessions', '重新扫描当前空间已登录会话')}
            >
              <RefreshCw size={11.5} className={refreshing ? 'animate-spin' : ''} />
              <span>{tr(lang, 'Refresh', '刷新状态')}</span>
            </button>
          )}
        </div>

        <p className="text-[12px] leading-[1.55] opacity-45">
          {tr(
            lang,
            'Please only connect accounts you fully trust. Arko can access what you see and work with connected apps on your behalf.',
            '请仅连接你完全信任的账号。连接后，Arko 可在你授权下读取页面上下文并协助操作这些应用。'
          )}{' '}
          <button
            type="button"
            onClick={() => setShowInfoTip((v) => !v)}
            className="inline-flex items-center align-middle opacity-80 hover:opacity-100"
            title={tr(lang, 'How zero-setup connection works', '了解零配置本地会话连接机制')}
          >
            <Info size={12.5} />
          </button>
        </p>

        {showInfoTip && (
          <div
            className={`p-3 rounded-xl border text-[11.5px] leading-relaxed ${
              isDark
                ? 'bg-white/[0.04] border-white/10 text-zinc-300'
                : 'bg-zinc-100/80 border-black/8 text-zinc-700'
            }`}
          >
            {tr(
              lang,
              'Zero OAuth keys or cloud relays required: Arko detects active login cookies strictly inside your current local Chromium Space and reads context on-device when you @mention a tool or use Agent mode.',
              '无需申请第三方 OAuth 权限或上传云端凭证：Arko 仅在本地检测当前隔离空间的浏览器登录态，并在你 @提及该工具或开启 Agent 时复用本地会话读取上下文。'
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface ModalProps {
  isDark: boolean
  lang?: AppLanguage
  spaceName?: string
  tools: ConnectedToolItem[]
  autoConnectEnabled: boolean
  onConnectTool: (toolId: ConnectedToolId) => Promise<void>
  onDisconnectTool: (toolId: ConnectedToolId) => Promise<void>
  onToggleAutoConnect: (enabled: boolean) => Promise<void>
  onRefresh: () => Promise<void>
  isClosing?: boolean
  onClose: () => void
}

export const ConnectToolsModal: React.FC<ModalProps> = ({
  isDark,
  lang,
  spaceName,
  tools,
  autoConnectEnabled,
  onConnectTool,
  onDisconnectTool,
  onToggleAutoConnect,
  onRefresh,
  isClosing = false,
  onClose
}) => {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-md p-4 select-none ${
        isClosing ? 'arc-backdrop-exit' : 'arc-backdrop-enter'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-[600px] max-h-[90vh] rounded-[28px] border shadow-2xl flex flex-col overflow-hidden ${
          isClosing ? 'arc-modal-exit' : 'arc-modal-enter'
        } ${
          isDark
            ? 'bg-[#1D1D1F] border-white/[0.09] text-zinc-100'
            : 'bg-[#FAFAFA] border-black/[0.09] text-zinc-900'
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          title={tr(lang, 'Close', '关闭')}
          className="absolute top-4 right-4 z-10 p-1.5 rounded-full opacity-45 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition"
        >
          <X size={16} />
        </button>

        {/* Scrollable Dia-Style Center Column */}
        <div className="flex-1 overflow-y-auto px-8 sm:px-12 pt-8 pb-6">
          {/* Top Brushed Orb Emblem + Header */}
          <div className="flex flex-col items-center text-center mb-6">
            <div
              className={`w-13 h-13 rounded-full mb-4 relative overflow-hidden border shadow-inner ${
                isDark
                  ? 'border-white/15 bg-gradient-to-b from-zinc-500/45 via-zinc-600/35 to-zinc-800/60'
                  : 'border-black/10 bg-gradient-to-b from-zinc-200 via-zinc-300/80 to-zinc-400/60'
              }`}
            >
              <div
                className="absolute inset-0 opacity-35"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(176deg, rgba(255,255,255,0.28) 0px, rgba(255,255,255,0.04) 2px, transparent 4px)'
                }}
              />
              <div
                className={`absolute -bottom-3 left-1/2 -translate-x-1/2 w-10 h-4 rounded-full ${
                  isDark ? 'bg-[#1D1D1F]' : 'bg-[#FAFAFA]'
                }`}
              />
            </div>

            <h2 className="text-[21px] font-semibold tracking-[-0.02em]">
              {tr(lang, 'Connect your Tools', '连接你的常用工具')}
            </h2>
            <p className="text-[13px] opacity-50 mt-1">
              {tr(
                lang,
                'Only in Arko: all your context, zero setup time.',
                'Arko 独享：复用浏览器已登录上下文，零配置即刻就绪。'
              )}
              {spaceName ? ` · ${spaceName}` : ''}
            </p>
          </div>

          <ConnectToolsListPanel
            isDark={isDark}
            lang={lang}
            tools={tools}
            autoConnectEnabled={autoConnectEnabled}
            onConnectTool={onConnectTool}
            onDisconnectTool={onDisconnectTool}
            onToggleAutoConnect={onToggleAutoConnect}
            onRefresh={onRefresh}
          />
        </div>

        {/* Bottom Primary Pill Button ("Get Started") */}
        <div
          className={`px-8 py-4 border-t flex items-center justify-center shrink-0 ${
            isDark ? 'border-white/[0.06] bg-[#1D1D1F]' : 'border-black/[0.06] bg-[#FAFAFA]'
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            className={`h-10 px-7 rounded-xl text-[13.5px] font-semibold transition shadow-sm ${
              isDark
                ? 'bg-[#F4F4F5] text-[#18181B] hover:bg-white'
                : 'bg-[#18181B] text-white hover:bg-zinc-800'
            }`}
          >
            {tr(lang, 'Get Started', '开始使用')}
          </button>
        </div>
      </div>
    </div>
  )
}
