import { execFileSync } from 'child_process'
import fs from 'fs'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
import { PROFILE_ACCENT_PRESETS } from '@shared/constants'
import type {
  AppLanguage,
  BrowserImportRequest,
  DetectedBrowserProfileInfo,
  DetectedBrowserSource,
  DetectedExtensionPreview,
  ImportBrowserId
} from '@shared/types'
import {
  scanChromiumProfileExtensions,
  type ScannedSourceExtension
} from './extension-manager'
import { hasChromiumSessionData } from './session-migrator'

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

export interface ImportedProfileResource {
  profileDir: string
  profileDirPath: string
  displayName: string
  hasSessionData: boolean
  extensions: ScannedSourceExtension[]
}

export interface ImportedSpacePayload {
  sourceId: string
  name: string
  profileDir?: string
  profileName?: string
  emoji: string
  accentColor: string
  favorites: Array<{ url: string; title: string; favicon?: string }>
  pinnedTabs: ImportedTabItem[]
  openTabs: ImportedTabItem[]
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
  profileResources: ImportedProfileResource[]
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
    if (!stat.isFile() || stat.size > 160 * 1024 * 1024) return null
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
export function querySqliteSafely<T = Record<string, any>>(dbPath: string, sql: string): T[] {
  if (!fs.existsSync(dbPath)) return []
  let tmpDir: string | null = null
  try {
    const stat = fs.statSync(dbPath)
    if (!stat.isFile() || stat.size === 0 || stat.size > 350 * 1024 * 1024) return []

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
              maxBuffer: 32 * 1024 * 1024,
              timeout: 9000
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
 * Extracts cached PNG/WebP/ICO favicons as data URLs from Chromium's local Favicons SQLite DB
 * for a large set of candidate URLs (100% offline, zero network calls).
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
    if (targetUrls.size >= 1200) break
  }
  if (targetUrls.size === 0) return result

  const rows = querySqliteSafely<{ page_url: string; hex_png: string; width: number }>(
    faviconsDbPath,
    `SELECT m.page_url AS page_url, HEX(b.image_data) AS hex_png, b.width AS width
     FROM icon_mapping m
     JOIN favicon_bitmaps b ON m.icon_id = b.icon_id
     WHERE OCTET_LENGTH(b.image_data) > 0 AND OCTET_LENGTH(b.image_data) <= 24576
     ORDER BY b.width DESC
     LIMIT 15000`
  )

  const hostFallbackIcon = new Map<string, string>()
  for (const row of rows) {
    if (!row?.page_url || !row?.hex_png) continue
    const host = getHostSafely(row.page_url)
    if (!targetUrls.has(row.page_url) && (!host || !targetHosts.has(host))) {
      continue
    }
    const isPng = row.hex_png.startsWith('89504E47')
    const isWebp = row.hex_png.startsWith('52494646')
    const mime = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/x-icon'
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
  limit = 1500
): Array<{ url: string; title: string; visitedAt: number; visitCount: number }> {
  const safeLimit = Math.max(50, Math.min(2500, Math.floor(limit)))
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
        const walkFolder = (n: any, prefix: string): void => {
          if (!n || typeof n !== 'object') return
          if (n.type === 'url' && isImportableWebUrl(n.url)) {
            folderLinks.push({
              url: n.url.trim(),
              title: String(n.name || '').trim() || n.url.trim()
            })
          } else if (Array.isArray(n.children)) {
            const subName = String(n.name || '').trim()
            const nextPrefix = subName && subName !== prefix ? `${prefix} / ${subName}` : prefix
            for (const sub of n.children) walkFolder(sub, nextPrefix)
          }
        }
        walkFolder(child, folderTitle)
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

// ==================== Arc StorableSidebar.json & Space Order Parser ====================

/**
 * Swift's Codable encodes Dictionary/OrderedDictionary<NonStringKey, Value> as alternating [id0, val0, id1, val1, ...].
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

    // Standard array of objects with .id or .value.id
    for (const item of raw) {
      if (item && typeof item === 'object') {
        const id =
          typeof item.id === 'string'
            ? item.id
            : typeof item.value?.id === 'string'
              ? item.value.id
              : null
        if (id) {
          entries.push([id, item.value && typeof item.value === 'object' ? item.value : item])
        }
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

function extractStringIdSequence(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const ids: string[] = []
  // Check alternating [stringId, objectVal, ...] (Swift OrderedDictionary / IdentifiableArray)
  if (raw.length >= 2 && typeof raw[0] === 'string' && raw[1] && typeof raw[1] === 'object') {
    for (let i = 0; i + 1 < raw.length; i += 2) {
      if (typeof raw[i] === 'string' && raw[i].trim()) {
        ids.push(raw[i].trim())
      }
    }
    if (ids.length > 0) return ids
  }
  for (const elem of raw) {
    if (typeof elem === 'string' && elem.trim()) {
      ids.push(elem.trim())
    } else if (elem && typeof elem === 'object') {
      const id =
        typeof (elem as any).id === 'string'
          ? (elem as any).id
          : typeof (elem as any).spaceID === 'string'
            ? (elem as any).spaceID
            : typeof (elem as any).value?.id === 'string'
              ? (elem as any).value.id
              : null
      if (id && id.trim()) {
        ids.push(id.trim())
      }
    }
  }
  return ids
}

/**
 * Extracts explicit visual Space order from StorableSidebar.json (`spaceModels` / `orderedSpaceIDs` / `spacesOrder`)
 * and optional sibling `StorableWindows.json` (`sidebarWindowState`) so Space order matches Arc's sidebar 1:1.
 */
function extractExplicitArcSpaceOrder(
  sidebarJson: any,
  primaryContainer: any,
  sidebarFilePath: string
): string[] {
  const candidates: unknown[] = [
    primaryContainer?.orderedSpaceIDs,
    primaryContainer?.spacesOrder,
    primaryContainer?.spaceIDs,
    primaryContainer?.spaceModels,
    sidebarJson?.sidebar?.orderedSpaceIDs,
    sidebarJson?.sidebar?.spacesOrder,
    sidebarJson?.sidebar?.spaceModels,
    sidebarJson?.sidebarSyncState?.spaceModels,
    sidebarJson?.sidebarSyncState?.orderedSpaceIDs,
    sidebarJson?.firebaseSyncState?.syncData?.spaceModels,
    sidebarJson?.firebaseSyncState?.syncData?.orderedSpaceIDs
  ]

  for (const cand of candidates) {
    const seq = extractStringIdSequence(cand)
    if (seq.length >= 2) {
      return seq
    }
  }

  // Also check sibling StorableWindows.json in Arc's root directory if present
  try {
    const windowsJsonPath = path.join(path.dirname(sidebarFilePath), 'StorableWindows.json')
    if (fs.existsSync(windowsJsonPath)) {
      const winJson = safeReadJson<any>(windowsJsonPath)
      const foundLists: string[][] = []
      const walkWin = (node: any, depth = 0): void => {
        if (!node || typeof node !== 'object' || depth > 6) return
        if (Array.isArray(node)) {
          for (const sub of node) walkWin(sub, depth + 1)
          return
        }
        for (const key of ['orderedSpaceIDs', 'spacesOrder', 'spaceIDs', 'spaceModels']) {
          if (key in node) {
            const seq = extractStringIdSequence(node[key])
            if (seq.length >= 2) foundLists.push(seq)
          }
        }
        for (const val of Object.values(node)) {
          if (val && typeof val === 'object') walkWin(val, depth + 1)
        }
      }
      walkWin(winJson)
      if (foundLists.length > 0) {
        foundLists.sort((a, b) => b.length - a.length)
        return foundLists[0]
      }
    }
  } catch {
    // ignore optional StorableWindows lookup
  }

  return []
}

function resolveArcProfileDirName(profileObj: any): string {
  if (!profileObj || typeof profileObj !== 'object') return 'Default'
  if (profileObj.default) return 'Default'
  const customDir =
    profileObj.custom?._0?.directoryBasename ||
    profileObj.custom?.directoryBasename ||
    profileObj.directoryBasename ||
    profileObj._0?.directoryBasename
  if (typeof customDir === 'string' && customDir.trim()) {
    return customDir.trim()
  }
  return 'Default'
}

const ARC_ICON_NAME_TO_EMOJI: Record<string, string> = {
  planet: '🪐',
  globe: '🌐',
  network: '🌐',
  briefcase: '💼',
  suitcase: '💼',
  case: '💼',
  laptop: '💻',
  laptopcomputer: '💻',
  desktopcomputer: '🖥️',
  display: '🖥️',
  terminal: '⌨️',
  code: '💻',
  chevron: '💻',
  book: '📚',
  bookmark: '🔖',
  graduationcap: '🎓',
  heart: '❤️',
  star: '⭐',
  sparkles: '✨',
  wand: '🪄',
  flame: '🔥',
  fire: '🔥',
  bolt: '⚡',
  lightning: '⚡',
  leaf: '🌿',
  tree: '🌲',
  paintbrush: '🎨',
  palette: '🎨',
  swatchpalette: '🎨',
  camera: '📷',
  photo: '🖼️',
  music: '🎵',
  headphones: '🎧',
  gamecontroller: '🎮',
  cart: '🛒',
  bag: '🛍️',
  creditcard: '💳',
  chart: '📈',
  house: '🏠',
  home: '🏠',
  person: '👤',
  folder: '📁',
  hammer: '🔨',
  wrench: '🔧',
  flask: '🔬',
  atom: '⚛️',
  airplane: '✈️',
  moon: '🌙',
  sun: '☀️',
  cloud: '☁️'
}

function extractArcSpaceAccentHex(space: any, fallbackIdx: number): string {
  const colorNode =
    space?.customInfo?.windowTheme?.primaryColorPalette?.midTone ||
    space?.customInfo?.windowTheme?.primaryColorPalette?.shadedLight ||
    space?.customInfo?.windowTheme?.background?.single?._0?.style?.color?._0?.blendedSingleColor
      ?._0?.color ||
    space?.customInfo?.windowTheme?.background?.gradient?._0?.colors?.[0] ||
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
      return emoji.trim().slice(0, 6)
    }
    if (typeof iconType.icon === 'string' && iconType.icon.trim()) {
      const iconKey = iconType.icon.trim().toLowerCase()
      if (ARC_ICON_NAME_TO_EMOJI[iconKey]) {
        return ARC_ICON_NAME_TO_EMOJI[iconKey]
      }
      for (const [k, mapped] of Object.entries(ARC_ICON_NAME_TO_EMOJI)) {
        if (iconKey.includes(k)) return mapped
      }
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
    openTabs: ImportedTabItem[]
  }>
}

function isGlobalContainerMarker(node: unknown): boolean {
  if (node === 'global') return true
  return Boolean(node && typeof node === 'object' && !Array.isArray(node) && 'global' in node)
}

function parseArcStorableSidebar(sidebarFilePath: string): ArcParsedSidebar | null {
  const json = safeReadJson<any>(sidebarFilePath)
  const containers: any[] = Array.isArray(json?.sidebar?.containers)
    ? json.sidebar.containers
    : Array.isArray(json?.containers)
      ? json.containers
      : []
  if (containers.length === 0) return null

  const hasGlobalMarker = containers.some((c) => isGlobalContainerMarker(c))

  // Select candidate data containers cleanly without mixing stale/incognito window containers
  const targetContainers: any[] = []
  if (hasGlobalMarker) {
    for (let cIdx = 0; cIdx < containers.length; cIdx++) {
      const c = containers[cIdx]
      if (!c || typeof c !== 'object' || Array.isArray(c) || isGlobalContainerMarker(c)) continue
      const prev = cIdx > 0 ? containers[cIdx - 1] : null
      if (isGlobalContainerMarker(prev)) {
        targetContainers.push(c)
      }
    }
  }

  if (targetContainers.length === 0) {
    const objectContainers = containers.filter(
      (c) =>
        c &&
        typeof c === 'object' &&
        !Array.isArray(c) &&
        (c.spaces || c.items)
    )
    if (objectContainers.length > 0) {
      // Pick the richest container (most spaces + items) first
      objectContainers.sort((a, b) => {
        const scoreA =
          parseSwiftCollectionToOrderedEntries(a.spaces).length * 1000 +
          parseSwiftCollectionToOrderedEntries(a.items).length
        const scoreB =
          parseSwiftCollectionToOrderedEntries(b.spaces).length * 1000 +
          parseSwiftCollectionToOrderedEntries(b.items).length
        return scoreB - scoreA
      })
      targetContainers.push(objectContainers[0])
    }
  }

  const parsedSpaces: ArcParsedSidebar['spaces'] = []
  const seenSpaceIds = new Set<string>()
  let primaryContainerRef: any = null

  for (const container of targetContainers) {
    if (!primaryContainerRef) primaryContainerRef = container
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

    // Combines explicit ordered `childrenIds` with any remaining `parentID` links so no item is ever dropped
    const getOrderedChildIds = (nodeId: string, nodeObj?: any): string[] => {
      const item = nodeObj || itemsMap.get(nodeId)
      const explicitRaw = item?.childrenIds || item?.childrenIDs
      const explicit: string[] = Array.isArray(explicitRaw)
        ? explicitRaw.filter((cid: unknown): cid is string => typeof cid === 'string' && Boolean(cid))
        : []
      const byParent = childrenByParent.get(nodeId) || []
      if (explicit.length === 0) return byParent
      if (byParent.length === 0) return explicit
      const explicitSet = new Set(explicit)
      const extras = byParent.filter((cid) => !explicitSet.has(cid))
      return extras.length > 0 ? [...explicit, ...extras] : explicit
    }

    const extractTabFromItem = (item: any, folderTitle: string | null): ImportedTabItem | null => {
      if (!item || typeof item !== 'object') return null
      const tabData = item.data?.tab
      if (tabData && typeof tabData === 'object') {
        const rawUrl =
          tabData.savedURL || tabData.url || tabData.activeURL || tabData.currentURL || item.url
        if (isImportableWebUrl(rawUrl)) {
          const cleanUrl = rawUrl.trim()
          const cleanTitle =
            String(
              item.title || tabData.savedTitle || tabData.title || tabData.activeTitle || ''
            ).trim() || cleanUrl
          return { url: cleanUrl, title: cleanTitle, folderTitle }
        }
        return null
      }

      // Support Arc Easel / Web Note items that carry a shareable web URL
      const easelUrl =
        item.data?.easel?.shareURL || item.data?.easel?.url || item.data?.webPage?.url
      if (isImportableWebUrl(easelUrl)) {
        const cleanUrl = easelUrl.trim()
        const cleanTitle = String(item.title || 'Arc Easel').trim() || cleanUrl
        return { url: cleanUrl, title: cleanTitle, folderTitle }
      }
      return null
    }

    const collectTabsFromNodeOrContainer = (
      nodeId: string,
      folderTitle: string | null,
      visited = new Set<string>(),
      isRootContainer = false
    ): ImportedTabItem[] => {
      if (!nodeId || visited.has(nodeId)) return []
      visited.add(nodeId)

      const item = itemsMap.get(nodeId)
      if (item && typeof item === 'object' && !isRootContainer) {
        const directTab = extractTabFromItem(item, folderTitle)
        if (directTab) {
          return [directTab]
        }
      }

      // Root container or virtual container ID not stored in itemsMap
      let nextFolderTitle = folderTitle
      if (item && typeof item === 'object' && !isRootContainer) {
        const isSplitOrSystemContainer = Boolean(
          item.data?.splitView || item.data?.itemContainer || item.data?.tab
        )
        const isUserFolder =
          !isSplitOrSystemContainer &&
          (Boolean(item.data?.list) ||
            Boolean(item.data?.liveFolder) ||
            Boolean(item.title && getOrderedChildIds(nodeId, item).length > 0))

        if (isUserFolder) {
          const rawFolder = String(
            item.title || item.data?.list?.title || item.data?.liveFolder?.title || ''
          ).trim()
          if (rawFolder) {
            nextFolderTitle =
              folderTitle && folderTitle !== rawFolder
                ? `${folderTitle} / ${rawFolder}`
                : rawFolder
          } else if (!folderTitle) {
            nextFolderTitle = 'Folder'
          }
        }
      }

      const childIds = getOrderedChildIds(nodeId, item)
      const results: ImportedTabItem[] = []
      for (const childId of childIds) {
        results.push(...collectTabsFromNodeOrContainer(childId, nextFolderTitle, visited, false))
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
        } else if (typeof elem === 'string' && elem.trim()) {
          const cid = elem.trim()
          if (itemsMap.has(cid) || childrenByParent.has(cid)) {
            const tabs = collectTabsFromNodeOrContainer(cid, null, new Set(), true)
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
          }
          pendingProfileDir = 'Default'
        }
      }
    }

    // Parse each Arc Space preserving exact sequence
    spaceEntries.forEach(([spaceId, spaceObj], idx) => {
      if (!spaceId || seenSpaceIds.has(spaceId)) return
      const profileDir = resolveArcProfileDirName(spaceObj?.profile)

      let pinnedContainerId: string | null = null
      let unpinnedContainerId: string | null = null
      const cids = spaceObj?.containerIDs

      if (Array.isArray(cids)) {
        for (let i = 0; i < cids.length; i++) {
          const marker = cids[i]
          const nextVal = cids[i + 1]
          const markerIsPinned =
            marker === 'pinned' || (marker && typeof marker === 'object' && 'pinned' in marker)
          const markerIsUnpinned =
            marker === 'unpinned' || (marker && typeof marker === 'object' && 'unpinned' in marker)

          if (markerIsPinned && typeof nextVal === 'string') {
            pinnedContainerId = nextVal
            i++
          } else if (markerIsUnpinned && typeof nextVal === 'string') {
            unpinnedContainerId = nextVal
            i++
          }
        }
        // Fallback if containerIDs had plain container UUIDs without string markers
        if (!pinnedContainerId) {
          for (let i = 0; i < cids.length; i++) {
            const candidate = cids[i]
            if (
              typeof candidate === 'string' &&
              candidate !== 'pinned' &&
              candidate !== 'unpinned' &&
              candidate !== unpinnedContainerId &&
              (itemsMap.has(candidate) || childrenByParent.has(candidate))
            ) {
              pinnedContainerId = candidate
              break
            }
          }
        }
      } else if (cids && typeof cids === 'object') {
        if (typeof cids.pinned === 'string') pinnedContainerId = cids.pinned
        if (typeof cids.unpinned === 'string') unpinnedContainerId = cids.unpinned
      }

      // Skip transient unnamed Little Arc / popup spaces that have no title and no containers
      const rawTitle = typeof spaceObj?.title === 'string' ? spaceObj.title.trim() : ''
      if (!rawTitle && !pinnedContainerId && !unpinnedContainerId) {
        return
      }

      const pinnedTabs = pinnedContainerId
        ? collectTabsFromNodeOrContainer(pinnedContainerId, null, new Set(), true)
        : []
      const openTabs = unpinnedContainerId
        ? collectTabsFromNodeOrContainer(unpinnedContainerId, null, new Set(), true)
        : []

      // Skip completely empty unnamed ghost spaces
      if (!rawTitle && pinnedTabs.length === 0 && openTabs.length === 0) {
        return
      }

      seenSpaceIds.add(spaceId)
      const name = rawTitle || `Space ${idx + 1}`
      const emoji = extractArcSpaceEmoji(spaceObj, parsedSpaces.length)
      const accentColor = extractArcSpaceAccentHex(spaceObj, parsedSpaces.length)
      const favorites = (favoritesByProfileDir.get(profileDir) || []).slice(0, 12)

      parsedSpaces.push({
        id: spaceId,
        name,
        emoji,
        accentColor,
        profileDir,
        favorites,
        pinnedTabs,
        openTabs
      })
    })
  }

  if (parsedSpaces.length === 0) return null

  // Reconcile against explicit Arc visual Space ordering array if present
  const explicitOrder = extractExplicitArcSpaceOrder(json, primaryContainerRef, sidebarFilePath)
  if (explicitOrder.length >= 2) {
    const orderRank = new Map<string, number>()
    explicitOrder.forEach((sid, rank) => {
      if (!orderRank.has(sid)) {
        orderRank.set(sid, rank)
      }
    })
    const originalIndex = new Map<string, number>(parsedSpaces.map((s, idx) => [s.id, idx]))
    parsedSpaces.sort((a, b) => {
      const ra = orderRank.get(a.id)
      const rb = orderRank.get(b.id)
      if (ra !== undefined && rb !== undefined) return ra - rb
      if (ra !== undefined) return -1
      if (rb !== undefined) return 1
      return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0)
    })
  }

