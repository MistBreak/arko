import { execFileSync } from 'child_process'
import fs from 'fs'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
import { PROFILE_ACCENT_PRESETS } from '@shared/constants'
import type {
  BrowserImportRequest,
  DetectedBrowserProfileInfo,
  DetectedBrowserSource,
  ImportBrowserId
} from '@shared/types'

function loadNodeSqliteModule(): {
  DatabaseSync: new (p: string) => {
    prepare: (q: string) => { all: () => any[] }
    close: () => void
  }
} {
  const req =
    typeof require === 'function'
      ? require
      : createRequire(path.join(process.cwd(), 'package.json'))
  return req('node:sqlite')
}

// Chromium WebKit timestamps count microseconds since 1601-01-01T00:00:00Z
const WEBKIT_EPOCH_DIFF_MS = 11644473600000
const MIN_VALID_UNIX_MS = 946684800000 // 2000-01-01

const SPACE_FALLBACK_EMOJIS = ['💼', '🌿', '🚀', '🎨', '🔬', '⚡', '📚', '🌈']

export interface ImportedTabItem {
  url: string
  title: string
  favicon?: string
  folderTitle?: string | null
}

export interface ImportedSpacePayload {
  sourceId: string
  name: string
  emoji: string
  accentColor: string
  favorites: Array<{ url: string; title: string; favicon?: string }>
  pinnedTabs: ImportedTabItem[]
  bookmarks: Array<{ url: string; title: string; favicon?: string; createdAt: number }>
  history: Array<{
    url: string
    title: string
    favicon?: string
    visitedAt: number
    visitCount: number
  }>
}

export interface ParsedBrowserImportPayload {
  ok: boolean
  browserId: ImportBrowserId
  spaces: ImportedSpacePayload[]
  warnings: string[]
  error?: string
}

function isImportableWebUrl(raw?: string | null): raw is string {
  if (!raw || typeof raw !== 'string') return false
  const trimmed = raw.trim()
  return /^https?:\/\//i.test(trimmed)
}

function webkitMicrosToUnixMs(raw: unknown): number {
  const num = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  if (!Number.isFinite(num) || num <= 0) return Date.now()
  const ms = Math.round(num / 1000) - WEBKIT_EPOCH_DIFF_MS
  const maxAllowed = Date.now() + 86_400_000
  if (ms < MIN_VALID_UNIX_MS || ms > maxAllowed) {
    // Handle Unix seconds (e.g. HTML bookmarks ADD_DATE)
    if (num > 946684800 && num < maxAllowed / 1000) {
      return Math.round(num * 1000)
    }
    if (num >= MIN_VALID_UNIX_MS && num <= maxAllowed) {
      return Math.round(num)
    }
    return Date.now()
  }
  return ms
}

function safeReadJson<T = any>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > 120 * 1024 * 1024) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function getHostSafely(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Copies a Chromium SQLite file (+ optional -wal / -shm journals) to an isolated temp folder
 * so reading succeeds even while Chrome, Arc, or Dia is actively open and holding locks.
 */
function querySqliteSafely<T = Record<string, any>>(dbPath: string, sql: string): T[] {
  if (!fs.existsSync(dbPath)) return []
  let tmpDir: string | null = null
  try {
    const stat = fs.statSync(dbPath)
    if (!stat.isFile() || stat.size === 0 || stat.size > 250 * 1024 * 1024) return []

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arko-bimp-'))
    const baseName = path.basename(dbPath)
    const tmpDb = path.join(tmpDir, baseName)
    fs.copyFileSync(dbPath, tmpDb)

    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = `${dbPath}${suffix}`
      if (fs.existsSync(sidecar)) {
        try {
          fs.copyFileSync(sidecar, `${tmpDb}${suffix}`)
        } catch {
          // ignore transient WAL copy race
        }
      }
    }

    // Primary path: Electron 35 / Node 22 built-in node:sqlite
    try {
      const sqliteMod = loadNodeSqliteModule()
      const db = new sqliteMod.DatabaseSync(tmpDb)
      try {
        const rows = db.prepare(sql).all() as T[]
        return Array.isArray(rows) ? rows : []
      } finally {
        try {
          db.close()
        } catch {
          // ignore
        }
      }
    } catch {
      // Fallback path on macOS / Linux: system sqlite3 CLI with -json output
      if (process.platform !== 'win32') {
        const cliCandidates = ['/usr/bin/sqlite3', 'sqlite3']
        for (const bin of cliCandidates) {
          try {
            const stdout = execFileSync(bin, ['-json', tmpDb, sql], {
              encoding: 'utf-8',
              maxBuffer: 24 * 1024 * 1024,
              timeout: 7000
            })
            if (!stdout.trim()) return []
            const parsed = JSON.parse(stdout)
            return Array.isArray(parsed) ? (parsed as T[]) : []
          } catch {
            // try next candidate
          }
        }
      }
      return []
    }
  } catch {
    return []
  } finally {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        // ignore cleanup failure
      }
    }
  }
}

/**
 * Extracts cached PNG favicons as data URLs from Chromium's local Favicons SQLite DB
 * for a bounded set of candidate URLs (100% offline, zero network calls).
 */
function readChromiumFaviconsForUrls(
  faviconsDbPath: string,
  candidateUrls: Iterable<string>
): Map<string, string> {
  const result = new Map<string, string>()
  if (!fs.existsSync(faviconsDbPath)) return result

  const targetUrls = new Set<string>()
  const targetHosts = new Map<string, string[]>()
  for (const u of candidateUrls) {
    if (!isImportableWebUrl(u)) continue
    targetUrls.add(u)
    const h = getHostSafely(u)
    if (h) {
      const arr = targetHosts.get(h) || []
      arr.push(u)
      targetHosts.set(h, arr)
    }
    if (targetUrls.size >= 180) break
  }
  if (targetUrls.size === 0) return result

  const rows = querySqliteSafely<{ page_url: string; hex_png: string; width: number }>(
    faviconsDbPath,
    `SELECT m.page_url AS page_url, HEX(b.image_data) AS hex_png, b.width AS width
     FROM icon_mapping m
     JOIN favicon_bitmaps b ON m.icon_id = b.icon_id
     WHERE OCTET_LENGTH(b.image_data) > 0 AND OCTET_LENGTH(b.image_data) <= 16384
     ORDER BY b.width DESC
     LIMIT 3000`
  )

  const hostFallbackIcon = new Map<string, string>()
  for (const row of rows) {
    if (!row?.page_url || !row?.hex_png) continue
    const host = getHostSafely(row.page_url)
    if (!targetUrls.has(row.page_url) && (!host || !targetHosts.has(host))) {
      continue
    }
    // Verify PNG header (89504E47) or WebP/ICO and encode cleanly
    const isPng = row.hex_png.startsWith('89504E47')
    const mime = isPng ? 'image/png' : 'image/x-icon'
    const dataUrl = `data:${mime};base64,${Buffer.from(row.hex_png, 'hex').toString('base64')}`

    if (targetUrls.has(row.page_url) && !result.has(row.page_url)) {
      result.set(row.page_url, dataUrl)
    }
    if (host && targetHosts.has(host) && !hostFallbackIcon.has(host)) {
      hostFallbackIcon.set(host, dataUrl)
    }
    if (result.size >= targetUrls.size) break
  }

  for (const u of targetUrls) {
    if (result.has(u)) continue
    const h = getHostSafely(u)
    const fallback = h ? hostFallbackIcon.get(h) : undefined
    if (fallback) {
      result.set(u, fallback)
    }
  }

  return result
}

