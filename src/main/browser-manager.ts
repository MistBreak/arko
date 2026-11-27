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
  DEFAULT_PROFILES,
  getAllSlashSkills,
  getChatThreadIdFromUrl,
  GITHUB_REPO_URL,
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
  BrowserImportProgressPayload,
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
  ImportProgressStage,
  InlineEditableTargetInfo,
  InlineWriteActionPreset,
  InlineWriteStreamPayload,
  InstalledExtensionItem,
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
  parseBrowserDataForImport,
  querySqliteSafely
} from './browser-importer'
import { ExtensionEcosystemManager } from './extension-manager'
import {
  copyChromiumSiteStorageToPartition,
  migrateChromiumCookiesToSession,
  type CookieKeyDerivationResult
} from './session-migrator'
import {
  CONNECTED_TOOL_SPECS,
  computeEffectiveToolStatus,
  fetchConnectedToolContext,
  getConnectedToolSpec,
  inspectConnectedToolsForPartition
} from './connected-tools'

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0]
const MAX_LIVE_WEB_VIEWS = 12
const IDLE_VIEW_HIBERNATE_MS = 25 * 60 * 1000
const IDLE_VIEW_SWEEP_INTERVAL_MS = 2 * 60 * 1000

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

const FAVICON_PRELOAD_CONCURRENCY = 4
const FAVICON_FAIL_COOLDOWN_MS = 10 * 60 * 1000
const SSO_REDIRECT_HOST_RE =
  /^(?:accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com|[^.]+\.auth0\.com|[^.]+\.okta\.com|[^.]+\.oktapreview\.com)$/i
const SHARED_HOSTING_SUFFIXES = new Set([
  'github.io',
  'gitlab.io',
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'workers.dev',
  'web.app',
  'firebaseapp.com',
  'herokuapp.com',
  'onrender.com',
  'fly.dev',
  'railway.app'
])
const MULTI_PART_TLDS = new Set([
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'co.uk',
  'org.uk',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.hk',
  'com.tw',
  'com.sg',
  'com.au',
  'com.br',
  'co.kr',
  'co.in'
])

function isPrivateOrLocalHost(host: string): boolean {
  const lower = host.toLowerCase().trim()
  if (!lower || lower === 'localhost' || !lower.includes('.')) return true
  if (lower.startsWith('[') || lower.includes(':')) return true
  if (/\.(?:local|lan|internal|intranet|corp|home|test|invalid|localhost)$/i.test(lower)) {
    return true
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(lower)) {
    return true
  }
  return false
}

