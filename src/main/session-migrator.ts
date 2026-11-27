import { execFileSync } from 'child_process'
import crypto from 'crypto'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { ImportBrowserId } from '@shared/types'

// Chromium WebKit epoch offset: seconds between 1601-01-01 and 1970-01-01
const WEBKIT_EPOCH_DIFF_SEC = 11644473600

// Cap copied LevelDB / IndexedDB storage per profile so migration finishes in <350ms
const MAX_SINGLE_STORAGE_FILE_BYTES = 48 * 1024 * 1024
const MAX_PROFILE_STORAGE_TOTAL_BYTES = 180 * 1024 * 1024

export interface CookieKeyDerivationResult {
  attempted: boolean
  key: Buffer | null
  warning?: string
}

export function resolveChromiumCookiesDbPath(profileDirPath: string): string | null {
  const networkCookies = path.join(profileDirPath, 'Network', 'Cookies')
  const rootCookies = path.join(profileDirPath, 'Cookies')
  const hasNet = fs.existsSync(networkCookies)
  const hasRoot = fs.existsSync(rootCookies)

  if (hasNet && hasRoot) {
    try {
      const netStat = fs.statSync(networkCookies)
      const rootStat = fs.statSync(rootCookies)
      return netStat.mtimeMs >= rootStat.mtimeMs ? networkCookies : rootCookies
    } catch {
      return networkCookies
    }
  }
  if (hasNet) return networkCookies
  if (hasRoot) return rootCookies
  return null
}

export function hasChromiumSessionData(profileDirPath: string): boolean {
  if (!profileDirPath || !fs.existsSync(profileDirPath)) return false
  const cookiesPath = resolveChromiumCookiesDbPath(profileDirPath)
  if (cookiesPath) {
    try {
      if (fs.statSync(cookiesPath).size > 4096) return true
    } catch {
      // ignore
    }
  }
  const lsDir = path.join(profileDirPath, 'Local Storage', 'leveldb')
  if (fs.existsSync(lsDir)) return true
  const idbDir = path.join(profileDirPath, 'IndexedDB')
  if (fs.existsSync(idbDir)) return true
  return false
}

export function getPartitionDiskPath(partition: string): string {
  const cleanName = partition.replace(/^persist:/i, '').trim()
  return path.join(app.getPath('userData'), 'Partitions', cleanName)
}

function copyDirectorySafelyExcludingLocks(
  srcDir: string,
  destDir: string,
  budget: { remainingBytes: number }
): number {
  if (!fs.existsSync(srcDir) || budget.remainingBytes <= 0) return 0
  let filesCopied = 0
  try {
    fs.mkdirSync(destDir, { recursive: true })
    const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    for (const entry of entries) {
      if (budget.remainingBytes <= 0) break
      const name = entry.name
      // Never copy LevelDB LOCK or transient temp files from a live browser
      if (name === 'LOCK' || name.endsWith('.tmp') || name.startsWith('.org.chromium')) {
        continue
      }
      const srcFull = path.join(srcDir, name)
      const dstFull = path.join(destDir, name)

      if (entry.isDirectory()) {
        filesCopied += copyDirectorySafelyExcludingLocks(srcFull, dstFull, budget)
      } else if (entry.isFile()) {
        try {
          const st = fs.statSync(srcFull)
          if (st.size > MAX_SINGLE_STORAGE_FILE_BYTES || st.size > budget.remainingBytes) {
            continue
          }
          fs.copyFileSync(srcFull, dstFull)
          budget.remainingBytes -= st.size
          filesCopied++
        } catch {
          // Ignore transient race if source browser compacts an .ldb file mid-copy
        }
      }
    }
  } catch {
    // ignore inaccessible directory
  }
  return filesCopied
}

/**
 * Copies unencrypted Chromium origin storage (Local Storage, Session Storage, IndexedDB,
 * and Extension Storage settings) into the target Electron partition directory on disk.
 * Call BEFORE `session.fromPartition(partition)` initializes LevelDB handles when possible.
 */
