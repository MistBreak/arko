import { app, shell } from 'electron'
import { execFile, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import {
  GITHUB_RELEASES_API_LATEST,
  GITHUB_RELEASES_URL
} from '@shared/constants'
import type { AppUpdateState } from '@shared/types'

const execFileAsync = promisify(execFile)

interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GitHubReleaseResponse {
  tag_name?: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
  draft?: boolean
  prerelease?: boolean
  assets?: GitHubReleaseAsset[]
}

function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '')
}

function compareSemver(aRaw: string, bRaw: string): number {
  const cleanA = normalizeVersion(aRaw)
  const cleanB = normalizeVersion(bRaw)
  const [coreA, preA] = cleanA.split('-', 2)
  const [coreB, preB] = cleanB.split('-', 2)
  const partsA = coreA.split('.').map((n) => parseInt(n, 10) || 0)
  const partsB = coreB.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(partsA.length, partsB.length, 3)

  for (let i = 0; i < len; i++) {
    const va = partsA[i] || 0
    const vb = partsB[i] || 0
    if (va > vb) return 1
    if (va < vb) return -1
  }

  if (!preA && preB) return 1
  if (preA && !preB) return -1
  if (preA && preB) return preA.localeCompare(preB)
  return 0
}

function pickBestReleaseAsset(assets: GitHubReleaseAsset[]): {
  asset: GitHubReleaseAsset | null
  canOneClickInstall: boolean
} {
  if (!Array.isArray(assets) || assets.length === 0) {
    return { asset: null, canOneClickInstall: false }
  }

  const platform = process.platform
  const arch = process.arch // 'arm64' | 'x64'
  const lowerArchHints =
    arch === 'arm64'
      ? ['arm64', 'aarch64', 'apple', 'universal']
      : ['x64', 'amd64', 'intel', 'universal']

  const matchesArch = (name: string): boolean => {
    const l = name.toLowerCase()
    if (arch === 'x64' && (l.includes('arm64') || l.includes('aarch64'))) return false
    if (arch === 'arm64' && (l.includes('x64') || l.includes('amd64'))) return false
    return lowerArchHints.some((h) => l.includes(h))
  }

  if (platform === 'darwin') {
    // Prefer .zip for in-app one-click extraction & bundle swap (works with or without Apple Developer ID!)
    const macZips = assets.filter(
      (a) => a.name.toLowerCase().endsWith('.zip') && !a.name.toLowerCase().includes('win')
    )
    const archZip = macZips.find((a) => matchesArch(a.name)) || macZips[0]
    if (archZip) {
      return { asset: archZip, canOneClickInstall: app.isPackaged }
    }

    const macDmgs = assets.filter((a) => a.name.toLowerCase().endsWith('.dmg'))
    const archDmg = macDmgs.find((a) => matchesArch(a.name)) || macDmgs[0]
    if (archDmg) {
      return { asset: archDmg, canOneClickInstall: false }
    }
  } else if (platform === 'win32') {
    const winExes = assets.filter(
      (a) => a.name.toLowerCase().endsWith('.exe') && !a.name.toLowerCase().includes('blockmap')
    )
    const archExe = winExes.find((a) => matchesArch(a.name)) || winExes[0]
    if (archExe) {
      return { asset: archExe, canOneClickInstall: app.isPackaged }
    }
  } else if (platform === 'linux') {
    const appImages = assets.filter((a) => a.name.toLowerCase().endsWith('.appimage'))
    const archImg = appImages.find((a) => matchesArch(a.name)) || appImages[0]
    if (archImg) {
      return {
        asset: archImg,
        canOneClickInstall: Boolean(app.isPackaged && process.env.APPIMAGE)
      }
    }
  }

  return { asset: null, canOneClickInstall: false }
}

function resolveMacAppBundlePath(): string | null {
  if (process.platform !== 'darwin') return null
  const execPath = process.execPath
  const marker = '.app/Contents/MacOS/'
  const idx = execPath.indexOf(marker)
  if (idx === -1) return null
  return `${execPath.slice(0, idx)}.app`
}

function findExtractedAppBundle(dir: string): string | null {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory() && entry.name.endsWith('.app')) {
      return full
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('__MACOSX')) {
      const nested = findExtractedAppBundle(path.join(dir, entry.name))
      if (nested) return nested
    }
  }
  return null
}

export class UpdateManager {
  private state: AppUpdateState
  private listeners = new Set<(state: AppUpdateState) => void>()
  private downloadAbort: AbortController | null = null

  constructor() {
    this.state = {
      status: 'idle',
      currentVersion: app.getVersion()
    }
  }

  public getState(): AppUpdateState {
    return { ...this.state }
  }

