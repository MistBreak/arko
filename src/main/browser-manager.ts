import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  session,
  shell,
  WebContents,
  WebContentsView,
  clipboard,
  dialog
} from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  ARKO_CLOUD_PROVIDER_ID,
  getAllSlashSkills,
  getChatThreadIdFromUrl,
  isChatTabUrl,
  isInternalDiaUrl,
  isSensitiveUrl,
  makeChatTabUrl,
  NEW_TAB_URL,
  resolveNavigationUrl
} from '@shared/constants'
import { tr } from '@shared/i18n'
import type {
  AIModelItem,
  AppLanguage,
  AppSettings,
  AppUpdateState,
  ArkoAccountState,
  BookmarkItem,
  BrowserImportRequest,
  BrowserImportResult,
  BrowserProfile,
  BrowserSnapshotState,
  ChatMention,
  ChatMessage,
  ChatThread,
  ConnectedToolId,
  ConnectedToolItem,
  DetectedBrowserSource,
  DownloadItemState,
  DualViewportBounds,
  ImportBrowserId,
  InlineEditableTargetInfo,
  InlineWriteActionPreset,
  InlineWriteStreamPayload,
  LocalSkillExecutionResult,
  MemoryItem,
  OverlaySnapshotResult,
  PageExtractedContext,
  QuotedSelectionPayload,
  ReaderArticle,
  ShortcutCommand,
  SplitPaneSide,
  SplitViewState,
  StreamChunkPayload,
  TabGroup,
  TabGroupColor,
  TabPinMode,
  TabState,
  ViewportBounds,
  WebFormFieldInfo,
  WebFormFillProposal,
  FindInPageResultPayload
} from '@shared/types'
import { PersistenceStore } from './store'
import { extractCleanPageMarkdown, extractTabContent } from './dom-extractor'
import {
  applyWebFormFills,
  injectInlineWriteText,
  inspectEditableAndForms
} from './inline-write'
import { AIService, rankRelevantHistory } from './ai-service'
import {
  DIA_BROWSER_HARNESS_TOOLS,
  executePageInteraction,
  extractStructuredPageData,
  inspectPageInteractiveElements,
  waitForWebContentsSettle,
  type HarnessToolExecutor
} from './browser-harness'
import {
  DIA_CODING_HARNESS_TOOLS,
  executeCodingHarnessTool,
  loadWorkspaceAgentInstructions
} from './coding-harness'
import {
  detectAllBrowsers,
  inspectBrowserAtPath,
  parseBrowserDataForImport
} from './browser-importer'
import {
  CONNECTED_TOOL_SPECS,
  computeEffectiveToolStatus,
  fetchConnectedToolContext,
  getConnectedToolSpec,
  inspectConnectedToolsForPartition
} from './connected-tools'

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0]

function cleanChromeUserAgent(defaultUa: string): string {
  return defaultUa
    .replace(/\s*Electron\/[\d.]+/i, '')
    .replace(/\s*(?:arko|dia-browser)\/[\d.]+/gi, '')
}

function sanitizeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\r\n]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72)
  return cleaned || `arko-export-${Date.now()}`
}

function createDefaultSplitState(): SplitViewState {
  return {
    enabled: false,
    leftTabId: null,
    rightTabId: null,
    activePane: 'left',
    ratio: 0.5
  }
}

function buildCalmErrorHtml(failedUrl: string, errorDesc: string, lang?: AppLanguage): string {
  const safeUrl = failedUrl
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const safeErr = errorDesc
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const isZh = lang === 'zh-CN'
  return `<!DOCTYPE html>
<html lang="${isZh ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8" />
<title>${isZh ? '无法打开页面' : 'Unable to Open Page'}</title>
<style>
  body {
    margin: 0; height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "PingFang SC", sans-serif;
    background: #FAFAFC; color: #18181B; -webkit-font-smoothing: antialiased;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1B1B20; color: #F4F4F5; }
    .card { background: #23232A !important; border-color: rgba(255,255,255,0.08) !important; }
    .url { background: rgba(255,255,255,0.05) !important; }
  }
  .card {
    max-width: 440px; width: 90%; padding: 28px; border-radius: 20px;
    background: #FFFFFF; border: 1px solid rgba(0,0,0,0.07);
    box-shadow: 0 8px 30px rgba(0,0,0,0.04); text-align: center;
  }
  .badge {
    width: 40px; height: 40px; border-radius: 12px; margin: 0 auto 14px;
    background: rgba(79,70,229,0.1); color: #4F46E5;
    display: flex; align-items: center; justify-content: center; font-size: 18px;
  }
  h1 { font-size: 16px; font-weight: 600; margin: 0 0 8px; }
  p { font-size: 12.5px; opacity: 0.62; margin: 0 0 14px; line-height: 1.6; }
  .url {
    font-family: "SF Mono", Menlo, monospace; font-size: 11px; opacity: 0.7;
    padding: 8px 10px; border-radius: 10px; background: #F4F4F6;
    word-break: break-all; margin-bottom: 18px;
  }
  button {
    appearance: none; border: 0; border-radius: 999px; padding: 8px 20px;
    background: #4F46E5; color: #FFF; font-size: 12.5px; font-weight: 500;
    cursor: pointer;
  }
  button:hover { background: #4338CA; }
</style>
</head>
<body>
  <div class="card">
    <div class="badge">✦</div>
    <h1>${isZh ? '暂时无法连接此页面' : 'Can’t Reach This Page'}</h1>
    <p>${
      isZh
        ? `网络连接中断、域名无法解析或本地服务尚未启动（${safeErr}）。`
        : `Check your network connection, DNS, or whether the local server is running (${safeErr}).`
    }</p>
    <div class="url">${safeUrl}</div>
    <button onclick="location.href='${safeUrl}'">${isZh ? '重新加载' : 'Reload Page'}</button>
  </div>
</body>
</html>`
}

export class BrowserManager {
  private mainWindow: BrowserWindow
  public store: PersistenceStore
  public aiService: AIService
  private getUpdateState?: () => AppUpdateState
  private getAccountState?: () => ArkoAccountState

  private tabs: TabState[] = []
  private tabGroups: TabGroup[] = []
  private closedTabsByProfile: Record<
    string,
    Array<{ url: string; title: string; favicon?: string }>
  > = {}
  private downloads: DownloadItemState[] = []
  private activeTabByProfile: Record<string, string> = {}
  private splitByProfile: Record<string, SplitViewState> = {}
  private views = new Map<string, WebContentsView>()
  private consoleLogsByTab = new Map<string, string[]>()
  private initializedPartitions = new Set<string>()
  private connectedToolsByProfile: Record<string, ConnectedToolItem[]> = {}
  private cookieRefreshTimers = new Map<string, NodeJS.Timeout>()
  private webIpcRegistered = false

  private primaryBounds: ViewportBounds = { x: 0, y: 80, width: 1200, height: 720 }
  private secondaryBounds: ViewportBounds | null = null
  private overlayActive = false
  private aiSidebarOpen = false

  constructor(
    mainWindow: BrowserWindow,
    store: PersistenceStore,
    aiService: AIService,
    getUpdateState?: () => AppUpdateState,
    getAccountState?: () => ArkoAccountState
  ) {
    this.mainWindow = mainWindow
    this.store = store
    this.aiService = aiService
    this.getUpdateState = getUpdateState
    this.getAccountState = getAccountState

    this.registerWebPreloadIpc()
    this.attachShortcutInterceptor(this.mainWindow.webContents)
    this.restoreTabsFromStore()
    void this.refreshConnectedTools(this.store.activeProfileId, true)

    nativeTheme.on('updated', () => {
      this.syncAllViewsOverlayConfig()
    })

    this.mainWindow.on('closed', () => {
      for (const view of this.views.values()) {
        try {
          if (!view.webContents.isDestroyed()) {
            view.webContents.close()
          }
        } catch {
          // ignore
        }
      }
      this.views.clear()
    })
  }

  private isEffectiveDark(): boolean {
    const theme = this.store.settings.theme
    if (theme === 'dark') return true
    if (theme === 'light') return false
    return nativeTheme.shouldUseDarkColors
  }

  private syncViewOverlayConfig(tab: TabState, wc?: WebContents): void {
    const targetWc = wc || this.views.get(tab.id)?.webContents
    if (!targetWc || targetWc.isDestroyed()) return
    try {
      targetWc.send('arko-web:config', {
        selectionToolbarEnabled: this.store.settings.selectionToolbarEnabled !== false,
        isDark: this.isEffectiveDark(),
        isSensitive: this.store.settings.sensitiveSiteGuard && tab.isSensitive,
        lang: this.store.settings.language || 'en'
      })
    } catch {
      // ignore
    }
  }

  private syncAllViewsOverlayConfig(): void {
    const bgHex = this.isEffectiveDark() ? '#19191B' : '#FFFFFF'
    for (const [tabId, view] of this.views.entries()) {
      if (!view.webContents.isDestroyed()) {
        view.setBackgroundColor(bgHex)
      }
      const tab = this.tabs.find((t) => t.id === tabId)
      if (tab && !view.webContents.isDestroyed()) {
        this.syncViewOverlayConfig(tab, view.webContents)
      }
    }
  }

  private findTabByWebContents(sender: WebContents): TabState | undefined {
    for (const [tabId, view] of this.views.entries()) {
      if (!view.webContents.isDestroyed() && view.webContents.id === sender.id) {
        return this.tabs.find((t) => t.id === tabId)
      }
    }
    return undefined
  }

  private getOpenSplitChatThreadId(profileId: string = this.store.activeProfileId): string | null {
    const sp = this.getSplitView(profileId)
    if (!sp.enabled) return null
    const leftTab = sp.leftTabId ? this.tabs.find((t) => t.id === sp.leftTabId) : undefined
    const rightTab = sp.rightTabId ? this.tabs.find((t) => t.id === sp.rightTabId) : undefined
    return (
      getChatThreadIdFromUrl(rightTab?.url) ||
      getChatThreadIdFromUrl(leftTab?.url) ||
      null
    )
  }

  private registerWebPreloadIpc(): void {
    if (this.webIpcRegistered) return
    this.webIpcRegistered = true

    ipcMain.removeAllListeners('arko-web:selection-action')
    ipcMain.removeAllListeners('arko-web:open-inline-write')
    ipcMain.removeAllListeners('arko-web:link-drag-state')

    ipcMain.on(
      'arko-web:link-drag-state',
      (_event, payload: { url: string; title?: string } | null) => {
        if (!this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('arko:external-link-drag', payload)
        }
      }
    )

    ipcMain.on(
      'arko-web:selection-action',
      (
        event,
        payload: {
          action: 'explain' | 'translate' | 'summarize' | 'quote'
          text: string
        }
      ) => {
        const tab = this.findTabByWebContents(event.sender)
        if (!tab || !payload?.text?.trim()) return
        if (this.store.settings.sensitiveSiteGuard && tab.isSensitive) return

        const selection = payload.text.trim().slice(0, 3500)
        const splitChatThreadId = this.getOpenSplitChatThreadId(tab.profileId)

        if (payload.action === 'quote') {
          if (!splitChatThreadId) {
            this.aiSidebarOpen = true
            this.broadcastState()
          }
          const quotePayload: QuotedSelectionPayload = {
            tabId: tab.id,
            title: tab.title || tab.url,
            url: tab.url,
            favicon: tab.favicon,
            text: selection
          }
          if (!this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('arko:selection-quoted', quotePayload)
          }
          return
        }

        if (!splitChatThreadId) {
          this.aiSidebarOpen = true
          this.broadcastState()
        }
        void this.quickAskAboutSelection(tab, selection, payload.action, splitChatThreadId || undefined)
      }
    )

    ipcMain.on('arko-web:open-inline-write', (event) => {
      const tab = this.findTabByWebContents(event.sender)
      if (!tab) return
      void this.triggerInlineWriteRequest(tab.id, undefined, 'inline')
    })
  }

  public getSplitView(profileId: string = this.store.activeProfileId): SplitViewState {
    if (!this.splitByProfile[profileId]) {
      this.splitByProfile[profileId] = createDefaultSplitState()
    }
    return this.splitByProfile[profileId]
  }

  private restoreTabsFromStore(): void {
    const saved = this.store.savedSession
    this.activeTabByProfile = { ...(saved.activeTabByProfile || {}) }
    this.splitByProfile = { ...(saved.splitByProfile || {}) }
    this.tabGroups = Array.isArray(saved.tabGroups) ? [...saved.tabGroups] : []
    const validGroupIds = new Set(this.tabGroups.map((g) => g.id))

    if (Array.isArray(saved.tabs) && saved.tabs.length > 0) {
      this.tabs = saved.tabs.map((t, i) => {
        const url = t.url || NEW_TAB_URL
        const chatThreadId = getChatThreadIdFromUrl(url)
        const chatThread = chatThreadId
          ? this.store.threads.find((th) => th.id === chatThreadId)
          : undefined
        const isFavorite = Boolean(t.isFavorite)
        const isPinned = Boolean(t.isPinned || isFavorite)
        const defaultPinnedUrl =
          isPinned && url !== NEW_TAB_URL ? url : null
        return {
          id: t.id,
          profileId: t.profileId,
          url,
          title: chatThread
            ? chatThread.title || tr(this.store.settings.language, 'Arko Chat', 'Arko 对话')
            : t.title || (url === NEW_TAB_URL ? tr(this.store.settings.language, 'New Tab', '新标签页') : url),
          favicon: t.favicon,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          isPinned,
          isFavorite,
          pinnedUrl: t.pinnedUrl ?? defaultPinnedUrl,
          isAudioPlaying: false,
          isMuted: false,
          isSensitive: isSensitiveUrl(url),
          lastAccessedAt: Date.now() - i,
          groupId:
            !isFavorite && t.groupId && validGroupIds.has(t.groupId) ? t.groupId : null,
          zoomFactor: 1
        }
      })
    }

    for (const profile of this.store.profiles) {
      const sp = this.getSplitView(profile.id)
      let profileTabs = this.tabs.filter((t) => t.profileId === profile.id)
      const hasRealOrPinnedTab = profileTabs.some(
        (t) => t.url !== NEW_TAB_URL || t.isPinned || t.isFavorite
      )

      if (hasRealOrPinnedTab) {
        // Prune redundant unpinned blank New Tab entries unless held by an active Split View pane
        this.tabs = this.tabs.filter((t) => {
          if (t.profileId !== profile.id) return true
          if (t.url !== NEW_TAB_URL || t.isPinned || t.isFavorite) return true
          if (sp.enabled && (t.id === sp.leftTabId || t.id === sp.rightTabId)) return true
          return false
        })
        profileTabs = this.tabs.filter((t) => t.profileId === profile.id)
      } else if (profileTabs.length > 1) {
        // Keep at most one empty placeholder tab when a Space has zero real tabs
        const keepId =
          (this.activeTabByProfile[profile.id] &&
          profileTabs.some((t) => t.id === this.activeTabByProfile[profile.id])
            ? this.activeTabByProfile[profile.id]
            : profileTabs[0].id)
        this.tabs = this.tabs.filter((t) => t.profileId !== profile.id || t.id === keepId)
        profileTabs = this.tabs.filter((t) => t.profileId === profile.id)
      }

      if (profileTabs.length === 0) {
        const id = `tab-${profile.id}-${Date.now()}`
        this.tabs.push({
          id,
          profileId: profile.id,
          url: NEW_TAB_URL,
          title: tr(this.store.settings.language, 'New Tab', '新标签页'),
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          isPinned: false,
          isAudioPlaying: false,
          isMuted: false,
          isSensitive: false,
          lastAccessedAt: Date.now(),
          groupId: null,
          zoomFactor: 1
        })
        this.activeTabByProfile[profile.id] = id
        profileTabs = this.tabs.filter((t) => t.profileId === profile.id)
      } else if (
        !this.activeTabByProfile[profile.id] ||
        !profileTabs.some((t) => t.id === this.activeTabByProfile[profile.id])
      ) {
        this.activeTabByProfile[profile.id] = profileTabs[0].id
      }

      const hasLeft = Boolean(sp.leftTabId && profileTabs.some((t) => t.id === sp.leftTabId))
      const hasRight = Boolean(
        sp.rightTabId &&
          sp.rightTabId !== sp.leftTabId &&
          profileTabs.some((t) => t.id === sp.rightTabId)
      )
      if (!sp.enabled || !hasLeft || !hasRight) {
        this.splitByProfile[profile.id] = createDefaultSplitState()
      } else {
        this.activeTabByProfile[profile.id] =
          sp.activePane === 'right' ? sp.rightTabId! : sp.leftTabId!
      }
    }

    this.sortProfileTabsByTier()

    const curSplit = this.getSplitView()
    if (curSplit.enabled && curSplit.leftTabId && curSplit.rightTabId) {
      const lt = this.tabs.find((t) => t.id === curSplit.leftTabId)
      const rt = this.tabs.find((t) => t.id === curSplit.rightTabId)
      if (lt && !isInternalDiaUrl(lt.url)) this.ensureViewForTab(lt, true)
      if (rt && !isInternalDiaUrl(rt.url)) this.ensureViewForTab(rt, true)
    } else {
      const activeTab = this.getActiveTab()
      if (activeTab && !isInternalDiaUrl(activeTab.url)) {
        this.ensureViewForTab(activeTab, true)
      }
    }
  }

  private cleanupEmptyGroups(): void {
    const usedGroupIds = new Set(this.tabs.map((t) => t.groupId).filter(Boolean))
    this.tabGroups = this.tabGroups.filter((g) => usedGroupIds.has(g.id))
  }

  private sortProfileTabsByTier(profileId?: string): void {
    if (!profileId) {
      const byProfile = new Map<string, TabState[]>()
      for (const t of this.tabs) {
        const list = byProfile.get(t.profileId) || []
        list.push(t)
        byProfile.set(t.profileId, list)
      }
      const next: TabState[] = []
      for (const list of byProfile.values()) {
        next.push(
          ...list.filter((t) => t.isFavorite),
          ...list.filter((t) => !t.isFavorite && t.isPinned),
          ...list.filter((t) => !t.isFavorite && !t.isPinned)
        )
      }
      this.tabs = next
      return
    }
    const profileTabs = this.tabs.filter((t) => t.profileId === profileId)
    const sortedProfileTabs = [
      ...profileTabs.filter((t) => t.isFavorite),
      ...profileTabs.filter((t) => !t.isFavorite && t.isPinned),
      ...profileTabs.filter((t) => !t.isFavorite && !t.isPinned)
    ]
    let ptr = 0
    this.tabs = this.tabs.map((t) => (t.profileId === profileId ? sortedProfileTabs[ptr++] : t))
  }

  private applyPinModeToTab(tab: TabState, mode: TabPinMode): void {
    if (mode === 'favorite') {
      tab.isFavorite = true
      tab.isPinned = true
      tab.groupId = null
      if (!tab.pinnedUrl && tab.url && tab.url !== NEW_TAB_URL) {
        tab.pinnedUrl = tab.url
      }
    } else if (mode === 'pinned') {
      tab.isFavorite = false
      tab.isPinned = true
      if (!tab.pinnedUrl && tab.url && tab.url !== NEW_TAB_URL) {
        tab.pinnedUrl = tab.url
      }
    } else {
      tab.isFavorite = false
      tab.isPinned = false
      tab.pinnedUrl = null
    }
  }

  private persistTabs(): void {
    this.cleanupEmptyGroups()
    this.store.saveSessions(
      this.store.activeProfileId,
      this.activeTabByProfile,
      this.tabs.map((t) => ({
        id: t.id,
        profileId: t.profileId,
        url: t.url,
        title: t.title,
        favicon: t.favicon,
        isPinned: Boolean(t.isPinned || t.isFavorite),
        isFavorite: Boolean(t.isFavorite),
        pinnedUrl: t.pinnedUrl || null,
        groupId: t.isFavorite ? null : t.groupId || null
      })),
      this.splitByProfile,
      this.tabGroups
    )
  }

  private appendTabDiagnostic(tabId: string, line: string): void {
    const arr = this.consoleLogsByTab.get(tabId) || []
    arr.push(`[${new Date().toLocaleTimeString()}] ${line}`)
    if (arr.length > 45) {
      arr.splice(0, arr.length - 45)
    }
    this.consoleLogsByTab.set(tabId, arr)
  }

  public getSnapshot(): BrowserSnapshotState {
    const activeProfileId = this.store.activeProfileId
    const closedStack = this.closedTabsByProfile[activeProfileId] || []
    const platform: 'darwin' | 'win32' | 'linux' =
      process.platform === 'win32'
        ? 'win32'
        : process.platform === 'darwin'
          ? 'darwin'
          : 'linux'
    const splitByProfileCopy: Record<string, SplitViewState> = {}
    for (const p of this.store.profiles) {
      splitByProfileCopy[p.id] = { ...this.getSplitView(p.id) }
    }
    return {
      platform,
      profiles: this.store.profiles,
      activeProfileId,
      tabs: this.tabs.filter((t) => t.profileId === activeProfileId),
      tabGroups: this.tabGroups.filter((g) => g.profileId === activeProfileId),
      allTabs: this.tabs.map((t) => ({ ...t })),
      allTabGroups: this.tabGroups.map((g) => ({ ...g })),
      activeTabByProfile: { ...this.activeTabByProfile },
      splitByProfile: splitByProfileCopy,
      activeTabId: this.activeTabByProfile[activeProfileId] || null,
      splitView: { ...this.getSplitView(activeProfileId) },
      bookmarks: this.store.bookmarks.filter((b) => b.profileId === activeProfileId),
      history: this.store.history.filter((h) => h.profileId === activeProfileId).slice(0, 300),
      memories: this.store.memories,
      downloads: this.downloads.slice(0, 25),
      recentlyClosedCount: closedStack.length,
      settings: this.store.settings,
      threads: this.store.threads.filter((th) => th.profileId === activeProfileId),
      aiSidebarOpen: this.aiSidebarOpen,
      updateState: this.getUpdateState?.(),
      connectedTools:
        this.connectedToolsByProfile[activeProfileId] || this.getFallbackConnectedTools(),
      accountState: this.getAccountState?.()
    }
  }

