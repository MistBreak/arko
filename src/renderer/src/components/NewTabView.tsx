import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  AtSign,
  Columns2,
  Compass,
  FileText,
  History,
  Layers,
  MessageCircle,
  Paperclip,
  Plug,
  Plus,
  Search,
  Sparkles,
  X
} from 'lucide-react'
import {
  classifyInputIntent,
  getAllSlashSkills,
  isInternalArkoUrl
} from '@shared/constants'
import { tr } from '@shared/i18n'
import type {
  AppSettings,
  ArkoAccountState,
  BookmarkItem,
  BrowserProfile,
  ChatMention,
  ChatThread,
  ConnectedToolItem,
  InputIntentType,
  TabState
} from '@shared/types'
import { AppIcon } from './AppIcon'
import { FaviconIcon } from './FaviconIcon'
import { ToolBrandIcon } from './ConnectToolsModal'

interface Props {
  isDark: boolean
  activeProfile: BrowserProfile
  settings: AppSettings
  bookmarks: BookmarkItem[]
  openTabs: TabState[]
  recentThreads?: ChatThread[]
  memoryCount?: number
  connectedTools?: ConnectedToolItem[]
  accountState?: ArkoAccountState
  isSplitPane?: boolean
  splitCandidateTabs?: TabState[]
  onPickSplitTab?: (tabId: string) => void
  onNavigate: (urlOrQuery: string) => void
  onAskAI: (prompt: string, mentions?: ChatMention[]) => void
  onOpenChatThreadAsTab?: (threadId: string) => void
  onOrganizeTabs?: () => void
  onOpenSettings: () => void
  onOpenAccount?: () => void
  onOpenConnectTools?: () => void
  onOpenSkillsEditor?: () => void
  onToggleLanguage?: () => void
}

interface AttachedTextFile {
  name: string
  content: string
}