  public onStateChanged(cb: (state: AppUpdateState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private patchState(partial: Partial<AppUpdateState>): AppUpdateState {
    this.state = {
      ...this.state,
      ...partial,
      currentVersion: app.getVersion()
    }
    const snap = this.getState()
    for (const cb of this.listeners) {
      try {
        cb(snap)
      } catch {
        // ignore listener errors
      }
    }
    return snap
  }

  public async checkForUpdates(silent = false): Promise<AppUpdateState> {
    if (this.state.status === 'downloading' || this.state.status === 'installing') {
      return this.getState()
    }

    if (!silent) {
      this.patchState({ status: 'checking', error: undefined })
    }

    try {
      const resp = await fetch(GITHUB_RELEASES_API_LATEST, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Arko-Browser/${app.getVersion()}`
        },
        signal: AbortSignal.timeout(12000)
      })

      // Graceful handling when the GitHub Org / Repo has no published Release yet (404)
      if (resp.status === 404) {
        return this.patchState({
          status: silent ? 'idle' : 'up-to-date',
          latestVersion: app.getVersion(),
          releaseHtmlUrl: GITHUB_RELEASES_URL,
          checkedAt: Date.now(),
          error: undefined
        })
      }

      if (!resp.ok) {
        throw new Error(`GitHub Releases HTTP ${resp.status}`)
      }

      const release = (await resp.json()) as GitHubReleaseResponse
      const latestRaw = release.tag_name || ''
      if (!latestRaw) {
        return this.patchState({
          status: silent ? 'idle' : 'up-to-date',
          latestVersion: app.getVersion(),
          checkedAt: Date.now(),
          error: undefined
        })
      }

      const latestVersion = normalizeVersion(latestRaw)
      const currentVersion = normalizeVersion(app.getVersion())

      if (compareSemver(latestVersion, currentVersion) <= 0) {
        return this.patchState({
          status: 'up-to-date',
          latestVersion,
          releaseName: release.name || `v${latestVersion}`,
          releaseNotes: release.body || '',
          publishedAt: release.published_at,
          releaseHtmlUrl: release.html_url || GITHUB_RELEASES_URL,
          checkedAt: Date.now(),
          error: undefined
        })
      }

      const { asset, canOneClickInstall } = pickBestReleaseAsset(release.assets || [])
      return this.patchState({
        status: 'available',
        latestVersion,
        releaseName: release.name || `v${latestVersion}`,
        releaseNotes: release.body || '',
        publishedAt: release.published_at,
        releaseHtmlUrl: release.html_url || GITHUB_RELEASES_URL,
        downloadUrl: asset?.browser_download_url,
        assetName: asset?.name,
        totalBytes: asset?.size,
        canOneClickInstall,
        progressPercent: 0,
        transferredBytes: 0,
        downloadedFilePath: undefined,
        checkedAt: Date.now(),
        error: undefined
      })
    } catch (err: any) {
      if (silent) {
        return this.getState()
      }
      return this.patchState({
        status: 'error',
        checkedAt: Date.now(),
        error: err?.message || 'Failed to check GitHub Releases'
      })
    }
  }

  public async downloadUpdate(): Promise<AppUpdateState> {
    if (this.state.status === 'downloading') {
      return this.getState()
    }

    if (!this.state.downloadUrl || !this.state.assetName) {
      const targetUrl = this.state.releaseHtmlUrl || GITHUB_RELEASES_URL
      await shell.openExternal(targetUrl)
      return this.getState()
    }

    const updateDir = path.join(app.getPath('temp'), 'arko-updater')
    fs.mkdirSync(updateDir, { recursive: true })
    const safeAssetName = path.basename(this.state.assetName)
    const destPath = path.join(updateDir, safeAssetName)
    const tmpPath = `${destPath}.part`

    this.downloadAbort?.abort()
    const controller = new AbortController()
    this.downloadAbort = controller

    this.patchState({
      status: 'downloading',
      progressPercent: 0,
      transferredBytes: 0,
      error: undefined
    })

    try {
      const resp = await fetch(this.state.downloadUrl, {
        method: 'GET',
        headers: {
          'User-Agent': `Arko-Browser/${app.getVersion()}`
        },
        signal: controller.signal
      })

      if (!resp.ok || !resp.body) {
        throw new Error(`Download failed (HTTP ${resp.status})`)
      }

      const contentLength = Number(resp.headers.get('content-length') || this.state.totalBytes || 0)
      const fileStream = fs.createWriteStream(tmpPath)
      const reader = resp.body.getReader()

      let transferred = 0
      let lastEmit = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          transferred += value.byteLength
          const ok = fileStream.write(Buffer.from(value))
          if (!ok) {
            await new Promise<void>((resolve) => fileStream.once('drain', resolve))
          }
          const now = Date.now()
          if (now - lastEmit > 120) {
            lastEmit = now
            const pct =
              contentLength > 0 ? Math.min(99, Math.round((transferred / contentLength) * 100)) : 0
            this.patchState({
              status: 'downloading',
              transferredBytes: transferred,
              totalBytes: contentLength || undefined,
              progressPercent: pct
            })
          }
        }
      }

      await new Promise<void>((resolve, reject) => {
        fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()))
      })

      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath)
      }
      fs.renameSync(tmpPath, destPath)

      return this.patchState({
        status: 'downloaded',
        downloadedFilePath: destPath,
        transferredBytes: transferred,
        totalBytes: contentLength || transferred,
        progressPercent: 100,
        error: undefined
      })
    } catch (err: any) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      } catch {
        // ignore
      }
      return this.patchState({
        status: 'error',
        error: err?.message || 'Update download interrupted'
      })
    } finally {
      this.downloadAbort = null
    }
  }

  public async installUpdateAndRestart(): Promise<{ ok: boolean; error?: string }> {
    const filePath = this.state.downloadedFilePath
    if (!filePath || !fs.existsSync(filePath)) {
      const url = this.state.releaseHtmlUrl || GITHUB_RELEASES_URL
      await shell.openExternal(url)
      return { ok: true }
    }

    // In local dev mode, do not overwrite Electron.app inside node_modules; reveal installer instead
    if (!app.isPackaged) {
      shell.showItemInFolder(filePath)
      return { ok: true }
    }

    this.patchState({ status: 'installing', error: undefined })

    try {
      if (process.platform === 'darwin' && filePath.toLowerCase().endsWith('.zip')) {
        const targetBundle = resolveMacAppBundlePath()
        if (!targetBundle) {
          shell.showItemInFolder(filePath)
          return { ok: true }
        }

        const stageDir = path.join(app.getPath('temp'), `arko-stage-${Date.now()}`)
        fs.mkdirSync(stageDir, { recursive: true })

        await execFileAsync('/usr/bin/ditto', ['-x', '-k', filePath, stageDir])
        const extractedApp = findExtractedAppBundle(stageDir)
        if (!extractedApp) {
          throw new Error('Could not locate .app bundle inside downloaded archive')
        }

        // Strip Gatekeeper quarantine attribute so unsigned / ad-hoc macOS builds relaunch cleanly
        await execFileAsync('/usr/bin/xattr', ['-cr', extractedApp]).catch(() => {})

        const helperScriptPath = path.join(stageDir, 'apply-arko-update.sh')
        const pid = process.pid
        const scriptContent = [
          '#!/bin/sh',
          `APP_PID=${pid}`,
          'TRIES=0',
          'while kill -0 "$APP_PID" 2>/dev/null && [ "$TRIES" -lt 60 ]; do',
          '  sleep 0.25',
          '  TRIES=$((TRIES + 1))',
          'done',
          `rm -rf ${JSON.stringify(targetBundle)}`,
          `mv ${JSON.stringify(extractedApp)} ${JSON.stringify(targetBundle)}`,
          `/usr/bin/xattr -cr ${JSON.stringify(targetBundle)} 2>/dev/null || true`,
          `open -n ${JSON.stringify(targetBundle)}`,
          `rm -rf ${JSON.stringify(stageDir)} ${JSON.stringify(filePath)} 2>/dev/null || true`
        ].join('\n')

        fs.writeFileSync(helperScriptPath, scriptContent, { mode: 0o755 })
        const child = spawn('/bin/sh', [helperScriptPath], {
          detached: true,
          stdio: 'ignore'
        })
        child.unref()
        setTimeout(() => app.quit(), 120)
        return { ok: true }
      }

      if (process.platform === 'win32' && filePath.toLowerCase().endsWith('.exe')) {
        const child = spawn(filePath, ['/S', '--force-run'], {
          detached: true,
          stdio: 'ignore'
        })
        child.unref()
        setTimeout(() => app.quit(), 150)
        return { ok: true }
      }

      if (
        process.platform === 'linux' &&
        filePath.toLowerCase().endsWith('.appimage') &&
        process.env.APPIMAGE
      ) {
        const targetAppImage = process.env.APPIMAGE
        fs.chmodSync(filePath, 0o755)
        const helperPath = path.join(app.getPath('temp'), `arko-linux-update-${Date.now()}.sh`)
        const script = [
          '#!/bin/sh',
          'sleep 1',
          `mv -f ${JSON.stringify(filePath)} ${JSON.stringify(targetAppImage)}`,
          `chmod +x ${JSON.stringify(targetAppImage)}`,
          `${JSON.stringify(targetAppImage)} &`,
          `rm -f ${JSON.stringify(helperPath)}`
        ].join('\n')
        fs.writeFileSync(helperPath, script, { mode: 0o755 })
        const child = spawn('/bin/sh', [helperPath], { detached: true, stdio: 'ignore' })
        child.unref()
        setTimeout(() => app.quit(), 120)
        return { ok: true }
      }

      // Fallback for .dmg or custom package formats: open the installer directly
      await shell.openPath(filePath)
      return { ok: true }
    } catch (err: any) {
      const msg = err?.message || 'Failed to apply update'
      this.patchState({ status: 'error', error: msg })
      return { ok: false, error: msg }
    }
  }
}
