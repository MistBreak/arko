import React, { useMemo, useState } from 'react'
import { marked } from 'marked'
import {
  AlertCircle,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Wrench
} from 'lucide-react'
import { tr } from '@shared/i18n'
import type { AgentToolStep, AppLanguage } from '@shared/types'

marked.setOptions({
  breaks: true,
  gfm: true
})

function escapeHtmlAttr(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Enhances parsed Markdown HTML with:
 * 1) Interactive [@Page Title] source citation pills
 * 2) One-click Copy Code header button on every <pre><code> block
 */
function enhanceArkoMarkdownHtml(rawHtml: string, lang?: AppLanguage): string {
  if (!rawHtml) return ''

  const copyLabel = tr(lang, 'Copy', '复制代码')
  const jumpHintPrefix = tr(lang, 'Switch to cited tab: ', '点击切换到引用标签页：')

  let enhanced = rawHtml.replace(/<pre><code([^>]*)>/gi, (_match, attrs: string) => {
    const langMatch = attrs.match(/language-([a-z0-9_+-]+)/i)
    const langLabel = langMatch ? langMatch[1] : 'code'
    return `<div class="dia-code-wrap"><div class="dia-code-bar"><span class="dia-code-lang">${escapeHtmlAttr(langLabel)}</span><button type="button" class="dia-copy-code-btn" data-dia-copy-code="1">${escapeHtmlAttr(copyLabel)}</button></div><pre><code${attrs}>`
  })
  enhanced = enhanced.replace(/<\/code><\/pre>/gi, '</code></pre></div>')

  enhanced = enhanced.replace(
    /(?:<code>)?\[@([^\]<\n]{1,64})\](?:<\/code>)?/g,
    (_m, citeTitle: string) => {
      const clean = citeTitle.trim()
      return `<button type="button" class="dia-cite-pill" data-dia-cite="${escapeHtmlAttr(clean)}" title="${escapeHtmlAttr(jumpHintPrefix + clean)}">@${escapeHtmlAttr(clean.slice(0, 26))}</button>`
    }
  )

  return enhanced
}

