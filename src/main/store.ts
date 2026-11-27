import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import {
  ARKO_CLOUD_INTERNAL_URL,
  ARKO_CLOUD_PROVIDER_ID,
  DEFAULT_PROFILES,
  DEFAULT_PROVIDERS,
  DEFAULT_SETTINGS,
  GITHUB_REPO_URL,
  isInternalArkoUrl,
  LEGACY_DEPRECATED_MODEL_IDS,
  NEW_TAB_URL,
  normalizeLegacyInternalUrl
} from '@shared/constants'
import type {
  AppSettings,
  BookmarkItem,
  BrowserProfile,
  ChatThread,
  HistoryItem,
  InstalledExtensionItem,
  MemoryItem,
  SplitViewState,
  TabGroup
} from '@shared/types'

export interface PersistedTabRecord {
  id: string
  profileId: string
  url: string
  title: string
  favicon?: string
  isPinned: boolean
  isFavorite?: boolean
  pinnedUrl?: string | null
  groupId?: string | null
  pageTone?: 'light' | 'dark'
}

interface SessionsFile {
  activeProfileId: string
  activeTabByProfile: Record<string, string>
  splitByProfile?: Record<string, SplitViewState>
  tabGroups?: TabGroup[]
  tabs: PersistedTabRecord[]
}

export class PersistenceStore {
  private baseDir: string
  private writeTimers = new Map<string, NodeJS.Timeout>()
  private pendingWrites = new Map<string, { getData: () => unknown; pretty: boolean }>()

  public settings: AppSettings = structuredClone(DEFAULT_SETTINGS)
  public legacyCloudApiKey = ''
  public profiles: BrowserProfile[] = structuredClone(DEFAULT_PROFILES)
  public activeProfileId: string = 'work'
  public bookmarks: BookmarkItem[] = []
  public history: HistoryItem[] = []
  public memories: MemoryItem[] = []
  public threads: ChatThread[] = []
  public extensions: InstalledExtensionItem[] = []
  public favicons: Record<string, string> = {}
  public savedSession: SessionsFile = {
    activeProfileId: 'work',
    activeTabByProfile: {},
    splitByProfile: {},
    tabGroups: [],
    tabs: []
  }

  constructor() {
    const userData = app.getPath('userData')
    this.baseDir = path.join(userData, 'arko-browser-store')
    this.migrateLegacyStoreIfNeeded(userData)
    fs.mkdirSync(this.baseDir, { recursive: true })
    this.loadAll()
  }

  private migrateLegacyStoreIfNeeded(userData: string): void {
    if (fs.existsSync(this.baseDir)) return
    const candidates = [
      path.join(userData, 'dia-browser-store'),
      path.join(path.dirname(userData), 'Dia Browser', 'dia-browser-store'),
      path.join(path.dirname(userData), 'dia-browser', 'dia-browser-store')
    ]
    const legacyDir = candidates.find((dir) => fs.existsSync(dir))
    if (!legacyDir) return
    try {
      fs.mkdirSync(this.baseDir, { recursive: true })
      for (const file of fs.readdirSync(legacyDir)) {
        if (file.endsWith('.json')) {
          fs.copyFileSync(path.join(legacyDir, file), path.join(this.baseDir, file))
        }
      }
    } catch {
      // ignore optional migration failure
    }
  }

  private filePath(name: string): string {
    return path.join(this.baseDir, `${name}.json`)
  }

