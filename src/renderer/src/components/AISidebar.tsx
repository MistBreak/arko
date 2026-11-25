import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  AtSign,
  BookmarkPlus,
  Bot,
  Camera,
  Check,
  Columns2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  History,
  Layers,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Plug,
  Plus,
  Quote,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  X
} from 'lucide-react'
import {
  getAllSlashSkills,
  isInternalArkoUrl
} from '@shared/constants'
import { tr } from '@shared/i18n'
import type {
  AppSettings,
  ChatMention,
  ChatMessage,
  ChatThread,
  ConnectedToolItem,
  QuotedSelectionPayload,
  SplitViewState,
  TabState
} from '@shared/types'
import { FaviconIcon } from './FaviconIcon'
import { ToolBrandIcon } from './ConnectToolsModal'
import { ChatMarkdown, ReasoningBlock, ToolStepsBlock } from './ChatMarkdown'

interface Props {
  isDark: boolean
  width: number
  onResizeWidth: (w: number) => void
  onResizeDragChange?: (dragging: boolean) => void
  tabs: TabState[]
  activeTab: TabState | undefined
  splitView: SplitViewState
  threads: ChatThread[]
  activeThreadId: string | null
  memoryCount: number
  connectedTools?: ConnectedToolItem[]
  quotedSelection: QuotedSelectionPayload | null
  onClearQuotedSelection: () => void
  onSelectThread: (threadId: string) => void
  onNewThread: () => Promise<ChatThread>
  onDeleteThread: (threadId: string) => void
  onPopOutToTab: (threadId?: string) => void
  settings: AppSettings
  onUpdateSettings: (partial: Partial<AppSettings>) => void
  onSendMessage: (params: {
    threadId: string
    prompt: string
    quotedText?: string
    imageDataUrl?: string
    enableAgentTools?: boolean
    mentions: ChatMention[]
    includeActiveTab: boolean
    providerId?: string
    modelId?: string
  }) => Promise<void>
  onEditUserMessage?: (threadId: string, messageId: string, newPrompt: string) => void
  onCaptureVisionSnapshot?: () => Promise<{
    ok: boolean
    dataUrl?: string
    title?: string
    error?: string
  }>
  onShowToast?: (msg: string) => void
  onRegenerate: (threadId: string) => void
  onAbortStream: (threadId: string) => void
  onSaveMemory: (text: string) => void
  onSwitchToTabUrl: (url: string, openInSplit?: boolean) => void
  onJumpCitationTitle: (titleQuery: string) => void
  onOpenSettings: () => void
  onOpenAccount?: () => void
  onOpenConnectTools?: () => void
  onOpenSkillsEditor: () => void
  pendingSkillCommand?: string | null
  onConsumePendingSkill?: () => void
  onClose: () => void
}