export const ReasoningBlock: React.FC<{
  reasoning: string
  isDark: boolean
  lang?: AppLanguage
  isStreaming?: boolean
}> = ({ reasoning, isDark, lang, isStreaming }) => {
  const [expanded, setExpanded] = useState(false)
  if (!reasoning) return null

  return (
    <div
      className={`mb-2.5 rounded-xl border text-xs overflow-hidden ${
        isDark ? 'bg-white/[0.03] border-white/8' : 'bg-zinc-50/90 border-black/6'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-2.5 py-1.5 flex items-center gap-1.5 text-left opacity-75 hover:opacity-100 transition"
      >
        <BrainCircuit size={13} className="text-indigo-500 shrink-0" />
        <span className="font-medium">
          {isStreaming
            ? tr(lang, 'Thinking…', '正在深度推理…')
            : tr(lang, 'View reasoning process', '查看推理思考过程')}
        </span>
        {expanded ? (
          <ChevronDown size={13} className="ml-auto" />
        ) : (
          <ChevronRight size={13} className="ml-auto" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 pt-1 text-[11.5px] leading-relaxed opacity-75 whitespace-pre-wrap border-t border-black/5 dark:border-white/6 max-h-60 overflow-y-auto">
          {reasoning}
        </div>
      )}
    </div>
  )
}

export const ToolStepsBlock: React.FC<{
  steps: AgentToolStep[]
  isDark: boolean
  lang?: AppLanguage
}> = ({ steps, isDark, lang }) => {
  const hasRunning = steps.some((s) => s.status === 'running')
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null)
  const expanded = manualExpanded !== null ? manualExpanded : hasRunning

  if (!steps || steps.length === 0) return null

  const activeOrLast = steps.find((s) => s.status === 'running') || steps[steps.length - 1]

  return (
    <div
      className={`mb-2.5 rounded-xl border text-xs overflow-hidden ${
        isDark
          ? 'bg-white/[0.035] border-white/[0.08] text-zinc-200'
          : 'bg-zinc-50 border-black/[0.07] text-zinc-800'
      }`}
    >
      <button
        type="button"
        onClick={() => setManualExpanded(!expanded)}
        className="w-full px-2.5 py-1.5 flex items-center gap-1.5 text-left hover:opacity-95 transition"
      >
        {hasRunning ? (
          <Loader2 size={13} className="opacity-70 animate-spin shrink-0" />
        ) : (
          <Wrench size={12.5} className="opacity-65 shrink-0" />
        )}
        <span className="font-medium truncate">
          {hasRunning
            ? tr(
                lang,
                `Running: ${activeOrLast.label}${activeOrLast.argsSummary ? ` (${activeOrLast.argsSummary})` : ''}…`,
                `正在执行：${activeOrLast.label}${activeOrLast.argsSummary ? ` (${activeOrLast.argsSummary})` : ''}…`
              )
            : tr(
                lang,
                `Completed ${steps.length} agent step${steps.length === 1 ? '' : 's'}`,
                `已完成 ${steps.length} 步 Agent 工具动作`
              )}
        </span>
        {!expanded && !hasRunning && activeOrLast?.resultSummary && (
          <span className="text-[11px] opacity-55 truncate max-w-[140px]">
            · {activeOrLast.resultSummary}
          </span>
        )}
        {expanded ? (
          <ChevronDown size={13} className="ml-auto opacity-65 shrink-0" />
        ) : (
          <ChevronRight size={13} className="ml-auto opacity-65 shrink-0" />
        )}
      </button>

      {expanded && (
        <div
          className={`px-2.5 py-2 space-y-1.5 border-t text-[11.5px] ${
            isDark ? 'border-white/8' : 'border-indigo-200/50'
          }`}
        >
          {steps.map((step) => (
            <div key={step.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {step.status === 'running' ? (
                    <Loader2 size={11.5} className="text-indigo-500 animate-spin shrink-0" />
                  ) : step.status === 'error' ? (
                    <AlertCircle size={11.5} className="text-rose-500 shrink-0" />
                  ) : (
                    <CheckCircle2 size={11.5} className="text-emerald-500 shrink-0" />
                  )}
                  <span className="font-medium truncate">{step.label}</span>
                  {step.argsSummary && (
                    <span className="opacity-55 font-mono text-[10.5px] truncate max-w-[150px]">
                      {step.argsSummary}
                    </span>
                  )}
                </div>
                {step.resultSummary && (
                  <span className="opacity-60 text-[10.5px] shrink-0 truncate max-w-[150px]">
                    {step.resultSummary}
                  </span>
                )}
              </div>

              {step.imagePreview && (
                <div className="mt-1 rounded-lg overflow-hidden border border-black/10 dark:border-white/10 max-w-[280px]">
                  <img
                    src={step.imagePreview}
                    alt={step.label}
                    className="w-full max-h-36 object-cover object-top"
                  />
                </div>
              )}

              {step.detailPreview && (
                <pre
                  className={`p-2 rounded-lg font-mono text-[10.5px] leading-relaxed overflow-x-auto max-h-40 overflow-y-auto border ${
                    isDark
                      ? 'bg-[#141419] border-white/8 text-zinc-300'
                      : 'bg-zinc-900 border-black/10 text-zinc-100'
                  }`}
                >
                  {step.detailPreview.split('\n').map((line, lIdx) => (
                    <div
                      key={lIdx}
                      className={
                        line.startsWith('+ ')
                          ? 'text-emerald-400'
                          : line.startsWith('- ')
                            ? 'text-rose-400'
                            : line.startsWith('@@')
                              ? 'text-indigo-300 opacity-80'
                              : ''
                      }
                    >
                      {line}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface MarkdownProps {
  content: string
  lang?: AppLanguage
  className?: string
  onOpenLink?: (url: string, openInSplit?: boolean) => void
  onClickCitation?: (titleQuery: string) => void
}

export const ChatMarkdown: React.FC<MarkdownProps> = ({
  content,
  lang,
  className = '',
  onOpenLink,
  onClickCitation
}) => {
  const html = useMemo(() => {
    if (!content) return ''
    const parsed = marked.parse(content) as string
    return enhanceArkoMarkdownHtml(parsed, lang)
  }, [content, lang])

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement | null
    if (!target) return

    // 1) Handle Code Copy button
    const copyBtn = target.closest('[data-dia-copy-code]') as HTMLButtonElement | null
    if (copyBtn) {
      e.preventDefault()
      const wrap = copyBtn.closest('.dia-code-wrap')
      const codeEl = wrap?.querySelector('pre code')
      const rawCode = codeEl?.textContent || ''
      if (rawCode) {
        void navigator.clipboard.writeText(rawCode)
        const prev = copyBtn.textContent
        copyBtn.textContent = tr(lang, '✓ Copied', '✓ 已复制')
        setTimeout(() => {
          copyBtn.textContent = prev || tr(lang, 'Copy', '复制代码')
        }, 1400)
      }
      return
    }

    // 2) Handle [@Citation] pill click
    const citeBtn = target.closest('[data-dia-cite]') as HTMLButtonElement | null
    if (citeBtn) {
      e.preventDefault()
      const citeTitle = citeBtn.getAttribute('data-dia-cite') || ''
      if (citeTitle && onClickCitation) {
        onClickCitation(citeTitle)
      }
      return
    }

    // 3) Intercept any <a> link so it opens inside Arko Browser tabs (or Split View with Alt/Shift)
    const anchor = target.closest('a') as HTMLAnchorElement | null
    if (anchor) {
      const href = anchor.getAttribute('href') || ''
      if (href && /^https?:\/\//i.test(href)) {
        e.preventDefault()
        e.stopPropagation()
        if (onOpenLink) {
          onOpenLink(href, e.altKey || e.shiftKey)
        } else {
          void window.arko.createTab(href)
        }
      }
    }
  }

  return (
    <div
      onClick={handleContainerClick}
      className={`dia-prose ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
