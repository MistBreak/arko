import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, Eraser, Palette, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { PROFILE_ACCENT_PRESETS } from '@shared/constants'
import { tr } from '@shared/i18n'
import { getArcSpaceTheme, pickNextDistinctSpaceColor } from '@shared/space-theme'
import type { AppLanguage, BrowserProfile } from '@shared/types'

export interface SpacePopoverRequest {
  mode: 'menu' | 'edit' | 'create'
  profileId?: string
  anchor: {
    x: number
    y: number
    placement?: 'bottom-left' | 'top-left' | 'top-center' | 'right-top'
  }
}

interface Props {
  platform?: 'darwin' | 'win32' | 'linux'
  isDark: boolean
  lang?: AppLanguage
  isClosing?: boolean
  request: SpacePopoverRequest
  profiles: BrowserProfile[]
  activeProfileId: string
  unpinnedCount?: number
  onSwitchProfile: (profileId: string) => void
  onUpdateProfile: (
    profileId: string,
    partial: Partial<Pick<BrowserProfile, 'name' | 'emoji' | 'accentColor'>>
  ) => void
  onCreateProfile: (name: string, emoji: string, accentColor: string) => void
  onDeleteProfile: (profileId: string) => void
  onClearUnpinnedTabs?: (profileId: string) => void
  onClose: () => void
}

const SPACE_ICONS = [
  '💼',
  '🌿',
  '🚀',
  '🎨',
  '🔬',
  '📚',
  '🎮',
  '⚡',
  '🏠',
  '🧠',
  '🎵',
  '📈',
  '🛠️',
  '🌍',
  '☕',
  '✨'
]