export function copyChromiumSiteStorageToPartition(
  profileDirPath: string,
  partition: string,
  includeExtensionSettings = true
): { filesCopied: number; migratedStorageTypes: string[] } {
  if (!profileDirPath || !fs.existsSync(profileDirPath)) {
    return { filesCopied: 0, migratedStorageTypes: [] }
  }

  const destPartitionRoot = getPartitionDiskPath(partition)
  const budget = { remainingBytes: MAX_PROFILE_STORAGE_TOTAL_BYTES }
  let totalFiles = 0
  const migratedStorageTypes: string[] = []

  const targets: Array<{ label: string; relPath: string }> = [
    { label: 'Local Storage', relPath: path.join('Local Storage', 'leveldb') },
    { label: 'IndexedDB', relPath: 'IndexedDB' },
    { label: 'Session Storage', relPath: 'Session Storage' }
  ]

  if (includeExtensionSettings) {
    targets.push(
      { label: 'Local Extension Settings', relPath: 'Local Extension Settings' },
      { label: 'Sync Extension Settings', relPath: 'Sync Extension Settings' },
      { label: 'Managed Extension Settings', relPath: 'Managed Extension Settings' }
    )
  }

  for (const target of targets) {
    const src = path.join(profileDirPath, target.relPath)
    if (!fs.existsSync(src)) continue
    const dst = path.join(destPartitionRoot, target.relPath)
    const copied = copyDirectorySafelyExcludingLocks(src, dst, budget)
    if (copied > 0) {
      totalFiles += copied
      migratedStorageTypes.push(target.label)
    }
  }

  return { filesCopied: totalFiles, migratedStorageTypes }
}

function chromiumSafeStorageCandidates(
  browserId: ImportBrowserId
): Array<{ service: string; account?: string }> {
  const named = (service: string, account: string) => [
    { service: `${service} Safe Storage`, account },
    { service: `${service} Safe Storage` }
  ]
  switch (browserId) {
    case 'arc':
      return named('Arc', 'Arc')
    case 'dia':
      return [...named('Dia', 'Dia'), { service: 'Chromium Safe Storage' }]
    case 'chrome':
      return [...named('Chrome', 'Chrome'), { service: 'Chromium Safe Storage' }]
    case 'edge':
      return named('Microsoft Edge', 'Microsoft Edge')
    case 'brave':
      return named('Brave', 'Brave')
    case 'opera':
      return named('Opera', 'Opera')
    case 'vivaldi':
      return named('Vivaldi', 'Vivaldi')
    case 'chromium':
      return named('Chromium', 'Chromium')
    case 'firefox':
    case 'safari':
      return []
  }
}

/**
 * Derives Chromium's OS Safe Storage AES key via documented OS keychain APIs.
 * On macOS, `/usr/bin/security` triggers the standard system Keychain prompt so the user
 * explicitly approves reading Safe Storage once during migration.
 */
export function deriveChromiumCookieDecryptionKey(
  browserId: ImportBrowserId
): CookieKeyDerivationResult {
  const candidates = chromiumSafeStorageCandidates(browserId)
  if (candidates.length === 0) {
    return { attempted: false, key: null }
  }

  if (process.platform === 'darwin') {
    for (const cand of candidates) {
      try {
        const args = ['find-generic-password', '-w', '-s', cand.service]
        if (cand.account) {
          args.push('-a', cand.account)
        }
        const rawOut = execFileSync('/usr/bin/security', args, {
          encoding: 'utf-8',
          timeout: 45000,
          stdio: ['ignore', 'pipe', 'ignore']
        })
        const secret = rawOut.replace(/\r?\n$/, '')
        if (secret) {
          const key = crypto.pbkdf2Sync(secret, 'saltysalt', 1003, 16, 'sha1')
          return { attempted: true, key }
        }
      } catch {
        // Try next service/account candidate
      }
    }

    return {
      attempted: true,
      key: null,
      warning:
        'macOS Keychain access to Safe Storage was declined or unavailable; encrypted cookies were skipped (Local Storage & IndexedDB were still migrated).'
    }
  }

  if (process.platform === 'linux') {
    // Standard Chromium OSCrypt v10 fallback key on Linux
    const key = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1')
    return { attempted: true, key }
  }

  return {
    attempted: true,
    key: null,
    warning:
      'Encrypted cookie migration requires OS Safe Storage access; unencrypted cookies, Local Storage, and IndexedDB were migrated.'
  }
}

