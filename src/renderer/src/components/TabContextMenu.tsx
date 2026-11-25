import React, { useState } from 'react'
import {
  Columns2,
  Copy,
  FolderPlus,
  Pin,
  PinOff,
  RotateCcw,
  Star,
  Trash2,
  Volume2,
  VolumeX,
  X,
  XCircle
} from 'lucide-react'
import { TAB_GROUP_COLOR_STYLES } from '@shared/constants'
import { tr } from '@shared/i18n'
import type { AppLanguage, TabGroup, TabGroupColor, TabPinMode, TabState } from '@shared/types'

interface Props {
  isDark: boolean
  lang?: AppLanguage
  tab: TabState
  tabGroups: TabGroup[]
  position: { x: number; y: number }
  onOpenInSplit: (tabId: string) => void
  onSetTabPinState: (tabId: string, mode: TabPinMode) => void
  onResetPinnedTab: (tabId: string) => void
  onDuplicateTab: (tabId: string) => void
  onMuteTab: (tabId: string) => void
  onAssignGroup: (tabId: string, groupId: string | null) => void
  onCreateGroupWithTab: (title: string, color: TabGroupColor, tabId: string) => void
  onCloseOtherTabs: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  isClosing?: boolean
  onCloseMenu: () => void
}

const COLOR_KEYS: TabGroupColor[] = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet']

