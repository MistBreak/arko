import React, { useState } from 'react'
import {
  Columns2,
  Copy,
  Folder,
  FolderPlus,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
  Volume2,
  VolumeX,
  X,
  XCircle
} from 'lucide-react'
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

        {/* Dia Simple Pin / Unpin Option */}
        {!tab.isPinned && !tab.isFavorite ? (
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
            <Pin size={13} className="opacity-65" />
            <span>{tr(lang, 'Pin Tab', '固定标签页')}</span>
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
            <span>{tr(lang, 'Unpin Tab', '取消固定标签页')}</span>
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

        <div className={`my-1 border-t ${isDark ? 'border-white/8' : 'border-black/6'}`} />
        <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider opacity-45">
          {tr(lang, 'Folders / Tab Groups', '标签页文件夹 / 分组')}
        </div>

        <div className="max-h-52 overflow-y-auto no-scrollbar space-y-0.5">
          {(() => {
            const byId = new Map(tabGroups.map((g) => [g.id, g]))
            const childrenByParent = new Map<string, TabGroup[]>()
            const roots: TabGroup[] = []
            for (const g of tabGroups) {
              if (g.parentId && g.parentId !== g.id && byId.has(g.parentId)) {
                const arr = childrenByParent.get(g.parentId) || []
                arr.push(g)
                childrenByParent.set(g.parentId, arr)
              } else {
                roots.push(g)
              }
            }
            const ordered: Array<{ group: TabGroup; depth: number; pathLabel: string }> = []
            const visited = new Set<string>()
            const walk = (g: TabGroup, depth: number, prefix: string[]): void => {
              if (visited.has(g.id)) return
              visited.add(g.id)
              const nextPath = [...prefix, g.title]
              ordered.push({ group: g, depth, pathLabel: nextPath.join(' / ') })
              for (const child of childrenByParent.get(g.id) || []) {
                walk(child, depth + 1, nextPath)
              }
            }
            for (const r of roots) walk(r, 0, [])
            for (const g of tabGroups) {
              if (!visited.has(g.id)) walk(g, 0, [])
            }

            return ordered.map(({ group: g, depth, pathLabel }) => {
              const inThisGroup = tab.groupId === g.id
              return (
                <button
                  key={g.id}
                  type="button"
                  title={pathLabel}
                  onClick={() => {
                    onAssignGroup(tab.id, inThisGroup ? null : g.id)
                    onCloseMenu()
                  }}
                  style={{ paddingLeft: 10 + Math.min(depth, 5) * 12 }}
                  className={`w-full flex items-center justify-between pr-2.5 py-1.5 rounded-xl transition ${
                    inThisGroup
                      ? 'bg-indigo-500/15 text-indigo-500 font-medium'
                      : isDark
                        ? 'hover:bg-white/8'
                        : 'hover:bg-zinc-100'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Folder size={12} strokeWidth={1.75} className="opacity-55 shrink-0" />
                    <span className="truncate">{g.title}</span>
                  </span>
                  {inThisGroup && (
                    <span className="text-[10px] shrink-0 ml-1">
                      {tr(lang, 'Remove', '移出')}
                    </span>
                  )}
                </button>
              )
            })
          })()}
        </div>

        {!creatingGroup ? (
          <button
            type="button"
            onClick={() => setCreatingGroup(true)}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-indigo-500 transition ${
              isDark ? 'hover:bg-white/8' : 'hover:bg-zinc-100'
            }`}
          >
            <FolderPlus size={13} />
            <span>{tr(lang, 'New Folder with Tab…', '新建文件夹并移入…')}</span>
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!groupTitle.trim()) return
              onCreateGroupWithTab(groupTitle.trim(), 'indigo', tab.id)
              onCloseMenu()
            }}
            className="p-2 space-y-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]"
          >
            <input
              autoFocus
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder={tr(lang, 'Folder name (e.g. Personal)', '文件夹名称（如：Personal）')}
              className={`w-full h-7 px-2 rounded-lg border outline-none text-xs ${
                isDark ? 'bg-[#16161C] border-white/12' : 'bg-white border-black/12'
              }`}
            />
            <div className="flex items-center justify-end">
              <button
                type="submit"
                className="px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[11px] font-medium"
              >
                {tr(lang, 'Create', '创建')}
              </button>
            </div>
          </form>
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
