import React, { useCallback, useEffect, useState } from 'react'
import {
  ArrowDownCircle,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  MousePointerClick,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  UserRound,
  Wand2,
  X,
  Zap
} from 'lucide-react'
import {
  getBuiltinSlashSkills,
  getPresetSkillStarters,
  GITHUB_RELEASES_URL,
  GITHUB_REPO_URL,
  normalizeSkillCommand
} from '@shared/constants'
import { getMemoryCategoryLabel, tr } from '@shared/i18n'
import type {
  AIProviderConfig,
  AppLanguage,
  AppSettings,
  AppUpdateState,
  ArkoAccountState,
  ConnectedToolId,
  ConnectedToolItem,
  ConnectionTestResult,
  MemoryItem,
  ProviderProtocol,
  SkillContextScope,
  SlashSkill,
  TokenQuotaResult
} from '@shared/types'
import { AppIcon } from './AppIcon'
import { ChatMarkdown } from './ChatMarkdown'
import { ConnectToolsListPanel } from './ConnectToolsModal'
import { AccountSettingsPanel } from './AccountSettingsPanel'

export type SettingsTabId =
  | 'account'
  | 'ai'
  | 'tools'
  | 'memory'
  | 'skills'
  | 'general'
  | 'updates'

interface Props {
  isDark: boolean
  initialTab?: SettingsTabId
  settings: AppSettings
  memories: MemoryItem[]
  connectedTools?: ConnectedToolItem[]
  accountState?: ArkoAccountState
  updateState?: AppUpdateState
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  onConnectTool?: (toolId: ConnectedToolId) => Promise<void>
  onDisconnectTool?: (toolId: ConnectedToolId) => Promise<void>
  onToggleAutoConnectTools?: (enabled: boolean) => Promise<void>
  onRefreshConnectedTools?: () => Promise<void>
  onAddMemory: (content: string, category: MemoryItem['category']) => Promise<void>
  onToggleMemory: (id: string, enabled: boolean) => Promise<void>
  onDeleteMemory: (id: string) => Promise<void>
  onNavigateInBrowser: (url: string) => void
  onTrySkill?: (command: string) => void
  onOpenBrowserImport?: () => void
  onResetOnboarding?: () => Promise<void>
  onCheckUpdates?: () => Promise<void>
  onDownloadUpdate?: () => Promise<void>
  onInstallUpdate?: () => Promise<void>
  isClosing?: boolean
  onClose: () => void
}