export const TabContextMenu: React.FC<Props> = ({
  isDark,
  lang,
  tab,
  tabGroups,
  position,
  onOpenInSplit,
  onSetTabPinState,
  onResetPinnedTab,
  onDuplicateTab,
  onMuteTab,
  onAssignGroup,
  onCreateGroupWithTab,
  onCloseOtherTabs,
  onCloseTab,
  isClosing = false,
  onCloseMenu
}) => {
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupTitle, setGroupTitle] = useState('')
  const [groupColor, setGroupColor] = useState<TabGroupColor>('indigo')

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseMenu()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCloseMenu])

  const menuW = 256
  const left = Math.max(10, Math.min(window.innerWidth - menuW - 10, position.x))
  const top = Math.max(10, Math.min(window.innerHeight - 390, position.y))

  const hasDriftedPinnedUrl = Boolean(
    (tab.isPinned || tab.isFavorite) && tab.pinnedUrl && tab.url !== tab.pinnedUrl
  )

  return (
    <div onClick={onCloseMenu} className="fixed inset-0 z-50">
      <div
        style={{ position: 'fixed', left, top, width: menuW, transformOrigin: 'top left' }}
        onClick={(e) => e.stopPropagation()}
        className={`rounded-2xl border p-1.5 shadow-2xl backdrop-blur-2xl text-xs select-none ${
          isClosing ? 'arc-popover-exit' : 'arc-popover-enter'
        } ${
          isDark
            ? 'bg-[#232329]/96 border-white/12 text-zinc-100'
            : 'bg-white/96 border-black/10 text-zinc-800'
        }`}
      >
        <div className="px-2.5 py-1.5 text-[11px] font-medium opacity-45 truncate border-b border-black/5 dark:border-white/6 mb-1">
          {tab.title || tab.url}
        </div>

        <button
          type="button"
          onClick={() => {
            onOpenInSplit(tab.id)
            onCloseMenu()
          }}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition ${
            isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-zinc-100'
          }`}
        >
          <Columns2 size={13} className="opacity-65" />
          <span>{tr(lang, 'Open in Right Split View', '在右侧分屏并排打开')}</span>
        </button>

        {/* Arc Top Favorites Option */}
        {!tab.isFavorite ? (
          <button
            type="button"
            onClick={() => {
              onSetTabPinState(tab.id, 'favorite')
              onCloseMenu()
            }}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition ${
              isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-zinc-100'
            }`}
          >
            <Star size={13} className="opacity-65" />
            <span>{tr(lang, 'Add to Top Favorites', '固定到顶部常驻图标 (Favorites)')}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              onSetTabPinState(tab.id, 'pinned')
              onCloseMenu()
            }}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition ${
              isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-zinc-100'
            }`}
          >
            <Pin size={13} className="opacity-65" />
            <span>{tr(lang, 'Move to Space Pinned List', '降为空间上方固定列表')}</span>
          </button>
        )}

        {/* Arc Space Pinned Option */}
        {!tab.isPinned && !tab.isFavorite ? (
          <button
            type="button"
            onClick={() => {
              onSetTabPinState(tab.id, 'pinned')
              onCloseMenu()
            }}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition ${
              isDark ? 'hover:bg-white/[0.07]' : 'hover:bg-zinc-100'
            }`}
          >
            <Pin size={13} className="opacity-65" />
            <span>{tr(lang, 'Pin to Space', '固定到当前空间上方 (Pin Tab)')}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              onSetTabPinState(tab.id, 'unpinned')
              onCloseMenu()
            }}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl transition ${
              isDark ? 'hover:bg-white/8' : 'hover:bg-zinc-100'
            }`}
          >
            <PinOff size={13} />
            <span>
              {tab.isFavorite
                ? tr(lang, 'Remove from Favorites', '移出顶部常驻图标')
                : tr(lang, 'Unpin Tab', '取消固定标签页')}
            </span>
          </button>
        )}

        {hasDriftedPinnedUrl && (
          <button
            type="button"
            onClick={() => {
              onResetPinnedTab(tab.id)
              onCloseMenu()
            }}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-indigo-500 transition ${
              isDark ? 'hover:bg-white/8' : 'hover:bg-zinc-100'
            }`}
          >
            <RotateCcw size={13} />
            <span>{tr(lang, 'Reset to Pinned URL', '还原到初始固定网址')}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            onDuplicateTab(tab.id)
            onCloseMenu()
          }}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl transition ${
            isDark ? 'hover:bg-white/8' : 'hover:bg-zinc-100'
          }`}
        >
          <Copy size={13} />
          <span>{tr(lang, 'Duplicate Tab', '复制标签页')}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onMuteTab(tab.id)
            onCloseMenu()
          }}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl transition ${
            isDark ? 'hover:bg-white/8' : 'hover:bg-zinc-100'
          }`}
        >
          {tab.isMuted ? <Volume2 size={13} /> : <VolumeX size={13} />}
          <span>
            {tab.isMuted
              ? tr(lang, 'Unmute Tab', '取消静音此标签页')
              : tr(lang, 'Mute Tab', '静音此标签页')}
          </span>
        </button>

        {!tab.isFavorite && (
          <>
            <div className={`my-1 border-t ${isDark ? 'border-white/8' : 'border-black/6'}`} />
            <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider opacity-45">
              {tr(lang, 'Folders / Tab Groups', '标签页文件夹 / 分组')}
            </div>

            {tabGroups.map((g) => {
              const inThisGroup = tab.groupId === g.id
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    onAssignGroup(tab.id, inThisGroup ? null : g.id)
                    onCloseMenu()
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl transition ${
                    inThisGroup
                      ? 'bg-indigo-500/15 text-indigo-500 font-medium'
                      : isDark
                        ? 'hover:bg-white/8'
                        : 'hover:bg-zinc-100'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span
                      className={`w-2 h-2 rounded-full ${TAB_GROUP_COLOR_STYLES[g.color].dot}`}
                    />
                    <span className="truncate">{g.title}</span>
                  </span>
                  {inThisGroup && (
                    <span className="text-[10px]">{tr(lang, 'Remove', '移出')}</span>
                  )}
                </button>
              )
            })}

            {!creatingGroup ? (
              <button
                type="button"
                onClick={() => setCreatingGroup(true)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-indigo-500 transition ${
                  isDark ? 'hover:bg-white/8' : 'hover:bg-zinc-100'
                }`}
              >
                <FolderPlus size={13} />
                <span>{tr(lang, 'New Group with Tab…', '新建分组并移入…')}</span>
              </button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!groupTitle.trim()) return
                  onCreateGroupWithTab(groupTitle.trim(), groupColor, tab.id)
                  onCloseMenu()
                }}
                className="p-2 space-y-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]"
              >
                <input
                  autoFocus
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  placeholder={tr(lang, 'Group name (e.g. Research)', '分组名称（如：调研）')}
                  className={`w-full h-7 px-2 rounded-lg border outline-none text-xs ${
                    isDark ? 'bg-[#16161C] border-white/12' : 'bg-white border-black/12'
                  }`}
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    {COLOR_KEYS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setGroupColor(c)}
                        className={`w-4 h-4 rounded-full ${TAB_GROUP_COLOR_STYLES[c].dot} ${
                          groupColor === c ? 'ring-2 ring-offset-1 ring-indigo-500' : 'opacity-65'
                        }`}
                      />
                    ))}
                  </div>
                  <button
                    type="submit"
                    className="px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[11px] font-medium"
                  >
                    {tr(lang, 'Create', '创建')}
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        <div className={`my-1 border-t ${isDark ? 'border-white/8' : 'border-black/6'}`} />

        <button
          type="button"
          onClick={() => {
            onCloseOtherTabs(tab.id)
            onCloseMenu()
          }}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl transition ${
            isDark ? 'hover:bg-white/8' : 'hover:bg-zinc-100'
          }`}
        >
          <XCircle size={13} className="opacity-70" />
          <span>{tr(lang, 'Close Other Unpinned Tabs', '关闭其他临时标签页')}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onCloseTab(tab.id)
            onCloseMenu()
          }}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-rose-500 hover:bg-rose-500/10 transition"
        >
          <Trash2 size={13} />
          <span>
            {tab.isPinned || tab.isFavorite
              ? tr(lang, 'Close & Remove Pinned Tab', '关闭并移除固定标签')
              : tr(lang, 'Close Tab', '关闭此标签页')}
          </span>
          <X size={11} className="ml-auto opacity-50" />
        </button>
      </div>
    </div>
  )
}
