import { execFileSync } from 'child_process'
import fs from 'fs'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
import { PROFILE_ACCENT_PRESETS } from '@shared/constants'
import { IMPORT_BROWSER_IDS, importBrowserTitle } from '@shared/import-browsers'
import type {
  AppLanguage,
  BrowserImportRequest,
  DetectedBrowserProfileInfo,
  DetectedBrowserSource,
  DetectedExtensionPreview,
  ImportBrowserId,
  ImportDataScopes
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
  folderPath?: string[] | null
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
 * Extracts cached PNG/WebP/ICO/SVG favicons as data URLs from Chromium's local Favicons SQLite DB
 * using indexed page_url lookups + host prefix range scans so large profiles never miss icons.
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
    if (targetUrls.size >= 2400) break
  }
  if (targetUrls.size === 0) return result

  const hexToDataUrl = (hexStr: string): string => {
    const upper = hexStr.slice(0, 24).toUpperCase()
    const isPng = upper.startsWith('89504E47')
    const isWebp = upper.startsWith('52494646')
    const isGif = upper.startsWith('47494638')
    const isJpeg = upper.startsWith('FFD8FF')
    const isSvg = upper.startsWith('3C737667') || upper.startsWith('3C3F786D')
    const mime = isPng
      ? 'image/png'
      : isWebp
        ? 'image/webp'
        : isGif
          ? 'image/gif'
          : isJpeg
            ? 'image/jpeg'
            : isSvg
              ? 'image/svg+xml'
              : 'image/x-icon'
    return `data:${mime};base64,${Buffer.from(hexStr, 'hex').toString('base64')}`
  }

  const hostFallbackIcon = new Map<string, string>()
  const ingestRows = (rows: Array<{ page_url: string; hex_png: string; width: number }>): void => {
    for (const row of rows) {
      if (!row?.page_url || !row?.hex_png) continue
      const host = getHostSafely(row.page_url)
      if (!targetUrls.has(row.page_url) && (!host || !targetHosts.has(host))) {
        continue
      }
      const dataUrl = hexToDataUrl(row.hex_png)
      if (targetUrls.has(row.page_url) && !result.has(row.page_url)) {
        result.set(row.page_url, dataUrl)
      }
      if (host && targetHosts.has(host) && !hostFallbackIcon.has(host)) {
        hostFallbackIcon.set(host, dataUrl)
      }
    }
  }

  // Pass 1: Exact indexed page_url lookup in batches so 100k+ row Favicons DBs never truncate matches
  const allUrls = [...targetUrls]
  const urlChunkSize = 180
  for (let i = 0; i < allUrls.length; i += urlChunkSize) {
    const chunk = allUrls
      .slice(i, i + urlChunkSize)
      .filter((u) => !/[\0\r\n]/.test(u))
      .map((u) => `'${u.replace(/'/g, "''")}'`)
    if (chunk.length === 0) continue
    const exactRows = querySqliteSafely<{ page_url: string; hex_png: string; width: number }>(
      faviconsDbPath,
      `SELECT m.page_url AS page_url, HEX(b.image_data) AS hex_png, b.width AS width
       FROM icon_mapping m
       JOIN favicon_bitmaps b ON m.icon_id = b.icon_id
       WHERE m.page_url IN (${chunk.join(',')})
         AND OCTET_LENGTH(b.image_data) > 0 AND OCTET_LENGTH(b.image_data) <= 131072
       ORDER BY b.width DESC`
    )
    ingestRows(exactRows)
  }

  // Pass 2: Indexed host-prefix range scan for URLs whose exact sub-path wasn't cached
  const missingHosts = [...targetHosts.keys()].filter(
    (h) => !hostFallbackIcon.has(h) && /^[a-z0-9.-]+$/i.test(h)
  )
  const hostChunkSize = 35
  for (let i = 0; i < missingHosts.length; i += hostChunkSize) {
    const hostChunk = missingHosts.slice(i, i + hostChunkSize)
    const rangeClauses: string[] = []
    for (const h of hostChunk) {
      const safe = h.replace(/'/g, "''")
      rangeClauses.push(
        `(m.page_url >= 'https://${safe}/' AND m.page_url < 'https://${safe}0')`,
        `(m.page_url >= 'http://${safe}/' AND m.page_url < 'http://${safe}0')`
      )
    }
    const hostRows = querySqliteSafely<{ page_url: string; hex_png: string; width: number }>(
      faviconsDbPath,
      `SELECT m.page_url AS page_url, HEX(b.image_data) AS hex_png, b.width AS width
       FROM icon_mapping m
       JOIN favicon_bitmaps b ON m.icon_id = b.icon_id
       WHERE (${rangeClauses.join(' OR ')})
         AND OCTET_LENGTH(b.image_data) > 0 AND OCTET_LENGTH(b.image_data) <= 131072
       ORDER BY b.width DESC
       LIMIT 800`
    )
    ingestRows(hostRows)
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
  barFolders: Array<{
    folderTitle: string
    links: Array<{ url: string; title: string; folderPath: string[] }>
  }>
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
  const barFolders: Array<{
    folderTitle: string
    links: Array<{ url: string; title: string; folderPath: string[] }>
  }> = []

  if (barNode && Array.isArray(barNode.children)) {
    for (const child of barNode.children) {
      if (child?.type === 'url' && isImportableWebUrl(child.url)) {
        barDirectLinks.push({
          url: child.url.trim(),
          title: String(child.name || '').trim() || child.url.trim()
        })
      } else if (child?.type === 'folder' && Array.isArray(child.children)) {
        const folderTitle = String(child.name || '').trim() || 'Bookmarks'
        const folderLinks: Array<{ url: string; title: string; folderPath: string[] }> = []
        const walkChildren = (children: any[], pathSegments: string[]): void => {
          for (const n of children) {
            if (!n || typeof n !== 'object') continue
            if (n.type === 'url' && isImportableWebUrl(n.url)) {
              folderLinks.push({
                url: n.url.trim(),
                title: String(n.name || '').trim() || n.url.trim(),
                folderPath: pathSegments
              })
            } else if (Array.isArray(n.children)) {
              const subName = String(n.name || '').trim()
              const nextPath = subName ? [...pathSegments, subName] : pathSegments
              walkChildren(n.children, nextPath)
            }
          }
        }
        walkChildren(child.children, [folderTitle])
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
    const decodeEntities = (raw: string): string =>
      raw
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim()

    const allBookmarks: Array<{ url: string; title: string; createdAt: number }> = []
    const barDirectLinks: Array<{ url: string; title: string }> = []
    const folderLinksByRoot = new Map<
      string,
      Array<{ url: string; title: string; folderPath: string[] }>
    >()
    const seen = new Set<string>()

    const tokenRe =
      /<H3\b([^>]*)>([\s\S]*?)<\/H3>|<DL\b[^>]*>|<\/DL>|<A\b([^>]*)>([\s\S]*?)<\/A>/gi
    const folderStack: Array<{ name: string; isToolbarRoot: boolean }> = []
    let pendingFolder: { name: string; isToolbarRoot: boolean } | null = null
    let match: RegExpExecArray | null

    while ((match = tokenRe.exec(html)) !== null) {
      const full = match[0]
      if (/^<H3\b/i.test(full)) {
        const h3Attrs = match[1] || ''
        const name = decodeEntities(match[2] || '') || 'Bookmarks'
        const isToolbarRoot = /\bPERSONAL_TOOLBAR_FOLDER=["']?true["']?/i.test(h3Attrs)
        pendingFolder = { name, isToolbarRoot }
      } else if (/^<DL\b/i.test(full)) {
        if (pendingFolder) {
          folderStack.push(pendingFolder)
          pendingFolder = null
        } else {
          folderStack.push({ name: '', isToolbarRoot: false })
        }
      } else if (/^<\/DL>/i.test(full)) {
        pendingFolder = null
        if (folderStack.length > 0) folderStack.pop()
      } else if (/^<A\b/i.test(full)) {
        pendingFolder = null
        const attrs = match[3] || ''
        const rawTitle = decodeEntities(match[4] || '')
        const hrefMatch = /\bHREF=["']([^"']+)["']/i.exec(attrs)
        const dateMatch = /\bADD_DATE=["']?(\d+)["']?/i.exec(attrs)
        const url = hrefMatch?.[1]?.trim()
        if (!isImportableWebUrl(url)) continue
        const title = rawTitle || url

        if (!seen.has(url)) {
          seen.add(url)
          allBookmarks.push({
            url,
            title,
            createdAt: dateMatch ? webkitMicrosToUnixMs(Number(dateMatch[1])) : Date.now()
          })
        }

        const effectivePath = folderStack
          .filter((f) => !f.isToolbarRoot && Boolean(f.name))
          .map((f) => f.name)
        if (effectivePath.length === 0) {
          barDirectLinks.push({ url, title })
        } else {
          const rootTitle = effectivePath[0]
          const list = folderLinksByRoot.get(rootTitle) || []
          list.push({ url, title, folderPath: effectivePath })
          folderLinksByRoot.set(rootTitle, list)
        }
      }
    }

    const barFolders = [...folderLinksByRoot.entries()].map(([folderTitle, links]) => ({
      folderTitle,
      links
    }))

    return {
      allBookmarks,
      barDirectLinks:
        barDirectLinks.length > 0
          ? barDirectLinks
          : barFolders.length === 0
            ? allBookmarks.slice(0, 6).map((b) => ({ url: b.url, title: b.title }))
            : [],
      barFolders
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

  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')

  if (browserId === 'chrome') {
    if (platform === 'darwin') {
      return [
        path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
        path.join(home, 'Library', 'Application Support', 'Google', 'Chrome Canary')
      ]
    }
    if (platform === 'win32') {
      return [
        path.join(localAppData, 'Google', 'Chrome', 'User Data'),
        path.join(localAppData, 'Google', 'Chrome SxS', 'User Data')
      ]
    }
    return [path.join(home, '.config', 'google-chrome'), path.join(home, '.config', 'google-chrome-unstable')]
  }

  if (browserId === 'edge') {
    if (platform === 'darwin') {
      return [
        path.join(home, 'Library', 'Application Support', 'Microsoft Edge'),
        path.join(home, 'Library', 'Application Support', 'Microsoft Edge Beta'),
        path.join(home, 'Library', 'Application Support', 'Microsoft Edge Dev')
      ]
    }
    if (platform === 'win32') {
      return [
        path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
        path.join(localAppData, 'Microsoft', 'Edge Beta', 'User Data'),
        path.join(localAppData, 'Microsoft', 'Edge Dev', 'User Data')
      ]
    }
    return [
      path.join(home, '.config', 'microsoft-edge'),
      path.join(home, '.config', 'microsoft-edge-beta'),
      path.join(home, '.config', 'microsoft-edge-dev')
    ]
  }

  if (browserId === 'brave') {
    if (platform === 'darwin') {
      return [path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')]
    }
    if (platform === 'win32') {
      return [path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data')]
    }
    return [path.join(home, '.config', 'BraveSoftware', 'Brave-Browser')]
  }

  if (browserId === 'opera') {
    if (platform === 'darwin') {
      return [
        path.join(home, 'Library', 'Application Support', 'com.operasoftware.Opera'),
        path.join(home, 'Library', 'Application Support', 'com.operasoftware.OperaGX')
      ]
    }
    if (platform === 'win32') {
      return [
        path.join(roaming, 'Opera Software', 'Opera Stable'),
        path.join(roaming, 'Opera Software', 'Opera GX Stable')
      ]
    }
    return [path.join(home, '.config', 'opera'), path.join(home, '.config', 'opera-gx')]
  }

  if (browserId === 'vivaldi') {
    if (platform === 'darwin') {
      return [path.join(home, 'Library', 'Application Support', 'Vivaldi')]
    }
    if (platform === 'win32') {
      return [path.join(localAppData, 'Vivaldi', 'User Data')]
    }
    return [path.join(home, '.config', 'vivaldi')]
  }

  if (browserId === 'chromium') {
    if (platform === 'darwin') {
      return [path.join(home, 'Library', 'Application Support', 'Chromium')]
    }
    if (platform === 'win32') {
      return [path.join(localAppData, 'Chromium', 'User Data')]
    }
    return [path.join(home, '.config', 'chromium')]
  }

  if (browserId === 'firefox') {
    if (platform === 'darwin') {
      return [
        path.join(home, 'Library', 'Application Support', 'Firefox'),
        path.join(home, 'Library', 'Application Support', 'Firefox Developer Edition'),
        path.join(home, 'Library', 'Application Support', 'Firefox Nightly')
      ]
    }
    if (platform === 'win32') {
      return [
        path.join(roaming, 'Mozilla', 'Firefox'),
        path.join(roaming, 'Mozilla', 'Firefox Developer Edition'),
        path.join(roaming, 'Mozilla', 'Firefox Nightly')
      ]
    }
    return [path.join(home, '.mozilla', 'firefox')]
  }

  if (browserId === 'safari') {
    if (platform !== 'darwin') return []
    return [
      path.join(home, 'Library', 'Safari'),
      path.join(home, 'Library', 'Containers', 'com.apple.Safari', 'Data', 'Library', 'Safari')
    ]
  }

  return []
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

    const extractTabFromItem = (
      item: any,
      folderPath: string[]
    ): ImportedTabItem | null => {
      if (!item || typeof item !== 'object') return null
      const normalizedPath = folderPath.length > 0 ? folderPath : null
      const folderTitle = normalizedPath ? normalizedPath.join(' / ') : null
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
          return {
            url: cleanUrl,
            title: cleanTitle,
            folderTitle,
            folderPath: normalizedPath
          }
        }
        return null
      }

      // Support Arc Easel / Web Note items that carry a shareable web URL
      const easelUrl =
        item.data?.easel?.shareURL || item.data?.easel?.url || item.data?.webPage?.url
      if (isImportableWebUrl(easelUrl)) {
        const cleanUrl = easelUrl.trim()
        const cleanTitle = String(item.title || 'Arc Easel').trim() || cleanUrl
        return {
          url: cleanUrl,
          title: cleanTitle,
          folderTitle,
          folderPath: normalizedPath
        }
      }
      return null
    }

    const collectTabsFromNodeOrContainer = (
      nodeId: string,
      folderPath: string[],
      visited = new Set<string>(),
      isRootContainer = false
    ): ImportedTabItem[] => {
      if (!nodeId || visited.has(nodeId)) return []
      visited.add(nodeId)

      const item = itemsMap.get(nodeId)
      if (item && typeof item === 'object' && !isRootContainer) {
        const directTab = extractTabFromItem(item, folderPath)
        if (directTab) {
          return [directTab]
        }
      }

      // Root container or virtual container ID not stored in itemsMap
      let nextFolderPath = folderPath
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
            nextFolderPath = [...folderPath, rawFolder]
          } else if (folderPath.length === 0) {
            nextFolderPath = ['Folder']
          }
        }
      }

      const childIds = getOrderedChildIds(nodeId, item)
      const results: ImportedTabItem[] = []
      for (const childId of childIds) {
        results.push(
          ...collectTabsFromNodeOrContainer(childId, nextFolderPath, visited, false)
        )
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
            const tabs = collectTabsFromNodeOrContainer(cid, [], new Set(), true)
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
        ? collectTabsFromNodeOrContainer(pinnedContainerId, [], new Set(), true)
        : []
      const openTabs = unpinnedContainerId
        ? collectTabsFromNodeOrContainer(unpinnedContainerId, [], new Set(), true)
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
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  safari: 'Safari',
  firefox: 'Firefox',
  brave: 'Brave',
  opera: 'Opera',
  vivaldi: 'Vivaldi',
  chromium: 'Chromium'
}

function browserLabel(browserId: ImportBrowserId, dataRoot?: string | null): string {
  return importBrowserTitle(browserId, 'en', dataRoot).replace(/ Browser$/, '')
}

function emptyDetectedSource(
  browserId: ImportBrowserId,
  isCustomPath: boolean
): DetectedBrowserSource {
  return {
    id: browserId,
    name: browserLabel(browserId),
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
}

function firefoxPrTimeToUnixMs(raw: unknown): number {
  const num = Number(raw)
  if (!Number.isFinite(num) || num <= 0) return Date.now()
  const ms = Math.round(num / 1000)
  if (ms < MIN_VALID_UNIX_MS || ms > Date.now() + 86_400_000) return Date.now()
  return ms
}

function safariVisitToUnixMs(raw: unknown): number {
  const num = Number(raw)
  if (!Number.isFinite(num) || num <= 0) return Date.now()
  if (num < 2_000_000_000) return Math.round((num + 978307200) * 1000)
  return webkitMicrosToUnixMs(num)
}

interface LocatedFirefoxProfile {
  id: string
  name: string
  dirPath: string
  isDefault: boolean
}

function parseFirefoxProfilesIni(iniPath: string): LocatedFirefoxProfile[] {
  let text = ''
  try {
    text = fs.readFileSync(iniPath, 'utf-8')
  } catch {
    return []
  }
  const root = path.dirname(iniPath)
  const installDefaults = new Set<string>()
  const profiles: LocatedFirefoxProfile[] = []
  let section: string | null = null
  let current: { name?: string; relPath?: string; absolute?: boolean; isDefault?: boolean } | null =
    null

  const flush = (): void => {
    if (!current?.relPath) return
    const dirPath = current.absolute ? current.relPath : path.join(root, current.relPath)
    profiles.push({
      id: path.basename(dirPath),
      name: current.name || path.basename(dirPath),
      dirPath,
      isDefault: Boolean(current.isDefault) || installDefaults.has(current.relPath.replace(/\\/g, '/'))
    })
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const header = line.match(/^\[(.+)\]$/)
    if (header) {
      flush()
      section = header[1]
      current = section.startsWith('Profile') ? {} : null
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim()
    if (section?.startsWith('Install') && key === 'Default') {
      installDefaults.add(val.replace(/\\/g, '/'))
    }
    if (!current) continue
    if (key === 'Name') current.name = val
    else if (key === 'Path') current.relPath = val
    else if (key === 'IsRelative') current.absolute = val === '0'
    else if (key === 'Default') current.isDefault = val === '1'
  }
  flush()

  const seen = new Set<string>()
  return profiles.filter((profile) => {
    if (seen.has(profile.dirPath)) return false
    seen.add(profile.dirPath)
    return fs.existsSync(path.join(profile.dirPath, 'places.sqlite'))
  })
}

function locateFirefoxProfiles(targetPath: string): LocatedFirefoxProfile[] {
  if (!fs.existsSync(targetPath)) return []
  const stat = fs.statSync(targetPath)
  if (stat.isFile()) {
    const base = path.basename(targetPath).toLowerCase()
    if (base === 'profiles.ini') return parseFirefoxProfilesIni(targetPath)
    if (base === 'places.sqlite') {
      const dirPath = path.dirname(targetPath)
      return [{ id: path.basename(dirPath), name: 'Firefox', dirPath, isDefault: true }]
    }
    return []
  }

  const iniPath = path.join(targetPath, 'profiles.ini')
  if (fs.existsSync(iniPath)) {
    const parsed = parseFirefoxProfilesIni(iniPath)
    if (parsed.length > 0) {
      return parsed.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
    }
  }

  if (fs.existsSync(path.join(targetPath, 'places.sqlite'))) {
    return [{ id: path.basename(targetPath), name: 'Firefox', dirPath: targetPath, isDefault: true }]
  }

  const found: LocatedFirefoxProfile[] = []
  try {
    for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dirPath = path.join(targetPath, entry.name)
      if (!fs.existsSync(path.join(dirPath, 'places.sqlite'))) continue
      found.push({ id: entry.name, name: entry.name, dirPath, isDefault: false })
    }
  } catch {
    // ignore unreadable profile roots
  }
  return found
}

interface FirefoxLibrary {
  bookmarks: Array<{
    url: string
    title: string
    createdAt: number
    onToolbar: boolean
    folderPath: string[] | null
  }>
  history: Array<{ url: string; title: string; visitedAt: number; visitCount: number }>
}

function readFirefoxLibrary(placesPath: string): FirefoxLibrary {
  const empty: FirefoxLibrary = { bookmarks: [], history: [] }
  if (!fs.existsSync(placesPath)) return empty

  const bookmarkRows = querySqliteSafely<{
    id: number
    parent: number
    type: number
    guid: string
    url: string | null
    title: string | null
    dateAdded: number
  }>(
    placesPath,
    `SELECT b.id AS id,
            b.parent AS parent,
            b.type AS type,
            b.guid AS guid,
            p.url AS url,
            COALESCE(NULLIF(b.title, ''), NULLIF(p.title, ''), p.url) AS title,
            b.dateAdded AS dateAdded
     FROM moz_bookmarks b
     LEFT JOIN moz_places p ON p.id = b.fk
     WHERE b.type IN (1, 2)
     LIMIT 8000`
  )

  const folderById = new Map<number, { id: number; parent: number; guid: string; title: string }>()
  const toolbarRootIds = new Set<number>()
  const toolbarIds = new Set<number>()
  for (const row of bookmarkRows) {
    if (row.type === 2) {
      folderById.set(row.id, {
        id: row.id,
        parent: row.parent,
        guid: row.guid,
        title: String(row.title || '').trim()
      })
    }
    if (row.guid === 'toolbar_____') {
      toolbarRootIds.add(row.id)
      toolbarIds.add(row.id)
    }
  }
  let grew = true
  while (grew) {
    grew = false
    for (const row of bookmarkRows) {
      if (row.type === 2 && toolbarIds.has(row.parent) && !toolbarIds.has(row.id)) {
        toolbarIds.add(row.id)
        grew = true
      }
    }
  }

  const resolveToolbarFolderPath = (parentId: number): string[] | null => {
    if (!toolbarIds.has(parentId) || toolbarRootIds.has(parentId)) return null
    const segments: string[] = []
    const visited = new Set<number>()
    let cur = parentId
    while (cur && !toolbarRootIds.has(cur) && !visited.has(cur)) {
      visited.add(cur)
      const folder = folderById.get(cur)
      if (!folder) break
      if (folder.title) segments.unshift(folder.title)
      cur = folder.parent
    }
    return segments.length > 0 ? segments : null
  }

  const bookmarks = bookmarkRows
    .filter((row) => row.type === 1 && isImportableWebUrl(row.url))
    .slice(0, 4500)
    .map((row) => {
      const onToolbar = toolbarIds.has(row.parent)
      return {
        url: String(row.url),
        title: String(row.title || row.url),
        createdAt: firefoxPrTimeToUnixMs(row.dateAdded),
        onToolbar,
        folderPath: onToolbar ? resolveToolbarFolderPath(row.parent) : null
      }
    })

  const historyRows = querySqliteSafely<{
    url: string
    title: string
    visitedAt: number
    visitCount: number
  }>(
    placesPath,
    `SELECT url AS url,
            COALESCE(NULLIF(title, ''), url) AS title,
            last_visit_date AS visitedAt,
            COALESCE(visit_count, 1) AS visitCount
     FROM moz_places
     WHERE last_visit_date IS NOT NULL
       AND url IS NOT NULL
       AND (url LIKE 'https://%' OR url LIKE 'http://%')
     ORDER BY last_visit_date DESC
     LIMIT 1500`
  )

  return {
    bookmarks,
    history: historyRows
      .filter((row) => isImportableWebUrl(row.url))
      .map((row) => ({
        url: row.url,
        title: String(row.title || row.url),
        visitedAt: firefoxPrTimeToUnixMs(row.visitedAt),
        visitCount: Math.max(1, Number(row.visitCount) || 1)
      }))
  }
}

function inspectFirefoxSource(
  targetPath: string | null,
  isCustomPath: boolean
): DetectedBrowserSource {
  const base = emptyDetectedSource('firefox', isCustomPath)
  if (!targetPath || !fs.existsSync(targetPath)) return base
  const profiles = locateFirefoxProfiles(targetPath)
  if (profiles.length === 0) return base

  let bookmarksEstimate = 0
  let pinnedEstimate = 0
  let hasHistory = false
  const infos: DetectedBrowserProfileInfo[] = profiles.map((profile, idx) => {
    const library = readFirefoxLibrary(path.join(profile.dirPath, 'places.sqlite'))
    const toolbarCount = library.bookmarks.filter((item) => item.onToolbar).length
    bookmarksEstimate += library.bookmarks.length
    pinnedEstimate += toolbarCount
    if (library.history.length > 0) hasHistory = true
    return {
      id: profile.id,
      name: profile.name,
      profileDir: profile.id,
      profileName: profile.name,
      emoji: SPACE_FALLBACK_EMOJIS[idx % SPACE_FALLBACK_EMOJIS.length],
      accentColor: PROFILE_ACCENT_PRESETS[idx % PROFILE_ACCENT_PRESETS.length].hex,
      bookmarkCount: library.bookmarks.length,
      pinnedCount: toolbarCount,
      favoriteCount: Math.min(8, toolbarCount),
      hasHistory: library.history.length > 0,
      hasSessionData: false
    }
  })

  return {
    ...base,
    name: browserLabel('firefox', targetPath),
    detected: true,
    dataRootPath: targetPath,
    distinctProfilesCount: infos.length,
    profiles: infos,
    bookmarksEstimate,
    pinnedEstimate,
    hasHistory,
    supportsSpacesAndPinned: true
  }
}

interface SafariBookmarkItem {
  url: string
  title: string
  onBar: boolean
  folderPath: string[] | null
  folderTitle: string | null
}

function collectSafariBookmarks(plistPath: string): SafariBookmarkItem[] {
  if (!fs.existsSync(plistPath) || process.platform !== 'darwin') return []
  let data: any
  try {
    const stdout = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath], {
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 8000
    })
    data = JSON.parse(stdout)
  } catch {
    return []
  }

  const out: SafariBookmarkItem[] = []
  const walk = (node: any, onBar: boolean, folderPath: string[]): void => {
    if (!node || typeof node !== 'object' || out.length >= 4500) return
    const title = String(node.Title || node.title || '').trim()
    if (/reading\s*list/i.test(title)) return
    const children = node.Children || node.children
    const type = String(node.WebBookmarkType || '')
    const url = String(node.URLString || '')
    if (type === 'WebBookmarkTypeLeaf' || (isImportableWebUrl(url) && !Array.isArray(children))) {
      if (!isImportableWebUrl(url)) return
      const leafTitle = String(
        node.URIDictionary?.title || node.URIDictionary?.Title || title || url
      )
      const normalizedPath = onBar && folderPath.length > 0 ? folderPath : null
      out.push({
        url,
        title: leafTitle,
        onBar,
        folderPath: normalizedPath,
        folderTitle: normalizedPath ? normalizedPath.join(' / ') : null
      })
      return
    }
    if (!Array.isArray(children)) return
    const isBarRoot = title === 'BookmarksBar' || title === 'Bookmarks Bar'
    const nextBar = onBar || isBarRoot
    const nextFolderPath =
      nextBar && title && !isBarRoot && title !== 'Root' ? [...folderPath, title] : folderPath
    for (const child of children) walk(child, nextBar, nextFolderPath)
  }
  walk(data, false, [])
  return out
}

function readSafariHistory(historyPath: string): FirefoxLibrary['history'] {
  if (!fs.existsSync(historyPath)) return []
  const joined = querySqliteSafely<{
    url: string
    title: string
    visitTime: number
    visitCount: number
  }>(
    historyPath,
    `SELECT hi.url AS url,
            COALESCE(NULLIF(hv.title, ''), hi.url) AS title,
            MAX(hv.visit_time) AS visitTime,
            hi.visit_count AS visitCount
     FROM history_items hi
     LEFT JOIN history_visits hv ON hv.history_item = hi.id
     WHERE hi.url LIKE 'http%'
     GROUP BY hi.id
     ORDER BY visitTime DESC
     LIMIT 1500`
  )
  const rows =
    joined.length > 0
      ? joined
      : querySqliteSafely<{
          url: string
          title: string
          visitTime: number
          visitCount: number
        }>(
          historyPath,
          `SELECT url AS url,
                  url AS title,
                  0 AS visitTime,
                  visit_count AS visitCount
           FROM history_items
           WHERE url LIKE 'http%'
           ORDER BY visit_count DESC
           LIMIT 1500`
        )

  return rows
    .filter((row) => isImportableWebUrl(row.url))
    .map((row) => ({
      url: row.url,
      title: String(row.title || row.url),
      visitedAt: safariVisitToUnixMs(row.visitTime),
      visitCount: Math.max(1, Number(row.visitCount) || 1)
    }))
}

interface LocatedSafariProfile {
  id: string
  name: string
  dirPath: string
}

function safariDirHasData(dirPath: string): boolean {
  return (
    fs.existsSync(path.join(dirPath, 'Bookmarks.plist')) ||
    fs.existsSync(path.join(dirPath, 'History.db'))
  )
}

function locateSafariProfiles(targetPath: string): LocatedSafariProfile[] {
  if (process.platform !== 'darwin' || !fs.existsSync(targetPath)) return []
  const stat = fs.statSync(targetPath)
  if (stat.isFile()) {
    const base = path.basename(targetPath).toLowerCase()
    if (base === 'bookmarks.plist' || base === 'history.db') {
      return [{ id: 'safari', name: 'Safari', dirPath: path.dirname(targetPath) }]
    }
    return []
  }

  const found: LocatedSafariProfile[] = []
  if (safariDirHasData(targetPath)) {
    found.push({ id: 'safari-default', name: 'Safari', dirPath: targetPath })
  }
  const profilesDir = path.join(targetPath, 'Profiles')
  if (fs.existsSync(profilesDir)) {
    try {
      for (const entry of fs.readdirSync(profilesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const dirPath = path.join(profilesDir, entry.name)
        if (!safariDirHasData(dirPath)) continue
        found.push({
          id: entry.name,
          name: found.length === 0 ? 'Safari' : `Safari ${found.length + 1}`,
          dirPath
        })
      }
    } catch {
      // ignore
    }
  }
  return found
}

function inspectSafariSource(
  targetPath: string | null,
  isCustomPath: boolean
): DetectedBrowserSource {
  const base = emptyDetectedSource('safari', isCustomPath)
  if (!targetPath) return base
  const profiles = locateSafariProfiles(targetPath)
  if (profiles.length === 0) return base

  let bookmarksEstimate = 0
  let pinnedEstimate = 0
  let hasHistory = false
  const infos: DetectedBrowserProfileInfo[] = profiles.map((profile, idx) => {
    const bookmarks = collectSafariBookmarks(path.join(profile.dirPath, 'Bookmarks.plist'))
    const history = readSafariHistory(path.join(profile.dirPath, 'History.db'))
    const barCount = bookmarks.filter((item) => item.onBar).length
    bookmarksEstimate += bookmarks.length
    pinnedEstimate += barCount
    if (history.length > 0) hasHistory = true
    return {
      id: profile.id,
      name: profile.name,
      profileDir: profile.id,
      profileName: profile.name,
      emoji: '🧭',
      accentColor: PROFILE_ACCENT_PRESETS[idx % PROFILE_ACCENT_PRESETS.length].hex,
      bookmarkCount: bookmarks.length,
      pinnedCount: barCount,
      favoriteCount: Math.min(8, barCount),
      hasHistory: history.length > 0,
      hasSessionData: false
    }
  })

  return {
    ...base,
    name: 'Safari',
    detected: true,
    dataRootPath: targetPath,
    distinctProfilesCount: infos.length,
    profiles: infos,
    bookmarksEstimate,
    pinnedEstimate,
    hasHistory,
    supportsSpacesAndPinned: true
  }
}

function libraryRowsToPayload(
  browserId: ImportBrowserId,
  profiles: Array<{
    id: string
    name: string
    favorites: Array<{ url: string; title: string }>
    pinnedTabs: ImportedTabItem[]
    bookmarks: Array<{ url: string; title: string; createdAt: number }>
    history: FirefoxLibrary['history']
  }>,
  scopes: ImportDataScopes,
  warnings: string[]
): ParsedBrowserImportPayload {
  if (profiles.length === 0) {
    return {
      ok: false,
      browserId,
      spaces: [],
      profileResources: [],
      warnings,
      error: `No valid browser profiles found for ${BROWSER_DISPLAY_NAMES[browserId]}.`
    }
  }
  const spaces: ImportedSpacePayload[] = profiles.map((profile, idx) => ({
    sourceId: profile.id,
    name: profiles.length === 1 ? BROWSER_DISPLAY_NAMES[browserId] : profile.name,
    profileName: profile.name,
    emoji: browserId === 'safari' ? '🧭' : SPACE_FALLBACK_EMOJIS[idx % SPACE_FALLBACK_EMOJIS.length],
    accentColor: PROFILE_ACCENT_PRESETS[idx % PROFILE_ACCENT_PRESETS.length].hex,
    favorites: scopes.spacesAndPinned ? profile.favorites : [],
    pinnedTabs: scopes.spacesAndPinned ? profile.pinnedTabs : [],
    openTabs: [],
    bookmarks: scopes.bookmarks ? profile.bookmarks : [],
    history: scopes.history ? profile.history : []
  }))
  return { ok: true, browserId, spaces, profileResources: [], warnings }
}

function favoritesFromBar(
  items: Array<{
    url: string
    title: string
    folderPath?: string[] | null
    folderTitle?: string | null
  }>
): { favorites: Array<{ url: string; title: string }>; pinnedTabs: ImportedTabItem[] } {
  const favorites: Array<{ url: string; title: string }> = []
  const pinnedTabs: ImportedTabItem[] = []
  const seenFav = new Set<string>()
  const seenPinned = new Set<string>()
  for (const item of items) {
    const normalizedPath =
      item.folderPath && item.folderPath.length > 0 ? item.folderPath : null
    const joinedTitle = normalizedPath ? normalizedPath.join(' / ') : item.folderTitle || null
    if (!joinedTitle && favorites.length < 8 && !seenFav.has(item.url)) {
      seenFav.add(item.url)
      favorites.push({ url: item.url, title: item.title })
      continue
    }
    const key = `${joinedTitle || ''}::${item.url}`
    if (seenPinned.has(key) || pinnedTabs.length >= 400) continue
    seenPinned.add(key)
    pinnedTabs.push({
      url: item.url,
      title: item.title,
      folderPath: normalizedPath,
      folderTitle: joinedTitle
    })
  }
  return { favorites, pinnedTabs }
}

function buildFirefoxImport(
  rootPath: string,
  selectedSet: Set<string> | null,
  scopes: ImportDataScopes,
  warnings: string[]
): ParsedBrowserImportPayload {
  const profiles = locateFirefoxProfiles(rootPath).filter(
    (profile) => !selectedSet || selectedSet.has(profile.id)
  )
  return libraryRowsToPayload(
    'firefox',
    profiles.map((profile) => {
      const library = readFirefoxLibrary(path.join(profile.dirPath, 'places.sqlite'))
      const bar = library.bookmarks
        .filter((item) => item.onToolbar)
        .map((item) => ({
          url: item.url,
          title: item.title,
          folderPath: item.folderPath,
          folderTitle: item.folderPath ? item.folderPath.join(' / ') : null
        }))
      const { favorites, pinnedTabs } = favoritesFromBar(bar)
      return {
        id: profile.id,
        name: profile.name,
        favorites,
        pinnedTabs,
        bookmarks: library.bookmarks.map((item) => ({
          url: item.url,
          title: item.title,
          createdAt: item.createdAt
        })),
        history: library.history
      }
    }),
    scopes,
    warnings
  )
}

function buildSafariImport(
  rootPath: string,
  selectedSet: Set<string> | null,
  scopes: ImportDataScopes,
  warnings: string[]
): ParsedBrowserImportPayload {
  const profiles = locateSafariProfiles(rootPath).filter(
    (profile) => !selectedSet || selectedSet.has(profile.id)
  )
  return libraryRowsToPayload(
    'safari',
    profiles.map((profile) => {
      const bookmarks = collectSafariBookmarks(path.join(profile.dirPath, 'Bookmarks.plist'))
      const bar = bookmarks
        .filter((item) => item.onBar)
        .map((item) => ({
          url: item.url,
          title: item.title,
          folderPath: item.folderPath,
          folderTitle: item.folderTitle
        }))
      const { favorites, pinnedTabs } = favoritesFromBar(bar)
      return {
        id: profile.id,
        name: profile.name,
        favorites,
        pinnedTabs,
        bookmarks: bookmarks.map((item) => ({
          url: item.url,
          title: item.title,
          createdAt: Date.now()
        })),
        history: readSafariHistory(path.join(profile.dirPath, 'History.db'))
      }
    }),
    scopes,
    warnings
  )
}

export function inspectBrowserAtPath(
  browserId: ImportBrowserId,
  targetPath: string | null,
  isCustomPath = false,
  preferredLang?: AppLanguage
): DetectedBrowserSource {
  const baseName = targetPath ? path.basename(targetPath).toLowerCase() : ''
  const isHtmlBookmarkFile = baseName.endsWith('.html') || baseName.endsWith('.htm')
  if (!isHtmlBookmarkFile && browserId === 'firefox') {
    return inspectFirefoxSource(targetPath, isCustomPath)
  }
  if (!isHtmlBookmarkFile && browserId === 'safari') {
    return inspectSafariSource(targetPath, isCustomPath)
  }

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
        const htmlFolderPinned = parsedHtml.barFolders
          .slice(0, 24)
          .reduce((s, f) => s + Math.min(120, f.links.length), 0)
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
              bookmarkCount: parsedHtml.allBookmarks.length,
              pinnedCount: Math.min(6, parsedHtml.barDirectLinks.length) + htmlFolderPinned
            }
          ],
          bookmarksEstimate: parsedHtml.allBookmarks.length,
          pinnedEstimate: Math.min(6, parsedHtml.barDirectLinks.length) + htmlFolderPinned,
          openTabsEstimate: 0,
          extensionsEstimate: 0,
          detectedExtensions: [],
          hasHistory: false,
          hasSessionData: false,
          supportsSpacesAndPinned: parsedHtml.barFolders.length > 0
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
      bmParsed.barFolders.slice(0, 24).reduce((s, f) => s + Math.min(120, f.links.length), 0)

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
  const order: ImportBrowserId[] = IMPORT_BROWSER_IDS
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

  const importBaseName = path.basename(rootPath).toLowerCase()
  const isHtmlBookmarkExport =
    fs.statSync(rootPath).isFile() &&
    (importBaseName.endsWith('.html') || importBaseName.endsWith('.htm'))
  if (!isHtmlBookmarkExport && browserId === 'firefox') {
    return buildFirefoxImport(rootPath, selectedSet, scopes, warnings)
  }
  if (!isHtmlBookmarkExport && browserId === 'safari') {
    return buildSafariImport(rootPath, selectedSet, scopes, warnings)
  }

  const stat = fs.statSync(rootPath)

  // Case 1: Single file selected manually (.json sidebar or .html bookmarks)
  if (stat.isFile()) {
    const lower = path.basename(rootPath).toLowerCase()
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      const htmlParsed = parseNetscapeBookmarksHtml(rootPath)
      const htmlPinnedTabs: ImportedTabItem[] = []
      if (scopes.spacesAndPinned) {
        for (const folder of htmlParsed.barFolders.slice(0, 24)) {
          for (const link of folder.links.slice(0, 120)) {
            htmlPinnedTabs.push({
              url: link.url,
              title: link.title,
              folderPath: link.folderPath,
              folderTitle: link.folderPath.join(' / ')
            })
          }
        }
      }
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
            favorites: scopes.spacesAndPinned ? htmlParsed.barDirectLinks.slice(0, 6) : [],
            pinnedTabs: htmlPinnedTabs,
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
              folderPath: p.folderPath,
              favicon: iconMap.get(p.url)
            }))
          : []

        const openTabs: ImportedTabItem[] = wantOpenTabs
          ? s.openTabs.map((o) => ({
              url: o.url,
              title: o.title,
              folderTitle: o.folderTitle,
              folderPath: o.folderPath,
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
    const groupById = new Map<string, any>(
      sessGroups.map((g: any) => [String(g.id), g])
    )
    const resolveLegacyGroupPath = (gid?: string | null): string[] | null => {
      if (!gid) return null
      const segments: string[] = []
      const visited = new Set<string>()
      let curId: string | null = String(gid)
      while (curId && !visited.has(curId)) {
        visited.add(curId)
        const grp = groupById.get(curId)
        if (!grp) break
        const rawTitle = String(grp.title || 'Group').trim()
        if (!grp.parentId && rawTitle.includes(' / ')) {
          const parts = rawTitle
            .split(' / ')
            .map((s) => s.trim())
            .filter(Boolean)
          segments.unshift(...parts)
        } else if (rawTitle) {
          segments.unshift(rawTitle)
        }
        curId = grp.parentId ? String(grp.parentId) : null
      }
      return segments.length > 0 ? segments : null
    }

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
                .map((t: any) => {
                  const folderPath = resolveLegacyGroupPath(t.groupId)
                  return {
                    url: t.url,
                    title: t.title || t.url,
                    favicon: t.favicon,
                    folderPath,
                    folderTitle: folderPath ? folderPath.join(' / ') : null
                  }
                })
            : [],
          openTabs: wantOpenTabs
            ? pTabs
                .filter((t: any) => !t.isPinned && !t.isFavorite)
                .map((t: any) => {
                  const folderPath = resolveLegacyGroupPath(t.groupId)
                  return {
                    url: t.url,
                    title: t.title || t.url,
                    favicon: t.favicon,
                    folderPath,
                    folderTitle: folderPath ? folderPath.join(' / ') : null
                  }
                })
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
      for (const folder of bmParsed.barFolders.slice(0, 24)) {
        for (const link of folder.links.slice(0, 120)) {
          const joinedFolder = link.folderPath.join(' / ')
          const key = `${joinedFolder}::${link.url}`
          if (!seenPinnedKey.has(key)) {
            seenPinnedKey.add(key)
            pinnedTabs.push({
              url: link.url,
              title: link.title,
              folderPath: link.folderPath,
              folderTitle: joinedFolder
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