  public applyCloudModels(models?: AIModelItem[], activateCloud = false): void {
    const cur = this.store.settings
    const nextProviders = cur.providers.map((p) => {
      if (p.id !== ARKO_CLOUD_PROVIDER_ID && !p.isArkoCloud) return p
      const nextModels = models && models.length > 0 ? models : p.models
      const nextDefault = nextModels.some((m) => m.id === p.defaultModelId)
        ? p.defaultModelId
        : nextModels[0]?.id || p.defaultModelId
      return {
        ...p,
        models: nextModels,
        defaultModelId: nextDefault
      }
    })
    const cloudProv = nextProviders.find((p) => p.id === ARKO_CLOUD_PROVIDER_ID || p.isArkoCloud)
    const patch: Partial<AppSettings> = { providers: nextProviders }
    if (activateCloud && cloudProv) {
      patch.activeProviderId = cloudProv.id
      if (!cloudProv.models.some((m) => m.id === cur.activeModelId)) {
        patch.activeModelId = cloudProv.defaultModelId || cloudProv.models[0]?.id || cur.activeModelId
      }
    }
    this.updateSettings(patch)
  }

  private getFallbackConnectedTools(): ConnectedToolItem[] {
    return CONNECTED_TOOL_SPECS.map((spec) => ({
      id: spec.id,
      name: spec.name,
      description: spec.description,
      descriptionZh: spec.descriptionZh,
      homeUrl: spec.homeUrl,
      loginUrl: spec.loginUrl,
      isLoggedIn: false,
      status: computeEffectiveToolStatus(spec.id, false, this.store.settings)
    }))
  }

  public async refreshConnectedTools(
    profileId: string = this.store.activeProfileId,
    broadcast = true
  ): Promise<ConnectedToolItem[]> {
    const profile =
      this.store.profiles.find((p) => p.id === profileId) || this.store.profiles[0]
    if (!profile) return this.getFallbackConnectedTools()
    this.ensureSessionConfigured(profile.partition)
    const profileHistory = this.store.history.filter((h) => h.profileId === profile.id)
    const items = await inspectConnectedToolsForPartition({
      partition: profile.partition,
      settings: this.store.settings,
      profileHistory
    })
    this.connectedToolsByProfile[profile.id] = items
    if (broadcast) {
      this.broadcastState()
    }
    return items
  }

  public async getConnectedTools(): Promise<ConnectedToolItem[]> {
    return await this.refreshConnectedTools(this.store.activeProfileId, false)
  }

  public async connectTool(
    toolId: ConnectedToolId
  ): Promise<{ ok: boolean; openedLoginTab?: boolean; tools: ConnectedToolItem[] }> {
    const spec = getConnectedToolSpec(toolId)
    if (!spec) {
      return { ok: false, tools: await this.getConnectedTools() }
    }
    const prevDisconnected = (this.store.settings.manuallyDisconnectedTools || []).filter(
      (id) => id !== toolId
    )
    const prevManual = new Set(this.store.settings.manuallyConnectedTools || [])
    prevManual.add(toolId)

    this.updateSettings({
      manuallyDisconnectedTools: prevDisconnected,
      manuallyConnectedTools: Array.from(prevManual)
    })

    const tools = await this.refreshConnectedTools(this.store.activeProfileId, true)
    const current = tools.find((t) => t.id === toolId)
    let openedLoginTab = false
    if (current && !current.isLoggedIn) {
      openedLoginTab = true
      await this.createTab(spec.loginUrl, { background: false })
    }
    return { ok: true, openedLoginTab, tools }
  }

  public async disconnectTool(toolId: ConnectedToolId): Promise<ConnectedToolItem[]> {
    const prevManual = (this.store.settings.manuallyConnectedTools || []).filter(
      (id) => id !== toolId
    )
    const prevDisconnected = new Set(this.store.settings.manuallyDisconnectedTools || [])
    prevDisconnected.add(toolId)

    this.updateSettings({
      manuallyConnectedTools: prevManual,
      manuallyDisconnectedTools: Array.from(prevDisconnected)
    })
    return await this.refreshConnectedTools(this.store.activeProfileId, true)
  }

  public async setAutoConnectTools(enabled: boolean): Promise<ConnectedToolItem[]> {
    this.updateSettings({
      autoConnectLoggedInApps: enabled,
      ...(enabled ? { manuallyDisconnectedTools: [] } : {})
    })
    return await this.refreshConnectedTools(this.store.activeProfileId, true)
  }

