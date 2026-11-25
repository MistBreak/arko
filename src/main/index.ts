import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { PersistenceStore } from './store'
import { AIService } from './ai-service'
import { AccountService } from './account-service'
import { BrowserManager } from './browser-manager'
import { UpdateManager } from './updater'
import { NEW_TAB_URL } from '@shared/constants'
import { tr } from '@shared/i18n'
import type {
  AIProviderConfig,
  AppLanguage,
  AppSettings,
  BrowserImportRequest,
  BrowserProfile,
  ChatMention,
  ConnectedToolId,
  DualViewportBounds,
  ImportBrowserId,
  InlineWriteActionPreset,
  MemoryItem,
  SplitPaneSide,
  TabGroupColor,
  TabPinMode,
  ViewportBounds,
  WebFormFieldInfo
} from '@shared/types'

let mainWindow: BrowserWindow | null = null
let browserManager: BrowserManager | null = null
let updateManager: UpdateManager | null = null

function resolveAppIconPath(): string | null {
  const candidates = [
    join(process.cwd(), 'resources/icon.png'),
    join(app.getAppPath(), 'resources/icon.png'),
    join(__dirname, '../../resources/icon.png')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function loadAppIcon(): Electron.NativeImage | undefined {
  const iconPath = resolveAppIconPath()
  if (!iconPath) return undefined
  const image = nativeImage.createFromPath(iconPath)
  return image.isEmpty() ? undefined : image
}

function createMainWindow(
  store: PersistenceStore,
  aiService: AIService,
  updater: UpdateManager,
  accountService: AccountService
): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const isInitDark = store.settings.theme !== 'light'

  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 920,
    minHeight: 600,
    show: false,
    title: 'Arko',
    icon: loadAppIcon(),
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 14, y: 12 },
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const
        }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: isInitDark ? '#19191B' : '#F4F4F5',
            symbolColor: isInitDark ? '#E4E4E7' : '#27272A',
            height: 38
          }
        }),
    backgroundColor: isInitDark ? '#19191B' : '#F4F4F5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  browserManager = new BrowserManager(
    win,
    store,
    aiService,
    () => updater.getState(),
    () => accountService.getState()
  )
  browserManager.syncWindowTitleBarOverlay()

  // Prevent external links inside React UI (e.g. AI Markdown) from navigating the shell window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:\/\//i.test(url)) {
      void browserManager?.createTab(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if ((devUrl && url.startsWith(devUrl)) || url.startsWith('file://')) {
      return
    }
    event.preventDefault()
    if (url && /^https?:\/\//i.test(url)) {
      void browserManager?.createTab(url)
    }
  })

  win.on('ready-to-show', () => {
    win.show()
    browserManager?.syncViewsLayout()
    if (accountService.getState().authenticated) {
      setTimeout(() => {
        void accountService.refreshProfile().then((res) => {
          if (res.models && res.models.length > 0) {
            browserManager?.applyCloudModels(res.models, false)
          }
        })
      }, 1500)
    }
    if (store.settings.autoCheckUpdates !== false) {
      setTimeout(() => {
        void updater.checkForUpdates(true)
      }, 4500)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function buildAppMenu(lang?: AppLanguage): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const, label: tr(lang, 'About Arko', '关于 Arko Browser') },
              {
                label: tr(lang, 'Check for Updates…', '检查更新…'),
                click: () => {
                  browserManager?.emitShortcut('check-for-updates')
                  void updateManager?.checkForUpdates(false)
                }
              },
              { type: 'separator' as const },
              {
                label: tr(lang, 'Arko Account…', 'Arko 账号中心…'),
                click: () => browserManager?.emitShortcut('open-account-settings')
              },
              {
                label: tr(lang, 'Settings & Models…', '偏好设置与模型…'),
                accelerator: 'CmdOrCtrl+,',
                click: () => browserManager?.emitShortcut('open-settings')
              },
              {
                label: tr(lang, 'Connect your Tools…', '连接你的常用工具 (Connect Tools)…'),
                click: () => browserManager?.emitShortcut('open-connect-tools')
              },
              {
                label: tr(
                  lang,
                  'Import Browser Data (Arc / Dia / Chrome)…',
                  '从其他浏览器导入数据 (Arc / Dia / Chrome)…'
                ),
                click: () => browserManager?.emitShortcut('open-import-data')
              },
              {
                label: tr(lang, 'Manage Personal Memory…', '管理 Arko 个人记忆库…'),
                click: () => browserManager?.emitShortcut('open-memory-settings')
              },
              {
                label: tr(lang, 'Manage Custom /Skills…', '管理自定义 /Skills 技能…'),
                click: () => browserManager?.emitShortcut('open-skills-editor')
              },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const, label: tr(lang, 'Quit Arko', '退出 Arko') }
            ]
          }
        ]
      : []),
    {
      label: tr(lang, 'File', '文件'),
      submenu: [
        {
          label: tr(lang, 'New Tab', '新建标签页'),
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            browserManager?.emitShortcut('new-tab')
          }
        },
        {
          label: tr(lang, 'New AI Chat Tab', '新建独立 AI 对话标签页'),
          click: () => {
            void browserManager?.openChatAsTab()
          }
        },
        {
          label: tr(lang, 'Reopen Closed Tab', '重新打开刚关闭的标签页'),
          accelerator: 'Shift+CmdOrCtrl+T',
          click: () => {
            void browserManager?.reopenClosedTab()
            browserManager?.emitShortcut('reopen-closed-tab')
          }
        },
        {
          label: tr(lang, 'Focus Smart Command Bar', '聚焦统一智能栏'),
          accelerator: 'CmdOrCtrl+L',
          click: () => browserManager?.emitShortcut('focus-omnibox')
        },
        {
          label: tr(lang, 'Inline Write / Form Preview Fill', '网页输入框内联帮写 / 表单填充'),
          accelerator: 'CmdOrCtrl+J',
          click: () => {
            void browserManager?.triggerInlineWriteRequest()
            browserManager?.emitShortcut('open-inline-write')
          }
        },
        { type: 'separator' },
        {
          label: tr(lang, 'Export Page as Markdown (/markdown)', '导出当前网页为 Markdown (/markdown)'),
          click: () => {
            void browserManager?.executeLocalSkill('/markdown')
          }
        },
        {
          label: tr(lang, 'Capture HD Screenshot (/screenshot)', '网页高清截图保存 (/screenshot)'),
          click: () => {
            void browserManager?.executeLocalSkill('/screenshot')
          }
        },
        ...(!isMac
          ? [
              { type: 'separator' as const },
              {
                label: tr(
                  lang,
                  'Import Browser Data (Arc / Dia / Chrome)…',
                  '从其他浏览器导入数据 (Arc / Dia / Chrome)…'
                ),
                click: () => browserManager?.emitShortcut('open-import-data')
              },
              {
                label: tr(lang, 'Check for Updates…', '检查更新…'),
                click: () => {
                  browserManager?.emitShortcut('check-for-updates')
                  void updateManager?.checkForUpdates(false)
                }
              },
              {
                label: tr(lang, 'Settings…', '偏好设置…'),
                accelerator: 'CmdOrCtrl+,',
                click: () => browserManager?.emitShortcut('open-settings')
              }
            ]
          : []),
        { type: 'separator' },
        {
          label: tr(lang, 'Close Tab', '关闭当前标签页'),
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            browserManager?.closeActiveTabShortcut()
          }
        }
      ]
    },
    {
      label: tr(lang, 'Edit', '编辑'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: tr(lang, 'View & AI', '视图与 AI'),
      submenu: [
        {
          label: tr(lang, 'Toggle Arko AI Sidebar', '开关 Arko AI 侧边栏'),
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            if (!browserManager) return
            const snap = browserManager.getSnapshot()
            browserManager.setAISidebarOpen(!snap.aiSidebarOpen)
            browserManager.emitShortcut('toggle-ai-sidebar')
          }
        },
        {
          label: tr(lang, 'AI Organize Tab Groups (/organize)', 'AI 智能整理打开的标签页分组 (/organize)'),
          click: () => {
            void browserManager?.organizeTabsByAI()
          }
        },
        {
          label: tr(lang, 'Calm Reader View', '沉浸阅读视图 (Calm Reader)'),
          accelerator: 'Shift+CmdOrCtrl+R',
          click: () => browserManager?.emitShortcut('toggle-reader-view')
        },
        {
          label: tr(lang, 'Side-by-Side Split View', '左右并排分屏视图 (Split View)'),
          accelerator: 'Shift+CmdOrCtrl+\\',
          click: () => {
            browserManager?.toggleSplitView()
            browserManager?.emitShortcut('toggle-split-view')
          }
        },
        {
          label: tr(lang, 'Switch Horizontal / Vertical Sidebar', '切换水平 / 垂直标签栏'),
          accelerator: 'CmdOrCtrl+\\',
          click: () => {
            if (!browserManager) return
            const cur = browserManager.store.settings.layoutMode
            browserManager.updateSettings({
              layoutMode: cur === 'horizontal' ? 'vertical' : 'horizontal',
              sidebarCollapsed: false
            })
          }
        },
        {
          label: tr(lang, 'Focus Mode (Collapse Chrome)', '无感沉浸顶栏 / 折叠侧栏 (Focus Mode)'),
          accelerator: 'Shift+CmdOrCtrl+S',
          click: () => {
            if (!browserManager) return
            const s = browserManager.store.settings
            if (s.layoutMode === 'vertical') {
              browserManager.updateSettings({ sidebarCollapsed: !s.sidebarCollapsed })
            } else {
              browserManager.updateSettings({ compactTopBar: !s.compactTopBar })
            }
          }
        },
        { type: 'separator' },
        {
          label: tr(lang, 'Previous Space (Profile)', '切换至上一个空间 (Space)'),
          accelerator: 'Ctrl+Alt+Left',
          click: () => {
            browserManager?.cycleProfile(-1)
            browserManager?.emitShortcut('switch-profile-prev')
          }
        },
        {
          label: tr(lang, 'Next Space (Profile)', '切换至下一个空间 (Space)'),
          accelerator: 'Ctrl+Alt+Right',
          click: () => {
            browserManager?.cycleProfile(1)
            browserManager?.emitShortcut('switch-profile-next')
          }
        },
        { type: 'separator' },
        {
          label: tr(lang, 'Reload Page', '重新加载页面'),
          accelerator: 'CmdOrCtrl+R',
          click: () => browserManager?.reload()
        },
        {
          label: tr(lang, 'Zoom In', '放大网页'),
          accelerator: 'CmdOrCtrl+Plus',
          click: () => browserManager?.setPageZoom('in')
        },
        {
          label: tr(lang, 'Zoom Out', '缩小网页'),
          accelerator: 'CmdOrCtrl+-',
          click: () => browserManager?.setPageZoom('out')
        },
        {
          label: tr(lang, 'Actual Size (100%)', '实际大小 (100%)'),
          accelerator: 'CmdOrCtrl+0',
          click: () => browserManager?.setPageZoom('reset')
        },
        { type: 'separator' },
        {
          label: tr(lang, 'Find in Page…', '页内查找…'),
          accelerator: 'CmdOrCtrl+F',
          click: () => browserManager?.emitShortcut('find-in-page')
        },
        {
          label: tr(lang, 'Bookmark Current Page', '收藏当前页面'),
          accelerator: 'CmdOrCtrl+D',
          click: () => browserManager?.emitShortcut('bookmark-page')
        },
        { type: 'separator' },
        {
          label: tr(lang, 'Developer Tools', '开发者工具'),
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => browserManager?.openDevTools()
        }
      ]
    },
    {
      label: tr(lang, 'Window', '窗口'),
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpcHandlers(
  aiService: AIService,
  updater: UpdateManager,
  accountService: AccountService
): void {
  ipcMain.handle('arko:get-initial-state', () => {
    return browserManager!.getSnapshot()
  })

  // One-Click Update IPC
  ipcMain.handle('arko:get-update-state', () => {
    return updater.getState()
  })

  ipcMain.handle('arko:check-for-updates', async (_e, silent?: boolean) => {
    return await updater.checkForUpdates(Boolean(silent))
  })

  ipcMain.handle('arko:download-update', async () => {
    return await updater.downloadUpdate()
  })

  ipcMain.handle('arko:install-update', async () => {
    return await updater.installUpdateAndRestart()
  })

  // First-Launch Onboarding & Browser Data Import IPC
  ipcMain.handle('arko:detect-import-browsers', () => {
    return browserManager?.detectImportBrowsers() ?? []
  })

  ipcMain.handle(
    'arko:pick-custom-browser-import-path',
    async (_e, browserId: ImportBrowserId) => {
      return (await browserManager?.pickCustomBrowserImportPath(browserId)) ?? null
    }
  )

  ipcMain.handle('arko:execute-browser-import', (_e, request: BrowserImportRequest) => {
    return (
      browserManager?.executeBrowserImport(request) ?? {
        ok: false,
        browserId: request.browserId,
        spacesCreated: 0,
        favoritesImported: 0,
        pinnedTabsImported: 0,
        tabGroupsCreated: 0,
        bookmarksImported: 0,
        historyImported: 0,
        error: 'BrowserManager not ready'
      }
    )
  })

  ipcMain.handle('arko:complete-onboarding', () => {
    return browserManager!.completeOnboarding()
  })

  // Connected Tools IPC
  ipcMain.handle('arko:get-connected-tools', async () => {
    return (await browserManager?.getConnectedTools()) ?? []
  })

  ipcMain.handle('arko:connect-tool', async (_e, toolId: ConnectedToolId) => {
    return (
      (await browserManager?.connectTool(toolId)) ?? {
        ok: false,
        tools: []
      }
    )
  })

  ipcMain.handle('arko:disconnect-tool', async (_e, toolId: ConnectedToolId) => {
    return (await browserManager?.disconnectTool(toolId)) ?? []
  })

  ipcMain.handle('arko:set-auto-connect-tools', async (_e, enabled: boolean) => {
    return (await browserManager?.setAutoConnectTools(enabled)) ?? []
  })

  ipcMain.handle('arko:open-external-url', async (_e, url: string) => {
    if (url && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url)
    }
  })

  ipcMain.handle(
    'arko:update-viewport-bounds',
    (_e, bounds: ViewportBounds | DualViewportBounds) => {
      browserManager?.updateViewportBounds(bounds)
    }
  )

  ipcMain.handle('arko:set-overlay-active', async (_e, active: boolean) => {
    return (await browserManager?.setOverlayActive(active)) ?? { primary: null, secondary: null }
  })

  // Split View IPC
  ipcMain.handle('arko:open-split-view', async (_e, rightTabId?: string) => {
    await browserManager?.openSplitView(rightTabId)
  })

  ipcMain.handle('arko:close-split-view', (_e, keepSide?: SplitPaneSide) => {
    browserManager?.closeSplitView(keepSide)
  })

  ipcMain.handle('arko:swap-split-panes', () => {
    browserManager?.swapSplitPanes()
  })

  ipcMain.handle('arko:set-split-active-pane', (_e, side: SplitPaneSide) => {
    browserManager?.setSplitActivePane(side)
  })

  ipcMain.handle('arko:set-split-ratio', (_e, ratio: number) => {
    browserManager?.setSplitRatio(ratio)
  })

  // Tab IPC
  ipcMain.handle(
    'arko:create-tab',
    async (
      _e,
      url?: string,
      options?: {
        background?: boolean
        pinned?: boolean
        favorite?: boolean
        groupId?: string | null
        profileId?: string
        insertBeforeTabId?: string | null
      }
    ) => {
      return await browserManager!.createTab(url, options)
    }
  )

  ipcMain.handle('arko:switch-tab', (_e, tabId: string) => {
    browserManager?.switchTab(tabId)
  })

  ipcMain.handle('arko:close-tab', (_e, tabId: string) => {
    browserManager?.closeTab(tabId)
  })

  ipcMain.handle('arko:reopen-closed-tab', async () => {
    return (await browserManager?.reopenClosedTab()) ?? false
  })

  ipcMain.handle('arko:duplicate-tab', async (_e, tabId: string) => {
    return (await browserManager?.duplicateTab(tabId)) ?? null
  })

  ipcMain.handle(
    'arko:reorder-tab',
    (
      _e,
      sourceTabId: string,
      targetTabId: string,
      position?: 'before' | 'after',
      targetZone?: TabPinMode
    ) => {
      browserManager?.reorderTab(sourceTabId, targetTabId, position, targetZone)
    }
  )

  ipcMain.handle('arko:move-tab-to-zone', (_e, tabId: string, targetZone: TabPinMode) => {
    browserManager?.moveTabToZone(tabId, targetZone)
  })

  ipcMain.handle('arko:close-other-tabs', (_e, tabId: string) => {
    browserManager?.closeOtherTabs(tabId)
  })

  ipcMain.handle('arko:clear-unpinned-tabs', (_e, profileId?: string) => {
    return browserManager?.clearUnpinnedTabs(profileId) ?? 0
  })

  ipcMain.handle('arko:pin-tab', (_e, tabId: string, pinned: boolean) => {
    browserManager?.pinTab(tabId, pinned)
  })

  ipcMain.handle('arko:set-tab-pin-state', (_e, tabId: string, mode: TabPinMode) => {
    browserManager?.setTabPinState(tabId, mode)
  })

  ipcMain.handle('arko:reset-pinned-tab', (_e, tabId: string) => {
    browserManager?.resetPinnedTab(tabId)
  })

  ipcMain.handle('arko:navigate', (_e, input: string, tabId?: string) => {
    browserManager?.navigate(input, tabId)
  })

  ipcMain.handle('arko:go-back', () => {
    browserManager?.goBack()
  })

  ipcMain.handle('arko:go-forward', () => {
    browserManager?.goForward()
  })

  ipcMain.handle('arko:reload', () => {
    browserManager?.reload()
  })

  ipcMain.handle(
    'arko:set-page-zoom',
    (_e, action: 'in' | 'out' | 'reset', tabId?: string) => {
      return browserManager?.setPageZoom(action, tabId) ?? 1
    }
  )

  ipcMain.handle('arko:toggle-mute-tab', (_e, tabId: string) => {
    browserManager?.toggleMuteTab(tabId)
  })

  ipcMain.handle('arko:open-devtools', () => {
    browserManager?.openDevTools()
  })

  ipcMain.handle('arko:find-in-page', (_e, text: string, forward?: boolean) => {
    browserManager?.findInPage(text, forward)
  })

  ipcMain.handle('arko:stop-find-in-page', () => {
    browserManager?.stopFindInPage()
  })

  // Tab Groups & AI Organizer IPC
  ipcMain.handle(
    'arko:create-tab-group',
    (_e, title: string, color: TabGroupColor, tabIds?: string[]) => {
      return browserManager!.createTabGroup(title, color, tabIds)
    }
  )

  ipcMain.handle('arko:assign-tab-to-group', (_e, tabId: string, groupId: string | null) => {
    browserManager?.assignTabToGroup(tabId, groupId)
  })

  ipcMain.handle('arko:toggle-tab-group-collapsed', (_e, groupId: string) => {
    browserManager?.toggleTabGroupCollapsed(groupId)
  })

  ipcMain.handle('arko:delete-tab-group', (_e, groupId: string) => {
    browserManager?.deleteTabGroup(groupId)
  })

  ipcMain.handle('arko:organize-tabs-by-ai', async () => {
    return (
      (await browserManager?.organizeTabsByAI()) ?? {
        ok: false,
        groupCount: 0,
        error: 'BrowserManager not ready'
      }
    )
  })

  // Profiles, Bookmarks, History, Downloads, Reader & Memory
  ipcMain.handle('arko:switch-profile', (_e, profileId: string) => {
    browserManager?.switchProfile(profileId)
  })

  ipcMain.handle('arko:cycle-profile', (_e, direction: 1 | -1) => {
    browserManager?.cycleProfile(direction)
  })

  ipcMain.handle(
    'arko:create-profile',
    (_e, name: string, emoji: string, accentColor: string) => {
      return browserManager!.createProfile(name, emoji, accentColor)
    }
  )

  ipcMain.handle(
    'arko:update-profile',
    (
      _e,
      profileId: string,
      partial: Partial<Pick<BrowserProfile, 'name' | 'emoji' | 'accentColor'>>
    ) => {
      return browserManager?.updateProfile(profileId, partial) ?? null
    }
  )

  ipcMain.handle('arko:delete-profile', (_e, profileId: string) => {
    return browserManager?.deleteProfile(profileId) ?? false
  })

  ipcMain.handle(
    'arko:toggle-bookmark',
    (_e, url: string, title: string, favicon?: string) => {
      return browserManager!.toggleBookmark(url, title, favicon)
    }
  )

  ipcMain.handle('arko:remove-bookmark', (_e, bookmarkId: string) => {
    browserManager?.removeBookmark(bookmarkId)
  })

  ipcMain.handle('arko:clear-history', () => {
    if (!browserManager) return
    browserManager.store.clearHistory(browserManager.store.activeProfileId)
    browserManager.broadcastState()
  })

  ipcMain.handle('arko:clear-completed-downloads', () => {
    browserManager?.clearCompletedDownloads()
  })

  ipcMain.handle('arko:extract-reader-article', async (_e, tabId?: string) => {
    return await browserManager!.extractReaderArticle(tabId)
  })

  ipcMain.handle(
    'arko:add-memory',
    (_e, content: string, category?: MemoryItem['category'], source?: string) => {
      return browserManager!.addMemory(content, category, source)
    }
  )

  ipcMain.handle('arko:toggle-memory', (_e, memoryId: string, enabled: boolean) => {
    browserManager?.toggleMemory(memoryId, enabled)
  })

  ipcMain.handle('arko:delete-memory', (_e, memoryId: string) => {
    browserManager?.deleteMemory(memoryId)
  })

  ipcMain.handle('arko:update-settings', (_e, partial: Partial<AppSettings>) => {
    const prevLang = browserManager?.store.settings.language
    const updated = browserManager!.updateSettings(partial)
    if (partial.language && partial.language !== prevLang) {
      buildAppMenu(updated.language)
    }
    return updated
  })

  ipcMain.handle('arko:select-coding-workspace', async () => {
    return (await browserManager?.selectCodingWorkspace()) ?? null
  })

  ipcMain.handle('arko:clear-coding-workspace', () => {
    browserManager?.clearCodingWorkspace()
  })

  ipcMain.handle('arko:set-ai-sidebar-open', (_e, open: boolean) => {
    browserManager?.setAISidebarOpen(open)
  })

  ipcMain.handle('arko:get-account-state', () => {
    return accountService.getState()
  })

  ipcMain.handle('arko:get-auth-capabilities', async () => {
    return await accountService.getCapabilities()
  })

  ipcMain.handle('arko:get-register-captcha', async () => {
    return await accountService.getRegisterCaptcha()
  })

  ipcMain.handle('arko:send-email-verification-code', async (_e, email: string) => {
    return await accountService.sendEmailVerificationCode(email)
  })

  ipcMain.handle(
    'arko:register-account',
    async (
      _e,
      params: {
        email: string
        username?: string
        password: string
        verificationCode?: string
        captchaId?: string
        captchaCode?: string
      }
    ) => {
      const res = await accountService.registerAccount(params)
      if (res.ok) {
        browserManager?.applyCloudModels(res.models, true)
      }
      return res
    }
  )

  ipcMain.handle(
    'arko:login-account',
    async (_e, params: { identifier: string; password: string }) => {
      const res = await accountService.loginAccount(params)
      if (res.ok) {
        browserManager?.applyCloudModels(res.models, true)
      }
      return res
    }
  )

  ipcMain.handle(
    'arko:verify-2fa-login',
    async (_e, params: { flowToken: string; code: string }) => {
      const res = await accountService.verifyTwoFactorLogin(params)
      if (res.ok) {
        browserManager?.applyCloudModels(res.models, true)
      }
      return res
    }
  )

  ipcMain.handle('arko:send-password-reset-email', async (_e, email: string) => {
    return await accountService.sendPasswordResetEmail(email)
  })

  ipcMain.handle('arko:logout-account', async () => {
    return await accountService.logout()
  })

  ipcMain.handle('arko:refresh-account-profile', async () => {
    const res = await accountService.refreshProfile()
    if (res.models && res.models.length > 0) {
      browserManager?.applyCloudModels(res.models, false)
    }
    return res
  })

  ipcMain.handle('arko:redeem-account-code', async (_e, code: string) => {
    return await accountService.redeemCode(code)
  })

  ipcMain.handle(
    'arko:test-provider-connection',
    async (_e, provider: AIProviderConfig, modelId?: string) => {
      return await aiService.testConnection(provider, modelId)
    }
  )

  ipcMain.handle('arko:fetch-provider-models', async (_e, provider: AIProviderConfig) => {
    return await aiService.fetchModels(provider)
  })

  ipcMain.handle('arko:query-provider-quota', async (_e, provider: AIProviderConfig) => {
    return await aiService.queryProviderQuota(provider)
  })

  ipcMain.handle('arko:extract-page-context', async (_e, tabId?: string) => {
    return (await browserManager?.extractPageContext(tabId)) ?? null
  })

  ipcMain.handle('arko:capture-active-tab-screenshot', async (_e, tabId?: string) => {
    return (
      (await browserManager?.captureActiveTabScreenshot(tabId)) ?? {
        ok: false,
        error: 'BrowserManager not ready'
      }
    )
  })

  ipcMain.handle('arko:execute-local-skill', async (_e, commandInput: string, tabId?: string) => {
    return await browserManager!.executeLocalSkill(commandInput, tabId)
  })

  ipcMain.handle('arko:reveal-in-finder', (_e, filePath: string) => {
    browserManager?.revealInFinder(filePath)
  })

  ipcMain.handle('arko:create-thread', async () => {
    return await browserManager!.createThread()
  })

  ipcMain.handle('arko:delete-thread', (_e, threadId: string) => {
    browserManager?.deleteThread(threadId)
  })

  ipcMain.handle('arko:open-chat-as-tab', async (_e, threadId?: string) => {
    return await browserManager!.openChatAsTab(threadId)
  })

  ipcMain.handle('arko:dock-chat-tab-to-sidebar', (_e, tabId: string, threadId: string) => {
    browserManager?.dockChatTabToSidebar(tabId, threadId)
  })

  ipcMain.handle(
    'arko:send-chat-message',
    async (
      _e,
      params: {
        threadId: string
        prompt: string
        quotedText?: string
        imageDataUrl?: string
        enableAgentTools?: boolean
        mentions: ChatMention[]
        includeActiveTab: boolean
        providerId?: string
        modelId?: string
      }
    ) => {
      await browserManager?.sendChatMessage(params)
    }
  )

  ipcMain.handle(
    'arko:edit-and-resend-user-message',
    async (
      _e,
      params: {
        threadId: string
        messageId: string
        newPrompt: string
      }
    ) => {
      await browserManager?.editAndResendUserMessage(params)
    }
  )

  ipcMain.handle('arko:regenerate-last-reply', async (_e, threadId: string) => {
    await browserManager?.regenerateLastReply(threadId)
  })

  ipcMain.handle('arko:abort-chat-stream', (_e, threadId: string) => {
    aiService.abort(threadId)
  })

  // Inline Write & Webpage Form Preview Fill IPC
  ipcMain.handle(
    'arko:inspect-inline-write-target',
    async (_e, tabId?: string, preferredMode?: 'inline' | 'form') => {
      return (await browserManager?.inspectInlineWriteTarget(tabId, preferredMode)) ?? null
    }
  )

  ipcMain.handle(
    'arko:start-inline-write-stream',
    async (
      _e,
      params: {
        requestId: string
        tabId: string
        preset: InlineWriteActionPreset
        instruction: string
        selectedText: string
        surroundingValue: string
        fieldLabel: string
      }
    ) => {
      await browserManager?.startInlineWriteStream(params)
    }
  )

  ipcMain.handle('arko:abort-inline-write-stream', (_e, requestId: string) => {
    aiService.abortInline(requestId)
  })

  ipcMain.handle(
    'arko:apply-inline-write-result',
    async (
      _e,
      params: {
        tabId: string
        text: string
        mode: 'replace-or-insert' | 'append' | 'replace-all'
      }
    ) => {
      return (await browserManager?.applyInlineWriteResult(params)) ?? false
    }
  )

  ipcMain.handle(
    'arko:generate-form-fill-preview',
    async (
      _e,
      params: {
        tabId: string
        instruction: string
        fields: WebFormFieldInfo[]
      }
    ) => {
      return (
        (await browserManager?.generateFormFillPreview(params)) ?? {
          ok: false,
          proposals: [],
          error: 'BrowserManager not ready'
        }
      )
    }
  )

  ipcMain.handle(
    'arko:apply-form-fill-values',
    async (
      _e,
      params: {
        tabId: string
        fills: Array<{ fieldId: string; value: string }>
      }
    ) => {
      return (
        (await browserManager?.applyFormFillValues(params)) ?? {
          ok: false,
          appliedCount: 0
        }
      )
    }
  )
}

app.setName('Arko')

app.whenReady().then(() => {
  const store = new PersistenceStore()
  const accountService = new AccountService(store.legacyCloudApiKey)
  const aiService = new AIService(accountService)
  updateManager = new UpdateManager()

  accountService.setOnStateChange(() => {
    browserManager?.broadcastState()
  })

  updateManager.onStateChanged((st) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('arko:update-state', st)
    }
    browserManager?.broadcastState()
  })

  const appIcon = loadAppIcon()
  if (appIcon && process.platform === 'darwin') {
    app.dock?.setIcon(appIcon)
  }

  registerIpcHandlers(aiService, updateManager, accountService)
  buildAppMenu(store.settings.language)
  mainWindow = createMainWindow(store, aiService, updateManager, accountService)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow(store, aiService, updateManager!, accountService)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