export const SpaceEditorPopover: React.FC<Props> = ({
  platform = 'darwin',
  isDark,
  lang,
  isClosing = false,
  request,
  profiles,
  activeProfileId,
  unpinnedCount = 0,
  onSwitchProfile,
  onUpdateProfile,
  onCreateProfile,
  onDeleteProfile,
  onClearUnpinnedTabs,
  onClose
}) => {
  const [mode, setMode] = useState<'menu' | 'edit' | 'create'>(request.mode)
  const [cameFromMenu, setCameFromMenu] = useState(request.mode === 'menu')
  const [targetId, setTargetId] = useState<string>(
    request.profileId || activeProfileId || profiles[0]?.id || ''
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showIconsSection, setShowIconsSection] = useState(false)

  const targetProfile = useMemo(
    () => profiles.find((p) => p.id === targetId) || profiles[0],
    [profiles, targetId]
  )

  const [draftName, setDraftName] = useState(
    request.mode === 'create' ? '' : targetProfile?.name || ''
  )
  const [draftEmoji, setDraftEmoji] = useState(
    request.mode === 'create' ? '✨' : targetProfile?.emoji || '✨'
  )
  const [draftAccent, setDraftAccent] = useState(
    request.mode === 'create'
      ? pickNextDistinctSpaceColor(profiles.map((p) => p.accentColor))
      : targetProfile?.accentColor || '#0284C7'
  )

  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setMode(request.mode)
    setCameFromMenu(request.mode === 'menu')
    setConfirmDelete(false)
    if (request.mode === 'create') {
      setDraftName('')
      setDraftEmoji('✨')
      setDraftAccent(pickNextDistinctSpaceColor(profiles.map((p) => p.accentColor)))
      window.setTimeout(() => nameInputRef.current?.focus(), 30)
    } else {
      const resolved =
        profiles.find((p) => p.id === (request.profileId || activeProfileId)) || profiles[0]
      if (resolved) {
        setTargetId(resolved.id)
        setDraftName(resolved.name)
        setDraftEmoji(resolved.emoji)
        setDraftAccent(resolved.accentColor || '#0284C7')
      }
    }
  }, [request, profiles, activeProfileId])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (mode !== 'menu' && cameFromMenu) {
          setMode('menu')
          setConfirmDelete(false)
        } else {
          onClose()
        }
        return
      }
      if (mode === 'menu' && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const picked = profiles[Number(e.key) - 1]
        if (picked) {
          e.preventDefault()
          if (picked.id !== activeProfileId) {
            onSwitchProfile(picked.id)
          }
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, cameFromMenu, profiles, activeProfileId, onSwitchProfile, onClose])

  const switchToCreateMode = (fromMenu = false): void => {
    if (fromMenu) setCameFromMenu(true)
    setMode('create')
    setConfirmDelete(false)
    setDraftName('')
    setDraftEmoji('✨')
    setDraftAccent(pickNextDistinctSpaceColor(profiles.map((p) => p.accentColor)))
    window.setTimeout(() => nameInputRef.current?.focus(), 20)
  }

  const selectEditSpace = (p: BrowserProfile, fromMenu = false): void => {
    if (fromMenu) setCameFromMenu(true)
    setMode('edit')
    setConfirmDelete(false)
    setTargetId(p.id)
    setDraftName(p.name)
    setDraftEmoji(p.emoji)
    setDraftAccent(p.accentColor || '#0284C7')
    if (p.id !== activeProfileId) {
      onSwitchProfile(p.id)
    }
  }

  const commitNameIfChanged = (val: string): void => {
    if (mode !== 'edit' || !targetProfile) return
    const trimmed = val.trim()
    if (trimmed && trimmed !== targetProfile.name) {
      onUpdateProfile(targetProfile.id, { name: trimmed })
    } else if (!trimmed) {
      setDraftName(targetProfile.name)
    }
  }

  const handlePickColor = (hex: string): void => {
    setDraftAccent(hex)
    if (mode === 'edit' && targetProfile) {
      onUpdateProfile(targetProfile.id, { accentColor: hex })
    }
  }

  const handlePickEmoji = (emo: string): void => {
    const cleaned = emo.trim() || '✨'
    setDraftEmoji(cleaned)
    if (mode === 'edit' && targetProfile) {
      onUpdateProfile(targetProfile.id, { emoji: cleaned })
    }
  }

  const handleCreateSubmit = (e?: React.FormEvent): void => {
    e?.preventDefault()
    const finalName = draftName.trim() || tr(lang, 'New Profile', '新个人资料')
    onCreateProfile(finalName, draftEmoji.trim() || '✨', draftAccent)
    onClose()
  }

  const activeAccent = mode === 'create' ? draftAccent : targetProfile?.accentColor || draftAccent
  const spaceTheme = useMemo(
    () => getArcSpaceTheme(activeAccent, isDark),
    [activeAccent, isDark]
  )

  const isMenuMode = mode === 'menu'
  const cardWidth = isMenuMode ? 214 : 288
  const estimatedHeight = isMenuMode
    ? Math.min(340, profiles.length * 30 + 82)
    : showIconsSection
      ? 352
      : 266
  const placement = request.anchor.placement || 'bottom-left'

  const posStyle = useMemo<React.CSSProperties>(() => {
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1280
    const winH = typeof window !== 'undefined' ? window.innerHeight : 800

    let left = request.anchor.x
    let top = request.anchor.y
    let origin = 'top left'

    if (placement === 'top-left') {
      top = Math.max(10, request.anchor.y - estimatedHeight - 8)
      origin = 'bottom left'
    } else if (placement === 'top-center') {
      left = request.anchor.x - cardWidth / 2
      top = Math.max(10, request.anchor.y - estimatedHeight - 8)
      origin = 'bottom center'
    } else if (placement === 'right-top') {
      left = request.anchor.x + 8
      top = request.anchor.y - 6
      origin = 'top left'
    }

    left = Math.max(10, Math.min(winW - cardWidth - 12, left))
    top = Math.max(10, Math.min(winH - estimatedHeight - 12, top))

    return {
      position: 'fixed',
      left,
      top,
      width: cardWidth,
      transformOrigin: origin
    }
  }, [request.anchor.x, request.anchor.y, placement, cardWidth, estimatedHeight])

  const enterClass = isClosing
    ? 'arc-popover-exit'
    : placement === 'top-left' || placement === 'top-center'
      ? 'arc-popover-up-enter'
      : 'arc-popover-enter'

  // ==================== Dia-Authentic Compact Top-Left Profile Menu ====================
  if (isMenuMode) {
    return (
      <div
        onClick={onClose}
        className={`fixed inset-0 z-50 ${isClosing ? 'arc-backdrop-exit' : 'arc-backdrop-enter'}`}
      >
        <div
          style={{
            ...posStyle,
            background: isDark
              ? 'linear-gradient(180deg, rgba(46, 46, 51, 0.88) 0%, rgba(33, 33, 38, 0.91) 100%)'
              : 'linear-gradient(180deg, rgba(255, 255, 255, 0.93) 0%, rgba(246, 246, 249, 0.95) 100%)',
            borderColor: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)',
            boxShadow: isDark
              ? '0 20px 44px -8px rgba(0, 0, 0, 0.65), 0 0 0 0.5px rgba(0, 0, 0, 0.55), inset 0 0.5px 0 rgba(255, 255, 255, 0.14)'
              : '0 18px 40px -8px rgba(15, 23, 42, 0.18), inset 0 0.5px 0 rgba(255, 255, 255, 0.9)'
          }}
          onClick={(e) => e.stopPropagation()}
          className={`rounded-[13px] border backdrop-blur-2xl backdrop-saturate-150 p-1.5 select-none ${enterClass} ${
            isDark ? 'text-zinc-100' : 'text-zinc-900'
          }`}
        >
          {/* Profile Rows: [✓] [●] [Name] ... [⌃1] */}
          <div className="space-y-0.5 max-h-[224px] overflow-y-auto no-scrollbar">
            {profiles.map((p, idx) => {
              const isCurrent = p.id === activeProfileId
              const shortcutHint =
                idx < 9 ? (platform === 'darwin' ? `⌃${idx + 1}` : `Alt+${idx + 1}`) : ''

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (!isCurrent) {
                      onSwitchProfile(p.id)
                    }
                    onClose()
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    selectEditSpace(p, true)
                  }}
                  className={`w-full h-[29px] px-2 rounded-[8px] flex items-center gap-2 text-[13px] transition-colors cursor-default ${
                    isDark
                      ? 'text-zinc-100 hover:bg-white/[0.10] active:bg-white/[0.15]'
                      : 'text-zinc-900 hover:bg-black/[0.06] active:bg-black/[0.10]'
                  }`}
                >
                  <span className="w-[14px] shrink-0 flex items-center justify-center">
                    {isCurrent && (
                      <Check
                        size={13}
                        strokeWidth={2.5}
                        className={isDark ? 'text-white' : 'text-zinc-900'}
                      />
                    )}
                  </span>

                  <span
                    style={{
                      backgroundColor: p.accentColor || '#52525B',
                      boxShadow: isDark
                        ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.28)'
                        : 'inset 0 0 0 1px rgba(0, 0, 0, 0.14)'
                    }}
                    className="w-[11px] h-[11px] rounded-full shrink-0"
                  />

                  <span className="flex-1 min-w-0 truncate text-left tracking-[-0.01em] font-normal">
                    {p.name}
                  </span>

                  {p.profileLabel && p.profileLabel.toLowerCase() !== p.name.trim().toLowerCase() && (
                    <span
                      className={`shrink-0 px-1.5 py-0.2 rounded text-[10px] max-w-[68px] truncate ${
                        isDark ? 'bg-white/[0.08] text-zinc-300' : 'bg-black/[0.05] text-zinc-600'
                      }`}
                    >
                      {p.profileLabel}
                    </span>
                  )}

                  {shortcutHint && (
                    <span
                      className={`shrink-0 text-[12px] tabular-nums tracking-tight pl-2 ${
                        isDark ? 'text-zinc-400/75' : 'text-zinc-400'
                      }`}
                    >
                      {shortcutHint}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* New Profile... (aligned directly under color dots at 30px) */}
          <button
            type="button"
            onClick={() => switchToCreateMode(true)}
            className={`mt-0.5 w-full h-[29px] pl-[30px] pr-2.5 rounded-[8px] flex items-center text-[13px] tracking-[-0.01em] transition-colors cursor-default ${
              isDark
                ? 'text-zinc-100 hover:bg-white/[0.10] active:bg-white/[0.15]'
                : 'text-zinc-900 hover:bg-black/[0.06] active:bg-black/[0.10]'
            }`}
          >
            <span className="truncate">{tr(lang, 'New Profile...', '新建个人资料...')}</span>
          </button>

          {/* Aligned Hairline Separator */}
          <div
            className={`my-1 ml-[30px] mr-2 border-t ${
              isDark ? 'border-white/[0.11]' : 'border-black/[0.08]'
            }`}
          />

          {/* Profile Settings (aligned directly under New Profile...) */}
          <button
            type="button"
            onClick={() => {
              const cur = profiles.find((p) => p.id === activeProfileId) || profiles[0]
              if (cur) selectEditSpace(cur, true)
            }}
            className={`w-full h-[29px] pl-[30px] pr-2.5 rounded-[8px] flex items-center text-[13px] tracking-[-0.01em] transition-colors cursor-default ${
              isDark
                ? 'text-zinc-100 hover:bg-white/[0.10] active:bg-white/[0.15]'
                : 'text-zinc-900 hover:bg-black/[0.06] active:bg-black/[0.10]'
            }`}
          >
            <span className="truncate">{tr(lang, 'Profile Settings', '个人资料设置')}</span>
          </button>
        </div>
      </div>
    )
  }

  // ==================== Profile Settings & New Profile Editor View ====================
  return (
    <div
      onClick={onClose}
      className={`fixed inset-0 z-50 ${isClosing ? 'arc-backdrop-exit' : 'arc-backdrop-enter'}`}
    >
      <div
        style={{
          ...posStyle,
          background: isDark
            ? `radial-gradient(120% 80% at 0% 0%, rgba(${spaceTheme.rgbString}, 0.16) 0%, rgba(33, 33, 38, 0.94) 68%), rgba(30, 30, 35, 0.95)`
            : `radial-gradient(120% 80% at 0% 0%, rgba(${spaceTheme.rgbString}, 0.12) 0%, rgba(255, 255, 255, 0.96) 68%), rgba(250, 250, 252, 0.97)`,
          borderColor: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)',
          boxShadow: isDark
            ? '0 22px 50px -10px rgba(0, 0, 0, 0.68), inset 0 0.5px 0 rgba(255, 255, 255, 0.12)'
            : '0 20px 46px -10px rgba(15, 23, 42, 0.20), inset 0 0.5px 0 rgba(255, 255, 255, 0.9)'
        }}
        onClick={(e) => e.stopPropagation()}
        className={`rounded-[15px] border backdrop-blur-2xl backdrop-saturate-150 p-3.5 text-xs select-none transition-[background,border-color] duration-300 ${enterClass} ${
          isDark ? 'text-zinc-100' : 'text-zinc-900'
        }`}
      >
        {/* Top Bar: Optional Back to Menu + Color-Dot Profile Pills + Close */}
        <div className="flex items-center justify-between gap-1.5 mb-2.5">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0 py-0.5">
            {cameFromMenu && (
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false)
                  setMode('menu')
                }}
                title={tr(lang, 'Back to Profile Menu', '返回资料菜单')}
                className={`arc-pressable h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${
                  isDark
                    ? 'opacity-65 hover:opacity-100 hover:bg-white/[0.10]'
                    : 'opacity-65 hover:opacity-100 hover:bg-black/[0.06]'
                }`}
              >
                <ArrowLeft size={12.5} />
              </button>
            )}

            {profiles.map((p) => {
              const isSel = mode === 'edit' && p.id === targetProfile?.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectEditSpace(p)}
                  title={p.name}
                  className={`arc-pressable h-6 px-2 rounded-full flex items-center gap-1.5 text-[11px] shrink-0 ${
                    isSel
                      ? isDark
                        ? 'bg-white/[0.13] text-white font-medium ring-1 ring-white/15'
                        : 'bg-black/[0.07] text-zinc-900 font-medium ring-1 ring-black/10'
                      : isDark
                        ? 'opacity-55 hover:opacity-100 hover:bg-white/[0.08]'
                        : 'opacity-60 hover:opacity-100 hover:bg-black/[0.05]'
                  }`}
                >
                  <span
                    style={{
                      backgroundColor: p.accentColor || '#52525B',
                      boxShadow: isDark
                        ? 'inset 0 0 0 1px rgba(255,255,255,0.28)'
                        : 'inset 0 0 0 1px rgba(0,0,0,0.14)'
                    }}
                    className="w-2 h-2 rounded-full shrink-0"
                  />
                  <span className="max-w-[64px] truncate">{p.name}</span>
                </button>
              )
            })}

            <button
              type="button"
              onClick={() => switchToCreateMode()}
              title={tr(lang, 'New Profile', '新建个人资料')}
              className={`arc-pressable h-6 px-2 rounded-full flex items-center gap-1 text-[11px] shrink-0 ${
                mode === 'create'
                  ? isDark
                    ? 'bg-white/15 text-white font-semibold'
                    : 'bg-zinc-900 text-white font-semibold'
                  : isDark
                    ? 'opacity-55 hover:opacity-100 hover:bg-white/[0.08]'
                    : 'opacity-60 hover:opacity-100 hover:bg-black/[0.05]'
              }`}
            >
              <Plus size={11} />
              {mode === 'create' && <span>{tr(lang, 'New', '新建')}</span>}
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full opacity-45 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition shrink-0"
          >
            <X size={13} />
          </button>
        </div>

        {/* Profile Color Dot / Icon Badge + Name Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (mode === 'create') {
              handleCreateSubmit()
            } else {
              commitNameIfChanged(draftName)
              nameInputRef.current?.blur()
            }
          }}
          className="flex items-center gap-2 mb-3"
        >
          <button
            type="button"
            onClick={() => setShowIconsSection((v) => !v)}
            title={tr(lang, 'Toggle custom icon', '切换空间小图标')}
            className={`arc-pressable w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
              isDark
                ? 'bg-white/[0.06] border-white/12 hover:bg-white/[0.11]'
                : 'bg-black/[0.03] border-black/10 hover:bg-black/[0.06]'
            }`}
          >
            <span
              style={{
                backgroundColor: activeAccent,
                boxShadow: isDark
                  ? 'inset 0 0 0 1.5px rgba(255,255,255,0.28)'
                  : 'inset 0 0 0 1px rgba(0,0,0,0.15)'
              }}
              className="w-3.5 h-3.5 rounded-full"
            />
          </button>

          <div className="relative flex-1 min-w-0">
            <input
              ref={nameInputRef}
              value={draftName}
              onChange={(e) => {
                setDraftName(e.target.value)
                if (mode === 'edit' && targetProfile && e.target.value.trim()) {
                  onUpdateProfile(targetProfile.id, { name: e.target.value.trim() })
                }
              }}
              onBlur={() => commitNameIfChanged(draftName)}
              placeholder={
                mode === 'create'
                  ? tr(lang, 'Profile name (e.g. Personal, Work)…', '输入资料名称（如：Personal、Work）…')
                  : tr(lang, 'Profile name…', '资料名称…')
              }
              className={`w-full h-9 px-3 rounded-xl border text-[13px] font-medium outline-none transition ${
                isDark
                  ? 'bg-black/30 border-white/10 focus:border-white/25 placeholder:text-zinc-500'
                  : 'bg-white/85 border-black/10 focus:border-black/25 placeholder:text-zinc-400'
              }`}
            />
          </div>
        </form>

        {/* Dia Profile Color Swatches */}
        <div className="space-y-2 mb-2.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider opacity-50 flex items-center gap-1">
              <Palette size={10.5} />
              <span>{tr(lang, 'Profile Color', '标识圆点与氛围色')}</span>
            </span>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setShowIconsSection((v) => !v)}
                className="inline-flex items-center gap-1 text-[10.5px] font-medium opacity-55 hover:opacity-100 transition"
              >
                <Sparkles size={10} />
                <span>{tr(lang, 'Icon', '图标')}</span>
              </button>

              <label
                title={tr(lang, 'Custom color wheel', '自定义任意颜色')}
                className="inline-flex items-center gap-1 text-[10.5px] font-medium opacity-65 hover:opacity-100 cursor-pointer transition"
              >
                <span>{tr(lang, 'Custom', '调色盘')}</span>
                <span
                  className="relative w-3.5 h-3.5 rounded-full overflow-hidden ring-1 ring-black/15 dark:ring-white/20 shrink-0"
                  style={{
                    background:
                      'conic-gradient(from 90deg, #F43F5E, #F59E0B, #10B981, #0EA5E9, #6366F1, #D946EF, #F43F5E)'
                  }}
                >
                  <input
                    type="color"
                    value={spaceTheme.accentHex}
                    onChange={(e) => handlePickColor(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                </span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-2 py-0.5">
            {PROFILE_ACCENT_PRESETS.map((preset) => {
              const isSelected = activeAccent.toLowerCase() === preset.hex.toLowerCase()
              return (
                <button
                  key={preset.hex}
                  type="button"
                  onClick={() => handlePickColor(preset.hex)}
                  title={lang === 'zh-CN' ? preset.label : preset.labelEn}
                  style={{
                    background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.36) 0%, transparent 55%), ${preset.hex}`,
                    boxShadow: isSelected
                      ? `0 0 0 2px ${isDark ? '#1F1F24' : '#FFFFFF'}, 0 0 0 3.5px ${preset.hex}`
                      : 'inset 0 0 0 1px rgba(255,255,255,0.22)'
                  }}
                  className={`arc-fav-pressable h-6 rounded-full flex items-center justify-center ${
                    isSelected ? 'scale-105' : 'opacity-85 hover:opacity-100'
                  }`}
                >
                  {isSelected && (
                    <Check size={11.5} strokeWidth={2.8} className="text-white drop-shadow-xs" />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Optional Collapsible Icon Grid */}
        {showIconsSection && (
          <div className="space-y-1.5 mb-2.5 pt-1">
            <div className="grid grid-cols-8 gap-1">
              {SPACE_ICONS.map((emo) => {
                const active = draftEmoji === emo
                return (
                  <button
                    key={emo}
                    type="button"
                    onClick={() => handlePickEmoji(emo)}
                    className={`arc-fav-pressable h-7 rounded-lg text-[13px] flex items-center justify-center ${
                      active
                        ? isDark
                          ? 'bg-white/16 ring-1 ring-white/25'
                          : 'bg-black/8 ring-1 ring-black/15'
                        : isDark
                          ? 'hover:bg-white/8'
                          : 'hover:bg-black/5'
                    }`}
                  >
                    {emo}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div
          className={`pt-2.5 border-t flex items-center justify-between gap-2 ${
            isDark ? 'border-white/8' : 'border-black/6'
          }`}
        >
          {mode === 'create' ? (
            <>
              <span className="text-[10.5px] opacity-45 truncate">
                {tr(lang, 'Isolated cookies & logins', '独立 Cookie 与登录态')}
              </span>
              <button
                type="button"
                onClick={() => handleCreateSubmit()}
                className={`arc-pressable h-7 px-3.5 rounded-lg font-medium text-[11.5px] shrink-0 ${
                  isDark
                    ? 'bg-white text-zinc-900 hover:bg-zinc-100'
                    : 'bg-zinc-900 text-white hover:bg-zinc-800'
                }`}
              >
                {tr(lang, 'Create Profile', '创建资料')}
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1">
                {onClearUnpinnedTabs && targetProfile && unpinnedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      onClearUnpinnedTabs(targetProfile.id)
                      onClose()
                    }}
                    className={`arc-pressable h-7 px-2 rounded-lg inline-flex items-center gap-1 text-[11px] font-medium ${
                      isDark
                        ? 'text-zinc-300 hover:bg-white/8'
                        : 'text-zinc-600 hover:bg-black/5'
                    }`}
                  >
                    <Eraser size={11.5} className="opacity-70" />
                    <span>{tr(lang, 'Clear Tabs', '清理临时页')}</span>
                  </button>
                )}
              </div>

              {targetProfile && profiles.length > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!confirmDelete) {
                      setConfirmDelete(true)
                      return
                    }
                    onDeleteProfile(targetProfile.id)
                    onClose()
                  }}
                  onMouseLeave={() => setConfirmDelete(false)}
                  className={`arc-pressable h-7 px-2.5 rounded-lg inline-flex items-center gap-1 text-[11px] font-medium transition ${
                    confirmDelete
                      ? 'bg-rose-500 text-white'
                      : 'text-rose-500/85 hover:text-rose-500 hover:bg-rose-500/10'
                  }`}
                >
                  <Trash2 size={11.5} />
                  <span>
                    {confirmDelete
                      ? tr(lang, 'Confirm Delete', '确认删除')
                      : tr(lang, 'Delete Profile', '删除资料')}
                  </span>
                </button>
              ) : (
                <span className="text-[10.5px] opacity-40">
                  {tr(lang, 'Saved automatically', '实时自动保存')}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