function getRegistrableRootDomain(host: string): string | null {
  const lower = host.toLowerCase().trim().replace(/\.+$/, '')
  if (isPrivateOrLocalHost(lower)) return null
  const parts = lower.split('.').filter(Boolean)
  if (parts.length <= 2) return null
  const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`
  if (SHARED_HOSTING_SUFFIXES.has(lastTwo)) return null
  if (MULTI_PART_TLDS.has(lastTwo)) {
    if (parts.length <= 3) return null
    return `${parts[parts.length - 3]}.${lastTwo}`
  }
  return lastTwo
}

function extractHtmlIconCandidates(html: string, baseUrl: string): string[] {
  const headEnd = html.search(/<\/head\s*>/i)
  const slice = html.slice(0, headEnd > 0 ? Math.min(headEnd + 7, 131072) : 98304)
  const linkRe = /<link\b([^>]{1,1000})>/gi
  const scored: Array<{ url: string; score: number }> = []
  let match: RegExpExecArray | null

  const getAttr = (attrs: string, name: string): string => {
    const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, 'i')
    const m = re.exec(attrs)
    return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim()
  }

  while ((match = linkRe.exec(slice)) !== null) {
    const attrs = match[1] || ''
    const rel = getAttr(attrs, 'rel').toLowerCase()
    if (!rel || !/(?:^|\s)(?:shortcut\s+icon|icon|apple-touch-icon(?:-precomposed)?|fluid-icon)(?:\s|$)/.test(rel)) {
      continue
    }
    const rawHref = getAttr(attrs, 'href')
      .replace(/&amp;/g, '&')
      .trim()
    if (!rawHref || rawHref.startsWith('javascript:')) continue

    let resolved = ''
    if (rawHref.startsWith('data:image/')) {
      resolved = rawHref
    } else {
      try {
        const u = new URL(rawHref, baseUrl)
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          resolved = u.toString()
        }
      } catch {
        // ignore malformed href
      }
    }
    if (!resolved) continue

    const sizes = getAttr(attrs, 'sizes').toLowerCase()
    const type = getAttr(attrs, 'type').toLowerCase()
    let score = 50
    if (type.includes('svg') || /\.svg(?:$|\?)/i.test(resolved)) {
      score += 38
    } else if (type.includes('png') || /\.png(?:$|\?)/i.test(resolved)) {
      score += 30
    } else if (type.includes('webp') || /\.webp(?:$|\?)/i.test(resolved)) {
      score += 26
    } else if (/\.ico(?:$|\?)/i.test(resolved)) {
      score += 12
    }
    if (rel.includes('apple-touch-icon')) {
      score += 18
    }
    const sizeMatch = /(\d+)\s*x\s*(\d+)/.exec(sizes)
    if (sizeMatch) {
      const w = Number(sizeMatch[1])
      if (w >= 32 && w <= 192) score += 28
      else if (w > 192 && w <= 512) score += 16
      else if (w >= 16) score += 8
    } else if (sizes === 'any') {
      score += 24
    }
    scored.push({ url: resolved, score })
  }

  scored.sort((a, b) => b.score - a.score)
  const unique: string[] = []
  const seen = new Set<string>()
  for (const item of scored) {
    if (!seen.has(item.url)) {
      seen.add(item.url)
      unique.push(item.url)
      if (unique.length >= 5) break
    }
  }
  return unique
}

function normalizeIconBufferToDataUrl(buf: Buffer, mimeHint?: string): string | null {
  if (!buf || buf.byteLength === 0 || buf.byteLength > 524288) return null
  const headUtf8 = buf.subarray(0, Math.min(320, buf.byteLength)).toString('utf-8').trimStart()
  const lowerHead = headUtf8.toLowerCase()
  if (
    lowerHead.startsWith('<!doctype html') ||
    lowerHead.startsWith('<html') ||
    lowerHead.startsWith('<head') ||
    lowerHead.startsWith('<body') ||
    lowerHead.startsWith('{')
  ) {
    return null
  }

  const isSvg =
    Boolean(mimeHint && mimeHint.includes('svg')) ||
    lowerHead.startsWith('<svg') ||
    (lowerHead.startsWith('<?xml') && lowerHead.includes('<svg'))
  if (isSvg) {
    if (buf.byteLength > 98304) return null
    const fullSvg = buf.toString('utf-8')
    if (!/<svg[\s>]/i.test(fullSvg) || /<script[\s>]/i.test(fullSvg)) return null
    return `data:image/svg+xml;base64,${buf.toString('base64')}`
  }

  try {
    const img = nativeImage.createFromBuffer(buf)
    if (!img.isEmpty()) {
      const sz = img.getSize()
      if (sz.width > 0 && sz.height > 0) {
        const targetImg =
          sz.width > 64 || sz.height > 64
            ? img.resize({ width: 64, height: 64, quality: 'best' })
            : img
        const pngBuf = targetImg.toPNG()
        if (pngBuf.byteLength > 0 && pngBuf.byteLength <= 98304) {
          return `data:image/png;base64,${pngBuf.toString('base64')}`
        }
      }
    }
  } catch {
    // Fallback to magic-byte inspection below
  }

  // Fallback for valid multi-entry .ico or .webp files that nativeImage couldn't decode on older OS builds
  if (buf.byteLength <= 65536) {
    const hex = buf.subarray(0, 8).toString('hex').toUpperCase()
    if (hex.startsWith('00000100')) {
      return `data:image/x-icon;base64,${buf.toString('base64')}`
    }
    if (hex.startsWith('52494646')) {
      return `data:image/webp;base64,${buf.toString('base64')}`
    }
    if (hex.startsWith('89504E47')) {
      return `data:image/png;base64,${buf.toString('base64')}`
    }
  }
  return null
}

function isCalmErrorPageTitle(title?: string | null): boolean {
  return title === 'Unable to Open Page' || title === '无法打开页面'
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
  private static activeInstance: BrowserManager | null = null
  private static configuredPartitions = new Set<string>()

  private mainWindow: BrowserWindow
  public store: PersistenceStore
  public aiService: AIService
  public extensionManager: ExtensionEcosystemManager
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
  private appliedViewLayout = new Map<
    string,
    { x: number; y: number; width: number; height: number; visible: boolean }
  >()
  private consoleLogsByTab = new Map<string, string[]>()
  private connectedToolsByProfile: Record<string, ConnectedToolItem[]> = {}
  private cookieRefreshTimers = new Map<string, NodeJS.Timeout>()
  private scheduledBroadcastTimer: NodeJS.Timeout | null = null
  private viewEvictionTimer: NodeJS.Timeout | null = null
  private faviconPreloadTimer: NodeJS.Timeout | null = null
  private faviconPersistTimer: NodeJS.Timeout | null = null
  private faviconInFlightHosts = new Set<string>()
  private faviconFailedHostsUntil = new Map<string, number>()
  private isWindowClosed = false
  private onNativeThemeUpdated: () => void
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
    this.extensionManager = new ExtensionEcosystemManager(store)
    this.getUpdateState = getUpdateState
    this.getAccountState = getAccountState
    BrowserManager.activeInstance = this

    this.registerWebPreloadIpc()
    this.attachShortcutInterceptor(this.mainWindow.webContents)
    this.restoreTabsFromStore()
    // Ensure extensions for the active profile partition are loaded on boot
    const activeBootProfile =
      this.store.profiles.find((p) => p.id === this.store.activeProfileId) ||
      this.store.profiles[0]
    if (activeBootProfile) {
      const bootSes = this.ensureSessionConfigured(activeBootProfile.partition)
      void this.extensionManager
        .ensureExtensionsLoadedForSession(activeBootProfile.partition, bootSes)
        .then(() => this.broadcastState())
    }
    void this.refreshConnectedTools(this.store.activeProfileId, true)
    this.scheduleFaviconPreload(350)

    this.onNativeThemeUpdated = () => {
      this.syncAllViewsOverlayConfig()
    }
    nativeTheme.on('updated', this.onNativeThemeUpdated)

    this.viewEvictionTimer = setInterval(() => {
      this.evictIdleBackgroundViews()
    }, IDLE_VIEW_SWEEP_INTERVAL_MS)

    this.mainWindow.on('closed', () => {
      this.isWindowClosed = true
      if (BrowserManager.activeInstance === this) {
        BrowserManager.activeInstance = null
      }
      nativeTheme.removeListener('updated', this.onNativeThemeUpdated)
      if (this.viewEvictionTimer) {
        clearInterval(this.viewEvictionTimer)
        this.viewEvictionTimer = null
      }
      if (this.scheduledBroadcastTimer) {
        clearTimeout(this.scheduledBroadcastTimer)
        this.scheduledBroadcastTimer = null
      }
      if (this.faviconPreloadTimer) {
        clearTimeout(this.faviconPreloadTimer)
        this.faviconPreloadTimer = null
      }
      if (this.faviconPersistTimer) {
        clearTimeout(this.faviconPersistTimer)
        this.faviconPersistTimer = null
      }
      for (const timer of this.cookieRefreshTimers.values()) {
        clearTimeout(timer)
      }
      this.cookieRefreshTimers.clear()

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
      this.appliedViewLayout.clear()
      this.consoleLogsByTab.clear()
    })
  }

  private destroyTabView(tabId: string): void {
    this.appliedViewLayout.delete(tabId)
    this.consoleLogsByTab.delete(tabId)
    const view = this.views.get(tabId)
    if (!view) return
    this.views.delete(tabId)
    try {
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.contentView.removeChildView(view)
      }
    } catch {
      // ignore
    }
    try {
      if (!view.webContents.isDestroyed()) {
        view.webContents.close()
      }
    } catch {
      // ignore
    }
  }

  private getProtectedLiveTabIds(extraProtectedId?: string): Set<string> {
    const protectedIds = new Set<string>()
    if (extraProtectedId) protectedIds.add(extraProtectedId)
    const activeProfileId = this.store.activeProfileId
    const activeId = this.activeTabByProfile[activeProfileId]
    if (activeId) protectedIds.add(activeId)
    const sp = this.getSplitView(activeProfileId)
    if (sp.enabled) {
      if (sp.leftTabId) protectedIds.add(sp.leftTabId)
      if (sp.rightTabId) protectedIds.add(sp.rightTabId)
    }
    for (const t of this.tabs) {
      if (t.isLoading || t.isAudioPlaying) {
        protectedIds.add(t.id)
      }
    }
    return protectedIds
  }

  private evictIdleBackgroundViews(extraProtectedId?: string): void {
    if (this.views.size <= 4) return

    // First clean up any orphan views whose tab no longer exists or moved to an internal URL
    const validWebTabById = new Map<string, TabState>()
    for (const t of this.tabs) {
      if (!isInternalDiaUrl(t.url)) {
        validWebTabById.set(t.id, t)
      }
    }
    let evicted = false
    for (const tabId of Array.from(this.views.keys())) {
      if (!validWebTabById.has(tabId)) {
        this.destroyTabView(tabId)
        evicted = true
      }
    }

    const protectedIds = this.getProtectedLiveTabIds(extraProtectedId)
    const now = Date.now()
    const candidates: TabState[] = []
    for (const tabId of this.views.keys()) {
      if (protectedIds.has(tabId)) continue
      const tab = validWebTabById.get(tabId)
      if (tab) candidates.push(tab)
    }
    candidates.sort((a, b) => (a.lastAccessedAt || 0) - (b.lastAccessedAt || 0))

    // 1) Hibernate background views untouched for > 25 minutes when > 4 views are alive
    while (candidates.length > 0 && this.views.size > 4) {
      const oldest = candidates[0]
      if (now - (oldest.lastAccessedAt || 0) < IDLE_VIEW_HIBERNATE_MS) break
      candidates.shift()
      this.destroyTabView(oldest.id)
      evicted = true
    }

    // 2) Enforce hard ceiling on simultaneous live background Chromium renderers
    while (candidates.length > 0 && this.views.size > MAX_LIVE_WEB_VIEWS) {
      const oldest = candidates.shift()!
      this.destroyTabView(oldest.id)
      evicted = true
    }

    if (evicted) {
      this.scheduleBroadcast(60)
    }
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
    ipcMain.removeAllListeners('arko-web:page-appearance')

    ipcMain.on(
      'arko-web:page-appearance',
      (
        event,
        payload: {
          tone?: 'light' | 'dark'
          topColor?: string
          hasMediaBg?: boolean
        }
      ) => {
        const tab = this.findTabByWebContents(event.sender)
        if (!tab || isInternalDiaUrl(tab.url)) return
        let changed = false
        if ((payload?.tone === 'light' || payload?.tone === 'dark') && tab.pageTone !== payload.tone) {
          tab.pageTone = payload.tone
          changed = true
        }
        if (typeof payload?.topColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(payload.topColor)) {
          const normHex = payload.topColor.toUpperCase()
          if (tab.pageTopColor !== normHex) {
            tab.pageTopColor = normHex
            changed = true
          }
        }
        if (changed) {
          this.persistTabs()
          this.syncWindowTitleBarOverlay()
          this.scheduleBroadcast(16)
        }
        if (payload?.hasMediaBg) {
          void this.sampleTabRenderedAppearance(tab.id)
        }
      }
    )

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
      const knownTitleByUrl = new Map<string, string>()
      for (const b of this.store.bookmarks) {
        if (b.url && b.title && b.title !== b.url && !isCalmErrorPageTitle(b.title)) {
          knownTitleByUrl.set(b.url, b.title)
        }
      }
      for (const h of this.store.history) {
        if (
          h.url &&
          h.title &&
          h.title !== h.url &&
          !isCalmErrorPageTitle(h.title) &&
          !knownTitleByUrl.has(h.url)
        ) {
          knownTitleByUrl.set(h.url, h.title)
        }
      }

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
        const savedTitle = isCalmErrorPageTitle(t.title)
          ? knownTitleByUrl.get(url) ||
            (t.pinnedUrl ? knownTitleByUrl.get(t.pinnedUrl) : undefined) ||
            PersistenceStore.extractHostKey(url) ||
            url
          : t.title
        const resolvedFavicon =
          (t.favicon && t.favicon.startsWith('data:image/') ? t.favicon : undefined) ||
          this.store.getCachedFavicon(url) ||
          (t.pinnedUrl ? this.store.getCachedFavicon(t.pinnedUrl) : undefined) ||
          t.favicon
        return {
          id: t.id,
          profileId: t.profileId,
          url,
          title: chatThread
            ? chatThread.title || tr(this.store.settings.language, 'Arko Chat', 'Arko 对话')
            : savedTitle ||
              (url === NEW_TAB_URL ? tr(this.store.settings.language, 'New Tab', '新标签页') : url),
          favicon: resolvedFavicon,
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
          zoomFactor: 1,
          pageTone: t.pageTone
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

    const migratedGroups = this.migrateLegacyFlattenedGroups()
    const hydratedIcons = this.hydrateCachedFaviconsSync()
    this.sortProfileTabsByTier()
    if (migratedGroups || hydratedIcons) {
      this.persistTabs()
    }

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

  /**
   * Ensures `parentId` links never cross profiles, point to missing IDs, or form cycles.
   */
  private sanitizeTabGroupHierarchy(): void {
    const byId = new Map(this.tabGroups.map((g) => [g.id, g]))
    for (const grp of this.tabGroups) {
      if (!grp.parentId) {
        grp.parentId = null
        continue
      }
      const parent = byId.get(grp.parentId)
      if (!parent || parent.id === grp.id || parent.profileId !== grp.profileId) {
        grp.parentId = null
        continue
      }
      const visited = new Set<string>([grp.id])
      let cur: TabGroup | undefined = parent
      let hasCycle = false
      while (cur) {
        if (visited.has(cur.id)) {
          hasCycle = true
          break
        }
        visited.add(cur.id)
        cur = cur.parentId ? byId.get(cur.parentId) : undefined
      }
      if (hasCycle) {
        grp.parentId = null
      }
    }
  }

  private getGroupFullPathSegments(groupId: string): string[] {
    const byId = new Map(this.tabGroups.map((g) => [g.id, g]))
    const segments: string[] = []
    const visited = new Set<string>()
    let curId: string | null | undefined = groupId
    while (curId && !visited.has(curId)) {
      visited.add(curId)
      const grp = byId.get(curId)
      if (!grp) break
      segments.unshift(grp.title)
      curId = grp.parentId
    }
    return segments
  }

  private getGroupFullPathTitle(groupId: string): string {
    return this.getGroupFullPathSegments(groupId).join(' / ')
  }

  private resolveGroupZone(grp: TabGroup): 'pinned' | 'unpinned' {
    const childrenByParent = new Map<string, TabGroup[]>()
    const byId = new Map<string, TabGroup>()
    for (const g of this.tabGroups) {
      byId.set(g.id, g)
      if (g.parentId) {
        const list = childrenByParent.get(g.parentId) || []
        list.push(g)
        childrenByParent.set(g.parentId, list)
      }
    }

    const visited = new Set<string>()
    const queue: TabGroup[] = [grp]
    while (queue.length > 0) {
      const cur = queue.shift()!
      if (visited.has(cur.id)) continue
      visited.add(cur.id)
      const tab = this.tabs.find((t) => t.profileId === cur.profileId && t.groupId === cur.id)
      if (tab) {
        return tab.isPinned ? 'pinned' : 'unpinned'
      }
      if (cur.zone) return cur.zone
      for (const child of childrenByParent.get(cur.id) || []) {
        queue.push(child)
      }
    }

    let ancestorId = grp.parentId
    const seenAnc = new Set<string>()
    while (ancestorId && !seenAnc.has(ancestorId)) {
      seenAnc.add(ancestorId)
      const anc = byId.get(ancestorId)
      if (!anc) break
      if (anc.zone) return anc.zone
      const ancTab = this.tabs.find((t) => t.profileId === anc.profileId && t.groupId === anc.id)
      if (ancTab) return ancTab.isPinned ? 'pinned' : 'unpinned'
      ancestorId = anc.parentId
    }

    return grp.zone || 'pinned'
  }

  /**
   * Automatically upgrades previously imported single-level `'A / B / C'` TabGroups into true
   * nested `parentId` folder trees on startup without requiring users to re-import.
   */
  private migrateLegacyFlattenedGroups(): boolean {
    this.sanitizeTabGroupHierarchy()
    const hasFlattened = this.tabGroups.some((g) => !g.parentId && g.title.includes(' / '))
    if (!hasFlattened) return false

    let changed = false
    const inferredZoneById = new Map<string, 'pinned' | 'unpinned'>()
    for (const g of this.tabGroups) {
      const z = this.resolveGroupZone(g)
      g.zone = z
      inferredZoneById.set(g.id, z)
    }

    const bucketKeys = new Set<string>()
    for (const g of this.tabGroups) {
      bucketKeys.add(`${g.profileId}::${inferredZoneById.get(g.id) || 'pinned'}`)
    }

    const redundantGroupIds = new Set<string>()
    const nextGroupsOrder: TabGroup[] = []
    const emittedIds = new Set<string>()
    const emitGroup = (g: TabGroup): void => {
      if (!emittedIds.has(g.id) && !redundantGroupIds.has(g.id)) {
        emittedIds.add(g.id)
        nextGroupsOrder.push(g)
      }
    }

    for (const key of bucketKeys) {
      const [profileId, zoneRaw] = key.split('::')
      const zone = (zoneRaw === 'unpinned' ? 'unpinned' : 'pinned') as 'pinned' | 'unpinned'
      const bucketGroups = this.tabGroups.filter(
        (g) => g.profileId === profileId && (inferredZoneById.get(g.id) || 'pinned') === zone
      )
      if (!bucketGroups.some((g) => !g.parentId && g.title.includes(' / '))) {
        for (const g of bucketGroups) emitGroup(g)
        continue
      }

      // Pre-index existing unnested groups by normalized path so e.g. `BAK / Meitou` keeps its own group ID
      // when `BAK / Meitou / Dev` also exists in the same Space.
      const exactCandidatesByNormPath = new Map<string, TabGroup[]>()
      for (const g of bucketGroups) {
        if (g.parentId) continue
        const segs = g.title
          .split(' / ')
          .map((s) => s.trim())
          .filter(Boolean)
        if (segs.length === 0) continue
        const normPath = segs.map((s) => s.toLowerCase()).join(' / ')
        const arr = exactCandidatesByNormPath.get(normPath) || []
        arr.push(g)
        exactCandidatesByNormPath.set(normPath, arr)
      }

      const resolvedByNormPath = new Map<string, TabGroup>()

      for (const g of bucketGroups) {
        if (g.parentId) {
          emitGroup(g)
          continue
        }
        const segs = g.title
          .split(' / ')
          .map((s) => s.trim())
          .filter(Boolean)
        if (segs.length <= 1) {
          const singleNorm = (segs[0] || g.title).trim().toLowerCase()
          if (!resolvedByNormPath.has(singleNorm)) {
            resolvedByNormPath.set(singleNorm, g)
          }
          emitGroup(g)
          continue
        }

        changed = true
        let parentGrp: TabGroup | null = null
        for (let depth = 0; depth < segs.length; depth++) {
          const prefixSegs = segs.slice(0, depth + 1)
          const normPrefix = prefixSegs.map((s) => s.toLowerCase()).join(' / ')
          let node = resolvedByNormPath.get(normPrefix)

          if (!node) {
            const candidates = exactCandidatesByNormPath.get(normPrefix)
            const chosen = candidates && candidates.length > 0 ? candidates.shift()! : null
            if (chosen) {
              chosen.title = segs[depth]
              chosen.parentId = parentGrp ? parentGrp.id : null
              chosen.zone = zone
              node = chosen
              // Reassign any duplicate group with the exact same normalized path
              if (candidates && candidates.length > 0) {
                for (const dup of candidates) {
                  for (const t of this.tabs) {
                    if (t.groupId === dup.id) t.groupId = chosen.id
                  }
                  redundantGroupIds.add(dup.id)
                }
                candidates.length = 0
              }
            } else {
              node = {
                id: `grp-mig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
                profileId,
                parentId: parentGrp ? parentGrp.id : null,
                zone,
                title: segs[depth],
                color: parentGrp ? parentGrp.color : g.color,
                collapsed: false
              }
            }
            resolvedByNormPath.set(normPrefix, node)
            emitGroup(node)
          } else if (depth === segs.length - 1 && node.id !== g.id) {
            for (const t of this.tabs) {
              if (t.groupId === g.id) t.groupId = node.id
            }
            redundantGroupIds.add(g.id)
          }

          parentGrp = node
        }
      }
    }

    if (changed) {
      this.tabGroups = nextGroupsOrder.filter((g) => !redundantGroupIds.has(g.id))
      // If a parent folder contains expanded child folders, keep the parent expanded so visible subfolders stay open
      const byId = new Map(this.tabGroups.map((g) => [g.id, g]))
      let expandedParent = true
      while (expandedParent) {
        expandedParent = false
        for (const g of this.tabGroups) {
          if (!g.collapsed && g.parentId) {
            const p = byId.get(g.parentId)
            if (p && p.collapsed) {
              p.collapsed = false
              expandedParent = true
            }
          }
        }
      }
      this.sanitizeTabGroupHierarchy()
    }

    return changed
  }

  private cleanupEmptyGroups(): void {
    this.sanitizeTabGroupHierarchy()
    const usedGroupIds = new Set(this.tabs.map((t) => t.groupId).filter(Boolean) as string[])
    const keptIds = new Set<string>()
    for (const g of this.tabGroups) {
      if (usedGroupIds.has(g.id) || g.keepEmpty) {
        keptIds.add(g.id)
      }
    }
    let grew = true
    while (grew) {
      grew = false
      for (const g of this.tabGroups) {
        if (keptIds.has(g.id) && g.parentId && !keptIds.has(g.parentId)) {
          keptIds.add(g.parentId)
          grew = true
        }
      }
    }
    this.tabGroups = this.tabGroups.filter((g) => keptIds.has(g.id))
  }

  private clusterTierTabsByGroup(tierTabs: TabState[]): TabState[] {
    const byId = new Map(this.tabGroups.map((g) => [g.id, g]))
    const getRootGroupId = (gid: string): string => {
      let cur = gid
      const visited = new Set<string>()
      while (cur && !visited.has(cur)) {
        visited.add(cur)
        const g = byId.get(cur)
        if (!g?.parentId || !byId.has(g.parentId)) return cur
        cur = g.parentId
      }
      return gid
    }

    const seenRoots = new Set<string>()
    const result: TabState[] = []

    for (const tab of tierTabs) {
      const gid = tab.groupId && byId.has(tab.groupId) ? tab.groupId : null
      if (!gid) {
        if (tab.groupId) tab.groupId = null
        result.push(tab)
        continue
      }
      const rootId = getRootGroupId(gid)
      if (seenRoots.has(rootId)) continue
      seenRoots.add(rootId)

      // Within this root folder tree, preserve relative subfolder order while clustering tabs of each leaf folder
      const treeTabs = tierTabs.filter((t) => {
        const tGid = t.groupId && byId.has(t.groupId) ? t.groupId : null
        return tGid !== null && getRootGroupId(tGid) === rootId
      })
      const seenLeafGroups = new Set<string>()
      for (const treeTab of treeTabs) {
        const leafId = treeTab.groupId!
        if (seenLeafGroups.has(leafId)) continue
        seenLeafGroups.add(leafId)
        for (const member of treeTabs) {
          if (member.groupId === leafId) {
            result.push(member)
          }
        }
      }
    }
    return result
  }

  private faviconDataUrlCache = new Map<string, string>()

  private hydrateCachedFaviconsSync(): boolean {
    let changedTabs = false
    let changedBookmarks = false
    for (const t of this.tabs) {
      if (t.favicon && t.favicon.startsWith('data:image/')) {
        this.store.setCachedFavicon(t.url, t.favicon)
        if (t.pinnedUrl) this.store.setCachedFavicon(t.pinnedUrl, t.favicon)
      }
    }
    for (const b of this.store.bookmarks) {
      if (b.favicon && b.favicon.startsWith('data:image/')) {
        this.store.setCachedFavicon(b.url, b.favicon)
      }
    }
    for (const h of this.store.history) {
      if (h.favicon && h.favicon.startsWith('data:image/')) {
        this.store.setCachedFavicon(h.url, h.favicon)
      }
    }

    for (const t of this.tabs) {
      if (isInternalDiaUrl(t.url)) continue
      if (t.favicon && t.favicon.startsWith('data:image/')) continue
      const cached =
        this.store.getCachedFavicon(t.url) ||
        (t.pinnedUrl ? this.store.getCachedFavicon(t.pinnedUrl) : undefined)
      if (cached && cached !== t.favicon) {
        t.favicon = cached
        changedTabs = true
      }
    }
    for (const b of this.store.bookmarks) {
      if (b.favicon && b.favicon.startsWith('data:image/')) continue
      const cached = this.store.getCachedFavicon(b.url)
      if (cached && cached !== b.favicon) {
        b.favicon = cached
        changedBookmarks = true
      }
    }
    if (changedBookmarks) {
      this.store.saveBookmarks()
    }
    return changedTabs
  }

  private applyResolvedHostFavicon(host: string, dataUrl: string): void {
    if (!host || !dataUrl.startsWith('data:image/')) return
    this.store.setCachedFavicon(host, dataUrl)

    let tabsChanged = false
    let bookmarksChanged = false

    for (const t of this.tabs) {
      if (isInternalDiaUrl(t.url)) continue
      if (t.favicon && t.favicon.startsWith('data:image/')) continue
      const tHost = PersistenceStore.extractHostKey(t.url)
      const pHost = t.pinnedUrl ? PersistenceStore.extractHostKey(t.pinnedUrl) : null
      if (tHost === host || pHost === host) {
        t.favicon = dataUrl
        tabsChanged = true
      }
    }

    for (const b of this.store.bookmarks) {
      if (b.favicon && b.favicon.startsWith('data:image/')) continue
      if (PersistenceStore.extractHostKey(b.url) === host) {
        b.favicon = dataUrl
        bookmarksChanged = true
      }
    }

    if (tabsChanged || bookmarksChanged) {
      if (this.faviconPersistTimer) clearTimeout(this.faviconPersistTimer)
      this.faviconPersistTimer = setTimeout(() => {
        this.faviconPersistTimer = null
        if (this.isWindowClosed) return
        this.persistTabs()
        this.store.saveBookmarks()
      }, 260)
      this.scheduleBroadcast(110)
    }
  }

  private async fetchWithTimeout(
    ses: Electron.Session,
    url: string,
    timeoutMs: number,
    headers?: Record<string, string>
  ): Promise<Response | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await ses.fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          ...headers
        }
      })
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  private async fetchAndNormalizeIconUrl(
    ses: Electron.Session,
    iconUrl: string,
    timeoutMs = 3800
  ): Promise<string | null> {
    if (iconUrl.startsWith('data:image/')) {
      return iconUrl.length <= 131072 ? iconUrl : null
    }
    const cached = this.faviconDataUrlCache.get(iconUrl)
    if (cached) return cached

    const res = await this.fetchWithTimeout(ses, iconUrl, timeoutMs)
    if (!res || !res.ok) return null
    const rawMime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (rawMime === 'text/html' || rawMime === 'application/json' || rawMime === 'text/plain') {
      return null
    }
    try {
      const ab = await res.arrayBuffer()
      if (ab.byteLength === 0 || ab.byteLength > 524288) return null
      const dataUrl = normalizeIconBufferToDataUrl(Buffer.from(ab), rawMime)
      if (!dataUrl) return null
      if (this.faviconDataUrlCache.size > 500) {
        const firstKey = this.faviconDataUrlCache.keys().next().value
        if (firstKey) this.faviconDataUrlCache.delete(firstKey)
      }
      this.faviconDataUrlCache.set(iconUrl, dataUrl)
      return dataUrl
    } catch {
      return null
    }
  }

  private async resolveFaviconForTarget(
    ses: Electron.Session,
    sampleUrl: string,
    host: string
  ): Promise<string | null> {
    let parsed: URL
    try {
      parsed = new URL(sampleUrl)
    } catch {
      return null
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const origin = parsed.origin
    const isLocal = isPrivateOrLocalHost(host)

    // Step 1: Inspect page / origin HTML <head> for explicit <link rel="icon" | "apple-touch-icon">
    const htmlTargets = parsed.pathname && parsed.pathname !== '/' ? [sampleUrl, `${origin}/`] : [sampleUrl]
    for (const htmlUrl of htmlTargets) {
      if (this.isWindowClosed) return null
      const htmlRes = await this.fetchWithTimeout(ses, htmlUrl, isLocal ? 2200 : 5000, {
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8'
      })
      if (!htmlRes || !htmlRes.ok) continue
      const finalUrl = htmlRes.url || htmlUrl
      const finalHost = PersistenceStore.extractHostKey(finalUrl)
      // Do not adopt SSO provider login page icons (e.g. accounts.google.com) for a different site
      if (finalHost && finalHost !== host && SSO_REDIRECT_HOST_RE.test(finalHost)) {
        continue
      }
      const ctype = (htmlRes.headers.get('content-type') || '').toLowerCase()
      if (!ctype.includes('html') && !ctype.includes('xml')) continue
      try {
        const ab = await htmlRes.arrayBuffer()
        const htmlSnippet = Buffer.from(ab.slice(0, 131072)).toString('utf-8')
        const candidates = extractHtmlIconCandidates(htmlSnippet, finalUrl)
        for (const cand of candidates) {
          if (this.isWindowClosed) return null
          const iconDataUrl = await this.fetchAndNormalizeIconUrl(ses, cand, isLocal ? 2000 : 3800)
          if (iconDataUrl) return iconDataUrl
        }
        if (candidates.length > 0) break
      } catch {
        // continue to direct origin paths
      }
    }

    // Step 2: Probe standard root icon locations on the origin directly
    const directCandidates = [
      `${origin}/favicon.ico`,
      `${origin}/favicon.png`,
      `${origin}/favicon.svg`,
      `${origin}/apple-touch-icon.png`
    ]
    for (const directUrl of directCandidates) {
      if (this.isWindowClosed) return null
      const iconDataUrl = await this.fetchAndNormalizeIconUrl(
        ses,
        directUrl,
        isLocal ? 1800 : 3200
      )
      if (iconDataUrl) return iconDataUrl
    }

    if (isLocal) return null

    // Step 3: Public Favicon CDN Fallbacks (for Cloudflare-gated, SSO-redirected, or temporarily offline hosts)
    // Also falls back to registrable root domain for custom SaaS tenant subdomains (e.g. tenant.invoiceocean.com)
    const domainCandidates = [host]
    const rootDomain = getRegistrableRootDomain(host)
    if (rootDomain && rootDomain !== host) {
      domainCandidates.push(rootDomain)
    }

    for (const domain of domainCandidates) {
      if (this.isWindowClosed) return null
      const serviceUrls = [
        `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(`https://${domain}`)}&size=64`,
        `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`
      ]
      for (const svcUrl of serviceUrls) {
        if (this.isWindowClosed) return null
        const iconDataUrl = await this.fetchAndNormalizeIconUrl(ses, svcUrl, 4200)
        if (iconDataUrl) return iconDataUrl
      }
    }

    return null
  }

  public scheduleFaviconPreload(delayMs = 160): void {
    if (this.isWindowClosed) return
    if (this.faviconPreloadTimer) clearTimeout(this.faviconPreloadTimer)
    this.faviconPreloadTimer = setTimeout(() => {
      this.faviconPreloadTimer = null
      void this.runFaviconPreloadSweep()
    }, delayMs)
  }

  private async runFaviconPreloadSweep(): Promise<void> {
    if (this.isWindowClosed) return

    if (this.hydrateCachedFaviconsSync()) {
      this.persistTabs()
      this.scheduleBroadcast(48)
    }

    const activeProfileId = this.store.activeProfileId
    const profilePartitionMap = new Map<string, string>()
    for (const p of this.store.profiles) {
      profilePartitionMap.set(p.id, p.partition)
    }
    const defaultPartition = this.store.profiles[0]?.partition || 'persist:arko-profile-work'

    interface PreloadCandidate {
      host: string
      sampleUrl: string
      partition: string
      priority: number
    }

    const now = Date.now()
    const byHost = new Map<string, PreloadCandidate>()

    const consider = (
      rawUrl: string | null | undefined,
      profileId: string,
      currentFavicon: string | undefined,
      priority: number
    ): void => {
      if (!rawUrl || isInternalDiaUrl(rawUrl)) return
      if (currentFavicon && currentFavicon.startsWith('data:image/')) return
      if (!/^https?:\/\//i.test(rawUrl)) return
      const host = PersistenceStore.extractHostKey(rawUrl)
      if (!host) return
      if (this.faviconInFlightHosts.has(host)) return
      const cooldownUntil = this.faviconFailedHostsUntil.get(host) || 0
      if (cooldownUntil > now) return

      const cached = this.store.getCachedFavicon(host)
      if (cached) {
        this.applyResolvedHostFavicon(host, cached)
        return
      }

      const existing = byHost.get(host)
      if (!existing || priority < existing.priority) {
        byHost.set(host, {
          host,
          sampleUrl: rawUrl,
          partition: profilePartitionMap.get(profileId) || defaultPartition,
          priority
        })
      }
    }

    for (const t of this.tabs) {
      const isActiveSpace = t.profileId === activeProfileId
      const isPinnedOrFav = Boolean(t.isFavorite || t.isPinned)
      const priority = isActiveSpace ? (isPinnedOrFav ? 1 : 2) : isPinnedOrFav ? 3 : 4
      consider(t.pinnedUrl || t.url, t.profileId, t.favicon, priority)
    }

    for (const b of this.store.bookmarks.slice(0, 240)) {
      consider(b.url, b.profileId, b.favicon, b.profileId === activeProfileId ? 5 : 6)
    }

    if (byHost.size === 0) return

    const queue = [...byHost.values()].sort((a, b) => a.priority - b.priority)
    for (const item of queue) {
      this.faviconInFlightHosts.add(item.host)
    }

    let cursor = 0
    const worker = async (): Promise<void> => {
      while (!this.isWindowClosed && cursor < queue.length) {
        const task = queue[cursor++]
        try {
          // Re-check cache in case another tab finished it
          const already = this.store.getCachedFavicon(task.host)
          if (already) {
            this.applyResolvedHostFavicon(task.host, already)
            continue
          }
          const ses = this.ensureSessionConfigured(task.partition)
          const dataUrl = await this.resolveFaviconForTarget(ses, task.sampleUrl, task.host)
          if (dataUrl) {
            this.faviconFailedHostsUntil.delete(task.host)
            this.applyResolvedHostFavicon(task.host, dataUrl)
          } else {
            this.faviconFailedHostsUntil.set(task.host, Date.now() + FAVICON_FAIL_COOLDOWN_MS)
          }
        } catch {
          this.faviconFailedHostsUntil.set(task.host, Date.now() + FAVICON_FAIL_COOLDOWN_MS)
        } finally {
          this.faviconInFlightHosts.delete(task.host)
        }
      }
    }

    const workerCount = Math.min(FAVICON_PRELOAD_CONCURRENCY, queue.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
  }

  private sortSingleProfileTabs(list: TabState[]): TabState[] {
    // Dia-style unified Pin model: ungrouped pinned tabs live in the top Pin icon grid,
    // while grouped pinned tabs stay inside Pinned Folders right below the grid.
    for (const t of list) {
      if (t.isPinned && !t.groupId) {
        t.isFavorite = true
      } else if (t.groupId && t.isFavorite) {
        t.isFavorite = false
      }
    }

    const favorites = list.filter((t) => t.isFavorite)
    const pinned = list.filter((t) => !t.isFavorite && t.isPinned)
    const unpinned = list.filter((t) => !t.isFavorite && !t.isPinned)

    // Ensure a TabGroup (and its ancestor chain) never straddles both Pinned and Today zones
    const byId = new Map(this.tabGroups.map((g) => [g.id, g]))
    const pinnedTreeGroupIds = new Set<string>()
    for (const t of pinned) {
      let cur = t.groupId
      const seen = new Set<string>()
      while (cur && !seen.has(cur)) {
        seen.add(cur)
        pinnedTreeGroupIds.add(cur)
        const g = byId.get(cur)
        if (g) g.zone = 'pinned'
        cur = g?.parentId ?? null
      }
    }
    for (const t of unpinned) {
      if (t.groupId && pinnedTreeGroupIds.has(t.groupId)) {
        t.groupId = null
      } else if (t.groupId) {
        let cur: string | null = t.groupId
        const seen = new Set<string>()
        while (cur && !seen.has(cur)) {
          seen.add(cur)
          const g = byId.get(cur)
          if (!g) break
          if (g.parentId && pinnedTreeGroupIds.has(g.parentId)) {
            g.parentId = null
          }
          g.zone = 'unpinned'
          cur = g.parentId ?? null
        }
      }
    }

    return [
      ...favorites,
      ...this.clusterTierTabsByGroup(pinned),
      ...this.clusterTierTabsByGroup(unpinned)
    ]
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
        next.push(...this.sortSingleProfileTabs(list))
      }
      this.tabs = next
      return
    }
    const profileTabs = this.tabs.filter((t) => t.profileId === profileId)
    const sortedProfileTabs = this.sortSingleProfileTabs(profileTabs)
    let ptr = 0
    this.tabs = this.tabs.map((t) => (t.profileId === profileId ? sortedProfileTabs[ptr++] : t))
  }

  private applyPinModeToTab(tab: TabState, mode: TabPinMode): void {
    const wasPinnedTier = Boolean(!tab.isFavorite && tab.isPinned)
    if (mode === 'favorite') {
      tab.isFavorite = true
      tab.isPinned = true
      tab.groupId = null
      if (!tab.pinnedUrl && tab.url && tab.url !== NEW_TAB_URL) {
        tab.pinnedUrl = tab.url
      }
    } else if (mode === 'pinned') {
      if (!wasPinnedTier) {
        tab.groupId = null
      }
      tab.isPinned = true
      tab.isFavorite = !tab.groupId
      if (!tab.pinnedUrl && tab.url && tab.url !== NEW_TAB_URL) {
        tab.pinnedUrl = tab.url
      }
    } else {
      if (wasPinnedTier || tab.isFavorite) {
        tab.groupId = null
      }
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
        groupId: t.isFavorite ? null : t.groupId || null,
        pageTone: t.pageTone
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
    const decorateTab = (t: TabState): TabState => ({
      ...t,
      isLoaded: isInternalDiaUrl(t.url) || this.views.has(t.id)
    })
    const activeProfileObj =
      this.store.profiles.find((p) => p.id === activeProfileId) || this.store.profiles[0]
    const activePartition = activeProfileObj?.partition || 'persist:arko-profile-work'
    const siblingProfileIds = new Set(
      this.store.profiles.filter((p) => p.partition === activePartition).map((p) => p.id)
    )
    siblingProfileIds.add(activeProfileId)

    return {
      platform,
      profiles: this.store.profiles,
      activeProfileId,
      tabs: this.tabs.filter((t) => t.profileId === activeProfileId).map(decorateTab),
      tabGroups: this.tabGroups.filter((g) => g.profileId === activeProfileId),
      allTabs: this.tabs.map(decorateTab),
      allTabGroups: this.tabGroups.map((g) => ({ ...g })),
      activeTabByProfile: { ...this.activeTabByProfile },
      splitByProfile: splitByProfileCopy,
      activeTabId: this.activeTabByProfile[activeProfileId] || null,
      splitView: { ...this.getSplitView(activeProfileId) },
      bookmarks: this.store.bookmarks.filter((b) => b.profileId === activeProfileId),
      history: this.store.history
        .filter((h) => siblingProfileIds.has(h.profileId))
        .slice(0, 400),
      memories: this.store.memories,
      downloads: this.downloads.slice(0, 25),
      recentlyClosedCount: closedStack.length,
      settings: this.store.settings,
      threads: this.store.threads.filter((th) => th.profileId === activeProfileId),
      aiSidebarOpen: this.aiSidebarOpen,
      updateState: this.getUpdateState?.(),
      connectedTools:
        this.connectedToolsByProfile[activeProfileId] || this.getFallbackConnectedTools(),
      extensions: this.extensionManager.getExtensionsSnapshotForPartition(activePartition),
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
    if (this.scheduledBroadcastTimer) {
      clearTimeout(this.scheduledBroadcastTimer)
      this.scheduledBroadcastTimer = null
    }
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('arko:state-changed', this.getSnapshot())
    }
  }

  private scheduleBroadcast(delayMs = 24): void {
    if (this.scheduledBroadcastTimer || this.mainWindow.isDestroyed()) return
    this.scheduledBroadcastTimer = setTimeout(() => {
      this.scheduledBroadcastTimer = null
      this.broadcastState()
    }, delayMs)
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
    if (!BrowserManager.configuredPartitions.has(partition)) {
      BrowserManager.configuredPartitions.add(partition)
      ses.setUserAgent(cleanChromeUserAgent(ses.getUserAgent()))

      // Auto-load enabled user extensions into this persistent session
      void this.extensionManager
        .ensureExtensionsLoadedForSession(partition, ses)
        .then(() => {
          const mgr = BrowserManager.activeInstance
          if (mgr && !mgr.mainWindow.isDestroyed()) {
            mgr.broadcastState()
          }
        })

      // Live watch browser session cookies to auto-update "Connect your Tools" status
      // Delegate through BrowserManager.activeInstance so persistent partitions never retain closed windows
      ses.cookies.on('changed', () => {
        const mgr = BrowserManager.activeInstance
        if (!mgr || mgr.mainWindow.isDestroyed()) return
        const prevTimer = mgr.cookieRefreshTimers.get(partition)
        if (prevTimer) clearTimeout(prevTimer)
        const timer = setTimeout(() => {
          mgr.cookieRefreshTimers.delete(partition)
          if (BrowserManager.activeInstance !== mgr || mgr.mainWindow.isDestroyed()) return
          const ownerProfile = mgr.store.profiles.find((p) => p.partition === partition)
          if (ownerProfile) {
            void mgr.refreshConnectedTools(
              ownerProfile.id,
              ownerProfile.id === mgr.store.activeProfileId
            )
          }
        }, 650)
        mgr.cookieRefreshTimers.set(partition, timer)
      })

      // Capture HTTP 4xx/5xx network errors for the Browser-Native Coding Agent
      ses.webRequest.onCompleted((details) => {
        const mgr = BrowserManager.activeInstance
        if (!mgr || mgr.mainWindow.isDestroyed()) return
        if (details.statusCode >= 400 && details.webContentsId) {
          for (const [tabId, v] of mgr.views.entries()) {
            if (!v.webContents.isDestroyed() && v.webContents.id === details.webContentsId) {
              if (['mainFrame', 'xhr', ' subFrame'].includes(details.resourceType) || details.resourceType === 'xhr') {
                mgr.appendTabDiagnostic(
                  tabId,
                  `[HTTP ${details.statusCode}] ${details.method} ${details.url.slice(0, 140)}`
                )
              } else if (details.statusCode >= 500) {
                mgr.appendTabDiagnostic(
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
        const mgr = BrowserManager.activeInstance
        if (!mgr || mgr.mainWindow.isDestroyed()) return
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
        mgr.downloads.unshift(record)
        if (mgr.downloads.length > 30) mgr.downloads.length = 30
        mgr.broadcastState()

        let lastBroadcast = 0
        item.on('updated', (_e, state) => {
          record.receivedBytes = item.getReceivedBytes()
          record.totalBytes = item.getTotalBytes()
          record.savePath = item.getSavePath() || record.savePath
          record.state = state === 'interrupted' ? 'interrupted' : 'progressing'
          const now = Date.now()
          if (now - lastBroadcast > 220) {
            lastBroadcast = now
            BrowserManager.activeInstance?.scheduleBroadcast(16)
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
          BrowserManager.activeInstance?.broadcastState()
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
    if (existing) {
      this.views.delete(tab.id)
      this.appliedViewLayout.delete(tab.id)
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
    this.appliedViewLayout.set(tab.id, { x: 0, y: 0, width: 0, height: 0, visible: false })
    if (this.views.size > MAX_LIVE_WEB_VIEWS) {
      this.evictIdleBackgroundViews(tab.id)
    }

    const wc = view.webContents
    if (tab.zoomFactor && tab.zoomFactor !== 1) {
      try {
        wc.setZoomFactor(tab.zoomFactor)
      } catch {
        // ignore
      }
    }
    this.attachShortcutInterceptor(wc)

    wc.on('render-process-gone', () => {
      tab.isLoading = false
      tab.isAudioPlaying = false
      this.destroyTabView(tab.id)
      this.scheduleBroadcast(16)
    })

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
        void this.createTab(url, {
          background: false,
          groupId: tab.isPinned || tab.isFavorite ? null : tab.groupId
        })
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

    wc.on('did-change-theme-color', (_event, color) => {
      if (!color || isInternalDiaUrl(tab.url)) return
      const hex = color.trim()
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        const nextTone: 'light' | 'dark' = lum >= 0.48 ? 'light' : 'dark'
        if (!tab.pageTone) {
          tab.pageTone = nextTone
          tab.pageTopColor = hex.toUpperCase()
          this.syncWindowTitleBarOverlay()
          this.scheduleBroadcast(20)
        }
      }
    })

    wc.on('did-finish-load', () => {
      this.syncViewOverlayConfig(tab, wc)
      setTimeout(() => {
        void this.sampleTabRenderedAppearance(tab.id)
      }, 120)
    })

    wc.on('did-stop-loading', () => {
      tab.isLoading = false
      const currentUrl = wc.getURL()
      const isErrorDataPage = Boolean(currentUrl && currentUrl.startsWith('data:text/html'))
      if (currentUrl && currentUrl !== 'about:blank' && !isErrorDataPage) {
        tab.url = currentUrl
        tab.isSensitive = isSensitiveUrl(currentUrl)
        if ((tab.isPinned || tab.isFavorite) && !tab.pinnedUrl && !isInternalDiaUrl(currentUrl)) {
          tab.pinnedUrl = currentUrl
        }
      }
      if (!isErrorDataPage) {
        const pageTitle = wc.getTitle()
        if (pageTitle && !isCalmErrorPageTitle(pageTitle)) {
          tab.title = pageTitle
        }
      }
      tab.zoomFactor = Math.round(wc.getZoomFactor() * 100) / 100
      this.syncNavigationFlags(tab, wc)
      this.syncViewOverlayConfig(tab, wc)
      if (!isErrorDataPage) {
        this.store.recordHistory(tab.profileId, tab.url, tab.title, tab.favicon)
      }
      this.persistTabs()
      this.broadcastState()
      if (!tab.favicon || !tab.favicon.startsWith('data:image/')) {
        this.scheduleFaviconPreload(220)
      }
      void this.sampleTabRenderedAppearance(tab.id)
      setTimeout(() => {
        void this.sampleTabRenderedAppearance(tab.id)
      }, 420)
    })

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || !validatedURL) return
      if (validatedURL.startsWith('data:')) return
      tab.isLoading = false
      this.broadcastState()
      this.scheduleFaviconPreload(180)
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
        this.scheduleBroadcast(24)
      }
    })

    wc.on('page-title-updated', (_event, title) => {
      const curUrl = !wc.isDestroyed() ? wc.getURL() : ''
      if (curUrl.startsWith('data:text/html') || isCalmErrorPageTitle(title)) return
      if (title && title !== tab.title) {
        tab.title = title
        this.store.recordHistory(tab.profileId, tab.url, tab.title, tab.favicon)
        this.persistTabs()
        this.scheduleBroadcast(24)
      }
    })

    wc.on('page-favicon-updated', (_event, favicons) => {
      const candidates = Array.isArray(favicons) ? favicons.filter(Boolean) : []
      if (candidates.length === 0) return

      const primaryUrl = candidates[0]
      const cachedDataUrl =
        candidates.map((u) => this.faviconDataUrlCache.get(u)).find(Boolean) ||
        this.store.getCachedFavicon(tab.url)
      const nextInitial = cachedDataUrl || primaryUrl
      if (nextInitial !== tab.favicon) {
        tab.favicon = nextInitial
        this.persistTabs()
        this.scheduleBroadcast(32)
      }

      if (!wc.isDestroyed()) {
        const ses = wc.session
        const tabHost = PersistenceStore.extractHostKey(tab.url)
        void (async () => {
          for (const iconUrl of candidates.slice(0, 4)) {
            const dataUrl = await this.fetchAndNormalizeIconUrl(ses, iconUrl, 4500)
            if (!dataUrl) continue
            tab.favicon = dataUrl
            if (tabHost) {
              const curUrlHost = !wc.isDestroyed()
                ? PersistenceStore.extractHostKey(wc.getURL())
                : tabHost
              if (!curUrlHost || !SSO_REDIRECT_HOST_RE.test(curUrlHost) || curUrlHost === tabHost) {
                this.applyResolvedHostFavicon(tabHost, dataUrl)
              }
            }
            this.persistTabs()
            this.scheduleBroadcast(48)
            break
          }
        })()
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
              void this.createTab(params.linkURL, {
                background: false,
                groupId: tab.isPinned || tab.isFavorite ? null : tab.groupId
              })
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
              void this.createTab(params.linkURL, {
                background: true,
                groupId: tab.isPinned || tab.isFavorite ? null : tab.groupId
              })
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
    const newRightId = await this.createTab(url, {
      background: true,
      groupId: active?.isPinned || active?.isFavorite ? null : active?.groupId
    })
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

      // Arc / Dia Space cycling: Ctrl+Option+Left / Ctrl+Option+Right
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

      // Dia-style direct Profile switch: Ctrl+1..Ctrl+9 on macOS (⌃1..⌃9), Alt+1..Alt+9 on Win/Linux
      const isProfileDigitShortcut =
        process.platform === 'darwin'
          ? input.control && !input.meta && !input.alt && !input.shift && /^[1-9]$/.test(input.key)
          : input.alt && !input.control && !input.meta && !input.shift && /^[1-9]$/.test(input.key)

      if (isProfileDigitShortcut) {
        const targetIdx = Number(input.key) - 1
        const targetProfile = this.store.profiles[targetIdx]
        if (targetProfile) {
          event.preventDefault()
          const curIdx = this.store.profiles.findIndex((p) => p.id === this.store.activeProfileId)
          if (targetProfile.id !== this.store.activeProfileId) {
            this.switchProfile(targetProfile.id)
            this.emitShortcut(targetIdx >= curIdx ? 'switch-profile-next' : 'switch-profile-prev')
          }
          return
        }
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

  private applyViewBoundsAndVisibility(
    tabId: string,
    view: WebContentsView,
    rect: ViewportBounds | null
  ): void {
    const prev = this.appliedViewLayout.get(tabId)
    if (!rect) {
      if (!prev || prev.visible) {
        view.setVisible(false)
        this.appliedViewLayout.set(tabId, {
          x: prev?.x ?? 0,
          y: prev?.y ?? 0,
          width: prev?.width ?? 0,
          height: prev?.height ?? 0,
          visible: false
        })
      }
      return
    }

    const x = Math.round(rect.x)
    const y = Math.round(rect.y)
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)

    if (!prev || prev.x !== x || prev.y !== y || prev.width !== width || prev.height !== height) {
      view.setBounds({ x, y, width, height })
    }
    if (!prev || !prev.visible) {
      view.setVisible(true)
    }
    this.appliedViewLayout.set(tabId, { x, y, width, height, visible: true })
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
          this.applyViewBoundsAndVisibility(tabId, view, this.primaryBounds)
        } else if (
          rightTab &&
          tabId === rightTab.id &&
          !isInternalDiaUrl(rightTab.url) &&
          !this.overlayActive &&
          rightRect &&
          rightRect.width > 20 &&
          rightRect.height > 20
        ) {
          this.applyViewBoundsAndVisibility(tabId, view, rightRect)
        } else {
          this.applyViewBoundsAndVisibility(tabId, view, null)
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

      this.applyViewBoundsAndVisibility(tabId, view, shouldShow ? this.primaryBounds : null)
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
        this.destroyTabView(prevRightId)
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
    this.syncWindowTitleBarOverlay()
    this.broadcastState()
    const curActive = this.getActiveTab()
    if (curActive && !isInternalDiaUrl(curActive.url) && !curActive.isLoading) {
      const targetId = curActive.id
      setTimeout(() => {
        void this.sampleTabRenderedAppearance(targetId)
      }, 90)
    }
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
        this.destroyTabView(disc.id)
        const idx = this.tabs.findIndex((t) => t.id === disc.id)
        if (idx >= 0) this.tabs.splice(idx, 1)
      }
    }

    this.persistTabs()
    this.syncViewsLayout()
    this.syncWindowTitleBarOverlay()
    this.broadcastState()
    const curActive = this.getActiveTab()
    if (curActive && !isInternalDiaUrl(curActive.url) && !curActive.isLoading) {
      const targetId = curActive.id
      setTimeout(() => {
        void this.sampleTabRenderedAppearance(targetId)
      }, 90)
    }
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
    this.syncWindowTitleBarOverlay()
    this.broadcastState()
    const curActive = this.getActiveTab()
    if (curActive && !isInternalDiaUrl(curActive.url) && !curActive.isLoading) {
      const targetId = curActive.id
      setTimeout(() => {
        void this.sampleTabRenderedAppearance(targetId)
      }, 90)
    }
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
        this.destroyTabView(t.id)
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
      favicon: !isInternalDiaUrl(resolved) ? this.store.getCachedFavicon(resolved) : undefined,
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
    } else if (tab.groupId) {
      let lastGroupIdx = -1
      for (let i = 0; i < this.tabs.length; i++) {
        if (this.tabs[i].profileId === profileId && this.tabs[i].groupId === tab.groupId) {
          lastGroupIdx = i
        }
      }
      if (lastGroupIdx >= 0) {
        this.tabs.splice(lastGroupIdx + 1, 0, tab)
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
    if (!isInternalDiaUrl(resolved) && !tab.favicon) {
      this.scheduleFaviconPreload(120)
    }
    return id
  }

  public switchTab(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab) return
    if (tab.profileId !== this.store.activeProfileId) {
      this.store.activeProfileId = tab.profileId
    }
    tab.lastAccessedAt = Date.now()

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
    if (!isInternalDiaUrl(tab.url)) {
      const view = this.views.has(tab.id)
        ? this.views.get(tab.id)
        : this.ensureViewForTab(tab, true)
      if (view && !view.webContents.isDestroyed() && !this.overlayActive) {
        view.webContents.focus()
      }
    } else if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.focus()
    }
    this.persistTabs()
    this.syncViewsLayout()
    this.syncWindowTitleBarOverlay()
    this.broadcastState()
    const curActive = this.getActiveTab()
    if (curActive && !isInternalDiaUrl(curActive.url) && !curActive.isLoading) {
      const targetId = curActive.id
      setTimeout(() => {
        void this.sampleTabRenderedAppearance(targetId)
      }, 90)
    }
  }

  public closeTab(tabId: string, options?: { silent?: boolean }): void {
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

    this.destroyTabView(tabId)

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
      void this.createTab(NEW_TAB_URL, { profileId })
      return
    }

    if (
      !this.activeTabByProfile[profileId] ||
      !remaining.some((t) => t.id === this.activeTabByProfile[profileId])
    ) {
      const sorted = [...remaining].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
      const nextTab = sorted[0]
      this.activeTabByProfile[profileId] = nextTab.id
      if (
        !options?.silent &&
        profileId === this.store.activeProfileId &&
        !isInternalDiaUrl(nextTab.url) &&
        !this.views.has(nextTab.id)
      ) {
        this.ensureViewForTab(nextTab, true)
      }
    }

    if (!options?.silent) {
      this.persistTabs()
      this.syncViewsLayout()
      this.broadcastState()
    }
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
      groupId: src.isPinned || src.isFavorite ? null : src.groupId
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
    tab.groupId = null

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
      this.closeTab(id, { silent: true })
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
      this.destroyTabView(t.id)
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
    const prevHost = PersistenceStore.extractHostKey(tab.url)
    const nextHost = PersistenceStore.extractHostKey(url)
    tab.url = url
    tab.isSensitive = isSensitiveUrl(url)
    if (prevHost !== nextHost) {
      tab.favicon = !isInternalDiaUrl(url) ? this.store.getCachedFavicon(url) : undefined
    }

    if (isInternalDiaUrl(url)) {
      this.destroyTabView(tab.id)
      if (url === NEW_TAB_URL) {
        tab.title = tr(this.store.settings.language, 'New Tab', '新标签页')
      } else {
        const tid = getChatThreadIdFromUrl(url)
        const th = tid ? this.store.threads.find((t) => t.id === tid) : undefined
        tab.title = th?.title || tr(this.store.settings.language, 'Arko Chat', 'Arko 对话')
      }
      tab.isLoading = false
      tab.canGoBack = false
      tab.canGoForward = false
      tab.isAudioPlaying = false
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
    this.syncWindowTitleBarOverlay()
    this.broadcastState()
    const curActive = this.getActiveTab()
    if (curActive && !isInternalDiaUrl(curActive.url) && !curActive.isLoading) {
      const targetId = curActive.id
      setTimeout(() => {
        void this.sampleTabRenderedAppearance(targetId)
      }, 90)
    }
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
    tabIds: string[] = [],
    options?: {
      parentId?: string | null
      profileId?: string
      zone?: 'pinned' | 'unpinned'
      keepEmpty?: boolean
    }
  ): TabGroup {
    const firstTab = tabIds.length > 0 ? this.tabs.find((t) => t.id === tabIds[0]) : undefined
    const parentGrp = options?.parentId
      ? this.tabGroups.find((g) => g.id === options.parentId)
      : undefined
    const profileId =
      options?.profileId ||
      parentGrp?.profileId ||
      firstTab?.profileId ||
      this.store.activeProfileId
    const validParent = parentGrp && parentGrp.profileId === profileId ? parentGrp : undefined
    const targetZone: 'pinned' | 'unpinned' =
      options?.zone ||
      (validParent
        ? this.resolveGroupZone(validParent)
        : firstTab && (firstTab.isPinned || firstTab.isFavorite)
          ? 'pinned'
          : 'unpinned')
    const targetIsPinned = targetZone === 'pinned'

    if (validParent && validParent.collapsed) {
      validParent.collapsed = false
    }

    const group: TabGroup = {
      id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      profileId,
      parentId: validParent ? validParent.id : null,
      zone: targetZone,
      keepEmpty: Boolean(options?.keepEmpty && tabIds.length === 0),
      title: title.trim() || '新文件夹',
      color: validParent ? validParent.color : color,
      collapsed: false
    }
    this.tabGroups.push(group)
    for (const tid of tabIds) {
      const tab = this.tabs.find((t) => t.id === tid && t.profileId === profileId)
      if (tab) {
        tab.groupId = group.id
        this.applyPinModeToTab(tab, targetIsPinned ? 'pinned' : 'unpinned')
        tab.groupId = group.id
      }
    }
    this.sortProfileTabsByTier(profileId)
    this.persistTabs()
    this.broadcastState()
    return group
  }

  public updateTabGroup(
    groupId: string,
    partial: Partial<Pick<TabGroup, 'title' | 'color' | 'collapsed' | 'parentId'>>
  ): TabGroup | null {
    const grp = this.tabGroups.find((g) => g.id === groupId)
    if (!grp) return null
    if (typeof partial.title === 'string' && partial.title.trim()) {
      grp.title = partial.title.trim()
    }
    if (partial.color) {
      grp.color = partial.color
    }
    if (typeof partial.collapsed === 'boolean') {
      grp.collapsed = partial.collapsed
    }
    if (partial.parentId !== undefined) {
      if (partial.parentId === null) {
        grp.parentId = null
      } else if (partial.parentId !== grp.id) {
        const candidateParent = this.tabGroups.find(
          (g) => g.id === partial.parentId && g.profileId === grp.profileId
        )
        if (
          candidateParent &&
          this.resolveGroupZone(candidateParent) === this.resolveGroupZone(grp)
        ) {
          // Ensure candidateParent is not a descendant of grp
          const byId = new Map(this.tabGroups.map((g) => [g.id, g]))
          let cur: TabGroup | undefined = candidateParent
          let isDescendant = false
          const seen = new Set<string>()
          while (cur && !seen.has(cur.id)) {
            seen.add(cur.id)
            if (cur.id === grp.id) {
              isDescendant = true
              break
            }
            cur = cur.parentId ? byId.get(cur.parentId) : undefined
          }
          if (!isDescendant) {
            grp.parentId = candidateParent.id
            if (candidateParent.collapsed) {
              candidateParent.collapsed = false
            }
          }
        }
      }
    }
    this.sanitizeTabGroupHierarchy()
    this.sortProfileTabsByTier(grp.profileId)
    this.persistTabs()
    this.broadcastState()
    return { ...grp }
  }

  public assignTabToGroup(tabId: string, groupId: string | null): void {
    const tabIdx = this.tabs.findIndex((t) => t.id === tabId)
    if (tabIdx === -1) return
    const tab = this.tabs[tabIdx]

    if (groupId === null) {
      const prevGroupId = tab.groupId
      tab.groupId = null
      if (prevGroupId) {
        let lastSiblingIdx = -1
        for (let i = 0; i < this.tabs.length; i++) {
          if (this.tabs[i].profileId === tab.profileId && this.tabs[i].groupId === prevGroupId) {
            lastSiblingIdx = i
          }
        }
        if (lastSiblingIdx >= 0) {
          const curIdx = this.tabs.findIndex((t) => t.id === tabId)
          if (curIdx >= 0 && curIdx < lastSiblingIdx) {
            const [removed] = this.tabs.splice(curIdx, 1)
            const newLastIdx = this.tabs.findIndex(
              (t, idx) =>
                t.profileId === tab.profileId &&
                t.groupId === prevGroupId &&
                !this.tabs.slice(idx + 1).some((x) => x.groupId === prevGroupId)
            )
            this.tabs.splice(newLastIdx >= 0 ? newLastIdx + 1 : curIdx, 0, removed)
          }
        }
      }
      this.sortProfileTabsByTier(tab.profileId)
      this.persistTabs()
      this.broadcastState()
      return
    }

    const grp = this.tabGroups.find((g) => g.id === groupId && g.profileId === tab.profileId)
    if (!grp) return
    if (grp.keepEmpty) {
      grp.keepEmpty = false
    }

    const siblings = this.tabs.filter(
      (t) => t.profileId === tab.profileId && t.groupId === groupId && t.id !== tab.id
    )
    if (siblings.length > 0) {
      const targetZone: TabPinMode = siblings[0].isPinned ? 'pinned' : 'unpinned'
      tab.groupId = groupId
      this.applyPinModeToTab(tab, targetZone)
      tab.groupId = groupId
      const curIdx = this.tabs.findIndex((t) => t.id === tab.id)
      if (curIdx >= 0) {
        const [removed] = this.tabs.splice(curIdx, 1)
        const lastSibling = siblings[siblings.length - 1]
        const dstIdx = this.tabs.findIndex((t) => t.id === lastSibling.id)
        if (dstIdx >= 0) {
          this.tabs.splice(dstIdx + 1, 0, removed)
        } else {
          this.tabs.push(removed)
        }
      }
    } else {
      const targetZone = this.resolveGroupZone(grp)
      tab.groupId = groupId
      this.applyPinModeToTab(tab, targetZone)
      tab.groupId = groupId
    }

    this.sortProfileTabsByTier(tab.profileId)
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
    const grp = this.tabGroups.find((g) => g.id === groupId)
    const fallbackParentId = grp?.parentId ?? null
    for (const childGrp of this.tabGroups) {
      if (childGrp.parentId === groupId) {
        childGrp.parentId = fallbackParentId
      }
    }
    for (const t of this.tabs) {
      if (t.groupId === groupId) t.groupId = fallbackParentId
    }
    this.tabGroups = this.tabGroups.filter((g) => g.id !== groupId)
    this.sanitizeTabGroupHierarchy()
    this.sortProfileTabsByTier(grp?.profileId)
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

    // Replace active profile's unpinned groups with freshly organized groups (keep Pinned folders intact!)
    const pinnedGroupIds = new Set<string>()
    const byId = new Map(this.tabGroups.map((g) => [g.id, g]))
    for (const t of this.tabs) {
      if (t.profileId === profileId && t.isPinned && !t.isFavorite && t.groupId) {
        let cur: string | null = t.groupId
        const seen = new Set<string>()
        while (cur && !seen.has(cur)) {
          seen.add(cur)
          pinnedGroupIds.add(cur)
          cur = byId.get(cur)?.parentId ?? null
        }
      }
    }
    this.tabGroups = this.tabGroups.filter(
      (g) => g.profileId !== profileId || pinnedGroupIds.has(g.id) || g.zone === 'pinned'
    )
    for (const t of candidateTabs) {
      t.groupId = null
    }

    const newGroupOrder = new Map<string, number>()
    res.groups.forEach((g, idx) => {
      const grpId = `grp-${Date.now()}-${idx}`
      this.tabGroups.push({
        id: grpId,
        profileId,
        parentId: null,
        zone: 'unpinned',
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
    this.scheduleFaviconPreload(120)
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
      this.destroyTabView(t.id)
    }

    this.tabs = this.tabs.filter((t) => t.profileId !== profileId)
    this.tabGroups = this.tabGroups.filter((g) => g.profileId !== profileId)
    delete this.activeTabByProfile[profileId]
    delete this.splitByProfile[profileId]
    delete this.closedTabsByProfile[profileId]
    delete this.connectedToolsByProfile[profileId]

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

    if ('theme' in partial) {
      this.syncWindowTitleBarOverlay()
    }
    if (
      'theme' in partial ||
      'selectionToolbarEnabled' in partial ||
      'sensitiveSiteGuard' in partial ||
      'language' in partial
    ) {
      this.syncAllViewsOverlayConfig()
    }

    this.broadcastState()

    if (
      'autoConnectLoggedInApps' in partial ||
      'manuallyConnectedTools' in partial ||
      'manuallyDisconnectedTools' in partial
    ) {
      void this.refreshConnectedTools(this.store.activeProfileId, true)
    }
    return next
  }

  private async sampleTabRenderedAppearance(tabId: string): Promise<void> {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab || isInternalDiaUrl(tab.url)) return
    const view = this.views.get(tabId)
    const layout = this.appliedViewLayout.get(tabId)
    if (!view || view.webContents.isDestroyed() || !layout?.visible) return
    if (layout.width < 60 || layout.height < 60) return

    try {
      const image = await view.webContents.capturePage()
      if (image.isEmpty()) return
      const gridW = 24
      const gridH = 24
      const small = image.resize({ width: gridW, height: gridH, quality: 'good' })
      const sz = small.getSize()
      const buf = small.toBitmap()
      if (sz.width < 4 || sz.height < 4 || buf.length < sz.width * sz.height * 4) return

      let lightPixels = 0
      let totalPixels = 0
      let topR = 0
      let topG = 0
      let topB = 0
      let topCount = 0

      for (let y = 0; y < sz.height; y++) {
        for (let x = 0; x < sz.width; x++) {
          const idx = (y * sz.width + x) * 4
          // Chromium Skia kN32_SkColorType on little-endian desktop platforms is BGRA
          const b = buf[idx]
          const g = buf[idx + 1]
          const r = buf[idx + 2]
          const a = buf[idx + 3]
          if (a < 16) continue
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
          totalPixels++
          if (lum >= 0.48) {
            lightPixels++
          }
          if (y === 0) {
            topR += r
            topG += g
            topB += b
            topCount++
          }
        }
      }

      if (totalPixels < 8) return
      const nextTone: 'light' | 'dark' = lightPixels >= totalPixels * 0.5 ? 'light' : 'dark'
      let nextTopHex = tab.pageTopColor || null
      if (topCount > 0) {
        const toHex = (n: number): string =>
          Math.max(0, Math.min(255, Math.round(n)))
            .toString(16)
            .padStart(2, '0')
        nextTopHex = `#${toHex(topR / topCount)}${toHex(topG / topCount)}${toHex(
          topB / topCount
        )}`.toUpperCase()
      }

      if (tab.pageTone !== nextTone || tab.pageTopColor !== nextTopHex) {
        tab.pageTone = nextTone
        tab.pageTopColor = nextTopHex
        this.persistTabs()
        this.syncWindowTitleBarOverlay()
        this.scheduleBroadcast(20)
      }
    } catch {
      // ignore transient capture errors
    }
  }

  public syncWindowTitleBarOverlay(): void {
    const desiredSource = this.store.settings.theme || 'system'
    if (nativeTheme.themeSource !== desiredSource) {
      nativeTheme.themeSource = desiredSource
    }
    if (process.platform === 'darwin' || this.mainWindow.isDestroyed()) return
    if (typeof this.mainWindow.setTitleBarOverlay === 'function') {
      const active = this.getActiveTab()
      const isVert = this.store.settings.layoutMode === 'vertical'
      const barDark =
        isVert && active && !isInternalDiaUrl(active.url) && active.pageTone
          ? active.pageTone === 'dark'
          : this.isEffectiveDark()
      try {
        this.mainWindow.setTitleBarOverlay({
          color: barDark ? (isVert ? '#111113' : '#19191B') : isVert ? '#FFFFFF' : '#F4F4F5',
          symbolColor: barDark ? '#E4E4E7' : '#27272A',
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
    return detectAllBrowsers(this.store.settings.language)
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
          : ['openDirectory', 'showHiddenFiles'],
      filters: [
        {
          name: 'Browser Data / Bookmarks',
          extensions: ['json', 'html', 'htm', 'ini', 'sqlite', 'plist', 'db']
        },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (canceled || !filePaths || filePaths.length === 0) return null
    return inspectBrowserAtPath(browserId, filePaths[0], true, lang)
  }

  private emitImportProgress(
    stage: ImportProgressStage,
    percent: number,
    detail: string,
    detailZh: string
  ): void {
    if (this.mainWindow.isDestroyed()) return
    const payload: BrowserImportProgressPayload = {
      stage,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      detail,
      detailZh
    }
    try {
      this.mainWindow.webContents.send('arko:import-progress', payload)
    } catch {
      // ignore
    }
  }

  private getActiveConfiguredSessions(): Array<[string, Electron.Session]> {
    const partitions = new Set<string>()
    for (const p of this.store.profiles) {
      if (p.partition) partitions.add(p.partition)
    }
    return [...partitions].map((part) => [part, this.ensureSessionConfigured(part)])
  }

  // ==================== Browser Extensions Public Operations ====================

  public getExtensions(): InstalledExtensionItem[] {
    const activeProf =
      this.store.profiles.find((p) => p.id === this.store.activeProfileId) ||
      this.store.profiles[0]
    const part = activeProf?.partition || 'persist:arko-profile-work'
    return this.extensionManager.getExtensionsSnapshotForPartition(part)
  }

  public async installUnpackedExtension(): Promise<{
    ok: boolean
    extension?: InstalledExtensionItem
    error?: string
  }> {
    const res = await this.extensionManager.pickAndInstallUnpackedExtension(
      this.mainWindow,
      this.getActiveConfiguredSessions(),
      this.store.settings.language
    )
    if (res.ok) {
      this.broadcastState()
    }
    return res
  }

  public async installWebStoreExtension(urlOrId: string): Promise<{
    ok: boolean
    extension?: InstalledExtensionItem
    error?: string
  }> {
    const res = await this.extensionManager.installFromChromeWebStore(
      urlOrId,
      this.getActiveConfiguredSessions(),
      this.store.settings.language
    )
    if (res.ok) {
      this.broadcastState()
    }
    return res
  }

  public async toggleExtension(
    extensionId: string,
    enabled: boolean
  ): Promise<InstalledExtensionItem[]> {
    await this.extensionManager.toggleExtension(
      extensionId,
      enabled,
      this.getActiveConfiguredSessions()
    )
    this.broadcastState()
    return this.getExtensions()
  }

  public async removeExtension(extensionId: string): Promise<InstalledExtensionItem[]> {
    await this.extensionManager.removeExtension(extensionId, this.getActiveConfiguredSessions())
    this.broadcastState()
    return this.getExtensions()
  }

  public async openExtensionPopup(
    extensionId: string,
    anchor?: { x: number; y: number }
  ): Promise<{ ok: boolean; openedTab?: boolean; error?: string }> {
    const activeProf =
      this.store.profiles.find((p) => p.id === this.store.activeProfileId) ||
      this.store.profiles[0]
    if (!activeProf) {
      return { ok: false, error: 'No active profile' }
    }
    const ses = this.ensureSessionConfigured(activeProf.partition)
    await this.extensionManager.ensureExtensionsLoadedForSession(activeProf.partition, ses)
    const item = this.store.extensions.find((e) => e.id === extensionId)
    if (!item) {
      return { ok: false, error: 'Extension not found' }
    }

    return this.extensionManager.openPopupWindow({
      parentWindow: this.mainWindow,
      partition: activeProf.partition,
      ses,
      item,
      anchor,
      onOpenUrlInTab: (url) => {
        void this.createTab(url, { background: false })
      }
    })
  }

  public async openExtensionOptions(extensionId: string): Promise<boolean> {
    const activeProf =
      this.store.profiles.find((p) => p.id === this.store.activeProfileId) ||
      this.store.profiles[0]
    if (!activeProf) return false
    const ses = this.ensureSessionConfigured(activeProf.partition)
    await this.extensionManager.ensureExtensionsLoadedForSession(activeProf.partition, ses)
    const item = this.store.extensions.find((e) => e.id === extensionId)
    if (!item) return false
    const runtimeId = this.extensionManager.resolveRuntimeExtensionId(activeProf.partition, item)
    if (runtimeId && item.optionsPath) {
      await this.createTab(`chrome-extension://${runtimeId}/${item.optionsPath}`, {
        background: false
      })
      return true
    }
    if (runtimeId && item.popupPath) {
      await this.createTab(`chrome-extension://${runtimeId}/${item.popupPath}`, {
        background: false
      })
      return true
    }
    if (item.homepageUrl) {
      await this.createTab(item.homepageUrl, { background: false })
      return true
    }
    return false
  }

  public completeOnboarding(): AppSettings {
    return this.updateSettings({ onboardingCompleted: true })
  }

  public resetOnboardingState(): BrowserSnapshotState {
    for (const tabId of Array.from(this.views.keys())) {
      this.destroyTabView(tabId)
    }
    this.views.clear()
    this.appliedViewLayout.clear()
    this.consoleLogsByTab.clear()
    this.connectedToolsByProfile = {}

    this.store.profiles = structuredClone(DEFAULT_PROFILES)
    this.store.activeProfileId = 'work'
    this.store.saveProfiles()

    const initTabId = `initial-tab-work-${Date.now().toString(36)}`
    this.tabs = [
      {
        id: initTabId,
        profileId: 'work',
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
      }
    ]
    this.tabGroups = []
    this.activeTabByProfile = { work: initTabId }
    this.splitByProfile = {
      work: createDefaultSplitState(),
      personal: createDefaultSplitState()
    }
    this.closedTabsByProfile = {}

    this.store.bookmarks = [
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
    ]
    this.store.saveBookmarks()
    this.store.clearHistory()

    this.store.saveSettings({
      ...this.store.settings,
      onboardingCompleted: false
    })

    this.persistTabs()
    this.syncViewsLayout()
    this.broadcastState()
    return this.getSnapshot()
  }

  public async executeBrowserImport(request: BrowserImportRequest): Promise<BrowserImportResult> {
    this.emitImportProgress(
      'parsing',
      12,
      `Scanning ${request.browserId.toUpperCase()} Spaces, Profiles, and Sidebar tree…`,
      `正在深度解析原浏览器空间结构、Profile 拓扑与侧边栏目录…`
    )

    const parsed = parseBrowserDataForImport(request, this.store.settings.language)
    if (!parsed.ok) {
      return {
        ok: false,
        browserId: request.browserId,
        spacesCreated: 0,
        favoritesImported: 0,
        pinnedTabsImported: 0,
        openTabsImported: 0,
        tabGroupsCreated: 0,
        cookiesImported: 0,
        storageProfilesMigrated: 0,
        extensionsImported: 0,
        bookmarksImported: 0,
        historyImported: 0,
        warnings: parsed.warnings,
        error: parsed.error
      }
    }

    const warnings = [...parsed.warnings]
    const groupColors: TabGroupColor[] = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet']
    let groupColorCursor = this.tabGroups.length
    let spacesCreated = 0
    let favoritesImported = 0
    let pinnedTabsImported = 0
    let openTabsImported = 0
    let tabGroupsCreated = 0
    let cookiesImported = 0
    let storageProfilesMigrated = 0
    let extensionsImported = 0
    let bookmarksImported = 0
    let historyImported = 0
    const importedProfileOrder: string[] = []

    const wantOpenTabs = request.scopes.openTabs !== false
    const wantSessions = Boolean(request.scopes.sessions)
    const wantExtensions = Boolean(request.scopes.extensions)
    const shouldReplaceStarterSpaces = request.replaceStarterSpaces !== false

    // Preserve Arc's M-Spaces-to-N-Profiles cookie/session/extension sharing:
    // Spaces bound to the same source Chromium Profile share one deterministic Electron session partition.
    const partitionBySourceProfile = new Map<string, string>()

    // Pre-assign clean partitions for each source Chromium Profile BEFORE touching `session.fromPartition`
    // so LocalStorage / IndexedDB / Extension Settings can be copied onto disk lock-free!
    if (request.createSpacesFromProfiles) {
      for (const res of parsed.profileResources) {
        const sourceProfileKey = `${request.browserId}:${res.profileDir}`
        const safeSlug =
          res.profileDir
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'default'
        let chosenPartition = `persist:arko-${request.browserId}-${safeSlug}`

        // Check if any existing profile already uses this sourceProfileKey
        const existingBound = this.store.profiles.find(
          (p) => p.sourceProfileKey === sourceProfileKey
        )
        if (existingBound) {
          chosenPartition = existingBound.partition
        }

        // If user explicitly requested session/storage migration and this partition was already opened in memory,
        // rotate to a fresh partition generation after closing views so LevelDB loads the newly copied storage immediately!
        if (wantSessions && BrowserManager.configuredPartitions.has(chosenPartition)) {
          for (const t of this.tabs) {
            const prof = this.store.profiles.find((p) => p.id === t.profileId)
            if (prof?.partition === chosenPartition) {
              this.destroyTabView(t.id)
            }
          }
          chosenPartition = `persist:arko-${request.browserId}-${safeSlug}-${Date.now().toString(36)}`
        }

        partitionBySourceProfile.set(sourceProfileKey, chosenPartition)
      }
    } else if (parsed.profileResources.length > 0) {
      // Merging into active profile
      const activeProf =
        this.store.profiles.find((p) => p.id === this.store.activeProfileId) ||
        this.store.profiles[0]
      if (activeProf) {
        for (const res of parsed.profileResources) {
          partitionBySourceProfile.set(`${request.browserId}:${res.profileDir}`, activeProf.partition)
        }
      }
    }

    this.emitImportProgress(
      'spaces',
      28,
      `Aligning ${parsed.spaces.length} Spaces in exact sidebar order…`,
      `正在按原浏览器顺序对齐 ${parsed.spaces.length} 个空间与独立配置环境…`
    )

    const isFreshOnboarding = !this.store.settings.onboardingCompleted
    const totalIncomingBookmarks = parsed.spaces.reduce((s, sp) => s + sp.bookmarks.length, 0)
    if (request.scopes.bookmarks && totalIncomingBookmarks > 0) {
      const demoIds = new Set(['bm-arko-github', 'bm-github', 'bm-hn'])
      if (this.store.bookmarks.length > 0 && this.store.bookmarks.every((b) => demoIds.has(b.id))) {
        this.store.bookmarks = []
      }
    }

    // Phase A: Copy disk-level Site Storage (Local Storage, IndexedDB, Extension Settings) BEFORE opening sessions
    if (wantSessions || wantExtensions) {
      this.emitImportProgress(
        'sessions',
        42,
        `Migrating Profile LocalStorage, IndexedDB & Extension data…`,
        `正在迁移 Profile 本地站点存储 (LocalStorage / IndexedDB) 与插件数据…`
      )
      const copiedPartitions = new Set<string>()
      for (const res of parsed.profileResources) {
        const sourceKey = `${request.browserId}:${res.profileDir}`
        const targetPartition = partitionBySourceProfile.get(sourceKey)
        if (!targetPartition || copiedPartitions.has(targetPartition)) continue
        copiedPartitions.add(targetPartition)

        // Only write LevelDB files directly if Electron hasn't locked the partition yet
        if (!BrowserManager.configuredPartitions.has(targetPartition)) {
          if (wantSessions) {
            const copied = copyChromiumSiteStorageToPartition(
              res.profileDirPath,
              targetPartition,
              wantExtensions
            )
            if (copied.filesCopied > 0) {
              storageProfilesMigrated++
            }
          } else if (wantExtensions) {
            // Only copy extension storage settings
            copyChromiumSiteStorageToPartition(res.profileDirPath, targetPartition, true)
          }
        }
      }
    }

    const historyMap = new Map<string, (typeof this.store.history)[number]>()
    for (const h of this.store.history) {
      historyMap.set(`${h.profileId}::${h.url}`, h)
    }

    const usedProfileIds = new Set<string>()

    // Phase B: Create / Update Spaces in exact parsed order & import Tabs / Folders / Bookmarks / History
    parsed.spaces.forEach((spacePayload, spaceIdx) => {
      let targetProfileId = this.store.activeProfileId
      const sourceProfileKey = spacePayload.profileDir
        ? `${request.browserId}:${spacePayload.profileDir}`
        : undefined
      const profileLabel = spacePayload.profileName || spacePayload.profileDir

      if (request.createSpacesFromProfiles) {
        const normalizedIncoming = spacePayload.name.trim().toLowerCase()
        // Match existing space that wasn't already claimed by an earlier space in this import
        const matchedExisting = this.store.profiles.find(
          (p) =>
            !usedProfileIds.has(p.id) &&
            p.name.trim().toLowerCase() === normalizedIncoming &&
            (!p.sourceProfileKey || !sourceProfileKey || p.sourceProfileKey === sourceProfileKey)
        )

        if (matchedExisting) {
          targetProfileId = matchedExisting.id
          usedProfileIds.add(targetProfileId)
          if (spacePayload.emoji) matchedExisting.emoji = spacePayload.emoji
          if (spacePayload.accentColor) matchedExisting.accentColor = spacePayload.accentColor
          if (profileLabel) matchedExisting.profileLabel = profileLabel
          if (sourceProfileKey) {
            matchedExisting.sourceProfileKey = sourceProfileKey
            const sharedPartition = partitionBySourceProfile.get(sourceProfileKey)
            if (sharedPartition) {
              matchedExisting.partition = sharedPartition
            } else {
              partitionBySourceProfile.set(sourceProfileKey, matchedExisting.partition)
            }
          }
        } else {
          const slug = `profile-${request.browserId}-${Date.now().toString(36)}-${spaceIdx}`
          let partition = `persist:arko-profile-${slug}`
          if (sourceProfileKey) {
            const sharedPartition = partitionBySourceProfile.get(sourceProfileKey)
            if (sharedPartition) {
              partition = sharedPartition
            } else {
              partitionBySourceProfile.set(sourceProfileKey, partition)
            }
          }
          const createdProfile: BrowserProfile = {
            id: slug,
            name: spacePayload.name.trim() || `Space ${spaceIdx + 1}`,
            emoji: spacePayload.emoji || '✨',
            accentColor: spacePayload.accentColor || '#4F46E5',
            partition,
            profileLabel,
            sourceProfileKey
          }
          this.store.profiles.push(createdProfile)
          targetProfileId = slug
          usedProfileIds.add(slug)
          spacesCreated++
          this.splitByProfile[slug] = createDefaultSplitState()
        }
      }

      if (!importedProfileOrder.includes(targetProfileId)) {
        importedProfileOrder.push(targetProfileId)
      }

      // 1. Merge Favorites & Pinned Tabs + Nested Folder TabGroups (lazy WebContentsView: 0 RAM until clicked)
      if (request.scopes.spacesAndPinned) {
        const existingProfileTabs = this.tabs.filter((t) => t.profileId === targetProfileId)
        const existingFavUrls = new Set(
          existingProfileTabs.filter((t) => t.isFavorite).map((t) => t.pinnedUrl || t.url)
        )
        let currentFavCount = existingFavUrls.size

        for (const fav of spacePayload.favorites) {
          if (currentFavCount >= 12) break
          if (existingFavUrls.has(fav.url)) continue
          existingFavUrls.add(fav.url)
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

        const extractFolderSegments = (item: {
          folderPath?: string[] | null
          folderTitle?: string | null
        }): string[] => {
          if (Array.isArray(item.folderPath) && item.folderPath.length > 0) {
            return item.folderPath.map((s) => s.trim()).filter(Boolean)
          }
          if (item.folderTitle && item.folderTitle.trim()) {
            return item.folderTitle
              .split(' / ')
              .map((s) => s.trim())
              .filter(Boolean)
          }
          return []
        }

        // Count direct items per folder path so large leaf folders (>6 items) start neatly collapsed,
        // while parent folders that hold subfolders start expanded so hierarchy is visible immediately
        const directFolderSizes = new Map<string, number>()
        const parentPathSet = new Set<string>()
        for (const pt of spacePayload.pinnedTabs) {
          const segs = extractFolderSegments(pt)
          if (segs.length > 0) {
            const normKey = segs.map((s) => s.toLowerCase()).join(' / ')
            directFolderSizes.set(normKey, (directFolderSizes.get(normKey) || 0) + 1)
            for (let d = 1; d < segs.length; d++) {
              parentPathSet.add(
                segs
                  .slice(0, d)
                  .map((s) => s.toLowerCase())
                  .join(' / ')
              )
            }
          }
        }

        const ensureFolderHierarchy = (
          zone: 'pinned' | 'unpinned',
          segments: string[],
          collapseLeaf: boolean
        ): TabGroup => {
          let parentGrp: TabGroup | null = null
          for (let d = 0; d < segments.length; d++) {
            const segTitle = segments[d]
            const parentId: string | null = parentGrp ? parentGrp.id : null
            let existing: TabGroup | undefined = this.tabGroups.find(
              (g) =>
                g.profileId === targetProfileId &&
                (g.parentId || null) === parentId &&
                (g.zone || 'pinned') === zone &&
                g.title.trim().toLowerCase() === segTitle.toLowerCase()
            )
            const isLeaf = d === segments.length - 1
            if (!existing) {
              existing = {
                id: `grp-imp-${zone === 'unpinned' ? 'open-' : ''}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                profileId: targetProfileId,
                parentId,
                zone,
                title: segTitle,
                color: parentGrp
                  ? parentGrp.color
                  : groupColors[groupColorCursor++ % groupColors.length],
                collapsed: isLeaf ? collapseLeaf : false
              }
              this.tabGroups.push(existing)
              tabGroupsCreated++
            } else if (!isLeaf && existing.collapsed) {
              existing.collapsed = false
            }
            parentGrp = existing
          }
          return parentGrp!
        }

        // Deduplicate within the same full folder path (`normPath::url`) so links in different folders are never lost
        const existingPinnedKeys = new Set(
          existingProfileTabs
            .filter((t) => t.isPinned && !t.isFavorite)
            .map((t) => {
              const gPath = t.groupId ? this.getGroupFullPathTitle(t.groupId).toLowerCase() : ''
              return `${gPath}::${t.pinnedUrl || t.url}`
            })
        )

        let addedPinnedInSpace = 0
        for (const pt of spacePayload.pinnedTabs) {
          if (addedPinnedInSpace >= 800) break
          const segs = extractFolderSegments(pt)
          const normFolder = segs.map((s) => s.toLowerCase()).join(' / ')
          const dedupKey = `${normFolder}::${pt.url}`
          if (existingPinnedKeys.has(dedupKey)) continue
          existingPinnedKeys.add(dedupKey)
          addedPinnedInSpace++
          pinnedTabsImported++

          let groupId: string | null = null
          if (segs.length > 0) {
            const hasSubfolders = parentPathSet.has(normFolder)
            const collapseLeaf = !hasSubfolders && (directFolderSizes.get(normFolder) || 0) > 6
            const grp = ensureFolderHierarchy('pinned', segs, collapseLeaf)
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
            isFavorite: !groupId,
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

      // 1b. Merge Today / Unpinned Open Tabs (also hibernated with 0 RAM until clicked)
      if (wantOpenTabs && spacePayload.openTabs.length > 0) {
        const existingUnpinnedUrls = new Set(
          this.tabs
            .filter((t) => t.profileId === targetProfileId && !t.isPinned && !t.isFavorite)
            .map((t) => t.url)
        )

        let addedOpenInSpace = 0
        for (const ot of spacePayload.openTabs) {
          if (addedOpenInSpace >= 200) break
          if (existingUnpinnedUrls.has(ot.url)) continue
          existingUnpinnedUrls.add(ot.url)
          addedOpenInSpace++
          openTabsImported++

          let groupId: string | null = null
          const segs =
            Array.isArray(ot.folderPath) && ot.folderPath.length > 0
              ? ot.folderPath.map((s) => s.trim()).filter(Boolean)
              : ot.folderTitle?.trim()
                ? ot.folderTitle
                    .split(' / ')
                    .map((s) => s.trim())
                    .filter(Boolean)
                : []
          if (segs.length > 0) {
            let parentGrp: TabGroup | null = null
            for (let d = 0; d < segs.length; d++) {
              const segTitle = segs[d]
              const parentId: string | null = parentGrp ? parentGrp.id : null
              let existing: TabGroup | undefined = this.tabGroups.find(
                (g) =>
                  g.profileId === targetProfileId &&
                  (g.parentId || null) === parentId &&
                  g.zone === 'unpinned' &&
                  g.title.trim().toLowerCase() === segTitle.toLowerCase()
              )
              if (!existing) {
                existing = {
                  id: `grp-imp-open-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                  profileId: targetProfileId,
                  parentId,
                  zone: 'unpinned',
                  title: segTitle,
                  color: parentGrp
                    ? parentGrp.color
                    : groupColors[groupColorCursor++ % groupColors.length],
                  collapsed: false
                }
                this.tabGroups.push(existing)
                tabGroupsCreated++
              }
              parentGrp = existing
            }
            groupId = parentGrp!.id
          }

          this.tabs.push({
            id: `tab-imp-open-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            profileId: targetProfileId,
            url: ot.url,
            title: ot.title || ot.url,
            favicon: ot.favicon,
            isLoading: false,
            canGoBack: false,
            canGoForward: false,
            isPinned: false,
            isFavorite: false,
            pinnedUrl: null,
            isAudioPlaying: false,
            isMuted: false,
            isSensitive: isSensitiveUrl(ot.url),
            lastAccessedAt: Date.now() - 1000 - openTabsImported,
            groupId,
            zoomFactor: 1
          })
        }
      }

      // Ensure each target Space has a valid active tab and prune redundant blank New Tab placeholders
      let spaceTabs = this.tabs.filter((t) => t.profileId === targetProfileId)
      const hasWebTabs = spaceTabs.some(
        (t) => t.url !== NEW_TAB_URL || t.isPinned || t.isFavorite
      )
      if (hasWebTabs) {
        this.tabs = this.tabs.filter(
          (t) => t.profileId !== targetProfileId || t.url !== NEW_TAB_URL || t.isPinned || t.isFavorite
        )
        spaceTabs = this.tabs.filter((t) => t.profileId === targetProfileId)
      }
      if (spaceTabs.length === 0) {
        const initTabId = `tab-${targetProfileId}-${Date.now()}-${spaceIdx}`
        this.tabs.push({
          id: initTabId,
          profileId: targetProfileId,
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
        this.activeTabByProfile[targetProfileId] = initTabId
      } else if (
        !this.activeTabByProfile[targetProfileId] ||
        !spaceTabs.some((t) => t.id === this.activeTabByProfile[targetProfileId])
      ) {
        // Prefer selecting an unpinned Today tab or clean New Tab so pinned URLs stay untouched until clicked
        const firstUnpinned = spaceTabs.find((t) => !t.isPinned && !t.isFavorite)
        if (firstUnpinned) {
          this.activeTabByProfile[targetProfileId] = firstUnpinned.id
        } else {
          // Add a lightweight New Tab as initial landing canvas so no web tab auto-loads unprompted
          const landingId = `tab-landing-${targetProfileId}-${Date.now().toString(36)}`
          this.tabs.push({
            id: landingId,
            profileId: targetProfileId,
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
          this.activeTabByProfile[targetProfileId] = landingId
        }
      }

      if (!this.splitByProfile[targetProfileId]) {
        this.splitByProfile[targetProfileId] = createDefaultSplitState()
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

    this.emitImportProgress(
      'tabs',
      66,
      `Synced ${favoritesImported + pinnedTabsImported + openTabsImported} tabs & ${tabGroupsCreated} folders…`,
      `已还原 ${favoritesImported + pinnedTabsImported + openTabsImported} 个标签与 ${tabGroupsCreated} 个折叠目录…`
    )

    // Phase C: Decrypt & Inject Chromium Cookies into each target Electron Session
    if (wantSessions && parsed.profileResources.length > 0) {
      this.emitImportProgress(
        'sessions',
        76,
        `Decrypting & injecting account login Cookies…`,
        `正在注入各 Profile 账号登录态 Cookie…`
      )
      let cachedKeyResult: CookieKeyDerivationResult | undefined
      const processedCookiePartitions = new Set<string>()

      for (const res of parsed.profileResources) {
        const sourceKey = `${request.browserId}:${res.profileDir}`
        const targetPartition = partitionBySourceProfile.get(sourceKey)
        if (!targetPartition || processedCookiePartitions.has(targetPartition)) continue
        processedCookiePartitions.add(targetPartition)

        const targetSes = this.ensureSessionConfigured(targetPartition)
        const cookieRes = await migrateChromiumCookiesToSession({
          profileDirPath: res.profileDirPath,
          browserId: request.browserId,
          targetSession: targetSes,
          querySqlite: querySqliteSafely,
          cachedKeyResult
        })
        cachedKeyResult = cookieRes.keyResult
        cookiesImported += cookieRes.cookiesImported
        for (const w of cookieRes.warnings) {
          if (!warnings.includes(w)) warnings.push(w)
        }
      }
    }

    // Phase D: Stage & Activate Browser Extensions in target Electron Sessions
    if (wantExtensions && parsed.profileResources.length > 0) {
      this.emitImportProgress(
        'extensions',
        88,
        `Installing & activating browser extensions…`,
        `正在装载浏览器扩展插件生态与本地配置…`
      )
      const stagedIds = new Set<string>()
      const partitionsToLoad = new Set<string>()

      for (const res of parsed.profileResources) {
        const sourceKey = `${request.browserId}:${res.profileDir}`
        const targetPartition = partitionBySourceProfile.get(sourceKey)
        const partList = targetPartition ? [targetPartition] : ['*']
        if (targetPartition) partitionsToLoad.add(targetPartition)

        for (const ext of res.extensions) {
          const staged = this.extensionManager.stageImportedExtension(
            ext,
            partList,
            request.browserId
          )
          if (staged && !stagedIds.has(staged.id)) {
            stagedIds.add(staged.id)
            extensionsImported++
          }
        }
      }

      this.store.saveExtensions()
      for (const part of partitionsToLoad) {
        const ses = this.ensureSessionConfigured(part)
        await this.extensionManager.ensureExtensionsLoadedForSession(part, ses)
      }
    }

    this.emitImportProgress(
      'library',
      95,
      `Indexing ${bookmarksImported} bookmarks & ${historyImported} history items…`,
      `正在构建书签与 @History 历史检索索引…`
    )

    if (request.scopes.history && historyImported > 0) {
      this.store.history = [...historyMap.values()]
        .sort((a, b) => b.visitedAt - a.visitedAt)
        .slice(0, 2500)
      this.store.saveHistory()
    }

    if (bookmarksImported > 0 || isFreshOnboarding) {
      this.store.saveBookmarks()
    }

    // Phase E: Guarantee 1:1 Space Order Alignment with Arc & Clean Up Empty Starter Spaces
    if (request.createSpacesFromProfiles && importedProfileOrder.length > 0) {
      const importedSet = new Set(importedProfileOrder)

      if (shouldReplaceStarterSpaces) {
        const removableStarterIds = this.store.profiles
          .filter((p) => {
            if (importedSet.has(p.id)) return false
            const isDefaultStarter = p.id === 'personal' || p.id === 'work'
            if (!isDefaultStarter && !isFreshOnboarding) return false
            // Only remove if this starter space has zero real user web tabs
            const pTabs = this.tabs.filter((t) => t.profileId === p.id)
            return pTabs.every((t) => isInternalDiaUrl(t.url) && !t.isPinned && !t.isFavorite)
          })
          .map((p) => p.id)

        if (removableStarterIds.length > 0) {
          const removedSet = new Set(removableStarterIds)
          for (const t of this.tabs) {
            if (removedSet.has(t.profileId)) {
              this.destroyTabView(t.id)
            }
          }
          this.tabs = this.tabs.filter((t) => !removedSet.has(t.profileId))
          this.tabGroups = this.tabGroups.filter((g) => !removedSet.has(g.profileId))
          for (const rid of removableStarterIds) {
            delete this.activeTabByProfile[rid]
            delete this.splitByProfile[rid]
            delete this.closedTabsByProfile[rid]
            delete this.connectedToolsByProfile[rid]
          }
          this.store.profiles = this.store.profiles.filter((p) => !removedSet.has(p.id))
        }
      }

      // Place imported Spaces FIRST in exact Arc order, followed by any kept custom profiles
      const orderedImported: BrowserProfile[] = []
      for (const pid of importedProfileOrder) {
        const found = this.store.profiles.find((p) => p.id === pid)
        if (found) orderedImported.push(found)
      }
      const remainingCustom = this.store.profiles.filter((p) => !importedSet.has(p.id))
      if (orderedImported.length > 0) {
        this.store.profiles = [...orderedImported, ...remainingCustom]
      }
    }

    this.store.saveProfiles()
    this.sortProfileTabsByTier()

    const firstTargetProfileId = importedProfileOrder[0] || null
    if (firstTargetProfileId && this.store.profiles.some((p) => p.id === firstTargetProfileId)) {
      this.store.activeProfileId = firstTargetProfileId
    }

    const nextSettings: Partial<AppSettings> = {
      onboardingCompleted: true,
      lastImportedBrowser: request.browserId,
      lastImportedAt: Date.now()
    }
    if (favoritesImported > 0 || pinnedTabsImported > 0 || spacesCreated > 0) {
      nextSettings.layoutMode = 'vertical'
      nextSettings.sidebarCollapsed = false
    }
    this.store.saveSettings({
      ...this.store.settings,
      ...nextSettings
    })

    this.hydrateCachedFaviconsSync()
    this.persistTabs()
    this.syncViewsLayout()
    this.scheduleFaviconPreload(250)
    void this.refreshConnectedTools(this.store.activeProfileId, false).then(() => {
      this.broadcastState()
    })
    this.broadcastState()

    this.emitImportProgress(
      'done',
      100,
      `Migration complete — your digital workspace is ready!`,
      `数据与生态迁移已全部就绪！`
    )

    const importedSpacesSummary = importedProfileOrder
      .map((pid) => this.store.profiles.find((p) => p.id === pid))
      .filter((p): p is BrowserProfile => Boolean(p))
      .map((p) => ({
        id: p.id,
        name: p.name,
        emoji: p.emoji,
        accentColor: p.accentColor,
        profileLabel: p.profileLabel
      }))

    return {
      ok: true,
      browserId: request.browserId,
      spacesCreated,
      profilesShared: partitionBySourceProfile.size,
      favoritesImported,
      pinnedTabsImported,
      openTabsImported,
      tabGroupsCreated,
      cookiesImported,
      storageProfilesMigrated,
      extensionsImported,
      bookmarksImported,
      historyImported,
      importedSpaces: importedSpacesSummary,
      warnings
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

    let pendingDelta = ''
    let flushTimer: NodeJS.Timeout | null = null
    const flushInlineBuffer = (): void => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      if (pendingDelta && !this.mainWindow.isDestroyed()) {
        const text = pendingDelta
        pendingDelta = ''
        this.mainWindow.webContents.send('arko:inline-write-chunk', {
          requestId: params.requestId,
          deltaContent: text
        } satisfies InlineWriteStreamPayload)
      }
    }

    const sendChunk = (payload: InlineWriteStreamPayload): void => {
      if (this.mainWindow.isDestroyed()) return
      if (payload.deltaContent && !payload.done && !payload.error) {
        pendingDelta += payload.deltaContent
        if (!flushTimer) {
          flushTimer = setTimeout(flushInlineBuffer, 16)
        }
        return
      }
      if (payload.deltaContent) {
        pendingDelta += payload.deltaContent
      }
      flushInlineBuffer()
      this.mainWindow.webContents.send('arko:inline-write-chunk', {
        ...payload,
        deltaContent: undefined
      })
    }

    try {
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
    } finally {
      flushInlineBuffer()
    }
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
            groupTitle: t.groupId ? this.getGroupFullPathTitle(t.groupId) || null : null,
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
            this.closeTab(t.id, { silent: true })
          }
          const nextActiveId = this.activeTabByProfile[profileId]
          const nextActiveTab = nextActiveId ? this.tabs.find((t) => t.id === nextActiveId) : undefined
          if (nextActiveTab && !isInternalDiaUrl(nextActiveTab.url) && !this.views.has(nextActiveTab.id)) {
            this.ensureViewForTab(nextActiveTab, true)
          }
          this.persistTabs()
          this.syncViewsLayout()
          this.broadcastState()
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
            this.closeTab(t.id, { silent: true })
          }
          this.persistTabs()
          this.syncViewsLayout()
          this.broadcastState()
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
            this.closeTab(t.id, { silent: true })
          }
          this.persistTabs()
          this.syncViewsLayout()
          this.broadcastState()
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

    let bufferedContent = ''
    let bufferedReasoning = ''
    let latestReferencedUrls: Array<{ title: string; url: string }> | undefined
    let streamFlushTimer: NodeJS.Timeout | null = null

    const flushStreamBuffer = (): void => {
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer)
        streamFlushTimer = null
      }
      if ((bufferedContent || bufferedReasoning) && !this.mainWindow.isDestroyed()) {
        const chunkPayload: StreamChunkPayload = {
          threadId: thread.id,
          messageId: assistantMsgId,
          deltaContent: bufferedContent || undefined,
          deltaReasoning: bufferedReasoning || undefined,
          referencedUrls: latestReferencedUrls
        }
        bufferedContent = ''
        bufferedReasoning = ''
        this.mainWindow.webContents.send('arko:chat-stream-chunk', chunkPayload)
      }
    }

    const sendStreamEvent = (payload: StreamChunkPayload): void => {
      if (this.mainWindow.isDestroyed()) return
      if (payload.referencedUrls) {
        latestReferencedUrls = payload.referencedUrls
      }
      const isPureDelta =
        (Boolean(payload.deltaContent) || Boolean(payload.deltaReasoning)) &&
        !payload.toolStep &&
        !payload.done &&
        !payload.error &&
        !payload.followUps

      if (isPureDelta) {
        if (payload.deltaContent) bufferedContent += payload.deltaContent
        if (payload.deltaReasoning) bufferedReasoning += payload.deltaReasoning
        if (!streamFlushTimer) {
          streamFlushTimer = setTimeout(flushStreamBuffer, 16)
        }
        return
      }

      if (payload.deltaContent) bufferedContent += payload.deltaContent
      if (payload.deltaReasoning) bufferedReasoning += payload.deltaReasoning
      flushStreamBuffer()
      this.mainWindow.webContents.send('arko:chat-stream-chunk', {
        ...payload,
        deltaContent: undefined,
        deltaReasoning: undefined
      })
    }

    let result: Awaited<ReturnType<AIService['streamChat']>>
    try {
      result = await this.aiService.streamChat({
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
    } finally {
      flushStreamBuffer()
    }

    // Retain at most the latest 2 screenshot previews per assistant message to keep memory & IPC lean
    if (result.toolSteps && result.toolSteps.length > 2) {
      let keptShots = 0
      for (let i = result.toolSteps.length - 1; i >= 0; i--) {
        if (result.toolSteps[i].imagePreview) {
          keptShots++
          if (keptShots > 2) {
            delete result.toolSteps[i].imagePreview
          }
        }
      }
    }

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
