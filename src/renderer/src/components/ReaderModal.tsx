import React, { useState } from 'react'
import { BookOpen, Copy, Check, Download, Sparkles, Type, X } from 'lucide-react'
import { tr } from '@shared/i18n'
import type { AppLanguage, ReaderArticle } from '@shared/types'
import { ChatMarkdown } from './ChatMarkdown'

interface Props {
  isDark: boolean
  lang?: AppLanguage
  article: ReaderArticle
  onSummarizeWithAI: () => void
  onExportMarkdown: () => void
  onOpenLink: (url: string, openInSplit?: boolean) => void
  isClosing?: boolean
  onClose: () => void
}

export const ReaderModal: React.FC<Props> = ({
  isDark,
  lang,
  article,
  onSummarizeWithAI,
  onExportMarkdown,
  onOpenLink,
  isClosing = false,
  onClose
}) => {
  const [serif, setSerif] = useState(false)
  const [copied, setCopied] = useState(false)

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

  const estMinutes = Math.max(1, Math.round(article.wordCount / 550))

  return (
    <div
      onClick={onClose}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/32 backdrop-blur-sm p-4 sm:p-6 ${
        isClosing ? 'arc-backdrop-exit' : 'arc-backdrop-enter'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-[820px] h-[86vh] rounded-[22px] border shadow-2xl flex flex-col overflow-hidden ${
          isClosing ? 'arc-modal-exit' : 'arc-modal-enter'
        } ${
          isDark
            ? 'bg-[#1A1A20] border-white/12 text-zinc-100'
            : 'bg-[#FBFBF9] border-black/10 text-zinc-900'
        }`}
      >
        {/* Top Reader Toolbar */}
        <div
          className={`h-12 px-5 border-b flex items-center justify-between gap-3 shrink-0 ${
            isDark ? 'border-white/8 bg-[#16161B]' : 'border-black/6 bg-white/80'
          }`}
        >
          <div className="flex items-center gap-2 text-xs">
            <BookOpen size={15} className="text-indigo-500" />
            <span className="font-semibold">
              {tr(lang, 'Arko Calm Reader', 'Arko 沉浸阅读视图')}
            </span>
            {article.ok && (
              <span className="opacity-50">
                {tr(
                  lang,
                  `· ~${article.wordCount.toLocaleString()} chars · ${estMinutes} min read`,
                  `· 约 ${article.wordCount.toLocaleString()} 字 · 预计 ${estMinutes} 分钟读完`
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setSerif(!serif)}
              className={`h-7 px-2.5 rounded-lg border inline-flex items-center gap-1 transition ${
                isDark
                  ? 'border-white/10 hover:bg-white/8'
                  : 'border-black/8 bg-white hover:bg-zinc-100'
              }`}
              title={tr(lang, 'Toggle Serif / Sans typography', '切换衬线 / 无衬线阅读排版')}
            >
              <Type size={12} />
              <span>{serif ? tr(lang, 'Serif', '衬线体') : tr(lang, 'Sans', '现代体')}</span>
            </button>

            {article.ok && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(article.markdown)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                  className={`h-7 px-2.5 rounded-lg border inline-flex items-center gap-1 transition ${
                    isDark
                      ? 'border-white/10 hover:bg-white/8'
                      : 'border-black/8 bg-white hover:bg-zinc-100'
                  }`}
                >
                  {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  <span>
                    {copied
                      ? tr(lang, 'Copied', '已复制')
                      : tr(lang, 'Copy Markdown', '复制 Markdown')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onExportMarkdown}
                  className={`h-7 px-2.5 rounded-lg border inline-flex items-center gap-1 transition ${
                    isDark
                      ? 'border-white/10 hover:bg-white/8'
                      : 'border-black/8 bg-white hover:bg-zinc-100'
                  }`}
                >
                  <Download size={12} />
                  <span>{tr(lang, 'Save .md', '另存 .md')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onSummarizeWithAI()
                  }}
                  className={`h-7 px-3 rounded-lg font-medium inline-flex items-center gap-1 transition ${
                    isDark
                      ? 'bg-zinc-100 text-zinc-900 hover:bg-white'
                      : 'bg-zinc-900 text-white hover:bg-zinc-800'
                  }`}
                >
                  <Sparkles size={12} />
                  <span>{tr(lang, 'Summarize', '提炼要点')}</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg opacity-60 hover:opacity-100"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Editorial Body */}
        <div className="flex-1 overflow-y-auto px-6 sm:px-14 py-10">
          {!article.ok ? (
            <div className="h-full flex items-center justify-center text-sm opacity-60">
              {article.error || tr(lang, 'Unable to extract article body.', '无法提取当前网页正文')}
            </div>
          ) : (
            <article
              className="max-w-[650px] mx-auto space-y-5"
              style={
                serif
                  ? {
                      fontFamily:
                        '"New York", "Songti SC", "Source Han Serif SC", Georgia, Cambria, serif'
                    }
                  : undefined
              }
            >
              <header className="space-y-2.5 pb-4 border-b border-black/8 dark:border-white/10">
                <h1 className="text-2xl sm:text-[26px] font-bold leading-snug tracking-tight">
                  {article.title}
                </h1>
                {article.description && (
                  <p className="text-sm opacity-65 leading-relaxed">{article.description}</p>
                )}
                <div className="text-xs opacity-45 truncate font-sans">{article.url}</div>
              </header>

              <ChatMarkdown
                content={article.markdown}
                lang={lang}
                className="text-[15.5px] leading-[1.82]"
                onOpenLink={(u, split) => {
                  onClose()
                  onOpenLink(u, split)
                }}
              />
            </article>
          )}
        </div>
      </div>
    </div>
  )
}