  return { spaces: parsedSpaces }
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
  hasSessionData: boolean
  extensions: ScannedSourceExtension[]
}

function discoverChromiumProfiles(
  dataRoot: string,
  preferredLang?: AppLanguage
): DiscoveredChromiumProfile[] {
  if (!fs.existsSync(dataRoot)) return []

  // Handle case where user pointed directly at a single profile directory (e.g. .../Default)
  const directBookmarks = path.join(dataRoot, 'Bookmarks')
  const directHistory = path.join(dataRoot, 'History')
  const directPrefs = path.join(dataRoot, 'Preferences')
  if (
    fs.existsSync(directBookmarks) ||
    fs.existsSync(directHistory) ||
    fs.existsSync(directPrefs)
  ) {
    const dirName = path.basename(dataRoot)
    const prefs = safeReadJson<any>(directPrefs)
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
        preferencesPath: fs.existsSync(directPrefs) ? directPrefs : null,
        hasSessionData: hasChromiumSessionData(dataRoot),
        extensions: scanChromiumProfileExtensions(dataRoot, dirName, preferredLang)
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
    const hasSess = hasChromiumSessionData(dirPath)
    if (!hasBm && !hasHist && !hasPref && !hasSess) continue

    const cacheEntry = infoCache[dirName]
    const prefs = !cacheEntry?.name && hasPref ? safeReadJson<any>(prefPath) : null
    const rawName =
      cacheEntry?.gaia_name ||
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
      preferencesPath: hasPref ? prefPath : null,
      hasSessionData: hasSess,
      extensions: scanChromiumProfileExtensions(dirPath, dirName, preferredLang)
    })
  }

  return results
}

