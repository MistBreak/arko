import type {
  AIModelItem,
  AIProviderConfig,
  AppLanguage,
  AppSettings,
  BrowserProfile,
  InputIntentType,
  SearchEngineId,
  SlashSkill,
  TabGroupColor
} from './types'

export const APP_NAME = 'Arko'
export const APP_FULL_NAME = 'Arko Browser'
export const GITHUB_ORG = 'MistBreak'
export const GITHUB_REPO = 'arko'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_ORG}/${GITHUB_REPO}`
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`
export const GITHUB_RELEASES_API_LATEST = `https://api.github.com/repos/${GITHUB_ORG}/${GITHUB_REPO}/releases/latest`

export const NEW_TAB_URL = 'arko://newtab'
export const CHAT_TAB_PREFIX = 'arko://chat/'

const LEGACY_NEW_TAB_URL = 'dia://newtab'
const LEGACY_CHAT_TAB_PREFIX = 'dia://chat/'

export function normalizeLegacyInternalUrl(url?: string | null): string {
  if (!url) return NEW_TAB_URL
  if (url === LEGACY_NEW_TAB_URL) return NEW_TAB_URL
  if (url.startsWith(LEGACY_CHAT_TAB_PREFIX)) {
    return `${CHAT_TAB_PREFIX}${url.slice(LEGACY_CHAT_TAB_PREFIX.length)}`
  }
  return url
}

export function isChatTabUrl(url?: string | null): boolean {
  return Boolean(
    url && (url.startsWith(CHAT_TAB_PREFIX) || url.startsWith(LEGACY_CHAT_TAB_PREFIX))
  )
}

export function getChatThreadIdFromUrl(url?: string | null): string | null {
  if (!url) return null
  if (url.startsWith(CHAT_TAB_PREFIX)) {
    return url.slice(CHAT_TAB_PREFIX.length).trim() || null
  }
  if (url.startsWith(LEGACY_CHAT_TAB_PREFIX)) {
    return url.slice(LEGACY_CHAT_TAB_PREFIX.length).trim() || null
  }
  return null
}

export function makeChatTabUrl(threadId: string): string {
  return `${CHAT_TAB_PREFIX}${threadId}`
}

export function isInternalArkoUrl(url?: string | null): boolean {
  if (!url) return true
  return url === NEW_TAB_URL || url === LEGACY_NEW_TAB_URL || isChatTabUrl(url)
}

// Legacy alias kept for zero-breakage internal imports
export const isInternalDiaUrl = isInternalArkoUrl

export const TAB_GROUP_COLOR_STYLES: Record<
  TabGroupColor,
  { dot: string; badgeBg: string; badgeText: string; hex: string; label: string; labelEn: string }
> = {
  indigo: {
    dot: 'bg-indigo-500',
    badgeBg: 'bg-indigo-500/15 border-indigo-500/30',
    badgeText: 'text-indigo-600 dark:text-indigo-300',
    hex: '#6366F1',
    label: '靛蓝',
    labelEn: 'Indigo'
  },
  emerald: {
    dot: 'bg-emerald-500',
    badgeBg: 'bg-emerald-500/15 border-emerald-500/30',
    badgeText: 'text-emerald-600 dark:text-emerald-300',
    hex: '#10B981',
    label: '翡翠',
    labelEn: 'Emerald'
  },
  amber: {
    dot: 'bg-amber-500',
    badgeBg: 'bg-amber-500/15 border-amber-500/30',
    badgeText: 'text-amber-700 dark:text-amber-300',
    hex: '#F59E0B',
    label: '琥珀',
    labelEn: 'Amber'
  },
  rose: {
    dot: 'bg-rose-500',
    badgeBg: 'bg-rose-500/15 border-rose-500/30',
    badgeText: 'text-rose-600 dark:text-rose-300',
    hex: '#F43F5E',
    label: '珊瑚',
    labelEn: 'Rose'
  },
  sky: {
    dot: 'bg-sky-500',
    badgeBg: 'bg-sky-500/15 border-sky-500/30',
    badgeText: 'text-sky-600 dark:text-sky-300',
    hex: '#0EA5E9',
    label: '晴空',
    labelEn: 'Sky'
  },
  violet: {
    dot: 'bg-violet-500',
    badgeBg: 'bg-violet-500/15 border-violet-500/30',
    badgeText: 'text-violet-600 dark:text-violet-300',
    hex: '#8B5CF6',
    label: '紫罗兰',
    labelEn: 'Violet'
  }
}