function decryptChromiumCookieValue(
  hexEnc: string,
  hostKey: string,
  metaVersion: number,
  aesKey: Buffer | null
): string | null {
  if (!hexEnc) return null
  let buf: Buffer
  try {
    buf = Buffer.from(hexEnc, 'hex')
  } catch {
    return null
  }
  if (buf.length === 0) return null

  // Chromium macOS / Linux v10 AES-128-CBC format: 'v10' (3 bytes) + ciphertext
  const prefix = buf.subarray(0, 3).toString('ascii')
  if (prefix === 'v10' || prefix === 'v11') {
    if (!aesKey) return null
    const cipherPayload = buf.subarray(3)
    if (cipherPayload.length === 0 || cipherPayload.length % 16 !== 0) return null
    try {
      const iv = Buffer.alloc(16, 0x20) // 16 ASCII space characters
      const decipher = crypto.createDecipheriv('aes-128-cbc', aesKey, iv)
      let plain = Buffer.concat([decipher.update(cipherPayload), decipher.final()])

      // Chromium 130+ (Cookies DB meta.version >= 24) prepends SHA-256(host_key) (32 bytes)
      if (plain.length >= 32) {
        const expectedHostHash = crypto.createHash('sha256').update(hostKey, 'utf8').digest()
        if (plain.subarray(0, 32).equals(expectedHostHash)) {
          plain = plain.subarray(32)
        } else if (metaVersion >= 24) {
          plain = plain.subarray(32)
        }
      }

      const decoded = plain.toString('utf8')
      // Reject malformed control bytes that Chromium SetCookie forbids
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(decoded)) {
        return null
      }
      return decoded
    } catch {
      return null
    }
  }

  return null
}

function mapChromiumSameSite(
  rawSameSite: number,
  isSecure: boolean
): {
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
  forceSecure: boolean
} {
  if (rawSameSite === 0) {
    return { sameSite: 'no_restriction', forceSecure: true }
  }
  if (rawSameSite === 1) {
    return { sameSite: 'lax', forceSecure: isSecure }
  }
  if (rawSameSite === 2) {
    return { sameSite: 'strict', forceSecure: isSecure }
  }
  return { sameSite: 'unspecified', forceSecure: isSecure }
}