function dedupeExtensionPreviews(
  profiles: DiscoveredChromiumProfile[]
): DetectedExtensionPreview[] {
  const byId = new Map<string, DetectedExtensionPreview>()
  for (const cp of profiles) {
    for (const ext of cp.extensions) {
      const existing = byId.get(ext.id)
      if (!existing || (ext.enabled && !existing.enabled)) {
        byId.set(ext.id, {
          id: ext.id,
          name: ext.name,
          version: ext.version,
          description: ext.description,
          iconDataUrl: ext.iconDataUrl,
          profileDir: ext.profileDir,
          enabled: ext.enabled
        })
      }
    }
  }
  return [...byId.values()]
}

// ==================== Legacy Local Dia Electron Store Support ====================

function isLegacyDiaStoreDir(dirPath: string): boolean {
  return (
    fs.existsSync(path.join(dirPath, 'bookmarks.json')) ||
    fs.existsSync(path.join(dirPath, 'sessions.json'))
  )
}

// ==================== Public Detection API ====================

function normalizeArcProfileDisplayName(dirName: string, rawDisplayName?: string): string {
  if (dirName === 'Default') {
    const trimmed = (rawDisplayName || '').trim()
    if (
      !trimmed ||
      trimmed === 'Default' ||
      /^person \d+$/i.test(trimmed) ||
      /chromium|chrome/i.test(trimmed)
    ) {
      return 'Default'
    }
    return trimmed
  }
  return (rawDisplayName || '').trim() || dirName
}

