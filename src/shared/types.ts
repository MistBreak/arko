export type LayoutMode = 'horizontal' | 'vertical'
export type ThemeMode = 'light' | 'dark' | 'system'
export type AppLanguage = 'en' | 'zh-CN'
export type SearchEngineId = 'google' | 'bing' | 'duckduckgo'
export type ProviderProtocol = 'openai-chat' | 'anthropic-messages'
export type InputIntentType = 'url' | 'search' | 'ai'
export type SplitPaneSide = 'left' | 'right'
export type SkillContextScope = 'active' | 'all-tabs' | 'none'
export type SkillExecutionKind = 'ai' | 'local-markdown' | 'local-screenshot' | 'organize-tabs'
export type TabGroupColor = 'indigo' | 'emerald' | 'amber' | 'rose' | 'sky' | 'violet'

export type ConnectedToolId =
  | 'amplitude'
  | 'atlassian'
  | 'figma'
  | 'github'
  | 'gmail'
  | 'google-calendar'
  | 'google-chat'
  | 'google-drive'
  | 'granola'
  | 'linear'
  | 'notion'
  | 'slack'

export type ConnectedToolStatus = 'auto-connected' | 'connected' | 'disconnected'

export interface ConnectedToolItem {
  id: ConnectedToolId
  name: string
  description: string
  descriptionZh: string
  homeUrl: string
  loginUrl: string
  isLoggedIn: boolean
  status: ConnectedToolStatus
  accountHint?: string
}

export type UpdateStatusKind =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export interface AppUpdateState {
  status: UpdateStatusKind
  currentVersion: string
  latestVersion?: string
  releaseName?: string
  releaseNotes?: string
  publishedAt?: string
  releaseHtmlUrl?: string
  downloadUrl?: string
  assetName?: string
  progressPercent?: number
  transferredBytes?: number
  totalBytes?: number
  downloadedFilePath?: string
  canOneClickInstall?: boolean
  checkedAt?: number
  error?: string
}

export interface BrowserProfile {
  id: string
  name: string
  emoji: string
  accentColor: string
  partition: string
  profileLabel?: string
  sourceProfileKey?: string
}

export interface TabGroup {
  id: string
  profileId: string
  title: string
  color: TabGroupColor
  collapsed: boolean
}

export type TabPinMode = 'favorite' | 'pinned' | 'unpinned'

export interface TabState {
  id: string
  profileId: string
  url: string
  title: string
  favicon?: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isPinned: boolean
  isFavorite?: boolean
  pinnedUrl?: string | null
  isAudioPlaying: boolean
  isMuted: boolean
  isSensitive: boolean
  lastAccessedAt: number
  groupId?: string | null
  zoomFactor?: number
  isLoaded?: boolean
}

export interface ViewportBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DualViewportBounds {
  primary: ViewportBounds
  secondary?: ViewportBounds | null
}

export interface SplitViewState {
  enabled: boolean
  leftTabId: string | null
  rightTabId: string | null
  activePane: SplitPaneSide
  ratio: number
}

export interface OverlaySnapshotResult {
  primary: string | null
  secondary: string | null
}

export interface PageExtractedContext {
  tabId: string
  url: string
  title: string
  description: string
  selectedText: string
  content: string
  headings: string[]
  isSensitive: boolean
  wordCount: number
  extractedAt: number
  splitPaneRole?: SplitPaneSide
}

export interface ReaderArticle {
  ok: boolean
  tabId: string
  title: string
  url: string
  description?: string
  markdown: string
  wordCount: number
  error?: string
}

export interface BookmarkItem {
  id: string
  profileId: string
  url: string
  title: string
  favicon?: string
  createdAt: number
}

export interface HistoryItem {
  id: string
  profileId: string
  url: string
  title: string
  favicon?: string
  visitedAt: number
  visitCount: number
}

export interface MemoryItem {
  id: string
  content: string
  category: 'preference' | 'project' | 'tone' | 'fact'
  enabled: boolean
  source?: string
  createdAt: number
}

export interface DownloadItemState {
  id: string
  fileName: string
  url: string
  savePath: string
  receivedBytes: number
  totalBytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startedAt: number
}

export interface AIModelItem {
  id: string
  label: string
}