export const NewTabView: React.FC<Props> = ({
  isDark,
  settings,
  openTabs,
  memoryCount = 0,
  connectedTools = [],
  accountState,
  isSplitPane,
  splitCandidateTabs = [],
  onPickSplitTab,
  onNavigate,
  onAskAI,
  onOrganizeTabs,
  onOpenSettings,
  onOpenAccount,
  onOpenConnectTools
}) => {
  const lang = settings.language
  const [input, setInput] = useState('')
  const [mentions, setMentions] = useState<ChatMention[]>([])
  const [attachedFiles, setAttachedFiles] = useState<AttachedTextFile[]>([])
  const [forcedMode, setForcedMode] = useState<InputIntentType | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [mentionIdx, setMentionIdx] = useState(0)
  const [showSkillMenu, setShowSkillMenu] = useState(false)
  const [skillIdx, setSkillIdx] = useState(0)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(raf)
  }, [])

  const hasContextAttachments = mentions.length > 0 || attachedFiles.length > 0
  const autoIntent = hasContextAttachments ? 'ai' : classifyInputIntent(input)
  const effectiveIntent: InputIntentType = forcedMode ?? autoIntent

  const allSkills = useMemo(
    () =>
      getAllSlashSkills(settings.customSkills, lang).filter(
        (s) => s.executionKind !== 'local-markdown' && s.executionKind !== 'local-screenshot'
      ),
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

  const activeProvider =
    settings.providers.find((p) => p.id === settings.activeProviderId) || settings.providers[0]
  const isCloudChannel = Boolean(
    activeProvider?.isArkoCloud || activeProvider?.id === 'arko-cloud'
  )
  const hasApiKey = isCloudChannel
    ? Boolean(accountState?.authenticated || accountState?.hasCloudCredential)
    : Boolean(activeProvider?.apiKey?.trim()) || activeProvider?.id === 'custom-ollama'
  const otherRealTabs = useMemo(
    () => openTabs.filter((t) => !isInternalArkoUrl(t.url)),
    [openTabs]
  )

  const activeConnectedTools = useMemo(
    () => connectedTools.filter((t) => t.status !== 'disconnected'),
    [connectedTools]
  )

  const mentionCandidates = useMemo<ChatMention[]>(() => {
    const q = (mentionQuery ?? '').toLowerCase().trim()
    const items: ChatMention[] = [
      ...activeConnectedTools.map((t) => ({
        type: 'tool' as const,
        toolId: t.id,
        title: `${t.name}`,
        url: t.homeUrl
      })),
      ...otherRealTabs.map((t) => ({
        type: 'tab' as const,
        tabId: t.id,
        title: t.title || t.url,
        url: t.url,
        favicon: t.favicon
      })),
      {
        type: 'all-tabs',
        title: tr(
          lang,
          `All Open Tabs (${otherRealTabs.length})`,
          `全部打开标签页 (${otherRealTabs.length})`
        )
      },
      {
        type: 'history',
        title: tr(lang, 'Browsing History', '浏览历史记录')
      },
      {
        type: 'memory',
        title: tr(lang, `Personal Memory (${memoryCount})`, `个人记忆库 (${memoryCount})`)
      }
    ]
    if (!q) return items
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.toolId && i.toolId.toLowerCase().includes(q)) ||
        (i.url && i.url.toLowerCase().includes(q))
    )
  }, [mentionQuery, activeConnectedTools, otherRealTabs, memoryCount, lang])

  const syncTextareaHeight = (el: HTMLTextAreaElement | null): void => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(148, Math.max(24, el.scrollHeight))}px`
  }

  const handleInputChange = (val: string): void => {
    setInput(val)
    if (!val.trim() && !hasContextAttachments) setForcedMode(null)

    if (val.startsWith('/') && !val.includes(' ')) {
      setShowSkillMenu(true)
      setSkillIdx(0)
    } else {
      setShowSkillMenu(false)
    }

    const atMatch = val.match(/(?:^|\s)@([^\s@]*)$/)
    if (atMatch) {
      setPickerOpen(false)
      setMentionQuery(atMatch[1])
      setMentionIdx(0)
    } else {
      setMentionQuery(null)
    }
  }

  const applyMention = (cand: ChatMention): void => {
    const cleaned = input.replace(/(?:^|\s)@([^\s@]*)$/, (m) => (m.startsWith(' ') ? ' ' : ''))
    setInput(cleaned)
    setMentionQuery(null)
    setPickerOpen(false)
    setForcedMode('ai')
    if (
      !mentions.some(
        (m) => m.type === cand.type && m.tabId === cand.tabId && m.toolId === cand.toolId
      ) &&
      mentions.length < 8
    ) {
      setMentions([...mentions, cand])
    }
    textareaRef.current?.focus()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setPickerOpen(false)
    Array.from(files)
      .slice(0, 3)
      .forEach((file) => {
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            const snippet = reader.result.slice(0, 24000)
            setAttachedFiles((prev) =>
              prev.some((f) => f.name === file.name)
                ? prev
                : [...prev, { name: file.name, content: snippet }]
            )
            setForcedMode('ai')
          }
        }
        reader.readAsText(file)
      })
    e.target.value = ''
    textareaRef.current?.focus()
  }

  const submitForm = (overridePrompt?: string, overrideMentions?: ChatMention[]): void => {
    const trimmed = (overridePrompt ?? input).trim()
    if (!trimmed && attachedFiles.length === 0) return

    if (trimmed === '/organize' && onOrganizeTabs) {
      onOrganizeTabs()
      setInput('')
      return
    }

    const chosenMentions = overrideMentions ?? mentions
    const useAi =
      overridePrompt !== undefined ||
      chosenMentions.length > 0 ||
      attachedFiles.length > 0 ||
      effectiveIntent === 'ai'

    if (useAi) {
      const nextMentions = [...chosenMentions]
      if (trimmed.startsWith('/compare') && nextMentions.length === 0) {
        nextMentions.push({
          type: 'all-tabs',
          title: tr(lang, 'All Open Tabs', '全部打开标签页')
        })
      }

      let finalPrompt =
        trimmed || tr(lang, 'Analyze the attached file(s).', '请分析所附文件的内容。')
      if (attachedFiles.length > 0) {
        const blocks = attachedFiles
          .map((f) => `<file name="${f.name}">\n${f.content}\n</file>`)
          .join('\n\n')
        finalPrompt = `${finalPrompt}\n\n${blocks}`
      }

      onAskAI(finalPrompt, nextMentions)
      setInput('')
      setMentions([])
      setAttachedFiles([])
      setForcedMode(null)
      setShowSkillMenu(false)
      setMentionQuery(null)
      setPickerOpen(false)
    } else {
      onNavigate(trimmed)
      setInput('')
      setForcedMode(null)
    }
  }

  const showMentionPopover =
    (mentionQuery !== null || pickerOpen) && mentionCandidates.length > 0

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (showSkillMenu && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSkillIdx((i) => (i + 1) % filteredSkills.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSkillIdx((i) => (i - 1 + filteredSkills.length) % filteredSkills.length)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        const sk = filteredSkills[skillIdx]
        if (sk) {
          setInput(`${sk.command} `)
          setForcedMode('ai')
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
          const sk = filteredSkills[skillIdx]
          if (sk) {
            setShowSkillMenu(false)
            if (sk.executionKind === 'organize-tabs') {
              submitForm(sk.command)
            } else {
              setInput(`${sk.command} `)
              setForcedMode('ai')
            }
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

    if (showMentionPopover) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx((i) => (i + 1) % mentionCandidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        applyMention(mentionCandidates[mentionIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        setPickerOpen(false)
        return
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      setForcedMode((prev) => {
        const cur = prev ?? autoIntent
        return cur === 'ai' ? 'search' : 'ai'
      })
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitForm()
    }
  }

  const canSubmit = Boolean(input.trim() || attachedFiles.length > 0)

  return (
    <div
      onClick={() => {
        if (pickerOpen) setPickerOpen(false)
      }}
      className={`w-full h-full overflow-y-auto flex flex-col items-center justify-center px-6 pb-10 transition-colors ${
        isDark ? 'bg-[#19191B] text-zinc-100' : 'bg-[#FAFAFB] text-zinc-900'
      }`}
    >
      <div className="w-full max-w-[576px] flex flex-col items-center space-y-6 -mt-6">
        {/* Arko Brand Logo (Calm Tonal Monochrome Edition) */}
        <div className="flex flex-col items-center gap-2 select-none">
          <AppIcon size={60} isDark={isDark} monochrome className="drop-shadow-sm" />
        </div>

        {/* Split View Quick Tab Picker (Only when inside Split View) */}
        {isSplitPane && splitCandidateTabs.length > 0 && onPickSplitTab && (
          <div
            className={`w-full p-3 rounded-2xl border space-y-2 ${
              isDark ? 'bg-[#212124] border-white/[0.07]' : 'bg-white border-black/[0.07]'
            }`}
          >
            <div className="text-[11.5px] font-medium flex items-center gap-1.5 opacity-65 px-1">
              <Columns2 size={12.5} />
              <span>
                {tr(
                  lang,
                  'Choose an open tab for Split View',
                  '选择要并排对比的已打开标签页'
                )}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {splitCandidateTabs.slice(0, 6).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPickSplitTab(t.id)}
                  className={`flex items-center gap-2.5 p-2 rounded-xl border text-left text-xs transition ${
                    isDark
                      ? 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.07]'
                      : 'bg-zinc-50/70 border-black/[0.06] hover:bg-zinc-100'
                  }`}
                >
                  <FaviconIcon url={t.url} favicon={t.favicon} size={14} />
                  <span className="font-medium truncate flex-1">{t.title || t.url}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Calm Single-Card Composer */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full relative"
        >
          {/* Context Picker Popover (@ or "+ Add tabs or files") */}
          {showMentionPopover && (
            <div
              className={`absolute left-0 bottom-full mb-2 w-full max-w-[340px] rounded-2xl border shadow-2xl p-1.5 z-30 max-h-64 overflow-y-auto ${
                isDark
                  ? 'bg-[#242427] border-white/[0.09] text-zinc-100'
                  : 'bg-white border-black/[0.08] text-zinc-800'
              }`}
            >
              <div className="px-2.5 py-1 text-[11px] font-medium opacity-45">
                {tr(lang, 'Add tabs or context', '添加标签页或上下文')}
              </div>
              {mentionCandidates.map((cand, idx) => {
                const active = idx === mentionIdx
                return (
                  <button
                    key={`${cand.type}-${cand.tabId || idx}`}
                    type="button"
                    onMouseEnter={() => setMentionIdx(idx)}
                    onClick={() => applyMention(cand)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs text-left transition ${
                      active
                        ? isDark
                          ? 'bg-white/[0.09] text-zinc-100'
                          : 'bg-black/[0.06] text-zinc-900'
                        : isDark
                          ? 'text-zinc-300 hover:bg-white/[0.05]'
                          : 'text-zinc-700 hover:bg-black/[0.04]'
                    }`}
                  >
                    {cand.type === 'tool' && cand.toolId ? (
                      <ToolBrandIcon id={cand.toolId} size={14} />
                    ) : cand.type === 'all-tabs' ? (
                      <Layers size={13.5} className="opacity-60 shrink-0" />
                    ) : cand.type === 'history' ? (
                      <History size={13.5} className="opacity-60 shrink-0" />
                    ) : cand.type === 'memory' ? (
                      <Sparkles size={13.5} className="opacity-60 shrink-0" />
                    ) : (
                      <FaviconIcon url={cand.url} favicon={cand.favicon} size={14} />
                    )}
                    <span className="truncate flex-1">{cand.title}</span>
                    {cand.type === 'tool' && (
                      <span className="text-[10px] opacity-45 shrink-0">
                        {tr(lang, 'Connected', '已连接')}
                      </span>
                    )}
                  </button>
                )
              })}
              <div className={`my-1 border-t ${isDark ? 'border-white/[0.06]' : 'border-black/[0.06]'}`} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs text-left transition ${
                  isDark
                    ? 'text-zinc-300 hover:bg-white/[0.06]'
                    : 'text-zinc-700 hover:bg-black/[0.04]'
                }`}
              >
                <Paperclip size={13.5} className="opacity-60 shrink-0" />
                <span>{tr(lang, 'Attach local text / code file…', '添加本地文本或代码文件…')}</span>
              </button>
            </div>
          )}

          {/* Slash Skills Autocomplete Popover */}
          {showSkillMenu && filteredSkills.length > 0 && (
            <div
              className={`absolute left-0 bottom-full mb-2 w-full max-w-[360px] rounded-2xl border shadow-2xl p-1.5 z-30 max-h-60 overflow-y-auto ${
                isDark
                  ? 'bg-[#242427] border-white/[0.09] text-zinc-100'
                  : 'bg-white border-black/[0.08] text-zinc-800'
              }`}
            >
              {filteredSkills.map((sk, idx) => {
                const active = idx === skillIdx
                return (
                  <button
                    key={sk.id || sk.command}
                    type="button"
                    onMouseEnter={() => setSkillIdx(idx)}
                    onClick={() => {
                      setShowSkillMenu(false)
                      if (sk.executionKind === 'organize-tabs') {
                        submitForm(sk.command)
                      } else {
                        setInput(`${sk.command} `)
                        setForcedMode('ai')
                        textareaRef.current?.focus()
                      }
                    }}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs text-left transition ${
                      active
                        ? isDark
                          ? 'bg-white/[0.09] text-zinc-100'
                          : 'bg-black/[0.06] text-zinc-900'
                        : isDark
                          ? 'text-zinc-300 hover:bg-white/[0.05]'
                          : 'text-zinc-700 hover:bg-black/[0.04]'
                    }`}
                  >
                    <span className="font-mono font-medium opacity-80">{sk.command}</span>
                    <span className="truncate flex-1 opacity-70">{sk.label}</span>
                  </button>
                )
              })}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.py,.html,.css,.yml,.yaml,.xml,.log"
            onChange={handleFileSelect}
            className="hidden"
          />

          <form
            onSubmit={(e) => {
              e.preventDefault()
              submitForm()
            }}
            className={`rounded-[18px] border transition-colors px-4 pt-3.5 pb-3 ${
              isDark
                ? 'bg-[#212124] border-white/[0.07] focus-within:border-white/[0.13]'
                : 'bg-white border-black/[0.08] focus-within:border-black/[0.16] shadow-xs'
            }`}
          >
            {/* Top URL / Search / Prompt Row */}
            <div className="flex items-start gap-2.5">
              {effectiveIntent === 'url' && input.trim() ? (
                <Compass size={15} className="text-indigo-500 shrink-0 mt-[4px]" />
              ) : (
                <Search size={15} className="opacity-40 shrink-0 mt-[4px]" />
              )}
              <textarea
                ref={textareaRef}
                rows={1}
                autoFocus
                spellCheck={false}
                value={input}
                onChange={(e) => {
                  handleInputChange(e.target.value)
                  syncTextareaHeight(e.target)
                }}
                onKeyDown={handleKeyDown}
                placeholder={tr(
                  lang,
                  'Enter a URL, search the web, or ask anything…',
                  '输入网址直接打开、搜索网页，或向 AI 提问…'
                )}
                className="flex-1 resize-none bg-transparent outline-none text-[14.5px] leading-[1.55] placeholder:opacity-40 max-h-[148px]"
              />
            </div>

            {/* Subtle 1-Line Model Setup Prompt inside Card (Only when unconfigured) */}
            {!hasApiKey && !isSplitPane && (
              <button
                type="button"
                onClick={isCloudChannel && onOpenAccount ? onOpenAccount : onOpenSettings}
                className="mt-3 flex items-center gap-2 text-[12px] text-left group/connect transition w-full"
              >
                <MessageCircle
                  size={13.5}
                  className="opacity-45 group-hover/connect:opacity-80 shrink-0 transition"
                />
                <span className="truncate">
                  <strong className="font-medium opacity-90">
                    {isCloudChannel
                      ? tr(lang, 'Sign in to Arko', '登录 Arko 账号')
                      : tr(lang, 'Connect Chat', '连接对话模型')}
                  </strong>
                  <span className="opacity-45 group-hover/connect:opacity-70 transition">
                    {' — '}
                    {isCloudChannel
                      ? tr(
                          lang,
                          'Create a free email account or sign in to unlock built-in Cloud AI',
                          '邮箱注册或登录账号，即刻免费解锁内置云端 AI 对话'
                        )
                      : tr(
                          lang,
                          'Configure your API key or local Ollama to get more from Chat',
                          '配置 API Key 或连接本地 Ollama 解锁对话能力'
                        )}
                  </span>
                </span>
              </button>
            )}

            {/* Selected @Mentions & File Chips */}
            {(mentions.length > 0 || attachedFiles.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5 pt-3">
                {mentions.map((m, i) => (
                  <span
                    key={`${m.type}-${m.tabId || i}`}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11.5px] border ${
                      isDark
                        ? 'bg-white/[0.06] border-white/[0.08] text-zinc-200'
                        : 'bg-black/[0.04] border-black/[0.07] text-zinc-700'
                    }`}
                  >
                    {m.type === 'tool' && m.toolId ? (
                      <ToolBrandIcon id={m.toolId} size={11.5} />
                    ) : m.type === 'tab' ? (
                      <FaviconIcon url={m.url} favicon={m.favicon} size={11} />
                    ) : (
                      <AtSign size={10.5} className="opacity-60" />
                    )}
                    <span className="max-w-[160px] truncate">{m.title}</span>
                    <button
                      type="button"
                      onClick={() => setMentions(mentions.filter((_, idx) => idx !== i))}
                      className="opacity-50 hover:opacity-100"
                    >
                      <X size={10.5} />
                    </button>
                  </span>
                ))}
                {attachedFiles.map((f, idx) => (
                  <span
                    key={`file-${f.name}-${idx}`}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11.5px] border ${
                      isDark
                        ? 'bg-white/[0.06] border-white/[0.08] text-zinc-200'
                        : 'bg-black/[0.04] border-black/[0.07] text-zinc-700'
                    }`}
                  >
                    <FileText size={11} className="opacity-60" />
                    <span className="max-w-[150px] truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachedFiles(attachedFiles.filter((_, i) => i !== idx))
                      }
                      className="opacity-50 hover:opacity-100"
                    >
                      <X size={10.5} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Bottom Toolbar Row: "+ Add tabs or files" & "Connect Tools" on left, Circular "↑" on right */}
            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setPickerOpen((v) => !v)
                    setMentionIdx(0)
                  }}
                  className={`h-[28px] px-3 rounded-full border text-[12px] inline-flex items-center gap-1.5 transition ${
                    isDark
                      ? 'border-white/[0.09] text-zinc-300/80 hover:text-zinc-100 hover:bg-white/[0.05]'
                      : 'border-black/[0.09] text-zinc-600 hover:text-zinc-900 hover:bg-black/[0.03]'
                  }`}
                >
                  <Plus size={13} className="opacity-70" />
                  <span>{tr(lang, 'Add tabs or files', '添加标签页或文件')}</span>
                </button>

                {onOpenConnectTools && (
                  <button
                    type="button"
                    onClick={onOpenConnectTools}
                    className={`h-[28px] px-3 rounded-full border text-[12px] inline-flex items-center gap-1.5 transition ${
                      isDark
                        ? 'border-white/[0.09] text-zinc-300/80 hover:text-zinc-100 hover:bg-white/[0.05]'
                        : 'border-black/[0.09] text-zinc-600 hover:text-zinc-900 hover:bg-black/[0.03]'
                    }`}
                  >
                    {activeConnectedTools.length > 0 ? (
                      <span className="flex items-center -space-x-1 mr-0.5">
                        {activeConnectedTools.slice(0, 3).map((t) => (
                          <span
                            key={t.id}
                            className={`w-4 h-4 rounded-full flex items-center justify-center ring-1 ${
                              isDark ? 'bg-[#1D1D1F] ring-white/10' : 'bg-white ring-black/10'
                            }`}
                          >
                            <ToolBrandIcon id={t.id} size={11} />
                          </span>
                        ))}
                      </span>
                    ) : (
                      <Plug size={12.5} className="opacity-70" />
                    )}
                    <span>
                      {activeConnectedTools.length > 0
                        ? tr(
                            lang,
                            `${activeConnectedTools.length} Tools Connected`,
                            `已连接 ${activeConnectedTools.length} 个工具`
                          )
                        : tr(lang, 'Connect Tools', '连接常用工具')}
                    </span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                {input.trim() && (
                  <button
                    type="button"
                    onClick={() => setForcedMode(effectiveIntent === 'ai' ? 'search' : 'ai')}
                    title={tr(
                      lang,
                      'Click or press Tab to switch between Chat and Web Search',
                      '点击或按 Tab 键在对话与网页搜索之间切换'
                    )}
                    className="inline-flex items-center gap-1 text-[11.5px] opacity-45 hover:opacity-85 transition"
                  >
                    {effectiveIntent === 'url' ? (
                      <>
                        <Compass size={11.5} />
                        <span>{tr(lang, 'Open URL', '打开网址')}</span>
                      </>
                    ) : effectiveIntent === 'search' ? (
                      <>
                        <Search size={11.5} />
                        <span>{tr(lang, 'Web Search', '网页搜索')}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={11.5} />
                        <span>{tr(lang, 'Chat', '对话')}</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  type="submit"
                  disabled={!canSubmit}
                  title={
                    effectiveIntent === 'ai'
                      ? tr(lang, 'Send (Enter)', '发送 (Enter)')
                      : tr(lang, 'Go (Enter)', '前往 (Enter)')
                  }
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition ${
                    canSubmit
                      ? isDark
                        ? 'bg-zinc-100 text-zinc-900 hover:bg-white'
                        : 'bg-zinc-900 text-white hover:bg-zinc-800'
                      : isDark
                        ? 'bg-white/[0.06] text-zinc-500 cursor-default'
                        : 'bg-black/[0.05] text-zinc-400 cursor-default'
                  }`}
                >
                  <ArrowUp size={14} strokeWidth={2.2} />
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