const SKILL_EMOJI_OPTIONS = ['✨', '📝', '💡', '📊', '📧', '🛠️', '🎯', '🔍', '🌐', '🚀']

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 MB'
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const SettingsModal: React.FC<Props> = ({
  isDark,
  initialTab = 'ai',
  settings,
  memories,
  connectedTools = [],
  accountState,
  updateState,
  onUpdateSettings,
  onConnectTool,
  onDisconnectTool,
  onToggleAutoConnectTools,
  onRefreshConnectedTools,
  onAddMemory,
  onToggleMemory,
  onDeleteMemory,
  onNavigateInBrowser,
  onTrySkill,
  onOpenBrowserImport,
  onResetOnboarding,
  onCheckUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  isClosing = false,
  onClose
}) => {
  const lang: AppLanguage = settings.language === 'zh-CN' ? 'zh-CN' : 'en'
  const [tabHistory, setTabHistory] = useState<{ stack: SettingsTabId[]; index: number }>({
    stack: [initialTab],
    index: 0
  })
  const tab = tabHistory.stack[tabHistory.index] ?? initialTab

  const selectTab = useCallback((next: SettingsTabId): void => {
    setTabHistory((prev) => {
      const current = prev.stack[prev.index]
      if (current === next) return prev
      const nextStack = [...prev.stack.slice(0, prev.index + 1), next]
      return { stack: nextStack, index: nextStack.length - 1 }
    })
  }, [])

  const canGoBack = tabHistory.index > 0
  const canGoForward = tabHistory.index < tabHistory.stack.length - 1

  const goBackTab = (): void => {
    setTabHistory((prev) =>
      prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev
    )
  }

  const goForwardTab = (): void => {
    setTabHistory((prev) =>
      prev.index < prev.stack.length - 1 ? { ...prev, index: prev.index + 1 } : prev
    )
  }

  const [selectedProviderId, setSelectedProviderId] = useState(settings.activeProviderId)
  const [showKey, setShowKey] = useState(false)
  const [customModelInput, setCustomModelInput] = useState('')

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)

  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchMsg, setFetchMsg] = useState<string | null>(null)

  const [queryingQuota, setQueryingQuota] = useState(false)
  const [quotaResult, setQuotaResult] = useState<TokenQuotaResult | null>(null)

  // Arko Memory state
  const [newMemContent, setNewMemContent] = useState('')
  const [newMemCategory, setNewMemCategory] = useState<MemoryItem['category']>('preference')

  // Visual Skill Creator state
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null)
  const [skillIcon, setSkillIcon] = useState('✨')
  const [skillCmd, setSkillCmd] = useState('')
  const [skillLabel, setSkillLabel] = useState('')
  const [skillDesc, setSkillDesc] = useState('')
  const [skillScope, setSkillScope] = useState<SkillContextScope>('active')
  const [skillTemplate, setSkillTemplate] = useState('')
  const [skillFeedback, setSkillFeedback] = useState<string | null>(null)
  const [importJsonOpen, setImportJsonOpen] = useState(false)
  const [importJsonText, setImportJsonText] = useState('')

  useEffect(() => {
    setTabHistory({ stack: [initialTab], index: 0 })
  }, [initialTab])

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

  const selectedProvider =
    settings.providers.find((p) => p.id === selectedProviderId) || settings.providers[0]

  const customSkills = settings.customSkills || []
  const builtinSkills = getBuiltinSlashSkills(lang)
  const skillStarters = getPresetSkillStarters(lang)

  const hasUpdateHighlight =
    updateState?.status === 'available' ||
    updateState?.status === 'downloading' ||
    updateState?.status === 'downloaded'

  const patchProvider = async (patch: Partial<AIProviderConfig>): Promise<AIProviderConfig> => {
    const updatedProvider: AIProviderConfig = { ...selectedProvider, ...patch }
    const nextProviders = settings.providers.map((p) =>
      p.id === selectedProvider.id ? updatedProvider : p
    )
    await onUpdateSettings({ providers: nextProviders })
    return updatedProvider
  }

  const handleActivateProvider = async (provider: AIProviderConfig): Promise<void> => {
    setSelectedProviderId(provider.id)
    setTestResult(null)
    setQuotaResult(null)
    setFetchMsg(null)
    await onUpdateSettings({
      activeProviderId: provider.id,
      activeModelId: provider.defaultModelId || provider.models[0]?.id || ''
    })
  }

  const handleAddCustomProvider = async (): Promise<void> => {
    const id = `custom-${Date.now().toString(36)}`
    const newProvider: AIProviderConfig = {
      id,
      name: tr(lang, 'Custom OpenAI-Compatible', '自定义 OpenAI 兼容接口'),
      protocol: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      defaultModelId: 'gpt-6.2-sol',
      models: [{ id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' }]
    }
    await onUpdateSettings({
      providers: [...settings.providers, newProvider],
      activeProviderId: id,
      activeModelId: newProvider.defaultModelId
    })
    setSelectedProviderId(id)
  }

  const handleAddCustomModel = async (): Promise<void> => {
    const mid = customModelInput.trim()
    if (!mid) return
    const exists = selectedProvider.models.some((m) => m.id === mid)
    const nextModels = exists
      ? selectedProvider.models
      : [{ id: mid, label: mid }, ...selectedProvider.models]
    await patchProvider({ models: nextModels, defaultModelId: mid })
    if (settings.activeProviderId === selectedProvider.id) {
      await onUpdateSettings({ activeModelId: mid })
    }
    setCustomModelInput('')
  }

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    const res = await window.arko.testProviderConnection(
      selectedProvider,
      selectedProvider.id === settings.activeProviderId
        ? settings.activeModelId
        : selectedProvider.defaultModelId
    )
    setTestResult(res)
    setTesting(false)
  }

  const handleFetchModels = async (): Promise<void> => {
    setFetchingModels(true)
    setFetchMsg(null)
    const res = await window.arko.fetchProviderModels(selectedProvider)
    if (res.ok && res.models && res.models.length > 0) {
      await patchProvider({ models: res.models })
      setFetchMsg(
        tr(
          lang,
          `Synced ${res.models.length} available models`,
          `已成功同步 ${res.models.length} 个可用模型`
        )
      )
    } else {
      setFetchMsg(res.error || tr(lang, 'Failed to sync models', '拉取失败'))
    }
    setFetchingModels(false)
  }

  const handleQueryQuota = async (): Promise<void> => {
    setQueryingQuota(true)
    setQuotaResult(null)
    const res = await window.arko.queryProviderQuota(selectedProvider)
    setQuotaResult(res)
    setQueryingQuota(false)
  }

  const resetSkillForm = (): void => {
    setEditingSkillId(null)
    setSkillIcon('✨')
    setSkillCmd('')
    setSkillLabel('')
    setSkillDesc('')
    setSkillScope('active')
    setSkillTemplate('')
  }

  const loadSkillIntoForm = (skill: SlashSkill): void => {
    setEditingSkillId(skill.id)
    setSkillIcon(skill.icon || '✨')
    setSkillCmd(skill.command)
    setSkillLabel(skill.label)
    setSkillDesc(skill.description)
    setSkillScope(skill.contextScope || (skill.includeAllTabs ? 'all-tabs' : 'active'))
    setSkillTemplate(skill.promptTemplate)
    setSkillFeedback(null)
  }

  const handleSaveSkill = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const normalizedCmd = normalizeSkillCommand(skillCmd)
    if (!normalizedCmd || normalizedCmd === '/') {
      setSkillFeedback(
        tr(
          lang,
          'Please enter a valid /command (e.g. /weekly)',
          '请输入有效的 /command 指令名（如 /weekly）'
        )
      )
      return
    }
    if (
      normalizedCmd === '/markdown' ||
      normalizedCmd === '/screenshot' ||
      normalizedCmd === '/organize'
    ) {
      setSkillFeedback(
        tr(
          lang,
          `${normalizedCmd} is reserved by a built-in engine skill`,
          `${normalizedCmd} 为系统内置引擎指令，请换一个名称`
        )
      )
      return
    }
    if (!skillLabel.trim() || !skillTemplate.trim()) {
      setSkillFeedback(
        tr(
          lang,
          'Please provide both skill name and prompt template',
          '请填写技能名称与 Prompt 模板内容'
        )
      )
      return
    }

    const newSkill: SlashSkill = {
      id: editingSkillId || `skill-${Date.now().toString(36)}`,
      command: normalizedCmd,
      icon: skillIcon.trim() || '✨',
      label: skillLabel.trim(),
      description: skillDesc.trim() || skillLabel.trim(),
      promptTemplate: skillTemplate.trim(),
      contextScope: skillScope,
      includeAllTabs: skillScope === 'all-tabs',
      executionKind: 'ai',
      isBuiltin: false
    }

    const filtered = customSkills.filter(
      (s) => s.id !== newSkill.id && s.command.toLowerCase() !== normalizedCmd.toLowerCase()
    )
    await onUpdateSettings({ customSkills: [newSkill, ...filtered] })
    setSkillFeedback(
      editingSkillId
        ? tr(lang, `✓ Updated skill ${normalizedCmd}`, `✓ 已更新技能 ${normalizedCmd}`)
        : tr(lang, `✓ Created skill ${normalizedCmd}`, `✓ 已创建技能 ${normalizedCmd}`)
    )
    resetSkillForm()
  }

  const handleDeleteCustomSkill = async (id: string): Promise<void> => {
    await onUpdateSettings({ customSkills: customSkills.filter((s) => s.id !== id) })
    if (editingSkillId === id) resetSkillForm()
  }

  const handleExportCustomSkills = (): void => {
    const json = JSON.stringify(customSkills, null, 2)
    void navigator.clipboard.writeText(json)
    setSkillFeedback(
      tr(
        lang,
        `✓ Copied ${customSkills.length} custom skills JSON to clipboard`,
        `✓ 已将 ${customSkills.length} 个自定义技能 JSON 复制到剪贴板`
      )
    )
  }

  const handleImportSkillsJson = async (): Promise<void> => {
    try {
      const parsed = JSON.parse(importJsonText)
      const arr = Array.isArray(parsed) ? parsed : [parsed]
      const valid: SlashSkill[] = []
      for (const raw of arr) {
        const cmd = normalizeSkillCommand(String(raw?.command || ''))
        if (!cmd || !raw?.label || !raw?.promptTemplate) continue
        valid.push({
          id: `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
          command: cmd,
          icon: String(raw.icon || '✨'),
          label: String(raw.label),
          description: String(raw.description || raw.label),
          promptTemplate: String(raw.promptTemplate),
          contextScope:
            raw.contextScope === 'all-tabs' || raw.contextScope === 'none'
              ? raw.contextScope
              : 'active',
          includeAllTabs: raw.contextScope === 'all-tabs' || Boolean(raw.includeAllTabs),
          executionKind: 'ai',
          isBuiltin: false
        })
      }
      if (valid.length === 0) {
        setSkillFeedback(
          tr(
            lang,
            'No valid skill objects found (requires command, label, promptTemplate)',
            '未识别到有效的技能对象（需包含 command、label、promptTemplate）'
          )
        )
        return
      }
      const merged = [
        ...valid,
        ...customSkills.filter(
          (old) => !valid.some((v) => v.command.toLowerCase() === old.command.toLowerCase())
        )
      ]
      await onUpdateSettings({ customSkills: merged })
      setImportJsonText('')
      setImportJsonOpen(false)
      setSkillFeedback(
        tr(lang, `✓ Imported ${valid.length} custom skill(s)`, `✓ 成功导入 ${valid.length} 个自定义技能`)
      )
    } catch {
      setSkillFeedback(tr(lang, 'Invalid JSON format', 'JSON 格式解析失败，请检查粘贴内容'))
    }
  }

  const tabMeta: Record<
    SettingsTabId,
    { title: string; description: string }
  > = {
    account: {
      title: tr(lang, 'Arko Account', 'Arko 账号'),
      description: tr(
        lang,
        'Manage your Arko Cloud sign-in, sync built-in flagship AI models, and view or redeem cloud credits.',
        '管理你的 Arko 邮箱账号登录状态、云端可用额度，并自动激活内置旗舰大模型。'
      )
    },
    ai: {
      title: tr(lang, 'AI & Models', 'AI 与模型渠道'),
      description: tr(
        lang,
        'Choose between built-in Arko Cloud routing or bring your own OpenAI, Anthropic, Gemini, or local Ollama endpoints.',
        '自由切换官方内置 Arko 云端引擎，或接入你自己的 OpenAI、Anthropic、Gemini 与本地 Ollama 模型接口。'
      )
    },
    tools: {
      title: tr(lang, 'Connected Tools', '已连接工具'),
      description: tr(
        lang,
        'Connect logged-in web apps directly from your browser session so Arko can reference context with zero OAuth setup.',
        '直接复用当前浏览器的已登录网页会话，无需繁琐配置即可让 AI 结合工具上下文工作。'
      )
    },
    memory: {
      title: tr(lang, 'Personal Memory', '个人记忆库'),
      description: tr(
        lang,
        'Personalize how Arko thinks and writes across sidebar chats, Chat Tabs, and ⌘J Inline Write.',
        '记录你的背景偏好、常用技术栈与表达习惯，让 Arko 在问答与帮写时更懂你的语境。'
      )
    },
    skills: {
      title: tr(lang, 'Slash /Skills', '快捷技能 (/Skills)'),
      description: tr(
        lang,
        'Create reusable /command prompt workflows or trigger built-in zero-token local browser actions.',
        '定制可复用的 /command 专属提示词工作流，或一键运行本地零 Token 网页导出引擎。'
      )
    },
    general: {
      title: tr(lang, 'Appearance & Privacy', '外观、语言与隐私'),
      description: tr(
        lang,
        'Customize interface language, sidebar layout, selection floating actions, and sensitive-site privacy guards.',
        '调整浏览器界面语言、标签栏布局形态、网页划词灵动条以及敏感站点隐私护栏。'
      )
    },
    updates: {
      title: tr(lang, 'Updates & License', '一键更新与许可'),
      description: tr(
        lang,
        'Keep Arko up to date directly from official GitHub Releases and review open-source licensing terms.',
        '通过官方 GitHub Releases 一键检查并升级客户端版本，查看项目开源许可说明。'
      )
    }
  }

  const navBtnCls = (active: boolean): string =>
    `shrink-0 md:w-full flex items-center justify-between gap-2 px-3 py-1.5 md:py-2 rounded-[10px] text-[13px] md:text-[13.5px] font-medium tracking-[-0.01em] transition ${
      active
        ? 'bg-indigo-600 text-white shadow-2xs'
        : isDark
          ? 'hover:bg-white/[0.06] text-zinc-300'
          : 'hover:bg-black/[0.05] text-zinc-700'
    }`

  return (
    <div
      onClick={onClose}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/36 backdrop-blur-sm p-2 sm:p-5 ${
        isClosing ? 'arc-backdrop-exit' : 'arc-backdrop-enter'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-[940px] h-[min(696px,calc(100vh-16px))] sm:h-[min(696px,calc(100vh-40px))] rounded-[18px] border shadow-2xl flex flex-col md:flex-row overflow-hidden ${
          isClosing ? 'arc-modal-exit' : 'arc-modal-enter'
        } ${
          isDark
            ? 'bg-[#1D1D22] border-white/[0.11] text-zinc-100'
            : 'bg-white border-black/[0.09] text-zinc-900'
        }`}
      >
        {/* 左侧/顶部自适应导航栏（桌面端固定宽侧栏，窄屏转为横向可滚动页签条） */}
        <div
          className={`w-full md:w-[244px] shrink-0 px-3 py-2.5 md:px-3.5 md:py-4 border-b md:border-b-0 md:border-r flex flex-col gap-2 md:gap-1 ${
            isDark ? 'bg-[#16161A] border-white/[0.07]' : 'bg-[#F6F6F8] border-black/[0.06]'
          }`}
        >
          <div className="px-1 md:px-2 pb-0.5 md:pb-3.5 pt-0.5 flex flex-row md:flex-col items-center md:items-start justify-between gap-2.5">
            <div className="font-semibold text-[14px] tracking-[-0.01em] flex items-center gap-2 min-w-0 max-w-full">
              <Sparkles size={15} className="text-indigo-500 shrink-0" />
              <span className="truncate">{tr(lang, 'Arko Settings', 'Arko 设置')}</span>
            </div>

            <button
              type="button"
              onClick={() =>
                void onUpdateSettings({ language: lang === 'zh-CN' ? 'en' : 'zh-CN' })
              }
              title={tr(lang, 'Switch UI Language', '切换界面语言')}
              className={`h-7 px-3 rounded-full text-[12px] leading-none font-medium inline-flex items-center gap-1.5 border whitespace-nowrap transition shrink-0 ${
                isDark
                  ? 'border-white/12 bg-white/[0.05] hover:bg-white/[0.11] text-zinc-300'
                  : 'border-black/10 bg-white hover:bg-zinc-100 text-zinc-700 shadow-2xs'
              }`}
            >
              <Globe size={13} className="shrink-0 opacity-80" />
              <span className="whitespace-nowrap">{lang === 'zh-CN' ? 'English' : '中文'}</span>
            </button>
          </div>

          <div className="flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-0.5 md:pb-0">
            <button
              onClick={() => selectTab('account')}
              className={navBtnCls(tab === 'account')}
            >
            <span className="flex items-center gap-2.5 min-w-0">
              {accountState?.authenticated ? (
                <UserCheck
                  size={16}
                  strokeWidth={1.85}
                  className={`shrink-0 ${tab === 'account' ? 'text-white' : 'text-emerald-500'}`}
                />
              ) : (
                <UserRound
                  size={16}
                  strokeWidth={1.85}
                  className={`shrink-0 ${tab === 'account' ? 'opacity-100' : 'opacity-75'}`}
                />
              )}
              <span className="truncate whitespace-nowrap">
                {tr(lang, 'Arko Account', 'Arko 账号')}
              </span>
            </span>
            {accountState?.authenticated ? (
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  tab === 'account' ? 'bg-emerald-300' : 'bg-emerald-500'
                }`}
              />
            ) : (
              <span
                className={`px-2 py-0.5 rounded-full text-[10.5px] font-medium shrink-0 whitespace-nowrap ${
                  tab === 'account' ? 'bg-white/20 text-white' : 'bg-indigo-500/14 text-indigo-500'
                }`}
              >
                {tr(lang, 'Sign In', '登录')}
              </span>
            )}
          </button>

          <button
            onClick={() => selectTab('ai')}
            className={navBtnCls(tab === 'ai')}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Zap
                size={16}
                strokeWidth={1.85}
                className={`shrink-0 ${tab === 'ai' ? 'opacity-100' : 'opacity-75'}`}
              />
              <span className="truncate whitespace-nowrap">
                {tr(lang, 'AI & Models', 'AI 与模型渠道')}
              </span>
            </span>
          </button>

          <button
            onClick={() => selectTab('tools')}
            className={navBtnCls(tab === 'tools')}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Plug
                size={16}
                strokeWidth={1.85}
                className={`shrink-0 ${tab === 'tools' ? 'opacity-100' : 'opacity-75'}`}
              />
              <span className="truncate whitespace-nowrap">
                {tr(lang, 'Connected Tools', '已连接工具')}
              </span>
            </span>
            {connectedTools.some((t) => t.status !== 'disconnected') && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10.5px] shrink-0 whitespace-nowrap ${
                  tab === 'tools' ? 'bg-white/20 text-white' : 'bg-indigo-500/14 text-indigo-500'
                }`}
              >
                {connectedTools.filter((t) => t.status !== 'disconnected').length}
              </span>
            )}
          </button>

          <button
            onClick={() => selectTab('memory')}
            className={navBtnCls(tab === 'memory')}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Brain
                size={16}
                strokeWidth={1.85}
                className={`shrink-0 ${tab === 'memory' ? 'opacity-100' : 'opacity-75'}`}
              />
              <span className="truncate whitespace-nowrap">
                {tr(lang, 'Personal Memory', '个人记忆库')}
              </span>
            </span>
            {memories.length > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10.5px] shrink-0 whitespace-nowrap ${
                  tab === 'memory' ? 'bg-white/20 text-white' : 'bg-indigo-500/14 text-indigo-500'
                }`}
              >
                {memories.filter((m) => m.enabled).length}
              </span>
            )}
          </button>

          <button
            onClick={() => selectTab('skills')}
            className={navBtnCls(tab === 'skills')}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Wand2
                size={16}
                strokeWidth={1.85}
                className={`shrink-0 ${tab === 'skills' ? 'opacity-100' : 'opacity-75'}`}
              />
              <span className="truncate whitespace-nowrap">
                {tr(lang, 'Slash /Skills', '快捷技能 (/Skills)')}
              </span>
            </span>
            {customSkills.length > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10.5px] shrink-0 whitespace-nowrap ${
                  tab === 'skills' ? 'bg-white/20 text-white' : 'bg-indigo-500/14 text-indigo-500'
                }`}
              >
                {customSkills.length}
              </span>
            )}
          </button>

          <button
            onClick={() => selectTab('general')}
            className={navBtnCls(tab === 'general')}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Sliders
                size={16}
                strokeWidth={1.85}
                className={`shrink-0 ${tab === 'general' ? 'opacity-100' : 'opacity-75'}`}
              />
              <span className="truncate whitespace-nowrap">
                {tr(lang, 'Appearance & Privacy', '外观、语言与隐私')}
              </span>
            </span>
          </button>

          <button
            onClick={() => selectTab('updates')}
            className={navBtnCls(tab === 'updates')}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <ArrowDownCircle
                size={16}
                strokeWidth={1.85}
                className={`shrink-0 ${tab === 'updates' ? 'opacity-100' : 'opacity-75'}`}
              />
              <span className="truncate whitespace-nowrap">
                {tr(lang, 'Updates & License', '一键更新与许可')}
              </span>
            </span>
            {hasUpdateHighlight && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10.5px] font-semibold shrink-0 whitespace-nowrap ${
                  tab === 'updates'
                    ? 'bg-white/20 text-white'
                    : 'bg-emerald-500/20 text-emerald-500'
                }`}
              >
                {tr(lang, 'NEW', '新版')}
              </span>
            )}
          </button>
          </div>

          <div className="hidden md:block mt-auto pt-3 text-[11px] opacity-40 px-2 leading-[1.65] space-y-0.5 select-none">
            <div className="truncate">{tr(lang, '⌘E Sidebar · ⌘L Command Bar', '⌘E 开关侧栏 · ⌘L 智能栏')}</div>
            <div className="truncate">{tr(lang, '⇧⌘R Reader · ⇧⌘T Reopen Tab', '⇧⌘R 阅读视图 · ⇧⌘T 恢复标签')}</div>
            <div className="truncate">{tr(lang, '⌘⇧\\ Split View · ⇧⌘S Focus', '⌘⇧\\ 左右分屏 · ⇧⌘S 极简沉浸')}</div>
            <div className="truncate">{tr(lang, '⌘J Inline Write & Form Fill', '⌘J 网页输入框帮写')}</div>
          </div>
        </div>

        {/* 主内容区域（min-h-0 保证窄屏纵向布局下内部面板独立纵向滚动） */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* 顶部导航条 */}
          <div
            className={`h-[48px] md:h-[56px] px-4 md:px-7 border-b flex items-center justify-between gap-2 md:gap-4 shrink-0 ${
              isDark ? 'border-white/[0.07]' : 'border-black/[0.06]'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`h-[30px] px-1 rounded-full border inline-flex items-center shrink-0 ${
                  isDark
                    ? 'bg-white/[0.04] border-white/[0.09]'
                    : 'bg-zinc-100/80 border-black/[0.07]'
                }`}
              >
                <button
                  type="button"
                  disabled={!canGoBack}
                  onClick={goBackTab}
                  title={tr(lang, 'Previous section', '返回上一设置页')}
                  className="w-7 h-6 rounded-full flex items-center justify-center transition enabled:hover:bg-black/[0.06] dark:enabled:hover:bg-white/[0.08] disabled:opacity-25"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  disabled={!canGoForward}
                  onClick={goForwardTab}
                  title={tr(lang, 'Next section', '前进至下一设置页')}
                  className="w-7 h-6 rounded-full flex items-center justify-center transition enabled:hover:bg-black/[0.06] dark:enabled:hover:bg-white/[0.08] disabled:opacity-25"
                >
                  <ChevronRight size={15} />
                </button>
              </div>

              <h2 className="font-semibold text-[15.5px] tracking-[-0.015em] truncate">
                {tabMeta[tab].title}
              </h2>
            </div>

            <button
              onClick={onClose}
              title={tr(lang, 'Close (Esc)', '关闭设置 (Esc)')}
              className="w-7 h-7 rounded-lg flex items-center justify-center opacity-55 hover:opacity-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition shrink-0"
            >
              <X size={16} />
            </button>
          </div>

          {tab === 'account' ? (
            <AccountSettingsPanel
              isDark={isDark}
              lang={lang}
              settings={settings}
              accountState={accountState}
              onUpdateSettings={onUpdateSettings}
              onJumpToModels={() => selectTab('ai')}
            />
          ) : tab === 'tools' ? (
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4 text-[13px]">
              <p className="text-[13px] leading-relaxed opacity-60">
                {tabMeta.tools.description}
              </p>
              <ConnectToolsListPanel
                isDark={isDark}
                lang={lang}
                tools={connectedTools}
                autoConnectEnabled={settings.autoConnectLoggedInApps !== false}
                compact
                onConnectTool={async (tid) => {
                  await onConnectTool?.(tid)
                }}
                onDisconnectTool={async (tid) => {
                  await onDisconnectTool?.(tid)
                }}
                onToggleAutoConnect={async (en) => {
                  await onToggleAutoConnectTools?.(en)
                }}
                onRefresh={onRefreshConnectedTools}
              />
            </div>
          ) : tab === 'ai' ? (
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5 text-[13px]">
              <p className="text-[13px] leading-relaxed opacity-60 -mb-1">
                {tabMeta.ai.description}
              </p>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold opacity-75">
                    {tr(lang, 'Active AI Provider', '选择当前使用的模型渠道')}
                  </label>
                  <button
                    onClick={() => void handleAddCustomProvider()}
                    className="inline-flex items-center gap-1 text-indigo-500 hover:underline font-medium"
                  >
                    <Plus size={12} />
                    <span>{tr(lang, 'Add Custom Provider', '新增自定义渠道')}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {settings.providers.map((p) => {
                    const isCurrent = p.id === settings.activeProviderId
                    const isEditing = p.id === selectedProvider.id
                    return (
                      <button
                        key={p.id}
                        onClick={() => void handleActivateProvider(p)}
                        className={`p-2.5 rounded-xl border text-left transition flex items-center justify-between gap-2 ${
                          isEditing
                            ? isDark
                              ? 'bg-indigo-500/15 border-indigo-400/50 text-white'
                              : 'bg-indigo-50/70 border-indigo-400 text-zinc-900'
                            : isDark
                              ? 'bg-white/[0.03] border-white/8 hover:bg-white/[0.06]'
                              : 'bg-zinc-50 border-black/8 hover:bg-zinc-100/70'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold truncate flex items-center gap-1.5">
                            <span className="truncate">{p.name}</span>
                            {p.isArkoCloud && (
                              <span className="px-1.5 py-0.2 rounded text-[9.5px] font-semibold bg-indigo-500/18 text-indigo-500 shrink-0">
                                {tr(lang, 'Official', '官方内置')}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] opacity-55 truncate">
                            {p.isArkoCloud
                              ? accountState?.authenticated && accountState.user
                                ? `${accountState.user.email || accountState.user.username} · $${(accountState.user.remainingUsd ?? 0).toFixed(2)}`
                                : tr(
                                    lang,
                                    'Sign in with email · Zero API key setup',
                                    '邮箱登录即用 · 免手动配置密钥'
                                  )
                              : p.baseUrl}
                          </div>
                        </div>
                        {isCurrent && (
                          <CheckCircle2 size={15} className="text-indigo-500 shrink-0" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div
                className={`p-4 rounded-2xl border space-y-3.5 ${
                  isDark ? 'bg-white/[0.02] border-white/8' : 'bg-zinc-50/70 border-black/7'
                }`}
              >
                {selectedProvider.isArkoCloud ? (
                  <div
                    className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                      isDark
                        ? 'bg-indigo-500/10 border-indigo-400/25'
                        : 'bg-indigo-50/80 border-indigo-200/80'
                    }`}
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-semibold text-sm flex items-center gap-2">
                        <Sparkles size={14} className="text-indigo-500 shrink-0" />
                        <span>{tr(lang, 'Arko Cloud Engine', 'Arko 官方云端引擎')}</span>
                      </div>
                      <div className="opacity-70 truncate">
                        {accountState?.authenticated && accountState.user
                          ? tr(
                              lang,
                              `Signed in as ${accountState.user.email || accountState.user.username} · Available balance $${(accountState.user.remainingUsd ?? 0).toFixed(2)} USD`,
                              `已登录账号 ${accountState.user.email || accountState.user.username} · 当前可用余额 $${(accountState.user.remainingUsd ?? 0).toFixed(2)} USD`
                            )
                          : tr(
                              lang,
                              'Sign in or register with email to automatically activate built-in flagship models.',
                              '使用邮箱注册或登录 Arko 账号，即可自动激活内置云端旗舰模型。'
                            )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => selectTab('account')}
                      className="h-8.5 px-3.5 rounded-[10px] bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition shrink-0"
                    >
                      {accountState?.authenticated
                        ? tr(lang, 'Manage Account', '管理账号与额度')
                        : tr(lang, 'Sign In / Register', '邮箱登录 / 注册')}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <input
                        value={selectedProvider.name}
                        onChange={(e) => void patchProvider({ name: e.target.value })}
                        className="font-semibold text-sm bg-transparent outline-none border-b border-transparent focus:border-indigo-500"
                      />

                      {selectedProvider.apiKeyUrl && (
                        <button
                          onClick={() => {
                            onClose()
                            onNavigateInBrowser(selectedProvider.apiKeyUrl!)
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition"
                        >
                          <span>{tr(lang, 'Get API Key', '获取 API 密钥')}</span>
                          <ExternalLink size={11} />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2 space-y-1">
                        <label className="opacity-65">Base URL</label>
                        <input
                          value={selectedProvider.baseUrl}
                          onChange={(e) => void patchProvider({ baseUrl: e.target.value })}
                          placeholder="https://api.openai.com/v1"
                          className={`w-full h-9 px-3 rounded-xl border outline-none font-mono ${
                            isDark
                              ? 'bg-[#16161C] border-white/10 focus:border-indigo-400'
                              : 'bg-white border-black/12 focus:border-indigo-500'
                          }`}
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="opacity-65">{tr(lang, 'Protocol', '请求协议')}</label>
                        <select
                          value={selectedProvider.protocol}
                          onChange={(e) =>
                            void patchProvider({ protocol: e.target.value as ProviderProtocol })
                          }
                          className={`w-full h-9 px-2.5 rounded-xl border outline-none ${
                            isDark
                              ? 'bg-[#16161C] border-white/10'
                              : 'bg-white border-black/12'
                          }`}
                        >
                          <option value="openai-chat">OpenAI Chat (/v1/chat/completions)</option>
                          <option value="anthropic-messages">Anthropic (/v1/messages)</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="opacity-65">
                        {tr(
                          lang,
                          'API Key (stored locally on your device)',
                          'API Key 密钥（仅保存在本机本地目录）'
                        )}
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type={showKey ? 'text' : 'password'}
                          value={selectedProvider.apiKey}
                          onChange={(e) => void patchProvider({ apiKey: e.target.value })}
                          placeholder="sk-..."
                          className={`w-full h-9 pl-3 pr-9 rounded-xl border outline-none font-mono ${
                            isDark
                              ? 'bg-[#16161C] border-white/10 focus:border-indigo-400'
                              : 'bg-white border-black/12 focus:border-indigo-500'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey(!showKey)}
                          className="absolute right-2.5 opacity-55 hover:opacity-100"
                        >
                          {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="opacity-65">
                      {tr(lang, 'Default Model', '当前默认模型')}
                    </label>
                    <select
                      value={
                        selectedProvider.id === settings.activeProviderId
                          ? settings.activeModelId
                          : selectedProvider.defaultModelId
                      }
                      onChange={(e) => {
                        const mid = e.target.value
                        void patchProvider({ defaultModelId: mid })
                        if (selectedProvider.id === settings.activeProviderId) {
                          void onUpdateSettings({ activeModelId: mid })
                        }
                      }}
                      className={`w-full h-9 px-2.5 rounded-xl border outline-none ${
                        isDark
                          ? 'bg-[#16161C] border-white/10'
                          : 'bg-white border-black/12'
                      }`}
                    >
                      {selectedProvider.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} ({m.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="opacity-65">
                      {tr(lang, 'Add Custom Model ID', '手动添加自定义模型 ID')}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        value={customModelInput}
                        onChange={(e) => setCustomModelInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleAddCustomModel()
                        }}
                        placeholder={tr(lang, 'e.g. gpt-6.2-sol', '如 gpt-6.2-sol')}
                        className={`flex-1 h-9 px-3 rounded-xl border outline-none font-mono ${
                          isDark
                            ? 'bg-[#16161C] border-white/10'
                            : 'bg-white border-black/12'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => void handleAddCustomModel()}
                        className="h-9 px-3 rounded-xl border font-medium hover:bg-black/5 dark:hover:bg-white/8"
                      >
                        {tr(lang, 'Add', '添加')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={testing}
                    onClick={() => void handleTest()}
                    className="h-8 px-3 rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium inline-flex items-center gap-1.5 hover:opacity-90 transition disabled:opacity-50"
                  >
                    {testing ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                    <span>{tr(lang, 'Test Connection', '测试连接')}</span>
                  </button>

                  <button
                    type="button"
                    disabled={fetchingModels}
                    onClick={() => void handleFetchModels()}
                    className={`h-8 px-3 rounded-xl border font-medium inline-flex items-center gap-1.5 transition ${
                      isDark
                        ? 'border-white/12 hover:bg-white/8'
                        : 'border-black/12 bg-white hover:bg-zinc-100'
                    }`}
                  >
                    <RefreshCw size={12} className={fetchingModels ? 'animate-spin' : ''} />
                    <span>{tr(lang, 'Sync /v1/models', '同步 /v1/models 列表')}</span>
                  </button>

                  {selectedProvider.isArkoCloud && (
                    <button
                      type="button"
                      disabled={queryingQuota}
                      onClick={() => void handleQueryQuota()}
                      className={`h-8 px-3 rounded-xl border font-medium inline-flex items-center gap-1.5 transition ${
                        isDark
                          ? 'border-indigo-500/35 text-indigo-300 hover:bg-indigo-500/15'
                          : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                      }`}
                    >
                      {queryingQuota ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Coins size={13} />
                      )}
                      <span>{tr(lang, 'Check Cloud Balance', '查询 Arko 云端余额')}</span>
                    </button>
                  )}
                </div>

                {testResult && (
                  <div
                    className={`p-2.5 rounded-xl border ${
                      testResult.ok
                        ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-300'
                        : 'bg-rose-500/10 border-rose-500/25 text-rose-600 dark:text-rose-300'
                    }`}
                  >
                    {testResult.ok
                      ? tr(
                          lang,
                          `✓ Connected in ${testResult.latencyMs} ms (Reply: "${testResult.replyPreview}")`,
                          `✓ 连接成功！响应耗时 ${testResult.latencyMs} ms（返回: "${testResult.replyPreview}"）`
                        )
                      : `✕ ${testResult.error}`}
                  </div>
                )}

                {fetchMsg && (
                  <div className="p-2.5 rounded-xl border bg-indigo-500/10 border-indigo-500/25 text-indigo-600 dark:text-indigo-300">
                    {fetchMsg}
                  </div>
                )}

                {quotaResult && (
                  <div
                    className={`p-2.5 rounded-xl border ${
                      quotaResult.ok
                        ? 'bg-amber-500/10 border-amber-500/25 text-amber-700 dark:text-amber-300'
                        : 'bg-rose-500/10 border-rose-500/25 text-rose-600 dark:text-rose-300'
                    }`}
                  >
                    {quotaResult.ok ? (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-medium">
                        <span>
                          {tr(lang, 'Plan:', '令牌名称：')} {quotaResult.planName}
                        </span>
                        {typeof quotaResult.remainingUsd === 'number' && (
                          <span>
                            {tr(lang, 'Remaining:', '剩余额度：')} $
                            {quotaResult.remainingUsd.toFixed(2)} USD
                          </span>
                        )}
                        {typeof quotaResult.usedUsd === 'number' && (
                          <span>
                            {tr(lang, 'Used:', '已用：')} ${quotaResult.usedUsd.toFixed(2)} USD
                          </span>
                        )}
                        {quotaResult.extra && <span className="opacity-80">{quotaResult.extra}</span>}
                      </div>
                    ) : (
                      <span>{quotaResult.error}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : tab === 'memory' ? (
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5 text-[13px]">
              <p className="text-[13px] leading-relaxed opacity-60 -mb-1">
                {tabMeta.memory.description}
              </p>
              <div
                className={`p-3.5 rounded-2xl border flex items-center justify-between gap-4 ${
                  isDark ? 'bg-white/[0.03] border-white/8' : 'bg-zinc-50 border-black/7'
                }`}
              >
                <div>
                  <div className="font-semibold">
                    {tr(lang, 'Enable Arko Personal Memory (@Memory)', '启用 Arko 长期个人记忆 (@Memory)')}
                  </div>
                  <div className="opacity-60 mt-0.5 leading-relaxed">
                    {tr(
                      lang,
                      'When enabled, Arko incorporates active memory items across sidebar chats, Chat Tabs, and ⌘J Inline Write (strictly isolated on sensitive sites). You can also type /remember in chat.',
                      '开启后，Arko 会在所有对话、新建标签页问答与 ⌘J 网页内联帮写中自动参考以下启用条目（敏感站点严格隔离）。也可在对话中输入 /remember 添加。'
                    )}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.memoryEnabled}
                  onChange={(e) => void onUpdateSettings({ memoryEnabled: e.target.checked })}
                  className="w-4 h-4 accent-indigo-600 cursor-pointer shrink-0"
                />
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!newMemContent.trim()) return
                  void onAddMemory(newMemContent.trim(), newMemCategory)
                  setNewMemContent('')
                }}
                className={`p-4 rounded-2xl border space-y-3 ${
                  isDark ? 'bg-white/[0.02] border-white/10' : 'bg-zinc-50/70 border-black/8'
                }`}
              >
                <div className="font-semibold">
                  {tr(lang, 'Add a Personal Memory Item', '添加一条关于你的长期记忆')}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={newMemCategory}
                    onChange={(e) =>
                      setNewMemCategory(e.target.value as MemoryItem['category'])
                    }
                    className={`h-9 px-2.5 rounded-xl border outline-none shrink-0 ${
                      isDark ? 'bg-[#16161C] border-white/10' : 'bg-white border-black/12'
                    }`}
                  >
                    <option value="preference">{getMemoryCategoryLabel('preference', lang)}</option>
                    <option value="project">{getMemoryCategoryLabel('project', lang)}</option>
                    <option value="tone">{getMemoryCategoryLabel('tone', lang)}</option>
                    <option value="fact">{getMemoryCategoryLabel('fact', lang)}</option>
                  </select>

                  <input
                    value={newMemContent}
                    onChange={(e) => setNewMemContent(e.target.value)}
                    placeholder={tr(
                      lang,
                      'e.g. Full-stack engineer using TypeScript & Rust; prefer concise code examples…',
                      '例如：我是全栈工程师，主力技术栈 TypeScript + Rust，喜欢简洁直接的代码示例…'
                    )}
                    className={`flex-1 h-9 px-3 rounded-xl border outline-none ${
                      isDark ? 'bg-[#16161C] border-white/10' : 'bg-white border-black/12'
                    }`}
                  />

                  <button
                    type="submit"
                    disabled={!newMemContent.trim()}
                    className="h-9 px-3.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 disabled:opacity-40 shrink-0"
                  >
                    {tr(lang, 'Add Memory', '添加记忆')}
                  </button>
                </div>
              </form>

              <div className="space-y-2">
                <div className="font-semibold opacity-75">
                  {tr(
                    lang,
                    `Saved Memory Items (${memories.length})`,
                    `已保存的记忆条目 (${memories.length})`
                  )}
                </div>

                {memories.length === 0 ? (
                  <div
                    className={`p-8 rounded-2xl border text-center opacity-50 ${
                      isDark ? 'border-white/8' : 'border-black/8'
                    }`}
                  >
                    {tr(
                      lang,
                      'No memory items yet. Add your role, tech stack, or writing style so Arko thinks and writes in your voice.',
                      '暂无记忆条目。添加你的职业、常用技术栈或写作风格，让 Arko 真正以你的口吻思考与帮写。'
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {memories.map((m) => (
                      <div
                        key={m.id}
                        className={`p-3 rounded-xl border flex items-start justify-between gap-3 ${
                          isDark ? 'bg-white/[0.03] border-white/8' : 'bg-white border-black/8'
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={m.enabled}
                            onChange={(e) => void onToggleMemory(m.id, e.target.checked)}
                            className="mt-1 accent-indigo-600 cursor-pointer"
                          />
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-indigo-500/12 text-indigo-500">
                                {getMemoryCategoryLabel(m.category, lang)}
                              </span>
                              {m.source && (
                                <span className="text-[10.5px] opacity-45">{m.source}</span>
                              )}
                            </div>
                            <p
                              className={`leading-relaxed ${
                                m.enabled ? '' : 'line-through opacity-45'
                              }`}
                            >
                              {m.content}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => void onDeleteMemory(m.id)}
                          className="p-1 rounded-lg text-rose-500 opacity-65 hover:opacity-100 hover:bg-rose-500/10 shrink-0"
                          title={tr(lang, 'Delete memory item', '删除此条记忆')}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : tab === 'skills' ? (
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5 text-[13px]">
              <p className="text-[13px] leading-relaxed opacity-60 -mb-1">
                {tabMeta.skills.description}
              </p>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold opacity-75">
                    {tr(lang, 'Starter Skill Templates', '从灵感模板一键载入')}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setImportJsonOpen(!importJsonOpen)}
                      className="inline-flex items-center gap-1 text-indigo-500 hover:underline"
                    >
                      <Upload size={12} />
                      <span>{tr(lang, 'Import JSON', '导入 JSON')}</span>
                    </button>
                    {customSkills.length > 0 && (
                      <button
                        type="button"
                        onClick={handleExportCustomSkills}
                        className="inline-flex items-center gap-1 text-indigo-500 hover:underline"
                      >
                        <Copy size={12} />
                        <span>{tr(lang, 'Copy JSON', '复制技能 JSON')}</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {skillStarters.map((tpl) => (
                    <button
                      key={tpl.command}
                      type="button"
                      onClick={() => {
                        setEditingSkillId(null)
                        setSkillIcon(tpl.icon)
                        setSkillCmd(tpl.command)
                        setSkillLabel(tpl.label)
                        setSkillDesc(tpl.description)
                        setSkillScope(tpl.contextScope || 'active')
                        setSkillTemplate(tpl.promptTemplate)
                        setSkillFeedback(null)
                      }}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border transition ${
                        isDark
                          ? 'bg-white/[0.03] border-white/10 hover:bg-white/[0.08]'
                          : 'bg-zinc-50 border-black/8 hover:bg-zinc-100'
                      }`}
                    >
                      <span>{tpl.icon}</span>
                      <span className="font-mono text-indigo-500">{tpl.command}</span>
                      <span>{tpl.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {importJsonOpen && (
                <div
                  className={`p-3.5 rounded-2xl border space-y-2 ${
                    isDark ? 'bg-white/[0.03] border-white/10' : 'bg-zinc-50 border-black/8'
                  }`}
                >
                  <div className="font-medium">
                    {tr(lang, 'Paste custom skills JSON array', '粘贴自定义技能 JSON 数组')}
                  </div>
                  <textarea
                    rows={3}
                    value={importJsonText}
                    onChange={(e) => setImportJsonText(e.target.value)}
                    placeholder='[{"command":"/weekly","icon":"📊","label":"Weekly Digest","promptTemplate":"..."}]'
                    className={`w-full p-2.5 rounded-xl border outline-none font-mono text-[11px] ${
                      isDark ? 'bg-[#15151B] border-white/10' : 'bg-white border-black/10'
                    }`}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setImportJsonOpen(false)}
                      className="px-2.5 py-1 rounded-lg opacity-70"
                    >
                      {tr(lang, 'Cancel', '取消')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleImportSkillsJson()}
                      className="px-3 py-1 rounded-lg bg-indigo-600 text-white font-medium"
                    >
                      {tr(lang, 'Import', '确认导入')}
                    </button>
                  </div>
                </div>
              )}

              <form
                onSubmit={(e) => void handleSaveSkill(e)}
                className={`p-4 rounded-2xl border space-y-3 ${
                  isDark ? 'bg-white/[0.02] border-white/10' : 'bg-zinc-50/80 border-black/8'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-[13px]">
                    {editingSkillId
                      ? tr(lang, 'Edit Custom /Skill', '编辑自定义 /Skill 技能')
                      : tr(lang, 'Create Custom /Skill', '新建自定义 /Skill 技能')}
                  </div>
                  {editingSkillId && (
                    <button
                      type="button"
                      onClick={resetSkillForm}
                      className="text-indigo-500 hover:underline"
                    >
                      {tr(lang, 'New instead', '切换为新建')}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-12 gap-2.5">
                  <div className="col-span-2 space-y-1">
                    <label className="opacity-65">{tr(lang, 'Icon', '图标')}</label>
                    <input
                      value={skillIcon}
                      onChange={(e) => setSkillIcon(e.target.value)}
                      className={`w-full h-9 text-center text-base rounded-xl border outline-none ${
                        isDark ? 'bg-[#16161C] border-white/10' : 'bg-white border-black/12'
                      }`}
                    />
                  </div>

                  <div className="col-span-4 space-y-1">
                    <label className="opacity-65">{tr(lang, 'Slash Command', '斜杠指令')}</label>
                    <input
                      value={skillCmd}
                      onChange={(e) => setSkillCmd(e.target.value)}
                      placeholder="/weekly-digest"
                      className={`w-full h-9 px-3 rounded-xl border outline-none font-mono ${
                        isDark ? 'bg-[#16161C] border-white/10' : 'bg-white border-black/12'
                      }`}
                    />
                  </div>

                  <div className="col-span-6 space-y-1">
                    <label className="opacity-65">{tr(lang, 'Display Name', '技能显示名称')}</label>
                    <input
                      value={skillLabel}
                      onChange={(e) => setSkillLabel(e.target.value)}
                      placeholder={tr(
                        lang,
                        'e.g. Structured Product Research Card',
                        '例如：生成结构化产品调研卡片'
                      )}
                      className={`w-full h-9 px-3 rounded-xl border outline-none ${
                        isDark ? 'bg-[#16161C] border-white/10' : 'bg-white border-black/12'
                      }`}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <span className="opacity-50 mr-1">{tr(lang, 'Quick icon:', '快捷选图标:')}</span>
                  {SKILL_EMOJI_OPTIONS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setSkillIcon(em)}
                      className={`w-6 h-6 rounded-md flex items-center justify-center transition ${
                        skillIcon === em
                          ? 'bg-indigo-500/20 ring-1 ring-indigo-500'
                          : 'hover:bg-black/6 dark:hover:bg-white/10'
                      }`}
                    >
                      {em}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="opacity-65">
                      {tr(lang, 'Short Description', '简短说明（在 / 菜单中展示）')}
                    </label>
                    <input
                      value={skillDesc}
                      onChange={(e) => setSkillDesc(e.target.value)}
                      placeholder={tr(lang, 'One-line summary…', '一句话说明该技能用途…')}
                      className={`w-full h-9 px-3 rounded-xl border outline-none ${
                        isDark ? 'bg-[#16161C] border-white/10' : 'bg-white border-black/12'
                      }`}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="opacity-65">
                      {tr(lang, 'Default Context Scope', '默认上下文范围')}
                    </label>
                    <select
                      value={skillScope}
                      onChange={(e) => setSkillScope(e.target.value as SkillContextScope)}
                      className={`w-full h-9 px-2.5 rounded-xl border outline-none ${
                        isDark ? 'bg-[#16161C] border-white/10' : 'bg-white border-black/12'
                      }`}
                    >
                      <option value="active">
                        {tr(
                          lang,
                          'Active Tab (both panes in Split View)',
                          '当前标签页（分屏时自动读取左右两页）'
                        )}
                      </option>
                      <option value="all-tabs">
                        {tr(
                          lang,
                          'All Open Tabs (up to 8 tabs)',
                          '全部打开标签页（跨标签对比综合，最多 8 页）'
                        )}
                      </option>
                      <option value="none">
                        {tr(lang, 'No Webpage Context', '不附带网页正文（纯指令生成）')}
                      </option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="opacity-65">
                      {tr(lang, 'Prompt Template', 'Prompt 模板内容')}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setSkillTemplate((prev) =>
                          prev.includes('{{input}}')
                            ? prev
                            : `${prev}${prev ? '\n\n' : ''}${tr(lang, 'Additional focus: {{input}}', '补充关注：{{input}}')}`
                        )
                      }
                      className="text-[11px] text-indigo-500 hover:underline font-mono"
                    >
                      + {'{{input}}'}
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    value={skillTemplate}
                    onChange={(e) => setSkillTemplate(e.target.value)}
                    placeholder={tr(
                      lang,
                      'Write your reusable prompt template. Use {{input}} to capture arguments typed after /command…',
                      '编写你的专属指令模板。可使用 {{input}} 接收你在 /command 后面输入的补充要求…'
                    )}
                    className={`w-full p-2.5 rounded-xl border outline-none leading-relaxed ${
                      isDark ? 'bg-[#16161C] border-white/10' : 'bg-white border-black/12'
                    }`}
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-indigo-500 font-medium">
                    {skillFeedback ||
                      (skillCmd ? `${normalizeSkillCommand(skillCmd)}` : '')}
                  </span>
                  <button
                    type="submit"
                    className="h-8 px-4 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition inline-flex items-center gap-1.5"
                  >
                    <Plus size={13} />
                    <span>
                      {editingSkillId
                        ? tr(lang, 'Save Changes', '保存修改')
                        : tr(lang, 'Save Skill', '保存自定义技能')}
                    </span>
                  </button>
                </div>
              </form>

              {customSkills.length > 0 && (
                <div className="space-y-2">
                  <div className="font-semibold opacity-75">
                    {tr(
                      lang,
                      `My Custom Skills (${customSkills.length})`,
                      `我的自定义技能 (${customSkills.length})`
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {customSkills.map((sk) => (
                      <div
                        key={sk.id}
                        className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                          isDark ? 'bg-white/[0.03] border-white/8' : 'bg-white border-black/8'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-base shrink-0">{sk.icon || '✨'}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-indigo-500">
                                {sk.command}
                              </span>
                              <span className="font-medium truncate">{sk.label}</span>
                            </div>
                            <div className="opacity-55 truncate text-[11px]">{sk.description}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {onTrySkill && (
                            <button
                              type="button"
                              onClick={() => {
                                onClose()
                                onTrySkill(sk.command)
                              }}
                              title={tr(lang, 'Run in AI Sidebar', '在 AI 侧边栏调用')}
                              className="p-1.5 rounded-lg hover:bg-indigo-500/15 text-indigo-500"
                            >
                              <Play size={13} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => loadSkillIntoForm(sk)}
                            title={tr(lang, 'Edit', '编辑技能')}
                            className="p-1.5 rounded-lg opacity-65 hover:opacity-100 hover:bg-black/6 dark:hover:bg-white/10"
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteCustomSkill(sk.id)}
                            title={tr(lang, 'Delete', '删除技能')}
                            className="p-1.5 rounded-lg text-rose-500 opacity-75 hover:opacity-100 hover:bg-rose-500/10"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="font-semibold opacity-75">
                  {tr(
                    lang,
                    `Built-in Skills & Local Zero-Token Engines (${builtinSkills.length})`,
                    `内置核心技能与本地导出引擎 (${builtinSkills.length})`
                  )}
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {builtinSkills.map((sk) => {
                    const isLocal =
                      sk.executionKind === 'local-markdown' ||
                      sk.executionKind === 'local-screenshot'
                    return (
                      <div
                        key={sk.id}
                        className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 ${
                          isDark ? 'bg-white/[0.02] border-white/7' : 'bg-zinc-50/70 border-black/6'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-base shrink-0">{sk.icon}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-indigo-500">
                                {sk.command}
                              </span>
                              <span className="font-medium">{sk.label}</span>
                            </div>
                            <div className="opacity-55 truncate text-[11px]">{sk.description}</div>
                          </div>
                        </div>

                        {onTrySkill && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose()
                              onTrySkill(sk.command)
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0 inline-flex items-center gap-1 transition ${
                              isLocal
                                ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                                : isDark
                                  ? 'bg-white/8 hover:bg-white/15'
                                  : 'bg-white border border-black/8 hover:bg-zinc-100'
                            }`}
                          >
                            {isLocal ? <Download size={11} /> : <Play size={11} />}
                            <span>
                              {isLocal
                                ? tr(lang, 'Export', '立即导出')
                                : tr(lang, 'Run', '调用')}
                            </span>
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : tab === 'general' ? (
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4 text-[13px]">
              <p className="text-[13px] leading-relaxed opacity-60 -mb-0.5">
                {tabMeta.general.description}
              </p>
              <div
                className={`p-4 rounded-2xl border flex items-center justify-between gap-4 ${
                  isDark
                    ? 'bg-indigo-500/[0.06] border-indigo-500/25'
                    : 'bg-indigo-50/60 border-indigo-200/80'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="font-semibold flex items-center gap-1.5">
                    <Sparkles size={14} className="text-indigo-500 shrink-0" />
                    <span>
                      {tr(
                        lang,
                        'Import Data from Arc, Dia, or Google Chrome',
                        '从 Arc、Dia 或 Chrome 导入数据 / 初始化引导'
                      )}
                    </span>
                  </div>
                  <div className="opacity-65 text-xs leading-relaxed">
                    {tr(
                      lang,
                      'Migrate Spaces, Top Favorites, Pinned Folders, Bookmarks, and History anytime — or reset to re-run first-launch onboarding.',
                      '一键迁移 Arc 空间、顶部常驻图标、固定标签文件夹、书签与历史记录，或重置回到初次启动状态重新体验。'
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {onResetOnboarding && (
                    <button
                      type="button"
                      onClick={() => {
                        const ok = window.confirm(
                          tr(
                            lang,
                            'Reset Spaces, tabs, bookmarks, and history to initial defaults and re-open First-Launch Setup? (Your AI models & keys will be kept.)',
                            '确认将空间、标签页、书签与历史重置为初始空白状态，并重新打开初次启动导入向导？（已配置的 AI 模型与密钥会保留）'
                          )
                        )
                        if (ok) {
                          void onResetOnboarding()
                        }
                      }}
                      className={`h-9 px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition cursor-pointer ${
                        isDark
                          ? 'border-white/12 hover:bg-white/8 text-zinc-300'
                          : 'bg-white border-black/10 hover:bg-zinc-100 text-zinc-700'
                      }`}
                    >
                      <RefreshCw size={12} />
                      <span>{tr(lang, 'Reset Onboarding', '初始化重来')}</span>
                    </button>
                  )}
                  {onOpenBrowserImport && (
                    <button
                      type="button"
                      onClick={onOpenBrowserImport}
                      className="h-9 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
                    >
                      <Download size={12.5} />
                      <span>{tr(lang, 'Import Browser Data…', '导入浏览器数据…')}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-semibold opacity-75">
                    {tr(lang, 'Interface Language / 界面语言', '界面语言 (Interface Language)')}
                  </label>
                  <select
                    value={lang}
                    onChange={(e) =>
                      void onUpdateSettings({
                        language: e.target.value as AppLanguage
                      })
                    }
                    className={`w-full h-9 px-3 rounded-xl border outline-none ${
                      isDark ? 'bg-[#16161C] border-white/10' : 'bg-zinc-50 border-black/10'
                    }`}
                  >
                    <option value="en">English (Default)</option>
                    <option value="zh-CN">简体中文 (Simplified Chinese)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold opacity-75">
                    {tr(lang, 'Tab Layout Mode', '标签栏布局模式')}
                  </label>
                  <select
                    value={settings.layoutMode}
                    onChange={(e) =>
                      void onUpdateSettings({
                        layoutMode: e.target.value as 'horizontal' | 'vertical'
                      })
                    }
                    className={`w-full h-9 px-3 rounded-xl border outline-none ${
                      isDark ? 'bg-[#16161C] border-white/10' : 'bg-zinc-50 border-black/10'
                    }`}
                  >
                    <option value="vertical">
                      {tr(lang, 'Arc-Style Left Vertical Sidebar', '左侧垂直标签栏（Arc 风格侧边栏）')}
                    </option>
                    <option value="horizontal">
                      {tr(lang, 'Calm Horizontal Top Bar', '顶部水平标签栏（极简顶栏模式）')}
                    </option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold opacity-75">
                    {tr(lang, 'Appearance Theme', '界面外观主题')}
                  </label>
                  <select
                    value={settings.theme}
                    onChange={(e) =>
                      void onUpdateSettings({
                        theme: e.target.value as 'light' | 'dark' | 'system'
                      })
                    }
                    className={`w-full h-9 px-3 rounded-xl border outline-none ${
                      isDark ? 'bg-[#16161C] border-white/10' : 'bg-zinc-50 border-black/10'
                    }`}
                  >
                    <option value="light">{tr(lang, 'Calm Light', '浅色 (Calm Light)')}</option>
                    <option value="dark">{tr(lang, 'Calm Dark', '深色 (Calm Dark)')}</option>
                    <option value="system">{tr(lang, 'Follow OS System', '跟随操作系统')}</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold opacity-75">
                    {tr(lang, 'Default Search Engine', '默认搜索引擎')}
                  </label>
                  <select
                    value={settings.searchEngine}
                    onChange={(e) =>
                      void onUpdateSettings({
                        searchEngine: e.target.value as 'google' | 'bing' | 'duckduckgo'
                      })
                    }
                    className={`w-full h-9 px-3 rounded-xl border outline-none ${
                      isDark ? 'bg-[#16161C] border-white/10' : 'bg-zinc-50 border-black/10'
                    }`}
                  >
                    <option value="google">Google</option>
                    <option value="bing">Bing</option>
                    <option value="duckduckgo">DuckDuckGo</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold opacity-75">
                  {tr(
                    lang,
                    'Global Personalization Prompt (applied to Chat Tabs, Sidebar & ⌘J Inline Write)',
                    '全局个性化风格指令（同时作用于对话标签、侧边栏与 ⌘J 内联帮写）'
                  )}
                </label>
                <textarea
                  rows={3}
                  value={settings.personalizationPrompt}
                  onChange={(e) =>
                    void onUpdateSettings({ personalizationPrompt: e.target.value })
                  }
                  placeholder={tr(
                    lang,
                    'Tell Arko your role, preferred tone, formatting habits, and reply style…',
                    '告诉 Arko 你的职业、偏好的语言风格、邮件/评论回复口吻习惯…'
                  )}
                  className={`w-full p-3 rounded-xl border outline-none leading-relaxed ${
                    isDark ? 'bg-[#16161C] border-white/10' : 'bg-zinc-50 border-black/10'
                  }`}
                />
              </div>

              <div
                className={`p-3.5 rounded-2xl border flex items-center justify-between gap-4 ${
                  isDark ? 'bg-white/[0.03] border-white/8' : 'bg-zinc-50 border-black/8'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <MousePointerClick size={17} className="text-indigo-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">
                      {tr(
                        lang,
                        'Webpage Selection Floating Bar & ⌘J Input Pill',
                        '网页划词灵动条与输入框 ⌘J 微标'
                      )}
                    </div>
                    <div className="opacity-60 mt-0.5">
                      {tr(
                        lang,
                        'Show Ask Arko / Translate / Summarize bar on text selection and a quick Write pill on focused text fields.',
                        '在网页选中文字时自动浮现 Ask Arko / 翻译 / 引用追问条，聚焦文本输入框时提示一键内联帮写。'
                      )}
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.selectionToolbarEnabled !== false}
                  onChange={(e) =>
                    void onUpdateSettings({ selectionToolbarEnabled: e.target.checked })
                  }
                  className="w-4 h-4 accent-indigo-600 cursor-pointer"
                />
              </div>

              <div
                className={`p-3.5 rounded-2xl border flex items-center justify-between gap-4 ${
                  isDark ? 'bg-white/[0.03] border-white/8' : 'bg-zinc-50 border-black/8'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <ShieldCheck size={17} className="text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">
                      {tr(
                        lang,
                        'Sensitive Site Protection',
                        '敏感站点隐私护栏 (Sensitive Site Protection)'
                      )}
                    </div>
                    <div className="opacity-60 mt-0.5">
                      {tr(
                        lang,
                        'Automatically block AI DOM extraction, selection bars, and form fill on banking, payment, and password-manager domains.',
                        '访问网银、支付及密码管理网站时，自动禁止 AI 提取网页正文、划词条及触发内联表单帮写。'
                      )}
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.sensitiveSiteGuard}
                  onChange={(e) =>
                    void onUpdateSettings({ sensitiveSiteGuard: e.target.checked })
                  }
                  className="w-4 h-4 accent-indigo-600 cursor-pointer"
                />
              </div>
            </div>
          ) : (
            /* ==================== Tab 5: One-Click Updates & License ==================== */
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5 text-[13px]">
              <p className="text-[13px] leading-relaxed opacity-60 -mb-1">
                {tabMeta.updates.description}
              </p>
              {/* Brand & Version Hero Card */}
              <div
                className={`p-5 rounded-2xl border flex items-center justify-between gap-4 ${
                  isDark ? 'bg-white/[0.03] border-white/10' : 'bg-zinc-50/80 border-black/8'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <AppIcon size={54} className="shrink-0 drop-shadow-xs" />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold tracking-tight">Arko Browser</span>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-indigo-500/15 text-indigo-500 font-semibold">
                        v{updateState?.currentVersion || '0.1.0'}
                      </span>
                    </div>
                    <p className="opacity-65 leading-relaxed max-w-md">
                      {tr(
                        lang,
                        'An AI-native, Chromium-based desktop browser inspired by Arc — built by MistBreak.',
                        '受 Arc 启发的 AI 原生 Chromium 桌面浏览器 — 由 MistBreak 打造。'
                      )}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onNavigateInBrowser(GITHUB_REPO_URL)
                  }}
                  className={`px-3 py-1.5 rounded-xl border font-medium inline-flex items-center gap-1.5 shrink-0 transition ${
                    isDark
                      ? 'border-white/12 hover:bg-white/8'
                      : 'border-black/10 bg-white hover:bg-zinc-100'
                  }`}
                >
                  <span>MistBreak/arko</span>
                  <ExternalLink size={12} />
                </button>
              </div>

              {/* One-Click Update Action Card */}
              <div
                className={`p-4 rounded-2xl border space-y-3.5 ${
                  isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/8 shadow-2xs'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-[13px]">
                      {tr(lang, 'One-Click Software Update', '客户端一键更新')}
                    </div>
                    <div className="opacity-60 mt-0.5">
                      {updateState?.status === 'checking'
                        ? tr(
                            lang,
                            'Checking GitHub Releases (MistBreak/arko)…',
                            '正在检查 GitHub Releases (MistBreak/arko) 最新版本…'
                          )
                        : updateState?.status === 'available'
                          ? tr(
                              lang,
                              `New version v${updateState.latestVersion} is ready to download!`,
                              `发现新版本 v${updateState.latestVersion}，支持应用内一键下载并更新！`
                            )
                          : updateState?.status === 'downloading'
                            ? tr(
                                lang,
                                `Downloading ${updateState.assetName || 'update package'} (${formatBytes(updateState.transferredBytes)} / ${formatBytes(updateState.totalBytes)})…`,
                                `正在下载更新包 ${updateState.assetName || ''} (${formatBytes(updateState.transferredBytes)} / ${formatBytes(updateState.totalBytes)})…`
                              )
                            : updateState?.status === 'downloaded'
                              ? tr(
                                  lang,
                                  `v${updateState.latestVersion} downloaded — click Restart to apply immediately.`,
                                  `v${updateState.latestVersion} 已下载就绪 — 点击「立即重启更新」即可自动替换完成升级。`
                                )
                              : updateState?.status === 'up-to-date'
                                ? tr(
                                    lang,
                                    `You are on the latest version (v${updateState.currentVersion}).`,
                                    `当前已是最新版本 (v${updateState.currentVersion})。`
                                  )
                                : updateState?.status === 'error'
                                  ? `${tr(lang, 'Update check message:', '检查更新提示：')} ${updateState.error}`
                                  : tr(
                                      lang,
                                      'Updates are delivered directly from official GitHub Releases (MistBreak/arko).',
                                      '更新包直接由 GitHub 官方组织仓库 (MistBreak/arko) Releases 分发。'
                                    )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {updateState?.status === 'downloaded' ? (
                      <button
                        type="button"
                        onClick={() => void onInstallUpdate?.()}
                        className="h-9 px-4 rounded-xl bg-emerald-600 text-white font-semibold inline-flex items-center gap-1.5 hover:bg-emerald-500 transition shadow-xs"
                      >
                        <RefreshCw size={13} />
                        <span>{tr(lang, 'Restart & Update Now', '立即重启完成更新')}</span>
                      </button>
                    ) : updateState?.status === 'available' ? (
                      <button
                        type="button"
                        onClick={() => void onDownloadUpdate?.()}
                        className="h-9 px-4 rounded-xl bg-indigo-600 text-white font-semibold inline-flex items-center gap-1.5 hover:bg-indigo-500 transition shadow-xs"
                      >
                        <Download size={13} />
                        <span>
                          {tr(
                            lang,
                            `One-Click Update (v${updateState.latestVersion})`,
                            `一键下载更新 (v${updateState.latestVersion})`
                          )}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={
                          updateState?.status === 'checking' ||
                          updateState?.status === 'downloading'
                        }
                        onClick={() => void onCheckUpdates?.()}
                        className="h-9 px-3.5 rounded-xl bg-indigo-600 text-white font-medium inline-flex items-center gap-1.5 hover:bg-indigo-500 disabled:opacity-50 transition"
                      >
                        <RefreshCw
                          size={13}
                          className={updateState?.status === 'checking' ? 'animate-spin' : ''}
                        />
                        <span>{tr(lang, 'Check for Updates', '检查更新')}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        void window.arko.openExternalUrl(
                          updateState?.releaseHtmlUrl || GITHUB_RELEASES_URL
                        )
                      }
                      title={tr(lang, 'Open GitHub Releases Page', '打开 GitHub Releases 页面')}
                      className={`h-9 px-3 rounded-xl border inline-flex items-center gap-1 transition ${
                        isDark
                          ? 'border-white/12 hover:bg-white/8'
                          : 'border-black/10 hover:bg-zinc-100'
                      }`}
                    >
                      <span>Releases</span>
                      <ExternalLink size={11} />
                    </button>
                  </div>
                </div>

                {updateState?.status === 'downloading' && (
                  <div className="space-y-1">
                    <div className="w-full h-2 rounded-full bg-black/8 dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 transition-all duration-150"
                        style={{ width: `${updateState.progressPercent || 2}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] opacity-60">
                      <span>{updateState.assetName}</span>
                      <span>{updateState.progressPercent || 0}%</span>
                    </div>
                  </div>
                )}

                {updateState?.releaseNotes && (
                  <div
                    className={`p-3.5 rounded-xl border max-h-44 overflow-y-auto ${
                      isDark ? 'bg-[#16161C] border-white/8' : 'bg-zinc-50 border-black/6'
                    }`}
                  >
                    <div className="text-[11px] font-semibold opacity-60 mb-1.5">
                      {tr(lang, 'Release Notes', '版本更新说明')} ({updateState.releaseName})
                    </div>
                    <ChatMarkdown
                      content={updateState.releaseNotes}
                      lang={lang}
                      onOpenLink={(u) => void window.arko.openExternalUrl(u)}
                    />
                  </div>
                )}

                <div className="pt-1 border-t border-black/6 dark:border-white/8 flex items-center justify-between">
                  <span className="opacity-70">
                    {tr(
                      lang,
                      'Automatically check for updates in the background on launch',
                      '启动浏览器时自动在后台静默检查新版本'
                    )}
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.autoCheckUpdates !== false}
                    onChange={(e) =>
                      void onUpdateSettings({ autoCheckUpdates: e.target.checked })
                    }
                    className="w-4 h-4 accent-indigo-600 cursor-pointer"
                  />
                </div>
              </div>

              {/* License Card */}
              <div
                className={`p-4 rounded-2xl border flex items-start gap-3 ${
                  isDark ? 'bg-white/[0.02] border-white/8' : 'bg-zinc-50/70 border-black/7'
                }`}
              >
                <Scale size={17} className="text-indigo-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-semibold">
                    {tr(
                      lang,
                      'Source-Available Non-Commercial License (Apache-2.0 + Commons Clause)',
                      '非商用源码公开协议 (Apache-2.0 + Commons Clause)'
                    )}
                  </div>
                  <p className="opacity-65 leading-relaxed">
                    {tr(
                      lang,
                      'Free for personal, academic, and everyday workplace browsing, modification, and non-commercial sharing. Selling the software, paid re-packaging, or commercial hosted offerings are strictly prohibited without commercial authorization from MistBreak.',
                      '允许个人、学术及日常办公场景免费使用、研究修改与非商业分享；未经 MistBreak 授权，严禁将本软件或其衍生品用于商业售卖、付费套壳分发或商业化托管服务。'
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
