import { execFileSync } from 'child_process'
import { app, BrowserWindow, dialog, net } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { tr } from '@shared/i18n'
import type {
  AppLanguage,
  DetectedExtensionPreview,
  ImportBrowserId,
  InstalledExtensionItem
} from '@shared/types'
import type { PersistenceStore } from './store'

// Built-in Chromium / Google / Arc internal component extension IDs to exclude from user list
const INTERNAL_EXTENSION_IDS = new Set<string>([
  'nmmhkkegccagdldgiimedpiccmgmieda', // Chrome Web Store Payments
  'mhjfbmdgcfjbbpaeojofohoefgiehjai', // Chromium PDF Viewer
  'pkedcjkdefgpdelpbcmbmeomcjbeemfm', // Chrome Media Router / Cast
  'kmendfapggjehodndflmmgagdbamhnfd', // CryptoTokenExtension
  'gfdkimpbcpahaombhbimeihdjnejgicl', // Feedback
  'nkeimhogjdpnpccoofpliimaahmaaome', // Google Hangouts
  'neajdppkdcdipfabeoofebfddakdcjhd', // Google Network Speech
  'ahfgeienlihckogmohjhadlkjgocpleb', // Web Store App
  'ghbmnnjooekpmoecnnnilnnbdlolhkhi', // Google Docs Offline (default bundled)
  'apdfllckaahabafndbhieahigkjlhalf'
])

export interface ScannedSourceExtension extends DetectedExtensionPreview {
  manifestVersion: number
  sourceDirPath: string
  popupPath: string | null
  optionsPath: string | null
  homepageUrl: string | null
}

function safeReadJsonFile<T = any>(p: string): T | null {
  try {
    if (!fs.existsSync(p)) return null
    const st = fs.statSync(p)
    if (!st.isFile() || st.size > 25 * 1024 * 1024) return null
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T
  } catch {
    return null
  }
}

function compareSemverDirs(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[._-]/).map((n) => Number(n) || 0)
  const pb = b.replace(/^v/i, '').split(/[._-]/).map((n) => Number(n) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return a.localeCompare(b)
}

function loadExtensionLocaleMessages(
  extVersionDir: string,
  defaultLocale?: string,
  preferredLang?: AppLanguage
): Map<string, string> {
  const map = new Map<string, string>()
  const localesRoot = path.join(extVersionDir, '_locales')
  if (!fs.existsSync(localesRoot)) return map

  const candidateLocales: string[] = []
  if (preferredLang === 'zh-CN') {
    candidateLocales.push('zh_CN', 'zh-CN', 'zh', 'zh_TW')
  } else {
    candidateLocales.push('en', 'en_US', 'en_GB')
  }
  if (defaultLocale) {
    candidateLocales.push(defaultLocale, defaultLocale.replace('-', '_'))
  }
  candidateLocales.push('en', 'en_US', 'zh_CN')

  try {
    for (const entry of fs.readdirSync(localesRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !candidateLocales.includes(entry.name)) {
        candidateLocales.push(entry.name)
      }
    }
  } catch {
    // ignore
  }

  for (const loc of candidateLocales) {
    const msgPath = path.join(localesRoot, loc, 'messages.json')
    const json = safeReadJsonFile<Record<string, { message?: string }>>(msgPath)
    if (!json || typeof json !== 'object') continue
    for (const [key, val] of Object.entries(json)) {
      const lowerKey = key.toLowerCase()
      if (!map.has(lowerKey) && typeof val?.message === 'string') {
        map.set(lowerKey, val.message)
      }
    }
    if (map.size > 0) break
  }

  return map
}

function resolveLocalizedString(raw: unknown, messages: Map<string, string>): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed.includes('__MSG_')) return trimmed
  return trimmed.replace(/__MSG_([A-Za-z0-9_@]+)__/g, (_full, key: string) => {
    return messages.get(key.toLowerCase()) ?? _full
  })
}