function readChromiumHistory(
  historyDbPath: string,
  limit = 1000
): Array<{ url: string; title: string; visitedAt: number; visitCount: number }> {
  const safeLimit = Math.max(50, Math.min(2000, Math.floor(limit)))
  const rows = querySqliteSafely<{
    url: string
    title: string
    visit_count: number
    last_visit_time: number
  }>(
    historyDbPath,
    `SELECT url, title, visit_count, last_visit_time
     FROM urls
     WHERE hidden = 0 AND (url LIKE 'https://%' OR url LIKE 'http://%')
     ORDER BY last_visit_time DESC
     LIMIT ${safeLimit}`
  )

  const items: Array<{ url: string; title: string; visitedAt: number; visitCount: number }> = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (!isImportableWebUrl(r?.url)) continue
    const cleanUrl = r.url.trim()
    if (seen.has(cleanUrl)) continue
    seen.add(cleanUrl)
    items.push({
      url: cleanUrl,
      title: (r.title || '').trim() || cleanUrl,
      visitedAt: webkitMicrosToUnixMs(r.last_visit_time),
      visitCount: Math.max(1, Number(r.visit_count) || 1)
    })
  }
  return items
}

interface ParsedChromiumBookmarks {
  allBookmarks: Array<{ url: string; title: string; createdAt: number }>
  barDirectLinks: Array<{ url: string; title: string }>
  barFolders: Array<{ folderTitle: string; links: Array<{ url: string; title: string }> }>
}

function parseChromiumBookmarksFile(bookmarksPath: string): ParsedChromiumBookmarks {
  const empty: ParsedChromiumBookmarks = {
    allBookmarks: [],
    barDirectLinks: [],
    barFolders: []
  }
  const raw = safeReadJson<{ roots?: Record<string, any> }>(bookmarksPath)
  if (!raw?.roots || typeof raw.roots !== 'object') return empty

  const allBookmarks: Array<{ url: string; title: string; createdAt: number }> = []
  const seenUrls = new Set<string>()

  const collectAll = (node: any): void => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'url' && isImportableWebUrl(node.url)) {
      const url = node.url.trim()
      if (!seenUrls.has(url)) {
        seenUrls.add(url)
        allBookmarks.push({
          url,
          title: String(node.name || '').trim() || url,
          createdAt: webkitMicrosToUnixMs(node.date_added)
        })
      }
      return
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        collectAll(child)
      }
    }
  }

  const barNode = raw.roots.bookmark_bar
  const barDirectLinks: Array<{ url: string; title: string }> = []
  const barFolders: Array<{ folderTitle: string; links: Array<{ url: string; title: string }> }> = []

  if (barNode && Array.isArray(barNode.children)) {
    for (const child of barNode.children) {
      if (child?.type === 'url' && isImportableWebUrl(child.url)) {
        barDirectLinks.push({
          url: child.url.trim(),
          title: String(child.name || '').trim() || child.url.trim()
        })
      } else if (child?.type === 'folder' && Array.isArray(child.children)) {
        const folderTitle = String(child.name || '').trim() || 'Bookmarks'
        const folderLinks: Array<{ url: string; title: string }> = []
        const walkFolder = (n: any): void => {
          if (!n || typeof n !== 'object') return
          if (n.type === 'url' && isImportableWebUrl(n.url)) {
            folderLinks.push({
              url: n.url.trim(),
              title: String(n.name || '').trim() || n.url.trim()
            })
          } else if (Array.isArray(n.children)) {
            for (const sub of n.children) walkFolder(sub)
          }
        }
        walkFolder(child)
        if (folderLinks.length > 0) {
          barFolders.push({ folderTitle, links: folderLinks })
        }
      }
    }
  }

  for (const key of ['bookmark_bar', 'other', 'synced']) {
    if (raw.roots[key]) collectAll(raw.roots[key])
  }
  for (const [key, val] of Object.entries(raw.roots)) {
    if (!['bookmark_bar', 'other', 'synced'].includes(key)) {
      collectAll(val)
    }
  }

  return { allBookmarks, barDirectLinks, barFolders }
}

function readChromiumPinnedTabsFromPrefs(
  prefsPath: string
): Array<{ url: string; title: string }> {
  const prefs = safeReadJson<{ pinned_tabs?: Array<{ url?: string; title?: string }> }>(prefsPath)
  if (!Array.isArray(prefs?.pinned_tabs)) return []
  const out: Array<{ url: string; title: string }> = []
  const seen = new Set<string>()
  for (const item of prefs.pinned_tabs) {
    if (!isImportableWebUrl(item?.url)) continue
    const url = item.url.trim()
    if (seen.has(url)) continue
    seen.add(url)
    out.push({
      url,
      title: String(item.title || '').trim() || getHostSafely(url) || url
    })
  }
  return out
}

/**
 * Parses Netscape Bookmark HTML export files (`bookmarks.html`) when selected manually.
 */
