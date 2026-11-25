import type {
  AgentToolStep,
  AIModelItem,
  AIProviderConfig,
  ChatMessage,
  ConnectedToolItem,
  ConnectionTestResult,
  FetchModelsResult,
  HistoryItem,
  InlineWriteActionPreset,
  InlineWriteStreamPayload,
  MemoryItem,
  PageExtractedContext,
  StreamChunkPayload,
  TabGroupColor,
  TokenQuotaResult,
  WebFormFieldInfo,
  WebFormFillProposal
} from '@shared/types'
import {
  formatHarnessToolLabel,
  type HarnessToolDefinition,
  type HarnessToolExecutor
} from './browser-harness'
import { type AccountService, sanitizeCloudBranding } from './account-service'

function parseDataUrlBase64(dataUrl: string): { mediaType: string; data: string } | null {
  const m = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i)
  if (!m) return null
  return { mediaType: m[1].toLowerCase(), data: m[2].trim() }
}

function normalizeOpenAIBase(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (/\/v\d+$/i.test(trimmed)) return trimmed
  return `${trimmed}/v1`
}

function normalizeRootBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
}

const FOLLOWUP_OPEN_TAG = '<arko-followups>'
const FOLLOWUP_CLOSE_TAG = '</arko-followups>'
const VALID_GROUP_COLORS: TabGroupColor[] = [
  'indigo',
  'emerald',
  'amber',
  'rose',
  'sky',
  'violet'
]

function getTrailingTagPrefixLength(text: string, tag: string): number {
  const maxCheck = Math.min(text.length, tag.length - 1)
  for (let len = maxCheck; len >= 1; len--) {
    if (text.slice(text.length - len).toLowerCase() === tag.slice(0, len)) {
      return len
    }
  }
  return 0
}