export interface AIProviderConfig {
  id: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  apiKey: string
  defaultModelId: string
  models: AIModelItem[]
  isArkoCloud?: boolean
  websiteUrl?: string
  apiKeyUrl?: string
}

export interface ArkoAccountUser {
  id: number
  username: string
  displayName: string
  email: string
  group?: string
  remainingUsd?: number
  walletRemainingUsd?: number
  subscriptionRemainingUsd?: number
  effectiveUnlimited?: boolean
  usedUsd?: number
  requestCount?: number
}

// 在线充值支付方式描述项
export interface ArkoTopUpPaymentMethod {
  name: string
  type: string
  color?: string
  minTopup?: number
}

// 当前生效中的单条订阅套餐额度快照
export interface ArkoSubscriptionItem {
  id: number
  planId: number
  planTitle: string
  amountTotal: number
  amountUsed: number
  amountRemaining: number
  remainingUsd: number
  unlimited: boolean
  startTime: number
  endTime: number
  nextResetTime: number
  allowWalletOverflow: boolean
}

// 可通过账户余额直接开通的套餐定义
export interface ArkoSubscriptionPlanItem {
  id: number
  title: string
  subtitle: string
  priceAmount: number
  currency: string
  durationUnit: string
  durationValue: number
  totalAmountUsd: number
  unlimited: boolean
  quotaResetPeriod: string
  allowBalancePay: boolean
}

// 聚合钱包余额、订阅套餐额度与应用内充值配置的统一账单摘要
export interface ArkoBillingSummary {
  effectiveRemainingUsd: number
  effectiveUnlimited: boolean
  walletRemainingUsd: number
  walletUsedUsd: number
  requestCount: number
  subscription: {
    billingPreference: string
    hasActive: boolean
    hasUnlimited: boolean
    allowWalletOverflow: boolean
    remainingUsd: number
    usedUsd: number
    items: ArkoSubscriptionItem[]
  }
  topup: {
    enableOnlineTopup: boolean
    supportsQrcodeCheckout: boolean
    enableRedemption: boolean
    payMethods: ArkoTopUpPaymentMethod[]
    amountOptions: number[]
    discount: Record<string, number>
    minTopup: number
    maxTopup: number
    payCurrency: string
    price: number
  }
}

// 充值金额实时试算响应
export interface ArkoTopUpQuoteResult {
  ok: boolean
  amount: number
  payAmount?: string
  payCurrency?: string
  creditedUsd?: number
  error?: string
}

// 扫码充值下单响应（含主进程离线生成的二维码 DataURL）
export interface ArkoTopUpCheckoutResult {
  ok: boolean
  tradeNo?: string
  payAmount?: string
  payCurrency?: string
  creditedUsd?: number
  paymentMethod?: string
  qrImageDataUrl?: string
  qrImageUrl?: string
  priceChanged?: boolean
  latestPayAmount?: string
  error?: string
}

// 扫码充值订单轮询状态响应
export interface ArkoTopUpOrderStatusResult {
  ok: boolean
  tradeNo: string
  status: 'pending' | 'success' | 'manual_review' | 'expired' | string
  state?: ArkoAccountState
  error?: string
}

// 使用钱包余额直购套餐响应
export interface ArkoBalancePlanPurchaseResult {
  ok: boolean
  state?: ArkoAccountState
  error?: string
}

export interface ArkoAuthServerCapabilities {
  registerEnabled: boolean
  passwordLoginEnabled: boolean
  passwordRegisterEnabled: boolean
  emailVerificationRequired: boolean
  registerCaptchaEnabled: boolean
}

export interface ArkoCaptchaChallenge {
  ok: boolean
  enabled: boolean
  captchaId?: string
  captchaImage?: string
  expiresIn?: number
  error?: string
}

export interface ArkoAccountState {
  authenticated: boolean
  hasCloudCredential: boolean
  user: ArkoAccountUser | null
  billing?: ArkoBillingSummary | null
  plans?: ArkoSubscriptionPlanItem[]
  capabilities?: ArkoAuthServerCapabilities
  syncedAt?: number
}

export interface ArkoAuthResult {
  ok: boolean
  requiresTwoFactor?: boolean
  twoFactorFlowToken?: string
  state?: ArkoAccountState
  models?: AIModelItem[]
  lockoutMinutes?: number
  error?: string
}