export const ARKO_CLOUD_PROVIDER_ID = 'arko-cloud'
export const ARKO_CLOUD_INTERNAL_URL = 'arko://cloud'

export const PRESET_OPENAI_MODELS: AIModelItem[] = [
  { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' },
  { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna' }
]

export const PRESET_ANTHROPIC_MODELS: AIModelItem[] = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }
]

export const PRESET_GEMINI_MODELS: AIModelItem[] = [
  { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon' },
  { id: 'gemini-4-neon', label: 'Gemini 4 Neon' },
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' }
]

export const PRESET_OLLAMA_MODELS: AIModelItem[] = [
  { id: 'qwen3.8:latest', label: 'Qwen 3.8 (Local)' },
  { id: 'gemma4:12b', label: 'Gemma 4 12B (Local)' },
  { id: 'llama4:latest', label: 'Llama 4 (Local)' }
]

export const PRESET_ARKO_CLOUD_MODELS: AIModelItem[] = [
  { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon' },
  { id: 'gemini-4-neon', label: 'Gemini 4 Neon' },
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' },
  { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' },
  { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }
]

export const LEGACY_DEPRECATED_MODEL_IDS = new Set<string>([
  'gpt-4.1',
  'gpt-4o',
  'gpt-4o-mini',
  'o3-mini',
  'gpt-6-sol',
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-latest',
  'claude-3-5-haiku-latest',
  'claude-fable-5-1',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-3.8-flash',
  'gemini-4-argon',
  'qwen3:8b',
  'llama3.3:latest'
])

export const DEFAULT_PROVIDERS: AIProviderConfig[] = [
  {
    id: ARKO_CLOUD_PROVIDER_ID,
    name: 'Arko Cloud',
    protocol: 'openai-chat',
    baseUrl: ARKO_CLOUD_INTERNAL_URL,
    apiKey: '',
    defaultModelId: 'gemini-4-carbon',
    models: PRESET_ARKO_CLOUD_MODELS,
    isArkoCloud: true
  },
  {
    id: 'openai-official',
    name: 'OpenAI (Official / Compatible)',
    protocol: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    defaultModelId: 'gpt-6.2-sol',
    models: PRESET_OPENAI_MODELS,
    websiteUrl: 'https://platform.openai.com',
    apiKeyUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'anthropic-official',
    name: 'Anthropic Claude (/v1/messages)',
    protocol: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    defaultModelId: 'claude-sonnet-5-5',
    models: PRESET_ANTHROPIC_MODELS,
    websiteUrl: 'https://console.anthropic.com',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'gemini-openai',
    name: 'Google Gemini (OpenAI Compatible)',
    protocol: 'openai-chat',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: '',
    defaultModelId: 'gemini-4-carbon',
    models: PRESET_GEMINI_MODELS,
    websiteUrl: 'https://aistudio.google.com',
    apiKeyUrl: 'https://aistudio.google.com/apikey'
  },
  {
    id: 'custom-ollama',
    name: 'Local Ollama (localhost:11434)',
    protocol: 'openai-chat',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama',
    defaultModelId: 'qwen3.8:latest',
    models: PRESET_OLLAMA_MODELS,
    websiteUrl: 'https://ollama.com',
    apiKeyUrl: 'https://ollama.com/library'
  }
]

export const PROFILE_ACCENT_PRESETS: Array<{ hex: string; label: string; labelEn: string }> = [
  { hex: '#0284C7', label: 'Sky 晴空蓝', labelEn: 'Sky Blue' },
  { hex: '#52525B', label: 'Graphite 曜石灰', labelEn: 'Graphite' },
  { hex: '#6366F1', label: 'Indigo 靛蓝', labelEn: 'Indigo' },
  { hex: '#0D9488', label: 'Teal 青碧', labelEn: 'Teal' },
  { hex: '#7C3AED', label: 'Violet 紫罗兰', labelEn: 'Violet' },
  { hex: '#E11D48', label: 'Rose 绯红', labelEn: 'Rose' },
  { hex: '#D97706', label: 'Amber 琥珀', labelEn: 'Amber' },
  { hex: '#059669', label: 'Emerald 翡翠', labelEn: 'Emerald' },
  { hex: '#EA580C', label: 'Coral 珊瑚橙', labelEn: 'Coral' },
  { hex: '#64748B', label: 'Slate 极简灰蓝', labelEn: 'Slate' }
]

export const DEFAULT_PROFILES: BrowserProfile[] = [
  {
    id: 'personal',
    name: 'Personal',
    emoji: '🌿',
    accentColor: '#0284C7',
    partition: 'persist:arko-profile-personal'
  },
  {
    id: 'work',
    name: 'Work',
    emoji: '💼',
    accentColor: '#52525B',
    partition: 'persist:arko-profile-work'
  }
]

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  onboardingCompleted: false,
  autoCheckUpdates: true,
  layoutMode: 'vertical',
  sidebarCollapsed: false,
  sidebarWidth: 232,
  compactTopBar: false,
  aiSidebarWidth: 380,
  agentModeEnabled: true,
  theme: 'system',
  searchEngine: 'google',
  activeProviderId: ARKO_CLOUD_PROVIDER_ID,
  activeModelId: 'gemini-4-carbon',
  providers: DEFAULT_PROVIDERS,
  personalizationPrompt:
    'Be clear, structured, and concise. When referencing multiple open tabs, cite which page each insight comes from.',
  sensitiveSiteGuard: true,
  includeActiveTabByDefault: true,
  selectionToolbarEnabled: true,
  memoryEnabled: true,
  customSkills: [],
  autoConnectLoggedInApps: true,
  manuallyConnectedTools: [],
  manuallyDisconnectedTools: [],
  toolsOnboardingSeen: false
}

export const BUILTIN_SLASH_SKILLS_EN: SlashSkill[] = [
  {
    id: 'builtin-summarize',
    command: '/summarize',
    icon: '📝',
    label: 'Summarize Key Points',
    description: 'Distill core arguments, metrics, and takeaways from the active page (or both Split View panes)',
    promptTemplate:
      'Summarize the core content, key arguments, and actionable takeaways of the provided page(s) in clear bullet points.',
    contextScope: 'active',
    executionKind: 'ai',
    isBuiltin: true
  },
  {
    id: 'builtin-compare',
    command: '/compare',
    icon: '⚖️',
    label: 'Compare Across Tabs',
    description: 'Compare Split View panes or all open tabs side-by-side in a structured table',
    promptTemplate:
      'Compare the core features, pros & cons, positioning, or pricing across these pages and present a clean Markdown table.',
    includeAllTabs: true,
    contextScope: 'all-tabs',
    executionKind: 'ai',
    isBuiltin: true
  },
  {
    id: 'builtin-translate',
    command: '/translate',
    icon: '🌐',
    label: 'Bilingual Deep Translate',
    description: 'Translate page content accurately (English ↔ Chinese) while preserving technical nuances',
    promptTemplate:
      'Translate the core content of this page accurately (if Chinese, translate into natural English; otherwise translate into fluent Simplified Chinese), keeping key technical terms clear.',
    contextScope: 'active',
    executionKind: 'ai',
    isBuiltin: true
  },
  {
    id: 'builtin-extract',
    command: '/extract',
    icon: '🎯',
    label: 'Extract Facts & Action Items',
    description: 'Pull key facts, numbers, conclusions, and concrete next steps from the page',
    promptTemplate:
      'Extract from this page: 1) Key facts & metrics; 2) Core conclusions; 3) Concrete next-step Action Items.',
    contextScope: 'active',
    executionKind: 'ai',
    isBuiltin: true
  },
  {
    id: 'builtin-fact-check',
    command: '/fact-check',
    icon: '🔍',
    label: 'Critique Claims & Blind Spots',
    description: 'Examine reasoning quality, potential bias, and claims needing verification',
    promptTemplate:
      'Objectively evaluate the core claims on this page: what is well-supported, what relies on assumptions, and what requires further verification?',
    contextScope: 'active',
    executionKind: 'ai',
    isBuiltin: true
  },
  {
    id: 'builtin-organize',
    command: '/organize',
    icon: '🗂️',
    label: 'AI Organize Tab Groups',
    description: 'Automatically cluster open tabs into color-coded topic groups',
    promptTemplate: '',
    contextScope: 'none',
    executionKind: 'organize-tabs',
    isBuiltin: true
  },
  {
    id: 'builtin-markdown',
    command: '/markdown',
    icon: '📄',
    label: 'Export Clean Markdown',
    description: 'Zero-token local engine: extract structured Markdown (/markdown split merges Split View) & save .md',
    promptTemplate: '',
    contextScope: 'active',
    executionKind: 'local-markdown',
    isBuiltin: true
  },
  {
    id: 'builtin-screenshot',
    command: '/screenshot',
    icon: '📸',
    label: 'Capture HD Screenshot',
    description: 'Zero-token local engine: capture viewport or /screenshot full for full-page PNG',
    promptTemplate: '',
    contextScope: 'active',
    executionKind: 'local-screenshot',
    isBuiltin: true
  }
]

export const BUILTIN_SLASH_SKILLS_ZH: SlashSkill[] = [
  {
    id: 'builtin-summarize',
    command: '/summarize',
    icon: '📝',
    label: '总结核心要点',
    description: '提炼当前页（分屏时自动读取双页）的核心观点、关键数据与结论',
    promptTemplate: '请用清晰的结构化要点总结所提供页面的核心内容、关键论据与结论。',
    contextScope: 'active',
    executionKind: 'ai',
    isBuiltin: true
  },
  {
    id: 'builtin-compare',
    command: '/compare',
    icon: '⚖️',
    label: '跨标签页对比',
    description: '对比分屏双页或所有打开标签页的异同，输出结构化对比表格',
    promptTemplate: '请对比分析这些页面的核心特性、优缺点、定位或价格差异，并用 Markdown 表格清晰呈现。',
    includeAllTabs: true,
    contextScope: 'all-tabs',
    executionKind: 'ai',
    isBuiltin: true
  },
  {
    id: 'builtin-translate',
    command: '/translate',
    icon: '🌐',
    label: '精准双语精读翻译',
    description: '将页面核心内容翻译并解读为流畅自然的中文/英文',
    promptTemplate: '请将页面核心内容准确翻译并整理成通顺易懂的中文（若原文为中文则译为地道英文），保留关键专业术语说明。',
    contextScope: 'active',
    executionKind: 'ai',
    isBuiltin: true
  },
  {
    id: 'builtin-extract',
    command: '/extract',
    icon: '🎯',
    label: '提取关键事实与行动项',
    description: '从页面中提取关键事实、数字指标和待办 Action Items',
    promptTemplate: '请从页面中提取：1) 关键事实与数据；2) 核心结论；3) 可执行的下一步行动清单（Action Items）。',
    contextScope: 'active',
    executionKind: 'ai',
    isBuiltin: true
  },
  {
    id: 'builtin-fact-check',
    command: '/fact-check',
    icon: '🔍',
    label: '审视论点与潜在盲区',
    description: '分析文章论证逻辑、潜在偏见或需要进一步核实的说法',
    promptTemplate: '请客观审视该页面的核心主张：哪些有充分依据？哪些属于主观推断或需要进一步核实？',
    contextScope: 'active',
    executionKind: 'ai',
    isBuiltin: true
  },
  {
    id: 'builtin-organize',
    command: '/organize',
    icon: '🗂️',
    label: 'AI 智能整理标签分组',
    description: '自动分析当前打开的标签页主题，按项目或领域智能归类为彩色分组',
    promptTemplate: '',
    contextScope: 'none',
    executionKind: 'organize-tabs',
    isBuiltin: true
  },
  {
    id: 'builtin-markdown',
    command: '/markdown',
    icon: '📄',
    label: '导出干净 Markdown',
    description: '本地零模型调用：提取网页完整结构化 Markdown（支持 /markdown split 合并分屏双页）并导出 .md',
    promptTemplate: '',
    contextScope: 'active',
    executionKind: 'local-markdown',
    isBuiltin: true
  },
  {
    id: 'builtin-screenshot',
    command: '/screenshot',
    icon: '📸',
    label: '网页高清截图',
    description: '本地零模型调用：截取当前可视区或输入 /screenshot full 截取整页长图，复制剪贴板并保存 PNG',
    promptTemplate: '',
    contextScope: 'active',
    executionKind: 'local-screenshot',
    isBuiltin: true
  }
]

export const BUILTIN_SLASH_SKILLS = BUILTIN_SLASH_SKILLS_EN

export function getBuiltinSlashSkills(lang?: AppLanguage): SlashSkill[] {
  return lang === 'zh-CN' ? BUILTIN_SLASH_SKILLS_ZH : BUILTIN_SLASH_SKILLS_EN
}

export const PRESET_SKILL_STARTERS_EN: Array<Omit<SlashSkill, 'id' | 'isBuiltin'>> = [
  {
    command: '/eli5',
    icon: '💡',
    label: 'Explain Like I’m 5',
    description: 'Break down complex technical or domain concepts using first principles and analogies',
    promptTemplate:
      'Explain the most complex concepts and mechanisms on this page using plain language and intuitive analogies.\n\nFocus area: {{input}}',
    contextScope: 'active',
    executionKind: 'ai'
  },
  {
    command: '/email-reply',
    icon: '📧',
    label: 'Draft Crisp Reply',
    description: 'Draft a thoughtful email or thread reply grounded in page context and your tone',
    promptTemplate:
      'Based on the email or discussion thread on this page, draft a clear, polite, well-structured reply.\n\nIntent & notes: {{input}}',
    contextScope: 'active',
    executionKind: 'ai'
  },
  {
    command: '/weekly-note',
    icon: '📊',
    label: 'Multi-Tab Research Brief',
    description: 'Synthesize all open tabs into a shareable research memo',
    promptTemplate:
      'Synthesize my open tabs into a structured research brief covering: context, key findings, trade-offs, and recommendations.\n\nTopic: {{input}}',
    includeAllTabs: true,
    contextScope: 'all-tabs',
    executionKind: 'ai'
  },
  {
    command: '/code-review',
    icon: '🛠️',
    label: 'PR / Code Review',
    description: 'Spot bugs, edge cases, security risks, and architecture improvements on PRs/docs',
    promptTemplate:
      'Review the code diff or technical design on this page for: 1) Bugs, race conditions, or null hazards; 2) Security & performance issues; 3) Readability & architecture improvements.\n\nExtra focus: {{input}}',
    contextScope: 'active',
    executionKind: 'ai'
  }
]

export const PRESET_SKILL_STARTERS_ZH: Array<Omit<SlashSkill, 'id' | 'isBuiltin'>> = [
  {
    command: '/eli5',
    icon: '💡',
    label: '通俗拆解复杂概念',
    description: '用生动类比和第一性原理拆解页面中的复杂技术或专业内容',
    promptTemplate:
      '请用通俗易懂的语言和贴切的生活类比，帮我拆解当前页面中最核心的复杂概念与运作机制。\n\n关注重点：{{input}}',
    contextScope: 'active',
    executionKind: 'ai'
  },
  {
    command: '/email-reply',
    icon: '📧',
    label: '起草得体邮件/消息回复',
    description: '结合页面上下文与个人口吻起草简洁专业的回复草稿',
    promptTemplate:
      '请结合当前页面中的邮件或讨论背景，帮我起草一封得体、清晰、重点突出的回复。\n\n回复意向与补充信息：{{input}}',
    contextScope: 'active',
    executionKind: 'ai'
  },
  {
    command: '/weekly-note',
    icon: '📊',
    label: '跨页整理调研简报',
    description: '汇总当前打开的所有相关标签页，生成可直接分享的调研简报',
    promptTemplate:
      '请综合我当前打开的多个标签页内容，整理一份结构化调研简报，包含：背景概述、核心发现、各方对比与结论建议。\n\n特定主题：{{input}}',
    includeAllTabs: true,
    contextScope: 'all-tabs',
    executionKind: 'ai'
  },
  {
    command: '/code-review',
    icon: '🛠️',
    label: 'PR / 代码变更审阅',
    description: '针对 GitHub PR 或技术文档提炼潜在 Bug、边界条件与改进建议',
    promptTemplate:
      '请审阅当前页面的代码变更或技术方案，重点指出：1) 潜在 Bug 或并发/空值风险；2) 性能与安全隐患；3) 可读性与架构优化建议。\n\n额外关注：{{input}}',
    contextScope: 'active',
    executionKind: 'ai'
  }
]

export const PRESET_SKILL_STARTERS = PRESET_SKILL_STARTERS_EN

export function getPresetSkillStarters(
  lang?: AppLanguage
): Array<Omit<SlashSkill, 'id' | 'isBuiltin'>> {
  return lang === 'zh-CN' ? PRESET_SKILL_STARTERS_ZH : PRESET_SKILL_STARTERS_EN
}

export function normalizeSkillCommand(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_\-\u4e00-\u9fa5]/g, '')
  return cleaned ? `/${cleaned}` : ''
}