function parseFollowUpsBlock(rawTail: string): string[] {
  const inner = rawTail
    .replace(/^<(?:arko|dia)-followups>/i, '')
    .replace(/<\/(?:arko|dia)-followups>[\s\S]*$/i, '')
    .trim()
  if (!inner) return []
  return inner
    .split(/[|\n]+/)
    .map((s) => s.replace(/^[-*•\d.)\s"“”'‘’]+/, '').replace(/["“”'‘’]+$/, '').trim())
    .filter((s) => s.length >= 2 && s.length <= 46)
    .slice(0, 3)
}

export function rankRelevantHistory(
  history: HistoryItem[],
  query: string,
  maxItems = 28
): HistoryItem[] {
  if (!history.length) return []
  const cleaned = query.toLowerCase().trim()
  const tokens = new Set<string>()

  // Extract alphanumeric words
  for (const m of cleaned.match(/[a-z0-9_.-]{2,}/g) || []) {
    tokens.add(m)
  }
  // Extract CJK 2-grams for Chinese/Japanese/Korean fuzzy semantic matching
  const cjkRuns = cleaned.match(/[\u4e00-\u9fa5]{2,}/g) || []
  for (const run of cjkRuns) {
    if (run.length <= 4) tokens.add(run)
    for (let i = 0; i < run.length - 1; i++) {
      tokens.add(run.slice(i, i + 2))
    }
  }

  if (tokens.size === 0) {
    return history.slice(0, maxItems)
  }

  const now = Date.now()
  const scored = history.map((item) => {
    const titleLower = (item.title || '').toLowerCase()
    const urlLower = (item.url || '').toLowerCase()
    let score = 0
    for (const tk of tokens) {
      if (titleLower.includes(tk)) score += 5
      if (urlLower.includes(tk)) score += 3
    }
    const ageHours = Math.max(0, (now - item.visitedAt) / 3_600_000)
    const recencyBoost = Math.max(0, 2.5 - Math.log10(ageHours + 1))
    const freqBoost = Math.min(2.5, Math.log2((item.visitCount || 1) + 1) * 0.6)
    return { item, matchScore: score, total: score + recencyBoost + freqBoost }
  })

  scored.sort((a, b) => b.total - a.total)
  return scored.slice(0, maxItems).map((s) => s.item)
}

export class AIService {
  private activeControllers = new Map<string, AbortController>()
  private accountService?: AccountService

  constructor(accountService?: AccountService) {
    this.accountService = accountService
  }

  public setAccountService(accountService: AccountService): void {
    this.accountService = accountService
  }

  private resolveProvider(provider: AIProviderConfig, modelId?: string): AIProviderConfig {
    if (this.accountService) {
      return this.accountService.resolveRuntimeProvider(provider, modelId)
    }
    return provider
  }

  private isCloudChannel(provider: AIProviderConfig): boolean {
    return Boolean(provider.isArkoCloud || provider.id === 'arko-cloud')
  }

  public abort(threadId: string): void {
    const ctrl = this.activeControllers.get(threadId)
    if (ctrl) {
      ctrl.abort()
      this.activeControllers.delete(threadId)
    }
  }

  public abortInline(requestId: string): void {
    this.abort(`inline:${requestId}`)
  }

  /**
   * Cloud / Compatible Token Quota Query
   */
  public async queryProviderQuota(inputProvider: AIProviderConfig): Promise<TokenQuotaResult> {
    if (this.isCloudChannel(inputProvider) && this.accountService) {
      return await this.accountService.queryCloudQuota()
    }
    const provider = this.resolveProvider(inputProvider)
    if (!provider.apiKey?.trim()) {
      return { ok: false, error: 'Please enter an API Key (sk-...) first.' }
    }
    const root = normalizeRootBase(provider.baseUrl)
    const url = `${root}/api/usage/token/`

    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey.trim()}`,
          'User-Agent': 'arko-browser/0.1'
        },
        signal: AbortSignal.timeout(10000)
      })
      const json = (await resp.json()) as Record<string, any>
      const data = json?.data
      if ((json?.code === true || json?.success === true) && data) {
        const QUOTA_PER_UNIT = 500000
        const planName = sanitizeCloudBranding(data.name) || 'Arko Cloud'
        const userQuota = data.user_quota
        const extras: string[] = []
        let remainingUsd: number | undefined
        let usedUsd: number | undefined
        let totalUsd: number | undefined

        if (data.unlimited_quota) {
          extras.push('Unlimited Token')
          if (userQuota && typeof userQuota.total_available === 'number') {
            remainingUsd = userQuota.total_available / QUOTA_PER_UNIT
            usedUsd = (userQuota.total_used || 0) / QUOTA_PER_UNIT
            totalUsd = remainingUsd + usedUsd
          } else {
            usedUsd = (data.total_used || 0) / QUOTA_PER_UNIT
          }
        } else {
          remainingUsd = (data.total_available || 0) / QUOTA_PER_UNIT
          usedUsd = (data.total_used || 0) / QUOTA_PER_UNIT
          totalUsd = (data.total_granted || 0) / QUOTA_PER_UNIT
          if (userQuota && typeof userQuota.total_available === 'number') {
            extras.push(`Balance $${(userQuota.total_available / QUOTA_PER_UNIT).toFixed(2)}`)
          }
        }
        if (data.expires_at > 0) {
          extras.push(`Expires ${new Date(data.expires_at * 1000).toISOString().slice(0, 10)}`)
        }
        return {
          ok: true,
          planName,
          remainingUsd,
          usedUsd,
          totalUsd,
          extra: extras.join(' · ')
        }
      }
      return {
        ok: false,
        error: sanitizeCloudBranding(
          String(json?.message || json?.error?.message || `HTTP ${resp.status}`)
        )
      }
    } catch (err: any) {
      return { ok: false, error: sanitizeCloudBranding(err?.message) || 'Failed to query quota' }
    }
  }

  public async fetchModels(inputProvider: AIProviderConfig): Promise<FetchModelsResult> {
    if (this.isCloudChannel(inputProvider) && this.accountService) {
      const synced = await this.accountService.refreshProfile()
      if (synced.models && synced.models.length > 0) {
        return { ok: true, models: synced.models }
      }
      if (!this.accountService.getCloudApiKey()) {
        return { ok: false, error: 'Please sign in to your Arko Account first.' }
      }
    }
    const provider = this.resolveProvider(inputProvider)
    if (!provider.apiKey?.trim() && provider.id !== 'custom-ollama') {
      return {
        ok: false,
        error: this.isCloudChannel(inputProvider)
          ? 'Please sign in to your Arko Account first.'
          : 'Please enter an API Key before syncing models.'
      }
    }
    const base = normalizeOpenAIBase(provider.baseUrl)
    try {
      const resp = await fetch(`${base}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${provider.apiKey.trim()}`,
          'x-api-key': provider.apiKey.trim()
        },
        signal: AbortSignal.timeout(10000)
      })
      if (!resp.ok) {
        const text = await resp.text()
        return {
          ok: false,
          error: sanitizeCloudBranding(`HTTP ${resp.status}: ${text.slice(0, 180)}`)
        }
      }
      const json = (await resp.json()) as { data?: Array<{ id: string; name?: string }> }
      const list = Array.isArray(json?.data) ? json.data : []
      if (list.length === 0) {
        return { ok: false, error: 'No available models returned.' }
      }
      const models: AIModelItem[] = list.map((m) => ({
        id: m.id,
        label: m.name || m.id
      }))
      return { ok: true, models }
    } catch (err: any) {
      return {
        ok: false,
        error: sanitizeCloudBranding(err?.message) || 'Failed to sync model list.'
      }
    }
  }

  public async testConnection(
    inputProvider: AIProviderConfig,
    modelId?: string
  ): Promise<ConnectionTestResult> {
    const targetModel =
      modelId || inputProvider.defaultModelId || inputProvider.models[0]?.id
    const provider = this.resolveProvider(inputProvider, targetModel)
    if (!provider.apiKey?.trim() && provider.id !== 'custom-ollama') {
      return {
        ok: false,
        error: this.isCloudChannel(inputProvider)
          ? 'Please sign in to your Arko Account first.'
          : 'Please configure an API Key first.'
      }
    }
    if (!targetModel) {
      return { ok: false, error: 'No model ID specified.' }
    }

    const start = Date.now()
    try {
      const replyPreview = await this.completeOnce({
        provider,
        modelId: targetModel,
        systemPrompt: 'You are a connectivity test responder.',
        userPrompt: 'Reply with OK only.',
        maxTokens: 32,
        timeoutMs: 15000
      })
      return {
        ok: true,
        latencyMs: Date.now() - start,
        replyPreview: replyPreview.trim() || 'OK'
      }
    } catch (err: any) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: sanitizeCloudBranding(err?.message) || 'Connection failed'
      }
    }
  }

  private async completeOnce(params: {
    provider: AIProviderConfig
    modelId: string
    systemPrompt: string
    userPrompt: string
    maxTokens?: number
    timeoutMs?: number
  }): Promise<string> {
    const {
      provider,
      modelId,
      systemPrompt,
      userPrompt,
      maxTokens = 2048,
      timeoutMs = 30000
    } = params

    if (provider.protocol === 'anthropic-messages') {
      const root = normalizeRootBase(provider.baseUrl)
      const resp = await fetch(`${root}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': provider.apiKey.trim(),
          Authorization: `Bearer ${provider.apiKey.trim()}`,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        }),
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!resp.ok) {
        const errText = await resp.text()
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 240)}`)
      }
      const json = (await resp.json()) as any
      return json?.content?.find((b: any) => b.type === 'text')?.text || ''
    } else {
      const base = normalizeOpenAIBase(provider.baseUrl)
      const resp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey.trim()}`
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        }),
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!resp.ok) {
        const errText = await resp.text()
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 240)}`)
      }
      const json = (await resp.json()) as any
      const raw = json?.choices?.[0]?.message?.content || ''
      return String(raw).replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    }
  }

  public buildSystemPrompt(params: {
    personalizationPrompt: string
    contexts: PageExtractedContext[]
    connectedTools?: ConnectedToolItem[]
    connectedToolContexts?: Array<{ toolId: string; title: string; url: string; content: string }>
    historySnippet?: HistoryItem[]
    memories?: MemoryItem[]
    queryForHistory?: string
    agentToolsEnabled?: boolean
    codingWorkspacePath?: string | null
    workspaceAgentRules?: string
  }): string {
    const {
      personalizationPrompt,
      contexts,
      connectedTools,
      connectedToolContexts,
      historySnippet,
      memories,
      queryForHistory,
      agentToolsEnabled,
      codingWorkspacePath,
      workspaceAgentRules
    } = params
    const hasSplitPair = contexts.some((c) => Boolean(c.splitPaneRole))

    const parts: string[] = [
      'You are Arko, an AI-native assistant and full-stack coding partner deeply embedded in Arko Browser (Reads Between the Tabs & Codes in Your Workspace). Always reply in the same language as the user’s message unless explicitly asked otherwise.',
      'Tone: calm, sharp, editorial, and high-signal — avoid filler pleasantries.',
      'Format responses in clean GitHub-flavored Markdown (headings, bullet points, bold highlights, and comparison tables).',
      'When citing information from open browser tabs, annotate key claims inline with `[@Page Title]` and never fabricate facts absent from the pages.',
      'At the very end of your reply, on a new line, output 2–3 concise contextual follow-up questions in the user’s language (each under 12 words / 20 chars, separated by |):\n<arko-followups>Follow-up 1 | Follow-up 2 | Follow-up 3</arko-followups>'
    ]

    if (agentToolsEnabled) {
      parts.push(
        [
          '【Arko Browser Agent Capabilities Enabled】:',
          '- When existing context is sufficient to answer directly, reply immediately with zero unnecessary tool calls.',
          '- **Webpage Automation**: `open_or_navigate_tab` to open URLs/search, `inspect_page_elements` to scan interactive elements `[e1]..[e95]` (supports `filter`), `interact_with_page` for `click`/`double_click`/`hover`/`fill`/`select`/`check`/`press_key`/`scroll`/`wait`, and `extract_page_data` for structured links/tables/forms. Always run `inspect_page_elements` before acting on `[ref]` elements.',
          '- **Multimodal Vision**: Call `capture_page_screenshot` when charts, Canvas, complex modals, or visual layouts require visual inspection.',
          '- **Browser Control**: Use `manage_tabs` (switch, close, clear unpinned, reopen closed, pin/favorite, mute, group, or AI organize), `control_browser_view` (back/forward/reload, Split View, zoom, find in page), and `manage_bookmarks`.'
        ].join('\n')
      )
    }

    if (agentToolsEnabled && codingWorkspacePath) {
      parts.push(
        [
          `【Arko Full-Stack Coding Agent Active · Workspace: ${codingWorkspacePath}】`,
          'You have full local repository read/write/grep and cross-platform terminal execution tools:',
          '1. Read before edit: Always call `read_code_file` or `grep_code` to verify exact lines and indentation before calling `edit_code_file`.',
          '2. Verify changes: Run typecheck, build, or test commands via `run_terminal_command` after editing.',
          '3. Browser-loop debugging: Combine `read_browser_console`, `inspect_page_elements`, and `interact_with_page` when testing localhost web apps.'
        ].join('\n')
      )
      if (workspaceAgentRules?.trim()) {
        parts.push(`\n## 工作区项目规范 (AGENTS.md / CLAUDE.md)\n${workspaceAgentRules.trim()}`)
      }
    }

    if (hasSplitPair) {
      parts.push(
        '注意：用户当前开启了浏览器的「左右并排分屏视图 (Split View)」，下文标签页中的 `split_pane="左侧分屏"` 与 `split_pane="右侧分屏"` 分别对应屏幕左右并排展示的两个网页。若用户询问对比、「左边/右边」或综合问题，请结合两侧页面精准对照回答。'
      )
    }

    if (personalizationPrompt.trim()) {
      parts.push(`\n## 用户个性化偏好与口吻\n${personalizationPrompt.trim()}`)
    }

    const enabledMemories = (memories || []).filter((m) => m.enabled && m.content.trim())
    if (enabledMemories.length > 0) {
      const memLines = enabledMemories
        .slice(0, 30)
        .map((m) => `- [${m.category}] ${m.content.trim()}`)
        .join('\n')
      parts.push(`\n## Arko Long-Term Personal Memory (@Memory)\n${memLines}`)
    }

    const validContexts = contexts.filter((c) => c.content || c.selectedText || c.isSensitive)
    if (validContexts.length > 0) {
      parts.push('\n## 当前浏览器标签页上下文')
      validContexts.forEach((ctx, idx) => {
        const paneAttr = ctx.splitPaneRole
          ? ` split_pane="${ctx.splitPaneRole === 'left' ? '左侧分屏' : '右侧分屏'}"`
          : ''
        const block = [
          `<tab index="${idx + 1}"${paneAttr} title="${ctx.title.replace(/"/g, "'")}" url="${ctx.url}">`
        ]
        if (ctx.description) {
          block.push(`摘要描述: ${ctx.description}`)
        }
        if (ctx.selectedText) {
          block.push(`用户当前在页面上高亮选中的文字:\n"""\n${ctx.selectedText}\n"""`)
        }
        if (ctx.content) {
          block.push(`页面正文内容:\n${ctx.content}`)
        }
        block.push('</tab>')
        parts.push(block.join('\n'))
      })
    }

    if (historySnippet && historySnippet.length > 0) {
      const ranked = rankRelevantHistory(historySnippet, queryForHistory || '', 28)
      const histLines = ranked
        .map(
          (h) =>
            `- [${h.title}](${h.url}) (最近访问: ${new Date(h.visitedAt).toLocaleString()}, 访问次数: ${h.visitCount})`
        )
        .join('\n')
      parts.push(`\n## 检索到的用户浏览历史 (@History)\n${histLines}`)
    }

    const activeConnected = (connectedTools || []).filter((t) => t.status !== 'disconnected')
    if (activeConnected.length > 0) {
      const toolSummary = activeConnected
        .map(
          (t) =>
            `- **${t.name}** (\`toolId="${t.id}"\`, ${t.status === 'auto-connected' ? 'Auto-Connected' : 'Connected'}${t.accountHint ? `, ${t.accountHint}` : ''}): ${t.description}`
        )
        .join('\n')
      parts.push(
        `\n## Connected Tools (Browser Session Context)\nThe user has connected the following web apps in Arko Browser:\n${toolSummary}\n${
          agentToolsEnabled
            ? 'When the user asks about emails, calendar events, Drive docs, GitHub PRs/issues, Jira/Atlassian, Figma designs, Linear, Notion, Slack, Amplitude, or Granola from these connected apps—and that context is not yet in open tabs below—call `read_connected_tool` with the matching `toolId`.'
            : ''
        }`
      )
    }

    if (connectedToolContexts && connectedToolContexts.length > 0) {
      parts.push('\n## 已连接工具实时上下文 (@Connected Tools)')
      for (const tc of connectedToolContexts) {
        parts.push(
          `<connected_tool id="${tc.toolId}" title="${tc.title.replace(/"/g, "'")}" url="${tc.url}">\n${tc.content}\n</connected_tool>`
        )
      }
    }

    return parts.join('\n\n')
  }

  public async organizeTabsWithAI(params: {
    provider: AIProviderConfig
    modelId: string
    tabs: Array<{ id: string; title: string; url: string }>
  }): Promise<{
    ok: boolean
    groups: Array<{ title: string; color: TabGroupColor; tabIds: string[] }>
    error?: string
  }> {
    const { modelId, tabs } = params
    const provider = this.resolveProvider(params.provider, modelId)
    if (tabs.length < 2) {
      return { ok: false, groups: [], error: '至少打开 2 个普通网页标签才需要分组整理' }
    }

    const hasKey = Boolean(provider.apiKey?.trim()) || provider.id === 'custom-ollama'
    if (hasKey && modelId) {
      try {
        const systemPrompt = [
          'You are Arko Browser’s Smart Tab Organizer.',
          'Cluster the provided open tabs by topic, project, or task into 1–5 concise groups.',
          'Prefix each group title with a fitting Emoji (e.g. "🔬 AI Research", "💻 Code & Docs", "📰 Tech News"), matching the predominant language of the tab titles.',
          'color MUST be one of ["indigo", "emerald", "amber", "rose", "sky", "violet"].',
          'Output ONLY a valid JSON array with zero markdown commentary:',
          '[{"title": "💻 Dev & Docs", "color": "indigo", "tabIds": ["tab-1", "tab-2"]}]'
        ].join('\n')

        const raw = await this.completeOnce({
          provider,
          modelId,
          systemPrompt,
          userPrompt: JSON.stringify(tabs, null, 2),
          maxTokens: 1200,
          timeoutMs: 22000
        })

        const arrMatch = raw.match(/\[[\s\S]*\]/)
        if (arrMatch) {
          const parsed = JSON.parse(arrMatch[0])
          if (Array.isArray(parsed)) {
            const validTabSet = new Set(tabs.map((t) => t.id))
            const assigned = new Set<string>()
            const groups: Array<{ title: string; color: TabGroupColor; tabIds: string[] }> = []

            parsed.forEach((g: any, idx: number) => {
              const ids = Array.isArray(g?.tabIds)
                ? g.tabIds.filter((id: string) => validTabSet.has(id) && !assigned.has(id))
                : []
              if (ids.length === 0) return
              ids.forEach((id: string) => assigned.add(id))
              const color: TabGroupColor = VALID_GROUP_COLORS.includes(g.color)
                ? g.color
                : VALID_GROUP_COLORS[idx % VALID_GROUP_COLORS.length]
              groups.push({
                title: String(g.title || `分组 ${idx + 1}`).slice(0, 16),
                color,
                tabIds: ids
              })
            })

            if (groups.length > 0) {
              return { ok: true, groups }
            }
          }
        }
      } catch (err) {
        console.warn('[AIService] AI tab organize fallback to local clustering:', err)
      }
    }

    // Zero-key instant local smart clustering fallback by domain / topic category
    const buckets = new Map<string, { title: string; color: TabGroupColor; tabIds: string[] }>()
    for (const t of tabs) {
      let host = ''
      try {
        host = new URL(t.url).hostname.replace(/^www\./, '').toLowerCase()
      } catch {
        host = 'other'
      }
      const lower = `${host} ${t.title.toLowerCase()}`
      let key = 'general'
      let title = '🌐 浏览页面'
      let color: TabGroupColor = 'sky'

      if (/github|gitlab|localhost|127\.0\.0\.1|vercel|stackoverflow|npmjs|docs/.test(lower)) {
        key = 'dev'
        title = '💻 开发与技术'
        color = 'indigo'
      } else if (/openai|anthropic|claude|gemini|huggingface|arxiv|ai/.test(lower)) {
        key = 'ai'
        title = '✨ AI 与模型'
        color = 'violet'
      } else if (/youtube|bilibili|spotify|netflix|music|video/.test(lower)) {
        key = 'media'
        title = '🎬 影音媒体'
        color = 'rose'
      } else if (/ycombinator|reddit|twitter|x\.com|zhihu|news|substack|medium/.test(lower)) {
        key = 'reading'
        title = '📰 社区与资讯'
        color = 'amber'
      } else if (/notion|feishu|lark|figma|linear|google\.com\/(docs|spreadsheets)|mail/.test(lower)) {
        key = 'work'
        title = '📋 协作文档'
        color = 'emerald'
      }

      if (!buckets.has(key)) {
        buckets.set(key, { title, color, tabIds: [] })
      }
      buckets.get(key)!.tabIds.push(t.id)
    }

    return { ok: true, groups: Array.from(buckets.values()) }
  }

  public async streamInlineWrite(params: {
    requestId: string
    provider: AIProviderConfig
    modelId: string
    personalizationPrompt: string
    memories?: MemoryItem[]
    preset: InlineWriteActionPreset
    instruction: string
    fieldLabel: string
    selectedText: string
    surroundingValue: string
    pageContext: PageExtractedContext | null
    siblingSplitContext?: PageExtractedContext | null
    onChunk: (payload: InlineWriteStreamPayload) => void
  }): Promise<void> {
    const {
      requestId,
      modelId,
      personalizationPrompt,
      memories,
      preset,
      instruction,
      fieldLabel,
      selectedText,
      surroundingValue,
      pageContext,
      siblingSplitContext,
      onChunk
    } = params
    const provider = this.resolveProvider(params.provider, modelId)

    if (!provider.apiKey?.trim() && provider.id !== 'custom-ollama') {
      onChunk({
        requestId,
        error: this.isCloudChannel(params.provider)
          ? 'Please sign in to your Arko Account in Settings (⌘,) to use Inline Write.'
          : `No API key configured for ${provider.name}. Open Settings (⌘,) to add your API key.`,
        done: true
      })
      return
    }

    const presetGuideMap: Record<InlineWriteActionPreset, string> = {
      continue:
        '请顺着输入框中已有的草稿上下文自然地继续往下写，保持语种、语气与逻辑连贯。注意只输出「新增续写」的部分（若原输入框为空，则直接根据页面场景起草完整内容）。',
      polish:
        '请润色优化所提供的草稿文字，使其表达更地道、清晰、流畅、得体，消除语病但保留核心原意。',
      reply:
        '请结合当前网页正文中的讨论/邮件/帖子背景，以及用户的个人口吻偏好，起草一段得体、有针对性的回复内容。',
      translate:
        '请对文本进行高质量双语转换：若原文主要是中文则翻译为地道英文；若原文是英文或其他外语则翻译为自然流畅的中文。',
      shorten: '请在保留关键信息的前提下精简压缩文本，删去冗余寒暄与啰嗦表述，做到言简意赅。',
      expand: '请围绕现有草稿的核心意图进行合理扩写，补充细节、论据或礼貌周全的衔接，使内容更充实。',
      custom: '请严格按照用户的具体写作指令生成可直接填入输入框的文本。'
    }

    const activeMems = (memories || [])
      .filter((m) => m.enabled && m.content.trim())
      .slice(0, 15)
      .map((m) => `- ${m.content.trim()}`)
      .join('\n')

    const systemLines = [
      'You are Arko Browser’s Inline Write Assistant (Write in Your Voice).',
      '【Output Rule】: Output ONLY the final plain text ready to be inserted directly into the webpage input field! Never add conversational preambles ("Sure, here is..."), never output <arko-followups> tags, and never wrap plain prose in ``` code fences.',
      personalizationPrompt.trim() ? `User style & tone preferences:\n${personalizationPrompt.trim()}` : '',
      activeMems ? `User long-term memory & background:\n${activeMems}` : ''
    ].filter(Boolean)

    const userParts: string[] = [`写作任务类型：${presetGuideMap[preset]}`]
    if (instruction.trim()) {
      userParts.push(`用户额外具体要求：${instruction.trim()}`)
    }
    if (fieldLabel) {
      userParts.push(`当前网页输入框标签/占位提示：${fieldLabel}`)
    }
    if (selectedText.trim()) {
      userParts.push(`用户在输入框中选中的目标片段：\n"""\n${selectedText}\n"""`)
    } else if (surroundingValue.trim()) {
      userParts.push(`输入框中目前已有的草稿内容：\n"""\n${surroundingValue}\n"""`)
    }
    if (pageContext && !pageContext.isSensitive && pageContext.content) {
      userParts.push(
        `当前所在网页背景（标题：${pageContext.title} | URL：${pageContext.url}）：\n${pageContext.content.slice(0, 6000)}`
      )
    }
    if (siblingSplitContext && !siblingSplitContext.isSensitive && siblingSplitContext.content) {
      userParts.push(
        `另一侧分屏参考网页（标题：${siblingSplitContext.title}）：\n${siblingSplitContext.content.slice(0, 4500)}`
      )
    }

    const ctrlKey = `inline:${requestId}`
    this.abort(ctrlKey)

    await this.streamChat({
      threadId: ctrlKey,
      messageId: requestId,
      provider,
      modelId,
      systemPrompt: systemLines.join('\n\n'),
      historyMessages: [
        {
          id: 'u-inline',
          role: 'user',
          content: userParts.join('\n\n'),
          createdAt: Date.now()
        }
      ],
      referencedUrls: [],
      disableFollowUpsParse: true,
      onChunk: (chunk) => {
        if (chunk.deltaContent || chunk.done || chunk.error) {
          onChunk({
            requestId,
            deltaContent: chunk.deltaContent,
            done: chunk.done,
            error: chunk.error
          })
        }
      }
    })
  }

  public async generateFormFillProposals(params: {
    provider: AIProviderConfig
    modelId: string
    personalizationPrompt: string
    memories?: MemoryItem[]
    instruction: string
    fields: WebFormFieldInfo[]
    pageContext: PageExtractedContext | null
    siblingSplitContext?: PageExtractedContext | null
  }): Promise<{ ok: boolean; proposals: WebFormFillProposal[]; error?: string }> {
    const {
      modelId,
      personalizationPrompt,
      memories,
      instruction,
      fields,
      pageContext,
      siblingSplitContext
    } = params
    const provider = this.resolveProvider(params.provider, modelId)

    if (!provider.apiKey?.trim() && provider.id !== 'custom-ollama') {
      return {
        ok: false,
        proposals: [],
        error: this.isCloudChannel(params.provider)
          ? 'Please sign in to your Arko Account in Settings (⌘,) to use Smart Form Fill.'
          : `No API key configured for ${provider.name}. Please add your API key in Settings (⌘,).`
      }
    }
    if (fields.length === 0) {
      return { ok: false, proposals: [], error: 'No eligible standard form fields detected on this page.' }
    }

    const systemPrompt = [
      'You are Arko Browser’s Smart Form Fill Preview Assistant.',
      'Generate accurate, sensible proposed values for the given webpage form fields based on the user instruction, memory, and reference pages.',
      'For <select> dropdowns, proposedValue MUST match one of its options values.',
      'Return ONLY a valid JSON array (no Markdown commentary):',
      '[{"fieldId": "field-1", "proposedValue": "Proposed text", "reason": "Brief rationale"}]'
    ].join('\n')

    const fieldsSchema = fields.map((f) => ({
      fieldId: f.fieldId,
      tag: f.tagName,
      type: f.inputType,
      label: f.label,
      name: f.name,
      placeholder: f.placeholder,
      currentValue: f.currentValue,
      options: f.options?.slice(0, 15)
    }))

    const memStr = (memories || [])
      .filter((m) => m.enabled && m.content.trim())
      .slice(0, 20)
      .map((m) => `- ${m.content.trim()}`)
      .join('\n')

    const promptBlocks = [
      `用户填充需求：${instruction.trim() || '请结合页面上下文与个人记忆背景，合理填写表单各字段'}`,
      personalizationPrompt.trim() ? `用户个人背景偏好：${personalizationPrompt.trim()}` : '',
      memStr ? `Arko Memory items:\n${memStr}` : '',
      pageContext && !pageContext.isSensitive
        ? `表单所在网页（${pageContext.title}）：\n${pageContext.content.slice(0, 4000)}`
        : '',
      siblingSplitContext && !siblingSplitContext.isSensitive
        ? `分屏参考网页（${siblingSplitContext.title}）：\n${siblingSplitContext.content.slice(0, 5000)}`
        : '',
      `待填充表单字段列表 (JSON)：\n${JSON.stringify(fieldsSchema, null, 2)}`
    ].filter(Boolean)

    try {
      const rawReply = await this.completeOnce({
        provider,
        modelId,
        systemPrompt,
        userPrompt: promptBlocks.join('\n\n'),
        maxTokens: 2500,
        timeoutMs: 35000
      })

      const cleaned = rawReply
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim()
      const arrMatch = cleaned.match(/\[[\s\S]*\]/)
      const jsonStr = arrMatch ? arrMatch[0] : cleaned
      const parsed = JSON.parse(jsonStr)
      if (!Array.isArray(parsed)) {
        return { ok: false, proposals: [], error: '模型返回格式无法解析为字段列表' }
      }

      const proposals: WebFormFillProposal[] = []
      for (const item of parsed) {
        if (!item?.fieldId) continue
        const meta = fields.find((f) => f.fieldId === item.fieldId)
        if (!meta) continue
        proposals.push({
          fieldId: meta.fieldId,
          label: meta.label,
          currentValue: meta.currentValue,
          proposedValue: String(item.proposedValue ?? ''),
          reason: item.reason ? String(item.reason) : undefined
        })
      }

      return { ok: true, proposals }
    } catch (err: any) {
      return {
        ok: false,
        proposals: [],
        error: sanitizeCloudBranding(err?.message) || '生成表单填充预览失败'
      }
    }
  }

  public async streamChat(params: {
    threadId: string
    messageId: string
    provider: AIProviderConfig
    modelId: string
    systemPrompt: string
    historyMessages: ChatMessage[]
    referencedUrls: Array<{ title: string; url: string }>
    tools?: HarnessToolDefinition[]
    toolExecutor?: HarnessToolExecutor
    maxSteps?: number
    disableFollowUpsParse?: boolean
    onChunk: (payload: StreamChunkPayload) => void
  }): Promise<{
    content: string
    reasoning: string
    toolSteps?: AgentToolStep[]
    referencedUrls: Array<{ title: string; url: string }>
    followUps?: string[]
    error?: string
  }> {
    const {
      threadId,
      messageId,
      modelId,
      systemPrompt,
      historyMessages,
      disableFollowUpsParse,
      onChunk
    } = params
    const provider = this.resolveProvider(params.provider, modelId)

    const liveReferencedUrls = [...params.referencedUrls]

    if (!provider.apiKey?.trim() && provider.id !== 'custom-ollama') {
      const errMsg = this.isCloudChannel(params.provider)
        ? 'Please sign in to your **Arko Account** to start using Arko Cloud AI, or configure a custom provider in **Settings (⌘,)**.'
        : `No API key configured for **${provider.name}**. Open **Settings (⌘,)** to enter your API key or switch to **Arko Cloud**.`
      onChunk({ threadId, messageId, error: errMsg, done: true })
      return { content: '', reasoning: '', referencedUrls: liveReferencedUrls, error: errMsg }
    }

    this.abort(threadId)
    const controller = new AbortController()
    this.activeControllers.set(threadId, controller)

    let rawContent = ''
    let emittedLen = 0
    let fullReasoning = ''
    const collectedToolSteps: AgentToolStep[] = []

    const pushVisibleText = (textDelta: string): void => {
      if (!textDelta) return
      rawContent += textDelta

      if (disableFollowUpsParse) {
        emittedLen = rawContent.length
        onChunk({ threadId, messageId, deltaContent: textDelta, referencedUrls: liveReferencedUrls })
        return
      }

      const lowerRaw = rawContent.toLowerCase()
      const openIdx = lowerRaw.indexOf(FOLLOWUP_OPEN_TAG)
      if (openIdx !== -1) {
        if (openIdx > emittedLen) {
          const safeSlice = rawContent.slice(emittedLen, openIdx)
          emittedLen = openIdx
          if (safeSlice) {
            onChunk({
              threadId,
              messageId,
              deltaContent: safeSlice,
              referencedUrls: liveReferencedUrls
            })
          }
        }
        return
      }

      const holdback = getTrailingTagPrefixLength(rawContent, FOLLOWUP_OPEN_TAG)
      const safeEnd = rawContent.length - holdback
      if (safeEnd > emittedLen) {
        const safeSlice = rawContent.slice(emittedLen, safeEnd)
        emittedLen = safeEnd
        onChunk({
          threadId,
          messageId,
          deltaContent: safeSlice,
          referencedUrls: liveReferencedUrls
        })
      }
    }

    const activeTools =
      params.tools && params.tools.length > 0 && params.toolExecutor ? params.tools : undefined
    const MAX_AGENT_STEPS = Math.min(28, Math.max(1, params.maxSteps ?? 15))

    // Pi-style in-loop context compaction: prune bulky old tool outputs & vision frames from >3 turns ago
    const compactAnthropicHistory = (msgs: Array<{ role: 'user' | 'assistant'; content: any }>): void => {
      if (msgs.length < 8) return
      const cutoff = msgs.length - 6
      for (let i = 0; i < cutoff; i++) {
        const m = msgs[i]
        if (m.role === 'user' && Array.isArray(m.content)) {
          for (const block of m.content) {
            if (block?.type === 'tool_result') {
              if (typeof block.content === 'string' && block.content.length > 1200) {
                block.content = `${block.content.slice(0, 650)}\n...[早期工具输出已自动压缩以节省上下文]...`
              } else if (Array.isArray(block.content)) {
                block.content = block.content
                  .filter((sub: any) => sub?.type !== 'image')
                  .map((sub: any) =>
                    sub?.type === 'text' && typeof sub.text === 'string' && sub.text.length > 1200
                      ? { ...sub, text: `${sub.text.slice(0, 650)}\n...[早期工具输出与截图已压缩]...` }
                      : sub
                  )
              }
            }
          }
        }
      }
    }

    const compactOpenAIHistory = (msgs: Array<Record<string, any>>): void => {
      if (msgs.length < 9) return
      const cutoff = msgs.length - 6
      for (let i = 1; i < cutoff; i++) {
        const m = msgs[i]
        if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 1200) {
          m.content = `${m.content.slice(0, 650)}\n...[早期工具输出已自动压缩以节省上下文]...`
        } else if (m.role === 'user' && m._diaTransientVision && Array.isArray(m.content)) {
          m.content = '[早期网页视觉截图帧已自动释放以节省上下文]'
        }
      }
    }

    try {
      if (provider.protocol === 'anthropic-messages') {
        const root = normalizeRootBase(provider.baseUrl)
        const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: any }> =
          historyMessages
            .filter((m) => m.content.trim().length > 0 || Boolean(m.imageAttachment))
            .map((m) => {
              if (m.role === 'user' && m.imageAttachment) {
                const parsedImg = parseDataUrlBase64(m.imageAttachment)
                if (parsedImg) {
                  return {
                    role: 'user',
                    content: [
                      {
                        type: 'image',
                        source: {
                          type: 'base64',
                          media_type: parsedImg.mediaType,
                          data: parsedImg.data
                        }
                      },
                      { type: 'text', text: m.content || '请结合这张网页截图回答。' }
                    ]
                  }
                }
              }
              return {
                role: m.role,
                content: m.content
              }
            })

        let allowTools = Boolean(activeTools)

        // Run up to MAX_AGENT_STEPS tool rounds + 1 guaranteed final synthesis turn without tools if cap reached
        for (let step = 0; step <= MAX_AGENT_STEPS; step++) {
          const canUseToolsThisTurn = allowTools && Boolean(activeTools) && step < MAX_AGENT_STEPS
          const bodyPayload: Record<string, any> = {
            model: modelId,
            max_tokens: 8192,
            system: systemPrompt,
            stream: true,
            messages: anthropicMessages
          }
          if (canUseToolsThisTurn && activeTools) {
            bodyPayload.tools = activeTools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters
            }))
          }

          let resp = await fetch(`${root}/v1/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': provider.apiKey.trim(),
              Authorization: `Bearer ${provider.apiKey.trim()}`,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(bodyPayload),
            signal: controller.signal
          })

          // Graceful fallback if gateway/model rejects `tools` parameter on first turn
          if (!resp.ok && resp.status === 400 && step === 0 && allowTools) {
            allowTools = false
            delete bodyPayload.tools
            resp = await fetch(`${root}/v1/messages`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': provider.apiKey.trim(),
                Authorization: `Bearer ${provider.apiKey.trim()}`,
                'anthropic-version': '2023-06-01'
              },
              body: JSON.stringify(bodyPayload),
              signal: controller.signal
            })
          }

          if (!resp.ok || !resp.body) {
            const errBody = await resp.text()
            throw new Error(`API 错误 (${resp.status}): ${errBody.slice(0, 300)}`)
          }

          let turnText = ''
          const toolBlocksByIdx = new Map<
            number,
            { id: string; name: string; jsonBuf: string }
          >()

          await this.consumeSSE(resp.body, (dataStr) => {
            if (dataStr === '[DONE]') return
            try {
              const evt = JSON.parse(dataStr)
              if (
                evt.type === 'content_block_start' &&
                evt.content_block?.type === 'tool_use'
              ) {
                toolBlocksByIdx.set(evt.index ?? toolBlocksByIdx.size, {
                  id: evt.content_block.id || `toolu_${Date.now()}_${step}`,
                  name: evt.content_block.name || '',
                  jsonBuf: ''
                })
              } else if (evt.type === 'content_block_delta' && evt.delta) {
                if (evt.delta.type === 'text_delta' && evt.delta.text) {
                  if (step > 0 && turnText === '' && rawContent.length > 0 && !rawContent.endsWith('\n')) {
                    pushVisibleText('\n\n')
                  }
                  turnText += evt.delta.text
                  pushVisibleText(evt.delta.text)
                } else if (evt.delta.type === 'thinking_delta' && evt.delta.thinking) {
                  fullReasoning += evt.delta.thinking
                  onChunk({
                    threadId,
                    messageId,
                    deltaReasoning: evt.delta.thinking,
                    referencedUrls: liveReferencedUrls
                  })
                } else if (
                  evt.delta.type === 'input_json_delta' &&
                  typeof evt.delta.partial_json === 'string'
                ) {
                  const tb = toolBlocksByIdx.get(evt.index)
                  if (tb) tb.jsonBuf += evt.delta.partial_json
                }
              } else if (evt.type === 'error') {
                throw new Error(evt.error?.message || 'Anthropic stream error')
              }
            } catch (e: any) {
              if (e?.message?.includes('stream error')) throw e
            }
          })

          if (toolBlocksByIdx.size === 0 || !params.toolExecutor) {
            break
          }

          const assistantContentBlocks: any[] = []
          if (turnText.trim()) {
            assistantContentBlocks.push({ type: 'text', text: turnText })
          }

          const toolResultBlocks: any[] = []
          for (const tb of toolBlocksByIdx.values()) {
            let parsedArgs: Record<string, any> = {}
            try {
              parsedArgs = tb.jsonBuf ? JSON.parse(tb.jsonBuf) : {}
            } catch {
              parsedArgs = {}
            }
            assistantContentBlocks.push({
              type: 'tool_use',
              id: tb.id,
              name: tb.name,
              input: parsedArgs
            })

            const meta = formatHarnessToolLabel(tb.name, parsedArgs)
            const runningStep: AgentToolStep = {
              id: tb.id,
              name: tb.name,
              label: meta.label,
              argsSummary: meta.argsSummary,
              status: 'running'
            }
            collectedToolSteps.push(runningStep)
            onChunk({
              threadId,
              messageId,
              toolStep: { ...runningStep },
              referencedUrls: liveReferencedUrls
            })

            const execRes = await params.toolExecutor(tb.name, parsedArgs)
            if (
              execRes.newReferencedUrl &&
              !liveReferencedUrls.some((r) => r.url === execRes.newReferencedUrl!.url)
            ) {
              liveReferencedUrls.push(execRes.newReferencedUrl)
            }

            runningStep.status = execRes.ok ? 'done' : 'error'
            runningStep.resultSummary = execRes.summary
            runningStep.detailPreview = execRes.detailPreview
            runningStep.imagePreview = execRes.imageDataUrl
            onChunk({
              threadId,
              messageId,
              toolStep: { ...runningStep },
              referencedUrls: [...liveReferencedUrls]
            })

            const parsedShot = execRes.imageDataUrl
              ? parseDataUrlBase64(execRes.imageDataUrl)
              : null
            toolResultBlocks.push({
              type: 'tool_result',
              tool_use_id: tb.id,
              content: parsedShot
                ? [
                    { type: 'text', text: execRes.output.slice(0, 14000) },
                    {
                      type: 'image',
                      source: {
                        type: 'base64',
                        media_type: parsedShot.mediaType,
                        data: parsedShot.data
                      }
                    }
                  ]
                : execRes.output.slice(0, 14000)
            })
          }

          anthropicMessages.push({ role: 'assistant', content: assistantContentBlocks })
          anthropicMessages.push({ role: 'user', content: toolResultBlocks })
          compactAnthropicHistory(anthropicMessages)
        }
      } else {
        const base = normalizeOpenAIBase(provider.baseUrl)
        const openAiMessages: Array<Record<string, any>> = [
          { role: 'system', content: systemPrompt },
          ...historyMessages
            .filter((m) => m.content.trim().length > 0 || Boolean(m.imageAttachment))
            .map((m) => {
              if (m.role === 'user' && m.imageAttachment) {
                return {
                  role: 'user',
                  content: [
                    { type: 'text', text: m.content || '请结合这张网页截图回答。' },
                    { type: 'image_url', image_url: { url: m.imageAttachment } }
                  ]
                }
              }
              return {
                role: m.role,
                content: m.content
              }
            })
        ]

        let allowTools = Boolean(activeTools)

        // Run up to MAX_AGENT_STEPS tool rounds + 1 guaranteed final synthesis turn without tools if cap reached
        for (let step = 0; step <= MAX_AGENT_STEPS; step++) {
          const canUseToolsThisTurn = allowTools && Boolean(activeTools) && step < MAX_AGENT_STEPS
          const bodyPayload: Record<string, any> = {
            model: modelId,
            stream: true,
            messages: openAiMessages.map(({ _diaTransientVision, ...rest }) => rest)
          }
          if (canUseToolsThisTurn && activeTools) {
            bodyPayload.tools = activeTools.map((t) => ({
              type: 'function',
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters
              }
            }))
          }

          let resp = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${provider.apiKey.trim()}`
            },
            body: JSON.stringify(bodyPayload),
            signal: controller.signal
          })

          // Graceful fallback if channel/model rejects `tools` parameter
          if (!resp.ok && resp.status === 400 && step === 0 && allowTools) {
            allowTools = false
            delete bodyPayload.tools
            resp = await fetch(`${base}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${provider.apiKey.trim()}`
              },
              body: JSON.stringify(bodyPayload),
              signal: controller.signal
            })
          }

          if (!resp.ok || !resp.body) {
            const errBody = await resp.text()
            throw new Error(`API 错误 (${resp.status}): ${errBody.slice(0, 300)}`)
          }

          let insideThinkTag = false
          let turnText = ''
          const toolCallsByIdx = new Map<
            number,
            { id: string; name: string; argsBuf: string }
          >()

          await this.consumeSSE(resp.body, (dataStr) => {
            if (dataStr === '[DONE]') return
            let parsed: any
            try {
              parsed = JSON.parse(dataStr)
            } catch {
              return
            }
            if (parsed?.error) {
              throw new Error(parsed.error.message || JSON.stringify(parsed.error))
            }
            const delta = parsed?.choices?.[0]?.delta
            if (!delta) return

            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx = typeof tc.index === 'number' ? tc.index : 0
                let entry = toolCallsByIdx.get(idx)
                if (!entry) {
                  entry = {
                    id: tc.id || `call_${Date.now()}_${step}_${idx}`,
                    name: tc.function?.name || '',
                    argsBuf: ''
                  }
                  toolCallsByIdx.set(idx, entry)
                } else {
                  if (tc.id) entry.id = tc.id
                  if (tc.function?.name) entry.name += tc.function.name
                }
                if (typeof tc.function?.arguments === 'string') {
                  entry.argsBuf += tc.function.arguments
                }
              }
            }

            const reasoningDelta: string = delta.reasoning_content || delta.reasoning || ''
            if (reasoningDelta) {
              fullReasoning += reasoningDelta
              onChunk({
                threadId,
                messageId,
                deltaReasoning: reasoningDelta,
                referencedUrls: liveReferencedUrls
              })
            }

            let textDelta: string = delta.content || ''
            if (textDelta) {
              if (textDelta.includes('<think>')) {
                insideThinkTag = true
                textDelta = textDelta.replace('<think>', '')
              }
              if (insideThinkTag) {
                if (textDelta.includes('</think>')) {
                  const [thinkPart, restPart] = textDelta.split('</think>')
                  if (thinkPart) {
                    fullReasoning += thinkPart
                    onChunk({
                      threadId,
                      messageId,
                      deltaReasoning: thinkPart,
                      referencedUrls: liveReferencedUrls
                    })
                  }
                  insideThinkTag = false
                  if (restPart) {
                    if (
                      step > 0 &&
                      turnText === '' &&
                      rawContent.length > 0 &&
                      !rawContent.endsWith('\n')
                    ) {
                      pushVisibleText('\n\n')
                    }
                    turnText += restPart
                    pushVisibleText(restPart)
                  }
                } else if (textDelta) {
                  fullReasoning += textDelta
                  onChunk({
                    threadId,
                    messageId,
                    deltaReasoning: textDelta,
                    referencedUrls: liveReferencedUrls
                  })
                }
              } else {
                if (
                  step > 0 &&
                  turnText === '' &&
                  rawContent.length > 0 &&
                  !rawContent.endsWith('\n')
                ) {
                  pushVisibleText('\n\n')
                }
                turnText += textDelta
                pushVisibleText(textDelta)
              }
            }
          })

          if (toolCallsByIdx.size === 0 || !params.toolExecutor) {
            break
          }

          const assistantToolCallsPayload: any[] = []
          const toolMessagesToAppend: any[] = []
          const capturedVisionUrls: string[] = []

          for (const tc of toolCallsByIdx.values()) {
            if (!tc.name) continue
            let parsedArgs: Record<string, any> = {}
            try {
              parsedArgs = tc.argsBuf ? JSON.parse(tc.argsBuf) : {}
            } catch {
              parsedArgs = {}
            }

            assistantToolCallsPayload.push({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: tc.argsBuf || '{}'
              }
            })

            const meta = formatHarnessToolLabel(tc.name, parsedArgs)
            const runningStep: AgentToolStep = {
              id: tc.id,
              name: tc.name,
              label: meta.label,
              argsSummary: meta.argsSummary,
              status: 'running'
            }
            collectedToolSteps.push(runningStep)
            onChunk({
              threadId,
              messageId,
              toolStep: { ...runningStep },
              referencedUrls: liveReferencedUrls
            })

            const execRes = await params.toolExecutor(tc.name, parsedArgs)
            if (
              execRes.newReferencedUrl &&
              !liveReferencedUrls.some((r) => r.url === execRes.newReferencedUrl!.url)
            ) {
              liveReferencedUrls.push(execRes.newReferencedUrl)
            }
            if (execRes.imageDataUrl) {
              capturedVisionUrls.push(execRes.imageDataUrl)
            }

            runningStep.status = execRes.ok ? 'done' : 'error'
            runningStep.resultSummary = execRes.summary
            runningStep.detailPreview = execRes.detailPreview
            runningStep.imagePreview = execRes.imageDataUrl
            onChunk({
              threadId,
              messageId,
              toolStep: { ...runningStep },
              referencedUrls: [...liveReferencedUrls]
            })

            toolMessagesToAppend.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: execRes.output.slice(0, 14000)
            })
          }

          if (assistantToolCallsPayload.length === 0) break

          openAiMessages.push({
            role: 'assistant',
            content: turnText || null,
            tool_calls: assistantToolCallsPayload
          })
          openAiMessages.push(...toolMessagesToAppend)
          for (const imgUrl of capturedVisionUrls) {
            openAiMessages.push({
              role: 'user',
              _diaTransientVision: true,
              content: [
                {
                  type: 'text',
                  text: '[系统回传刚才截取的网页实时画面快照，请结合视觉内容继续判断或完成任务]'
                },
                { type: 'image_url', image_url: { url: imgUrl } }
              ]
            })
          }
          compactOpenAIHistory(openAiMessages)
        }
      }

      let finalVisibleContent = rawContent
      let followUps: string[] | undefined

      if (!disableFollowUpsParse) {
        const lowerRaw = rawContent.toLowerCase()
        const openIdx = lowerRaw.indexOf(FOLLOWUP_OPEN_TAG)
        if (openIdx !== -1) {
          finalVisibleContent = rawContent.slice(0, openIdx).trimEnd()
          followUps = parseFollowUpsBlock(rawContent.slice(openIdx))
          if (followUps.length === 0) followUps = undefined
        } else if (emittedLen < rawContent.length) {
          const remainder = rawContent.slice(emittedLen)
          emittedLen = rawContent.length
          onChunk({
            threadId,
            messageId,
            deltaContent: remainder,
            referencedUrls: liveReferencedUrls
          })
        }
      }

      onChunk({
        threadId,
        messageId,
        done: true,
        referencedUrls: liveReferencedUrls,
        followUps
      })
      return {
        content: finalVisibleContent,
        reasoning: fullReasoning,
        toolSteps: collectedToolSteps.length > 0 ? collectedToolSteps : undefined,
        referencedUrls: liveReferencedUrls,
        followUps
      }
    } catch (err: any) {
      const lowerRaw = rawContent.toLowerCase()
      const openIdx = disableFollowUpsParse ? -1 : lowerRaw.indexOf(FOLLOWUP_OPEN_TAG)
      const cleanSoFar = openIdx !== -1 ? rawContent.slice(0, openIdx).trimEnd() : rawContent

      if (err?.name === 'AbortError') {
        onChunk({ threadId, messageId, done: true, referencedUrls: liveReferencedUrls })
        return {
          content: cleanSoFar,
          reasoning: fullReasoning,
          toolSteps: collectedToolSteps.length > 0 ? collectedToolSteps : undefined,
          referencedUrls: liveReferencedUrls
        }
      }
      const errMsg = sanitizeCloudBranding(err?.message) || '请求模型接口失败'
      onChunk({
        threadId,
        messageId,
        error: errMsg,
        done: true,
        referencedUrls: liveReferencedUrls
      })
      return {
        content: cleanSoFar,
        reasoning: fullReasoning,
        toolSteps: collectedToolSteps.length > 0 ? collectedToolSteps : undefined,
        referencedUrls: liveReferencedUrls,
        error: errMsg
      }
    } finally {
      this.activeControllers.delete(threadId)
    }
  }

  private async consumeSSE(
    stream: ReadableStream<Uint8Array>,
    onData: (data: string) => void
  ): Promise<void> {
    const reader = stream.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim()
          if (payload) onData(payload)
        }
      }
    }

    const tail = buffer.trim()
    if (tail.startsWith('data:')) {
      const payload = tail.slice(5).trim()
      if (payload) onData(payload)
    }
  }
}