export interface ArkoRedeemResult {
  ok: boolean
  addedUsd?: number
  state?: ArkoAccountState
  error?: string
}

export interface SlashSkill {
  id: string
  command: string
  icon: string
  label: string
  description: string
  promptTemplate: string
  includeAllTabs?: boolean
  contextScope?: SkillContextScope
  executionKind?: SkillExecutionKind
  isBuiltin?: boolean
}

export interface AppSettings {
  language?: AppLanguage
  onboardingCompleted?: boolean
  lastImportedBrowser?: ImportBrowserId | null
  lastImportedAt?: number | null
  autoCheckUpdates?: boolean
  layoutMode: LayoutMode
  sidebarCollapsed: boolean
  sidebarWidth?: number
  compactTopBar: boolean
  aiSidebarWidth?: number
  agentModeEnabled?: boolean
  codingWorkspacePath?: string | null
  recentWorkspaces?: string[]
  theme: ThemeMode
  searchEngine: SearchEngineId
  activeProviderId: string
  activeModelId: string
  providers: AIProviderConfig[]
  personalizationPrompt: string
  sensitiveSiteGuard: boolean
  includeActiveTabByDefault: boolean
  selectionToolbarEnabled: boolean
  memoryEnabled: boolean
  customSkills: SlashSkill[]
  autoConnectLoggedInApps?: boolean
  manuallyConnectedTools?: ConnectedToolId[]
  manuallyDisconnectedTools?: ConnectedToolId[]
  toolsOnboardingSeen?: boolean
}

export type ImportBrowserId = 'arc' | 'dia' | 'chrome'

export interface ImportDataScopes {
  spacesAndPinned: boolean
  openTabs?: boolean
  sessions?: boolean
  extensions?: boolean
  bookmarks: boolean
  history: boolean
}

export interface DetectedExtensionPreview {
  id: string
  name: string
  version: string
  description?: string
  iconDataUrl?: string
  profileDir: string
  enabled: boolean
}

export interface DetectedBrowserProfileInfo {
  id: string
  name: string
  profileDir?: string
  profileName?: string
  emoji?: string
  accentColor?: string
  bookmarkCount?: number
  pinnedCount?: number
  favoriteCount?: number
  openTabCount?: number
  extensionCount?: number
  hasHistory?: boolean
  hasSessionData?: boolean
}

export interface DetectedBrowserSource {
  id: ImportBrowserId
  name: string
  detected: boolean
  dataRootPath: string | null
  isCustomPath?: boolean
  profiles: DetectedBrowserProfileInfo[]
  spacesCount?: number
  distinctProfilesCount?: number
  bookmarksEstimate: number
  pinnedEstimate: number
  openTabsEstimate?: number
  extensionsEstimate?: number
  detectedExtensions?: DetectedExtensionPreview[]
  hasHistory: boolean
  hasSessionData?: boolean
  supportsSpacesAndPinned: boolean
}

export interface BrowserImportRequest {
  browserId: ImportBrowserId
  customPath?: string | null
  selectedProfileIds?: string[]
  scopes: ImportDataScopes
  createSpacesFromProfiles: boolean
  replaceStarterSpaces?: boolean
}

export type ImportProgressStage =
  | 'parsing'
  | 'spaces'
  | 'sessions'
  | 'tabs'
  | 'extensions'
  | 'library'
  | 'done'

export interface BrowserImportProgressPayload {
  stage: ImportProgressStage
  percent: number
  detail?: string
  detailZh?: string
}

export interface BrowserImportResult {
  ok: boolean
  browserId: ImportBrowserId
  spacesCreated: number
  profilesShared?: number
  favoritesImported: number
  pinnedTabsImported: number
  openTabsImported?: number
  tabGroupsCreated: number
  cookiesImported?: number
  storageProfilesMigrated?: number
  extensionsImported?: number
  bookmarksImported: number
  historyImported: number
  importedSpaces?: Array<{
    id: string
    name: string
    emoji: string
    accentColor: string
    profileLabel?: string
  }>
  warnings?: string[]
  error?: string
}