function parseNetscapeBookmarksHtml(htmlPath: string): ParsedChromiumBookmarks {
  const empty: ParsedChromiumBookmarks = {
    allBookmarks: [],
    barDirectLinks: [],
    barFolders: []
  }
  try {
    const html = fs.readFileSync(htmlPath, 'utf-8')
    const allBookmarks: Array<{ url: string; title: string; createdAt: number }> = []
    const seen = new Set<string>()
    const linkRe = /<A\b([^>]*)>([\s\S]*?)<\/A>/gi
    let match: RegExpExecArray | null
    while ((match = linkRe.exec(html)) !== null) {
      const attrs = match[1] || ''
      const rawTitle = (match[2] || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim()
      const hrefMatch = /\bHREF=["']([^"']+)["']/i.exec(attrs)
      const dateMatch = /\bADD_DATE=["']?(\d+)["']?/i.exec(attrs)
      const url = hrefMatch?.[1]?.trim()
      if (!isImportableWebUrl(url) || seen.has(url)) continue
      seen.add(url)
      allBookmarks.push({
        url,
        title: rawTitle || url,
        createdAt: dateMatch ? webkitMicrosToUnixMs(Number(dateMatch[1])) : Date.now()
      })
    }
    return {
      allBookmarks,
      barDirectLinks: allBookmarks.slice(0, 6).map((b) => ({ url: b.url, title: b.title })),
      barFolders: []
    }
  } catch {
    return empty
  }
}

// ==================== Browser Default Data Root Resolution ====================

function getCandidatePaths(browserId: ImportBrowserId): string[] {
  const home = os.homedir()
  const platform = process.platform
  const localAppData = process.env['LOCALAPPDATA'] || path.join(home, 'AppData', 'Local')

  if (browserId === 'arc') {
    if (platform === 'darwin') {
      return [path.join(home, 'Library', 'Application Support', 'Arc')]
    }
    if (platform === 'win32') {
      const candidates: string[] = []
      const packagesDir = path.join(localAppData, 'Packages')
      if (fs.existsSync(packagesDir)) {
        try {
          for (const entry of fs.readdirSync(packagesDir)) {
            if (entry.startsWith('TheBrowserCompany.Arc')) {
              candidates.push(path.join(packagesDir, entry, 'LocalCache', 'Local', 'Arc'))
            }
          }
        } catch {
          // ignore
        }
      }
      candidates.push(path.join(localAppData, 'Arc'))
      return candidates
    }
    return [path.join(home, '.config', 'arc')]
  }

  if (browserId === 'dia') {
    if (platform === 'darwin') {
      return [
        path.join(home, 'Library', 'Application Support', 'Dia', 'User Data'),
        path.join(home, 'Library', 'Application Support', 'Dia'),
        path.join(home, 'Library', 'Application Support', 'The Browser Company', 'Dia', 'User Data'),
        path.join(home, 'Library', 'Application Support', 'Dia Browser', 'dia-browser-store'),
        path.join(home, 'Library', 'Application Support', 'dia-browser', 'dia-browser-store')
      ]
    }
    if (platform === 'win32') {
      return [
        path.join(localAppData, 'Dia', 'User Data'),
        path.join(localAppData, 'The Browser Company', 'Dia', 'User Data'),
        path.join(localAppData, 'Dia')
      ]
    }
    return [path.join(home, '.config', 'dia')]
  }

  // Google Chrome
  if (platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome Canary'),
      path.join(home, 'Library', 'Application Support', 'Chromium')
    ]
  }
  if (platform === 'win32') {
    return [
      path.join(localAppData, 'Google', 'Chrome', 'User Data'),
      path.join(localAppData, 'Chromium', 'User Data')
    ]
  }
  return [
    path.join(home, '.config', 'google-chrome'),
    path.join(home, '.config', 'chromium')
  ]
}

// ==================== Arc StorableSidebar.json Parser ====================

/**
 * Swift's Codable encodes Dictionary<NonStringKey, Value> as alternating [id0, val0, id1, val1, ...].
 * Also gracefully handles array-of-objects and plain key-value records.
 */
function parseSwiftCollectionToOrderedEntries(raw: unknown): Array<[string, any]> {
  const entries: Array<[string, any]> = []
  if (!raw) return entries

  if (Array.isArray(raw)) {
    // Check alternating [stringId, objectVal, ...]
    if (raw.length >= 2 && typeof raw[0] === 'string' && raw[1] && typeof raw[1] === 'object') {
      for (let i = 0; i + 1 < raw.length; i += 2) {
        const key = raw[i]
        const val = raw[i + 1]
        if (typeof key === 'string' && val && typeof val === 'object') {
          entries.push([key, val])
        }
      }
      if (entries.length > 0) return entries
    }

    // Standard array of objects with .id
    for (const item of raw) {
      if (item && typeof item === 'object' && typeof item.id === 'string') {
        entries.push([item.id, item])
      }
    }
    return entries
  }

  if (typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, any>)) {
      if (v && typeof v === 'object') {
        entries.push([k, v])
      }
    }
  }
  return entries
}

function resolveArcProfileDirName(profileObj: any): string {
  if (!profileObj || typeof profileObj !== 'object') return 'Default'
  if (profileObj.default) return 'Default'
  const customDir =
    profileObj.custom?._0?.directoryBasename ||
    profileObj.custom?.directoryBasename ||
    profileObj.directoryBasename
  if (typeof customDir === 'string' && customDir.trim()) {
    return customDir.trim()
  }
  return 'Default'
}

function extractArcSpaceAccentHex(space: any, fallbackIdx: number): string {
  // Try extracting RGB float palette if Arc saved custom theme colors
  const colorNode =
    space?.customInfo?.windowTheme?.primaryColorPalette?.midTone ||
    space?.customInfo?.windowTheme?.blendedSingleColor ||
    space?.customInfo?.windowTheme?.background?.single?.color
  if (
    colorNode &&
    typeof colorNode.red === 'number' &&
    typeof colorNode.green === 'number' &&
    typeof colorNode.blue === 'number'
  ) {
    const clampByte = (v: number): number => {
      const normalized = v <= 1.05 ? v * 255 : v
      return Math.max(28, Math.min(225, Math.round(normalized)))
    }
    const r = clampByte(colorNode.red).toString(16).padStart(2, '0')
    const g = clampByte(colorNode.green).toString(16).padStart(2, '0')
    const b = clampByte(colorNode.blue).toString(16).padStart(2, '0')
    return `#${r}${g}${b}`.toUpperCase()
  }
  return PROFILE_ACCENT_PRESETS[fallbackIdx % PROFILE_ACCENT_PRESETS.length].hex
}

function extractArcSpaceEmoji(space: any, fallbackIdx: number): string {
  const iconType = space?.customInfo?.iconType
  if (iconType && typeof iconType === 'object') {
    const emoji = iconType.emoji_v2 || iconType.emoji
    if (typeof emoji === 'string' && emoji.trim()) {
      return emoji.trim().slice(0, 4)
    }
  }
  return SPACE_FALLBACK_EMOJIS[fallbackIdx % SPACE_FALLBACK_EMOJIS.length]
}

interface ArcParsedSidebar {
  spaces: Array<{
    id: string
    name: string
    emoji: string
    accentColor: string
    profileDir: string
    favorites: Array<{ url: string; title: string }>
    pinnedTabs: ImportedTabItem[]
  }>
}

