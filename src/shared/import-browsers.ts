import type { AppLanguage, ImportBrowserId } from './types'

/** Order shown in the import picker. Arc and Dia stay first; the rest follow install share. */
export const IMPORT_BROWSER_IDS: ImportBrowserId[] = [
  'arc',
  'dia',
  'chrome',
  'edge',
  'safari',
  'firefox',
  'brave',
  'opera',
  'vivaldi',
  'chromium'
]

export function emptyImportProfileSelection(): Record<ImportBrowserId, string[]> {
  const selection = {} as Record<ImportBrowserId, string[]>
  for (const id of IMPORT_BROWSER_IDS) selection[id] = []
  return selection
}

/** Chromium-family browsers can copy cookies, site storage, and unpacked extensions. */
export function importBrowserSupportsAccountData(id: ImportBrowserId): boolean {
  return id !== 'firefox' && id !== 'safari'
}

export function importBrowserTitle(
  id: ImportBrowserId,
  lang: AppLanguage,
  dataRoot?: string | null
): string {
  const root = dataRoot || ''
  if (id === 'opera' && /operagx|opera gx/i.test(root)) return 'Opera GX'
  if (id === 'chrome' && /canary|chrome sxs|google-chrome-unstable/i.test(root)) {
    return 'Chrome Canary'
  }
  if (id === 'edge' && /edge beta/i.test(root)) return 'Edge Beta'

  const zh = lang === 'zh-CN'
  switch (id) {
    case 'arc':
      return zh ? 'Arc 浏览器' : 'Arc Browser'
    case 'dia':
      return zh ? 'Dia 浏览器' : 'Dia Browser'
    case 'chrome':
      return 'Google Chrome'
    case 'edge':
      return 'Microsoft Edge'
    case 'safari':
      return 'Safari'
    case 'firefox':
      return 'Firefox'
    case 'brave':
      return 'Brave'
    case 'opera':
      return 'Opera'
    case 'vivaldi':
      return 'Vivaldi'
    case 'chromium':
      return 'Chromium'
  }
}

export function importBrowserTagline(id: ImportBrowserId, lang: AppLanguage): string {
  const zh = lang === 'zh-CN'
  switch (id) {
    case 'arc':
      return zh
        ? '按 Arc 侧栏 1:1 还原空间顺序，并带上 Profile 登录态、扩展、书签与历史。'
        : 'Keeps Arc’s sidebar order, then brings profiles, extensions, bookmarks, and history.'
    case 'dia':
      return zh
        ? '导入 Dia 的配置、登录态、扩展、书签与历史。'
        : 'Brings Dia profiles, signed-in sessions, extensions, bookmarks, and history.'
    case 'firefox':
      return zh
        ? '导入 Firefox 各配置的书签栏、完整书签和浏览历史。'
        : 'Brings each Firefox profile’s toolbar, bookmarks, and browsing history.'
    case 'safari':
      return zh
        ? '导入 Safari 个人收藏、书签和浏览历史。'
        : 'Brings Safari favorites, bookmarks, and browsing history.'
    case 'chrome':
    case 'edge':
    case 'brave':
    case 'opera':
    case 'vivaldi':
    case 'chromium':
      return zh
        ? '导入多配置登录态、扩展、书签栏和完整书签与历史。'
        : 'Brings profiles, logins, extensions, the bookmark bar, and history.'
  }
}