function hasMeaningfulChromiumHistory(historyDbPath: string | null): boolean {
  if (!historyDbPath || !fs.existsSync(historyDbPath)) return false
  const rows = querySqliteSafely<{ cnt: number }>(
    historyDbPath,
    `SELECT COUNT(*) AS cnt FROM (
       SELECT 1 FROM urls
       WHERE hidden = 0 AND (url LIKE 'https://%' OR url LIKE 'http://%')
       LIMIT 3
     )`
  )
  return Number(rows[0]?.cnt || 0) > 0
}

const BROWSER_DISPLAY_NAMES: Record<ImportBrowserId, string> = {
  arc: 'Arc',
  dia: 'Dia',
  chrome: 'Google Chrome'
}

export function inspectBrowserAtPath(
  browserId: ImportBrowserId,
  targetPath: string | null,
  isCustomPath = false,
  preferredLang?: AppLanguage
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
    openTabsEstimate: 0,
    extensionsEstimate: 0,
    detectedExtensions: [],
    hasHistory: false,
    hasSessionData: false,
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
        const openTabsEstimate = arcSidebar.spaces.reduce((acc, s) => acc + s.openTabs.length, 0)
        return {
          id: browserId,
          name: BROWSER_DISPLAY_NAMES[browserId],
          detected: true,
          dataRootPath: targetPath,
          isCustomPath,
          spacesCount: arcSidebar.spaces.length,
          distinctProfilesCount: new Set(arcSidebar.spaces.map((s) => s.profileDir)).size,
          profiles: arcSidebar.spaces.map((s) => ({
            id: s.id,
            name: s.name,
            profileDir: s.profileDir,
            profileName: normalizeArcProfileDisplayName(s.profileDir),
            emoji: s.emoji,
            accentColor: s.accentColor,
            favoriteCount: s.favorites.length,
            pinnedCount: s.pinnedTabs.length,
            openTabCount: s.openTabs.length,
            bookmarkCount: s.pinnedTabs.length
          })),
          bookmarksEstimate: pinnedEstimate,
          pinnedEstimate,
          openTabsEstimate,
          extensionsEstimate: 0,
          detectedExtensions: [],
          hasHistory: false,
          hasSessionData: false,
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
          openTabsEstimate: 0,
          extensionsEstimate: 0,
          detectedExtensions: [],
          hasHistory: false,
          hasSessionData: false,
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
    const chromiumProfiles = discoverChromiumProfiles(
      path.join(targetPath, 'User Data'),
      preferredLang
    )

    if (arcSidebar && arcSidebar.spaces.length > 0) {
      const boundProfileDirs = new Set(arcSidebar.spaces.map((s) => s.profileDir))
      const boundChromiumProfiles = chromiumProfiles.filter((cp) =>
        boundProfileDirs.has(cp.dirName)
      )
      const hasHist = boundChromiumProfiles.some((p) => Boolean(p.historyPath))
      const hasSess = boundChromiumProfiles.some((p) => p.hasSessionData)
      const uniqueExtensions = dedupeExtensionPreviews(boundChromiumProfiles)

      let extraBookmarks = 0
      const cpBmCountByDir = new Map<string, number>()
      for (const cp of boundChromiumProfiles) {
        const cnt = cp.bookmarksPath
          ? parseChromiumBookmarksFile(cp.bookmarksPath).allBookmarks.length
          : 0
        cpBmCountByDir.set(cp.dirName, cnt)
        extraBookmarks += cnt
      }

      const pinnedTotal = arcSidebar.spaces.reduce(
        (sum, s) => sum + s.pinnedTabs.length + s.favorites.length,
        0
      )
      const openTabsTotal = arcSidebar.spaces.reduce((sum, s) => sum + s.openTabs.length, 0)

      return {
        id: browserId,
        name: BROWSER_DISPLAY_NAMES[browserId],
        detected: true,
        dataRootPath: targetPath,
        isCustomPath,
        spacesCount: arcSidebar.spaces.length,
        distinctProfilesCount: boundProfileDirs.size,
        profiles: arcSidebar.spaces.map((s) => {
          const matchingCp = chromiumProfiles.find((cp) => cp.dirName === s.profileDir)
          return {
            id: s.id,
            name: s.name,
            profileDir: s.profileDir,
            profileName: normalizeArcProfileDisplayName(s.profileDir, matchingCp?.displayName),
            emoji: s.emoji,
            accentColor: s.accentColor,
            favoriteCount: s.favorites.length,
            pinnedCount: s.pinnedTabs.length,
            openTabCount: s.openTabs.length,
            extensionCount: matchingCp?.extensions.length || 0,
            bookmarkCount: s.pinnedTabs.length + (cpBmCountByDir.get(s.profileDir) || 0),
            hasHistory: Boolean(matchingCp?.historyPath),
            hasSessionData: Boolean(matchingCp?.hasSessionData)
          }
        }),
        bookmarksEstimate: pinnedTotal + extraBookmarks,
        pinnedEstimate: pinnedTotal,
        openTabsEstimate: openTabsTotal,
        extensionsEstimate: uniqueExtensions.length,
        detectedExtensions: uniqueExtensions,
        hasHistory: hasHist,
        hasSessionData: hasSess,
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
    const allTabs: any[] = Array.isArray(sess?.tabs) ? sess.tabs : []
    const pinnedCount = allTabs.filter((t: any) => t?.isPinned || t?.isFavorite).length
    const openTabsCount = allTabs.filter(
      (t: any) => !t?.isPinned && !t?.isFavorite && isImportableWebUrl(t?.url)
    ).length

    return {
      id: 'dia',
      name: BROWSER_DISPLAY_NAMES.dia,
      detected: true,
      dataRootPath: targetPath,
      isCustomPath,
      spacesCount: rawProfiles.length || 1,
      distinctProfilesCount: rawProfiles.length || 1,
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
              openTabCount: allTabs.filter(
                (t: any) =>
                  t?.profileId === p.id &&
                  !t?.isPinned &&
                  !t?.isFavorite &&
                  isImportableWebUrl(t?.url)
              ).length,
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
                openTabCount: openTabsCount,
                hasHistory: hist.length > 0
              }
            ],
      bookmarksEstimate: bms.length,
      pinnedEstimate: pinnedCount,
      openTabsEstimate: openTabsCount,
      extensionsEstimate: 0,
      detectedExtensions: [],
      hasHistory: hist.length > 0,
      hasSessionData: false,
      supportsSpacesAndPinned: true
    }
  }

  // Standard Chromium User Data Layout (Dia Browser / Google Chrome / Arc fallback)
  const chromiumProfiles = discoverChromiumProfiles(targetPath, preferredLang)
  if (chromiumProfiles.length === 0) {
    return baseEmpty
  }

  let totalBookmarks = 0
  let totalPinned = 0
  let anyHistory = false
  let anySession = false
  const keptProfiles: DiscoveredChromiumProfile[] = []

  const profileInfos: DetectedBrowserProfileInfo[] = []
  chromiumProfiles.forEach((cp, idx) => {
    const bmParsed = cp.bookmarksPath
      ? parseChromiumBookmarksFile(cp.bookmarksPath)
      : { allBookmarks: [], barDirectLinks: [], barFolders: [] }
    const prefsPinned = cp.preferencesPath
      ? readChromiumPinnedTabsFromPrefs(cp.preferencesPath)
      : []
    const hasHist = hasMeaningfulChromiumHistory(cp.historyPath)

    // Skip unused non-Default Chromium Profiles that have 0 bookmarks, 0 pinned tabs, 0 extensions, and 0 web history
    if (
      chromiumProfiles.length > 1 &&
      cp.dirName !== 'Default' &&
      bmParsed.allBookmarks.length === 0 &&
      prefsPinned.length === 0 &&
      cp.extensions.length === 0 &&
      !hasHist
    ) {
      return
    }

    keptProfiles.push(cp)

    const pinnedEst =
      prefsPinned.length +
      Math.min(6, bmParsed.barDirectLinks.length) +
      bmParsed.barFolders.slice(0, 6).reduce((s, f) => s + Math.min(12, f.links.length), 0)

    totalBookmarks += bmParsed.allBookmarks.length
    totalPinned += pinnedEst
    if (hasHist) anyHistory = true
    if (cp.hasSessionData) anySession = true

    profileInfos.push({
      id: cp.dirName,
      name: cp.displayName,
      profileDir: cp.dirName,
      profileName: cp.displayName,
      emoji: SPACE_FALLBACK_EMOJIS[idx % SPACE_FALLBACK_EMOJIS.length],
      accentColor: PROFILE_ACCENT_PRESETS[idx % PROFILE_ACCENT_PRESETS.length].hex,
      bookmarkCount: bmParsed.allBookmarks.length,
      pinnedCount: pinnedEst,
      extensionCount: cp.extensions.length,
      hasHistory: hasHist,
      hasSessionData: cp.hasSessionData
    })
  })

  if (profileInfos.length === 0) {
    return baseEmpty
  }

  const uniqueExtensions = dedupeExtensionPreviews(keptProfiles)

  return {
    id: browserId,
    name: BROWSER_DISPLAY_NAMES[browserId],
    detected: true,
    dataRootPath: targetPath,
    isCustomPath,
    distinctProfilesCount: profileInfos.length,
    profiles: profileInfos,
    bookmarksEstimate: totalBookmarks,
    pinnedEstimate: totalPinned,
    openTabsEstimate: 0,
    extensionsEstimate: uniqueExtensions.length,
    detectedExtensions: uniqueExtensions,
    hasHistory: anyHistory,
    hasSessionData: anySession,
    supportsSpacesAndPinned: true
  }
}