export interface InstalledExtensionItem {
  id: string
  electronExtensionId?: string
  sourceExtensionId?: string
  name: string
  description: string
  version: string
  manifestVersion: number
  localPath: string
  iconDataUrl?: string
  popupPath?: string | null
  optionsPath?: string | null
  homepageUrl?: string | null
  enabled: boolean
  partitions: string[]
  sourceBrowser?: ImportBrowserId
  installedAt: number
  isLoaded?: boolean
  loadError?: string | null
}

export interface AgentToolStep {
  id: string
  name: string
  label: string
  argsSummary?: string
  status: 'running' | 'done' | 'error'
  resultSummary?: string
  detailPreview?: string
  imagePreview?: string
}

export interface FindInPageResultPayload {
  tabId: string
  activeMatchOrdinal: number
  matches: number
  finalUpdate: boolean
}

export interface ChatMention {
  type: 'tab' | 'all-tabs' | 'history' | 'memory' | 'tool'
  tabId?: string
  toolId?: ConnectedToolId
  title: string
  url?: string
  favicon?: string
}

export interface QuotedSelectionPayload {
  tabId: string
  title: string
  url: string
  favicon?: string
  text: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  quotedText?: string
  imageAttachment?: string
  reasoning?: string
  toolSteps?: AgentToolStep[]
  mentions?: ChatMention[]
  referencedUrls?: Array<{ title: string; url: string }>
  followUps?: string[]
  createdAt: number
  modelId?: string
  isStreaming?: boolean
  error?: string
  localAction?: {
    kind: 'local-markdown' | 'local-screenshot'
    savedPath?: string
    imageDataUrl?: string
    copiedToClipboard?: boolean
  }
}

export interface ChatThread {
  id: string
  profileId: string
  title: string
  messages: ChatMessage[]
  updatedAt: number
}

export interface LocalSkillExecutionResult {
  ok: boolean
  kind: 'local-markdown' | 'local-screenshot'
  title?: string
  savedPath?: string
  copiedToClipboard?: boolean
  markdownLength?: number
  imageDataUrl?: string
  width?: number
  height?: number
  fullPage?: boolean
  error?: string
}

export type InlineWriteActionPreset =
  | 'continue'
  | 'polish'
  | 'reply'
  | 'translate'
  | 'shorten'
  | 'expand'
  | 'custom'

export interface WebFormFieldInfo {
  fieldId: string
  tagName: 'input' | 'textarea' | 'select'
  inputType: string
  name: string
  label: string
  placeholder: string
  currentValue: string
  options?: Array<{ value: string; label: string }>
}

export interface InlineEditableTargetInfo {
  found: boolean
  initialMode?: 'inline' | 'form'
  tabId: string
  url: string
  pageTitle: string
  isSensitive: boolean
  tagName: string
  inputType?: string
  fieldLabel: string
  placeholder: string
  selectedText: string
  surroundingValue: string
  anchorRect: {
    x: number
    y: number
    width: number
    height: number
  }
  formFields: WebFormFieldInfo[]
}

export interface WebFormFillProposal {
  fieldId: string
  label: string
  currentValue: string
  proposedValue: string
  reason?: string
}

export interface InlineWriteStreamPayload {
  requestId: string
  deltaContent?: string
  done?: boolean
  error?: string
}

export interface TokenQuotaResult {
  ok: boolean
  planName?: string
  remainingUsd?: number
  usedUsd?: number
  totalUsd?: number
  extra?: string
  error?: string
}

export interface ConnectionTestResult {
  ok: boolean
  latencyMs?: number
  replyPreview?: string
  error?: string
}

export interface FetchModelsResult {
  ok: boolean
  models?: AIModelItem[]
  error?: string
}

export interface BrowserSnapshotState {
  platform: 'darwin' | 'win32' | 'linux'
  profiles: BrowserProfile[]
  activeProfileId: string
  tabs: TabState[]
  tabGroups: TabGroup[]
  allTabs: TabState[]
  allTabGroups: TabGroup[]
  activeTabByProfile: Record<string, string>
  splitByProfile: Record<string, SplitViewState>
  activeTabId: string | null
  splitView: SplitViewState
  bookmarks: BookmarkItem[]
  history: HistoryItem[]
  memories: MemoryItem[]
  downloads: DownloadItemState[]
  recentlyClosedCount: number
  settings: AppSettings
  threads: ChatThread[]
  aiSidebarOpen: boolean
  updateState?: AppUpdateState
  connectedTools?: ConnectedToolItem[]
  extensions?: InstalledExtensionItem[]
  accountState?: ArkoAccountState
}

