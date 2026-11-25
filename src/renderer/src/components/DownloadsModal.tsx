import React from 'react'
import { CheckCircle2, Download, FolderOpen, Loader2, X, XCircle } from 'lucide-react'
import { tr } from '@shared/i18n'
import type { AppLanguage, DownloadItemState } from '@shared/types'

interface Props {
  isDark: boolean
  lang?: AppLanguage
  downloads: DownloadItemState[]
  onRevealInFinder: (filePath: string) => void
  onClearCompleted: () => void
  isClosing?: boolean
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let val = bytes
  let idx = 0
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024
    idx++
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

export const DownloadsModal: React.FC<Props> = ({
  isDark,
  lang,
  downloads,
  onRevealInFinder,
  onClearCompleted,
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
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-start justify-end pt-12 pr-4">
      <div
        style={{ transformOrigin: 'top right' }}
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-[380px] rounded-2xl border shadow-2xl backdrop-blur-2xl overflow-hidden text-xs ${
          isClosing ? 'arc-popover-exit' : 'arc-popover-enter'
        } ${
          isDark
            ? 'bg-[#222228]/96 border-white/12 text-zinc-100'
            : 'bg-white/96 border-black/10 text-zinc-900'
        }`}
      >
        <div
          className={`px-4 h-11 border-b flex items-center justify-between ${
            isDark ? 'border-white/[0.07]' : 'border-black/[0.07]'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            <Download size={14} className="opacity-65" />
            <span>
              {tr(lang, `Downloads (${downloads.length})`, `下载管理 (${downloads.length})`)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {downloads.some((d) => d.state !== 'progressing') && (
              <button
                type="button"
                onClick={onClearCompleted}
                className="text-[11px] opacity-60 hover:opacity-100 hover:underline"
              >
                {tr(lang, 'Clear completed', '清除已完成')}
              </button>
            )}
            <button type="button" onClick={onClose} className="p-1 opacity-60 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {downloads.length === 0 ? (
            <div className="py-10 text-center opacity-45">
              {tr(lang, 'No downloads yet', '暂无下载任务')}
            </div>
          ) : (
            downloads.map((d) => {
              const pct =
                d.totalBytes > 0
                  ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100))
                  : 0
              return (
                <div
                  key={d.id}
                  className={`p-2.5 rounded-xl border space-y-1.5 ${
                    isDark ? 'bg-white/[0.03] border-white/8' : 'bg-zinc-50/70 border-black/6'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {d.state === 'progressing' ? (
                        <Loader2 size={13} className="animate-spin text-indigo-500 shrink-0" />
                      ) : d.state === 'completed' ? (
                        <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                      ) : (
                        <XCircle size={13} className="text-rose-500 shrink-0" />
                      )}
                      <span className="font-medium truncate">{d.fileName}</span>
                    </div>

                    {d.state === 'completed' && d.savePath && (
                      <button
                        type="button"
                        onClick={() => onRevealInFinder(d.savePath)}
                        title={tr(lang, 'Show in Finder / Folder', '在文件夹中显示')}
                        className="p-1 rounded-lg hover:bg-black/6 dark:hover:bg-white/10 text-indigo-500 shrink-0"
                      >
                        <FolderOpen size={13} />
                      </button>
                    )}
                  </div>

                  {d.state === 'progressing' && (
                    <div className="w-full h-1.5 rounded-full bg-black/8 dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[10.5px] opacity-55">
                    <span>
                      {d.state === 'progressing'
                        ? `${formatBytes(d.receivedBytes)} / ${
                            d.totalBytes ? formatBytes(d.totalBytes) : tr(lang, 'Unknown', '未知')
                          } (${pct}%)`
                        : d.state === 'completed'
                          ? `${tr(lang, 'Completed', '已完成')} · ${formatBytes(
                              d.totalBytes || d.receivedBytes
                            )}`
                          : tr(lang, 'Cancelled or interrupted', '已取消或中断')}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