  private readJson<T>(name: string, fallback: T): T {
    try {
      const p = this.filePath(name)
      if (!fs.existsSync(p)) return fallback
      const raw = fs.readFileSync(p, 'utf-8')
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  private scheduleWrite(name: string, getData: () => unknown, pretty = false): void {
    const prev = this.writeTimers.get(name)
    if (prev) clearTimeout(prev)
    this.pendingWrites.set(name, { getData, pretty })
    const timer = setTimeout(async () => {
      this.writeTimers.delete(name)
      this.pendingWrites.delete(name)
      try {
        const target = this.filePath(name)
        const tmp = `${target}.tmp`
        const payload = pretty ? JSON.stringify(getData(), null, 2) : JSON.stringify(getData())
        await fs.promises.writeFile(tmp, payload, 'utf-8')
        await fs.promises.rename(tmp, target)
      } catch (err) {
        console.error(`[PersistenceStore] Failed writing ${name}:`, err)
      }
    }, 220)
    this.writeTimers.set(name, timer)
  }

  public flushSync(): void {
    for (const [name, timer] of this.writeTimers.entries()) {
      clearTimeout(timer)
      this.writeTimers.delete(name)
      const pending = this.pendingWrites.get(name)
      this.pendingWrites.delete(name)
      if (!pending) continue
      try {
        const target = this.filePath(name)
        const tmp = `${target}.tmp`
        const payload = pending.pretty
          ? JSON.stringify(pending.getData(), null, 2)
          : JSON.stringify(pending.getData())
        fs.writeFileSync(tmp, payload, 'utf-8')
        fs.renameSync(tmp, target)
      } catch (err) {
        console.error(`[PersistenceStore] Failed flushing ${name}:`, err)
      }
    }
  }

  private loadAll(): void {
    const rawSettings = this.readJson<Partial<AppSettings>>('settings', {})
    const savedProviders = Array.isArray(rawSettings.providers) ? rawSettings.providers : []

    // Capture any legacy gateway key for seamless one-time migration into encrypted AccountService,
    // while scrubbing legacy gateway entries from renderer-visible settings.
    const isLegacyGatewayProvider = (p: Partial<{ id: string; baseUrl: string; is711Token?: boolean }>): boolean =>
      p.id === '711token-openai' ||
      p.id === '711token-claude' ||
      Boolean(p.is711Token) ||
      /711token/i.test(String(p.baseUrl || ''))

    for (const p of savedProviders) {
      if (isLegacyGatewayProvider(p as any) && p.apiKey?.trim() && !this.legacyCloudApiKey) {
        this.legacyCloudApiKey = p.apiKey.trim()
      }
    }

    const legacyCloudSource = savedProviders.find(
      (p) => p.id === ARKO_CLOUD_PROVIDER_ID || isLegacyGatewayProvider(p as any)
    )

    const mergedProviders = DEFAULT_PROVIDERS.map((preset) => {
      const existing =
        preset.id === ARKO_CLOUD_PROVIDER_ID
          ? legacyCloudSource
          : savedProviders.find((p) => p.id === preset.id)
      if (!existing) return preset

      const presetIds = new Set(preset.models.map((m) => m.id))
      const extraCustomModels = Array.isArray(existing.models)
        ? existing.models.filter(
            (m) => m?.id && !LEGACY_DEPRECATED_MODEL_IDS.has(m.id) && !presetIds.has(m.id)
          )
        : []
      const models = [...preset.models, ...extraCustomModels]
      const defaultModelId =
        existing.defaultModelId &&
        !LEGACY_DEPRECATED_MODEL_IDS.has(existing.defaultModelId) &&
        models.some((m) => m.id === existing.defaultModelId)
          ? existing.defaultModelId
          : preset.defaultModelId

      if (preset.id === ARKO_CLOUD_PROVIDER_ID) {
        return {
          ...preset,
          name: 'Arko Cloud',
          baseUrl: ARKO_CLOUD_INTERNAL_URL,
          apiKey: '',
          isArkoCloud: true,
          defaultModelId,
          models
        }
      }

      return {
        ...preset,
        ...existing,
        defaultModelId,
        models
      }
    })
    for (const custom of savedProviders) {
      if (isLegacyGatewayProvider(custom as any)) continue
      if (!mergedProviders.some((p) => p.id === custom.id)) {
        const cleanedModels = Array.isArray(custom.models)
          ? custom.models.filter((m) => m?.id && !LEGACY_DEPRECATED_MODEL_IDS.has(m.id))
          : []
        const finalModels =
          cleanedModels.length > 0
            ? cleanedModels
            : [{ id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' }]
        const nextDefault =
          custom.defaultModelId &&
          !LEGACY_DEPRECATED_MODEL_IDS.has(custom.defaultModelId) &&
          finalModels.some((m) => m.id === custom.defaultModelId)
            ? custom.defaultModelId
            : finalModels[0].id
        mergedProviders.push({
          ...custom,
          defaultModelId: nextDefault,
          models: finalModels
        })
      }
    }

    let nextActiveProviderId = rawSettings.activeProviderId || DEFAULT_SETTINGS.activeProviderId
    if (nextActiveProviderId === '711token-openai' || nextActiveProviderId === '711token-claude') {
      nextActiveProviderId = ARKO_CLOUD_PROVIDER_ID
    }
    // If previous unconfigured default was openai-official without an API key, upgrade default to Arko Cloud
    const prevOpenAI = mergedProviders.find((p) => p.id === 'openai-official')
    if (nextActiveProviderId === 'openai-official' && !prevOpenAI?.apiKey?.trim()) {
      nextActiveProviderId = ARKO_CLOUD_PROVIDER_ID
    }

    let nextActiveModelId = rawSettings.activeModelId || DEFAULT_SETTINGS.activeModelId
    const matchedActive = mergedProviders.find((p) => p.id === nextActiveProviderId)
    if (!matchedActive) {
      nextActiveProviderId = DEFAULT_SETTINGS.activeProviderId
      nextActiveModelId = DEFAULT_SETTINGS.activeModelId
    } else if (
      LEGACY_DEPRECATED_MODEL_IDS.has(nextActiveModelId) ||
      !matchedActive.models.some((m) => m.id === nextActiveModelId)
    ) {
      nextActiveModelId =
        matchedActive.defaultModelId ||
        matchedActive.models[0]?.id ||
        DEFAULT_SETTINGS.activeModelId
    }

    const systemDefaultLang =
      typeof app.getLocale === 'function' && app.getLocale().toLowerCase().startsWith('zh')
        ? 'zh-CN'
        : 'en'

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...rawSettings,
      language: rawSettings.language
        ? rawSettings.language === 'zh-CN'
          ? 'zh-CN'
          : 'en'
        : systemDefaultLang,
      onboardingCompleted: Boolean(rawSettings.onboardingCompleted),
      autoCheckUpdates: rawSettings.autoCheckUpdates !== false,
      activeProviderId: nextActiveProviderId,
      activeModelId: nextActiveModelId,
      providers: mergedProviders,
      customSkills: Array.isArray(rawSettings.customSkills) ? rawSettings.customSkills : [],
      autoConnectLoggedInApps: rawSettings.autoConnectLoggedInApps !== false,
      manuallyConnectedTools: Array.isArray(rawSettings.manuallyConnectedTools)
        ? rawSettings.manuallyConnectedTools
        : [],
      manuallyDisconnectedTools: Array.isArray(rawSettings.manuallyDisconnectedTools)
        ? rawSettings.manuallyDisconnectedTools
        : [],
      toolsOnboardingSeen: Boolean(rawSettings.toolsOnboardingSeen)
    }

    const loadedProfiles = this.readJson<BrowserProfile[]>('profiles', DEFAULT_PROFILES)
    this.profiles = loadedProfiles.length > 0 ? loadedProfiles : structuredClone(DEFAULT_PROFILES)

    // Migrate legacy indistinguishable gray defaults (#71717A / #52525B) to distinct Arc Space colors
    const legacyGraySet = new Set(['#71717a', '#52525b'])
    let migratedProfileColors = false
    const distinctFallbacks = ['#4F46E5', '#0D9488', '#E11D48', '#D97706', '#0284C7', '#7C3AED']
    this.profiles = this.profiles.map((prof, idx) => {
      const lower = (prof.accentColor || '').trim().toLowerCase()
      if (!lower || legacyGraySet.has(lower)) {
        migratedProfileColors = true
        const nextColor =
          prof.id === 'work'
            ? '#4F46E5'
            : prof.id === 'personal'
              ? '#0D9488'
              : distinctFallbacks[idx % distinctFallbacks.length]
        return { ...prof, accentColor: nextColor }
      }
      return prof
    })
    if (migratedProfileColors) {
      this.saveProfiles()
    }

    this.bookmarks = this.readJson<BookmarkItem[]>('bookmarks', [
      {
        id: 'bm-arko-github',
        profileId: 'work',
        url: GITHUB_REPO_URL,
        title: 'Arko Browser — GitHub (MistBreak/arko)',
        createdAt: Date.now()
      },
      {
        id: 'bm-github',
        profileId: 'work',
        url: 'https://github.com',
        title: 'GitHub',
        createdAt: Date.now()
      },
      {
        id: 'bm-hn',
        profileId: 'work',
        url: 'https://news.ycombinator.com',
        title: 'Hacker News',
        createdAt: Date.now()
      }
    ])

    this.history = this.readJson<HistoryItem[]>('history', [])
    this.memories = this.readJson<MemoryItem[]>('memories', [])
    this.threads = this.readJson<ChatThread[]>('threads', [])
    const rawExtensions = this.readJson<InstalledExtensionItem[]>('extensions', [])
    this.extensions = Array.isArray(rawExtensions)
      ? rawExtensions.filter((e) => e && typeof e.id === 'string' && typeof e.localPath === 'string')
      : []

    const rawSession = this.readJson<SessionsFile>('sessions', {
      activeProfileId: this.profiles[0].id,
      activeTabByProfile: {},
      splitByProfile: {},
      tabGroups: [],
      tabs: [
        {
          id: 'initial-tab-work',
          profileId: 'work',
          url: NEW_TAB_URL,
          title: 'New Tab',
          isPinned: false
        }
      ]
    })

    if (Array.isArray(rawSession.tabs)) {
      rawSession.tabs = rawSession.tabs.map((t) => ({
        ...t,
        url: normalizeLegacyInternalUrl(t.url),
        pinnedUrl: t.pinnedUrl ? normalizeLegacyInternalUrl(t.pinnedUrl) : t.pinnedUrl
      }))
    }

    this.savedSession = rawSession
    this.activeProfileId = this.profiles.some((p) => p.id === this.savedSession.activeProfileId)
      ? this.savedSession.activeProfileId
      : this.profiles[0].id

    const rawFavicons = this.readJson<Record<string, unknown>>('favicons', {})
    this.favicons = {}
    if (rawFavicons && typeof rawFavicons === 'object') {
      for (const [k, v] of Object.entries(rawFavicons)) {
        if (k && typeof v === 'string' && v.startsWith('data:image/')) {
          this.favicons[k.toLowerCase()] = v
        }
      }
    }
    // Backfill host cache from existing persisted tabs, bookmarks & history
    const seedFrom = (url?: string, favicon?: string): void => {
      if (!url || !favicon || !favicon.startsWith('data:image/')) return
      const host = PersistenceStore.extractHostKey(url)
      if (host && !this.favicons[host]) {
        this.favicons[host] = favicon
      }
    }
    for (const t of this.savedSession.tabs || []) {
      seedFrom(t.pinnedUrl || t.url, t.favicon)
      seedFrom(t.url, t.favicon)
    }
    for (const b of this.bookmarks) seedFrom(b.url, b.favicon)
    for (const h of this.history) seedFrom(h.url, h.favicon)
  }

  public static extractHostKey(urlOrHost?: string | null): string | null {
    if (!urlOrHost || typeof urlOrHost !== 'string') return null
    const trimmed = urlOrHost.trim()
    if (!trimmed) return null
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const u = new URL(trimmed)
        return u.hostname ? u.hostname.toLowerCase() : null
      } catch {
        return null
      }
    }
    if (!trimmed.includes('/') && !trimmed.includes(':')) {
      return trimmed.toLowerCase()
    }
    return null
  }

  public getCachedFavicon(urlOrHost?: string | null): string | undefined {
    const host = PersistenceStore.extractHostKey(urlOrHost)
    return host ? this.favicons[host] : undefined
  }

  public setCachedFavicon(urlOrHost: string, dataUrl: string): boolean {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return false
    const host = PersistenceStore.extractHostKey(urlOrHost)
    if (!host) return false
    if (this.favicons[host] === dataUrl) return false
    // Refresh insertion order for simple MRU bounding
    delete this.favicons[host]
    this.favicons[host] = dataUrl
    const keys = Object.keys(this.favicons)
    if (keys.length > 1500) {
      const excess = keys.length - 1500
      for (let i = 0; i < excess; i++) {
        delete this.favicons[keys[i]]
      }
    }
    this.scheduleWrite('favicons', () => this.favicons)
    return true
  }

  public saveSettings(next: AppSettings): void {
    const sanitizedProviders = Array.isArray(next.providers)
      ? next.providers.map((p) =>
          p.id === ARKO_CLOUD_PROVIDER_ID || p.isArkoCloud
            ? {
                ...p,
                name: 'Arko Cloud',
                baseUrl: ARKO_CLOUD_INTERNAL_URL,
                apiKey: '',
                isArkoCloud: true
              }
            : p
        )
      : next.providers
    this.settings = {
      ...next,
      providers: sanitizedProviders
    }
    this.scheduleWrite('settings', () => this.settings, true)
  }

  public saveProfiles(): void {
    this.scheduleWrite('profiles', () => this.profiles, true)
  }

  public saveExtensions(): void {
    this.scheduleWrite('extensions', () => this.extensions, true)
  }

  public saveBookmarks(): void {
    if (this.bookmarks.length > 5000) {
      this.bookmarks.length = 5000
    }
    this.scheduleWrite('bookmarks', () => this.bookmarks)
  }

  public saveMemories(): void {
    if (this.memories.length > 200) {
      this.memories.length = 200
    }
    this.scheduleWrite('memories', () => this.memories)
  }

  public recordHistory(profileId: string, url: string, title: string, favicon?: string): void {
    if (!url || isInternalArkoUrl(url) || url.startsWith('about:') || url.startsWith('data:')) {
      return
    }
    const now = Date.now()
    const existingIdx = this.history.findIndex((h) => h.profileId === profileId && h.url === url)
    if (existingIdx >= 0) {
      const item = this.history[existingIdx]
      this.history.splice(existingIdx, 1)
      this.history.unshift({
        ...item,
        title: title || item.title,
        favicon: favicon || item.favicon,
        visitedAt: now,
        visitCount: item.visitCount + 1
      })
    } else {
      this.history.unshift({
        id: `hist-${now}-${Math.random().toString(36).slice(2, 7)}`,
        profileId,
        url,
        title: title || url,
        favicon,
        visitedAt: now,
        visitCount: 1
      })
    }
    if (this.history.length > 2000) {
      this.history.length = 2000
    }
    this.scheduleWrite('history', () => this.history)
  }

  public clearHistory(profileId?: string): void {
    if (profileId) {
      this.history = this.history.filter((h) => h.profileId !== profileId)
    } else {
      this.history = []
    }
    this.scheduleWrite('history', () => this.history)
  }

  public saveHistory(): void {
    if (this.history.length > 2000) {
      this.history.length = 2000
    }
    this.scheduleWrite('history', () => this.history)
  }

  public saveThreads(): void {
    if (this.threads.length > 100) {
      this.threads.length = 100
    }
    // Bound per-thread message history & prune stale agent step base64 screenshots on older threads
    // so threads.json and IPC snapshots never bloat into tens of megabytes over weeks of usage.
    this.threads.forEach((th, threadIdx) => {
      if (th.messages.length > 160) {
        th.messages = th.messages.slice(-160)
      }
      const isArchiveThread = threadIdx >= 3
      const msgCutoff = Math.max(0, th.messages.length - 6)
      th.messages.forEach((msg, msgIdx) => {
        if ((isArchiveThread || msgIdx < msgCutoff) && msg.toolSteps) {
          for (const step of msg.toolSteps) {
            if (step.imagePreview) {
              delete step.imagePreview
            }
          }
        }
      })
    })
    this.scheduleWrite('threads', () => this.threads)
  }

  public saveSessions(
    activeProfileId: string,
    activeTabByProfile: Record<string, string>,
    tabs: PersistedTabRecord[],
    splitByProfile?: Record<string, SplitViewState>,
    tabGroups?: TabGroup[]
  ): void {
    this.activeProfileId = activeProfileId
    this.savedSession = {
      activeProfileId,
      activeTabByProfile,
      splitByProfile: splitByProfile || this.savedSession.splitByProfile || {},
      tabGroups: tabGroups || this.savedSession.tabGroups || [],
      tabs
    }
    this.scheduleWrite('sessions', () => this.savedSession)
  }
}