function parseArcStorableSidebar(sidebarFilePath: string): ArcParsedSidebar | null {
  const json = safeReadJson<any>(sidebarFilePath)
  const containers: any[] = Array.isArray(json?.sidebar?.containers)
    ? json.sidebar.containers
    : Array.isArray(json?.containers)
      ? json.containers
      : []
  if (containers.length === 0) return null

  const parsedSpaces: ArcParsedSidebar['spaces'] = []

  for (const container of containers) {
    if (!container || typeof container !== 'object') continue
    const itemEntries = parseSwiftCollectionToOrderedEntries(container.items)
    const spaceEntries = parseSwiftCollectionToOrderedEntries(container.spaces)
    if (itemEntries.length === 0 && spaceEntries.length === 0) continue

    const itemsMap = new Map<string, any>(itemEntries)
    const childrenByParent = new Map<string, string[]>()

    for (const [id, item] of itemsMap.entries()) {
      const parentId = item?.parentID || item?.parentId
      if (typeof parentId === 'string' && parentId) {
        const list = childrenByParent.get(parentId) || []
        list.push(id)
        childrenByParent.set(parentId, list)
      }
    }

    const getChildIds = (nodeId: string, nodeObj?: any): string[] => {
      const item = nodeObj || itemsMap.get(nodeId)
      const explicit = item?.childrenIds || item?.childrenIDs
      if (Array.isArray(explicit) && explicit.length > 0) {
        return explicit.filter((cid: unknown): cid is string => typeof cid === 'string')
      }
      return childrenByParent.get(nodeId) || []
    }

    const collectTabsInNode = (
      nodeId: string,
      folderTitle: string | null,
      visited = new Set<string>()
    ): ImportedTabItem[] => {
      if (!nodeId || visited.has(nodeId)) return []
      visited.add(nodeId)
      const item = itemsMap.get(nodeId)
      if (!item || typeof item !== 'object') return []

      const tabData = item.data?.tab
      if (tabData && typeof tabData === 'object') {
        const rawUrl = tabData.savedURL || tabData.url || tabData.activeURL
        if (isImportableWebUrl(rawUrl)) {
          const cleanUrl = rawUrl.trim()
          const cleanTitle =
            String(item.title || tabData.savedTitle || tabData.title || '').trim() || cleanUrl
          return [{ url: cleanUrl, title: cleanTitle, folderTitle }]
        }
        return []
      }

      // Determine whether this node is a user folder (list)
      const isFolder = Boolean(item.data?.list) || (Boolean(item.title) && !item.data?.itemContainer)
      const currentFolderTitle = isFolder
        ? String(item.title || item.data?.list?.title || '').trim() || folderTitle || 'Folder'
        : folderTitle

      const results: ImportedTabItem[] = []
      for (const childId of getChildIds(nodeId, item)) {
        results.push(...collectTabsInNode(childId, currentFolderTitle, visited))
      }
      return results
    }

    // Parse topAppsContainerIDs (Arc Top Favorites Grid, keyed per Chromium profile)
    const favoritesByProfileDir = new Map<string, Array<{ url: string; title: string }>>()
    const rawTopApps = container.topAppsContainerIDs
    if (Array.isArray(rawTopApps)) {
      let pendingProfileDir = 'Default'
      for (const elem of rawTopApps) {
        if (elem && typeof elem === 'object') {
          pendingProfileDir = resolveArcProfileDirName(elem)
        } else if (typeof elem === 'string' && itemsMap.has(elem)) {
          const tabs = collectTabsInNode(elem, null)
          if (tabs.length > 0) {
            const existing = favoritesByProfileDir.get(pendingProfileDir) || []
            const seen = new Set(existing.map((x) => x.url))
            for (const t of tabs) {
              if (!seen.has(t.url)) {
                seen.add(t.url)
                existing.push({ url: t.url, title: t.title })
              }
            }
            favoritesByProfileDir.set(pendingProfileDir, existing)
          }
          pendingProfileDir = 'Default'
        }
      }
    }

    // Parse each Arc Space
    spaceEntries.forEach(([spaceId, spaceObj], idx) => {
      const profileDir = resolveArcProfileDirName(spaceObj?.profile)
      const name = String(spaceObj?.title || '').trim() || `Space ${idx + 1}`
      const emoji = extractArcSpaceEmoji(spaceObj, parsedSpaces.length)
      const accentColor = extractArcSpaceAccentHex(spaceObj, parsedSpaces.length)

      let pinnedContainerId: string | null = null
      const cids = spaceObj?.containerIDs
      if (Array.isArray(cids)) {
        const pinnedIdx = cids.indexOf('pinned')
        if (pinnedIdx >= 0 && typeof cids[pinnedIdx + 1] === 'string') {
          pinnedContainerId = cids[pinnedIdx + 1]
        } else {
          // Fallback: pick first container ID that is not preceded by 'unpinned'
          for (let i = 0; i < cids.length; i++) {
            if (
              typeof cids[i] === 'string' &&
              itemsMap.has(cids[i]) &&
              cids[i - 1] !== 'unpinned'
            ) {
              pinnedContainerId = cids[i]
              break
            }
          }
        }
      } else if (cids && typeof cids === 'object' && typeof cids.pinned === 'string') {
        pinnedContainerId = cids.pinned
      }

      const pinnedTabs = pinnedContainerId ? collectTabsInNode(pinnedContainerId, null) : []
      const favorites = (favoritesByProfileDir.get(profileDir) || []).slice(0, 8)

      parsedSpaces.push({
        id: spaceId,
        name,
        emoji,
        accentColor,
        profileDir,
        favorites,
        pinnedTabs
      })
    })
  }

  return parsedSpaces.length > 0 ? { spaces: parsedSpaces } : null
}

// ==================== Chromium User Data Directory Discovery ====================

interface DiscoveredChromiumProfile {
  dirName: string
  dirPath: string
  displayName: string
  bookmarksPath: string | null
  historyPath: string | null
  faviconsPath: string | null
  preferencesPath: string | null
}

