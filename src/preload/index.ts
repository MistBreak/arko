import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppUpdateState,
  ArkoAPI,
  BrowserSnapshotState,
  FindInPageResultPayload,
  InlineEditableTargetInfo,
  InlineWriteStreamPayload,
  QuotedSelectionPayload,
  ShortcutCommand,
  StreamChunkPayload
} from '@shared/types'

const arkoApi: ArkoAPI = {
  getInitialState: () => ipcRenderer.invoke('arko:get-initial-state'),

  onStateChanged: (cb) => {
    const handler = (_e: unknown, state: BrowserSnapshotState): void => cb(state)
    ipcRenderer.on('arko:state-changed', handler)
    return () => ipcRenderer.removeListener('arko:state-changed', handler)
  },

  onShortcut: (cb) => {
    const handler = (_e: unknown, cmd: ShortcutCommand): void => cb(cmd)
    ipcRenderer.on('arko:shortcut', handler)
    return () => ipcRenderer.removeListener('arko:shortcut', handler)
  },

  // One-Click App Updates
  getUpdateState: () => ipcRenderer.invoke('arko:get-update-state'),
  checkForUpdates: (silent) => ipcRenderer.invoke('arko:check-for-updates', silent),
  downloadUpdate: () => ipcRenderer.invoke('arko:download-update'),
  installUpdateAndRestart: () => ipcRenderer.invoke('arko:install-update'),
  onUpdateStateChanged: (cb) => {
    const handler = (_e: unknown, state: AppUpdateState): void => cb(state)
    ipcRenderer.on('arko:update-state', handler)
    return () => ipcRenderer.removeListener('arko:update-state', handler)
  },

  // First-Launch Onboarding & Browser Data Import
  detectImportBrowsers: () => ipcRenderer.invoke('arko:detect-import-browsers'),
  pickCustomBrowserImportPath: (browserId) =>
    ipcRenderer.invoke('arko:pick-custom-browser-import-path', browserId),
  executeBrowserImport: (request) => ipcRenderer.invoke('arko:execute-browser-import', request),
  completeOnboarding: () => ipcRenderer.invoke('arko:complete-onboarding'),
  resetOnboardingState: () => ipcRenderer.invoke('arko:reset-onboarding-state'),

  // Connected Tools (Zero-OAuth Browser Session Context)
  getConnectedTools: () => ipcRenderer.invoke('arko:get-connected-tools'),
  connectTool: (toolId) => ipcRenderer.invoke('arko:connect-tool', toolId),
  disconnectTool: (toolId) => ipcRenderer.invoke('arko:disconnect-tool', toolId),
  setAutoConnectTools: (enabled) => ipcRenderer.invoke('arko:set-auto-connect-tools', enabled),

  updateViewportBounds: (bounds) => ipcRenderer.invoke('arko:update-viewport-bounds', bounds),
  setOverlayActive: (active) => ipcRenderer.invoke('arko:set-overlay-active', active),

  // Split View
  openSplitView: (rightTabId) => ipcRenderer.invoke('arko:open-split-view', rightTabId),
  closeSplitView: (keepSide) => ipcRenderer.invoke('arko:close-split-view', keepSide),
  swapSplitPanes: () => ipcRenderer.invoke('arko:swap-split-panes'),
  setSplitActivePane: (side) => ipcRenderer.invoke('arko:set-split-active-pane', side),
  setSplitRatio: (ratio) => ipcRenderer.invoke('arko:set-split-ratio', ratio),

  // Tabs
  createTab: (url, options) => ipcRenderer.invoke('arko:create-tab', url, options),
  switchTab: (tabId) => ipcRenderer.invoke('arko:switch-tab', tabId),
  closeTab: (tabId) => ipcRenderer.invoke('arko:close-tab', tabId),
  reopenClosedTab: () => ipcRenderer.invoke('arko:reopen-closed-tab'),
  duplicateTab: (tabId) => ipcRenderer.invoke('arko:duplicate-tab', tabId),
  reorderTab: (sourceTabId, targetTabId, position, targetZone) =>
    ipcRenderer.invoke('arko:reorder-tab', sourceTabId, targetTabId, position, targetZone),
  moveTabToZone: (tabId, targetZone) =>
    ipcRenderer.invoke('arko:move-tab-to-zone', tabId, targetZone),
  closeOtherTabs: (tabId) => ipcRenderer.invoke('arko:close-other-tabs', tabId),
  clearUnpinnedTabs: (profileId) => ipcRenderer.invoke('arko:clear-unpinned-tabs', profileId),
  pinTab: (tabId, pinned) => ipcRenderer.invoke('arko:pin-tab', tabId, pinned),
  setTabPinState: (tabId, mode) => ipcRenderer.invoke('arko:set-tab-pin-state', tabId, mode),
  resetPinnedTab: (tabId) => ipcRenderer.invoke('arko:reset-pinned-tab', tabId),
  navigate: (input, tabId) => ipcRenderer.invoke('arko:navigate', input, tabId),
  goBack: () => ipcRenderer.invoke('arko:go-back'),
  goForward: () => ipcRenderer.invoke('arko:go-forward'),
  reload: () => ipcRenderer.invoke('arko:reload'),
  setPageZoom: (action, tabId) => ipcRenderer.invoke('arko:set-page-zoom', action, tabId),
  toggleMuteTab: (tabId) => ipcRenderer.invoke('arko:toggle-mute-tab', tabId),
  openDevTools: () => ipcRenderer.invoke('arko:open-devtools'),
  findInPage: (text, forward) => ipcRenderer.invoke('arko:find-in-page', text, forward),
  stopFindInPage: () => ipcRenderer.invoke('arko:stop-find-in-page'),
  onFindInPageResult: (cb) => {
    const handler = (_e: unknown, payload: FindInPageResultPayload): void => cb(payload)
    ipcRenderer.on('arko:find-in-page-result', handler)
    return () => ipcRenderer.removeListener('arko:find-in-page-result', handler)
  },

  // Tab Groups & AI Organizer
  createTabGroup: (title, color, tabIds) =>
    ipcRenderer.invoke('arko:create-tab-group', title, color, tabIds),
  updateTabGroup: (groupId, partial) =>
    ipcRenderer.invoke('arko:update-tab-group', groupId, partial),
  assignTabToGroup: (tabId, groupId) =>
    ipcRenderer.invoke('arko:assign-tab-to-group', tabId, groupId),
  toggleTabGroupCollapsed: (groupId) =>
    ipcRenderer.invoke('arko:toggle-tab-group-collapsed', groupId),
  deleteTabGroup: (groupId) => ipcRenderer.invoke('arko:delete-tab-group', groupId),
  organizeTabsByAI: () => ipcRenderer.invoke('arko:organize-tabs-by-ai'),

  // Profiles
  switchProfile: (profileId) => ipcRenderer.invoke('arko:switch-profile', profileId),
  cycleProfile: (direction) => ipcRenderer.invoke('arko:cycle-profile', direction),
  createProfile: (name, emoji, accentColor) =>
    ipcRenderer.invoke('arko:create-profile', name, emoji, accentColor),
  updateProfile: (profileId, partial) =>
    ipcRenderer.invoke('arko:update-profile', profileId, partial),
  deleteProfile: (profileId) => ipcRenderer.invoke('arko:delete-profile', profileId),

  // Bookmarks, History, Downloads & Reader
  toggleBookmark: (url, title, favicon) =>
    ipcRenderer.invoke('arko:toggle-bookmark', url, title, favicon),
  removeBookmark: (bookmarkId) => ipcRenderer.invoke('arko:remove-bookmark', bookmarkId),
  clearHistory: () => ipcRenderer.invoke('arko:clear-history'),
  clearCompletedDownloads: () => ipcRenderer.invoke('arko:clear-completed-downloads'),
  extractReaderArticle: (tabId) => ipcRenderer.invoke('arko:extract-reader-article', tabId),

  // Arko Memory
  addMemory: (content, category, source) =>
    ipcRenderer.invoke('arko:add-memory', content, category, source),
  toggleMemory: (memoryId, enabled) =>
    ipcRenderer.invoke('arko:toggle-memory', memoryId, enabled),
  deleteMemory: (memoryId) => ipcRenderer.invoke('arko:delete-memory', memoryId),

  // Settings, Arko Account & Model Providers
  getAccountState: () => ipcRenderer.invoke('arko:get-account-state'),
  getAuthCapabilities: () => ipcRenderer.invoke('arko:get-auth-capabilities'),
  getRegisterCaptcha: () => ipcRenderer.invoke('arko:get-register-captcha'),
  sendEmailVerificationCode: (email) =>
    ipcRenderer.invoke('arko:send-email-verification-code', email),
  registerAccount: (params) => ipcRenderer.invoke('arko:register-account', params),
  loginAccount: (params) => ipcRenderer.invoke('arko:login-account', params),
  verifyTwoFactorLogin: (params) => ipcRenderer.invoke('arko:verify-2fa-login', params),
  sendPasswordResetEmail: (email) => ipcRenderer.invoke('arko:send-password-reset-email', email),
  logoutAccount: () => ipcRenderer.invoke('arko:logout-account'),
  refreshAccountProfile: () => ipcRenderer.invoke('arko:refresh-account-profile'),
  redeemAccountCode: (code) => ipcRenderer.invoke('arko:redeem-account-code', code),
  quoteTopUpAmount: (amount) => ipcRenderer.invoke('arko:quote-topup-amount', amount),
  createTopUpQrOrder: (params) => ipcRenderer.invoke('arko:create-topup-qr-order', params),
  checkTopUpOrderStatus: (tradeNo) => ipcRenderer.invoke('arko:check-topup-order-status', tradeNo),
  purchaseSubscriptionWithBalance: (planId) =>
    ipcRenderer.invoke('arko:purchase-subscription-balance', planId),
  updateSettings: (partial) => ipcRenderer.invoke('arko:update-settings', partial),
  selectCodingWorkspace: () => ipcRenderer.invoke('arko:select-coding-workspace'),
  clearCodingWorkspace: () => ipcRenderer.invoke('arko:clear-coding-workspace'),
  setAISidebarOpen: (open) => ipcRenderer.invoke('arko:set-ai-sidebar-open', open),
  testProviderConnection: (provider, modelId) =>
    ipcRenderer.invoke('arko:test-provider-connection', provider, modelId),
  fetchProviderModels: (provider) => ipcRenderer.invoke('arko:fetch-provider-models', provider),
  queryProviderQuota: (provider) => ipcRenderer.invoke('arko:query-provider-quota', provider),

  // Context, Skills & Chat
  extractPageContext: (tabId) => ipcRenderer.invoke('arko:extract-page-context', tabId),
  captureActiveTabScreenshot: (tabId) =>
    ipcRenderer.invoke('arko:capture-active-tab-screenshot', tabId),
  executeLocalSkill: (commandInput, tabId) =>
    ipcRenderer.invoke('arko:execute-local-skill', commandInput, tabId),
  revealInFinder: (filePath) => ipcRenderer.invoke('arko:reveal-in-finder', filePath),
  openExternalUrl: (url) => ipcRenderer.invoke('arko:open-external-url', url),
  createThread: () => ipcRenderer.invoke('arko:create-thread'),
  deleteThread: (threadId) => ipcRenderer.invoke('arko:delete-thread', threadId),
  openChatAsTab: (threadId) => ipcRenderer.invoke('arko:open-chat-as-tab', threadId),
  dockChatTabToSidebar: (tabId, threadId) =>
    ipcRenderer.invoke('arko:dock-chat-tab-to-sidebar', tabId, threadId),
  sendChatMessage: (params) => ipcRenderer.invoke('arko:send-chat-message', params),
  editAndResendUserMessage: (params) =>
    ipcRenderer.invoke('arko:edit-and-resend-user-message', params),
  regenerateLastReply: (threadId) => ipcRenderer.invoke('arko:regenerate-last-reply', threadId),
  abortChatStream: (threadId) => ipcRenderer.invoke('arko:abort-chat-stream', threadId),

  onChatStreamChunk: (cb) => {
    const handler = (_e: unknown, payload: StreamChunkPayload): void => cb(payload)
    ipcRenderer.on('arko:chat-stream-chunk', handler)
    return () => ipcRenderer.removeListener('arko:chat-stream-chunk', handler)
  },

  onSelectionQuoted: (cb) => {
    const handler = (_e: unknown, payload: QuotedSelectionPayload): void => cb(payload)
    ipcRenderer.on('arko:selection-quoted', handler)
    return () => ipcRenderer.removeListener('arko:selection-quoted', handler)
  },

  onExternalLinkDrag: (cb) => {
    const handler = (_e: unknown, payload: { url: string; title?: string } | null): void =>
      cb(payload)
    ipcRenderer.on('arko:external-link-drag', handler)
    return () => ipcRenderer.removeListener('arko:external-link-drag', handler)
  },

  // Inline Write & Webpage Form Preview Fill
  inspectInlineWriteTarget: (tabId, preferredMode) =>
    ipcRenderer.invoke('arko:inspect-inline-write-target', tabId, preferredMode),

  onInlineWriteRequested: (cb) => {
    const handler = (_e: unknown, target: InlineEditableTargetInfo): void => cb(target)
    ipcRenderer.on('arko:inline-write-requested', handler)
    return () => ipcRenderer.removeListener('arko:inline-write-requested', handler)
  },

  startInlineWriteStream: (params) =>
    ipcRenderer.invoke('arko:start-inline-write-stream', params),

  abortInlineWriteStream: (requestId) =>
    ipcRenderer.invoke('arko:abort-inline-write-stream', requestId),

  onInlineWriteChunk: (cb) => {
    const handler = (_e: unknown, payload: InlineWriteStreamPayload): void => cb(payload)
    ipcRenderer.on('arko:inline-write-chunk', handler)
    return () => ipcRenderer.removeListener('arko:inline-write-chunk', handler)
  },

  applyInlineWriteResult: (params) =>
    ipcRenderer.invoke('arko:apply-inline-write-result', params),

  generateFormFillPreview: (params) =>
    ipcRenderer.invoke('arko:generate-form-fill-preview', params),

  applyFormFillValues: (params) => ipcRenderer.invoke('arko:apply-form-fill-values', params)
}

contextBridge.exposeInMainWorld('arko', arkoApi)
contextBridge.exposeInMainWorld('dia', arkoApi)