function readIconAsDataUrl(extVersionDir: string, manifest: any): string | undefined {
  const iconCandidates: string[] = []
  const iconsObj = manifest?.icons
  if (iconsObj && typeof iconsObj === 'object') {
    for (const sizeKey of ['128', '64', '48', '32', '24', '16']) {
      if (typeof iconsObj[sizeKey] === 'string') {
        iconCandidates.push(iconsObj[sizeKey])
      }
    }
    for (const val of Object.values(iconsObj)) {
      if (typeof val === 'string' && !iconCandidates.includes(val)) {
        iconCandidates.push(val)
      }
    }
  }

  const actionIcon =
    manifest?.action?.default_icon ||
    manifest?.browser_action?.default_icon ||
    manifest?.page_action?.default_icon
  if (typeof actionIcon === 'string') {
    iconCandidates.push(actionIcon)
  } else if (actionIcon && typeof actionIcon === 'object') {
    for (const sizeKey of ['128', '48', '38', '32', '24', '19', '16']) {
      if (typeof actionIcon[sizeKey] === 'string') {
        iconCandidates.push(actionIcon[sizeKey])
      }
    }
  }

  for (const rel of iconCandidates) {
    const cleaned = rel.replace(/^\/+/, '')
    const full = path.join(extVersionDir, cleaned)
    try {
      if (!fs.existsSync(full)) continue
      const st = fs.statSync(full)
      if (!st.isFile() || st.size === 0 || st.size > 512 * 1024) continue
      const ext = path.extname(full).toLowerCase()
      const mime =
        ext === '.svg'
          ? 'image/svg+xml'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : 'image/png'
      const buf = fs.readFileSync(full)
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      // try next candidate
    }
  }
  return undefined
}

export function parseUnpackedExtensionDir(
  extVersionDir: string,
  fallbackId: string,
  profileDirName = 'Default',
  enabled = true,
  preferredLang?: AppLanguage
): ScannedSourceExtension | null {
  const manifestPath = path.join(extVersionDir, 'manifest.json')
  const manifest = safeReadJsonFile<any>(manifestPath)
  if (!manifest || typeof manifest !== 'object') return null

  // Skip Chrome Themes (not runnable extensions)
  if (manifest.theme && !manifest.background && !manifest.content_scripts && !manifest.action) {
    return null
  }

  const messages = loadExtensionLocaleMessages(
    extVersionDir,
    manifest.default_locale,
    preferredLang
  )
  const rawName = resolveLocalizedString(
    manifest.name || manifest.short_name || fallbackId,
    messages
  )
  if (!rawName || rawName.startsWith('__MSG_')) return null

  const description = resolveLocalizedString(manifest.description || '', messages)
  const version = String(manifest.version || '1.0.0').trim()
  const manifestVersion = Number(manifest.manifest_version) || 3

  const rawPopup =
    manifest.action?.default_popup ||
    manifest.browser_action?.default_popup ||
    manifest.page_action?.default_popup ||
    null
  const popupPath =
    typeof rawPopup === 'string' && rawPopup.trim() ? rawPopup.trim().replace(/^\/+/, '') : null

  const rawOptions = manifest.options_ui?.page || manifest.options_page || null
  const optionsPath =
    typeof rawOptions === 'string' && rawOptions.trim()
      ? rawOptions.trim().replace(/^\/+/, '')
      : null

  const homepageUrl =
    typeof manifest.homepage_url === 'string' && /^https?:\/\//i.test(manifest.homepage_url)
      ? manifest.homepage_url.trim()
      : null

  return {
    id: fallbackId,
    name: rawName,
    version,
    description,
    iconDataUrl: readIconAsDataUrl(extVersionDir, manifest),
    profileDir: profileDirName,
    enabled,
    manifestVersion,
    sourceDirPath: extVersionDir,
    popupPath,
    optionsPath,
    homepageUrl
  }
}

/**
 * Scans `<ProfileDir>/Extensions` + `Preferences` for user-installed Chrome/Arc extensions.
 */