function discoverChromiumProfiles(dataRoot: string): DiscoveredChromiumProfile[] {
  if (!fs.existsSync(dataRoot)) return []

  // Handle case where user pointed directly at a single profile directory (e.g. .../Default)
  const directBookmarks = path.join(dataRoot, 'Bookmarks')
  const directHistory = path.join(dataRoot, 'History')
  if (fs.existsSync(directBookmarks) || fs.existsSync(directHistory)) {
    const dirName = path.basename(dataRoot)
    const prefs = safeReadJson<any>(path.join(dataRoot, 'Preferences'))
    const displayName = String(prefs?.profile?.name || dirName).trim() || 'Default'
    return [
      {
        dirName,
        dirPath: dataRoot,
        displayName,
        bookmarksPath: fs.existsSync(directBookmarks) ? directBookmarks : null,
        historyPath: fs.existsSync(directHistory) ? directHistory : null,
        faviconsPath: fs.existsSync(path.join(dataRoot, 'Favicons'))
          ? path.join(dataRoot, 'Favicons')
          : null,
        preferencesPath: fs.existsSync(path.join(dataRoot, 'Preferences'))
          ? path.join(dataRoot, 'Preferences')
          : null
      }
    ]
  }

  // Handle case where user selected parent folder containing `User Data`
  const nestedUserData = path.join(dataRoot, 'User Data')
  const effectiveRoot =
    fs.existsSync(nestedUserData) && fs.statSync(nestedUserData).isDirectory()
      ? nestedUserData
      : dataRoot

  const localState = safeReadJson<any>(path.join(effectiveRoot, 'Local State'))
  const infoCache: Record<string, any> =
    localState?.profile?.info_cache && typeof localState.profile.info_cache === 'object'
      ? localState.profile.info_cache
      : {}

  const candidateDirs = new Set<string>(Object.keys(infoCache))
  try {
    for (const entry of fs.readdirSync(effectiveRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'Default' || /^Profile \d+$/i.test(entry.name)) {
        candidateDirs.add(entry.name)
      }
    }
  } catch {
    // ignore
  }

  const orderedDirNames = [...candidateDirs].sort((a, b) => {
    if (a === 'Default') return -1
    if (b === 'Default') return 1
    return a.localeCompare(b, undefined, { numeric: true })
  })

  const results: DiscoveredChromiumProfile[] = []
  for (const dirName of orderedDirNames) {
    const dirPath = path.join(effectiveRoot, dirName)
    if (!fs.existsSync(dirPath)) continue
    const bmPath = path.join(dirPath, 'Bookmarks')
    const histPath = path.join(dirPath, 'History')
    const favPath = path.join(dirPath, 'Favicons')
    const prefPath = path.join(dirPath, 'Preferences')

    const hasBm = fs.existsSync(bmPath)
    const hasHist = fs.existsSync(histPath)
    const hasPref = fs.existsSync(prefPath)
    if (!hasBm && !hasHist && !hasPref) continue

    const cacheEntry = infoCache[dirName]
    const prefs = !cacheEntry?.name && hasPref ? safeReadJson<any>(prefPath) : null
    const rawName =
      cacheEntry?.name ||
      cacheEntry?.shortcut_name ||
      prefs?.profile?.name ||
      (dirName === 'Default' ? 'Default' : dirName)

    results.push({
      dirName,
      dirPath,
      displayName: String(rawName).trim() || dirName,
      bookmarksPath: hasBm ? bmPath : null,
      historyPath: hasHist ? histPath : null,
      faviconsPath: fs.existsSync(favPath) ? favPath : null,
      preferencesPath: hasPref ? prefPath : null
    })
  }

  return results
}

// ==================== Legacy Local Dia Electron Store Support ====================

function isLegacyDiaStoreDir(dirPath: string): boolean {
  return (
    fs.existsSync(path.join(dirPath, 'bookmarks.json')) ||
    fs.existsSync(path.join(dirPath, 'sessions.json'))
  )
}

// ==================== Public Detection API ====================

const BROWSER_DISPLAY_NAMES: Record<ImportBrowserId, string> = {
  arc: 'Arc',
  dia: 'Dia',
  chrome: 'Google Chrome'
}