export function getAllSlashSkills(customSkills?: SlashSkill[], lang?: AppLanguage): SlashSkill[] {
  const customs = Array.isArray(customSkills) ? customSkills : []
  const customMap = new Map<string, SlashSkill>()
  for (const s of customs) {
    if (s.command) {
      customMap.set(s.command.toLowerCase(), s)
    }
  }
  const builtins = getBuiltinSlashSkills(lang)
  const builtinsFiltered = builtins.filter((b) => !customMap.has(b.command.toLowerCase()))
  return [...customs, ...builtinsFiltered]
}

export const SEARCH_ENGINE_URLS: Record<SearchEngineId, string> = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q='
}

const SENSITIVE_HOST_PATTERNS = [
  /\.bank$/i,
  /(^|\.)paypal\.com$/i,
  /(^|\.)alipay\.com$/i,
  /(^|\.)1password\.com$/i,
  /(^|\.)bitwarden\.com$/i,
  /(^|\.)lastpass\.com$/i,
  /(^|\.)chase\.com$/i,
  /(^|\.)bankofamerica\.com$/i,
  /(^|\.)hsbc\./i,
  /(^|\.)cmbchina\.com$/i,
  /(^|\.)icbc\.com\.cn$/i
]

export function isSensitiveUrl(rawUrl: string): boolean {
  if (!rawUrl || isInternalArkoUrl(rawUrl)) return false
  try {
    const u = new URL(rawUrl)
    return SENSITIVE_HOST_PATTERNS.some((re) => re.test(u.hostname))
  } catch {
    return false
  }
}