export async function migrateChromiumCookiesToSession(params: {
  profileDirPath: string
  browserId: ImportBrowserId
  targetSession: Electron.Session
  querySqlite: <T = Record<string, any>>(dbPath: string, sql: string) => T[]
  cachedKeyResult?: CookieKeyDerivationResult
}): Promise<{
  cookiesImported: number
  keyResult: CookieKeyDerivationResult
  warnings: string[]
}> {
  const { profileDirPath, browserId, targetSession, querySqlite } = params
  const warnings: string[] = []
  let keyResult: CookieKeyDerivationResult = params.cachedKeyResult || {
    attempted: false,
    key: null
  }

  const cookiesDbPath = resolveChromiumCookiesDbPath(profileDirPath)
  if (!cookiesDbPath) {
    return { cookiesImported: 0, keyResult, warnings }
  }

  const metaRows = querySqlite<{ value: string | number }>(
    cookiesDbPath,
    `SELECT value FROM meta WHERE key = 'version' LIMIT 1`
  )
  const metaVersion = Number(metaRows[0]?.value || 0)

  const rows = querySqlite<{
    host_key: string
    name: string
    value: string
    hex_enc: string
    path: string
    expires_utc: number
    is_secure: number
    is_httponly: number
    has_expires: number
    is_persistent: number
    samesite: number
  }>(
    cookiesDbPath,
    `SELECT
       host_key,
       name,
       value,
       HEX(encrypted_value) AS hex_enc,
       path,
       expires_utc,
       is_secure,
       is_httponly,
       has_expires,
       is_persistent,
       samesite
     FROM cookies
     ORDER BY last_access_utc DESC
     LIMIT 6000`
  )

  if (rows.length === 0) {
    return { cookiesImported: 0, keyResult, warnings }
  }

  const needsDecryption = rows.some((r) => !r.value && Boolean(r.hex_enc))
  if (needsDecryption && !keyResult.attempted) {
    keyResult = deriveChromiumCookieDecryptionKey(browserId)
    if (keyResult.warning) {
      warnings.push(keyResult.warning)
    }
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const validCookies: Electron.CookiesSetDetails[] = []

  for (const row of rows) {
    const hostKey = String(row.host_key || '').trim()
    const name = String(row.name || '').trim()
    if (!hostKey || !name) continue

    let cookieVal: string | null = row.value ? String(row.value) : null
    if (!cookieVal && row.hex_enc) {
      cookieVal = decryptChromiumCookieValue(row.hex_enc, hostKey, metaVersion, keyResult.key)
    }
    if (cookieVal === null) continue

    const isPersistent = Number(row.has_expires) !== 0 && Number(row.is_persistent) !== 0
    let expirationDate: number | undefined
    if (isPersistent && Number(row.expires_utc) > 0) {
      const expSec = Math.floor(Number(row.expires_utc) / 1_000_000) - WEBKIT_EPOCH_DIFF_SEC
      if (expSec <= nowSec + 5) {
        // Skip already-expired cookie
        continue
      }
      // Cap extreme far-future dates (> 400 days) to satisfy Chromium RFC 6265bis max-age limit
      expirationDate = Math.min(expSec, nowSec + 400 * 86400)
    }

    const isHostPrefixed = name.startsWith('__Host-')
    const isSecurePrefixed = name.startsWith('__Secure-')
    const rawSecure = Boolean(row.is_secure) || isHostPrefixed || isSecurePrefixed
    const { sameSite, forceSecure } = mapChromiumSameSite(Number(row.samesite), rawSecure)
    const secure = forceSecure || rawSecure

    const cleanHost = hostKey.replace(/^\.+/, '')
    if (!cleanHost) continue

    const cookiePath = isHostPrefixed ? '/' : String(row.path || '/').trim() || '/'
    const url = `${secure ? 'https' : 'http'}://${cleanHost}${
      cookiePath.startsWith('/') ? cookiePath : `/${cookiePath}`
    }`

    const details: Electron.CookiesSetDetails = {
      url,
      name,
      value: cookieVal,
      path: cookiePath,
      secure,
      httpOnly: Boolean(row.is_httponly),
      sameSite
    }

    // Domain attribute must be omitted for __Host- cookies and host-only cookies (no leading dot)
    if (!isHostPrefixed && hostKey.startsWith('.')) {
      details.domain = hostKey
    }

    if (expirationDate !== undefined) {
      details.expirationDate = expirationDate
    }

    validCookies.push(details)
  }

  let cookiesImported = 0
  const BATCH_SIZE = 75
  for (let i = 0; i < validCookies.length; i += BATCH_SIZE) {
    const batch = validCookies.slice(i, i + BATCH_SIZE)
    const settled = await Promise.allSettled(batch.map((c) => targetSession.cookies.set(c)))
    for (const res of settled) {
      if (res.status === 'fulfilled') {
        cookiesImported++
      }
    }
  }

  if (cookiesImported > 0) {
    try {
      await targetSession.cookies.flushStore()
    } catch {
      // ignore
    }
  }

  return { cookiesImported, keyResult, warnings }
}
