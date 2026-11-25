import React, { useEffect, useMemo, useState } from 'react'
import { Bookmark, Clock, Search, Trash2, X } from 'lucide-react'
import { tr } from '@shared/i18n'
import type { AppLanguage, BookmarkItem, HistoryItem } from '@shared/types'
import { FaviconIcon } from './FaviconIcon'

interface Props {
  isDark: boolean
  lang?: AppLanguage
  bookmarks: BookmarkItem[]
  history: HistoryItem[]
  onOpenUrl: (url: string) => void
  onRemoveBookmark: (id: string) => void
  onClearHistory: () => void
  isClosing?: boolean
  onClose: () => void
}

export const LibraryModal: React.FC<Props> = ({
  isDark,
  lang,
  bookmarks,
  history,
  onOpenUrl,
  onRemoveBookmark,
  onClearHistory,
  isClosing = false,
  onClose
}) => {
  const [section, setSection] = useState<'bookmarks' | 'history'>('bookmarks')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const q = search.trim().toLowerCase()
  const filteredBookmarks = useMemo(
    () =>
      bookmarks.filter(
        (b) => !q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
      ),
    [bookmarks, q]
  )

  const filteredHistory = useMemo(
    () =>
      history.filter(
        (h) => !q || h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q)
      ),
    [history, q]
  )

  return (
    <div
      onClick={onClose}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 ${
        isClosing ? 'arc-backdrop-exit' : 'arc-backdrop-enter'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-[600px] h-[490px] rounded-[22px] border shadow-2xl flex flex-col overflow-hidden ${
          isClosing ? 'arc-modal-exit' : 'arc-modal-enter'
        } ${
          isDark
            ? 'bg-[#222227]/96 border-white/12 text-zinc-100 backdrop-blur-2xl'
            : 'bg-white/96 border-black/10 text-zinc-900 backdrop-blur-2xl'
        }`}
      >
        <div
          className={`px-4 h-12 border-b flex items-center justify-between gap-3 ${
            isDark ? 'border-white/[0.07]' : 'border-black/[0.07]'
          }`}
        >
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSection('bookmarks')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                section === 'bookmarks'
                  ? isDark
                    ? 'bg-white/[0.10] text-zinc-100'
                    : 'bg-black/[0.07] text-zinc-900'
                  : 'opacity-55 hover:opacity-100'
              }`}
            >
              <Bookmark size={13} />
              <span>
                {tr(lang, `Bookmarks (${bookmarks.length})`, `收藏夹 (${bookmarks.length})`)}
              </span>
            </button>
            <button
              onClick={() => setSection('history')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                section === 'history'
                  ? isDark
                    ? 'bg-white/[0.10] text-zinc-100'
                    : 'bg-black/[0.07] text-zinc-900'
                  : 'opacity-55 hover:opacity-100'
              }`}
            >
              <Clock size={13} />
              <span>
                {tr(lang, `History (${history.length})`, `浏览历史 (${history.length})`)}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {section === 'history' && history.length > 0 && (
              <button
                onClick={onClearHistory}
                className="text-xs text-rose-500 hover:underline px-2 py-1"
              >
                {tr(lang, 'Clear History', '清空历史')}
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg opacity-60 hover:opacity-100">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-4 py-2.5 border-b border-black/5 dark:border-white/6 flex items-center gap-2">
          <Search size={14} className="opacity-45" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr(lang, 'Search title or URL…', '搜索标题或网址…')}
            className="flex-1 bg-transparent outline-none text-xs"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-1 text-xs">
          {section === 'bookmarks' ? (
            filteredBookmarks.length === 0 ? (
              <div className="h-full flex items-center justify-center opacity-45">
                {tr(lang, 'No matching bookmarks', '暂无匹配的收藏页面')}
              </div>
            ) : (
              filteredBookmarks.map((b) => (
                <div
                  key={b.id}
                  onClick={() => {
                    onOpenUrl(b.url)
                    onClose()
                  }}
                  className={`group flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition ${
                    isDark ? 'hover:bg-white/6' : 'hover:bg-zinc-100'
                  }`}
                >
                  <FaviconIcon url={b.url} favicon={b.favicon} size={15} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{b.title}</div>
                    <div className="text-[11px] opacity-45 truncate">{b.url}</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveBookmark(b.id)
                    }}
                    className="opacity-0 group-hover:opacity-75 hover:!opacity-100 p-1 text-rose-500"
                    title={tr(lang, 'Remove bookmark', '移除收藏')}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )
          ) : filteredHistory.length === 0 ? (
            <div className="h-full flex items-center justify-center opacity-45">
              {tr(lang, 'No browsing history yet', '暂无浏览记录')}
            </div>
          ) : (
            filteredHistory.map((h) => (
              <div
                key={h.id}
                onClick={() => {
                  onOpenUrl(h.url)
                  onClose()
                }}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition ${
                  isDark ? 'hover:bg-white/6' : 'hover:bg-zinc-100'
                }`}
              >
                <FaviconIcon url={h.url} favicon={h.favicon} size={15} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{h.title}</div>
                  <div className="text-[11px] opacity-45 truncate">{h.url}</div>
                </div>
                <span className="text-[10.5px] opacity-40 shrink-0">
                  {new Date(h.visitedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