/**
 * Arko Unified Smart Bar Intent Classifier:
 * Routes raw user input into Direct URL ('url'), Web Search ('search'), or AI Prompt ('ai').
 */
export function classifyInputIntent(raw: string): InputIntentType {
  const text = raw.trim()
  if (!text) return 'search'

  // Explicit slash skill or @mention -> AI
  if (text.startsWith('/') || text.includes('@')) {
    return 'ai'
  }

  // Explicit protocol URLs
  if (/^(https?:\/\/|file:\/\/|arko:\/\/|dia:\/\/|about:|data:)/i.test(text)) {
    return 'url'
  }

  // localhost or IPv4 with optional port/path
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(text)) {
    return 'url'
  }

  // Domain-like pattern without spaces (e.g., github.com/MistBreak/arko)
  if (!/\s/.test(text) && /^[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#].*)?$/i.test(text)) {
    return 'url'
  }

  // Natural language questions or instructions -> AI
  const aiTriggerPatterns = [
    /[?？]$/,
    /^(请问|帮我|总结|对比|翻译|解释|分析|提取|写一|如何|为什么|怎么|什么是|记住)/,
    /^(summarize|compare|translate|explain|analyze|extract|write|draft|what is|how do|why does|can you|help me|remember)\b/i
  ]
  if (aiTriggerPatterns.some((re) => re.test(text))) {
    return 'ai'
  }

  // Longer conversational sentences -> AI
  const wordCount = text.split(/\s+/).length
  if (wordCount >= 7 || (/[，。；：]/.test(text) && text.length >= 14)) {
    return 'ai'
  }

  return 'search'
}

export function resolveNavigationUrl(raw: string, searchEngine: SearchEngineId): string {
  const text = normalizeLegacyInternalUrl(raw.trim())
  if (!text || text === NEW_TAB_URL) return NEW_TAB_URL
  if (/^(https?:\/\/|file:\/\/|arko:\/\/|about:|data:)/i.test(text)) return text
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(text)) {
    return `http://${text}`
  }
  if (!/\s/.test(text) && /^[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#].*)?$/i.test(text)) {
    return `https://${text}`
  }
  return `${SEARCH_ENGINE_URLS[searchEngine]}${encodeURIComponent(text)}`
}