export interface StreamChunkPayload {
  threadId: string
  messageId: string
  deltaContent?: string
  deltaReasoning?: string
  toolStep?: AgentToolStep
  done?: boolean
  error?: string
  referencedUrls?: Array<{ title: string; url: string }>
  followUps?: string[]
}

export type ShortcutCommand =
  | 'toggle-ai-sidebar'
  | 'focus-omnibox'
  | 'new-tab'
  | 'close-tab'
  | 'reopen-closed-tab'
  | 'toggle-layout'
  | 'toggle-focus-sidebar'
  | 'toggle-split-view'
  | 'toggle-reader-view'
  | 'open-inline-write'
  | 'open-settings'
  | 'open-account-settings'
  | 'open-connect-tools'
  | 'open-extensions'
  | 'open-import-data'
  | 'open-skills-editor'
  | 'open-memory-settings'
  | 'open-general-settings'
  | 'check-for-updates'
  | 'find-in-page'
  | 'bookmark-page'
  | 'reload-page'
  | 'switch-profile-prev'
  | 'switch-profile-next'

export interface ArkoAPI {
  // Initial snapshot & state subscription
  getInitialState: () => Promise<BrowserSnapshotState>
  onStateChanged: (cb: (state: BrowserSnapshotState) => void) => () => void
  onShortcut: (cb: (cmd: ShortcutCommand) => void) => () => void

  // One-Click App Updates
  getUpdateState: () => Promise<AppUpdateState>
  checkForUpdates: (silent?: boolean) => Promise<AppUpdateState>
  downloadUpdate: () => Promise<AppUpdateState>
  installUpdateAndRestart: () => Promise<{ ok: boolean; error?: string }>
  onUpdateStateChanged: (cb: (state: AppUpdateState) => void) => () => void

  // First-Launch Onboarding & Browser Data Import
  detectImportBrowsers: () => Promise<DetectedBrowserSource[]>
  pickCustomBrowserImportPath: (browserId: ImportBrowserId) => Promise<DetectedBrowserSource | null>
  executeBrowserImport: (request: BrowserImportRequest) => Promise<BrowserImportResult>
  onImportProgress: (cb: (payload: BrowserImportProgressPayload) => void) => () => void
  completeOnboarding: () => Promise<AppSettings>
  resetOnboardingState: () => Promise<BrowserSnapshotState>

  // Browser Extensions Ecosystem
  getExtensions: () => Promise<InstalledExtensionItem[]>
  installUnpackedExtension: () => Promise<{
    ok: boolean
    extension?: InstalledExtensionItem
    error?: string
  }>
  installWebStoreExtension: (urlOrId: string) => Promise<{
    ok: boolean
    extension?: InstalledExtensionItem
    error?: string
  }>
  toggleExtension: (extensionId: string, enabled: boolean) => Promise<InstalledExtensionItem[]>
  removeExtension: (extensionId: string) => Promise<InstalledExtensionItem[]>
  openExtensionPopup: (
    extensionId: string,
    anchor?: { x: number; y: number }
  ) => Promise<{ ok: boolean; openedTab?: boolean; error?: string }>
  openExtensionOptions: (extensionId: string) => Promise<boolean>

  // Connected Tools (Zero-OAuth Browser Session Context)
  getConnectedTools: () => Promise<ConnectedToolItem[]>
  connectTool: (
    toolId: ConnectedToolId
  ) => Promise<{ ok: boolean; openedLoginTab?: boolean; tools: ConnectedToolItem[] }>
  disconnectTool: (toolId: ConnectedToolId) => Promise<ConnectedToolItem[]>
  setAutoConnectTools: (enabled: boolean) => Promise<ConnectedToolItem[]>

  // Viewport & Overlay z-index management
  updateViewportBounds: (bounds: ViewportBounds | DualViewportBounds) => Promise<void>
  setOverlayActive: (active: boolean) => Promise<OverlaySnapshotResult>

  // Split View operations
  openSplitView: (rightTabId?: string) => Promise<void>
  closeSplitView: (keepSide?: SplitPaneSide) => Promise<void>
  swapSplitPanes: () => Promise<void>
  setSplitActivePane: (side: SplitPaneSide) => Promise<void>
  setSplitRatio: (ratio: number) => Promise<void>