export function scanChromiumProfileExtensions(
  profileDirPath: string,
  profileDirName: string,
  preferredLang?: AppLanguage
): ScannedSourceExtension[] {
  if (!profileDirPath || !fs.existsSync(profileDirPath)) return []
  const extRoot = path.join(profileDirPath, 'Extensions')
  if (!fs.existsSync(extRoot)) return []

  const prefs = safeReadJsonFile<any>(path.join(profileDirPath, 'Preferences'))
  const securePrefs = safeReadJsonFile<any>(path.join(profileDirPath, 'Secure Preferences'))
  const settingsMap: Record<string, any> = {
    ...(prefs?.extensions?.settings || {}),
    ...(securePrefs?.extensions?.settings || {})
  }

  const results: ScannedSourceExtension[] = []
  let extIds: string[] = []
  try {
    extIds = fs
      .readdirSync(extRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'Temp' && !d.name.startsWith('.'))
      .map((d) => d.name)
  } catch {
    return []
  }

  for (const extId of extIds) {
    if (INTERNAL_EXTENSION_IDS.has(extId)) continue
    const prefMeta = settingsMap[extId]
    // Chromium ManifestLocation: 5 = COMPONENT, 10 = EXTERNAL_COMPONENT
    if (prefMeta && (prefMeta.location === 5 || prefMeta.location === 10)) {
      continue
    }
    if (prefMeta?.was_installed_by_default && !prefMeta?.ack_external) {
      continue
    }

    const extIdDir = path.join(extRoot, extId)
    let versionDirs: string[] = []
    try {
      versionDirs = fs
        .readdirSync(extIdDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name)
        .sort(compareSemverDirs)
    } catch {
      continue
    }
    if (versionDirs.length === 0) continue

    const latestVer = versionDirs[versionDirs.length - 1]
    const latestDir = path.join(extIdDir, latestVer)
    const isEnabled =
      prefMeta === undefined
        ? true
        : prefMeta.state !== undefined
          ? Number(prefMeta.state) === 1
          : !prefMeta.disable_reasons

    const parsed = parseUnpackedExtensionDir(
      latestDir,
      extId,
      profileDirName,
      isEnabled,
      preferredLang
    )
    if (parsed) {
      results.push(parsed)
    }
  }

  return results
}

function copyExtensionFolderCleanly(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true })
  const entries = fs.readdirSync(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    // Skip Chrome Web Store signature verification metadata that can trigger noisy warnings in Electron
    if (entry.name === '_metadata') continue
    const s = path.join(srcDir, entry.name)
    const d = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      copyExtensionFolderCleanly(s, d)
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d)
    }
  }
}

function extractCrxBufferToZipPayload(crxBuf: Buffer): Buffer | null {
  if (crxBuf.length < 16) return null
  const magic = crxBuf.subarray(0, 4).toString('ascii')
  if (magic === 'PK\x03\x04') {
    // Already a raw ZIP
    return crxBuf
  }
  if (magic !== 'Cr24') return null

  const version = crxBuf.readUInt32LE(4)
  if (version === 3) {
    const headerLen = crxBuf.readUInt32LE(8)
    const zipOffset = 12 + headerLen
    if (zipOffset >= crxBuf.length) return null
    return crxBuf.subarray(zipOffset)
  }
  if (version === 2) {
    if (crxBuf.length < 16) return null
    const pubKeyLen = crxBuf.readUInt32LE(8)
    const sigLen = crxBuf.readUInt32LE(12)
    const zipOffset = 16 + pubKeyLen + sigLen
    if (zipOffset >= crxBuf.length) return null
    return crxBuf.subarray(zipOffset)
  }
  return null
}

function unzipArchiveToDir(zipFilePath: string, destDir: string): boolean {
  fs.mkdirSync(destDir, { recursive: true })
  if (process.platform === 'darwin') {
    try {
      execFileSync('/usr/bin/ditto', ['-x', '-k', zipFilePath, destDir], { timeout: 20000 })
      return true
    } catch {
      // fallback to unzip
    }
  }
  if (process.platform !== 'win32') {
    try {
      execFileSync('unzip', ['-oq', zipFilePath, '-d', destDir], { timeout: 20000 })
      return true
    } catch {
      return false
    }
  }
  try {
    execFileSync('tar', ['-xf', zipFilePath, '-C', destDir], { timeout: 20000 })
    return true
  } catch {
    return false
  }
}

