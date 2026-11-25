import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Eraser, Palette, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { PROFILE_ACCENT_PRESETS } from '@shared/constants'
import { tr } from '@shared/i18n'
import { getArcSpaceTheme, pickNextDistinctSpaceColor } from '@shared/space-theme'
import type { AppLanguage, BrowserProfile } from '@shared/types'

export interface SpacePopoverRequest {
  mode: 'edit' | 'create'
  profileId?: string
  anchor: {
    x: number
    y: number
    placement?: 'bottom-left' | 'top-left' | 'right-top'
  }
}

interface Props {
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
  const [mode, setMode] = useState<'edit' | 'create'>(request.mode)
  const [targetId, setTargetId] = useState<string>(
    request.profileId || activeProfileId || profiles[0]?.id || ''
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showAllIcons, setShowAllIcons] = useState(false)

  const targetProfile = useMemo(
    () => profiles.find((p) => p.id === targetId) || profiles[0],
    [profiles, targetId]
  )

  const [draftName, setDraftName] = useState(
    request.mode === 'create' ? '' : targetProfile?.name || ''
  )
  const [draftEmoji, setDraftEmoji] = useState(
    request.mode === 'create' ? '🚀' : targetProfile?.emoji || '✨'
  )
  const [draftAccent, setDraftAccent] = useState(
    request.mode === 'create'
      ? pickNextDistinctSpaceColor(profiles.map((p) => p.accentColor))
      : targetProfile?.accentColor || '#4F46E5'
  )

  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setMode(request.mode)
    setConfirmDelete(false)
    if (request.mode === 'create') {
      setDraftName('')
      setDraftEmoji('🚀')
      setDraftAccent(pickNextDistinctSpaceColor(profiles.map((p) => p.accentColor)))
      window.setTimeout(() => nameInputRef.current?.focus(), 30)
    } else {
      const resolved =
        profiles.find((p) => p.id === (request.profileId || activeProfileId)) || profiles[0]
      if (resolved) {
        setTargetId(resolved.id)
        setDraftName(resolved.name)
        setDraftEmoji(resolved.emoji)
        setDraftAccent(resolved.accentColor || '#4F46E5')
      }
    }
  }, [request, profiles, activeProfileId])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const switchToCreateMode = (): void => {
    setMode('create')
    setConfirmDelete(false)
    setDraftName('')
    setDraftEmoji('🚀')
    setDraftAccent(pickNextDistinctSpaceColor(profiles.map((p) => p.accentColor)))
    window.setTimeout(() => nameInputRef.current?.focus(), 20)
  }

  const selectEditSpace = (p: BrowserProfile): void => {
    setMode('edit')
    setConfirmDelete(false)
    setTargetId(p.id)
    setDraftName(p.name)
    setDraftEmoji(p.emoji)
    setDraftAccent(p.accentColor || '#4F46E5')
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
    const finalName = draftName.trim() || tr(lang, 'New Space', '新空间')
    onCreateProfile(finalName, draftEmoji.trim() || '🚀', draftAccent)
    onClose()
  }

  const activeAccent = mode === 'create' ? draftAccent : targetProfile?.accentColor || draftAccent
  const spaceTheme = useMemo(
    () => getArcSpaceTheme(activeAccent, isDark),
    [activeAccent, isDark]
  )

  // Smart viewport positioning anchored right beside the trigger
  const cardWidth = 286
  const estimatedHeight = showAllIcons ? 378 : 326
  const placement = request.anchor.placement || 'bottom-left'

  const posStyle = useMemo<React.CSSProperties>(() => {
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1280
    const winH = typeof window !== 'undefined' ? window.innerHeight : 800

    let left = request.anchor.x
    let top = request.anchor.y
    let origin = 'top left'

    if (placement === 'top-left') {
      top = Math.max(12, request.anchor.y - estimatedHeight - 8)
      origin = 'bottom left'
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
  }, [request.anchor.x, request.anchor.y, placement, estimatedHeight])

  const visibleIcons = showAllIcons ? SPACE_ICONS : SPACE_ICONS.slice(0, 8)

  return (
    <div
      onClick={onClose}
      className={`fixed inset-0 z-50 ${isClosing ? 'arc-backdrop-exit' : 'arc-backdrop-enter'}`}
    >
      <div
        style={{
          ...posStyle,
          background: isDark
            ? `radial-gradient(120% 80% at 0% 0%, rgba(${spaceTheme.rgbString}, 0.24) 0%, rgba(28, 28, 34, 0.96) 68%), rgba(26, 26, 31, 0.97)`
            : `radial-gradient(120% 80% at 0% 0%, rgba(${spaceTheme.rgbString}, 0.16) 0%, rgba(255, 255, 255, 0.97) 68%), rgba(255, 255, 255, 0.98)`,
          borderColor: isDark
            ? `rgba(${spaceTheme.rgbString}, 0.34)`
            : `rgba(${spaceTheme.rgbString}, 0.26)`,
          boxShadow: isDark
            ? `0 22px 52px -10px rgba(0, 0, 0, 0.68), 0 0 0 1px rgba(255, 255, 255, 0.06)`
            : `0 20px 48px -10px rgba(15, 23, 42, 0.20), 0 0 0 1px rgba(0, 0, 0, 0.04)`
        }}
        onClick={(e) => e.stopPropagation()}
        className={`rounded-[18px] border backdrop-blur-2xl p-3.5 text-xs select-none transition-[background,border-color] duration-300 ${
          isClosing
            ? 'arc-popover-exit'
            : placement === 'top-left'
              ? 'arc-popover-up-enter'
              : 'arc-popover-enter'
        } ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}
      >
        {/* Top Space Switcher Strip (Arc-style quick Space pills + New Space) */}
        <div className="flex items-center justify-between gap-1.5 mb-2.5">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0 py-0.5">
            {profiles.map((p) => {
              const isSel = mode === 'edit' && p.id === targetProfile?.id
              const pTheme = getArcSpaceTheme(p.accentColor, isDark)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectEditSpace(p)}
                  title={p.name}
                  style={
                    isSel
                      ? {
                          backgroundColor: pTheme.spaceBadgeBg,
                          boxShadow: `inset 0 0 0 1px ${pTheme.spaceBadgeBorder}`
                        }
                      : undefined
                  }
                  className={`arc-pressable h-6 px-2 rounded-full flex items-center gap-1 text-[11px] shrink-0 ${
                    isSel
                      ? 'font-semibold opacity-100'
                      : isDark
                        ? 'opacity-55 hover:opacity-100 hover:bg-white/[0.08]'
                        : 'opacity-60 hover:opacity-100 hover:bg-black/[0.05]'
                  }`}
                >
                  <span className="text-[11.5px] leading-none">{p.emoji}</span>
                  <span className="max-w-[64px] truncate">{p.name}</span>
                </button>
              )
            })}
            <button
              type="button"
              onClick={switchToCreateMode}
              title={tr(lang, 'Create New Space', '新建隔离空间')}
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

        {/* Inline Emoji + Space Name Row */}
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
            onClick={() => setShowAllIcons((v) => !v)}
            title={tr(lang, 'Choose Space icon', '选择空间图标')}
            style={{
              backgroundColor: spaceTheme.spaceBadgeBg,
              boxShadow: `inset 0 0 0 1px ${spaceTheme.spaceBadgeBorder}`
            }}
            className="arc-pressable w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0"
          >
            {draftEmoji || '✨'}
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
                  ? tr(lang, 'Space name (e.g. Work, Research)…', '输入空间名称（如：工作、研究）…')
                  : tr(lang, 'Space name…', '空间名称…')
              }
              className={`w-full h-9 px-3 rounded-xl border text-[13px] font-medium outline-none transition ${
                isDark
                  ? 'bg-black/25 border-white/10 focus:border-white/25 placeholder:text-zinc-500'
                  : 'bg-white/80 border-black/10 focus:border-black/25 placeholder:text-zinc-400'
              }`}
            />
          </div>
        </form>

        {/* Arc Atmospheric Theme Swatches (Live Real-Time Sidebar Tinting) */}
        <div className="space-y-2 mb-3">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider opacity-50 flex items-center gap-1">
              <Palette size={10.5} />
              <span>{tr(lang, 'Space Theme', '空间氛围色')}</span>
            </span>

            <label
              title={tr(lang, 'Custom color wheel', '自定义任意主题色')}
              className="inline-flex items-center gap-1 text-[10.5px] font-medium opacity-65 hover:opacity-100 cursor-pointer transition"
            >
              <span>{tr(lang, 'Custom', '调色盘')}</span>
              <span
                className="relative w-4 h-4 rounded-full overflow-hidden ring-1 ring-black/15 dark:ring-white/20 shrink-0"
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
                    background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.45) 0%, transparent 55%), ${preset.hex}`,
                    boxShadow: isSelected
                      ? `0 0 0 2px ${isDark ? '#1A1A20' : '#FFFFFF'}, 0 0 0 3.5px ${preset.hex}, 0 4px 10px -2px ${preset.hex}80`
                      : 'inset 0 1px 1px rgba(255,255,255,0.28)'
                  }}
                  className={`arc-fav-pressable h-7 rounded-full flex items-center justify-center ${
                    isSelected ? 'scale-105' : 'opacity-85 hover:opacity-100'
                  }`}
                >
                  {isSelected && <Check size={12} strokeWidth={2.8} className="text-white drop-shadow-xs" />}
                </button>
              )
            })}
          </div>
        </div>

        {/* Space Icon Quick Grid */}
        <div className="space-y-1.5 mb-2.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider opacity-50 flex items-center gap-1">
              <Sparkles size={10.5} />
              <span>{tr(lang, 'Icon', '空间图标')}</span>
            </span>
            <button
              type="button"
              onClick={() => setShowAllIcons((v) => !v)}
              className="text-[10.5px] opacity-55 hover:opacity-100 transition"
            >
              {showAllIcons ? tr(lang, 'Less', '收起') : tr(lang, 'More', '更多图标')}
            </button>
          </div>

          <div className="grid grid-cols-8 gap-1">
            {visibleIcons.map((emo) => {
              const active = draftEmoji === emo
              return (
                <button
                  key={emo}
                  type="button"
                  onClick={() => handlePickEmoji(emo)}
                  className={`arc-fav-pressable h-7 rounded-lg text-[13.5px] flex items-center justify-center ${
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

        {/* Footer: Instant Actions in Edit Mode, or Create Button in Create Mode */}
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
                style={{ backgroundColor: spaceTheme.accentHex }}
                className="arc-pressable h-7 px-3.5 rounded-lg text-white font-semibold text-[11.5px] shadow-xs hover:brightness-105 shrink-0"
              >
                {tr(lang, 'Create Space', '创建空间')}
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
                      : tr(lang, 'Delete Space', '删除空间')}
                  </span>
                </button>
              ) : (
                <span className="text-[10.5px] opacity-40">
                  {tr(lang, 'Changes apply live', '实时生效')}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