export function detectAllBrowsers(preferredLang?: AppLanguage): DetectedBrowserSource[] {
  const order: ImportBrowserId[] = ['arc', 'dia', 'chrome']
  return order.map((browserId) => {
    const candidates = getCandidatePaths(browserId)
    for (const candidate of candidates) {
      const inspected = inspectBrowserAtPath(browserId, candidate, false, preferredLang)
      if (inspected.detected) {
        return inspected
      }
    }
    return inspectBrowserAtPath(browserId, null, false, preferredLang)
  })
}

// ==================== Full Browser Data Import Extraction ====================

export function parseBrowserDataForImport(
  request: BrowserImportRequest,
  preferredLang?: AppLanguage
): ParsedBrowserImportPayload {
  const { browserId, customPath, selectedProfileIds, scopes } = request
  const warnings: string[] = []
  const wantOpenTabs = scopes.openTabs !== false

  let rootPath: string | null = customPath?.trim() || null
  if (!rootPath) {
    for (const candidate of getCandidatePaths(browserId)) {
      const check = inspectBrowserAtPath(browserId, candidate, false, preferredLang)
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
      profileResources: [],
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
        profileResources: [],
        spaces: [
          {
            sourceId: 'html-export',
            name: BROWSER_DISPLAY_NAMES[browserId],
            emoji: '📑',
            accentColor: PROFILE_ACCENT_PRESETS[0].hex,
            favorites: scopes.spacesAndPinned ? htmlParsed.barDirectLinks.slice(0, 4) : [],
            pinnedTabs: [],
            openTabs: [],
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
          profileResources: [],
          warnings,
          error: 'Unrecognized JSON file format (expected Arc StorableSidebar.json).'
        }
      }
      const spaces: ImportedSpacePayload[] = arcSidebar.spaces
        .filter((s) => !selectedSet || selectedSet.has(s.id))
        .map((s) => ({
          sourceId: s.id,
          name: s.name,
          profileDir: s.profileDir,
          profileName: normalizeArcProfileDisplayName(s.profileDir),
          emoji: s.emoji,
          accentColor: s.accentColor,
          favorites: scopes.spacesAndPinned ? s.favorites : [],
          pinnedTabs: scopes.spacesAndPinned ? s.pinnedTabs : [],
          openTabs: wantOpenTabs ? s.openTabs : [],
          bookmarks: scopes.bookmarks
            ? s.pinnedTabs.map((t) => ({ url: t.url, title: t.title, createdAt: Date.now() }))
            : [],
          history: []
        }))
      return { ok: true, browserId, spaces, profileResources: [], warnings }
    }
  }

  // Case 2: Arc Directory (with StorableSidebar.json + User Data)
  const sidebarJsonPath = path.join(rootPath, 'StorableSidebar.json')
  if (fs.existsSync(sidebarJsonPath)) {
    const arcSidebar = parseArcStorableSidebar(sidebarJsonPath)
    const chromiumProfiles = discoverChromiumProfiles(
      path.join(rootPath, 'User Data'),
      preferredLang
    )
    const chromiumByDir = new Map(chromiumProfiles.map((cp) => [cp.dirName, cp]))

    if (arcSidebar && arcSidebar.spaces.length > 0) {
      // Filtering `arcSidebar.spaces` in place preserves Arc's exact sidebar Space order
      const filteredSpaces = arcSidebar.spaces.filter(
        (s) => !selectedSet || selectedSet.has(s.id)
      )

      const faviconsCacheByDir = new Map<string, Map<string, string>>()
      const parsedBookmarksByDir = new Map<string, ParsedChromiumBookmarks>()
      const parsedHistoryByDir = new Map<
        string,
        Array<{ url: string; title: string; visitedAt: number; visitCount: number }>
      >()

      const activeProfileDirs = new Set(filteredSpaces.map((s) => s.profileDir))
      const urlsByProfileDir = new Map<string, Set<string>>()

      for (const s of filteredSpaces) {
        const set = urlsByProfileDir.get(s.profileDir) || new Set<string>()
        for (const f of s.favorites) set.add(f.url)
        for (const p of s.pinnedTabs) set.add(p.url)
        for (const o of s.openTabs) set.add(o.url)
        urlsByProfileDir.set(s.profileDir, set)
      }

      for (const pDir of activeProfileDirs) {
        const cp = chromiumByDir.get(pDir)
        if (!cp) continue
        const urlSet = urlsByProfileDir.get(pDir) || new Set<string>()
        if (scopes.bookmarks && cp.bookmarksPath) {
          const parsedBm = parseChromiumBookmarksFile(cp.bookmarksPath)
          parsedBookmarksByDir.set(pDir, parsedBm)
          for (const b of parsedBm.allBookmarks.slice(0, 200)) urlSet.add(b.url)
        }
        if (scopes.history && cp.historyPath) {
          const hist = readChromiumHistory(cp.historyPath, 1500)
          parsedHistoryByDir.set(pDir, hist)
          for (const h of hist.slice(0, 120)) urlSet.add(h.url)
        }
        if (cp.faviconsPath && urlSet.size > 0) {
          faviconsCacheByDir.set(pDir, readChromiumFaviconsForUrls(cp.faviconsPath, urlSet))
        }
      }

      const consumedHistoryDirs = new Set<string>()
      const profileResources: ImportedProfileResource[] = []
      for (const pDir of activeProfileDirs) {
        const cp = chromiumByDir.get(pDir)
        if (!cp) continue
        profileResources.push({
          profileDir: cp.dirName,
          profileDirPath: cp.dirPath,
          displayName: normalizeArcProfileDisplayName(cp.dirName, cp.displayName),
          hasSessionData: cp.hasSessionData,
          extensions: cp.extensions
        })
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

        const openTabs: ImportedTabItem[] = wantOpenTabs
          ? s.openTabs.map((o) => ({
              url: o.url,
              title: o.title,
              folderTitle: o.folderTitle,
              favicon: iconMap.get(o.url)
            }))
          : []

        // Combine Space's own Pinned/Favorite items + underlying Arc Profile's Chromium Bookmarks
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
          const cpBm = parsedBookmarksByDir.get(s.profileDir)
          if (cpBm) {
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

        // Attach Chromium History once per underlying Profile (sibling Spaces sharing a partition automatically share History in Arko)
        let history: ImportedSpacePayload['history'] = []
        if (scopes.history && !consumedHistoryDirs.has(s.profileDir)) {
          consumedHistoryDirs.add(s.profileDir)
          const rawHist = parsedHistoryByDir.get(s.profileDir) || []
          history = rawHist.map((h) => ({
            ...h,
            favicon: iconMap.get(h.url)
          }))
        }

        return {
          sourceId: s.id,
          name: s.name,
          profileDir: s.profileDir,
          profileName: normalizeArcProfileDisplayName(s.profileDir, cp?.displayName),
          emoji: s.emoji,
          accentColor: s.accentColor,
          favorites,
          pinnedTabs,
          openTabs,
          bookmarks,
          history
        }
      })

      return { ok: true, browserId, spaces, profileResources, warnings }
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
          openTabs: wantOpenTabs
            ? pTabs
                .filter((t: any) => !t.isPinned && !t.isFavorite)
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

    return { ok: true, browserId, spaces, profileResources: [], warnings }
  }

  // Case 4: Standard Chromium User Data Directory (Google Chrome & Dia Browser)
  const chromiumProfiles = discoverChromiumProfiles(rootPath, preferredLang).filter(
    (cp) => !selectedSet || selectedSet.has(cp.dirName)
  )
  if (chromiumProfiles.length === 0) {
    return {
      ok: false,
      browserId,
      spaces: [],
      profileResources: [],
      warnings,
      error: `No valid browser profiles found in ${rootPath}.`
    }
  }

  const profileResources: ImportedProfileResource[] = chromiumProfiles.map((cp) => ({
    profileDir: cp.dirName,
    profileDirPath: cp.dirPath,
    displayName: cp.displayName,
    hasSessionData: cp.hasSessionData,
    extensions: cp.extensions
  }))

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
      const seenFav = new Set<string>()
      const seenPinnedKey = new Set<string>()

      for (const pt of prefsPinned) {
        const key = `::${pt.url}`
        if (!seenPinnedKey.has(key)) {
          seenPinnedKey.add(key)
          pinnedTabs.push({ url: pt.url, title: pt.title, folderTitle: null })
        }
      }
      for (const link of bmParsed.barDirectLinks.slice(0, 6)) {
        if (!seenFav.has(link.url)) {
          seenFav.add(link.url)
          favorites.push({ url: link.url, title: link.title })
        }
      }
      for (const link of bmParsed.barDirectLinks.slice(6, 18)) {
        const key = `::${link.url}`
        if (!seenPinnedKey.has(key)) {
          seenPinnedKey.add(key)
          pinnedTabs.push({ url: link.url, title: link.title, folderTitle: null })
        }
      }
      for (const folder of bmParsed.barFolders.slice(0, 8)) {
        for (const link of folder.links.slice(0, 16)) {
          const key = `${folder.folderTitle}::${link.url}`
          if (!seenPinnedKey.has(key)) {
            seenPinnedKey.add(key)
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
      scopes.history && cp.historyPath ? readChromiumHistory(cp.historyPath, 1500) : []

    const iconCandidateUrls = new Set<string>()
    for (const f of favorites) iconCandidateUrls.add(f.url)
    for (const p of pinnedTabs) iconCandidateUrls.add(p.url)
    for (const b of bmParsed.allBookmarks.slice(0, 200)) iconCandidateUrls.add(b.url)

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
      ? bmParsed.allBookmarks.slice(0, 4500).map((b) => ({
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
      profileDir: cp.dirName,
      profileName: cp.displayName,
      emoji: SPACE_FALLBACK_EMOJIS[idx % SPACE_FALLBACK_EMOJIS.length],
      accentColor: PROFILE_ACCENT_PRESETS[idx % PROFILE_ACCENT_PRESETS.length].hex,
      favorites,
      pinnedTabs,
      openTabs: [],
      bookmarks,
      history
    }
  })

  return { ok: true, browserId, spaces, profileResources, warnings }
}