  public broadcastState(): void {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('arko:state-changed', this.getSnapshot())
    }
  }

  public emitShortcut(cmd: ShortcutCommand): void {
    if (!this.mainWindow.isDestroyed()) {
      const focusShellCmds = new Set<ShortcutCommand>([
        'new-tab',
        'focus-omnibox',
        'find-in-page',
        'open-settings',
        'open-inline-write',
        'open-connect-tools',
        'open-import-data',
        'open-skills-editor',
        'open-memory-settings',
        'open-general-settings',
        'check-for-updates',
        'toggle-ai-sidebar'
      ])
      if (focusShellCmds.has(cmd)) {
        this.mainWindow.webContents.focus()
      }
      this.mainWindow.webContents.send('arko:shortcut', cmd)
    }
  }

  public getActiveTab(): TabState | undefined {
    const activeId = this.activeTabByProfile[this.store.activeProfileId]
    return this.tabs.find((t) => t.id === activeId)
  }

  private getViewportBoundsForTab(tabId: string): ViewportBounds {
    const sp = this.getSplitView()
    if (sp.enabled && sp.rightTabId === tabId && this.secondaryBounds) {
      return this.secondaryBounds
    }
    return this.primaryBounds
  }

  private ensureSessionConfigured(partition: string): Electron.Session {
    const ses = session.fromPartition(partition)
    if (!this.initializedPartitions.has(partition)) {
      this.initializedPartitions.add(partition)
      ses.setUserAgent(cleanChromeUserAgent(ses.getUserAgent()))

      // Live watch browser session cookies to auto-update "Connect your Tools" status
      ses.cookies.on('changed', () => {
        const prevTimer = this.cookieRefreshTimers.get(partition)
        if (prevTimer) clearTimeout(prevTimer)
        const timer = setTimeout(() => {
          this.cookieRefreshTimers.delete(partition)
          const ownerProfile = this.store.profiles.find((p) => p.partition === partition)
          if (ownerProfile) {
            void this.refreshConnectedTools(
              ownerProfile.id,
              ownerProfile.id === this.store.activeProfileId
            )
          }
        }, 650)
        this.cookieRefreshTimers.set(partition, timer)
      })

      // Capture HTTP 4xx/5xx network errors for the Browser-Native Coding Agent
      ses.webRequest.onCompleted((details) => {
        if (details.statusCode >= 400 && details.webContentsId) {
          for (const [tabId, v] of this.views.entries()) {
            if (!v.webContents.isDestroyed() && v.webContents.id === details.webContentsId) {
              if (['mainFrame', 'xhr', ' subFrame'].includes(details.resourceType) || details.resourceType === 'xhr') {
                this.appendTabDiagnostic(
                  tabId,
                  `[HTTP ${details.statusCode}] ${details.method} ${details.url.slice(0, 140)}`
                )
              } else if (details.statusCode >= 500) {
                this.appendTabDiagnostic(
                  tabId,
                  `[HTTP ${details.statusCode}] ${details.method} ${details.url.slice(0, 140)}`
                )
              }
              break
            }
          }
        }
      })

      // Native Downloads tracking with sleek live progress updates
      ses.on('will-download', (_event, item) => {
        const dlId = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const fileName = item.getFilename() || 'download'
        const defaultPath = path.join(app.getPath('downloads'), fileName)
        if (!item.getSavePath()) {
          // Avoid overwriting existing file silently by adding numeric suffix if needed
          let candidate = defaultPath
          const ext = path.extname(fileName)
          const stem = path.basename(fileName, ext)
          let counter = 1
          while (fs.existsSync(candidate) && counter < 100) {
            candidate = path.join(app.getPath('downloads'), `${stem} (${counter})${ext}`)
            counter++
          }
          item.setSavePath(candidate)
        }

        const record: DownloadItemState = {
          id: dlId,
          fileName: path.basename(item.getSavePath() || fileName),
          url: item.getURL(),
          savePath: item.getSavePath() || defaultPath,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          state: 'progressing',
          startedAt: Date.now()
        }
        this.downloads.unshift(record)
        if (this.downloads.length > 30) this.downloads.length = 30
        this.broadcastState()

        let lastBroadcast = 0
        item.on('updated', (_e, state) => {
          record.receivedBytes = item.getReceivedBytes()
          record.totalBytes = item.getTotalBytes()
          record.savePath = item.getSavePath() || record.savePath
          record.state = state === 'interrupted' ? 'interrupted' : 'progressing'
          const now = Date.now()
          if (now - lastBroadcast > 180) {
            lastBroadcast = now
            this.broadcastState()
          }
        })

        item.once('done', (_e, state) => {
          record.receivedBytes = item.getReceivedBytes()
          record.totalBytes = item.getTotalBytes() || record.receivedBytes
          record.savePath = item.getSavePath() || record.savePath
          record.state =
            state === 'completed'
              ? 'completed'
              : state === 'cancelled'
                ? 'cancelled'
                : 'interrupted'
          this.broadcastState()
        })
      })
    }
    return ses
  }

  private ensureViewForTab(tab: TabState, loadInitialUrl = false): WebContentsView {
    const existing = this.views.get(tab.id)
    if (existing && !existing.webContents.isDestroyed()) {
      return existing
    }

    const profile =
      this.store.profiles.find((p) => p.id === tab.profileId) || this.store.profiles[0]
    const ses = this.ensureSessionConfigured(profile.partition)

    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '../preload/web-preload.js'),
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        plugins: true
      }
    })

    if (typeof (view as any).setBorderRadius === 'function') {
      ;(view as any).setBorderRadius(10)
    }
    view.setBackgroundColor(this.isEffectiveDark() ? '#19191B' : '#FFFFFF')
    view.setVisible(false)
    this.mainWindow.contentView.addChildView(view)
    this.views.set(tab.id, view)

    const wc = view.webContents
    this.attachShortcutInterceptor(wc)

    wc.on('focus', () => {
      const sp = this.getSplitView(tab.profileId)
      if (!sp.enabled || tab.profileId !== this.store.activeProfileId) return
      if (tab.id === sp.leftTabId && sp.activePane !== 'left') {
        sp.activePane = 'left'
        this.activeTabByProfile[tab.profileId] = tab.id
        tab.lastAccessedAt = Date.now()
        this.persistTabs()
        this.broadcastState()
      } else if (tab.id === sp.rightTabId && sp.activePane !== 'right') {
        sp.activePane = 'right'
        this.activeTabByProfile[tab.profileId] = tab.id
        tab.lastAccessedAt = Date.now()
        this.persistTabs()
        this.broadcastState()
      }
    })

    wc.setWindowOpenHandler(({ url }) => {
      if (url && /^https?:\/\//i.test(url)) {
        void this.createTab(url, { background: false, groupId: tab.groupId })
      }
      return { action: 'deny' }
    })

    wc.on('update-target-url', (_event, targetUrl) => {
      if (!wc.isDestroyed()) {
        wc.send('arko-web:target-url', targetUrl || '')
      }
    })

    wc.on('did-start-loading', () => {
      tab.isLoading = true
      this.syncNavigationFlags(tab, wc)
      this.broadcastState()
    })

    wc.on('did-finish-load', () => {
      this.syncViewOverlayConfig(tab, wc)
    })

    wc.on('did-stop-loading', () => {
      tab.isLoading = false
      const currentUrl = wc.getURL()
      if (currentUrl && currentUrl !== 'about:blank' && !currentUrl.startsWith('data:text/html')) {
        tab.url = currentUrl
        tab.isSensitive = isSensitiveUrl(currentUrl)
        if ((tab.isPinned || tab.isFavorite) && !tab.pinnedUrl && !isInternalDiaUrl(currentUrl)) {
          tab.pinnedUrl = currentUrl
        }
      }
      const pageTitle = wc.getTitle()
      if (pageTitle) tab.title = pageTitle
      tab.zoomFactor = Math.round(wc.getZoomFactor() * 100) / 100
      this.syncNavigationFlags(tab, wc)
      this.syncViewOverlayConfig(tab, wc)
      this.store.recordHistory(tab.profileId, tab.url, tab.title, tab.favicon)
      this.persistTabs()
      this.broadcastState()
    })

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || !validatedURL) return
      if (validatedURL.startsWith('data:')) return
      tab.isLoading = false
      this.broadcastState()
      const errHtml = buildCalmErrorHtml(
        validatedURL,
        errorDescription || `ERR_${errorCode}`,
        this.store.settings.language
      )
      void wc
        .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errHtml)}`)
        .catch(() => {})
    })

    wc.on('did-navigate', (_event, url) => {
      this.consoleLogsByTab.set(tab.id, [])
      if (url && url !== 'about:blank' && !url.startsWith('data:text/html')) {
        tab.url = url
        tab.isSensitive = isSensitiveUrl(url)
      }
      this.syncNavigationFlags(tab, wc)
      this.syncViewOverlayConfig(tab, wc)
      this.persistTabs()
      this.broadcastState()
    })

    wc.on('console-message', (event: any, legacyLevel?: number, legacyMsg?: string, legacyLine?: number, legacySrc?: string) => {
      // Compatible with both Electron 35+ Event properties and legacy positional parameters
      const level = typeof event?.level === 'string'
        ? (event.level === 'error' ? 3 : event.level === 'warning' ? 2 : 1)
        : (typeof legacyLevel === 'number' ? legacyLevel : 1)
      if (level < 2) return
      const msg = String(event?.message ?? legacyMsg ?? '').trim()
      if (!msg) return
      const src = String(event?.sourceId ?? legacySrc ?? '')
      const lineNo = event?.lineNumber ?? legacyLine ?? 0
      const tag = level >= 3 ? 'CONSOLE.ERROR' : 'CONSOLE.WARN'
      const loc = src ? ` (${src.split('/').pop()?.slice(0, 40)}:${lineNo})` : ''
      this.appendTabDiagnostic(tab.id, `[${tag}]${loc} ${msg.slice(0, 320)}`)
    })

    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame && url && url !== 'about:blank' && !url.startsWith('data:text/html')) {
        tab.url = url
        tab.isSensitive = isSensitiveUrl(url)
        this.syncNavigationFlags(tab, wc)
        this.persistTabs()
        this.broadcastState()
      }
    })

    wc.on('page-title-updated', (_event, title) => {
      if (title) {
        tab.title = title
        this.store.recordHistory(tab.profileId, tab.url, tab.title, tab.favicon)
        this.persistTabs()
        this.broadcastState()
      }
    })

    wc.on('page-favicon-updated', (_event, favicons) => {
      if (Array.isArray(favicons) && favicons.length > 0) {
        tab.favicon = favicons[0]
        this.persistTabs()
        this.broadcastState()
      }
    })

    wc.on('media-started-playing', () => {
      tab.isAudioPlaying = true
      this.broadcastState()
    })

    wc.on('media-paused', () => {
      tab.isAudioPlaying = false
      this.broadcastState()
    })

    wc.on('found-in-page', (_event, result) => {
      if (!this.mainWindow.isDestroyed()) {
        const payload: FindInPageResultPayload = {
          tabId: tab.id,
          activeMatchOrdinal: result.activeMatchOrdinal || 0,
          matches: result.matches || 0,
          finalUpdate: Boolean(result.finalUpdate)
        }
        this.mainWindow.webContents.send('arko:find-in-page-result', payload)
      }
    })

    wc.on('context-menu', (_event, params) => {
      const lang = this.store.settings.language
      const template: Electron.MenuItemConstructorOptions[] = []
      const selection = params.selectionText?.trim()

      if (params.isEditable) {
        template.push(
          {
            label: tr(lang, '✨ Arko Inline Write / Reply in Your Voice (⌘J)', '✨ Arko 内联帮写 / 个人口吻回复 (⌘J)'),
            click: () => {
              void this.triggerInlineWriteRequest(tab.id, { x: params.x, y: params.y }, 'inline')
            }
          },
          {
            label: tr(lang, '📋 Arko Smart Form Fill Preview…', '📋 Arko 智能表单预览填充…'),
            click: () => {
              void this.triggerInlineWriteRequest(tab.id, { x: params.x, y: params.y }, 'form')
            }
          },
          { type: 'separator' },
          { role: 'cut', label: tr(lang, 'Cut', '剪切') },
          { role: 'copy', label: tr(lang, 'Copy', '复制') },
          { role: 'paste', label: tr(lang, 'Paste', '粘贴') },
          { role: 'selectAll', label: tr(lang, 'Select All', '全选') },
          { type: 'separator' }
        )
      } else if (selection) {
        const previewSnippet = `${selection.slice(0, 22)}${selection.length > 22 ? '…' : ''}`
        template.push(
          {
            label: tr(
              lang,
              `✨ Ask Arko about “${previewSnippet}”`,
              `✨ 让 Arko 解读选中文字 (“${previewSnippet}”)`
            ),
            click: () => {
              const splitChatId = this.getOpenSplitChatThreadId(tab.profileId)
              if (!splitChatId) {
                this.aiSidebarOpen = true
                this.broadcastState()
              }
              void this.quickAskAboutSelection(tab, selection, 'explain', splitChatId || undefined)
            }
          },
          {
            label: tr(lang, '🌐 Translate Selection with Arko', '🌐 让 Arko 翻译选中内容'),
            click: () => {
              const splitChatId = this.getOpenSplitChatThreadId(tab.profileId)
              if (!splitChatId) {
                this.aiSidebarOpen = true
                this.broadcastState()
              }
              void this.quickAskAboutSelection(tab, selection, 'translate', splitChatId || undefined)
            }
          },
          {
            label: tr(lang, '💬 Quote Selection into Arko Chat', '💬 引用选中段落到 Arko 继续追问'),
            click: () => {
              const splitChatId = this.getOpenSplitChatThreadId(tab.profileId)
              if (!splitChatId) {
                this.aiSidebarOpen = true
                this.broadcastState()
              }
              if (!this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('arko:selection-quoted', {
                  tabId: tab.id,
                  title: tab.title || tab.url,
                  url: tab.url,
                  favicon: tab.favicon,
                  text: selection
                } satisfies QuotedSelectionPayload)
              }
            }
          },
          { type: 'separator' },
          { role: 'copy', label: tr(lang, 'Copy', '复制') },
          { type: 'separator' }
        )
      }

      if (params.linkURL) {
        template.push(
          {
            label: tr(lang, 'Open Link in New Tab', '在新标签页中打开链接'),
            click: () => {
              void this.createTab(params.linkURL, { background: false, groupId: tab.groupId })
            }
          },
          {
            label: tr(lang, '◫ Open Link in Right Split View', '◫ 在右侧分屏中并排打开链接'),
            click: () => {
              void this.openUrlInRightSplit(params.linkURL)
            }
          },
          {
            label: tr(lang, 'Open Link in Background Tab', '后台打开链接'),
            click: () => {
              void this.createTab(params.linkURL, { background: true, groupId: tab.groupId })
            }
          },
          {
            label: tr(lang, 'Copy Link Address', '复制链接地址'),
            click: () => clipboard.writeText(params.linkURL)
          },
          { type: 'separator' }
        )
      }

      template.push(
        {
          label: tr(lang, '📖 Calm Reader View (⇧⌘R)', '📖 开启沉浸阅读视图 (⇧⌘R)'),
          click: () => {
            this.emitShortcut('toggle-reader-view')
          }
        },
        {
          label: tr(lang, '📄 Export Clean Markdown (/markdown)', '📄 导出干净 Markdown (/markdown)'),
          click: () => {
            void this.executeLocalSkill('/markdown', tab.id)
          }
        },
        {
          label: tr(lang, '📸 Capture HD Screenshot (/screenshot)', '📸 网页高清截图 (/screenshot)'),
          click: () => {
            void this.executeLocalSkill('/screenshot', tab.id)
          }
        },
        { type: 'separator' },
        {
          label: tr(lang, 'Back', '后退'),
          enabled: wc.navigationHistory.canGoBack(),
          click: () => wc.navigationHistory.goBack()
        },
        {
          label: tr(lang, 'Forward', '前进'),
          enabled: wc.navigationHistory.canGoForward(),
          click: () => wc.navigationHistory.goForward()
        },
        {
          label: tr(lang, 'Reload', '重新加载'),
          click: () => wc.reload()
        },
        { type: 'separator' },
        {
          label: tr(lang, 'Inspect Element (DevTools)', '检查元素 (DevTools)'),
          click: () => wc.inspectElement(params.x, params.y)
        }
      )

      Menu.buildFromTemplate(template).popup({ window: this.mainWindow })
    })

    if (loadInitialUrl && tab.url && !isInternalDiaUrl(tab.url)) {
      void wc.loadURL(tab.url).catch((err) => {
        console.warn('[BrowserManager] Initial load error:', err?.message)
      })
    }

    return view
  }

  private async openUrlInRightSplit(url: string): Promise<void> {
    const profileId = this.store.activeProfileId
    const sp = this.getSplitView(profileId)
    const active = this.getActiveTab()
    const newRightId = await this.createTab(url, { background: true, groupId: active?.groupId })
    if (sp.enabled && sp.leftTabId) {
      sp.rightTabId = newRightId
      sp.activePane = 'right'
      this.activeTabByProfile[profileId] = newRightId
      this.persistTabs()
      this.syncViewsLayout()
      this.broadcastState()
    } else if (active) {
      await this.openSplitView(newRightId)
    }
  }

  private async quickAskAboutSelection(
    tab: TabState,
    selection: string,
    mode: 'explain' | 'translate' | 'summarize' = 'explain',
    preferredThreadId?: string
  ): Promise<void> {
    let thread = preferredThreadId
      ? this.store.threads.find((th) => th.id === preferredThreadId)
      : this.store.threads.find((th) => th.profileId === this.store.activeProfileId)
    if (!thread) {
      thread = await this.createThread()
    }
    const promptByMode =
      mode === 'translate'
        ? '请结合当前网页语境，将这段选中内容精准、地道地翻译（若为外文译为流畅中文，若为中文译为地道英文），并简要补充关键术语背景：'
        : mode === 'summarize'
          ? '请用极简清晰的要点提炼这段选中内容的核心结论与关键信息：'
          : '请结合当前页面背景，深入浅出地解读这段选中内容的要点与上下文含义：'

    await this.sendChatMessage({
      threadId: thread.id,
      prompt: promptByMode,
      quotedText: selection,
      mentions: [
        {
          type: 'tab',
          tabId: tab.id,
          title: tab.title,
          url: tab.url,
          favicon: tab.favicon
        }
      ],
      includeActiveTab: true
    })
  }

  private syncNavigationFlags(tab: TabState, wc: WebContents): void {
    if (wc.isDestroyed()) return
    tab.canGoBack = wc.navigationHistory.canGoBack()
    tab.canGoForward = wc.navigationHistory.canGoForward()
    tab.isMuted = wc.isAudioMuted()
  }

  private cycleAdjacentTab(direction: 1 | -1): void {
    const rawTabs = this.tabs.filter((t) => t.profileId === this.store.activeProfileId)
    const profileTabs =
      rawTabs.some((t) => t.url !== NEW_TAB_URL)
        ? rawTabs.filter((t) => t.url !== NEW_TAB_URL)
        : rawTabs
    if (profileTabs.length <= 1) return
    const curId = this.activeTabByProfile[this.store.activeProfileId]
    const idx = profileTabs.findIndex((t) => t.id === curId)
    const nextIdx =
      idx === -1
        ? direction === 1
          ? 0
          : profileTabs.length - 1
        : (idx + direction + profileTabs.length) % profileTabs.length
    this.switchTab(profileTabs[nextIdx].id)
  }

  private switchTabByNumber(num1To9: number): void {
    const rawTabs = this.tabs.filter((t) => t.profileId === this.store.activeProfileId)
    const profileTabs =
      rawTabs.some((t) => t.url !== NEW_TAB_URL)
        ? rawTabs.filter((t) => t.url !== NEW_TAB_URL)
        : rawTabs
    if (profileTabs.length === 0) return
    const target =
      num1To9 === 9
        ? profileTabs[profileTabs.length - 1]
        : profileTabs[num1To9 - 1]
    if (target) {
      this.switchTab(target.id)
    }
  }

  private attachShortcutInterceptor(wc: WebContents): void {
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const cmdOrCtrl = process.platform === 'darwin' ? input.meta : input.control

      // Ctrl+Tab / Ctrl+Shift+Tab tab cycling on macOS & Windows
      if (input.control && !input.meta && !input.alt && input.key === 'Tab') {
        event.preventDefault()
        this.cycleAdjacentTab(input.shift ? -1 : 1)
        return
      }

      // Arc Space / Profile cycling: Ctrl+Option+Left / Ctrl+Option+Right
      if (
        input.control &&
        input.alt &&
        !input.meta &&
        !input.shift &&
        (input.key === 'ArrowLeft' || input.key === 'ArrowRight')
      ) {
        event.preventDefault()
        const dir = input.key === 'ArrowLeft' ? -1 : 1
        this.cycleProfile(dir)
        this.emitShortcut(dir === -1 ? 'switch-profile-prev' : 'switch-profile-next')
        return
      }

      if (!cmdOrCtrl) return
      const key = input.key.toLowerCase()

      // Cmd+1 .. Cmd+9 jump to tab
      if (!input.shift && !input.alt && /^[1-9]$/.test(key)) {
        event.preventDefault()
        this.switchTabByNumber(Number(key))
        return
      }

      if (key === 'e' && !input.shift && !input.alt) {
        event.preventDefault()
        this.aiSidebarOpen = !this.aiSidebarOpen
        this.broadcastState()
        this.emitShortcut('toggle-ai-sidebar')
      } else if (key === 'j' && !input.shift && !input.alt) {
        event.preventDefault()
        void this.triggerInlineWriteRequest()
        this.emitShortcut('open-inline-write')
      } else if ((key === 'l' || key === 'k') && !input.shift && !input.alt) {
        event.preventDefault()
        this.emitShortcut('focus-omnibox')
      } else if (key === 't' && input.shift && !input.alt) {
        event.preventDefault()
        void this.reopenClosedTab()
        this.emitShortcut('reopen-closed-tab')
      } else if (key === 't' && !input.shift && !input.alt) {
        event.preventDefault()
        this.emitShortcut('new-tab')
      } else if (key === 'w' && !input.shift && !input.alt) {
        event.preventDefault()
        this.closeActiveTabShortcut()
      } else if ((key === '\\' && input.shift) || (key === '\\' && input.alt)) {
        event.preventDefault()
        this.toggleSplitView()
        this.emitShortcut('toggle-split-view')
      } else if (key === '\\' && !input.shift && !input.alt) {
        event.preventDefault()
        const nextMode =
          this.store.settings.layoutMode === 'horizontal' ? 'vertical' : 'horizontal'
        this.updateSettings({ layoutMode: nextMode, sidebarCollapsed: false })
        this.emitShortcut('toggle-layout')
      } else if (key === 's' && !input.shift && !input.alt && this.store.settings.layoutMode === 'vertical') {
        // Note: only intercept Cmd+S for sidebar collapse when Shift+Cmd+S is used or via shortcut
      } else if (key === 's' && input.shift && !input.alt) {
        event.preventDefault()
        if (this.store.settings.layoutMode === 'vertical') {
          this.updateSettings({ sidebarCollapsed: !this.store.settings.sidebarCollapsed })
        } else {
          this.updateSettings({ compactTopBar: !this.store.settings.compactTopBar })
        }
        this.emitShortcut('toggle-focus-sidebar')
      } else if (key === 'r' && input.shift && !input.alt) {
        event.preventDefault()
        this.emitShortcut('toggle-reader-view')
      } else if (key === ',' && !input.shift && !input.alt) {
        event.preventDefault()
        this.emitShortcut('open-settings')
      } else if (key === 'r' && !input.shift && !input.alt) {
        event.preventDefault()
        this.reload()
      } else if ((key === '[' || key === '{') && input.shift && !input.alt) {
        event.preventDefault()
        this.cycleAdjacentTab(-1)
      } else if ((key === ']' || key === '}') && input.shift && !input.alt) {
        event.preventDefault()
        this.cycleAdjacentTab(1)
      } else if (key === '[' && !input.shift && !input.alt) {
        event.preventDefault()
        this.goBack()
      } else if (key === ']' && !input.shift && !input.alt) {
        event.preventDefault()
        this.goForward()
      } else if ((key === '=' || key === '+') && !input.alt) {
        event.preventDefault()
        this.setPageZoom('in')
      } else if (key === '-' && !input.alt) {
        event.preventDefault()
        this.setPageZoom('out')
      } else if (key === '0' && !input.shift && !input.alt) {
        event.preventDefault()
        this.setPageZoom('reset')
      } else if (key === 'f' && !input.shift && !input.alt) {
        event.preventDefault()
        this.emitShortcut('find-in-page')
      } else if (key === 'd' && !input.shift && !input.alt) {
        event.preventDefault()
        this.emitShortcut('bookmark-page')
      } else if (key === 'i' && input.alt) {
        event.preventDefault()
        this.openDevTools()
      }
    })
  }

  public syncViewsLayout(): void {
    const sp = this.getSplitView()
    const activeTab = this.getActiveTab()

    if (sp.enabled && sp.leftTabId && sp.rightTabId) {
      const leftTab = this.tabs.find((t) => t.id === sp.leftTabId)
      const rightTab = this.tabs.find((t) => t.id === sp.rightTabId)
      const rightRect = this.secondaryBounds

      for (const [tabId, view] of this.views.entries()) {
        if (view.webContents.isDestroyed()) continue

        if (
          leftTab &&
          tabId === leftTab.id &&
          !isInternalDiaUrl(leftTab.url) &&
          !this.overlayActive &&
          this.primaryBounds.width > 20 &&
          this.primaryBounds.height > 20
        ) {
          view.setBounds({
            x: Math.round(this.primaryBounds.x),
            y: Math.round(this.primaryBounds.y),
            width: Math.round(this.primaryBounds.width),
            height: Math.round(this.primaryBounds.height)
          })
          view.setVisible(true)
        } else if (
          rightTab &&
          tabId === rightTab.id &&
          !isInternalDiaUrl(rightTab.url) &&
          !this.overlayActive &&
          rightRect &&
          rightRect.width > 20 &&
          rightRect.height > 20
        ) {
          view.setBounds({
            x: Math.round(rightRect.x),
            y: Math.round(rightRect.y),
            width: Math.round(rightRect.width),
            height: Math.round(rightRect.height)
          })
          view.setVisible(true)
        } else {
          view.setVisible(false)
        }
      }
      return
    }

    for (const [tabId, view] of this.views.entries()) {
      if (view.webContents.isDestroyed()) continue
      const shouldShow =
        Boolean(activeTab) &&
        activeTab!.id === tabId &&
        !isInternalDiaUrl(activeTab!.url) &&
        !this.overlayActive &&
        this.primaryBounds.width > 20 &&
        this.primaryBounds.height > 20

      if (shouldShow) {
        view.setBounds({
          x: Math.round(this.primaryBounds.x),
          y: Math.round(this.primaryBounds.y),
          width: Math.round(this.primaryBounds.width),
          height: Math.round(this.primaryBounds.height)
        })
        view.setVisible(true)
      } else {
        view.setVisible(false)
      }
    }
  }

  public updateViewportBounds(bounds: ViewportBounds | DualViewportBounds): void {
    if ('primary' in bounds) {
      this.primaryBounds = bounds.primary
      this.secondaryBounds = bounds.secondary ?? null
    } else {
      this.primaryBounds = bounds
      this.secondaryBounds = null
    }
    this.syncViewsLayout()
  }

  private async captureTabDataUrl(tabId: string | null | undefined): Promise<string | null> {
    if (!tabId) return null
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab || isInternalDiaUrl(tab.url)) return null
    const view = this.views.get(tab.id)
    if (!view || view.webContents.isDestroyed()) return null
    try {
      const image = await view.webContents.capturePage()
      if (!image.isEmpty()) {
        // Fast JPEG encoding (~5ms vs ~80ms PNG on Retina) eliminates popup open lag
        const jpegBuf = image.toJPEG(88)
        return `data:image/jpeg;base64,${jpegBuf.toString('base64')}`
      }
    } catch {
      // ignore snapshot error
    }
    return null
  }

  public async setOverlayActive(active: boolean): Promise<OverlaySnapshotResult> {
    let result: OverlaySnapshotResult = { primary: null, secondary: null }
    if (active && !this.overlayActive) {
      const sp = this.getSplitView()
      if (sp.enabled && sp.leftTabId && sp.rightTabId) {
        const [primary, secondary] = await Promise.all([
          this.captureTabDataUrl(sp.leftTabId),
          this.captureTabDataUrl(sp.rightTabId)
        ])
        result = { primary, secondary }
      } else {
        const activeTab = this.getActiveTab()
        result = {
          primary: await this.captureTabDataUrl(activeTab?.id),
          secondary: null
        }
      }
    }
    this.overlayActive = active
    this.syncViewsLayout()
    if (active && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.focus()
    }
    return result
  }

  // ==================== Split View Operations ====================

  public toggleSplitView(): void {
    const sp = this.getSplitView()
    if (sp.enabled) {
      this.closeSplitView()
    } else {
      void this.openSplitView()
    }
  }

  public async openSplitView(rightTabId?: string): Promise<void> {
    const profileId = this.store.activeProfileId
    const sp = this.getSplitView(profileId)
    const currentActive = this.getActiveTab()
    if (!currentActive) return

    const prevRightId = sp.enabled ? sp.rightTabId : null
    const leftId = sp.enabled && sp.leftTabId ? sp.leftTabId : currentActive.id
    const leftTab = this.tabs.find((t) => t.id === leftId)
    if (leftTab && !isInternalDiaUrl(leftTab.url)) {
      this.ensureViewForTab(leftTab, true)
    }

    let resolvedRightId: string | null = null
    if (rightTabId && rightTabId !== leftId) {
      const target = this.tabs.find((t) => t.id === rightTabId && t.profileId === profileId)
      if (target) {
        resolvedRightId = target.id
        if (!isInternalDiaUrl(target.url)) {
          this.ensureViewForTab(target, true)
        }
      }
    }

    if (!resolvedRightId) {
      resolvedRightId = await this.createTab(NEW_TAB_URL, { background: true })
    }

    if (prevRightId && prevRightId !== resolvedRightId && prevRightId !== leftId) {
      const prevTab = this.tabs.find((t) => t.id === prevRightId)
      if (prevTab && prevTab.url === NEW_TAB_URL && !prevTab.isPinned) {
        const idx = this.tabs.findIndex((t) => t.id === prevRightId)
        if (idx >= 0) this.tabs.splice(idx, 1)
      }
    }

    sp.enabled = true
    sp.leftTabId = leftId
    sp.rightTabId = resolvedRightId
    sp.activePane = 'right'
    sp.ratio = sp.ratio >= 0.22 && sp.ratio <= 0.78 ? sp.ratio : 0.5
    this.activeTabByProfile[profileId] = resolvedRightId

    this.persistTabs()
    this.syncViewsLayout()
    this.broadcastState()
  }

  public closeSplitView(keepSide?: SplitPaneSide): void {
    const profileId = this.store.activeProfileId
    const sp = this.getSplitView(profileId)
    if (!sp.enabled) return

    const preferredSide = keepSide || sp.activePane
    const survivorId =
      preferredSide === 'right'
        ? sp.rightTabId || sp.leftTabId
        : sp.leftTabId || sp.rightTabId

    const discardedSideId = preferredSide === 'right' ? sp.leftTabId : sp.rightTabId

    sp.enabled = false
    sp.leftTabId = null
    sp.rightTabId = null
    sp.activePane = 'left'

    if (survivorId && this.tabs.some((t) => t.id === survivorId)) {
      this.activeTabByProfile[profileId] = survivorId
      const survivor = this.tabs.find((t) => t.id === survivorId)
      if (survivor && !isInternalDiaUrl(survivor.url)) {
        this.ensureViewForTab(survivor, true)
      }
    }

    if (discardedSideId && discardedSideId !== survivorId) {
      const disc = this.tabs.find((t) => t.id === discardedSideId)
      const profileTabs = this.tabs.filter((t) => t.profileId === profileId)
      if (disc && disc.url === NEW_TAB_URL && !disc.isPinned && profileTabs.length > 1) {
        const idx = this.tabs.findIndex((t) => t.id === disc.id)
        if (idx >= 0) this.tabs.splice(idx, 1)
      }
    }

    this.persistTabs()
    this.syncViewsLayout()
    this.broadcastState()
  }

  public swapSplitPanes(): void {
    const profileId = this.store.activeProfileId
    const sp = this.getSplitView(profileId)
    if (!sp.enabled || !sp.leftTabId || !sp.rightTabId) return

    const prevLeft = sp.leftTabId
    sp.leftTabId = sp.rightTabId
    sp.rightTabId = prevLeft
    sp.activePane = sp.activePane === 'left' ? 'right' : 'left'
    this.activeTabByProfile[profileId] =
      sp.activePane === 'left' ? sp.leftTabId : sp.rightTabId

    this.persistTabs()
    this.syncViewsLayout()
    this.broadcastState()
  }

  public setSplitActivePane(side: SplitPaneSide): void {
    const profileId = this.store.activeProfileId
    const sp = this.getSplitView(profileId)
    if (!sp.enabled) return

    const targetId = side === 'left' ? sp.leftTabId : sp.rightTabId
    if (!targetId) return

    sp.activePane = side
    this.activeTabByProfile[profileId] = targetId
    const tab = this.tabs.find((t) => t.id === targetId)
    if (tab) {
      tab.lastAccessedAt = Date.now()
      const view = this.views.get(tab.id)
      if (view && !view.webContents.isDestroyed() && !isInternalDiaUrl(tab.url)) {
        view.webContents.focus()
      }
    }

    this.persistTabs()
    this.broadcastState()
  }

  public setSplitRatio(ratio: number): void {
    const sp = this.getSplitView()
    sp.ratio = Math.max(0.22, Math.min(0.78, Number(ratio) || 0.5))
    this.persistTabs()
    this.broadcastState()
  }

  // ==================== Tab Operations ====================

  public async createTab(
    rawUrl: string = NEW_TAB_URL,
    options?: {
      background?: boolean
      pinned?: boolean
      favorite?: boolean
      groupId?: string | null
      profileId?: string
      insertBeforeTabId?: string | null
    }
  ): Promise<string> {
    const profileId = options?.profileId || this.store.activeProfileId
    const resolved =
      rawUrl === NEW_TAB_URL || isChatTabUrl(rawUrl)
        ? rawUrl
        : resolveNavigationUrl(rawUrl, this.store.settings.searchEngine)
    const isFavorite = Boolean(options?.favorite)
    const isPinned = Boolean(options?.pinned || isFavorite)
    const sp = this.getSplitView(profileId)

    // Never accumulate multiple foreground blank New Tab entries
    if (resolved === NEW_TAB_URL && !options?.background && !isPinned) {
      const existingBlank = this.tabs.find(
        (t) => t.profileId === profileId && t.url === NEW_TAB_URL && !t.isPinned && !t.isFavorite
      )
      if (existingBlank) {
        this.switchTab(existingBlank.id)
        return existingBlank.id
      }
    }

    // Reuse an active empty New Tab placeholder when opening a real URL / Chat Tab
    if (resolved !== NEW_TAB_URL && !options?.background && !isPinned) {
      const activeId = this.activeTabByProfile[profileId]
      const activeTab = activeId ? this.tabs.find((t) => t.id === activeId) : undefined
      if (
        activeTab &&
        activeTab.profileId === profileId &&
        activeTab.url === NEW_TAB_URL &&
        !activeTab.isPinned &&
        !activeTab.isFavorite
      ) {
        if (options?.groupId !== undefined) {
          activeTab.groupId = options.groupId
        }
        activeTab.lastAccessedAt = Date.now()
        this.navigate(resolved, activeTab.id)
        return activeTab.id
      }

      // Also clean up any non-active stray blank placeholder tabs not used by Split View
      this.tabs = this.tabs.filter((t) => {
        if (t.profileId !== profileId) return true
        if (t.url !== NEW_TAB_URL || t.isPinned || t.isFavorite) return true
        if (sp.enabled && (t.id === sp.leftTabId || t.id === sp.rightTabId)) return true
        return false
      })
    }

    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const chatTid = getChatThreadIdFromUrl(resolved)
    const chatThread = chatTid ? this.store.threads.find((t) => t.id === chatTid) : undefined

    const tab: TabState = {
      id,
      profileId,
      url: resolved,
      title: chatThread
        ? chatThread.title || tr(this.store.settings.language, 'Arko Chat', 'Arko 对话')
        : isChatTabUrl(resolved)
          ? tr(this.store.settings.language, 'Arko Chat', 'Arko 对话')
          : resolved === NEW_TAB_URL
            ? tr(this.store.settings.language, 'New Tab', '新标签页')
            : resolved,
      isLoading: !isInternalDiaUrl(resolved),
      canGoBack: false,
      canGoForward: false,
      isPinned,
      isFavorite,
      pinnedUrl: isPinned && resolved !== NEW_TAB_URL ? resolved : null,
      isAudioPlaying: false,
      isMuted: false,
      isSensitive: isSensitiveUrl(resolved),
      lastAccessedAt: Date.now(),
      groupId: isFavorite ? null : options?.groupId ?? null,
      zoomFactor: 1
    }

    if (options?.insertBeforeTabId) {
      const beforeIdx = this.tabs.findIndex(
        (t) => t.id === options.insertBeforeTabId && t.profileId === profileId
      )
      if (beforeIdx >= 0) {
        this.tabs.splice(beforeIdx, 0, tab)
      } else {
        this.tabs.push(tab)
      }
    } else {
      this.tabs.push(tab)
    }
    this.sortProfileTabsByTier(profileId)
    if (!options?.background) {
      const sp = this.getSplitView(profileId)
      if (sp.enabled) {
        if (sp.activePane === 'left') {
          sp.leftTabId = id
        } else {
          sp.rightTabId = id
        }
      }
      this.activeTabByProfile[profileId] = id
    }

    if (!isInternalDiaUrl(resolved) && profileId === this.store.activeProfileId) {
      this.ensureViewForTab(tab, true)
    } else if (!options?.background && isInternalDiaUrl(resolved) && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.focus()
    }

    this.persistTabs()
    this.syncViewsLayout()
    this.broadcastState()
    return id
  }

  public switchTab(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab) return
    if (tab.profileId !== this.store.activeProfileId) {
      this.store.activeProfileId = tab.profileId
    }
    tab.lastAccessedAt = Date.now()

    // Expand group automatically if user selects a tab inside a collapsed group
    if (tab.groupId) {
      const grp = this.tabGroups.find((g) => g.id === tab.groupId)
      if (grp && grp.collapsed) grp.collapsed = false
    }

    const sp = this.getSplitView(tab.profileId)
    if (sp.enabled) {
      if (tab.id === sp.leftTabId) {
        sp.activePane = 'left'
      } else if (tab.id === sp.rightTabId) {
        sp.activePane = 'right'
      } else {
        if (sp.activePane === 'left') {
          sp.leftTabId = tab.id
        } else {
          sp.rightTabId = tab.id
        }
      }
    }

    this.activeTabByProfile[tab.profileId] = tab.id
    if (!isInternalDiaUrl(tab.url) && !this.views.has(tab.id)) {
      this.ensureViewForTab(tab, true)
    } else if (isInternalDiaUrl(tab.url) && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.focus()
    }
    this.persistTabs()
    this.syncViewsLayout()
    this.broadcastState()
  }

  public closeTab(tabId: string): void {
    const idx = this.tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return
    const target = this.tabs[idx]
    const profileId = target.profileId
    const sp = this.getSplitView(profileId)

    // Record into Recently Closed Tabs stack (⇧⌘T) if not blank newtab
    if (target.url && target.url !== NEW_TAB_URL) {
      if (!this.closedTabsByProfile[profileId]) {
        this.closedTabsByProfile[profileId] = []
      }
      this.closedTabsByProfile[profileId].unshift({
        url: target.url,
        title: target.title,
        favicon: target.favicon
      })
      if (this.closedTabsByProfile[profileId].length > 25) {
        this.closedTabsByProfile[profileId].length = 25
      }
    }

    const view = this.views.get(tabId)
    if (view) {
      try {
        this.mainWindow.contentView.removeChildView(view)
        if (!view.webContents.isDestroyed()) {
          view.webContents.close()
        }
      } catch {
        // ignore
      }
      this.views.delete(tabId)
    }

    this.tabs.splice(idx, 1)

    if (sp.enabled && (sp.leftTabId === tabId || sp.rightTabId === tabId)) {
      const otherId = sp.leftTabId === tabId ? sp.rightTabId : sp.leftTabId
      sp.enabled = false
      sp.leftTabId = null
      sp.rightTabId = null
      sp.activePane = 'left'
      if (otherId && this.tabs.some((t) => t.id === otherId)) {
        this.activeTabByProfile[profileId] = otherId
      }
    }

    const remaining = this.tabs.filter((t) => t.profileId === profileId)
    if (remaining.length === 0) {
      void this.createTab(NEW_TAB_URL)
      return
    }

    if (
      !this.activeTabByProfile[profileId] ||
      !remaining.some((t) => t.id === this.activeTabByProfile[profileId])
    ) {
      const sorted = [...remaining].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      const nextTab = sorted[0]
      this.activeTabByProfile[profileId] = nextTab.id
      if (!isInternalDiaUrl(nextTab.url) && !this.views.has(nextTab.id)) {
        this.ensureViewForTab(nextTab, true)
      }
    }

    this.persistTabs()
    this.syncViewsLayout()
    this.broadcastState()
  }

  public async reopenClosedTab(): Promise<boolean> {
    const profileId = this.store.activeProfileId
    const stack = this.closedTabsByProfile[profileId]
    if (!stack || stack.length === 0) return false
    const item = stack.shift()!
    await this.createTab(item.url, { background: false })
    return true
  }

  public async duplicateTab(tabId: string): Promise<string | null> {
    const src = this.tabs.find((t) => t.id === tabId)
    if (!src) return null
    return await this.createTab(src.url, {
      background: false,
      pinned: false,
      groupId: src.groupId
    })
  }

  public closeActiveTabShortcut(): void {
    const active = this.getActiveTab()
    if (!active) return
    if (active.url === NEW_TAB_URL && !active.isFavorite && !active.isPinned) {
      const profileTabs = this.tabs.filter((t) => t.profileId === active.profileId)
      if (profileTabs.length <= 1) {
        return
      }
    }
    if (active.isFavorite || active.isPinned) {
      // Arc behavior: ⌘W never destroys Favorites / Pinned tabs.
      // First reset back to pinnedUrl if drifted; otherwise switch to most recent Today tab if any.
      if (active.pinnedUrl && active.url !== active.pinnedUrl) {
        this.navigate(active.pinnedUrl, active.id)
        return
      }
      const unpinnedCandidates = this.tabs
        .filter(
          (t) =>
            t.profileId === active.profileId &&
            !t.isFavorite &&
            !t.isPinned &&
            t.id !== active.id
        )
        .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      if (unpinnedCandidates.length > 0) {
        this.switchTab(unpinnedCandidates[0].id)
      }
      return
    }
    this.closeTab(active.id)
  }

  public reorderTab(
    sourceTabId: string,
    targetTabId: string,
    position: 'before' | 'after' = 'before',
    targetZone?: TabPinMode
  ): void {
    if (!sourceTabId || !targetTabId || sourceTabId === targetTabId) return
    const srcIdx = this.tabs.findIndex((t) => t.id === sourceTabId)
    const dstIdx = this.tabs.findIndex((t) => t.id === targetTabId)
    if (srcIdx === -1 || dstIdx === -1) return

    const srcTab = this.tabs[srcIdx]
    const dstTab = this.tabs[dstIdx]
    if (srcTab.profileId !== dstTab.profileId) return

    const effectiveZone: TabPinMode =
      targetZone ?? (dstTab.isFavorite ? 'favorite' : dstTab.isPinned ? 'pinned' : 'unpinned')
    this.applyPinModeToTab(srcTab, effectiveZone)

    if (effectiveZone !== 'favorite') {
      srcTab.groupId = dstTab.groupId ?? null
    }

    const [removed] = this.tabs.splice(srcIdx, 1)
    const nextDstIdx = this.tabs.findIndex((t) => t.id === targetTabId)
    if (nextDstIdx === -1) {
      this.tabs.push(removed)
    } else {
      const insertAt = position === 'after' ? nextDstIdx + 1 : nextDstIdx
      this.tabs.splice(insertAt, 0, removed)
    }

    this.sortProfileTabsByTier(srcTab.profileId)
    this.persistTabs()
    this.broadcastState()
  }

  public moveTabToZone(tabId: string, targetZone: TabPinMode): void {
    const srcIdx = this.tabs.findIndex((t) => t.id === tabId)
    if (srcIdx === -1) return
    const tab = this.tabs[srcIdx]
    this.applyPinModeToTab(tab, targetZone)
    if (targetZone !== 'pinned') {
      tab.groupId = null
    }

    // Move to the end of that zone within its profile
    this.tabs.splice(srcIdx, 1)
    this.tabs.push(tab)
    this.sortProfileTabsByTier(tab.profileId)
    this.persistTabs()
    this.broadcastState()
  }

  public closeOtherTabs(keepTabId: string): void {
    const keep = this.tabs.find((t) => t.id === keepTabId)
    if (!keep) return
    const toClose = this.tabs
      .filter(
        (t) =>
          t.profileId === keep.profileId &&
          t.id !== keepTabId &&
          !t.isPinned &&
          !t.isFavorite
      )
      .map((t) => t.id)
    for (const id of toClose) {
      this.closeTab(id)
    }
    this.switchTab(keepTabId)
  }

  public clearUnpinnedTabs(profileId: string = this.store.activeProfileId): number {
    const profileTabs = this.tabs.filter((t) => t.profileId === profileId)
    const unpinned = profileTabs.filter((t) => !t.isPinned && !t.isFavorite)
    if (unpinned.length === 0) return 0
    if (
      unpinned.length === 1 &&
      unpinned[0].url === NEW_TAB_URL &&
      profileTabs.length === 1
    ) {
      return 0
    }

    let closedCount = 0
    for (const t of unpinned) {
      if (t.url && t.url !== NEW_TAB_URL) {
        if (!this.closedTabsByProfile[profileId]) {
          this.closedTabsByProfile[profileId] = []
        }
        this.closedTabsByProfile[profileId].unshift({
          url: t.url,
          title: t.title,
          favicon: t.favicon
        })
        if (this.closedTabsByProfile[profileId].length > 25) {
          this.closedTabsByProfile[profileId].length = 25
        }
      }
      const view = this.views.get(t.id)
      if (view) {
        try {
          this.mainWindow.contentView.removeChildView(view)
          if (!view.webContents.isDestroyed()) {
            view.webContents.close()
          }
        } catch {
          // ignore
        }
        this.views.delete(t.id)
      }
      const idx = this.tabs.findIndex((item) => item.id === t.id)
      if (idx >= 0) {
        this.tabs.splice(idx, 1)
        closedCount++
      }
    }

    const sp = this.getSplitView(profileId)
    if (sp.enabled) {
      const hasLeft = Boolean(sp.leftTabId && this.tabs.some((t) => t.id === sp.leftTabId))
      const hasRight = Boolean(sp.rightTabId && this.tabs.some((t) => t.id === sp.rightTabId))
      if (!hasLeft || !hasRight) {
        const survivorId = hasLeft ? sp.leftTabId : hasRight ? sp.rightTabId : null
        sp.enabled = false
        sp.leftTabId = null
        sp.rightTabId = null
        sp.activePane = 'left'
        if (survivorId) this.activeTabByProfile[profileId] = survivorId
      }
    }

    const remaining = this.tabs.filter((t) => t.profileId === profileId)
    if (remaining.length === 0) {
      void this.createTab(NEW_TAB_URL, { profileId })
      return closedCount
    }

    if (
      !this.activeTabByProfile[profileId] ||
      !remaining.some((t) => t.id === this.activeTabByProfile[profileId])
    ) {
      const sorted = [...remaining].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      const nextTab = sorted[0]
      this.activeTabByProfile[profileId] = nextTab.id
      if (
        profileId === this.store.activeProfileId &&
        !isInternalDiaUrl(nextTab.url) &&
        !this.views.has(nextTab.id)
      ) {
        this.ensureViewForTab(nextTab, true)
      }
    }

    this.persistTabs()
    this.syncViewsLayout()
    this.broadcastState()
    return closedCount
  }

  public setTabPinState(tabId: string, mode: TabPinMode): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab) return
    this.applyPinModeToTab(tab, mode)
    this.sortProfileTabsByTier(tab.profileId)
    this.persistTabs()
    this.broadcastState()
  }

  public pinTab(tabId: string, pinned: boolean): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab) return
    if (!pinned) {
      this.setTabPinState(tabId, 'unpinned')
    } else if (!tab.isFavorite) {
      this.setTabPinState(tabId, 'pinned')
    }
  }

  public resetPinnedTab(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab || !tab.pinnedUrl || tab.url === tab.pinnedUrl) return
    this.navigate(tab.pinnedUrl, tab.id)
  }

  public navigate(input: string, targetTabId?: string): void {
    const tab = targetTabId
      ? this.tabs.find((t) => t.id === targetTabId)
      : this.getActiveTab()
    if (!tab) return

    const url = isChatTabUrl(input)
      ? input
      : resolveNavigationUrl(input, this.store.settings.searchEngine)
    tab.url = url
    tab.isSensitive = isSensitiveUrl(url)

    if (isInternalDiaUrl(url)) {
      if (url === NEW_TAB_URL) {
        tab.title = tr(this.store.settings.language, 'New Tab', '新标签页')
      } else {
        const tid = getChatThreadIdFromUrl(url)
        const th = tid ? this.store.threads.find((t) => t.id === tid) : undefined
        tab.title = th?.title || tr(this.store.settings.language, 'Arko Chat', 'Arko 对话')
      }
      tab.isLoading = false
      this.persistTabs()
      this.syncViewsLayout()
      this.broadcastState()
      return
    }

    const hadView = this.views.has(tab.id)
    const view = this.ensureViewForTab(tab, false)
    tab.isLoading = true
    if (!hadView || view.webContents.getURL() !== url) {
      void view.webContents.loadURL(url).catch((err) => {
        console.warn('[BrowserManager] Navigate error:', err?.message)
        tab.isLoading = false
        this.broadcastState()
      })
    }

    this.persistTabs()
    this.syncViewsLayout()
    this.broadcastState()
  }

  public goBack(tabId?: string): boolean {
    const tab = tabId ? this.tabs.find((t) => t.id === tabId) : this.getActiveTab()
    if (!tab) return false
    const view = this.views.get(tab.id)
    if (view && !view.webContents.isDestroyed() && view.webContents.navigationHistory.canGoBack()) {
      view.webContents.navigationHistory.goBack()
      return true
    }
    return false
  }

  public goForward(tabId?: string): boolean {
    const tab = tabId ? this.tabs.find((t) => t.id === tabId) : this.getActiveTab()
    if (!tab) return false
    const view = this.views.get(tab.id)
    if (view && !view.webContents.isDestroyed() && view.webContents.navigationHistory.canGoForward()) {
      view.webContents.navigationHistory.goForward()
      return true
    }
    return false
  }

  public reload(tabId?: string): boolean {
    const tab = tabId ? this.tabs.find((t) => t.id === tabId) : this.getActiveTab()
    if (!tab || isInternalDiaUrl(tab.url)) return false
    const view = this.views.get(tab.id)
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.reload()
      return true
    } else {
      this.ensureViewForTab(tab, true)
      this.syncViewsLayout()
      return true
    }
  }

  public setPageZoom(action: 'in' | 'out' | 'reset', tabId?: string): number {
    const tab = tabId ? this.tabs.find((t) => t.id === tabId) : this.getActiveTab()
    if (!tab || isInternalDiaUrl(tab.url)) return 1
    const view = this.views.get(tab.id)
    if (!view || view.webContents.isDestroyed()) return tab.zoomFactor || 1

    const cur = view.webContents.getZoomFactor()
    let next = 1
    if (action === 'reset') {
      next = 1
    } else if (action === 'in') {
      next = ZOOM_STEPS.find((z) => z > cur + 0.02) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
    } else {
      next = [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.02) ?? ZOOM_STEPS[0]
    }

    view.webContents.setZoomFactor(next)
    tab.zoomFactor = next
    this.broadcastState()
    return next
  }

  public toggleMuteTab(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab) return
    const view = this.views.get(tabId)
    if (view && !view.webContents.isDestroyed()) {
      const next = !view.webContents.isAudioMuted()
      view.webContents.setAudioMuted(next)
      tab.isMuted = next
      this.broadcastState()
    }
  }

  public openDevTools(): void {
    const tab = this.getActiveTab()
    if (tab && !isInternalDiaUrl(tab.url)) {
      const view = this.views.get(tab.id)
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.openDevTools({ mode: 'detach' })
        return
      }
    }
    this.mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  public findInPage(text: string, forward = true, tabId?: string): void {
    const tab = tabId ? this.tabs.find((t) => t.id === tabId) : this.getActiveTab()
    if (!tab || isInternalDiaUrl(tab.url) || !text.trim()) return
    const view = this.views.get(tab.id)
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.findInPage(text, { forward, findNext: true })
    }
  }

  public stopFindInPage(tabId?: string): void {
    const tab = tabId ? this.tabs.find((t) => t.id === tabId) : this.getActiveTab()
    if (!tab) return
    const view = this.views.get(tab.id)
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.stopFindInPage('clearSelection')
    }
  }

  // ==================== Tab Groups & AI Auto-Organizer ====================

  public createTabGroup(
    title: string,
    color: TabGroupColor = 'indigo',
    tabIds: string[] = []
  ): TabGroup {
    const profileId = this.store.activeProfileId
    const group: TabGroup = {
      id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      profileId,
      title: title.trim() || '新分组',
      color,
      collapsed: false
    }
    this.tabGroups.push(group)
    for (const tid of tabIds) {
      const tab = this.tabs.find(
        (t) => t.id === tid && t.profileId === profileId && !t.isFavorite
      )
      if (tab) tab.groupId = group.id
    }
    this.persistTabs()
    this.broadcastState()
    return group
  }

  public assignTabToGroup(tabId: string, groupId: string | null): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab || tab.isFavorite) return
    tab.groupId = groupId
    this.persistTabs()
    this.broadcastState()
  }

  public toggleTabGroupCollapsed(groupId: string): void {
    const grp = this.tabGroups.find((g) => g.id === groupId)
    if (!grp) return
    grp.collapsed = !grp.collapsed
    this.persistTabs()
    this.broadcastState()
  }

  public deleteTabGroup(groupId: string): void {
    for (const t of this.tabs) {
      if (t.groupId === groupId) t.groupId = null
    }
    this.tabGroups = this.tabGroups.filter((g) => g.id !== groupId)
    this.persistTabs()
    this.broadcastState()
  }

  public async organizeTabsByAI(): Promise<{ ok: boolean; groupCount: number; error?: string }> {
    const profileId = this.store.activeProfileId
    const candidateTabs = this.tabs.filter(
      (t) => t.profileId === profileId && !t.isPinned && t.url !== NEW_TAB_URL
    )
    if (candidateTabs.length < 2) {
      return { ok: false, groupCount: 0, error: '至少需要 2 个已打开标签页才能智能分组' }
    }

    const settings = this.store.settings
    const provider =
      settings.providers.find((p) => p.id === settings.activeProviderId) || settings.providers[0]
    const modelId =
      settings.activeModelId || provider.defaultModelId || provider.models[0]?.id || ''

    const res = await this.aiService.organizeTabsWithAI({
      provider,
      modelId,
      tabs: candidateTabs.map((t) => ({
        id: t.id,
        title: t.title || t.url,
        url: t.url
      }))
    })

    if (!res.ok || res.groups.length === 0) {
      return { ok: false, groupCount: 0, error: res.error || '未能生成有效的分组建议' }
    }

    // Replace active profile's groups with freshly organized groups and cluster tabs neatly
    this.tabGroups = this.tabGroups.filter((g) => g.profileId !== profileId)
    for (const t of candidateTabs) {
      t.groupId = null
    }

    const newGroupOrder = new Map<string, number>()
    res.groups.forEach((g, idx) => {
      const grpId = `grp-${Date.now()}-${idx}`
      this.tabGroups.push({
        id: grpId,
        profileId,
        title: g.title,
        color: g.color,
        collapsed: false
      })
      newGroupOrder.set(grpId, idx)
      for (const tid of g.tabIds) {
        const tab = candidateTabs.find((ct) => ct.id === tid)
        if (tab) tab.groupId = grpId
      }
    })

    // Sort profile tabs so favorites come first, then pinned, then grouped tabs clustered together, then ungrouped
    const profileAll = this.tabs.filter((t) => t.profileId === profileId)
    const favs = profileAll.filter((t) => t.isFavorite)
    const pins = profileAll.filter((t) => !t.isFavorite && t.isPinned)
    const unpinnedSorted = profileAll
      .filter((t) => !t.isFavorite && !t.isPinned)
      .sort((a, b) => {
        const ga = a.groupId ? (newGroupOrder.get(a.groupId) ?? 999) : 1000
        const gb = b.groupId ? (newGroupOrder.get(b.groupId) ?? 999) : 1000
        return ga - gb
      })
    const combined = [...favs, ...pins, ...unpinnedSorted]
    let ptr = 0
    this.tabs = this.tabs.map((t) => (t.profileId === profileId ? combined[ptr++] : t))

    this.persistTabs()
    this.broadcastState()
    return { ok: true, groupCount: res.groups.length }
  }

  // ==================== Profiles, Bookmarks, Memories & Reader ====================

  public switchProfile(profileId: string): void {
    const profile = this.store.profiles.find((p) => p.id === profileId)
    if (!profile) return
    this.store.activeProfileId = profile.id

    const sp = this.getSplitView(profile.id)
    if (sp.enabled && sp.leftTabId && sp.rightTabId) {
      const lt = this.tabs.find((t) => t.id === sp.leftTabId)
      const rt = this.tabs.find((t) => t.id === sp.rightTabId)
      if (lt && !isInternalDiaUrl(lt.url) && !this.views.has(lt.id)) this.ensureViewForTab(lt, true)
      if (rt && !isInternalDiaUrl(rt.url) && !this.views.has(rt.id)) this.ensureViewForTab(rt, true)
    } else {
      const activeTab = this.getActiveTab()
      if (activeTab && !isInternalDiaUrl(activeTab.url) && !this.views.has(activeTab.id)) {
        this.ensureViewForTab(activeTab, true)
      }
    }

    this.persistTabs()
    this.syncViewsLayout()
    this.broadcastState()
    void this.refreshConnectedTools(profile.id, true)
  }

  public cycleProfile(direction: 1 | -1): void {
    const list = this.store.profiles
    if (list.length <= 1) return
    const curIdx = list.findIndex((p) => p.id === this.store.activeProfileId)
    const nextIdx = ((curIdx >= 0 ? curIdx : 0) + direction + list.length) % list.length
    this.switchProfile(list[nextIdx].id)
  }

  public createProfile(name: string, emoji: string, accentColor: string): BrowserProfile {
    const slug = `profile-${Date.now().toString(36)}`
    const profile: BrowserProfile = {
      id: slug,
      name: name.trim() || '新空间',
      emoji: emoji.trim() || '✨',
      accentColor: accentColor || '#6366F1',
      partition: `persist:dia-${slug}`
    }
    this.store.profiles.push(profile)
    this.store.saveProfiles()

    const initialTabId = `tab-${slug}-${Date.now()}`
    this.tabs.push({
      id: initialTabId,
      profileId: slug,
      url: NEW_TAB_URL,
      title: '新标签页',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      isPinned: false,
      isFavorite: false,
      pinnedUrl: null,
      isAudioPlaying: false,
      isMuted: false,
      isSensitive: false,
      lastAccessedAt: Date.now(),
      groupId: null,
      zoomFactor: 1
    })
    this.activeTabByProfile[slug] = initialTabId
    this.splitByProfile[slug] = createDefaultSplitState()
    this.switchProfile(slug)
    return profile
  }

  public updateProfile(
    profileId: string,
    partial: Partial<Pick<BrowserProfile, 'name' | 'emoji' | 'accentColor'>>
  ): BrowserProfile | null {
    const profile = this.store.profiles.find((p) => p.id === profileId)
    if (!profile) return null
    if (typeof partial.name === 'string' && partial.name.trim()) {
      profile.name = partial.name.trim()
    }
    if (typeof partial.emoji === 'string' && partial.emoji.trim()) {
      profile.emoji = partial.emoji.trim()
    }
    if (typeof partial.accentColor === 'string' && partial.accentColor.trim()) {
      profile.accentColor = partial.accentColor.trim()
    }
    this.store.saveProfiles()
    this.broadcastState()
    return { ...profile }
  }

  public deleteProfile(profileId: string): boolean {
    if (this.store.profiles.length <= 1) return false
    const idx = this.store.profiles.findIndex((p) => p.id === profileId)
    if (idx === -1) return false

    const toRemoveTabs = this.tabs.filter((t) => t.profileId === profileId)
    for (const t of toRemoveTabs) {
      const view = this.views.get(t.id)
      if (view) {
        try {
          this.mainWindow.contentView.removeChildView(view)
          if (!view.webContents.isDestroyed()) {
            view.webContents.close()
          }
        } catch {
          // ignore
        }
        this.views.delete(t.id)
      }
    }

    this.tabs = this.tabs.filter((t) => t.profileId !== profileId)
    this.tabGroups = this.tabGroups.filter((g) => g.profileId !== profileId)
    delete this.activeTabByProfile[profileId]
    delete this.splitByProfile[profileId]
    delete this.closedTabsByProfile[profileId]

    this.store.profiles.splice(idx, 1)
    this.store.saveProfiles()

    if (this.store.activeProfileId === profileId) {
      const fallback = this.store.profiles[Math.max(0, idx - 1)] || this.store.profiles[0]
      this.switchProfile(fallback.id)
    } else {
      this.persistTabs()
      this.syncViewsLayout()
      this.broadcastState()
    }
    return true
  }

  public toggleBookmark(url: string, title: string, favicon?: string): boolean {
    if (!url || isInternalDiaUrl(url)) return false
    const profileId = this.store.activeProfileId
    const existingIdx = this.store.bookmarks.findIndex(
      (b) => b.profileId === profileId && b.url === url
    )
    if (existingIdx >= 0) {
      this.store.bookmarks.splice(existingIdx, 1)
      this.store.saveBookmarks()
      this.broadcastState()
      return false
    } else {
      const bm: BookmarkItem = {
        id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        profileId,
        url,
        title: title || url,
        favicon,
        createdAt: Date.now()
      }
      this.store.bookmarks.unshift(bm)
      this.store.saveBookmarks()
      this.broadcastState()
      return true
    }
  }

  public removeBookmark(bookmarkId: string): void {
    this.store.bookmarks = this.store.bookmarks.filter((b) => b.id !== bookmarkId)
    this.store.saveBookmarks()
    this.broadcastState()
  }

  public clearCompletedDownloads(): void {
    this.downloads = this.downloads.filter((d) => d.state === 'progressing')
    this.broadcastState()
  }

  public async extractReaderArticle(tabId?: string): Promise<ReaderArticle> {
    const tab = tabId ? this.tabs.find((t) => t.id === tabId) : this.getActiveTab()
    if (!tab || isInternalDiaUrl(tab.url)) {
      return {
        ok: false,
        tabId: tab?.id || '',
        title: tab?.title || '',
        url: tab?.url || '',
        markdown: '',
        wordCount: 0,
        error: '当前页面没有可提取的网页文章正文'
      }
    }
    const view = this.ensureViewForTab(tab, false)
    const res = await extractCleanPageMarkdown({
      url: tab.url,
      title: tab.title,
      webContents: view.webContents,
      sensitiveGuardEnabled: this.store.settings.sensitiveSiteGuard
    })
    if (!res.ok) {
      return {
        ok: false,
        tabId: tab.id,
        title: tab.title,
        url: tab.url,
        markdown: '',
        wordCount: 0,
        error: res.error
      }
    }
    const body = (res.bodyMarkdown || '').trim()
    return {
      ok: true,
      tabId: tab.id,
      title: res.title,
      url: tab.url,
      description: res.description,
      markdown: body || '*（未提取到正文内容）*',
      wordCount: body.length
    }
  }

  public addMemory(
    content: string,
    category: MemoryItem['category'] = 'preference',
    source?: string
  ): MemoryItem {
    const trimmed = content.trim()
    const existing = this.store.memories.find(
      (m) => m.content.trim().toLowerCase() === trimmed.toLowerCase()
    )
    if (existing) {
      existing.enabled = true
      this.store.saveMemories()
      this.broadcastState()
      return existing
    }

    const item: MemoryItem = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content: trimmed,
      category,
      enabled: true,
      source,
      createdAt: Date.now()
    }
    this.store.memories.unshift(item)
    this.store.saveMemories()
    this.broadcastState()
    return item
  }

  public toggleMemory(memoryId: string, enabled: boolean): void {
    const mem = this.store.memories.find((m) => m.id === memoryId)
    if (!mem) return
    mem.enabled = enabled
    this.store.saveMemories()
    this.broadcastState()
  }

  public deleteMemory(memoryId: string): void {
    this.store.memories = this.store.memories.filter((m) => m.id !== memoryId)
    this.store.saveMemories()
    this.broadcastState()
  }

  public updateSettings(partial: Partial<AppSettings>): AppSettings {
    const next: AppSettings = {
      ...this.store.settings,
      ...partial
    }
    this.store.saveSettings(next)
    this.syncWindowTitleBarOverlay()
    this.syncAllViewsOverlayConfig()
    this.broadcastState()
    void this.refreshConnectedTools(this.store.activeProfileId, true)
    return next
  }

  public syncWindowTitleBarOverlay(): void {
    if (process.platform === 'darwin' || this.mainWindow.isDestroyed()) return
    if (typeof this.mainWindow.setTitleBarOverlay === 'function') {
      const dark = this.isEffectiveDark()
      try {
        this.mainWindow.setTitleBarOverlay({
          color: dark ? '#19191B' : '#F4F4F5',
          symbolColor: dark ? '#E4E4E7' : '#27272A',
          height: 38
        })
      } catch {
        // ignore if unsupported on older WM
      }
    }
  }

  public async selectCodingWorkspace(): Promise<string | null> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.mainWindow, {
      title: tr(
        this.store.settings.language,
        'Select Local Code Folder (Arko Coding Agent Workspace)',
        '选择本地代码项目文件夹 (Arko Coding Agent 工作区)'
      ),
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled || !filePaths || filePaths.length === 0) return null
    const chosen = filePaths[0]
    const prevRecents = (this.store.settings.recentWorkspaces || []).filter((p) => p !== chosen)
    this.updateSettings({
      codingWorkspacePath: chosen,
      agentModeEnabled: true,
      recentWorkspaces: [chosen, ...prevRecents].slice(0, 6)
    })
    return chosen
  }

  public clearCodingWorkspace(): void {
    this.updateSettings({ codingWorkspacePath: null })
  }

  public setAISidebarOpen(open: boolean): void {
    this.aiSidebarOpen = open
    this.broadcastState()
  }

  // ==================== First-Launch Onboarding & Browser Data Import ====================

  public detectImportBrowsers(): DetectedBrowserSource[] {
    return detectAllBrowsers()
  }

  public async pickCustomBrowserImportPath(
    browserId: ImportBrowserId
  ): Promise<DetectedBrowserSource | null> {
    const lang = this.store.settings.language
    const defaultDir =
      process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : app.getPath('home')

    const { canceled, filePaths } = await dialog.showOpenDialog(this.mainWindow, {
      title: tr(
        lang,
        'Select Browser User Data Folder or Exported Bookmarks File',
        '选择浏览器用户数据目录（如 Arc / Chrome / Dia）或导出的书签文件'
      ),
      defaultPath: fs.existsSync(defaultDir) ? defaultDir : undefined,
      properties:
        process.platform === 'darwin'
          ? ['openDirectory', 'openFile', 'showHiddenFiles']
          : ['openDirectory'],
      filters: [
        {
          name: 'Browser Data / Bookmarks',
          extensions: ['json', 'html', 'htm']
        }
      ]
    })

    if (canceled || !filePaths || filePaths.length === 0) return null
    return inspectBrowserAtPath(browserId, filePaths[0], true)
  }

  public completeOnboarding(): AppSettings {
    return this.updateSettings({ onboardingCompleted: true })
  }

  public executeBrowserImport(request: BrowserImportRequest): BrowserImportResult {
    const parsed = parseBrowserDataForImport(request)
    if (!parsed.ok) {
      return {
        ok: false,
        browserId: request.browserId,
        spacesCreated: 0,
        favoritesImported: 0,
        pinnedTabsImported: 0,
        tabGroupsCreated: 0,
        bookmarksImported: 0,
        historyImported: 0,
        warnings: parsed.warnings,
        error: parsed.error
      }
    }

    const groupColors: TabGroupColor[] = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet']
    let groupColorCursor = this.tabGroups.length
    let spacesCreated = 0
    let favoritesImported = 0
    let pinnedTabsImported = 0
    let tabGroupsCreated = 0
    let bookmarksImported = 0
    let historyImported = 0
    let firstTargetProfileId: string | null = null

    const isFreshOnboarding = !this.store.settings.onboardingCompleted
    const totalIncomingBookmarks = parsed.spaces.reduce((s, sp) => s + sp.bookmarks.length, 0)
    if (isFreshOnboarding && request.scopes.bookmarks && totalIncomingBookmarks > 0) {
      const demoIds = new Set(['bm-arko-github', 'bm-github', 'bm-hn'])
      if (this.store.bookmarks.every((b) => demoIds.has(b.id))) {
        this.store.bookmarks = []
      }
    }

    const historyMap = new Map<string, (typeof this.store.history)[number]>()
    for (const h of this.store.history) {
      historyMap.set(`${h.profileId}::${h.url}`, h)
    }

    parsed.spaces.forEach((spacePayload, spaceIdx) => {
      let targetProfileId = this.store.activeProfileId

      if (request.createSpacesFromProfiles) {
        const normalizedIncoming = spacePayload.name.trim().toLowerCase()
        const matchedExisting = this.store.profiles.find(
          (p) => p.name.trim().toLowerCase() === normalizedIncoming
        )
        if (matchedExisting) {
          targetProfileId = matchedExisting.id
          if (request.browserId === 'arc') {
            if (spacePayload.emoji) matchedExisting.emoji = spacePayload.emoji
            if (spacePayload.accentColor) matchedExisting.accentColor = spacePayload.accentColor
          }
        } else {
          const slug = `profile-${request.browserId}-${Date.now().toString(36)}-${spaceIdx}`
          const createdProfile: BrowserProfile = {
            id: slug,
            name: spacePayload.name.trim() || `Space ${spaceIdx + 1}`,
            emoji: spacePayload.emoji || '✨',
            accentColor: spacePayload.accentColor || '#4F46E5',
            partition: `persist:arko-profile-${slug}`
          }
          this.store.profiles.push(createdProfile)
          targetProfileId = slug
          spacesCreated++

          const initTabId = `tab-${slug}-${Date.now()}-${spaceIdx}`
          this.tabs.push({
            id: initTabId,
            profileId: slug,
            url: NEW_TAB_URL,
            title: tr(this.store.settings.language, 'New Tab', '新标签页'),
            isLoading: false,
            canGoBack: false,
            canGoForward: false,
            isPinned: false,
            isFavorite: false,
            pinnedUrl: null,
            isAudioPlaying: false,
            isMuted: false,
            isSensitive: false,
            lastAccessedAt: Date.now(),
            groupId: null,
            zoomFactor: 1
          })
          this.activeTabByProfile[slug] = initTabId
          this.splitByProfile[slug] = createDefaultSplitState()
        }
      }

      if (!firstTargetProfileId) {
        firstTargetProfileId = targetProfileId
      }

      // 1. Merge Favorites & Pinned Tabs + Folder TabGroups (lazy WebContentsView: 0 RAM until clicked)
      if (request.scopes.spacesAndPinned) {
        const existingProfileTabs = this.tabs.filter((t) => t.profileId === targetProfileId)
        const existingPinnedUrls = new Set(
          existingProfileTabs
            .filter((t) => t.isPinned || t.isFavorite)
            .map((t) => t.pinnedUrl || t.url)
        )
        let currentFavCount = existingProfileTabs.filter((t) => t.isFavorite).length

        for (const fav of spacePayload.favorites) {
          if (currentFavCount >= 12) break
          if (existingPinnedUrls.has(fav.url)) continue
          existingPinnedUrls.add(fav.url)
          currentFavCount++
          favoritesImported++
          this.tabs.push({
            id: `tab-imp-fav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            profileId: targetProfileId,
            url: fav.url,
            title: fav.title || fav.url,
            favicon: fav.favicon,
            isLoading: false,
            canGoBack: false,
            canGoForward: false,
            isPinned: true,
            isFavorite: true,
            pinnedUrl: fav.url,
            isAudioPlaying: false,
            isMuted: false,
            isSensitive: isSensitiveUrl(fav.url),
            lastAccessedAt: Date.now() - favoritesImported,
            groupId: null,
            zoomFactor: 1
          })
        }

        // Count items per folder so large imported folders start neatly collapsed
        const folderSizes = new Map<string, number>()
        for (const pt of spacePayload.pinnedTabs) {
          if (pt.folderTitle) {
            folderSizes.set(pt.folderTitle, (folderSizes.get(pt.folderTitle) || 0) + 1)
          }
        }

        const groupByTitle = new Map<string, TabGroup>()
        for (const g of this.tabGroups) {
          if (g.profileId === targetProfileId) {
            groupByTitle.set(g.title.trim().toLowerCase(), g)
          }
        }

        let addedPinnedInSpace = 0
        for (const pt of spacePayload.pinnedTabs) {
          if (addedPinnedInSpace >= 80) break
          if (existingPinnedUrls.has(pt.url)) continue
          existingPinnedUrls.add(pt.url)
          addedPinnedInSpace++
          pinnedTabsImported++

          let groupId: string | null = null
          if (pt.folderTitle && pt.folderTitle.trim()) {
            const normFolder = pt.folderTitle.trim().toLowerCase()
            let grp = groupByTitle.get(normFolder)
            if (!grp) {
              grp = {
                id: `grp-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                profileId: targetProfileId,
                title: pt.folderTitle.trim(),
                color: groupColors[groupColorCursor++ % groupColors.length],
                collapsed: (folderSizes.get(pt.folderTitle) || 0) > 5
              }
              this.tabGroups.push(grp)
              groupByTitle.set(normFolder, grp)
              tabGroupsCreated++
            }
            groupId = grp.id
          }

          this.tabs.push({
            id: `tab-imp-pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            profileId: targetProfileId,
            url: pt.url,
            title: pt.title || pt.url,
            favicon: pt.favicon,
            isLoading: false,
            canGoBack: false,
            canGoForward: false,
            isPinned: true,
            isFavorite: false,
            pinnedUrl: pt.url,
            isAudioPlaying: false,
            isMuted: false,
            isSensitive: isSensitiveUrl(pt.url),
            lastAccessedAt: Date.now() - 100 - pinnedTabsImported,
            groupId,
            zoomFactor: 1
          })
        }
      }

      // 2. Merge Bookmarks
      if (request.scopes.bookmarks && spacePayload.bookmarks.length > 0) {
        const existingBmUrls = new Set(
          this.store.bookmarks
            .filter((b) => b.profileId === targetProfileId)
            .map((b) => b.url)
        )
        const newBms: BookmarkItem[] = []
        for (const b of spacePayload.bookmarks) {
          if (existingBmUrls.has(b.url)) continue
          existingBmUrls.add(b.url)
          bookmarksImported++
          newBms.push({
            id: `bm-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            profileId: targetProfileId,
            url: b.url,
            title: b.title || b.url,
            favicon: b.favicon,
            createdAt: b.createdAt || Date.now()
          })
          if (this.store.bookmarks.length + newBms.length >= 5000) break
        }
        if (newBms.length > 0) {
          this.store.bookmarks.push(...newBms)
        }
      }

      // 3. Merge History
      if (request.scopes.history && spacePayload.history.length > 0) {
        for (const h of spacePayload.history) {
          const mapKey = `${targetProfileId}::${h.url}`
          const existing = historyMap.get(mapKey)
          if (existing) {
            existing.visitedAt = Math.max(existing.visitedAt, h.visitedAt)
            existing.visitCount = Math.max(existing.visitCount, h.visitCount)
            if (!existing.favicon && h.favicon) existing.favicon = h.favicon
          } else {
            historyImported++
            const item = {
              id: `hist-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
              profileId: targetProfileId,
              url: h.url,
              title: h.title || h.url,
              favicon: h.favicon,
              visitedAt: h.visitedAt,
              visitCount: h.visitCount
            }
            historyMap.set(mapKey, item)
          }
        }
      }
    })

    if (request.scopes.history && historyImported > 0) {
      this.store.history = [...historyMap.values()]
        .sort((a, b) => b.visitedAt - a.visitedAt)
        .slice(0, 2000)
      this.store.saveHistory()
    }

    if (bookmarksImported > 0 || isFreshOnboarding) {
      this.store.saveBookmarks()
    }

    this.store.saveProfiles()
    this.sortProfileTabsByTier()

    if (firstTargetProfileId && this.store.profiles.some((p) => p.id === firstTargetProfileId)) {
      this.store.activeProfileId = firstTargetProfileId
    }

    const nextSettings: Partial<AppSettings> = {
      onboardingCompleted: true,
      lastImportedBrowser: request.browserId,
      lastImportedAt: Date.now()
    }
    if (isFreshOnboarding && (favoritesImported > 0 || pinnedTabsImported > 0 || spacesCreated > 0)) {
      nextSettings.layoutMode = 'vertical'
      nextSettings.sidebarCollapsed = false
    }
    this.store.saveSettings({
      ...this.store.settings,
      ...nextSettings
    })

    this.persistTabs()
    this.syncViewsLayout()
    this.broadcastState()

    return {
      ok: true,
      browserId: request.browserId,
      spacesCreated,
      favoritesImported,
      pinnedTabsImported,
      tabGroupsCreated,
      bookmarksImported,
      historyImported,
      warnings: parsed.warnings
    }
  }

  // ==================== Context Extraction & Local Export Skills ====================

  public async extractPageContext(
    tabId?: string,
    splitPaneRole?: SplitPaneSide
  ): Promise<PageExtractedContext | null> {
    const tab = tabId ? this.tabs.find((t) => t.id === tabId) : this.getActiveTab()
    if (!tab) return null
    let view = this.views.get(tab.id)
    if (!view && !isInternalDiaUrl(tab.url)) {
      view = this.ensureViewForTab(tab, true)
    }
    return extractTabContent(
      tab.id,
      tab.url,
      tab.title,
      view?.webContents,
      this.store.settings.sensitiveSiteGuard,
      splitPaneRole
    )
  }

  public async captureActiveTabScreenshot(
    tabId?: string
  ): Promise<{ ok: boolean; dataUrl?: string; title?: string; error?: string }> {
    let tab = tabId ? this.tabs.find((t) => t.id === tabId) : this.getActiveTab()
    // If active tab is a Chat Tab inside Split View, capture the sibling web pane!
    if (tab && isInternalDiaUrl(tab.url)) {
      const sp = this.getSplitView()
      if (sp.enabled) {
        const siblingId = sp.leftTabId === tab.id ? sp.rightTabId : sp.leftTabId
        const siblingTab = siblingId ? this.tabs.find((t) => t.id === siblingId) : undefined
        if (siblingTab && !isInternalDiaUrl(siblingTab.url)) {
          tab = siblingTab
        }
      }
    }

    if (!tab || isInternalDiaUrl(tab.url)) {
      return { ok: false, error: '当前标签页不是可截图的网页' }
    }
    if (this.store.settings.sensitiveSiteGuard && tab.isSensitive) {
      return { ok: false, error: '隐私护栏保护中：敏感金融或密码页面禁止发送截图给模型' }
    }

    const view = this.views.get(tab.id)
    if (!view || view.webContents.isDestroyed()) {
      return { ok: false, error: '网页视图尚未就绪' }
    }

    try {
      const image = await view.webContents.capturePage()
      if (image.isEmpty()) {
        return { ok: false, error: '未能捕获到有效画面' }
      }
      const size = image.getSize()
      const resized = size.width > 1280 ? image.resize({ width: 1280 }) : image
      const jpegBuf = resized.toJPEG(82)
      const dataUrl = `data:image/jpeg;base64,${jpegBuf.toString('base64')}`
      return {
        ok: true,
        dataUrl,
        title: tab.title || tab.url
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || '网页截图失败' }
    }
  }

  public async executeLocalSkill(
    commandInput: string,
    targetTabId?: string
  ): Promise<LocalSkillExecutionResult> {
    const trimmed = commandInput.trim()
    const lower = trimmed.toLowerCase()
    const isScreenshot = lower.startsWith('/screenshot')
    const sp = this.getSplitView()
    const tab = targetTabId ? this.tabs.find((t) => t.id === targetTabId) : this.getActiveTab()

    if (!isScreenshot) {
      const exportBothSplit =
        sp.enabled &&
        sp.leftTabId &&
        sp.rightTabId &&
        (lower.includes('split') || lower.includes('both') || lower.includes('双屏'))

      if (exportBothSplit) {
        const leftTab = this.tabs.find((t) => t.id === sp.leftTabId)
        const rightTab = this.tabs.find((t) => t.id === sp.rightTabId)
        const [leftRes, rightRes] = await Promise.all([
          extractCleanPageMarkdown({
            url: leftTab?.url || '',
            title: leftTab?.title || '左侧页面',
            webContents: leftTab ? this.views.get(leftTab.id)?.webContents : undefined,
            sensitiveGuardEnabled: this.store.settings.sensitiveSiteGuard
          }),
          extractCleanPageMarkdown({
            url: rightTab?.url || '',
            title: rightTab?.title || '右侧页面',
            webContents: rightTab ? this.views.get(rightTab.id)?.webContents : undefined,
            sensitiveGuardEnabled: this.store.settings.sensitiveSiteGuard
          })
        ])

        if (!leftRes.ok && !rightRes.ok) {
          return {
            ok: false,
            kind: 'local-markdown',
            error: leftRes.error || rightRes.error || '分屏页面均无法导出 Markdown'
          }
        }

        const combinedTitle = `${leftRes.title || '左屏'} vs ${rightRes.title || '右屏'}`
        const combinedMd = [
          `# 分屏网页归档：${combinedTitle}`,
          '',
          '## 左侧分屏页面',
          leftRes.ok ? leftRes.markdown : `> ${leftRes.error}`,
          '',
          '---',
          '',
          '## 右侧分屏页面',
          rightRes.ok ? rightRes.markdown : `> ${rightRes.error}`
        ].join('\n')

        clipboard.writeText(combinedMd)
        const defaultFile = path.join(
          app.getPath('downloads'),
          `${sanitizeFileName(combinedTitle)}.md`
        )
        const { canceled, filePath } = await dialog.showSaveDialog(this.mainWindow, {
          title: '导出分屏双页 Markdown',
          defaultPath: defaultFile,
          filters: [{ name: 'Markdown 文档', extensions: ['md'] }]
        })

        let savedPath: string | undefined
        if (!canceled && filePath) {
          await fs.promises.writeFile(filePath, combinedMd, 'utf-8')
          savedPath = filePath
        }
        return {
          ok: true,
          kind: 'local-markdown',
          title: combinedTitle,
          savedPath,
          copiedToClipboard: true,
          markdownLength: combinedMd.length
        }
      }

      if (!tab || isInternalDiaUrl(tab.url)) {
        return {
          ok: false,
          kind: 'local-markdown',
          error: '请先切换到普通网页标签页后再执行 /markdown。'
        }
      }

      const view = this.ensureViewForTab(tab, false)
      const res = await extractCleanPageMarkdown({
        url: tab.url,
        title: tab.title,
        webContents: view.webContents,
        sensitiveGuardEnabled: this.store.settings.sensitiveSiteGuard
      })

      if (!res.ok) {
        return { ok: false, kind: 'local-markdown', error: res.error }
      }

      clipboard.writeText(res.markdown)
      const defaultFile = path.join(
        app.getPath('downloads'),
        `${sanitizeFileName(res.title)}.md`
      )
      const { canceled, filePath } = await dialog.showSaveDialog(this.mainWindow, {
        title: '保存网页干净 Markdown',
        defaultPath: defaultFile,
        filters: [{ name: 'Markdown 文档', extensions: ['md'] }]
      })

      let savedPath: string | undefined
      if (!canceled && filePath) {
        await fs.promises.writeFile(filePath, res.markdown, 'utf-8')
        savedPath = filePath
      }

      return {
        ok: true,
        kind: 'local-markdown',
        title: res.title,
        savedPath,
        copiedToClipboard: true,
        markdownLength: res.markdown.length
      }
    }

    if (!tab || isInternalDiaUrl(tab.url)) {
      return {
        ok: false,
        kind: 'local-screenshot',
        error: '请先切换到普通网页标签页后再执行 /screenshot。'
      }
    }

    const view = this.views.get(tab.id)
    if (!view || view.webContents.isDestroyed()) {
      return { ok: false, kind: 'local-screenshot', error: '当前页面视图尚未就绪' }
    }

    const fullPage =
      lower.includes('full') || lower.includes('整页') || lower.includes('长图') || lower.includes('all')

    let capturedImage: Electron.NativeImage | null = null
    if (fullPage) {
      try {
        if (!view.webContents.debugger.isAttached()) {
          view.webContents.debugger.attach('1.3')
        }
        const metrics = await view.webContents.debugger.sendCommand('Page.getLayoutMetrics')
        const contentSize = metrics?.cssContentSize || metrics?.contentSize
        const clipWidth = Math.min(4096, Math.max(320, Math.ceil(contentSize?.width || 1280)))
        const clipHeight = Math.min(16000, Math.max(240, Math.ceil(contentSize?.height || 900)))
        const shot = await view.webContents.debugger.sendCommand('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
          clip: {
            x: 0,
            y: 0,
            width: clipWidth,
            height: clipHeight,
            scale: 2
          }
        })
        if (shot?.data) {
          const buf = Buffer.from(shot.data, 'base64')
          const img = nativeImage.createFromBuffer(buf)
          if (!img.isEmpty()) {
            capturedImage = img
          }
        }
      } catch (err) {
        console.warn('[BrowserManager] Full-page CDP screenshot fallback to visible:', err)
      } finally {
        try {
          if (view.webContents.debugger.isAttached()) {
            view.webContents.debugger.detach()
          }
        } catch {
          // ignore
        }
      }
    }

    if (!capturedImage) {
      try {
        const img = await view.webContents.capturePage()
        if (!img.isEmpty()) {
          capturedImage = img
        }
      } catch (err: any) {
        return {
          ok: false,
          kind: 'local-screenshot',
          error: err?.message || '截取网页画面失败'
        }
      }
    }

    if (!capturedImage || capturedImage.isEmpty()) {
      return { ok: false, kind: 'local-screenshot', error: '未能捕获到有效网页图像' }
    }

    clipboard.writeImage(capturedImage)
    const size = capturedImage.getSize()
    const previewImg =
      size.width > 920 ? capturedImage.resize({ width: 920 }) : capturedImage
    const previewDataUrl = previewImg.toDataURL()

    const defaultPng = path.join(
      app.getPath('downloads'),
      `${sanitizeFileName(tab.title || 'screenshot')}-${fullPage ? 'full' : 'view'}.png`
    )
    const { canceled, filePath } = await dialog.showSaveDialog(this.mainWindow, {
      title: fullPage ? '保存整页高清长截图' : '保存网页高清截图',
      defaultPath: defaultPng,
      filters: [{ name: 'PNG 图像', extensions: ['png'] }]
    })

    let savedPath: string | undefined
    if (!canceled && filePath) {
      await fs.promises.writeFile(filePath, capturedImage.toPNG())
      savedPath = filePath
    }

    return {
      ok: true,
      kind: 'local-screenshot',
      title: tab.title || tab.url,
      savedPath,
      copiedToClipboard: true,
      imageDataUrl: previewDataUrl,
      width: size.width,
      height: size.height,
      fullPage
    }
  }

  public revealInFinder(filePath: string): void {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath)
    }
  }

  // ==================== Inline Write & Form Preview Fill ====================

  public async inspectInlineWriteTarget(
    tabId?: string,
    preferredMode?: 'inline' | 'form',
    clickPoint?: { x: number; y: number }
  ): Promise<InlineEditableTargetInfo | null> {
    const tab = tabId ? this.tabs.find((t) => t.id === tabId) : this.getActiveTab()
    if (!tab) return null
    const view = this.views.get(tab.id)
    const bounds = this.getViewportBoundsForTab(tab.id)
    return inspectEditableAndForms({
      tabId: tab.id,
      url: tab.url,
      pageTitle: tab.title,
      webContents: view?.webContents,
      viewportBounds: bounds,
      sensitiveGuardEnabled: this.store.settings.sensitiveSiteGuard,
      clickPoint,
      preferredMode
    })
  }

  public async triggerInlineWriteRequest(
    tabId?: string,
    clickPoint?: { x: number; y: number },
    preferredMode?: 'inline' | 'form'
  ): Promise<void> {
    const target = await this.inspectInlineWriteTarget(tabId, preferredMode, clickPoint)
    if (!target || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('arko:inline-write-requested', target)
  }

  private async getSiblingSplitContext(tabId: string): Promise<PageExtractedContext | null> {
    const sp = this.getSplitView()
    if (!sp.enabled || !sp.leftTabId || !sp.rightTabId) return null
    const siblingId =
      sp.leftTabId === tabId
        ? sp.rightTabId
        : sp.rightTabId === tabId
          ? sp.leftTabId
          : null
    if (!siblingId) return null
    const siblingTab = this.tabs.find((t) => t.id === siblingId)
    if (!siblingTab || isInternalDiaUrl(siblingTab.url)) return null
    return await this.extractPageContext(siblingId)
  }

  public async startInlineWriteStream(params: {
    requestId: string
    tabId: string
    preset: InlineWriteActionPreset
    instruction: string
    selectedText: string
    surroundingValue: string
    fieldLabel: string
  }): Promise<void> {
    const settings = this.store.settings
    const provider =
      settings.providers.find((p) => p.id === settings.activeProviderId) || settings.providers[0]
    const modelId =
      settings.activeModelId || provider.defaultModelId || provider.models[0]?.id || ''

    const [pageContext, siblingSplitContext] = await Promise.all([
      this.extractPageContext(params.tabId),
      this.getSiblingSplitContext(params.tabId)
    ])

    const sendChunk = (payload: InlineWriteStreamPayload): void => {
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('arko:inline-write-chunk', payload)
      }
    }

    await this.aiService.streamInlineWrite({
      requestId: params.requestId,
      provider,
      modelId,
      personalizationPrompt: settings.personalizationPrompt,
      memories: settings.memoryEnabled ? this.store.memories : undefined,
      preset: params.preset,
      instruction: params.instruction,
      fieldLabel: params.fieldLabel,
      selectedText: params.selectedText,
      surroundingValue: params.surroundingValue,
      pageContext,
      siblingSplitContext,
      onChunk: sendChunk
    })
  }

  public async applyInlineWriteResult(params: {
    tabId: string
    text: string
    mode: 'replace-or-insert' | 'append' | 'replace-all'
  }): Promise<boolean> {
    const view = this.views.get(params.tabId)
    return await injectInlineWriteText({
      webContents: view?.webContents,
      text: params.text,
      mode: params.mode
    })
  }

  public async generateFormFillPreview(params: {
    tabId: string
    instruction: string
    fields: WebFormFieldInfo[]
  }): Promise<{ ok: boolean; proposals: WebFormFillProposal[]; error?: string }> {
    const settings = this.store.settings
    const provider =
      settings.providers.find((p) => p.id === settings.activeProviderId) || settings.providers[0]
    const modelId =
      settings.activeModelId || provider.defaultModelId || provider.models[0]?.id || ''

    const [pageContext, siblingSplitContext] = await Promise.all([
      this.extractPageContext(params.tabId),
      this.getSiblingSplitContext(params.tabId)
    ])

    return await this.aiService.generateFormFillProposals({
      provider,
      modelId,
      personalizationPrompt: settings.personalizationPrompt,
      memories: settings.memoryEnabled ? this.store.memories : undefined,
      instruction: params.instruction,
      fields: params.fields,
      pageContext,
      siblingSplitContext
    })
  }

  public async applyFormFillValues(params: {
    tabId: string
    fills: Array<{ fieldId: string; value: string }>
  }): Promise<{ ok: boolean; appliedCount: number }> {
    const view = this.views.get(params.tabId)
    const appliedCount = await applyWebFormFills({
      webContents: view?.webContents,
      fills: params.fills
    })
    return { ok: appliedCount > 0, appliedCount }
  }

  // ==================== First-Class Chat Tabs & AI Streaming Chat ====================

  public async createThread(): Promise<ChatThread> {
    const thread: ChatThread = {
      id: `thread-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      profileId: this.store.activeProfileId,
      title: tr(this.store.settings.language, 'New Chat', '新对话'),
      messages: [],
      updatedAt: Date.now()
    }
    this.store.threads.unshift(thread)
    this.store.saveThreads()
    this.broadcastState()
    return thread
  }

  public deleteThread(threadId: string): void {
    this.aiService.abort(threadId)
    this.store.threads = this.store.threads.filter((th) => th.id !== threadId)
    this.store.saveThreads()

    // Also close or reset any Chat Tab pointing to this deleted thread
    const chatUrl = makeChatTabUrl(threadId)
    const matchingTabs = this.tabs.filter((t) => t.url === chatUrl).map((t) => t.id)
    for (const tid of matchingTabs) {
      this.closeTab(tid)
    }

    this.broadcastState()
  }

  private syncChatTabTitles(thread: ChatThread): void {
    const chatUrl = makeChatTabUrl(thread.id)
    let changed = false
    for (const t of this.tabs) {
      if (t.url === chatUrl && t.title !== thread.title) {
        t.title = thread.title || tr(this.store.settings.language, 'Arko Chat', 'Arko 对话')
        changed = true
      }
    }
    if (changed) {
      this.persistTabs()
    }
  }

  public async openChatAsTab(threadId?: string): Promise<string> {
    let thread = threadId
      ? this.store.threads.find((t) => t.id === threadId)
      : undefined
    if (!thread) {
      thread = await this.createThread()
    }
    const chatUrl = makeChatTabUrl(thread.id)
    const existingTab = this.tabs.find(
      (t) => t.profileId === this.store.activeProfileId && t.url === chatUrl
    )
    if (existingTab) {
      this.switchTab(existingTab.id)
      return thread.id
    }

    const active = this.getActiveTab()
    if (active && active.url === NEW_TAB_URL && !active.isPinned) {
      this.navigate(chatUrl, active.id)
    } else {
      await this.createTab(chatUrl, { background: false })
    }
    return thread.id
  }

  public dockChatTabToSidebar(tabId: string, _threadId: string): void {
    this.aiSidebarOpen = true
    const profileTabs = this.tabs.filter((t) => t.profileId === this.store.activeProfileId)
    if (profileTabs.length > 1) {
      this.closeTab(tabId)
    } else {
      this.navigate(NEW_TAB_URL, tabId)
    }
    this.broadcastState()
  }

  public async regenerateLastReply(threadId: string): Promise<void> {
    const thread = this.store.threads.find((th) => th.id === threadId)
    if (!thread || thread.messages.length === 0) return
    this.aiService.abort(threadId)

    // Pop trailing assistant messages, then pop the last user message and replay it
    while (thread.messages.length > 0 && thread.messages.at(-1)?.role === 'assistant') {
      thread.messages.pop()
    }
    const lastUser = thread.messages.pop()
    if (!lastUser || lastUser.role !== 'user') {
      this.store.saveThreads()
      this.broadcastState()
      return
    }

    await this.sendChatMessage({
      threadId: thread.id,
      prompt: lastUser.content,
      quotedText: lastUser.quotedText,
      imageDataUrl: lastUser.imageAttachment,
      mentions: lastUser.mentions || [],
      includeActiveTab: this.store.settings.includeActiveTabByDefault
    })
  }

  public async editAndResendUserMessage(params: {
    threadId: string
    messageId: string
    newPrompt: string
  }): Promise<void> {
    const { threadId, messageId, newPrompt } = params
    const trimmed = newPrompt.trim()
    if (!trimmed) return
    const thread = this.store.threads.find((th) => th.id === threadId)
    if (!thread) return
    const idx = thread.messages.findIndex((m) => m.id === messageId && m.role === 'user')
    if (idx === -1) return

    this.aiService.abort(threadId)
    const original = thread.messages[idx]
    thread.messages = thread.messages.slice(0, idx)
    this.store.saveThreads()
    this.broadcastState()

    await this.sendChatMessage({
      threadId: thread.id,
      prompt: trimmed,
      quotedText: original.quotedText,
      imageDataUrl: original.imageAttachment,
      mentions: original.mentions || [],
      includeActiveTab: this.store.settings.includeActiveTabByDefault
    })
  }

  private resolveDefaultActionWebTab(explicitTabId?: string): TabState | undefined {
    if (explicitTabId) {
      const hit = this.tabs.find((t) => t.id === explicitTabId)
      if (hit && !isInternalDiaUrl(hit.url)) return hit
    }
    const active = this.getActiveTab()
    if (active && !isInternalDiaUrl(active.url)) return active

    // If active tab is a Chat Tab in Split View, prefer the sibling web pane!
    const sp = this.getSplitView()
    if (sp.enabled && active) {
      const siblingId = sp.leftTabId === active.id ? sp.rightTabId : sp.leftTabId
      const sibling = siblingId ? this.tabs.find((t) => t.id === siblingId) : undefined
      if (sibling && !isInternalDiaUrl(sibling.url)) return sibling
    }

    // Fallback to most recently accessed web tab in active profile
    const profileWebTabs = this.tabs
      .filter((t) => t.profileId === this.store.activeProfileId && !isInternalDiaUrl(t.url))
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
    return profileWebTabs[0]
  }

  private createHarnessExecutor(currentThreadId?: string): HarnessToolExecutor {
    return async (toolName, args) => {
      const profileId = this.store.activeProfileId
      const sp = this.getSplitView(profileId)
      const protectedChatUrl = currentThreadId ? makeChatTabUrl(currentThreadId) : null

      if (toolName === 'list_open_tabs') {
        const groupMap = new Map(this.tabGroups.map((g) => [g.id, g.title]))
        const list = this.tabs
          .filter((t) => t.profileId === profileId)
          .map((t, i) => ({
            index: i + 1,
            tabId: t.id,
            title: t.title || t.url,
            url: t.url,
            isActive: t.id === this.activeTabByProfile[profileId],
            isFavorite: Boolean(t.isFavorite),
            isPinned: Boolean(t.isPinned),
            isMuted: Boolean(t.isMuted),
            isAudioPlaying: Boolean(t.isAudioPlaying),
            canGoBack: Boolean(t.canGoBack),
            canGoForward: Boolean(t.canGoForward),
            groupTitle: t.groupId ? groupMap.get(t.groupId) || null : null,
            splitRole:
              sp.enabled && t.id === sp.leftTabId
                ? 'left'
                : sp.enabled && t.id === sp.rightTabId
                  ? 'right'
                  : null
          }))
        return {
          ok: true,
          summary: `共 ${list.length} 个标签页`,
          output: JSON.stringify(list, null, 2)
        }
      }

      if (toolName === 'read_tab_content') {
        const target = this.resolveDefaultActionWebTab(args?.tabId)
        if (!target) {
          return {
            ok: false,
            summary: '未找到网页标签',
            output: '当前没有可读取正文的网页标签页。'
          }
        }
        const ctx = await this.extractPageContext(target.id)
        if (!ctx || !ctx.content) {
          return {
            ok: false,
            summary: '正文为空',
            output: `标签页 "${target.title}" 暂未提取到正文（可尝试调用 inspect_page_elements 或 capture_page_screenshot）。`
          }
        }
        return {
          ok: true,
          summary: `${ctx.title.slice(0, 22)} (${ctx.wordCount} 字)`,
          output: `标题: ${ctx.title}\nURL: ${ctx.url}\n大纲: ${ctx.headings.join(' / ')}\n\n正文:\n${ctx.content}`,
          newReferencedUrl: { title: ctx.title, url: ctx.url }
        }
      }

      if (toolName === 'inspect_page_elements') {
        const target = this.resolveDefaultActionWebTab(args?.tabId)
        if (!target) {
          return {
            ok: false,
            summary: '无活动网页',
            output: '未检测到可扫描交互节点的外部网页标签。'
          }
        }
        const view = this.ensureViewForTab(target, true)
        await waitForWebContentsSettle(view.webContents, 2600, 60)
        const res = await inspectPageInteractiveElements({
          url: target.url,
          webContents: view.webContents,
          sensitiveGuardEnabled: this.store.settings.sensitiveSiteGuard,
          filter: typeof args?.filter === 'string' ? args.filter : undefined,
          scope: args?.scope === 'full' ? 'full' : 'viewport'
        })
        return {
          ok: res.ok,
          summary: res.ok ? `发现 ${res.count} 个可交互节点` : '扫描受限',
          output: res.snapshot,
          newReferencedUrl: res.ok ? { title: target.title, url: target.url } : undefined
        }
      }

      if (toolName === 'extract_page_data') {
        const target = this.resolveDefaultActionWebTab(args?.tabId)
        if (!target) {
          return {
            ok: false,
            summary: '无目标网页',
            output: '未检测到可提取数据的外部网页标签。'
          }
        }
        const view = this.ensureViewForTab(target, true)
        const validModes = ['links', 'tables', 'forms', 'selector'] as const
        const mode = validModes.includes(args?.mode) ? args.mode : 'links'
        const res = await extractStructuredPageData({
          url: target.url,
          webContents: view.webContents,
          sensitiveGuardEnabled: this.store.settings.sensitiveSiteGuard,
          mode,
          selector: typeof args?.selector === 'string' ? args.selector : undefined,
          filter: typeof args?.filter === 'string' ? args.filter : undefined
        })
        return {
          ok: res.ok,
          summary: res.summary,
          output: res.output,
          newReferencedUrl: res.ok ? { title: target.title, url: target.url } : undefined
        }
      }

      if (toolName === 'capture_page_screenshot') {
        const target = this.resolveDefaultActionWebTab(args?.tabId)
        if (!target) {
          return {
            ok: false,
            summary: '无活动网页',
            output: '当前没有可截图的外部网页标签页。'
          }
        }
        const shot = await this.captureActiveTabScreenshot(target.id)
        if (!shot.ok || !shot.dataUrl) {
          return {
            ok: false,
            summary: '截图受限或失败',
            output: shot.error || '未能捕获网页画面（可能处于隐藏状态或敏感站点保护中）。'
          }
        }
        return {
          ok: true,
          summary: `已截取 “${(shot.title || target.title).slice(0, 18)}”`,
          output: `已成功截取网页实时视觉画面（标题: "${shot.title || target.title}", URL: ${target.url}）。图像已随附至多模态视觉上下文，请直接结合画面布局与细节进行判断。`,
          imageDataUrl: shot.dataUrl,
          newReferencedUrl: { title: target.title, url: target.url }
        }
      }

      if (toolName === 'read_browser_console') {
        const target = this.resolveDefaultActionWebTab(args?.tabId)
        if (!target) {
          return {
            ok: false,
            summary: '无活动网页',
            output: '当前没有打开可检查 Console 的网页标签页。'
          }
        }
        if (this.store.settings.sensitiveSiteGuard && target.isSensitive) {
          return {
            ok: false,
            summary: '敏感站点已拦截',
            output: '隐私护栏保护中：禁止读取敏感站点的控制台日志。'
          }
        }
        const logs = this.consoleLogsByTab.get(target.id) || []
        return {
          ok: true,
          summary: logs.length > 0 ? `捕获 ${logs.length} 条告警/错误` : '零报错 (Clean)',
          output:
            logs.length > 0
              ? `页面: ${target.title} (${target.url})\n最近捕获的 Console 告警/报错与网络异常 (${logs.length} 条):\n${logs.join('\n')}`
              : `页面: ${target.title} (${target.url})\n当前未捕获到任何 console.error / console.warn 或 HTTP 4xx/5xx 报错。`,
          detailPreview: logs.length > 0 ? logs.slice(-12).join('\n') : undefined,
          newReferencedUrl: { title: target.title, url: target.url }
        }
      }

      if (DIA_CODING_HARNESS_TOOLS.some((t) => t.name === toolName)) {
        const wsPath = this.store.settings.codingWorkspacePath
        if (!wsPath) {
          return {
            ok: false,
            summary: '未绑定工作区',
            output: '当前尚未绑定本地代码目录，请提示用户点击输入框上方的「📁 绑定目录」选择项目文件夹。'
          }
        }
        return await executeCodingHarnessTool(wsPath, toolName, args)
      }

      if (toolName === 'interact_with_page') {
        const target = this.resolveDefaultActionWebTab(args?.tabId)
        if (!target) {
          return {
            ok: false,
            summary: '无目标网页',
            output: '未找到可执行交互操作的网页标签。'
          }
        }
        const view = this.ensureViewForTab(target, true)
        const validActions = [
          'click',
          'double_click',
          'hover',
          'fill',
          'select',
          'check',
          'press_key',
          'scroll',
          'wait'
        ] as const
        const act = validActions.includes(args?.action) ? args.action : 'click'
        const res = await executePageInteraction({
          url: target.url,
          webContents: view.webContents,
          sensitiveGuardEnabled: this.store.settings.sensitiveSiteGuard,
          action: act,
          ref: args?.ref,
          value: args?.value,
          pressEnter: Boolean(args?.pressEnter),
          clearFirst: args?.clearFirst !== undefined ? Boolean(args.clearFirst) : true,
          checked: typeof args?.checked === 'boolean' ? args.checked : undefined,
          key: typeof args?.key === 'string' ? args.key : undefined,
          scrollDirection: args?.scrollDirection,
          waitMs: typeof args?.waitMs === 'number' ? args.waitMs : undefined
        })
        return {
          ok: res.ok,
          summary: res.summary,
          output: res.detail,
          newReferencedUrl: res.ok ? { title: target.title, url: target.url } : undefined
        }
      }

      if (toolName === 'open_or_navigate_tab') {
        const rawTargetUrl = String(args?.urlOrQuery || '').trim()
        if (!rawTargetUrl) {
          return { ok: false, summary: '缺少地址', output: 'urlOrQuery 不能为空' }
        }
        const resolved = resolveNavigationUrl(rawTargetUrl, this.store.settings.searchEngine)
        const active = this.getActiveTab()
        const rawMode = String(args?.target || '')

        // Smart UX: if user is currently inside a full-width Dia Chat Tab (without Split View),
        // default to `split-right` so the user can keep watching the AI conversation on the left
        // while Dia operates the newly opened webpage side-by-side on the right!
        const effectiveMode =
          !rawMode && active && isChatTabUrl(active.url) && !sp.enabled
            ? 'split-right'
            : rawMode || (active && isChatTabUrl(active.url) && !sp.enabled ? 'split-right' : 'new-tab')

        let openedTabId: string | undefined
        if (effectiveMode === 'split-right') {
          await this.openUrlInRightSplit(resolved)
          openedTabId = this.getSplitView().rightTabId || undefined
        } else if (effectiveMode === 'background-tab') {
          openedTabId = await this.createTab(resolved, { background: true })
        } else if (effectiveMode === 'current-tab') {
          const curWeb = this.resolveDefaultActionWebTab(args?.tabId)
          if (curWeb) {
            this.navigate(resolved, curWeb.id)
            openedTabId = curWeb.id
          } else if (active && isChatTabUrl(active.url) && !sp.enabled) {
            await this.openUrlInRightSplit(resolved)
            openedTabId = this.getSplitView().rightTabId || undefined
          } else {
            openedTabId = await this.createTab(resolved, { background: false })
          }
        } else {
          openedTabId = await this.createTab(resolved, { background: false })
        }

        const openedView = openedTabId ? this.views.get(openedTabId) : undefined
        await waitForWebContentsSettle(openedView?.webContents, 4800, 450)
        const openedTab = openedTabId ? this.tabs.find((t) => t.id === openedTabId) : undefined
        return {
          ok: true,
          summary: `已打开 ${(openedTab?.title || resolved).slice(0, 24)}`,
          output: `已在浏览器打开 (tabId=${openedTab?.id || 'unknown'}, 模式=${effectiveMode}):\n标题: ${openedTab?.title || resolved}\nURL: ${openedTab?.url || resolved}`,
          newReferencedUrl: {
            title: openedTab?.title || resolved,
            url: openedTab?.url || resolved
          }
        }
      }

      if (toolName === 'manage_tabs') {
        const action = String(args?.action || '').trim()
        const profileTabs = this.tabs.filter((t) => t.profileId === profileId)
        const matchQuery = String(args?.matchQuery || '').trim().toLowerCase()

        const resolveMatchingTabs = (): TabState[] => {
          const idSet = new Set<string>()
          if (typeof args?.tabId === 'string' && args.tabId.trim()) {
            idSet.add(args.tabId.trim())
          }
          if (Array.isArray(args?.tabIds)) {
            for (const id of args.tabIds) {
              if (typeof id === 'string' && id.trim()) idSet.add(id.trim())
            }
          }
          if (idSet.size > 0) {
            return profileTabs.filter((t) => idSet.has(t.id))
          }
          if (matchQuery) {
            return profileTabs.filter(
              (t) =>
                t.url !== protectedChatUrl &&
                (t.title.toLowerCase().includes(matchQuery) ||
                  t.url.toLowerCase().includes(matchQuery))
            )
          }
          return []
        }

        if (action === 'switch') {
          const hit =
            resolveMatchingTabs()[0] ||
            (args?.tabId ? this.tabs.find((t) => t.id === args.tabId) : undefined)
          if (!hit) {
            return { ok: false, summary: '未找到目标标签', output: '未匹配到要切换的标签页，请先调用 list_open_tabs 确认 tabId。' }
          }
          this.switchTab(hit.id)
          return {
            ok: true,
            summary: `已切换至 “${hit.title.slice(0, 20)}”`,
            output: `已将浏览器活动标签页切换至 [${hit.id}] "${hit.title}" (${hit.url})`
          }
        }

        if (action === 'close') {
          const targets = resolveMatchingTabs().filter(
            (t) => t.url !== protectedChatUrl || t.id === args?.tabId
          )
          if (targets.length === 0) {
            return { ok: false, summary: '未匹配可关闭标签', output: '未找到符合条件的待关闭标签页。' }
          }
          const closedTitles = targets.map((t) => t.title || t.url)
          for (const t of targets) {
            this.closeTab(t.id)
          }
          return {
            ok: true,
            summary: `已关闭 ${targets.length} 个标签页`,
            output: `已成功关闭 ${targets.length} 个标签页：${closedTitles.join(' · ')}`
          }
        }

        if (action === 'close_others') {
          const keep =
            (args?.tabId ? profileTabs.find((t) => t.id === args.tabId) : undefined) ||
            this.resolveDefaultActionWebTab() ||
            this.getActiveTab()
          if (!keep) {
            return { ok: false, summary: '无目标标签', output: '未找到要保留的标签页。' }
          }
          const toClose = profileTabs.filter(
            (t) =>
              t.id !== keep.id &&
              t.url !== protectedChatUrl &&
              !t.isPinned &&
              !t.isFavorite
          )
          for (const t of toClose) {
            this.closeTab(t.id)
          }
          return {
            ok: true,
            summary: `已关闭其他 ${toClose.length} 个标签`,
            output: `已保留 "${keep.title}"，并关闭其余 ${toClose.length} 个未固定标签页。`
          }
        }

        if (action === 'clear_unpinned') {
          const toClose = profileTabs.filter(
            (t) => !t.isPinned && !t.isFavorite && t.url !== protectedChatUrl && t.url !== NEW_TAB_URL
          )
          for (const t of toClose) {
            this.closeTab(t.id)
          }
          return {
            ok: true,
            summary: `已清理 ${toClose.length} 个临时标签`,
            output: `已清理当前工作空间中 ${toClose.length} 个未固定的临时网页标签。`
          }
        }

        if (action === 'reopen_closed') {
          const ok = await this.reopenClosedTab()
          return {
            ok,
            summary: ok ? '已恢复刚关闭标签' : '无最近关闭标签',
            output: ok ? '已成功恢复最近关闭的标签页。' : '最近关闭栈为空，没有可恢复的标签页。'
          }
        }

        if (action === 'duplicate') {
          const src = resolveMatchingTabs()[0] || this.resolveDefaultActionWebTab()
          if (!src) {
            return { ok: false, summary: '无目标标签', output: '未找到要复制的标签页。' }
          }
          const dupId = await this.duplicateTab(src.id)
          return {
            ok: Boolean(dupId),
            summary: `已复制 “${src.title.slice(0, 18)}”`,
            output: `已复制标签页 "${src.title}"，新标签 ID: ${dupId}`
          }
        }

        if (action === 'pin' || action === 'unpin' || action === 'favorite') {
          const targets = resolveMatchingTabs()
          const finalTargets = targets.length > 0 ? targets : [this.resolveDefaultActionWebTab()].filter(Boolean) as TabState[]
          if (finalTargets.length === 0) {
            return { ok: false, summary: '无目标标签', output: '未找到要修改固定状态的标签页。' }
          }
          const mode: TabPinMode =
            action === 'favorite' ? 'favorite' : action === 'pin' ? 'pinned' : 'unpinned'
          for (const t of finalTargets) {
            this.setTabPinState(t.id, mode)
          }
          const modeName = mode === 'favorite' ? '常驻大图标' : mode === 'pinned' ? '空间固定标签' : '普通临时标签'
          return {
            ok: true,
            summary: `已设为${modeName} (${finalTargets.length})`,
            output: `已将 ${finalTargets.map((t) => `"${t.title}"`).join('、')} 设为${modeName}。`
          }
        }

        if (action === 'mute') {
          const target = resolveMatchingTabs()[0] || this.resolveDefaultActionWebTab()
          if (!target) {
            return { ok: false, summary: '无目标标签', output: '未找到要静音切换的标签页。' }
          }
          this.toggleMuteTab(target.id)
          return {
            ok: true,
            summary: target.isMuted ? '已开启静音' : '已取消静音',
            output: `标签页 "${target.title}" 当前静音状态: ${target.isMuted ? '已静音' : '正常播放'}`
          }
        }

        if (action === 'group') {
          const targets = resolveMatchingTabs().filter((t) => !t.isFavorite)
          if (targets.length === 0) {
            return {
              ok: false,
              summary: '未指定分组标签',
              output: '创建分组时请通过 tabIds 或 matchQuery 指定至少 1 个非 Favorite 标签页。'
            }
          }
          const validColors: TabGroupColor[] = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet']
          const color: TabGroupColor = validColors.includes(args?.groupColor) ? args.groupColor : 'indigo'
          const grp = this.createTabGroup(
            String(args?.groupTitle || '✨ AI 分组'),
            color,
            targets.map((t) => t.id)
          )
          return {
            ok: true,
            summary: `已建组 “${grp.title}” (${targets.length})`,
            output: `已创建彩色分组 "${grp.title}" (${grp.color})，包含 ${targets.length} 个标签页。`
          }
        }

        if (action === 'organize_ai') {
          const orgRes = await this.organizeTabsByAI()
          if (!orgRes.ok) {
            return { ok: false, summary: '分组条件不足', output: orgRes.error || '标签数量不足以智能分组' }
          }
          const curGroups = this.tabGroups.filter((g) => g.profileId === profileId)
          return {
            ok: true,
            summary: `已智能分为 ${orgRes.groupCount} 组`,
            output: `已完成 AI 智能标签聚类，共 ${orgRes.groupCount} 个分组：${curGroups.map((g) => g.title).join(' · ')}`
          }
        }

        return { ok: false, summary: '未知标签动作', output: `不支持的 manage_tabs action: ${action}` }
      }

      if (toolName === 'control_browser_view') {
        const action = String(args?.action || '').trim()
        const target = this.resolveDefaultActionWebTab(args?.tabId)

        if (action === 'go_back') {
          const ok = this.goBack(target?.id)
          if (ok && target) {
            await waitForWebContentsSettle(this.views.get(target.id)?.webContents, 3500, 300)
          }
          return {
            ok,
            summary: ok ? '已返回上一页' : '无法后退',
            output: ok
              ? `页面已后退，当前地址: ${target?.url || ''}`
              : '目标标签页没有可后退的浏览历史记录。'
          }
        }

        if (action === 'go_forward') {
          const ok = this.goForward(target?.id)
          if (ok && target) {
            await waitForWebContentsSettle(this.views.get(target.id)?.webContents, 3500, 300)
          }
          return {
            ok,
            summary: ok ? '已前进一页' : '无法前进',
            output: ok
              ? `页面已前进，当前地址: ${target?.url || ''}`
              : '目标标签页没有可前进的历史记录。'
          }
        }

        if (action === 'reload') {
          const ok = this.reload(target?.id)
          if (ok && target) {
            await waitForWebContentsSettle(this.views.get(target.id)?.webContents, 4200, 350)
          }
          return {
            ok,
            summary: ok ? '已刷新页面' : '无法刷新',
            output: ok ? `已重新加载页面 "${target?.title}" (${target?.url})` : '当前没有可刷新的网页标签。'
          }
        }

        if (action === 'open_split') {
          await this.openSplitView(args?.tabId)
          const curSp = this.getSplitView(profileId)
          return {
            ok: true,
            summary: '已开启左右并排分屏',
            output: `已开启左右分屏视图 (leftTabId=${curSp.leftTabId}, rightTabId=${curSp.rightTabId})。`
          }
        }

        if (action === 'close_split') {
          const keepSide: SplitPaneSide | undefined =
            args?.keepSide === 'left' || args?.keepSide === 'right' ? args.keepSide : undefined
          this.closeSplitView(keepSide)
          return {
            ok: true,
            summary: '已关闭分屏视图',
            output: '已退出左右并排分屏，恢复单画面浏览。'
          }
        }

        if (action === 'swap_split') {
          this.swapSplitPanes()
          return {
            ok: true,
            summary: '已交换左右分屏',
            output: '已对调左右两侧并排分屏网页的位置。'
          }
        }

        if (action === 'zoom_in' || action === 'zoom_out' || action === 'zoom_reset') {
          const zoomAct = action === 'zoom_in' ? 'in' : action === 'zoom_out' ? 'out' : 'reset'
          const factor = this.setPageZoom(zoomAct, target?.id)
          const pct = Math.round(factor * 100)
          return {
            ok: true,
            summary: `网页缩放 ${pct}%`,
            output: `已将页面缩放比例调整为 ${pct}%。`
          }
        }

        if (action === 'find_in_page') {
          const text = String(args?.findText || '').trim()
          if (!text) {
            return { ok: false, summary: '缺少查找词', output: 'findText 不能为空' }
          }
          this.findInPage(text, true, target?.id)
          return {
            ok: true,
            summary: `已高亮查找 “${text.slice(0, 18)}”`,
            output: `已在页面中高亮查找关键词 "${text}"。`
          }
        }

        if (action === 'clear_find') {
          this.stopFindInPage(target?.id)
          return {
            ok: true,
            summary: '已清除查找高亮',
            output: '已清除页面内的关键词查找高亮。'
          }
        }

        return { ok: false, summary: '未知视图动作', output: `不支持的 control_browser_view action: ${action}` }
      }

      if (toolName === 'manage_bookmarks') {
        const action = String(args?.action || 'list').trim()
        const profileBms = this.store.bookmarks.filter((b) => b.profileId === profileId)

        if (action === 'list') {
          const q = String(args?.query || '').trim().toLowerCase()
          const filtered = q
            ? profileBms.filter(
                (b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
              )
            : profileBms
          return {
            ok: true,
            summary: `共 ${filtered.length} 条书签`,
            output:
              filtered.length > 0
                ? filtered
                    .slice(0, 40)
                    .map((b, i) => `${i + 1}. [${b.title}](${b.url}) (id=${b.id})`)
                    .join('\n')
                : '当前空间收藏夹暂无匹配的书签。'
          }
        }

        if (action === 'add') {
          const targetTab = args?.tabId
            ? this.tabs.find((t) => t.id === args.tabId)
            : !args?.url
              ? this.resolveDefaultActionWebTab()
              : undefined
          const targetUrl = String(args?.url || targetTab?.url || '').trim()
          const targetTitle = String(args?.title || targetTab?.title || targetUrl).trim()
          if (!targetUrl || isInternalDiaUrl(targetUrl)) {
            return { ok: false, summary: '无有效网址', output: '没有可加入收藏夹的有效外部网页地址。' }
          }
          const already = profileBms.find((b) => b.url === targetUrl)
          if (already) {
            return {
              ok: true,
              summary: '已在收藏夹中',
              output: `网页 "${already.title}" (${already.url}) 已经在收藏夹中。`
            }
          }
          this.toggleBookmark(targetUrl, targetTitle, targetTab?.favicon)
          return {
            ok: true,
            summary: `已收藏 “${targetTitle.slice(0, 18)}”`,
            output: `已成功将 "${targetTitle}" (${targetUrl}) 加入浏览器收藏夹。`
          }
        }

        if (action === 'remove') {
          const rawUrl = String(args?.url || '').trim()
          const q = String(args?.query || '').trim().toLowerCase()
          const hit = profileBms.find(
            (b) =>
              (rawUrl && b.url === rawUrl) ||
              (q && (b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)))
          )
          if (!hit) {
            return { ok: false, summary: '未找到书签', output: '收藏夹中未找到匹配的书签条目。' }
          }
          this.removeBookmark(hit.id)
          return {
            ok: true,
            summary: `已移除书签 “${hit.title.slice(0, 16)}”`,
            output: `已从收藏夹移除 "${hit.title}" (${hit.url})。`
          }
        }

        return { ok: false, summary: '未知书签动作', output: `不支持的 manage_bookmarks action: ${action}` }
      }

      if (toolName === 'search_browsing_history') {
        const query = String(args?.query || '').trim()
        const profileHist = this.store.history.filter((h) => h.profileId === profileId)
        const ranked = rankRelevantHistory(profileHist, query, 15)
        if (ranked.length === 0) {
          return { ok: true, summary: '暂无匹配历史', output: '浏览历史中未找到相关记录。' }
        }
        const lines = ranked.map(
          (h, idx) =>
            `${idx + 1}. [${h.title}](${h.url}) — 访问 ${h.visitCount} 次，最近: ${new Date(h.visitedAt).toLocaleString()}`
        )
        return {
          ok: true,
          summary: `命中 ${ranked.length} 条历史记录`,
          output: lines.join('\n')
        }
      }

      if (toolName === 'save_user_memory') {
        const content = String(args?.content || '').trim()
        if (!content) {
          return { ok: false, summary: '内容为空', output: '记忆内容不能为空' }
        }
        const validCats = ['preference', 'project', 'tone', 'fact'] as const
        const cat = validCats.includes(args?.category) ? args.category : 'preference'
        const saved = this.addMemory(content, cat, 'Agent 自动记忆')
        return {
          ok: true,
          summary: '已存入记忆库',
          output: `已成功写入长期记忆 [${saved.category}]: ${saved.content}`
        }
      }

      if (toolName === 'read_connected_tool') {
        const toolId = String(args?.toolId || '').trim() as ConnectedToolId
        const query = typeof args?.query === 'string' ? args.query.trim() : ''
        const profile =
          this.store.profiles.find((p) => p.id === profileId) || this.store.profiles[0]
        const ses = this.ensureSessionConfigured(profile.partition)
        const profileTabs = this.tabs.filter(
          (t) => t.profileId === profileId && !isInternalDiaUrl(t.url)
        )
        const profileHist = this.store.history.filter((h) => h.profileId === profileId)
        const res = await fetchConnectedToolContext({
          toolId,
          query,
          partition: profile.partition,
          userAgent: ses.getUserAgent(),
          settings: this.store.settings,
          openTabs: profileTabs,
          profileHistory: profileHist,
          extractOpenTab: async (tid) => {
            const ctx = await this.extractPageContext(tid)
            if (!ctx || !ctx.content) return null
            return { title: ctx.title, url: ctx.url, content: ctx.content }
          }
        })
        return {
          ok: res.ok,
          summary: res.summary,
          output: res.content,
          newReferencedUrl: res.ok && res.url ? { title: res.title, url: res.url } : undefined
        }
      }

      return { ok: false, summary: '未知工具', output: `未知工具: ${toolName}` }
    }
  }

  public async sendChatMessage(params: {
    threadId: string
    prompt: string
    quotedText?: string
    imageDataUrl?: string
    enableAgentTools?: boolean
    mentions: ChatMention[]
    includeActiveTab: boolean
    providerId?: string
    modelId?: string
  }): Promise<void> {
    const { threadId, mentions, includeActiveTab, quotedText, imageDataUrl } = params
    let rawPrompt = params.prompt.trim()
    if (!rawPrompt && !quotedText && !imageDataUrl) return
    if (!rawPrompt && quotedText) {
      rawPrompt = '请解读这段引用内容：'
    } else if (!rawPrompt && imageDataUrl) {
      rawPrompt = '请结合这张网页视觉截图深入分析其核心内容与关键细节：'
    }

    let thread = this.store.threads.find((th) => th.id === threadId)
    if (!thread) {
      thread = await this.createThread()
    }

    const lang = this.store.settings.language
    const allSkills = getAllSlashSkills(this.store.settings.customSkills, lang)
    const lowerPrompt = rawPrompt.toLowerCase()

    // Quick /remember command for Arko Memory
    if (lowerPrompt.startsWith('/remember ') || rawPrompt.startsWith('记住：') || rawPrompt.startsWith('记住:')) {
      const memText = rawPrompt.replace(/^(\/remember\s+|记住[：:]\s*)/i, '').trim()
      if (memText) {
        const mem = this.addMemory(memText, 'preference', tr(lang, 'Chat Command', '对话指令'))
        const uMsg: ChatMessage = {
          id: `msg-u-${Date.now()}`,
          role: 'user',
          content: rawPrompt,
          createdAt: Date.now()
        }
        const aMsg: ChatMessage = {
          id: `msg-a-${Date.now() + 1}`,
          role: 'assistant',
          content: tr(
            lang,
            `### 📌 Saved to Arko Memory\n\n> ${mem.content}\n\nArko will automatically incorporate this preference across sidebar chats, Chat Tabs, and \`⌘J\` Inline Write. Manage anytime in **Settings → Personal Memory**.`,
            `### 📌 已存入 Arko 长期记忆\n\n> ${mem.content}\n\n今后无论是侧边栏提问、对话标签页还是 \`⌘J\` 网页内联帮写，Arko 都会自动结合这条偏好为你定制回答。可在 **设置 → 个人记忆库** 中随时管理。`
          ),
          createdAt: Date.now() + 1,
          modelId: 'Arko Memory Engine'
        }
        if (thread.messages.length === 0) {
          thread.title = `📌 ${memText.slice(0, 24)}`
          this.syncChatTabTitles(thread)
        }
        thread.messages.push(uMsg, aMsg)
        thread.updatedAt = Date.now()
        this.store.saveThreads()
        this.broadcastState()
        return
      }
    }

    const matchedSkill = allSkills.find((s) => {
      const cmd = s.command.toLowerCase()
      return lowerPrompt === cmd || lowerPrompt.startsWith(`${cmd} `)
    })

    // Handle /organize AI Tab Grouping skill
    if (matchedSkill && matchedSkill.executionKind === 'organize-tabs') {
      const uMsg: ChatMessage = {
        id: `msg-u-${Date.now()}`,
        role: 'user',
        content: rawPrompt,
        createdAt: Date.now()
      }
      if (thread.messages.length === 0) {
        thread.title = tr(lang, '🗂️ Organize Tab Groups', '🗂️ 智能整理标签分组')
        this.syncChatTabTitles(thread)
      }
      thread.messages.push(uMsg)
      thread.updatedAt = Date.now()
      this.store.saveThreads()
      this.broadcastState()

      const orgRes = await this.organizeTabsByAI()
      const profileGroups = this.tabGroups.filter((g) => g.profileId === this.store.activeProfileId)
      const summaryMd = orgRes.ok
        ? [
            tr(
              lang,
              `### 🗂️ Organized Open Tabs into ${orgRes.groupCount} Topic Groups`,
              `### 🗂️ 已将打开的标签页整理为 ${orgRes.groupCount} 个主题分组`
            ),
            '',
            ...profileGroups.map((g) => {
              const gTabs = this.tabs.filter((t) => t.groupId === g.id)
              return tr(
                lang,
                `- **${g.title}** (${gTabs.length} tabs): ${gTabs.map((t) => `\`${(t.title || t.url).slice(0, 26)}\``).join(' · ')}`,
                `- **${g.title}**（${gTabs.length} 个标签页）：${gTabs.map((t) => `\`${(t.title || t.url).slice(0, 24)}\``).join(' · ')}`
              )
            }),
            '',
            tr(
              lang,
              'Click any colored group pill in the sidebar or top bar to collapse/expand its tabs.',
              '你可以点击顶栏或侧边栏的彩色分组胶囊一键折叠/展开对应任务上下文。'
            )
          ].join('\n')
        : ''

      thread.messages.push({
        id: `msg-a-${Date.now() + 1}`,
        role: 'assistant',
        content: summaryMd,
        error: orgRes.ok ? undefined : orgRes.error,
        createdAt: Date.now() + 1,
        modelId: 'Arko Tab Organizer'
      })
      thread.updatedAt = Date.now()
      this.store.saveThreads()
      this.broadcastState()
      return
    }

    // 1) Zero-LLM Local Export Skill (/markdown or /screenshot)
    if (
      matchedSkill &&
      (matchedSkill.executionKind === 'local-markdown' ||
        matchedSkill.executionKind === 'local-screenshot')
    ) {
      const userMsg: ChatMessage = {
        id: `msg-u-${Date.now()}`,
        role: 'user',
        content: rawPrompt,
        mentions,
        createdAt: Date.now()
      }
      if (thread.messages.length === 0) {
        thread.title = `${matchedSkill.icon} ${matchedSkill.label}`
        this.syncChatTabTitles(thread)
      }
      thread.messages.push(userMsg)
      thread.updatedAt = Date.now()
      this.store.saveThreads()
      this.broadcastState()

      // If current active tab is a Chat Tab in Split View, target the sibling web pane!
      let targetTabId: string | undefined
      const active = this.getActiveTab()
      const sp = this.getSplitView()
      if (active && isInternalDiaUrl(active.url) && sp.enabled) {
        const siblingId = sp.leftTabId === active.id ? sp.rightTabId : sp.leftTabId
        if (siblingId) targetTabId = siblingId
      }

      const res = await this.executeLocalSkill(rawPrompt, targetTabId)
      const assistantMsg: ChatMessage = {
        id: `msg-a-${Date.now() + 1}`,
        role: 'assistant',
        createdAt: Date.now() + 1,
        modelId: tr(lang, 'Arko Local Engine (Zero-Token)', 'Arko Local Engine (零 Token 本地执行)'),
        content: res.ok
          ? res.kind === 'local-markdown'
            ? tr(
                lang,
                `### 📄 Clean Markdown Extracted\n- **Title**: ${res.title}\n- **Length**: ~${res.markdownLength?.toLocaleString() || 0} chars\n- **Clipboard**: Copied automatically (\`⌘V\` to paste)\n- **Saved File**: ${res.savedPath ? `\`${res.savedPath}\`` : 'Clipboard only'}`,
                `### 📄 已提取干净 Markdown\n- **页面标题**：${res.title}\n- **字符规模**：约 ${res.markdownLength?.toLocaleString() || 0} 字符\n- **剪贴板**：已自动复制到系统剪贴板（可直接 \`⌘V\` 粘贴）\n- **本地文件**：${res.savedPath ? `\`${res.savedPath}\`` : '未另存为文件（仅复制到剪贴板）'}`
              )
            : tr(
                lang,
                `### 📸 ${res.fullPage ? 'Full-Page' : 'Viewport HD'} Screenshot Captured\n- **Title**: ${res.title}\n- **Dimensions**: \`${res.width} × ${res.height} px\`\n- **Clipboard**: Copied HD PNG to clipboard (\`⌘V\` to paste)\n- **Saved File**: ${res.savedPath ? `\`${res.savedPath}\`` : 'Clipboard only'}`,
                `### 📸 已完成${res.fullPage ? '全网页长图' : '可视区高清'}截图\n- **页面标题**：${res.title}\n- **图像尺寸**：\`${res.width} × ${res.height} px\`\n- **剪贴板**：已复制高清原图到系统剪贴板（可直接 \`⌘V\` 粘贴）\n- **本地文件**：${res.savedPath ? `\`${res.savedPath}\`` : '未另存为文件（仅复制到剪贴板）'}`
              )
          : '',
        error: res.ok ? undefined : res.error,
        localAction: res.ok
          ? {
              kind: res.kind,
              savedPath: res.savedPath,
              imageDataUrl: res.imageDataUrl,
              copiedToClipboard: res.copiedToClipboard
            }
          : undefined
      }

      thread.messages.push(assistantMsg)
      thread.updatedAt = Date.now()
      this.store.saveThreads()
      this.broadcastState()
      return
    }

    // 2) Expand AI Slash Skill
    let skillScope: 'active' | 'all-tabs' | 'none' | undefined
    if (matchedSkill) {
      const extraUserNote = rawPrompt.slice(matchedSkill.command.length).trim()
      if (matchedSkill.promptTemplate.includes('{{input}}')) {
        rawPrompt = matchedSkill.promptTemplate
          .split('{{input}}')
          .join(extraUserNote || '（无额外补充说明）')
      } else {
        rawPrompt = extraUserNote
          ? `${matchedSkill.promptTemplate}\n\n补充要求：${extraUserNote}`
          : matchedSkill.promptTemplate
      }
      skillScope =
        matchedSkill.contextScope || (matchedSkill.includeAllTabs ? 'all-tabs' : 'active')
    }

    if (quotedText?.trim()) {
      rawPrompt = `${rawPrompt}\n\n用户在网页上引用的目标段落：\n"""\n${quotedText.trim()}\n"""`
    }

    const settings = this.store.settings
    const providerId = params.providerId || settings.activeProviderId
    const provider =
      settings.providers.find((p) => p.id === providerId) || settings.providers[0]
    const modelId =
      params.modelId || settings.activeModelId || provider.defaultModelId || provider.models[0]?.id

    const profileWebTabs = this.tabs.filter(
      (t) => t.profileId === this.store.activeProfileId && !isInternalDiaUrl(t.url)
    )
    const targetTabIds = new Set<string>()
    const mentionedToolIds = new Set<ConnectedToolId>()
    const splitPaneRoleByTab = new Map<string, SplitPaneSide>()
    let includeHistory = false

    for (const m of mentions) {
      if (m.type === 'all-tabs') {
        profileWebTabs.slice(0, 8).forEach((t) => targetTabIds.add(t.id))
      } else if (m.type === 'history') {
        includeHistory = true
      } else if (m.type === 'tab' && m.tabId) {
        targetTabIds.add(m.tabId)
      } else if (m.type === 'tool' && m.toolId) {
        mentionedToolIds.add(m.toolId)
      }
    }

    if (skillScope === 'all-tabs') {
      profileWebTabs.slice(0, 8).forEach((t) => targetTabIds.add(t.id))
    }

    const sp = this.getSplitView()
    if (sp.enabled && sp.leftTabId && sp.rightTabId) {
      splitPaneRoleByTab.set(sp.leftTabId, 'left')
      splitPaneRoleByTab.set(sp.rightTabId, 'right')
    }

    const shouldAutoIncludeActive =
      skillScope === 'none' ? false : includeActiveTab || skillScope === 'active'

    if (shouldAutoIncludeActive && targetTabIds.size === 0) {
      if (sp.enabled && sp.leftTabId && sp.rightTabId) {
        const lt = this.tabs.find((t) => t.id === sp.leftTabId)
        const rt = this.tabs.find((t) => t.id === sp.rightTabId)
        if (lt && !isInternalDiaUrl(lt.url)) targetTabIds.add(lt.id)
        if (rt && !isInternalDiaUrl(rt.url)) targetTabIds.add(rt.id)
      } else {
        const activeTab = this.getActiveTab()
        if (activeTab && !isInternalDiaUrl(activeTab.url)) {
          targetTabIds.add(activeTab.id)
        }
      }
    }

    const cappedTabIds = Array.from(targetTabIds).slice(0, 8)
    const activeProfileObj =
      this.store.profiles.find((p) => p.id === this.store.activeProfileId) ||
      this.store.profiles[0]
    const activeSes = this.ensureSessionConfigured(activeProfileObj.partition)
    const profileAllHist = this.store.history.filter(
      (h) => h.profileId === this.store.activeProfileId
    )

    const [extractedContexts, latestTools, fetchedToolCtxList] = await Promise.all([
      Promise.all(
        cappedTabIds.map((id) => this.extractPageContext(id, splitPaneRoleByTab.get(id)))
      ),
      this.refreshConnectedTools(this.store.activeProfileId, false),
      Promise.all(
        Array.from(mentionedToolIds)
          .slice(0, 4)
          .map(async (tid) => {
            const res = await fetchConnectedToolContext({
              toolId: tid,
              partition: activeProfileObj.partition,
              userAgent: activeSes.getUserAgent(),
              settings: this.store.settings,
              openTabs: profileWebTabs,
              profileHistory: profileAllHist,
              extractOpenTab: async (openTabId) => {
                const ctx = await this.extractPageContext(openTabId)
                if (!ctx || !ctx.content) return null
                return { title: ctx.title, url: ctx.url, content: ctx.content }
              }
            })
            return { toolId: tid, ...res }
          })
      )
    ])
    const validContexts = extractedContexts.filter(
      (ctx): ctx is PageExtractedContext => ctx !== null && !isInternalDiaUrl(ctx.url)
    )
    const connectedToolContexts = fetchedToolCtxList
      .filter((tc) => Boolean(tc.content))
      .map((tc) => ({
        toolId: tc.toolId,
        title: tc.title,
        url: tc.url,
        content: tc.content
      }))

    const referencedUrls = [
      ...validContexts.map((c) => ({
        title: c.splitPaneRole
          ? `${c.splitPaneRole === 'left' ? '左屏' : '右屏'} · ${c.title}`
          : c.title,
        url: c.url
      })),
      ...fetchedToolCtxList
        .filter((tc) => tc.ok && tc.url)
        .map((tc) => ({ title: tc.title, url: tc.url }))
    ]

    const userMsg: ChatMessage = {
      id: `msg-u-${Date.now()}`,
      role: 'user',
      content:
        params.prompt.trim() ||
        (quotedText ? '解读选中段落' : '解读当前网页视觉画面'),
      quotedText: quotedText?.trim() || undefined,
      imageAttachment: imageDataUrl || undefined,
      mentions,
      createdAt: Date.now()
    }
    const assistantMsgId = `msg-a-${Date.now() + 1}`
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      reasoning: '',
      referencedUrls,
      createdAt: Date.now() + 1,
      modelId,
      isStreaming: true
    }

    if (thread.messages.length === 0) {
      thread.title = (
        params.prompt.trim() ||
        quotedText?.trim() ||
        '网页视觉分析'
      ).slice(0, 36)
      this.syncChatTabTitles(thread)
    }
    thread.messages.push(userMsg, assistantMsg)
    thread.updatedAt = Date.now()
    this.store.saveThreads()
    this.broadcastState()

    const historyForApi: ChatMessage[] = thread.messages.slice(0, -1).map((m, idx, arr) => {
      if (idx === arr.length - 1) {
        return { ...m, content: rawPrompt }
      }
      if (m.role === 'user' && m.quotedText) {
        return { ...m, content: `${m.content}\n\n引用片段：\n"""\n${m.quotedText}\n"""` }
      }
      return m
    })

    const profileHistory = includeHistory
      ? this.store.history.filter((h) => h.profileId === this.store.activeProfileId)
      : undefined

    const activeMemories = settings.memoryEnabled ? this.store.memories : undefined
    const agentToolsEnabled =
      params.enableAgentTools !== undefined
        ? params.enableAgentTools
        : settings.agentModeEnabled !== false

    const activeWorkspace =
      agentToolsEnabled && settings.codingWorkspacePath?.trim()
        ? settings.codingWorkspacePath.trim()
        : null
    const workspaceRules = activeWorkspace
      ? loadWorkspaceAgentInstructions(activeWorkspace)
      : ''

    const combinedTools = agentToolsEnabled
      ? activeWorkspace
        ? [...DIA_BROWSER_HARNESS_TOOLS, ...DIA_CODING_HARNESS_TOOLS]
        : DIA_BROWSER_HARNESS_TOOLS
      : undefined

    const systemPrompt = this.aiService.buildSystemPrompt({
      personalizationPrompt: settings.personalizationPrompt,
      contexts: validContexts,
      connectedTools: latestTools,
      connectedToolContexts,
      historySnippet: profileHistory,
      memories: activeMemories,
      queryForHistory: params.prompt,
      agentToolsEnabled,
      codingWorkspacePath: activeWorkspace,
      workspaceAgentRules: workspaceRules
    })

    const sendStreamEvent = (payload: StreamChunkPayload): void => {
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('arko:chat-stream-chunk', payload)
      }
    }

    const result = await this.aiService.streamChat({
      threadId: thread.id,
      messageId: assistantMsgId,
      provider,
      modelId,
      systemPrompt,
      historyMessages: historyForApi,
      referencedUrls,
      tools: combinedTools,
      toolExecutor: agentToolsEnabled ? this.createHarnessExecutor(thread.id) : undefined,
      maxSteps: activeWorkspace ? 20 : 15,
      onChunk: sendStreamEvent
    })

    assistantMsg.content = result.content
    assistantMsg.reasoning = result.reasoning || undefined
    assistantMsg.toolSteps = result.toolSteps
    assistantMsg.referencedUrls = result.referencedUrls
    assistantMsg.followUps = result.followUps
    assistantMsg.error = result.error
    assistantMsg.isStreaming = false
    thread.updatedAt = Date.now()
    this.store.saveThreads()
    this.broadcastState()
  }
}