export const AISidebar: React.FC<Props> = ({
  isDark,
  width,
  onResizeWidth,
  onResizeDragChange,
  tabs,
  activeTab,
  splitView,
  threads,
  activeThreadId,
  memoryCount,
  connectedTools = [],
  quotedSelection,
  onClearQuotedSelection,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  onPopOutToTab,
  settings,
  onUpdateSettings,
  onSendMessage,
  onEditUserMessage,
  onCaptureVisionSnapshot,
  onShowToast,
  onRegenerate,
  onAbortStream,
  onSaveMemory,
  onSwitchToTabUrl,
  onJumpCitationTitle,
  onOpenSettings,
  onOpenAccount,
  onOpenConnectTools,
  onOpenSkillsEditor,
  pendingSkillCommand,
  onConsumePendingSkill,
  onClose
}) => {
  const [input, setInput] = useState('')
  const [mentions, setMentions] = useState<ChatMention[]>([])
  const [includeActiveTab, setIncludeActiveTab] = useState(settings.includeActiveTabByDefault)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [showSkillMenu, setShowSkillMenu] = useState(false)
  const [skillIndex, setSkillIndex] = useState(0)
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null)
  const [savedMemId, setSavedMemId] = useState<string | null>(null)
  const [attachedImage, setAttachedImage] = useState<{ dataUrl: string; label: string } | null>(
    null
  )
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [showScrollBottom, setShowScrollBottom] = useState(false)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isPinnedBottomRef = useRef(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const lang = settings.language

  const allSkills = useMemo(
    () => getAllSlashSkills(settings.customSkills, lang),
    [settings.customSkills, lang]
  )

  const filteredSkills = useMemo(() => {
    if (!showSkillMenu) return []
    const q = input.trim().toLowerCase()
    return allSkills.filter(
      (s) =>
        s.command.toLowerCase().startsWith(q) ||
        s.label.toLowerCase().includes(q.replace(/^\//, ''))
    )
  }, [showSkillMenu, input, allSkills])

  const currentThread = threads.find((t) => t.id === activeThreadId) || threads[0] || null
  const isStreaming = Boolean(
    currentThread?.messages.some((m) => m.role === 'assistant' && m.isStreaming)
  )

  const activeProvider =
    settings.providers.find((p) => p.id === settings.activeProviderId) || settings.providers[0]

  const scrollToBottomInstant = useCallback((smooth = false) => {
    const el = scrollContainerRef.current
    if (!el) return
    isPinnedBottomRef.current = true
    setShowScrollBottom(false)
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  const handleScrollContainer = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    const near = dist < 88
    isPinnedBottomRef.current = near
    setShowScrollBottom(!near && el.scrollHeight > el.clientHeight + 160)
  }, [])

  // Auto-pin when user sends a new message or switches threads
  useEffect(() => {
    scrollToBottomInstant(false)
  }, [currentThread?.id, currentThread?.messages.length, scrollToBottomInstant])

  // Zero-jank sticky scroll during SSE streaming (respects user scrolling up!)
  const lastMsg = currentThread?.messages.at(-1)
  useEffect(() => {
    if (isPinnedBottomRef.current) {
      const el = scrollContainerRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
  }, [lastMsg?.content, lastMsg?.reasoning, lastMsg?.toolSteps?.length])

  useEffect(() => {
    if (pendingSkillCommand) {
      setInput(`${pendingSkillCommand} `)
      setShowSkillMenu(false)
      onConsumePendingSkill?.()
      setTimeout(() => textareaRef.current?.focus(), 30)
    }
  }, [pendingSkillCommand, onConsumePendingSkill])

  useEffect(() => {
    if (quotedSelection) {
      setTimeout(() => textareaRef.current?.focus(), 40)
    }
  }, [quotedSelection])

  const realTabs = useMemo(() => tabs.filter((t) => !isInternalArkoUrl(t.url)), [tabs])

  const splitLeftTab = useMemo(
    () =>
      splitView.enabled && splitView.leftTabId
        ? tabs.find((t) => t.id === splitView.leftTabId)
        : undefined,
    [splitView, tabs]
  )
  const splitRightTab = useMemo(
    () =>
      splitView.enabled && splitView.rightTabId
        ? tabs.find((t) => t.id === splitView.rightTabId)
        : undefined,
    [splitView, tabs]
  )
  const hasActiveDualSplitPages = Boolean(
    splitView.enabled &&
      splitLeftTab &&
      splitRightTab &&
      (!isInternalArkoUrl(splitLeftTab.url) || !isInternalArkoUrl(splitRightTab.url))
  )

  const activeConnectedTools = useMemo(
    () => connectedTools.filter((t) => t.status !== 'disconnected'),
    [connectedTools]
  )

  const mentionCandidates = useMemo(() => {
    const q = (mentionQuery ?? '').toLowerCase().trim()
    const items: ChatMention[] = [
      ...activeConnectedTools.map((t) => ({
        type: 'tool' as const,
        toolId: t.id,
        title: t.name,
        url: t.homeUrl
      })),
      {
        type: 'all-tabs',
        title: tr(
          lang,
          `All Open Tabs (${realTabs.length} pages)`,
          `全部打开标签页 (${realTabs.length} 个页面)`
        )
      },
      {
        type: 'history',
        title: tr(lang, 'Semantic Browsing History (@History)', '浏览历史语义检索 (@History)')
      },
      {
        type: 'memory',
        title: tr(
          lang,
          `Personal Memory (@Memory · ${memoryCount})`,
          `个人长期记忆库 (@Memory · ${memoryCount} 条)`
        )
      },
      ...realTabs.map((t) => ({
        type: 'tab' as const,
        tabId: t.id,
        title: t.title || t.url,
        url: t.url,
        favicon: t.favicon
      }))
    ]
    if (!q) return items
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.toolId && item.toolId.toLowerCase().includes(q)) ||
        (item.url && item.url.toLowerCase().includes(q))
    )
  }, [mentionQuery, activeConnectedTools, realTabs, memoryCount, lang])

  const handleInputChange = (val: string): void => {
    setInput(val)

    if (val.startsWith('/') && !val.includes(' ')) {
      setShowSkillMenu(true)
      setSkillIndex(0)
    } else {
      setShowSkillMenu(false)
    }

    const atMatch = val.match(/(?:^|\s)@([^\s@]*)$/)
    if (atMatch) {
      setMentionQuery(atMatch[1])
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
    }
  }

  const applyMentionCandidate = (candidate: ChatMention): void => {
    const cleaned = input.replace(/(?:^|\s)@([^\s@]*)$/, (m) => (m.startsWith(' ') ? ' ' : ''))
    setInput(cleaned)
    setMentionQuery(null)

    const exists = mentions.some(
      (m) =>
        m.type === candidate.type &&
        m.tabId === candidate.tabId &&
        m.toolId === candidate.toolId
    )
    if (!exists && mentions.length < 8) {
      setMentions([...mentions, candidate])
    }
    textareaRef.current?.focus()
  }

  const sendPromptText = async (overridePrompt?: string): Promise<void> => {
    const prompt = (overridePrompt ?? input).trim()
    const activeQuote = overridePrompt === undefined ? quotedSelection : null
    const activeImg = overridePrompt === undefined ? attachedImage : null
    if ((!prompt && !activeQuote && !activeImg) || isStreaming) return

    let threadId = currentThread?.id
    if (!threadId) {
      const created = await onNewThread()
      threadId = created.id
    }

    const currentMentions = [...mentions]
    if (activeQuote && !currentMentions.some((m) => m.tabId === activeQuote.tabId)) {
      currentMentions.push({
        type: 'tab',
        tabId: activeQuote.tabId,
        title: activeQuote.title,
        url: activeQuote.url,
        favicon: activeQuote.favicon
      })
    }

    if (overridePrompt === undefined) {
      setInput('')
      setMentions([])
      setAttachedImage(null)
      onClearQuotedSelection()
    }
    setMentionQuery(null)
    setShowSkillMenu(false)
    isPinnedBottomRef.current = true

    await onSendMessage({
      threadId,
      prompt:
        prompt ||
        (activeQuote
          ? '请结合页面上下文解读这段选中内容：'
          : '请结合这张网页视觉截图深入分析其内容与关键细节：'),
      quotedText: activeQuote?.text,
      imageDataUrl: activeImg?.dataUrl,
      enableAgentTools: settings.agentModeEnabled !== false,
      mentions: currentMentions,
      includeActiveTab
    })
  }

  const handleCapturePageVision = async (): Promise<void> => {
    if (!onCaptureVisionSnapshot) return
    const res = await onCaptureVisionSnapshot()
    if (res.ok && res.dataUrl) {
      setAttachedImage({
        dataUrl: res.dataUrl,
        label: res.title || '当前网页画面'
      })
      textareaRef.current?.focus()
    } else if (res.error) {
      onShowToast?.(res.error)
    }
  }

  const handlePasteClipboardImage = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (!file) continue
        e.preventDefault()
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            setAttachedImage({ dataUrl: reader.result, label: '剪贴板截图' })
          }
        }
        reader.readAsDataURL(file)
        break
      }
    }
  }

  const handleExportThreadMarkdown = (): void => {
    if (!currentThread || currentThread.messages.length === 0) return
    const mdLines = [
      `# ${currentThread.title || tr(lang, 'Arko Chat Log', 'Arko 对话记录')}`,
      `> ${tr(lang, 'Exported:', '导出时间：')} ${new Date().toLocaleString()}`,
      ''
    ]
    for (const m of currentThread.messages) {
      if (m.role === 'user') {
        mdLines.push(`## 🧑 ${tr(lang, 'Prompt', '提问')}`, '')
        if (m.quotedText) mdLines.push(`> ${m.quotedText.replace(/\n/g, '\n> ')}`, '')
        mdLines.push(m.content, '')
      } else {
        mdLines.push(`## ✨ Arko (${m.modelId || 'AI'})`, '')
        mdLines.push(m.content || '', '')
      }
    }
    void navigator.clipboard.writeText(mdLines.join('\n'))
    onShowToast?.(
      tr(
        lang,
        '📋 Exported conversation as Markdown to clipboard',
        '📋 已将完整对话导出为 Markdown 到剪贴板'
      )
    )
  }

  const applySkillOption = (command: string, immediateExec?: boolean): void => {
    setShowSkillMenu(false)
    if (immediateExec) {
      setInput('')
      void sendPromptText(command)
    } else {
      setInput(`${command} `)
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (showSkillMenu && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSkillIndex((i) => (i + 1) % filteredSkills.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSkillIndex((i) => (i - 1 + filteredSkills.length) % filteredSkills.length)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        const targetSkill = filteredSkills[skillIndex]
        if (targetSkill) {
          setInput(`${targetSkill.command} `)
          setShowSkillMenu(false)
        }
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const exact = filteredSkills.find(
          (s) => s.command.toLowerCase() === input.trim().toLowerCase()
        )
        if (!exact) {
          e.preventDefault()
          const targetSkill = filteredSkills[skillIndex]
          if (targetSkill) {
            applySkillOption(
              targetSkill.command,
              Boolean(targetSkill.executionKind && targetSkill.executionKind !== 'ai')
            )
          }
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSkillMenu(false)
        return
      }
    }

    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % mentionCandidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        applyMentionCandidate(mentionCandidates[mentionIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendPromptText()
    }
  }

  const handleStartResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    onResizeDragChange?.(true)

    const onMove = (moveEvt: MouseEvent): void => {
      const delta = startX - moveEvt.clientX
      const next = Math.max(320, Math.min(580, startWidth + delta))
      onResizeWidth(next)
    }
    const onUp = (): void => {
      onResizeDragChange?.(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <aside
      style={{ width }}
      className={`relative shrink-0 h-full flex flex-col border-l select-none transition-colors ${
        isDark
          ? 'bg-[#1C1C21]/88 backdrop-blur-xl border-white/[0.08] text-zinc-100'
          : 'bg-white/82 backdrop-blur-xl border-black/[0.07] text-zinc-800'
      }`}
    >
      {/* Left Resize Sash (double-click resets default width) */}
      <div
        onMouseDown={handleStartResize}
        onDoubleClick={() => onResizeWidth(380)}
        title="拖拽调节侧栏宽度 · 双击恢复默认宽度"
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/15 transition z-20"
      />

      {/* Top Header */}
      <div
        className={`app-drag h-[38px] px-3 flex items-center justify-between gap-2 border-b ${
          isDark ? 'border-white/[0.06]' : 'border-black/[0.06]'
        }`}
      >
        <div className="app-no-drag flex items-center gap-1.5 min-w-0 flex-1">
          <MessageSquare size={13.5} className="opacity-60 shrink-0" />
          <select
            value={currentThread?.id || ''}
            onChange={(e) => {
              if (e.target.value) onSelectThread(e.target.value)
            }}
            className="bg-transparent text-xs font-medium truncate outline-none cursor-pointer max-w-[155px]"
          >
            {threads.length === 0 && (
              <option value="">{tr(lang, 'Chat', '对话')}</option>
            )}
            {threads.map((th) => (
              <option
                key={th.id}
                value={th.id}
                className={isDark ? 'bg-[#222225] text-zinc-100' : 'bg-white text-zinc-900'}
              >
                {th.title || tr(lang, 'New Chat', '新对话')}
              </option>
            ))}
          </select>
        </div>

        <div className="app-no-drag flex items-center gap-0.5">
          {currentThread && currentThread.messages.length > 0 && (
            <button
              onClick={handleExportThreadMarkdown}
              title="复制完整对话记录为 Markdown"
              className={`p-1.5 rounded-lg opacity-60 hover:opacity-100 transition ${
                isDark ? 'hover:bg-white/8' : 'hover:bg-black/5'
              }`}
            >
              <Download size={13} />
            </button>
          )}
          <button
            onClick={() => onPopOutToTab(currentThread?.id)}
            title="在独立浏览器标签页中展开此对话"
            className={`p-1.5 rounded-lg opacity-60 hover:opacity-100 transition ${
              isDark ? 'hover:bg-white/8' : 'hover:bg-black/5'
            }`}
          >
            <Maximize2 size={13} />
          </button>
          <button
            onClick={() => void onNewThread()}
            title="新建对话"
            className={`p-1.5 rounded-lg opacity-60 hover:opacity-100 transition ${
              isDark ? 'hover:bg-white/8' : 'hover:bg-black/5'
            }`}
          >
            <MessageSquarePlus size={13.5} />
          </button>
          {currentThread && (
            <button
              onClick={() => onDeleteThread(currentThread.id)}
              title="删除当前对话"
              className={`p-1.5 rounded-lg opacity-50 hover:opacity-100 transition ${
                isDark ? 'hover:bg-white/8' : 'hover:bg-black/5'
              }`}
            >
              <Trash2 size={13.5} />
            </button>
          )}
          <button
            onClick={onClose}
            title="收起对话侧边栏 (⌘E)"
            className={`p-1.5 rounded-lg opacity-55 hover:opacity-100 transition ${
              isDark ? 'hover:bg-white/8' : 'hover:bg-black/5'
            }`}
          >
            <X size={14.5} />
          </button>
        </div>
      </div>

      {/* Conversation Body */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScrollContainer}
        className="flex-1 overflow-y-auto px-3.5 py-4 space-y-4"
      >
        {(!currentThread || currentThread.messages.length === 0) && (
          <div className="h-full flex flex-col items-center justify-center text-center px-3 py-6 space-y-4">
            <div className="space-y-1">
              <div className="text-sm font-medium opacity-85">
                {tr(lang, 'Ask anything about this page', '围绕当前页面随时提问')}
              </div>
              <p className="text-xs opacity-45 leading-relaxed max-w-[260px]">
                {hasActiveDualSplitPages
                  ? tr(
                      lang,
                      'Split View active — reads both panes together.',
                      '已开启双屏并排，将自动结合两侧页面作答。'
                    )
                  : tr(
                      lang,
                      'Type @ to cite tabs or history, or / for quick skills.',
                      '输入 @ 引用其他标签或历史，输入 / 调用快捷技能。'
                    )}
              </p>
            </div>

            <div className="w-full flex flex-wrap items-center justify-center gap-1.5 pt-1">
              {allSkills.slice(0, 4).map((s) => {
                const immediate = Boolean(s.executionKind && s.executionKind !== 'ai')
                return (
                  <button
                    key={s.id || s.command}
                    onClick={() => applySkillOption(s.command, immediate)}
                    className={`px-2.5 py-1 rounded-full border text-[11.5px] transition ${
                      isDark
                        ? 'bg-white/[0.04] border-white/[0.08] text-zinc-300 hover:bg-white/[0.08]'
                        : 'bg-white border-black/[0.07] text-zinc-700 hover:bg-black/[0.04]'
                    }`}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {currentThread?.messages.map((msg: ChatMessage, idx: number) => {
          const isLastAssistant =
            msg.role === 'assistant' && idx === currentThread.messages.length - 1

          if (msg.role === 'user') {
            const isEditing = editingMsgId === msg.id
            return (
              <div key={msg.id} className="group/user flex flex-col items-end space-y-1">
                {msg.mentions && msg.mentions.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-1">
                    {msg.mentions.map((m, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-indigo-500/15 text-indigo-500 font-medium"
                      >
                        <AtSign size={10} />
                        <span className="max-w-[140px] truncate">{m.title}</span>
                      </span>
                    ))}
                  </div>
                )}
                {msg.imageAttachment && (
                  <div className="max-w-[78%] rounded-xl overflow-hidden border border-black/10 dark:border-white/12 shadow-2xs">
                    <img
                      src={msg.imageAttachment}
                      alt="网页视觉快照"
                      className="max-h-36 object-cover object-top"
                    />
                  </div>
                )}
                {msg.quotedText && (
                  <div
                    className={`max-w-[88%] px-2.5 py-1.5 rounded-xl border text-[11.5px] italic opacity-80 flex items-start gap-1.5 ${
                      isDark ? 'bg-white/4 border-white/10' : 'bg-white border-black/8'
                    }`}
                  >
                    <Quote size={11} className="text-indigo-500 shrink-0 mt-0.5" />
                    <span className="line-clamp-3">{msg.quotedText}</span>
                  </div>
                )}

                {isEditing ? (
                  <div
                    className={`w-full max-w-[92%] rounded-2xl p-2.5 border space-y-2 ${
                      isDark ? 'bg-[#25252F] border-indigo-400/50' : 'bg-white border-indigo-400 shadow-xs'
                    }`}
                  >
                    <textarea
                      rows={3}
                      autoFocus
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && currentThread) {
                          e.preventDefault()
                          onEditUserMessage?.(currentThread.id, msg.id, editingText)
                          setEditingMsgId(null)
                        } else if (e.key === 'Escape') {
                          setEditingMsgId(null)
                        }
                      }}
                      className="w-full resize-none bg-transparent outline-none text-xs leading-relaxed"
                    />
                    <div className="flex items-center justify-end gap-1.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setEditingMsgId(null)}
                        className="px-2 py-0.5 rounded-lg opacity-65 hover:opacity-100"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        disabled={!editingText.trim() || !currentThread}
                        onClick={() => {
                          if (!currentThread || !editingText.trim()) return
                          onEditUserMessage?.(currentThread.id, msg.id, editingText)
                          setEditingMsgId(null)
                        }}
                        className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-500 disabled:opacity-40"
                      >
                        保存重发
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className={`max-w-[88%] rounded-2xl rounded-br-sm px-3.5 py-2.5 text-[13px] leading-relaxed select-text whitespace-pre-wrap ${
                        isDark
                          ? 'bg-[#2B2B2F] text-zinc-100'
                          : 'bg-zinc-900 text-white shadow-xs'
                      }`}
                    >
                      {msg.content}
                    </div>
                    {!isStreaming && (
                      <div className="flex items-center gap-1 opacity-0 group-hover/user:opacity-75 transition text-[10.5px]">
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(msg.content)
                            onShowToast?.('已复制提问内容')
                          }}
                          className="px-1.5 py-0.5 rounded hover:bg-black/6 dark:hover:bg-white/10 inline-flex items-center gap-1"
                        >
                          <Copy size={10} />
                          <span>复制</span>
                        </button>
                        {onEditUserMessage && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMsgId(msg.id)
                              setEditingText(msg.content)
                            }}
                            className="px-1.5 py-0.5 rounded hover:bg-black/6 dark:hover:bg-white/10 inline-flex items-center gap-1"
                          >
                            <Pencil size={10} />
                            <span>编辑重发</span>
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          }

          return (
            <div key={msg.id} className="space-y-1.5 group">
              {msg.referencedUrls && msg.referencedUrls.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {msg.referencedUrls.map((ref, rIdx) => (
                    <button
                      key={rIdx}
                      onClick={(e) => onSwitchToTabUrl(ref.url, e.altKey || e.shiftKey)}
                      title={`点击定位到标签页（按住 Option 分屏打开）：${ref.url}`}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] border transition ${
                        isDark
                          ? 'bg-white/4 border-white/8 hover:bg-white/10 text-zinc-400'
                          : 'bg-white border-black/6 hover:bg-zinc-50 text-zinc-600'
                      }`}
                    >
                      <FaviconIcon url={ref.url} size={11} />
                      <span className="max-w-[140px] truncate">{ref.title}</span>
                    </button>
                  ))}
                </div>
              )}

              <div
                className={`rounded-2xl p-3 border ${
                  isDark
                    ? 'bg-[#252528] border-white/[0.07] text-zinc-100'
                    : 'bg-white border-black/[0.07] text-zinc-800 shadow-2xs'
                }`}
              >
                {msg.toolSteps && msg.toolSteps.length > 0 && (
                  <ToolStepsBlock steps={msg.toolSteps} isDark={isDark} lang={lang} />
                )}

                {msg.reasoning && (
                  <ReasoningBlock
                    reasoning={msg.reasoning}
                    isDark={isDark}
                    lang={lang}
                    isStreaming={msg.isStreaming}
                  />
                )}

                {msg.content ? (
                  <ChatMarkdown
                    content={msg.content}
                    lang={lang}
                    onOpenLink={onSwitchToTabUrl}
                    onClickCitation={onJumpCitationTitle}
                  />
                ) : msg.isStreaming && !msg.error ? (
                  <div className="flex items-center gap-2 text-xs opacity-55 py-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                    <span>
                      {tr(lang, 'Reading context and thinking…', '正在阅读上下文并生成回答…')}
                    </span>
                  </div>
                ) : null}

                {msg.localAction?.imageDataUrl && (
                  <div className="mt-2.5 rounded-xl overflow-hidden border border-black/8 dark:border-white/10">
                    <img
                      src={msg.localAction.imageDataUrl}
                      alt="Screenshot preview"
                      className="w-full max-h-52 object-cover object-top"
                    />
                  </div>
                )}

                {msg.localAction?.savedPath && (
                  <div className="mt-2 pt-1.5 flex items-center gap-2">
                    <button
                      onClick={() => void window.arko.revealInFinder(msg.localAction!.savedPath!)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
                        isDark
                          ? 'bg-white/6 border-white/10 hover:bg-white/12'
                          : 'bg-zinc-50 border-black/8 hover:bg-zinc-100'
                      }`}
                    >
                      <FolderOpen size={12} className="text-indigo-500" />
                      <span>{tr(lang, 'Reveal in Finder / Folder', '在文件夹中查看文件')}</span>
                    </button>
                  </div>
                )}

                {msg.error && (
                  <div className="mt-1 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-600 dark:text-rose-300 space-y-2">
                    <ChatMarkdown content={msg.error} lang={lang} onOpenLink={onSwitchToTabUrl} />
                    <div className="flex items-center gap-2 pt-1">
                      {onOpenAccount && (
                        <button
                          onClick={onOpenAccount}
                          className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-medium text-[11px]"
                        >
                          {tr(lang, 'Sign in to Arko Account', '登录 Arko 账号')}
                        </button>
                      )}
                      <button
                        onClick={onOpenSettings}
                        className="px-2.5 py-1 rounded-lg border border-current/25 font-medium text-[11px]"
                      >
                        {tr(lang, 'Model Settings', '模型渠道设置')}
                      </button>
                    </div>
                  </div>
                )}

                {!msg.isStreaming && !msg.error && msg.content && (
                  <div className="mt-2.5 pt-1.5 border-t border-black/5 dark:border-white/6 flex items-center justify-between gap-1 text-[10.5px]">
                    <span className="opacity-40 truncate max-w-[110px]">{msg.modelId}</span>
                    <div className="flex items-center gap-0.5 opacity-65 group-hover:opacity-100 transition">
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(msg.content)
                          setCopiedMsgId(msg.id)
                          setTimeout(() => setCopiedMsgId(null), 1400)
                        }}
                        className="px-1.5 py-0.5 rounded hover:bg-black/6 dark:hover:bg-white/10 inline-flex items-center gap-1"
                        title="复制 Markdown"
                      >
                        {copiedMsgId === msg.id ? (
                          <Check size={11} className="text-emerald-500" />
                        ) : (
                          <Copy size={11} />
                        )}
                        <span>{copiedMsgId === msg.id ? tr(lang, 'Copied', '已复制') : tr(lang, 'Copy', '复制')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const snippet = msg.content
                            .replace(/[#>*`]/g, '')
                            .replace(/\s+/g, ' ')
                            .trim()
                            .slice(0, 160)
                          if (snippet) {
                            onSaveMemory(snippet)
                            setSavedMemId(msg.id)
                            setTimeout(() => setSavedMemId(null), 1600)
                          }
                        }}
                        className="px-1.5 py-0.5 rounded hover:bg-black/6 dark:hover:bg-white/10 inline-flex items-center gap-1"
                        title={tr(lang, 'Save to Arko Memory', '存入 Arko 长期记忆')}
                      >
                        {savedMemId === msg.id ? (
                          <Check size={11} className="text-indigo-500" />
                        ) : (
                          <BookmarkPlus size={11} />
                        )}
                        <span>{savedMemId === msg.id ? tr(lang, 'Saved', '已记住') : tr(lang, 'Remember', '记住')}</span>
                      </button>

                      {isLastAssistant && currentThread && (
                        <button
                          type="button"
                          onClick={() => onRegenerate(currentThread.id)}
                          className="px-1.5 py-0.5 rounded hover:bg-black/6 dark:hover:bg-white/10 inline-flex items-center gap-1"
                          title={tr(lang, 'Regenerate reply', '重新生成回答')}
                        >
                          <RefreshCw size={10} />
                          <span>{tr(lang, 'Retry', '重试')}</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Follow-up Suggestion Pills */}
              {isLastAssistant &&
                !msg.isStreaming &&
                msg.followUps &&
                msg.followUps.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {msg.followUps.map((fText, fIdx) => (
                      <button
                        key={fIdx}
                        type="button"
                        onClick={() => void sendPromptText(fText)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] border text-left transition ${
                          isDark
                            ? 'bg-white/[0.03] border-white/10 hover:border-indigo-400/50 hover:bg-indigo-500/10 text-zinc-200'
                            : 'bg-white border-black/8 hover:border-indigo-400/60 hover:bg-indigo-50/60 text-zinc-700 shadow-2xs'
                        }`}
                      >
                        <span className="truncate max-w-[240px]">{fText}</span>
                        <ArrowUpRight size={11} className="text-indigo-500 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Composer with @Mention, /Skill, Vision & Agent Harness */}
      <div className="p-3 pt-1 relative">
        {showScrollBottom && (
          <button
            type="button"
            onClick={() => scrollToBottomInstant(true)}
            className={`absolute left-1/2 -translate-x-1/2 -top-8 z-20 px-3 py-1 rounded-full text-[11px] font-medium border shadow-md inline-flex items-center gap-1 transition ${
              isDark
                ? 'bg-[#25252E]/95 border-white/12 text-zinc-100 hover:bg-indigo-600'
                : 'bg-white/95 border-black/10 text-zinc-800 hover:bg-indigo-50'
            }`}
          >
            <ArrowDown size={11} className="text-indigo-500" />
            <span>回到最新回复</span>
          </button>
        )}
        {mentionQuery !== null && mentionCandidates.length > 0 && (
          <div
            className={`absolute left-3 right-3 bottom-full mb-1.5 rounded-2xl border shadow-xl p-1.5 z-30 max-h-60 overflow-y-auto ${
              isDark
                ? 'bg-[#25252D] border-white/12 text-zinc-100'
                : 'bg-white border-black/10 text-zinc-800'
            }`}
          >
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider opacity-45">
              引用标签页、浏览历史或记忆 (@Mentions)
            </div>
            {mentionCandidates.map((cand, idx) => (
              <button
                key={`${cand.type}-${cand.tabId || idx}`}
                onClick={() => applyMentionCandidate(cand)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-left transition ${
                  idx === mentionIndex
                    ? 'bg-indigo-600 text-white'
                    : isDark
                      ? 'hover:bg-white/8'
                      : 'hover:bg-zinc-100'
                }`}
              >
                {cand.type === 'tool' && cand.toolId ? (
                  <ToolBrandIcon id={cand.toolId} size={14} />
                ) : cand.type === 'all-tabs' ? (
                  <Layers size={14} className="shrink-0" />
                ) : cand.type === 'history' ? (
                  <History size={14} className="shrink-0" />
                ) : cand.type === 'memory' ? (
                  <Sparkles size={14} className="shrink-0" />
                ) : (
                  <FaviconIcon url={cand.url} favicon={cand.favicon} size={14} />
                )}
                <span className="truncate flex-1 font-medium">{cand.title}</span>
                {cand.type === 'tool' && (
                  <span className="text-[10px] opacity-60 shrink-0">
                    {tr(lang, 'Connected', '已连接')}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {showSkillMenu && (
          <div
            className={`absolute left-3 right-3 bottom-full mb-1.5 rounded-2xl border shadow-xl p-1.5 z-30 max-h-72 overflow-y-auto ${
              isDark
                ? 'bg-[#25252D] border-white/12 text-zinc-100'
                : 'bg-white border-black/10 text-zinc-800'
            }`}
          >
            <div className="px-2 py-1 flex items-center justify-between text-[10px] uppercase tracking-wider opacity-50">
              <span>{tr(lang, 'Arko Slash Skills (/Skills)', 'Arko 快捷技能 (/Skills)')}</span>
              <span>{tr(lang, '↑↓ Select · Enter Run', '↑↓ 选择 · Enter 执行')}</span>
            </div>

            {filteredSkills.map((skill, idx) => {
              const active = idx === skillIndex
              const isImmediate = Boolean(skill.executionKind && skill.executionKind !== 'ai')
              return (
                <button
                  key={skill.id || skill.command}
                  onMouseEnter={() => setSkillIndex(idx)}
                  onClick={() => applySkillOption(skill.command, isImmediate)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-left transition ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : isDark
                        ? 'hover:bg-white/8'
                        : 'hover:bg-zinc-100'
                  }`}
                >
                  <span className="shrink-0 text-sm">{skill.icon || '✨'}</span>
                  <span
                    className={`font-mono font-semibold ${
                      active ? 'text-white' : 'text-indigo-500'
                    }`}
                  >
                    {skill.command}
                  </span>
                  <span className="truncate flex-1 opacity-90">{skill.label}</span>
                </button>
              )
            })}

            <div className={`my-1 border-t ${isDark ? 'border-white/8' : 'border-black/6'}`} />
            <button
              type="button"
              onClick={() => {
                setShowSkillMenu(false)
                onOpenSkillsEditor()
              }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs transition ${
                isDark ? 'hover:bg-white/8 text-indigo-400' : 'hover:bg-zinc-100 text-indigo-600'
              }`}
            >
              <Plus size={13} />
              <span className="font-medium">新建 / 管理自定义 /Skills 技能…</span>
            </button>
          </div>
        )}

        <div
          className={`rounded-[16px] border p-2.5 transition-colors ${
            isDark
              ? 'bg-[#252528] border-white/[0.08] focus-within:border-white/[0.15]'
              : 'bg-white border-black/[0.08] focus-within:border-black/[0.16] shadow-xs'
          }`}
        >
          {/* Webpage Vision Attachment Preview */}
          {attachedImage && (
            <div
              className={`mb-2 p-2 rounded-xl border text-[11px] flex items-center justify-between gap-2.5 ${
                isDark
                  ? 'bg-indigo-500/10 border-indigo-500/25 text-indigo-200'
                  : 'bg-indigo-50/75 border-indigo-200 text-indigo-900'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src={attachedImage.dataUrl}
                  alt="Vision preview"
                  className="w-12 h-9 rounded-lg object-cover object-top border border-black/10 dark:border-white/10 shrink-0"
                />
                <div className="min-w-0">
                  <div className="font-semibold text-indigo-500 truncate">
                    📸 已附带视觉画面
                  </div>
                  <div className="opacity-75 truncate">{attachedImage.label}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAttachedImage(null)}
                className="p-0.5 rounded opacity-60 hover:opacity-100 shrink-0"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Webpage Selection Quote Attachment */}
          {quotedSelection && (
            <div
              className={`mb-2 p-2 rounded-xl border text-[11px] flex items-start justify-between gap-2 ${
                isDark
                  ? 'bg-indigo-500/10 border-indigo-500/25 text-indigo-200'
                  : 'bg-indigo-50/75 border-indigo-200 text-indigo-900'
              }`}
            >
              <div className="min-w-0 space-y-0.5">
                <div className="font-semibold flex items-center gap-1 text-indigo-500">
                  <Quote size={10} />
                  <span className="truncate">引用自：{quotedSelection.title}</span>
                </div>
                <div className="opacity-80 line-clamp-2 italic">{quotedSelection.text}</div>
              </div>
              <button
                type="button"
                onClick={onClearQuotedSelection}
                className="p-0.5 rounded opacity-60 hover:opacity-100 shrink-0"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Context Chips Bar */}
          <div className="flex flex-wrap items-center gap-1.5 pb-1.5">
            {hasActiveDualSplitPages ? (
              <button
                type="button"
                onClick={() => setIncludeActiveTab(!includeActiveTab)}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] border transition max-w-full ${
                  includeActiveTab
                    ? isDark
                      ? 'bg-indigo-500/18 border-indigo-500/35 text-indigo-300'
                      : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'opacity-45 border-transparent hover:opacity-80'
                }`}
              >
                {includeActiveTab ? <Columns2 size={11} /> : <EyeOff size={11} />}
                <span className="truncate max-w-[205px] font-medium">
                  双屏上下文：{(splitLeftTab?.title || '左屏').slice(0, 10)} +{' '}
                  {(splitRightTab?.title || '右屏').slice(0, 10)}
                </span>
              </button>
            ) : activeTab && !isInternalArkoUrl(activeTab.url) ? (
              <button
                type="button"
                onClick={() => setIncludeActiveTab(!includeActiveTab)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] border transition max-w-full ${
                  activeTab.isSensitive
                    ? 'bg-amber-500/12 border-amber-500/30 text-amber-500'
                    : includeActiveTab
                      ? isDark
                        ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
                        : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      : 'opacity-45 border-transparent hover:opacity-80'
                }`}
              >
                {activeTab.isSensitive ? (
                  <ShieldAlert size={11} />
                ) : includeActiveTab ? (
                  <Eye size={11} />
                ) : (
                  <EyeOff size={11} />
                )}
                <span className="truncate max-w-[165px]">
                  {activeTab.isSensitive
                    ? tr(lang, 'Protected Site', '隐私护栏保护中')
                    : activeTab.title || tr(lang, 'Current Page', '当前页')}
                </span>
              </button>
            ) : null}

            {mentions.map((m, i) => (
              <span
                key={`${m.type}-${m.tabId || i}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] bg-indigo-600 text-white"
              >
                <AtSign size={10} />
                <span className="truncate max-w-[125px]">{m.title}</span>
                <button
                  onClick={() => setMentions(mentions.filter((_, idx) => idx !== i))}
                  className="hover:opacity-75"
                >
                  <X size={10} />
                </button>
              </span>
            ))}

            <button
              type="button"
              onClick={() => {
                setInput((prev) =>
                  prev.endsWith('@') ? prev : `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}@`
                )
                setMentionQuery('')
                textareaRef.current?.focus()
              }}
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] transition ${
                isDark ? 'hover:bg-white/8 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'
              }`}
              title={tr(lang, 'Reference connected tools, tabs, history, or memory (@)', '引用已连接工具、标签页、历史或记忆 (@)')}
            >
              <AtSign size={11} />
              <span>{tr(lang, 'Mention', '引用')}</span>
            </button>

            {onOpenConnectTools && (
              <button
                type="button"
                onClick={onOpenConnectTools}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] transition ${
                  isDark ? 'hover:bg-white/8 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'
                }`}
                title={tr(lang, 'Connect your Tools', '连接你的常用工具')}
              >
                <Plug size={11} />
                <span>
                  {activeConnectedTools.length > 0
                    ? `${tr(lang, 'Tools', '工具')} (${activeConnectedTools.length})`
                    : tr(lang, 'Tools', '工具')}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setInput('/')
                setShowSkillMenu(true)
                setSkillIndex(0)
                textareaRef.current?.focus()
              }}
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] transition ${
                isDark ? 'hover:bg-white/8 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'
              }`}
              title={tr(lang, 'Invoke /Skills', '调用 /Skills 快捷技能')}
            >
              <Wand2 size={11} />
              <span>{tr(lang, '/Skills', '/技能')}</span>
            </button>

            {onCaptureVisionSnapshot && (
              <button
                type="button"
                onClick={() => void handleCapturePageVision()}
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] transition ${
                  attachedImage
                    ? 'bg-indigo-500/18 text-indigo-500 font-medium'
                    : isDark
                      ? 'hover:bg-white/8 text-zinc-400'
                      : 'hover:bg-zinc-100 text-zinc-500'
                }`}
                title={tr(lang, 'Attach viewport screenshot (or paste with ⌘V)', '附带当前网页画面截图进行多模态视觉提问（也支持直接 ⌘V 粘贴截图）')}
              >
                <Camera size={11} />
                <span>{tr(lang, 'Vision', '画面')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                onUpdateSettings({ agentModeEnabled: !(settings.agentModeEnabled !== false) })
              }
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] border transition ${
                settings.agentModeEnabled !== false
                  ? isDark
                    ? 'bg-violet-500/18 border-violet-400/35 text-violet-300 font-medium'
                    : 'bg-violet-50 border-violet-200 text-violet-700 font-medium'
                  : 'opacity-45 border-transparent hover:opacity-85'
              }`}
              title={tr(
                lang,
                'Allow Arko Agent to inspect tabs, search history, open Split View, and interact with pages',
                '开启后 Arko 可自主感知所有打开标签、检索历史、打开分屏或在网页执行点击/填框/滚动操作'
              )}
            >
              <Bot size={11} />
              <span>Agent</span>
            </button>

            {settings.codingWorkspacePath ? (
              <span
                title={tr(
                  lang,
                  `Bound workspace: ${settings.codingWorkspacePath}`,
                  `当前绑定本地代码工作区：${settings.codingWorkspacePath}`
                )}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border font-medium ${
                  isDark
                    ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
              >
                <FolderOpen size={11} />
                <button
                  type="button"
                  onClick={() => void window.arko.selectCodingWorkspace()}
                  className="truncate max-w-[115px] hover:underline"
                >
                  {settings.codingWorkspacePath.split(/[\\/]/).filter(Boolean).pop() ||
                    tr(lang, 'Workspace', '代码目录')}
                </button>
                <button
                  type="button"
                  onClick={() => void window.arko.clearCodingWorkspace()}
                  title={tr(lang, 'Unlink workspace', '解绑代码目录')}
                  className="opacity-65 hover:opacity-100"
                >
                  <X size={10} />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void window.arko.selectCodingWorkspace()}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] transition ${
                  isDark ? 'hover:bg-white/8 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'
                }`}
                title={tr(
                  lang,
                  'Bind a local code repository to enable full-stack Coding Agent tools',
                  '绑定本地代码文件夹，启用全栈编码 Agent 能力'
                )}
              >
                <FolderOpen size={11} />
                <span>{tr(lang, 'Repo', '代码目录')}</span>
              </button>
            )}
          </div>

          <textarea
            ref={textareaRef}
            rows={2}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePasteClipboardImage}
            placeholder={
              quotedSelection
                ? tr(
                    lang,
                    'Ask a follow-up on the quoted passage (press Enter)…',
                    '输入针对上述选中段落的追问（直接按 Enter 解读）…'
                  )
                : attachedImage
                  ? tr(
                      lang,
                      'Ask about the attached screenshot (press Enter)…',
                      '输入针对网页视觉截图的问题（直接按 Enter 分析画面）…'
                    )
                  : hasActiveDualSplitPages
                    ? tr(
                        lang,
                        'Ask across both Split View panes, or let Agent operate the page…',
                        '直接针对左右分屏双页提问，或让 Agent 帮你操作网页…'
                      )
                    : tr(
                        lang,
                        'Ask Arko or let Agent act (@ mention, / skills, ⌘V paste image)…',
                        '提问或让 Agent 操控网页，输入 @ 引用、/ 技能，支持 ⌘V 粘贴截图…'
                      )
            }
            className="w-full resize-none bg-transparent outline-none text-[13px] leading-relaxed placeholder:opacity-45"
          />

          <div className="pt-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 min-w-0">
              <select
                value={settings.activeModelId}
                onChange={(e) => onUpdateSettings({ activeModelId: e.target.value })}
                className={`text-[11px] px-2 py-1 rounded-lg outline-none truncate max-w-[195px] cursor-pointer ${
                  isDark ? 'bg-white/6 text-zinc-300' : 'bg-zinc-100 text-zinc-700'
                }`}
              >
                {activeProvider?.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={onOpenSettings}
                title={tr(lang, 'Configure AI models & API keys', '配置 AI 模型与密钥')}
                className="p-1 rounded-lg opacity-55 hover:opacity-100 transition"
              >
                <Settings2 size={13} />
              </button>
            </div>

            {isStreaming && currentThread ? (
              <button
                type="button"
                onClick={() => onAbortStream(currentThread.id)}
                title={tr(lang, 'Stop generating', '停止生成')}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition ${
                  isDark ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-white'
                }`}
              >
                <Square size={10} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!input.trim() && !quotedSelection && !attachedImage}
                onClick={() => void sendPromptText()}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition ${
                  input.trim() || quotedSelection || attachedImage
                    ? isDark
                      ? 'bg-zinc-100 text-zinc-900 hover:bg-white'
                      : 'bg-zinc-900 text-white hover:bg-zinc-800'
                    : isDark
                      ? 'bg-white/[0.06] text-zinc-500 cursor-default'
                      : 'bg-black/[0.05] text-zinc-400 cursor-default'
                }`}
              >
                <ArrowUp size={13.5} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