  // Tab operations
  createTab: (
    url?: string,
    options?: {
      background?: boolean
      pinned?: boolean
      favorite?: boolean
      groupId?: string | null
      profileId?: string
      insertBeforeTabId?: string | null
    }
  ) => Promise<string>
  switchTab: (tabId: string) => Promise<void>
  closeTab: (tabId: string) => Promise<void>
  reopenClosedTab: () => Promise<boolean>
  duplicateTab: (tabId: string) => Promise<string | null>
  reorderTab: (
    sourceTabId: string,
    targetTabId: string,
    position?: 'before' | 'after',
    targetZone?: TabPinMode
  ) => Promise<void>
  moveTabToZone: (tabId: string, targetZone: TabPinMode) => Promise<void>
  closeOtherTabs: (tabId: string) => Promise<void>
  clearUnpinnedTabs: (profileId?: string) => Promise<number>
  pinTab: (tabId: string, pinned: boolean) => Promise<void>
  setTabPinState: (tabId: string, mode: TabPinMode) => Promise<void>
  resetPinnedTab: (tabId: string) => Promise<void>
  navigate: (input: string, tabId?: string) => Promise<void>
  goBack: () => Promise<void>
  goForward: () => Promise<void>
  reload: () => Promise<void>
  setPageZoom: (action: 'in' | 'out' | 'reset', tabId?: string) => Promise<number>
  toggleMuteTab: (tabId: string) => Promise<void>
  openDevTools: () => Promise<void>
  findInPage: (text: string, forward?: boolean) => Promise<void>
  stopFindInPage: () => Promise<void>
  onFindInPageResult: (cb: (payload: FindInPageResultPayload) => void) => () => void

  // Tab Groups & AI Tab Organizer
  createTabGroup: (
    title: string,
    color: TabGroupColor,
    tabIds?: string[]
  ) => Promise<TabGroup>
  updateTabGroup: (
    groupId: string,
    partial: Partial<Pick<TabGroup, 'title' | 'color' | 'collapsed'>>
  ) => Promise<TabGroup | null>
  assignTabToGroup: (tabId: string, groupId: string | null) => Promise<void>
  toggleTabGroupCollapsed: (groupId: string) => Promise<void>
  deleteTabGroup: (groupId: string) => Promise<void>
  organizeTabsByAI: () => Promise<{ ok: boolean; groupCount: number; error?: string }>

  // Profiles
  switchProfile: (profileId: string) => Promise<void>
  cycleProfile: (direction: 1 | -1) => Promise<void>
  createProfile: (name: string, emoji: string, accentColor: string) => Promise<BrowserProfile>
  updateProfile: (
    profileId: string,
    partial: Partial<Pick<BrowserProfile, 'name' | 'emoji' | 'accentColor'>>
  ) => Promise<BrowserProfile | null>
  deleteProfile: (profileId: string) => Promise<boolean>

  // Bookmarks, History, Downloads & Reader
  toggleBookmark: (url: string, title: string, favicon?: string) => Promise<boolean>
  removeBookmark: (bookmarkId: string) => Promise<void>
  clearHistory: () => Promise<void>
  clearCompletedDownloads: () => Promise<void>
  extractReaderArticle: (tabId?: string) => Promise<ReaderArticle>

  // Arko Memory (Long-term Personalization)
  addMemory: (
    content: string,
    category?: MemoryItem['category'],
    source?: string
  ) => Promise<MemoryItem>
  toggleMemory: (memoryId: string, enabled: boolean) => Promise<void>
  deleteMemory: (memoryId: string) => Promise<void>