export function extractChromeWebStoreId(input: string): string | null {
  const trimmed = input.trim()
  if (/^[a-p]{32}$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  const match = trimmed.match(/\/detail\/(?:[^/]+\/)?([a-p]{32})(?:[/?#]|$)/i)
  if (match?.[1]) {
    return match[1].toLowerCase()
  }
  const loose = trimmed.match(/\b([a-p]{32})\b/i)
  return loose?.[1]?.toLowerCase() || null
}

export class ExtensionEcosystemManager {
  private extensionsRootDir: string
  private activePopupWindow: BrowserWindow | null = null
  // partition -> (itemId -> Electron runtime extension ID)
  private loadedRuntimeIdsByPartition = new Map<string, Map<string, string>>()

  constructor(private store: PersistenceStore) {
    this.extensionsRootDir = path.join(app.getPath('userData'), 'arko-browser-store', 'extensions')
    fs.mkdirSync(this.extensionsRootDir, { recursive: true })
  }

  private appliesToPartition(item: InstalledExtensionItem, partition: string): boolean {
    if (!Array.isArray(item.partitions) || item.partitions.length === 0) return true
    return item.partitions.includes('*') || item.partitions.includes(partition)
  }

  public getExtensionsSnapshotForPartition(partition: string): InstalledExtensionItem[] {
    const runtimeMap = this.loadedRuntimeIdsByPartition.get(partition)
    return this.store.extensions
      .filter((item) => this.appliesToPartition(item, partition))
      .map((item) => {
        const runtimeId = runtimeMap?.get(item.id) || item.electronExtensionId
        return {
          ...item,
          electronExtensionId: runtimeId,
          isLoaded: Boolean(item.enabled && runtimeId)
        }
      })
  }

  public async ensureExtensionsLoadedForSession(
    partition: string,
    ses: Electron.Session
  ): Promise<void> {
    let partMap = this.loadedRuntimeIdsByPartition.get(partition)
    if (!partMap) {
      partMap = new Map<string, string>()
      this.loadedRuntimeIdsByPartition.set(partition, partMap)
    }

    let dirty = false
    for (const item of this.store.extensions) {
      if (!item.enabled || !this.appliesToPartition(item, partition)) continue
      if (partMap.has(item.id)) continue
      if (!item.localPath || !fs.existsSync(path.join(item.localPath, 'manifest.json'))) {
        item.loadError = 'Extension manifest missing on disk'
        dirty = true
        continue
      }
      try {
        const loaded = await ses.loadExtension(item.localPath, { allowFileAccess: true })
        partMap.set(item.id, loaded.id)
        if (item.electronExtensionId !== loaded.id || item.loadError) {
          item.electronExtensionId = loaded.id
          item.loadError = null
          dirty = true
        }
      } catch (err: any) {
        item.loadError = String(err?.message || 'Unsupported manifest API in Electron').slice(
          0,
          160
        )
        dirty = true
      }
    }

    if (dirty) {
      this.store.saveExtensions()
    }
  }

  public stageImportedExtension(
    scanned: ScannedSourceExtension,
    targetPartitions: string[],
    sourceBrowser: ImportBrowserId
  ): InstalledExtensionItem | null {
    try {
      const safeVer = scanned.version.replace(/[^a-zA-Z0-9._-]/g, '_') || '1.0.0'
      const destDir = path.join(this.extensionsRootDir, scanned.id, safeVer)
      if (!fs.existsSync(path.join(destDir, 'manifest.json'))) {
        copyExtensionFolderCleanly(scanned.sourceDirPath, destDir)
      }

      const existing = this.store.extensions.find(
        (e) => e.id === scanned.id || e.sourceExtensionId === scanned.id
      )
      if (existing) {
        existing.name = scanned.name
        existing.description = scanned.description || existing.description
        existing.version = scanned.version
        existing.manifestVersion = scanned.manifestVersion
        existing.localPath = destDir
        existing.iconDataUrl = scanned.iconDataUrl || existing.iconDataUrl
        existing.popupPath = scanned.popupPath
        existing.optionsPath = scanned.optionsPath
        existing.homepageUrl = scanned.homepageUrl
        if (!existing.partitions.includes('*')) {
          for (const p of targetPartitions) {
            if (!existing.partitions.includes(p)) {
              existing.partitions.push(p)
            }
          }
        }
        if (scanned.enabled) {
          existing.enabled = true
        }
        return existing
      }

      const created: InstalledExtensionItem = {
        id: scanned.id,
        sourceExtensionId: scanned.id,
        name: scanned.name,
        description: scanned.description || '',
        version: scanned.version,
        manifestVersion: scanned.manifestVersion,
        localPath: destDir,
        iconDataUrl: scanned.iconDataUrl,
        popupPath: scanned.popupPath,
        optionsPath: scanned.optionsPath,
        homepageUrl: scanned.homepageUrl,
        enabled: scanned.enabled,
        partitions: targetPartitions.length > 0 ? [...new Set(targetPartitions)] : ['*'],
        sourceBrowser,
        installedAt: Date.now(),
        loadError: null
      }
      this.store.extensions.push(created)
      return created
    } catch {
      return null
    }
  }

  public async pickAndInstallUnpackedExtension(
    mainWindow: BrowserWindow,
    activeSessions: Array<[string, Electron.Session]>,
    lang?: AppLanguage
  ): Promise<{ ok: boolean; extension?: InstalledExtensionItem; error?: string }> {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: tr(
        lang,
        'Select Unpacked Chrome Extension Folder (containing manifest.json)',
        '选择已解压的扩展插件文件夹（需包含 manifest.json）'
      ),
      properties: ['openDirectory']
    })
    if (canceled || !filePaths || filePaths.length === 0) {
      return { ok: false }
    }

    let chosenDir = filePaths[0]
    if (!fs.existsSync(path.join(chosenDir, 'manifest.json'))) {
      // Check if user selected parent `<extId>` folder containing a single `<version>` subfolder
      try {
        const subs = fs
          .readdirSync(chosenDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort(compareSemverDirs)
        const latest = subs[subs.length - 1]
        if (latest && fs.existsSync(path.join(chosenDir, latest, 'manifest.json'))) {
          chosenDir = path.join(chosenDir, latest)
        }
      } catch {
        // ignore
      }
    }

    const slugId = `ext-local-${path
      .basename(chosenDir)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 24)}-${Date.now().toString(36)}`
    const parsed = parseUnpackedExtensionDir(chosenDir, slugId, 'Custom', true, lang)
    if (!parsed) {
      return {
        ok: false,
        error: tr(
          lang,
          'No valid Chrome Extension manifest.json found in the selected directory.',
          '所选文件夹中未找到有效的 Chrome 扩展 manifest.json 文件。'
        )
      }
    }

    const destDir = path.join(
      this.extensionsRootDir,
      parsed.id,
      parsed.version.replace(/[^a-zA-Z0-9._-]/g, '_') || '1.0.0'
    )
    copyExtensionFolderCleanly(chosenDir, destDir)

    const item: InstalledExtensionItem = {
      id: parsed.id,
      name: parsed.name,
      description: parsed.description || '',
      version: parsed.version,
      manifestVersion: parsed.manifestVersion,
      localPath: destDir,
      iconDataUrl: parsed.iconDataUrl,
      popupPath: parsed.popupPath,
      optionsPath: parsed.optionsPath,
      homepageUrl: parsed.homepageUrl,
      enabled: true,
      partitions: ['*'],
      installedAt: Date.now(),
      loadError: null
    }

    this.store.extensions.unshift(item)
    for (const [part, ses] of activeSessions) {
      await this.ensureExtensionsLoadedForSession(part, ses)
    }
    this.store.saveExtensions()
    return { ok: true, extension: item }
  }

  public async installFromChromeWebStore(
    urlOrId: string,
    activeSessions: Array<[string, Electron.Session]>,
    lang?: AppLanguage
  ): Promise<{ ok: boolean; extension?: InstalledExtensionItem; error?: string }> {
    const extId = extractChromeWebStoreId(urlOrId)
    if (!extId) {
      return {
        ok: false,
        error: tr(
          lang,
          'Please enter a valid Chrome Web Store URL or 32-character Extension ID.',
          '请输入有效的 Chrome 应用商店详情页链接或 32 位扩展 ID。'
        )
      }
    }

    const crxDownloadUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=134.0.6998.89&acceptformat=crx2,crx3&x=id%3D${extId}%26installsource%3Dondemand%26uc`
    let tmpDir: string | null = null
    try {
      const response = await net.fetch(crxDownloadUrl)
      if (!response.ok) {
        return {
          ok: false,
          error: tr(
            lang,
            `Download failed from Chrome Web Store (HTTP ${response.status}).`,
            `从 Chrome 应用商店拉取扩展包失败 (HTTP ${response.status})。`
          )
        }
      }

      const arrayBuf = await response.arrayBuffer()
      const crxBuf = Buffer.from(arrayBuf)
      const zipPayload = extractCrxBufferToZipPayload(crxBuf)
      if (!zipPayload) {
        return {
          ok: false,
          error: tr(
            lang,
            'Could not unpack CRX3 archive returned by Chrome Web Store.',
            '解析商店返回的 CRX3 扩展包失败（可能该插件已下架或限制下载）。'
          )
        }
      }

      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arko-crx-'))
      const zipPath = path.join(tmpDir, `${extId}.zip`)
      const unpackDir = path.join(tmpDir, 'unpacked')
      fs.writeFileSync(zipPath, zipPayload)

      const extracted = unzipArchiveToDir(zipPath, unpackDir)
      if (!extracted || !fs.existsSync(path.join(unpackDir, 'manifest.json'))) {
        return {
          ok: false,
          error: tr(lang, 'Failed to extract extension archive.', '解压扩展插件包失败。')
        }
      }

      const parsed = parseUnpackedExtensionDir(unpackDir, extId, 'WebStore', true, lang)
      if (!parsed) {
        return {
          ok: false,
          error: tr(lang, 'Invalid extension manifest.', '扩展插件 manifest.json 无效。')
        }
      }

      const destDir = path.join(
        this.extensionsRootDir,
        extId,
        parsed.version.replace(/[^a-zA-Z0-9._-]/g, '_') || '1.0.0'
      )
      fs.rmSync(destDir, { recursive: true, force: true })
      copyExtensionFolderCleanly(unpackDir, destDir)

      let item = this.store.extensions.find(
        (e) => e.id === extId || e.sourceExtensionId === extId
      )
      if (item) {
        item.name = parsed.name
        item.description = parsed.description || ''
        item.version = parsed.version
        item.manifestVersion = parsed.manifestVersion
        item.localPath = destDir
        item.iconDataUrl = parsed.iconDataUrl
        item.popupPath = parsed.popupPath
        item.optionsPath = parsed.optionsPath
        item.homepageUrl = parsed.homepageUrl
        item.enabled = true
        item.partitions = ['*']
        item.loadError = null
      } else {
        item = {
          id: extId,
          sourceExtensionId: extId,
          name: parsed.name,
          description: parsed.description || '',
          version: parsed.version,
          manifestVersion: parsed.manifestVersion,
          localPath: destDir,
          iconDataUrl: parsed.iconDataUrl,
          popupPath: parsed.popupPath,
          optionsPath: parsed.optionsPath,
          homepageUrl: parsed.homepageUrl,
          enabled: true,
          partitions: ['*'],
          installedAt: Date.now(),
          loadError: null
        }
        this.store.extensions.unshift(item)
      }

      for (const [part, ses] of activeSessions) {
        await this.ensureExtensionsLoadedForSession(part, ses)
      }
      this.store.saveExtensions()
      return { ok: true, extension: item }
    } catch (err: any) {
      return {
        ok: false,
        error:
          err?.message ||
          tr(
            lang,
            'Network error while downloading from Chrome Web Store.',
            '连接 Chrome 应用商店下载失败，请检查网络连接。'
          )
      }
    } finally {
      if (tmpDir) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true })
        } catch {
          // ignore
        }
      }
    }
  }

  public async toggleExtension(
    extensionId: string,
    enabled: boolean,
    activeSessions: Array<[string, Electron.Session]>
  ): Promise<void> {
    const item = this.store.extensions.find((e) => e.id === extensionId)
    if (!item) return
    item.enabled = enabled

    if (!enabled) {
      for (const [part, ses] of activeSessions) {
        const partMap = this.loadedRuntimeIdsByPartition.get(part)
        const runtimeId = partMap?.get(item.id) || item.electronExtensionId
        if (runtimeId) {
          try {
            ses.removeExtension(runtimeId)
          } catch {
            // ignore
          }
          partMap?.delete(item.id)
        }
      }
    } else {
      item.loadError = null
      for (const [part, ses] of activeSessions) {
        await this.ensureExtensionsLoadedForSession(part, ses)
      }
    }

    this.store.saveExtensions()
  }

  public async removeExtension(
    extensionId: string,
    activeSessions: Array<[string, Electron.Session]>
  ): Promise<void> {
    const idx = this.store.extensions.findIndex((e) => e.id === extensionId)
    if (idx < 0) return
    const item = this.store.extensions[idx]

    for (const [part, ses] of activeSessions) {
      const partMap = this.loadedRuntimeIdsByPartition.get(part)
      const runtimeId = partMap?.get(item.id) || item.electronExtensionId
      if (runtimeId) {
        try {
          ses.removeExtension(runtimeId)
        } catch {
          // ignore
        }
        partMap?.delete(item.id)
      }
    }

    this.store.extensions.splice(idx, 1)
    this.store.saveExtensions()

    try {
      const parentExtDir = path.dirname(item.localPath)
      if (parentExtDir.startsWith(this.extensionsRootDir)) {
        fs.rmSync(parentExtDir, { recursive: true, force: true })
      }
    } catch {
      // ignore
    }
  }

  public resolveRuntimeExtensionId(partition: string, item: InstalledExtensionItem): string | null {
    return (
      this.loadedRuntimeIdsByPartition.get(partition)?.get(item.id) ||
      item.electronExtensionId ||
      null
    )
  }

  public openPopupWindow(params: {
    parentWindow: BrowserWindow
    partition: string
    ses: Electron.Session
    item: InstalledExtensionItem
    anchor?: { x: number; y: number }
    onOpenUrlInTab: (url: string) => void
  }): { ok: boolean; openedTab?: boolean; error?: string } {
    const { parentWindow, partition, ses, item, anchor, onOpenUrlInTab } = params
    const runtimeId = this.resolveRuntimeExtensionId(partition, item)
    if (!runtimeId) {
      return {
        ok: false,
        error: item.loadError || 'Extension is not active in the current profile session.'
      }
    }

    if (!item.popupPath) {
      if (item.optionsPath) {
        onOpenUrlInTab(`chrome-extension://${runtimeId}/${item.optionsPath}`)
        return { ok: true, openedTab: true }
      }
      if (item.homepageUrl) {
        onOpenUrlInTab(item.homepageUrl)
        return { ok: true, openedTab: true }
      }
      return { ok: false, error: 'This extension runs automatically on webpages (no popup UI).' }
    }

    if (this.activePopupWindow && !this.activePopupWindow.isDestroyed()) {
      this.activePopupWindow.close()
      this.activePopupWindow = null
    }

    const parentBounds = parentWindow.getBounds()
    const width = 376
    const height = 520
    const x = anchor
      ? Math.max(
          parentBounds.x + 12,
          Math.min(parentBounds.x + parentBounds.width - width - 12, Math.round(parentBounds.x + anchor.x - width + 36))
        )
      : parentBounds.x + parentBounds.width - width - 32
    const y = anchor
      ? Math.max(parentBounds.y + 44, Math.round(parentBounds.y + anchor.y + 8))
      : parentBounds.y + 54

    const popupWin = new BrowserWindow({
      width,
      height,
      x,
      y,
      parent: parentWindow,
      frame: false,
      resizable: true,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      roundedCorners: true,
      hasShadow: true,
      backgroundColor: '#1E1E24',
      webPreferences: {
        session: ses,
        contextIsolation: true,
        sandbox: true
      }
    })

    this.activePopupWindow = popupWin
    const popupUrl = `chrome-extension://${runtimeId}/${item.popupPath}`

    popupWin.webContents.setWindowOpenHandler(({ url }) => {
      if (url && /^(https?:\/\/|chrome-extension:\/\/)/i.test(url)) {
        onOpenUrlInTab(url)
        if (!popupWin.isDestroyed()) popupWin.close()
      }
      return { action: 'deny' }
    })

    popupWin.on('blur', () => {
      if (!popupWin.isDestroyed()) {
        popupWin.close()
      }
    })

    popupWin.on('closed', () => {
      if (this.activePopupWindow === popupWin) {
        this.activePopupWindow = null
      }
    })

    void popupWin.loadURL(popupUrl)
    return { ok: true }
  }
}
