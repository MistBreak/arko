import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ClipboardCheck,
  Columns2,
  Copy,
  CornerDownLeft,
  FileSpreadsheet,
  Loader2,
  PenLine,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Square,
  Wand2,
  X
} from 'lucide-react'
import { tr } from '@shared/i18n'
import type {
  AppLanguage,
  InlineEditableTargetInfo,
  InlineWriteActionPreset,
  InlineWriteStreamPayload,
  WebFormFillProposal
} from '@shared/types'

interface Props {
  isDark: boolean
  lang?: AppLanguage
  target: InlineEditableTargetInfo
  splitViewActive: boolean
  activeModelId: string
  onApplyInlineText: (
    tabId: string,
    text: string,
    mode: 'replace-or-insert' | 'append' | 'replace-all'
  ) => Promise<void>
  onApplyFormFills: (
    tabId: string,
    fills: Array<{ fieldId: string; value: string }>
  ) => Promise<void>
  onOpenSettings: () => void
  isClosing?: boolean
  onClose: () => void
}

export const InlineWriteOverlay: React.FC<Props> = ({
  isDark,
  lang,
  target,
  splitViewActive,
  activeModelId,
  onApplyInlineText,
  onApplyFormFills,
  onOpenSettings,
  isClosing = false,
  onClose
}) => {
  const [mode, setMode] = useState<'inline' | 'form'>(target.initialMode || 'inline')
  const [selectedPreset, setSelectedPreset] = useState<InlineWriteActionPreset>(
    target.selectedText ? 'polish' : 'reply'
  )
  const [instruction, setInstruction] = useState('')
  const [draftResult, setDraftResult] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Form Preview Fill state
  const [formInstruction, setFormInstruction] = useState('')
  const [loadingFormPreview, setLoadingFormPreview] = useState(false)
  const [proposals, setProposals] = useState<WebFormFillProposal[]>([])
  const [checkedFieldIds, setCheckedFieldIds] = useState<Record<string, boolean>>({})
  const [editedValues, setEditedValues] = useState<Record<string, string>>({})

  const activeRequestIdRef = useRef<string | null>(null)
  const promptInputRef = useRef<HTMLInputElement>(null)

  const presetActions = useMemo<
    Array<{
      id: InlineWriteActionPreset
      icon: string
      label: string
      hint: string
    }>
  >(
    () => [
      {
        id: 'continue',
        icon: '✍️',
        label: tr(lang, 'Continue', '智能续写'),
        hint: tr(
          lang,
          'Continue writing naturally from your draft & page context',
          '顺着当前草稿与页面上下文自然续写'
        )
      },
      {
        id: 'polish',
        icon: '✨',
        label: tr(lang, 'Polish', '润色优化'),
        hint: tr(lang, 'Improve clarity, flow, and tone', '优化语感、清晰度与得体度')
      },
      {
        id: 'reply',
        icon: '💬',
        label: tr(lang, 'Reply in Voice', '个人口吻回复'),
        hint: tr(
          lang,
          'Draft a contextual reply matching your personal style',
          '结合网页内容与个人风格起草回复'
        )
      },
      {
        id: 'translate',
        icon: '🌐',
        label: tr(lang, 'Translate', '中英互译'),
        hint: tr(
          lang,
          'Auto-detect language and translate EN ↔ ZH',
          '自动识别语种并翻译为地道中/英文'
        )
      },
      {
        id: 'shorten',
        icon: '📏',
        label: tr(lang, 'Shorten', '精简凝练'),
        hint: tr(lang, 'Make concise without losing key points', '删繁就简，提炼核心表达')
      },
      {
        id: 'expand',
        icon: '📝',
        label: tr(lang, 'Expand', '扩写展开'),
        hint: tr(lang, 'Add supporting detail and transitions', '补充论据细节与礼貌衔接')
      }
    ],
    [lang]
  )

  useEffect(() => {
    setTimeout(() => promptInputRef.current?.focus(), 40)
  }, [mode])

  useEffect(() => {
    const unsub = window.arko.onInlineWriteChunk((chunk: InlineWriteStreamPayload) => {
      if (chunk.requestId !== activeRequestIdRef.current) return
      if (chunk.deltaContent) {
        setDraftResult((prev) => prev + chunk.deltaContent!)
      }
      if (chunk.error) {
        setErrorMsg(chunk.error)
      }
      if (chunk.done) {
        setIsStreaming(false)
      }
    })
    return () => {
      unsub()
      if (activeRequestIdRef.current) {
        void window.arko.abortInlineWriteStream(activeRequestIdRef.current)
      }
    }
  }, [])

  const floatingStyle = useMemo<React.CSSProperties>(() => {
    if (mode === 'form') return {}
    const cardW = 476
    const estimatedH = draftResult || isStreaming ? 360 : 250
    const winW = window.innerWidth
    const winH = window.innerHeight

    const rawLeft = target.anchorRect.x
    const left = Math.max(16, Math.min(winW - cardW - 16, rawLeft))

    const belowTop = target.anchorRect.y + Math.min(target.anchorRect.height, 84) + 10
    const aboveTop = target.anchorRect.y - estimatedH - 10
    const top =
      belowTop + estimatedH < winH - 14
        ? Math.max(52, belowTop)
        : Math.max(52, Math.min(winH - estimatedH - 14, aboveTop))

    return {
      position: 'fixed',
      left,
      top,
      width: cardW
    }
  }, [mode, target.anchorRect, draftResult, isStreaming])

  const runInlineGeneration = async (
    presetOverride?: InlineWriteActionPreset,
    customText?: string
  ): Promise<void> => {
    if (target.isSensitive) return
    const presetToUse = presetOverride ?? selectedPreset
    const instToUse = customText !== undefined ? customText : instruction

    if (activeRequestIdRef.current) {
      await window.arko.abortInlineWriteStream(activeRequestIdRef.current)
    }

    const reqId = `iw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    activeRequestIdRef.current = reqId
    setSelectedPreset(presetToUse)
    setDraftResult('')
    setErrorMsg(null)
    setIsStreaming(true)

    await window.arko.startInlineWriteStream({
      requestId: reqId,
      tabId: target.tabId,
      preset: presetToUse,
      instruction: instToUse,
      selectedText: target.selectedText,
      surroundingValue: target.surroundingValue,
      fieldLabel: target.fieldLabel
    })
  }

  const handleStopStream = (): void => {
    if (activeRequestIdRef.current) {
      void window.arko.abortInlineWriteStream(activeRequestIdRef.current)
    }
    setIsStreaming(false)
  }

  const handleGenerateFormPreview = async (): Promise<void> => {
    if (target.formFields.length === 0 || loadingFormPreview) return
    setLoadingFormPreview(true)
    setErrorMsg(null)
    const res = await window.arko.generateFormFillPreview({
      tabId: target.tabId,
      instruction: formInstruction,
      fields: target.formFields
    })
    setLoadingFormPreview(false)
    if (!res.ok) {
      setErrorMsg(
        res.error || tr(lang, 'Failed to generate form preview.', '生成表单填充预览失败')
      )
      return
    }
    setProposals(res.proposals)
    const nextChecked: Record<string, boolean> = {}
    const nextEdited: Record<string, string> = {}
    for (const p of res.proposals) {
      nextChecked[p.fieldId] = Boolean(p.proposedValue.trim())
      nextEdited[p.fieldId] = p.proposedValue
    }
    setCheckedFieldIds(nextChecked)
    setEditedValues(nextEdited)
  }

  const selectedFormFills = useMemo(() => {
    return proposals
      .filter((p) => checkedFieldIds[p.fieldId])
      .map((p) => ({
        fieldId: p.fieldId,
        value: editedValues[p.fieldId] ?? p.proposedValue
      }))
  }, [proposals, checkedFieldIds, editedValues])

  useEffect(() => {
    const onWindowKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (
        mode === 'inline' &&
        (e.metaKey || e.ctrlKey) &&
        e.key === 'Enter' &&
        draftResult.trim() &&
        !isStreaming
      ) {
        e.preventDefault()
        if (target.found) {
          void onApplyInlineText(target.tabId, draftResult, 'replace-or-insert')
        } else {
          void navigator.clipboard.writeText(draftResult)
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onWindowKeyDown)
    return () => window.removeEventListener('keydown', onWindowKeyDown)
  }, [mode, draftResult, isStreaming, target, onApplyInlineText, onClose])

  return (
    <div
      onClick={onClose}
      className={`fixed inset-0 z-50 ${isClosing ? 'arc-backdrop-exit' : 'arc-backdrop-enter'} ${
        mode === 'form'
          ? 'flex items-center justify-center bg-black/30 backdrop-blur-[2px] p-4'
          : 'bg-black/12'
      }`}
    >
      <div
        style={floatingStyle}
        onClick={(e) => e.stopPropagation()}
        className={`${
          mode === 'form'
            ? `w-full max-w-[630px] max-h-[82vh] flex flex-col ${
                isClosing ? 'arc-modal-exit' : 'arc-modal-enter'
              }`
            : isClosing
              ? 'arc-popover-exit'
              : 'arc-popover-enter'
        } rounded-2xl border shadow-2xl backdrop-blur-2xl overflow-hidden text-xs ${
          isDark
            ? 'bg-[#1E1E26]/96 border-white/14 text-zinc-100 shadow-black/60'
            : 'bg-white/96 border-black/12 text-zinc-900 shadow-zinc-900/20'
        }`}
      >
        {/* Top Mode Bar */}
        <div
          className={`px-3.5 py-2.5 border-b flex items-center justify-between gap-2 ${
            isDark ? 'bg-[#18181F] border-white/8' : 'bg-zinc-50/90 border-black/6'
          }`}
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setMode('inline')
                setErrorMsg(null)
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition ${
                mode === 'inline'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : isDark
                    ? 'text-zinc-400 hover:bg-white/8 hover:text-zinc-200'
                    : 'text-zinc-600 hover:bg-black/6 hover:text-zinc-900'
              }`}
            >
              <PenLine size={12} />
              <span>{tr(lang, 'Inline Write', '光标内联帮写')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('form')
                setErrorMsg(null)
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition ${
                mode === 'form'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : isDark
                    ? 'text-zinc-400 hover:bg-white/8 hover:text-zinc-200'
                    : 'text-zinc-600 hover:bg-black/6 hover:text-zinc-900'
              }`}
            >
              <FileSpreadsheet size={12} />
              <span>
                {tr(
                  lang,
                  `Form Fill Preview (${target.formFields.length})`,
                  `表单预览填充 (${target.formFields.length})`
                )}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {splitViewActive && (
              <span
                title={tr(
                  lang,
                  'Automatically reads sibling Split View pane as reference context',
                  '已自动联动读取分屏另一侧网页正文作为参考背景'
                )}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] bg-indigo-500/15 text-indigo-500 font-medium"
              >
                <Columns2 size={11} />
                <span>{tr(lang, 'Split Linked', '双屏联动')}</span>
              </span>
            )}
            <span className="text-[10.5px] opacity-45 font-mono hidden sm:inline">
              {activeModelId}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg opacity-55 hover:opacity-100 transition"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Sensitive Site Guard Block */}
        {target.isSensitive ? (
          <div className="p-5 flex items-start gap-3 text-amber-600 dark:text-amber-300 bg-amber-500/10">
            <ShieldAlert size={18} className="shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold">
                {tr(lang, 'Sensitive Site Protection Active', '敏感站点隐私护栏保护中')}
              </div>
              <p className="opacity-80 leading-relaxed">
                {tr(
                  lang,
                  'Arko automatically disables input reading and auto-fill on banking, payment, and password-manager domains.',
                  '当前页面属于金融支付或密码管理敏感域名，Arko 已自动禁用输入框读取与自动填充。'
                )}
              </p>
            </div>
          </div>
        ) : mode === 'inline' ? (
          <div className="p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              {target.found ? (
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-mono text-[10px] shrink-0">
                    {target.tagName === 'contenteditable'
                      ? tr(lang, 'Rich Editor', '富文本编辑器')
                      : `<${target.tagName}>`}
                  </span>
                  <span className="truncate opacity-75 font-medium">
                    {target.fieldLabel ||
                      target.placeholder ||
                      tr(lang, 'Locked onto focused input', '已锁定网页输入框光标')}
                  </span>
                  {target.selectedText && (
                    <span className="px-1.5 py-0.5 rounded bg-indigo-500/12 text-indigo-500 shrink-0">
                      {tr(
                        lang,
                        `${target.selectedText.length} chars selected`,
                        `已选 ${target.selectedText.length} 字`
                      )}
                    </span>
                  )}
                </div>
              ) : (
                <div className="opacity-65 truncate">
                  {tr(
                    lang,
                    'No focused input detected (focus a webpage field first to insert directly, or copy output below)',
                    '未检测到聚焦输入框（先点击网页输入框再按 ⌘J 可直接回填光标处，当前结果可一键复制）'
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {presetActions.map((act) => {
                const active = selectedPreset === act.id
                return (
                  <button
                    key={act.id}
                    type="button"
                    disabled={isStreaming}
                    title={act.hint}
                    onClick={() => void runInlineGeneration(act.id)}
                    className={`px-2.5 py-1.5 rounded-xl border text-left transition flex items-center gap-1.5 ${
                      active
                        ? isDark
                          ? 'bg-indigo-500/20 border-indigo-400/50 text-indigo-200 font-medium'
                          : 'bg-indigo-50 border-indigo-300 text-indigo-800 font-medium'
                        : isDark
                          ? 'bg-white/[0.03] border-white/8 hover:bg-white/[0.07]'
                          : 'bg-zinc-50/80 border-black/7 hover:bg-zinc-100'
                    }`}
                  >
                    <span>{act.icon}</span>
                    <span className="truncate">{act.label}</span>
                  </button>
                )
              })}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!instruction.trim() && !target.selectedText && !target.surroundingValue) return
                void runInlineGeneration(instruction.trim() ? 'custom' : selectedPreset)
              }}
              className={`flex items-center gap-2 h-9 px-3 rounded-xl border ${
                isDark
                  ? 'bg-[#15151B] border-white/10 focus-within:border-indigo-400'
                  : 'bg-zinc-50 border-black/10 focus-within:border-indigo-500'
              }`}
            >
              <Sparkles size={13} className="text-indigo-500 shrink-0" />
              <input
                ref={promptInputRef}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder={tr(
                  lang,
                  'Describe what to write or reply, press Enter…',
                  '输入具体写作/回复要求，按 Enter 立即生成…'
                )}
                className="flex-1 bg-transparent outline-none text-xs"
              />
              {isStreaming ? (
                <button
                  type="button"
                  onClick={handleStopStream}
                  className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-medium flex items-center gap-1"
                >
                  <Square size={9} fill="currentColor" />
                  <span>{tr(lang, 'Stop', '停止')}</span>
                </button>
              ) : (
                <button
                  type="submit"
                  className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-500 transition shrink-0"
                >
                  {tr(lang, 'Generate', '生成')}
                </button>
              )}
            </form>

            {(draftResult || isStreaming || errorMsg) && (
              <div className="space-y-2.5 pt-0.5">
                {errorMsg ? (
                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-300 flex items-center justify-between gap-2">
                    <span>{errorMsg}</span>
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-medium shrink-0"
                    >
                      {tr(lang, 'Configure Key', '配置密钥')}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <textarea
                        rows={5}
                        value={draftResult}
                        onChange={(e) => setDraftResult(e.target.value)}
                        placeholder={
                          isStreaming
                            ? tr(lang, 'Arko is drafting…', 'Arko 正在流式起草内容…')
                            : ''
                        }
                        className={`w-full p-2.5 rounded-xl border outline-none text-[12.5px] leading-relaxed resize-y ${
                          isDark
                            ? 'bg-[#141419] border-white/10 text-zinc-100'
                            : 'bg-white border-black/10 text-zinc-800 shadow-2xs'
                        }`}
                      />
                      {isStreaming && (
                        <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5 text-[10.5px] text-indigo-500 bg-indigo-500/10 px-2 py-0.5 rounded-full">
                          <Loader2 size={11} className="animate-spin" />
                          <span>{tr(lang, 'Writing', '生成中')}</span>
                        </div>
                      )}
                    </div>

                    {!isStreaming && draftResult.trim() && (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          {target.found ? (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  void onApplyInlineText(
                                    target.tabId,
                                    draftResult,
                                    'replace-or-insert'
                                  )
                                }
                                className="h-7 px-3 rounded-xl bg-indigo-600 text-white font-medium inline-flex items-center gap-1.5 hover:bg-indigo-500 transition shadow-xs"
                              >
                                <CornerDownLeft size={12} />
                                <span>
                                  {target.selectedText
                                    ? tr(lang, 'Replace Selection', '替换选中内容')
                                    : tr(lang, 'Insert at Cursor', '注入网页光标处')}
                                </span>
                                <kbd className="text-[10px] opacity-75 font-mono">⌘↵</kbd>
                              </button>

                              {target.surroundingValue && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void onApplyInlineText(target.tabId, draftResult, 'append')
                                  }
                                  className={`h-7 px-2.5 rounded-xl border font-medium transition ${
                                    isDark
                                      ? 'border-white/12 hover:bg-white/8'
                                      : 'border-black/10 hover:bg-zinc-100'
                                  }`}
                                >
                                  {tr(lang, 'Append', '追加在后方')}
                                </button>
                              )}
                            </>
                          ) : null}

                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(draftResult)
                              setCopied(true)
                              setTimeout(() => setCopied(false), 1600)
                            }}
                            className={`h-7 px-2.5 rounded-xl border inline-flex items-center gap-1 transition ${
                              isDark
                                ? 'border-white/12 hover:bg-white/8'
                                : 'border-black/10 hover:bg-zinc-100'
                            }`}
                          >
                            {copied ? (
                              <ClipboardCheck size={12} className="text-emerald-500" />
                            ) : (
                              <Copy size={12} />
                            )}
                            <span>
                              {copied ? tr(lang, 'Copied', '已复制') : tr(lang, 'Copy', '复制')}
                            </span>
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => void runInlineGeneration()}
                          className="h-7 px-2 rounded-lg opacity-65 hover:opacity-100 inline-flex items-center gap-1"
                        >
                          <RefreshCw size={11} />
                          <span>{tr(lang, 'Regenerate', '重写')}</span>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Mode 2: Webpage Form Preview Fill */
          <div className="p-4 space-y-3.5 overflow-y-auto flex-1">
            <div className="space-y-1">
              <div className="font-semibold text-[13px] flex items-center gap-2">
                <span>{tr(lang, 'Smart Form Fill Preview', '普通网页表单智能预览填充')}</span>
                <span className="text-[11px] font-normal opacity-60">
                  {tr(
                    lang,
                    '(Passwords & credit cards excluded; review before applying)',
                    '（已自动排除密码、信用卡等敏感输入框，确认预览后才写入网页）'
                  )}
                </span>
              </div>
              {splitViewActive && (
                <div className="text-[11px] text-indigo-500">
                  {tr(
                    lang,
                    '✨ Split View active: ask Arko to fill this form using details from the other pane.',
                    '✨ 分屏模式已激活：可直接输入「根据另一侧分屏网页的信息填写此表单」完成跨页提炼填表。'
                  )}
                </div>
              )}
            </div>

            {target.formFields.length === 0 ? (
              <div
                className={`p-5 rounded-xl border text-center opacity-65 ${
                  isDark ? 'border-white/8 bg-white/[0.02]' : 'border-black/8 bg-zinc-50'
                }`}
              >
                {tr(
                  lang,
                  'No visible standard form controls (<input> / <textarea> / <select>) detected on this page.',
                  '当前网页未检测到可填充的可见表单控件（<input> / <textarea> / <select>）。'
                )}
              </div>
            ) : (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleGenerateFormPreview()
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    ref={promptInputRef}
                    value={formInstruction}
                    onChange={(e) => setFormInstruction(e.target.value)}
                    placeholder={
                      splitViewActive
                        ? tr(
                            lang,
                            'e.g. Fill using details from the other Split View pane (leave empty for smart defaults)…',
                            '例如：根据另一侧分屏文档中的信息填写表单（留空则按个人背景智能拟填）…'
                          )
                        : tr(
                            lang,
                            'e.g. Fill with test profile for Alex Rivera, Product Engineer…',
                            '例如：用产品经理求职者张明的测试资料填写（留空则结合网页自动拟填）…'
                          )
                    }
                    className={`flex-1 h-9 px-3 rounded-xl border outline-none ${
                      isDark
                        ? 'bg-[#15151B] border-white/10 focus:border-indigo-400'
                        : 'bg-zinc-50 border-black/10 focus:border-indigo-500'
                    }`}
                  />
                  <button
                    type="submit"
                    disabled={loadingFormPreview}
                    className="h-9 px-3.5 rounded-xl bg-indigo-600 text-white font-medium inline-flex items-center gap-1.5 hover:bg-indigo-500 disabled:opacity-50 shrink-0"
                  >
                    {loadingFormPreview ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Wand2 size={13} />
                    )}
                    <span>{tr(lang, 'Preview Values', '生成填充预览')}</span>
                  </button>
                </form>

                {errorMsg && (
                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-300">
                    {errorMsg}
                  </div>
                )}

                {proposals.length > 0 ? (
                  <div className="space-y-2.5">
                    <div
                      className={`rounded-xl border divide-y max-h-[290px] overflow-y-auto ${
                        isDark
                          ? 'border-white/10 divide-white/8 bg-white/[0.02]'
                          : 'border-black/8 divide-black/6 bg-zinc-50/50'
                      }`}
                    >
                      {proposals.map((p) => {
                        const checked = Boolean(checkedFieldIds[p.fieldId])
                        return (
                          <div key={p.fieldId} className="p-2.5 flex items-start gap-2.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setCheckedFieldIds({
                                  ...checkedFieldIds,
                                  [p.fieldId]: e.target.checked
                                })
                              }
                              className="mt-1.5 accent-indigo-600 cursor-pointer"
                            />
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium truncate">{p.label}</span>
                                {p.reason && (
                                  <span className="text-[10.5px] opacity-50 truncate">
                                    {p.reason}
                                  </span>
                                )}
                              </div>
                              <input
                                value={editedValues[p.fieldId] ?? p.proposedValue}
                                onChange={(e) =>
                                  setEditedValues({
                                    ...editedValues,
                                    [p.fieldId]: e.target.value
                                  })
                                }
                                className={`w-full h-8 px-2.5 rounded-lg border outline-none text-xs ${
                                  isDark
                                    ? 'bg-[#14141A] border-white/10'
                                    : 'bg-white border-black/10'
                                }`}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="opacity-60">
                        {tr(
                          lang,
                          `${selectedFormFills.length} / ${proposals.length} fields selected`,
                          `已勾选 ${selectedFormFills.length} / ${proposals.length} 个字段`
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={onClose}
                          className="px-3 py-1.5 rounded-xl opacity-70 hover:opacity-100"
                        >
                          {tr(lang, 'Cancel', '取消')}
                        </button>
                        <button
                          type="button"
                          disabled={selectedFormFills.length === 0}
                          onClick={() => void onApplyFormFills(target.tabId, selectedFormFills)}
                          className="h-8 px-4 rounded-xl bg-emerald-600 text-white font-medium inline-flex items-center gap-1.5 hover:bg-emerald-500 disabled:opacity-40 transition"
                        >
                          <Check size={13} />
                          <span>
                            {tr(
                              lang,
                              `Apply Selected (${selectedFormFills.length})`,
                              `确认回填所选字段 (${selectedFormFills.length})`
                            )}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {target.formFields.slice(0, 10).map((f) => (
                      <span
                        key={f.fieldId}
                        className={`px-2 py-0.5 rounded-md text-[11px] border ${
                          isDark
                            ? 'bg-white/4 border-white/8 text-zinc-400'
                            : 'bg-zinc-100 border-black/6 text-zinc-600'
                        }`}
                      >
                        {f.label}
                      </span>
                    ))}
                    {target.formFields.length > 10 && (
                      <span className="px-2 py-0.5 text-[11px] opacity-50">
                        {tr(
                          lang,
                          `+${target.formFields.length - 10} more`,
                          `等共 ${target.formFields.length} 个字段`
                        )}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