  // Settings, Arko Account & Model Providers
  getAccountState: () => Promise<ArkoAccountState>
  getAuthCapabilities: () => Promise<ArkoAuthServerCapabilities>
  getRegisterCaptcha: () => Promise<ArkoCaptchaChallenge>
  sendEmailVerificationCode: (email: string) => Promise<{ ok: boolean; error?: string }>
  registerAccount: (params: {
    email: string
    username?: string
    password: string
    verificationCode?: string
    captchaId?: string
    captchaCode?: string
  }) => Promise<ArkoAuthResult>
  loginAccount: (params: { identifier: string; password: string }) => Promise<ArkoAuthResult>
  verifyTwoFactorLogin: (params: { flowToken: string; code: string }) => Promise<ArkoAuthResult>
  sendPasswordResetEmail: (email: string) => Promise<{ ok: boolean; error?: string }>
  logoutAccount: () => Promise<ArkoAccountState>
  refreshAccountProfile: () => Promise<{
    ok: boolean
    state: ArkoAccountState
    models?: AIModelItem[]
    error?: string
  }>
  redeemAccountCode: (code: string) => Promise<ArkoRedeemResult>
  quoteTopUpAmount: (amount: number) => Promise<ArkoTopUpQuoteResult>
  createTopUpQrOrder: (params: {
    amount: number
    paymentMethod: string
    confirmedPayAmount: string
  }) => Promise<ArkoTopUpCheckoutResult>
  checkTopUpOrderStatus: (tradeNo: string) => Promise<ArkoTopUpOrderStatusResult>
  purchaseSubscriptionWithBalance: (planId: number) => Promise<ArkoBalancePlanPurchaseResult>
  updateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  selectCodingWorkspace: () => Promise<string | null>
  clearCodingWorkspace: () => Promise<void>
  setAISidebarOpen: (open: boolean) => Promise<void>
  testProviderConnection: (provider: AIProviderConfig, modelId?: string) => Promise<ConnectionTestResult>
  fetchProviderModels: (provider: AIProviderConfig) => Promise<FetchModelsResult>
  queryProviderQuota: (provider: AIProviderConfig) => Promise<TokenQuotaResult>

  // Context Extraction, Local Skills, Chat Tabs & AI Streaming Chat
  extractPageContext: (tabId?: string) => Promise<PageExtractedContext | null>
  captureActiveTabScreenshot: (
    tabId?: string
  ) => Promise<{ ok: boolean; dataUrl?: string; title?: string; error?: string }>
  executeLocalSkill: (commandInput: string, tabId?: string) => Promise<LocalSkillExecutionResult>
  revealInFinder: (filePath: string) => Promise<void>
  openExternalUrl: (url: string) => Promise<void>
  createThread: () => Promise<ChatThread>
  deleteThread: (threadId: string) => Promise<void>
  openChatAsTab: (threadId?: string) => Promise<string>
  dockChatTabToSidebar: (tabId: string, threadId: string) => Promise<void>
  sendChatMessage: (params: {
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
  editAndResendUserMessage: (params: {
    threadId: string
    messageId: string
    newPrompt: string
  }) => Promise<void>
  regenerateLastReply: (threadId: string) => Promise<void>
  abortChatStream: (threadId: string) => Promise<void>
  onChatStreamChunk: (cb: (payload: StreamChunkPayload) => void) => () => void
  onSelectionQuoted: (cb: (payload: QuotedSelectionPayload) => void) => () => void
  onExternalLinkDrag: (
    cb: (payload: { url: string; title?: string } | null) => void
  ) => () => void

  // Inline Write & Webpage Form Preview Fill
  inspectInlineWriteTarget: (
    tabId?: string,
    preferredMode?: 'inline' | 'form'
  ) => Promise<InlineEditableTargetInfo | null>
  onInlineWriteRequested: (cb: (target: InlineEditableTargetInfo) => void) => () => void
  startInlineWriteStream: (params: {
    requestId: string
    tabId: string
    preset: InlineWriteActionPreset
    instruction: string
    selectedText: string
    surroundingValue: string
    fieldLabel: string
  }) => Promise<void>
  abortInlineWriteStream: (requestId: string) => Promise<void>
  onInlineWriteChunk: (cb: (payload: InlineWriteStreamPayload) => void) => () => void
  applyInlineWriteResult: (params: {
    tabId: string
    text: string
    mode: 'replace-or-insert' | 'append' | 'replace-all'
  }) => Promise<boolean>
  generateFormFillPreview: (params: {
    tabId: string
    instruction: string
    fields: WebFormFieldInfo[]
  }) => Promise<{ ok: boolean; proposals: WebFormFillProposal[]; error?: string }>
  applyFormFillValues: (params: {
    tabId: string
    fills: Array<{ fieldId: string; value: string }>
  }) => Promise<{ ok: boolean; appliedCount: number }>
}

export type DiaAPI = ArkoAPI