export function inspectBrowserAtPath(
  browserId: ImportBrowserId,
  targetPath: string | null,
  isCustomPath = false
): DetectedBrowserSource {
  const baseEmpty: DetectedBrowserSource = {
    id: browserId,
    name: BROWSER_DISPLAY_NAMES[browserId],
    detected: false,
    dataRootPath: null,
    isCustomPath,
    profiles: [],
    bookmarksEstimate: 0,
    pinnedEstimate: 0,
    hasHistory: false,
    supportsSpacesAndPinned: true
  }

  if (!targetPath || !fs.existsSync(targetPath)) {
    return baseEmpty
  }

  const stat = fs.statSync(targetPath)

  // Support selecting StorableSidebar.json or exported bookmarks.html directly
  if (stat.isFile()) {
    const lower = path.basename(targetPath).toLowerCase()
    if (lower.endsWith('.json')) {
      const arcSidebar = parseArcStorableSidebar(targetPath)
      if (arcSidebar) {
        const pinnedEstimate = arcSidebar.spaces.reduce(
          (acc, s) => acc + s.pinnedTabs.length + s.favorites.length,
          0
        )
        return {
          id: browserId,
          name: BROWSER_DISPLAY_NAMES[browserId],
          detected: true,
          dataRootPath: targetPath,
          isCustomPath,
          spacesCount: arcSidebar.spaces.length,
          profiles: arcSidebar.spaces.map((s) => ({
            id: s.id,
            name: s.name,
            emoji: s.emoji,
            accentColor: s.accentColor,
            favoriteCount: s.favorites.length,
            pinnedCount: s.pinnedTabs.length,
            bookmarkCount: s.pinnedTabs.length
          })),
          bookmarksEstimate: pinnedEstimate,
          pinnedEstimate,
          hasHistory: false,
          supportsSpacesAndPinned: true
        }
      }
    }
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      const parsedHtml = parseNetscapeBookmarksHtml(targetPath)
      if (parsedHtml.allBookmarks.length > 0) {
        return {
          id: browserId,
          name: BROWSER_DISPLAY_NAMES[browserId],
          detected: true,
          dataRootPath: targetPath,
          isCustomPath,
          profiles: [
            {
              id: 'html-export',
              name: path.basename(targetPath),
              emoji: '📑',
              accentColor: PROFILE_ACCENT_PRESETS[0].hex,
              bookmarkCount: parsedHtml.allBookmarks.length
            }
          ],
          bookmarksEstimate: parsedHtml.allBookmarks.length,
          pinnedEstimate: Math.min(6, parsedHtml.barDirectLinks.length),
          hasHistory: false,
          supportsSpacesAndPinned: false
        }
      }
    }
    return baseEmpty
  }

  // Check if Arc directory (or Dia directory with StorableSidebar.json)
  const sidebarJsonPath = path.join(targetPath, 'StorableSidebar.json')
  if (fs.existsSync(sidebarJsonPath)) {
    const arcSidebar = parseArcStorableSidebar(sidebarJsonPath)
    const chromiumProfiles = discoverChromiumProfiles(path.join(targetPath, 'User Data'))
    const hasHist = chromiumProfiles.some((p) => Boolean(p.historyPath))
    let extraBookmarks = 0
    for (const cp of chromiumProfiles) {
      if (cp.bookmarksPath) {
        extraBookmarks += parseChromiumBookmarksFile(cp.bookmarksPath).allBookmarks.length
      }
    }

    if (arcSidebar && arcSidebar.spaces.length > 0) {
      const pinnedTotal = arcSidebar.spaces.reduce(
        (sum, s) => sum + s.pinnedTabs.length + s.favorites.length,
        0
      )
      return {
        id: browserId,
        name: BROWSER_DISPLAY_NAMES[browserId],
        detected: true,
        dataRootPath: targetPath,
        isCustomPath,
        spacesCount: arcSidebar.spaces.length,
        profiles: arcSidebar.spaces.map((s) => {
          const matchingCp = chromiumProfiles.find((cp) => cp.dirName === s.profileDir)
          return {
            id: s.id,
            name: s.name,
            emoji: s.emoji,
            accentColor: s.accentColor,
            favoriteCount: s.favorites.length,
            pinnedCount: s.pinnedTabs.length,
            bookmarkCount: s.pinnedTabs.length,
            hasHistory: Boolean(matchingCp?.historyPath)
          }
        }),
        bookmarksEstimate: pinnedTotal + extraBookmarks,
        pinnedEstimate: pinnedTotal,
        hasHistory: hasHist,
        supportsSpacesAndPinned: true
      }
    }
  }

  // Check Legacy Dia Browser Electron JSON store
  if (browserId === 'dia' && isLegacyDiaStoreDir(targetPath)) {
    const bms = safeReadJson<any[]>(path.join(targetPath, 'bookmarks.json')) || []
    const hist = safeReadJson<any[]>(path.join(targetPath, 'history.json')) || []
    const sess = safeReadJson<any>(path.join(targetPath, 'sessions.json'))
    const rawProfiles = safeReadJson<any[]>(path.join(targetPath, 'profiles.json')) || []
    const pinnedCount = Array.isArray(sess?.tabs)
      ? sess.tabs.filter((t: any) => t?.isPinned || t?.isFavorite).length
      : 0
    return {
      id: 'dia',
      name: BROWSER_DISPLAY_NAMES.dia,
      detected: true,
      dataRootPath: targetPath,
      isCustomPath,
      spacesCount: rawProfiles.length || 1,
      profiles:
        rawProfiles.length > 0
          ? rawProfiles.map((p: any, idx: number) => ({
              id: String(p.id || `profile-${idx}`),
              name: String(p.name || `Space ${idx + 1}`),
              emoji: String(p.emoji || '✨'),
              accentColor: String(
                p.accentColor || PROFILE_ACCENT_PRESETS[idx % PROFILE_ACCENT_PRESETS.length].hex
              ),
              bookmarkCount: bms.filter((b: any) => b.profileId === p.id).length,
              hasHistory: hist.some((h: any) => h.profileId === p.id)
            }))
          : [
              {
                id: 'default',
                name: 'Dia Default',
                emoji: '✨',
                accentColor: PROFILE_ACCENT_PRESETS[0].hex,
                bookmarkCount: bms.length,
                pinnedCount,
                hasHistory: hist.length > 0
              }
            ],
      bookmarksEstimate: bms.length,
      pinnedEstimate: pinnedCount,
      hasHistory: hist.length > 0,
      supportsSpacesAndPinned: true
    }
  }

  // Standard Chromium User Data Layout (Dia Browser / Google Chrome / Arc fallback)
  const chromiumProfiles = discoverChromiumProfiles(targetPath)
  if (chromiumProfiles.length === 0) {
    return baseEmpty
  }

  let totalBookmarks = 0
  let totalPinned = 0
  let anyHistory = false

  const profileInfos: DetectedBrowserProfileInfo[] = chromiumProfiles.map((cp, idx) => {
    const bmParsed = cp.bookmarksPath
      ? parseChromiumBookmarksFile(cp.bookmarksPath)
      : { allBookmarks: [], barDirectLinks: [], barFolders: [] }
    const prefsPinned = cp.preferencesPath
      ? readChromiumPinnedTabsFromPrefs(cp.preferencesPath)
      : []
    const hasHist = Boolean(cp.historyPath)

    const pinnedEst =
      prefsPinned.length +
      Math.min(6, bmParsed.barDirectLinks.length) +
      bmParsed.barFolders.slice(0, 4).reduce((s, f) => s + Math.min(8, f.links.length), 0)

    totalBookmarks += bmParsed.allBookmarks.length
    totalPinned += pinnedEst
    if (hasHist) anyHistory = true

    return {
      id: cp.dirName,
      name: cp.displayName,
      emoji: SPACE_FALLBACK_EMOJIS[idx % SPACE_FALLBACK_EMOJIS.length],
      accentColor: PROFILE_ACCENT_PRESETS[idx % PROFILE_ACCENT_PRESETS.length].hex,
      bookmarkCount: bmParsed.allBookmarks.length,
      pinnedCount: pinnedEst,
      hasHistory: hasHist
    }
  })

  return {
    id: browserId,
    name: BROWSER_DISPLAY_NAMES[browserId],
    detected: true,
    dataRootPath: targetPath,
    isCustomPath,
    profiles: profileInfos,
    bookmarksEstimate: totalBookmarks,
    pinnedEstimate: totalPinned,
    hasHistory: anyHistory,
    supportsSpacesAndPinned: true
  }
}

export function detectAllBrowsers(): DetectedBrowserSource[] {
  const order: ImportBrowserId[] = ['arc', 'dia', 'chrome']
  return order.map((browserId) => {
    const candidates = getCandidatePaths(browserId)
    for (const candidate of candidates) {
      const inspected = inspectBrowserAtPath(browserId, candidate, false)
      if (inspected.detected) {
        return inspected
      }
    }
    return inspectBrowserAtPath(browserId, null, false)
  })
}

// ==================== Full Browser Data Import Extraction ====================

export function parseBrowserDataForImport(request: BrowserImportRequest): ParsedBrowserImportPayload {
  const { browserId, customPath, selectedProfileIds, scopes } = request
  const warnings: string[] = []

  let rootPath: string | null = customPath?.trim() || null
  if (!rootPath) {
    for (const candidate of getCandidatePaths(browserId)) {
      const check = inspectBrowserAtPath(browserId, candidate, false)
      if (check.detected) {
        rootPath = check.dataRootPath
        break
      }
    }
  }

  if (!rootPath || !fs.existsSync(rootPath)) {
    return {
      ok: false,
      browserId,
      spaces: [],
      warnings,
      error: `Could not find ${BROWSER_DISPLAY_NAMES[browserId]} data directory.`
    }
  }

  const selectedSet =
    Array.isArray(selectedProfileIds) && selectedProfileIds.length > 0
      ? new Set(selectedProfileIds)
      : null

  const stat = fs.statSync(rootPath)

  // Case 1: Single file selected manually (.json sidebar or .html bookmarks)
  if (stat.isFile()) {
    const lower = path.basename(rootPath).toLowerCase()
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      const htmlParsed = parseNetscapeBookmarksHtml(rootPath)
      return {
        ok: true,
        browserId,
        warnings,
        spaces: [
          {
            sourceId: 'html-export',
            name: BROWSER_DISPLAY_NAMES[browserId],
            emoji: '📑',
            accentColor: PROFILE_ACCENT_PRESETS[0].hex,
            favorites: scopes.spacesAndPinned ? htmlParsed.barDirectLinks.slice(0, 4) : [],
            pinnedTabs: [],
            bookmarks: scopes.bookmarks ? htmlParsed.allBookmarks : [],
            history: []
          }
        ]
      }
    }

    if (lower.endsWith('.json')) {
      const arcSidebar = parseArcStorableSidebar(rootPath)
      if (!arcSidebar) {
        return {
          ok: false,
          browserId,
          spaces: [],
          warnings,
          error: 'Unrecognized JSON file format (expected Arc StorableSidebar.json).'
        }
      }
      const spaces: ImportedSpacePayload[] = arcSidebar.spaces
        .filter((s) => !selectedSet || selectedSet.has(s.id))
        .map((s) => ({
          sourceId: s.id,
          name: s.name,
          emoji: s.emoji,
          accentColor: s.accentColor,
          favorites: scopes.spacesAndPinned ? s.favorites : [],
          pinnedTabs: scopes.spacesAndPinned ? s.pinnedTabs : [],
          bookmarks: scopes.bookmarks
            ? s.pinnedTabs.map((t) => ({ url: t.url, title: t.title, createdAt: Date.now() }))
            : [],
          history: []
        }))
      return { ok: true, browserId, spaces, warnings }
    }
  }

  // Case 2: Arc Directory (with StorableSidebar.json + User Data)
  const sidebarJsonPath = path.join(rootPath, 'StorableSidebar.json')
  if (fs.existsSync(sidebarJsonPath)) {
    const arcSidebar = parseArcStorableSidebar(sidebarJsonPath)
    const chromiumProfiles = discoverChromiumProfiles(path.join(rootPath, 'User Data'))
    const chromiumByDir = new Map(chromiumProfiles.map((cp) => [cp.dirName, cp]))

    if (arcSidebar && arcSidebar.spaces.length > 0) {
      const filteredSpaces = arcSidebar.spaces.filter(
        (s) => !selectedSet || selectedSet.has(s.id)
      )
      const consumedHistoryProfileDirs = new Set<string>()
      const faviconsCacheByDir = new Map<string, Map<string, string>>()

      // Gather candidate URLs per Chromium profile dir so we only query each Favicons DB once
      const urlsByProfileDir = new Map<string, Set<string>>()
      for (const s of filteredSpaces) {
        const set = urlsByProfileDir.get(s.profileDir) || new Set<string>()
        for (const f of s.favorites) set.add(f.url)
        for (const p of s.pinnedTabs) set.add(p.url)
        urlsByProfileDir.set(s.profileDir, set)
      }

      for (const [pDir, urlSet] of urlsByProfileDir.entries()) {
        const cp = chromiumByDir.get(pDir)
        if (cp?.faviconsPath) {
          faviconsCacheByDir.set(pDir, readChromiumFaviconsForUrls(cp.faviconsPath, urlSet))
        }
      }

      const spaces: ImportedSpacePayload[] = filteredSpaces.map((s) => {
        const cp = chromiumByDir.get(s.profileDir)
        const iconMap = faviconsCacheByDir.get(s.profileDir) || new Map<string, string>()

        const favorites = scopes.spacesAndPinned
          ? s.favorites.map((f) => ({
              url: f.url,
              title: f.title,
              favicon: iconMap.get(f.url)
            }))
          : []

        const pinnedTabs: ImportedTabItem[] = scopes.spacesAndPinned
          ? s.pinnedTabs.map((p) => ({
              url: p.url,
              title: p.title,
              folderTitle: p.folderTitle,
              favicon: iconMap.get(p.url)
            }))
          : []

        // Combine Arc Pinned items + any Chromium Bookmarks in that profile
        const bookmarks: ImportedSpacePayload['bookmarks'] = []
        if (scopes.bookmarks) {
          const seenBm = new Set<string>()
          for (const p of [...s.favorites, ...s.pinnedTabs]) {
            if (!seenBm.has(p.url)) {
              seenBm.add(p.url)
              bookmarks.push({
                url: p.url,
                title: p.title,
                favicon: iconMap.get(p.url),
                createdAt: Date.now()
              })
            }
          }
          if (cp?.bookmarksPath && !consumedHistoryProfileDirs.has(`bm:${s.profileDir}`)) {
            consumedHistoryProfileDirs.add(`bm:${s.profileDir}`)
            const cpBm = parseChromiumBookmarksFile(cp.bookmarksPath)
            for (const b of cpBm.allBookmarks) {
              if (!seenBm.has(b.url)) {
                seenBm.add(b.url)
                bookmarks.push({
                  url: b.url,
                  title: b.title,
                  favicon: iconMap.get(b.url),
                  createdAt: b.createdAt
                })
              }
            }
          }
        }

        // Attach Chromium History once per underlying Chromium Profile directory
        let history: ImportedSpacePayload['history'] = []
        if (scopes.history && cp?.historyPath && !consumedHistoryProfileDirs.has(s.profileDir)) {
          consumedHistoryProfileDirs.add(s.profileDir)
          history = readChromiumHistory(cp.historyPath, 1000).map((h) => ({
            ...h,
            favicon: iconMap.get(h.url)
          }))
        }

        return {
          sourceId: s.id,
          name: s.name,
          emoji: s.emoji,
          accentColor: s.accentColor,
          favorites,
          pinnedTabs,
          bookmarks,
          history
        }
      })

      return { ok: true, browserId, spaces, warnings }
    }
  }

  // Case 3: Legacy Dia Browser Electron Store
  if (browserId === 'dia' && isLegacyDiaStoreDir(rootPath)) {
    const rawProfiles = safeReadJson<any[]>(path.join(rootPath, 'profiles.json')) || [
      { id: 'work', name: 'Dia', emoji: '✨', accentColor: PROFILE_ACCENT_PRESETS[0].hex }
    ]
    const bms = safeReadJson<any[]>(path.join(rootPath, 'bookmarks.json')) || []
    const hist = safeReadJson<any[]>(path.join(rootPath, 'history.json')) || []
    const sess = safeReadJson<any>(path.join(rootPath, 'sessions.json'))
    const sessTabs: any[] = Array.isArray(sess?.tabs) ? sess.tabs : []
    const sessGroups: any[] = Array.isArray(sess?.tabGroups) ? sess.tabGroups : []
    const groupTitleById = new Map<string, string>(
      sessGroups.map((g: any) => [String(g.id), String(g.title || 'Group')])
    )

    const spaces: ImportedSpacePayload[] = rawProfiles
      .filter((p: any) => !selectedSet || selectedSet.has(String(p.id)))
      .map((p: any, idx: number) => {
        const pid = String(p.id)
        const pTabs = sessTabs.filter((t: any) => t?.profileId === pid && isImportableWebUrl(t?.url))
        return {
          sourceId: pid,
          name: String(p.name || `Dia Space ${idx + 1}`),
          emoji: String(p.emoji || '✨'),
          accentColor: String(
            p.accentColor || PROFILE_ACCENT_PRESETS[idx % PROFILE_ACCENT_PRESETS.length].hex
          ),
          favorites: scopes.spacesAndPinned
            ? pTabs
                .filter((t: any) => t.isFavorite)
                .map((t: any) => ({ url: t.url, title: t.title || t.url, favicon: t.favicon }))
            : [],
          pinnedTabs: scopes.spacesAndPinned
            ? pTabs
                .filter((t: any) => t.isPinned && !t.isFavorite)
                .map((t: any) => ({
                  url: t.url,
                  title: t.title || t.url,
                  favicon: t.favicon,
                  folderTitle: t.groupId ? groupTitleById.get(String(t.groupId)) || null : null
                }))
            : [],
          bookmarks: scopes.bookmarks
            ? bms
                .filter((b: any) => b?.profileId === pid && isImportableWebUrl(b?.url))
                .map((b: any) => ({
                  url: b.url,
                  title: b.title || b.url,
                  favicon: b.favicon,
                  createdAt: Number(b.createdAt) || Date.now()
                }))
            : [],
          history: scopes.history
            ? hist
                .filter((h: any) => h?.profileId === pid && isImportableWebUrl(h?.url))
                .map((h: any) => ({
                  url: h.url,
                  title: h.title || h.url,
                  favicon: h.favicon,
                  visitedAt: Number(h.visitedAt) || Date.now(),
                  visitCount: Number(h.visitCount) || 1
                }))
            : []
        }
      })

    return { ok: true, browserId, spaces, warnings }
  }

  // Case 4: Standard Chromium User Data Directory (Google Chrome & Dia Browser)
  const chromiumProfiles = discoverChromiumProfiles(rootPath).filter(
    (cp) => !selectedSet || selectedSet.has(cp.dirName)
  )
  if (chromiumProfiles.length === 0) {
    return {
      ok: false,
      browserId,
      spaces: [],
      warnings,
      error: `No valid browser profiles found in ${rootPath}.`
    }
  }

  const spaces: ImportedSpacePayload[] = chromiumProfiles.map((cp, idx) => {
    const bmParsed = cp.bookmarksPath
      ? parseChromiumBookmarksFile(cp.bookmarksPath)
      : { allBookmarks: [], barDirectLinks: [], barFolders: [] }
    const prefsPinned = cp.preferencesPath
      ? readChromiumPinnedTabsFromPrefs(cp.preferencesPath)
      : []

    const favorites: Array<{ url: string; title: string; favicon?: string }> = []
    const pinnedTabs: ImportedTabItem[] = []

    if (scopes.spacesAndPinned) {
      const seenPinned = new Set<string>()
      // First: explicit Chromium pinned tabs
      for (const pt of prefsPinned) {
        if (!seenPinned.has(pt.url)) {
          seenPinned.add(pt.url)
          pinnedTabs.push({ url: pt.url, title: pt.title, folderTitle: null })
        }
      }
      // Promote up to 4 top-level Bookmark Bar links into Favorites Grid for an instant Arc/Arko sidebar feel
      for (const link of bmParsed.barDirectLinks.slice(0, 4)) {
        if (!seenPinned.has(link.url)) {
          seenPinned.add(link.url)
          favorites.push({ url: link.url, title: link.title })
        }
      }
      // Remaining direct Bookmark Bar links (up to 8) -> Pinned Tabs
      for (const link of bmParsed.barDirectLinks.slice(4, 12)) {
        if (!seenPinned.has(link.url)) {
          seenPinned.add(link.url)
          pinnedTabs.push({ url: link.url, title: link.title, folderTitle: null })
        }
      }
      // Top-level Bookmark Bar folders (up to 5 folders, max 8 items per folder) -> Collapsible Pinned Groups
      for (const folder of bmParsed.barFolders.slice(0, 5)) {
        for (const link of folder.links.slice(0, 8)) {
          if (!seenPinned.has(link.url)) {
            seenPinned.add(link.url)
            pinnedTabs.push({
              url: link.url,
              title: link.title,
              folderTitle: folder.folderTitle
            })
          }
        }
      }
    }

    const rawHistory =
      scopes.history && cp.historyPath ? readChromiumHistory(cp.historyPath, 1000) : []

    // Hydrate cached favicons for Favorites, Pinned Tabs, and top Bookmarks
    const iconCandidateUrls = new Set<string>()
    for (const f of favorites) iconCandidateUrls.add(f.url)
    for (const p of pinnedTabs) iconCandidateUrls.add(p.url)
    for (const b of bmParsed.allBookmarks.slice(0, 80)) iconCandidateUrls.add(b.url)

    const iconMap = cp.faviconsPath
      ? readChromiumFaviconsForUrls(cp.faviconsPath, iconCandidateUrls)
      : new Map<string, string>()

    for (const f of favorites) {
      f.favicon = iconMap.get(f.url)
    }
    for (const p of pinnedTabs) {
      p.favicon = iconMap.get(p.url)
    }

    const bookmarks = scopes.bookmarks
      ? bmParsed.allBookmarks.slice(0, 4000).map((b) => ({
          url: b.url,
          title: b.title,
          favicon: iconMap.get(b.url),
          createdAt: b.createdAt
        }))
      : []

    const history = rawHistory.map((h) => ({
      ...h,
      favicon: iconMap.get(h.url)
    }))

    const profileDisplayName =
      chromiumProfiles.length === 1 && cp.displayName === 'Default'
        ? BROWSER_DISPLAY_NAMES[browserId]
        : cp.displayName

    return {
      sourceId: cp.dirName,
      name: profileDisplayName,
      emoji: SPACE_FALLBACK_EMOJIS[idx % SPACE_FALLBACK_EMOJIS.length],
      accentColor: PROFILE_ACCENT_PRESETS[idx % PROFILE_ACCENT_PRESETS.length].hex,
      favorites,
      pinnedTabs,
      bookmarks,
      history
    }
  })

  return { ok: true, browserId, spaces, warnings }
}
