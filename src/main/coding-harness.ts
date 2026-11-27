import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { HarnessExecutionResult, HarnessToolDefinition } from './browser-harness'

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'coverage',
  'target',
  '__pycache__',
  '.venv',
  'venv'
])

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.icns',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp3',
  '.mp4',
  '.mov',
  '.wasm',
  '.asar'
])

const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?(\/|~|\$HOME)(\s|$)/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bFormat-Volume\b/i,
  /\brd\s+\/s\s+\/q\s+[a-zA-Z]:\\$/i
]

function toPosixRel(workspaceRoot: string, targetPath: string): string {
  const rel = path.relative(workspaceRoot, targetPath)
  return rel.split(path.sep).join('/') || '.'
}

export function resolveSafeWorkspacePath(
  workspaceRoot: string,
  userInputPath: string
): { ok: true; absPath: string; relPath: string } | { ok: false; error: string } {
  const cleanRoot = path.resolve(workspaceRoot)
  const normalizedInput = (userInputPath || '.')
    .trim()
    .replace(/^[\\/]+/, (m) => (path.isAbsolute(userInputPath.trim()) ? m : ''))

  const candidate = path.isAbsolute(normalizedInput)
    ? path.resolve(normalizedInput)
    : path.resolve(cleanRoot, normalizedInput)

  const rel = path.relative(cleanRoot, candidate)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      ok: false,
      error: `安全沙箱限制：禁止访问或修改工作区目录 (${cleanRoot}) 之外的路径 "${userInputPath}"`
    }
  }

  return {
    ok: true,
    absPath: candidate,
    relPath: toPosixRel(cleanRoot, candidate)
  }
}

/**
 * Automatically loads project-level instructions (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`)
 * just like Pi Coding Agent, Claude Code, and OpenAI Codex.
 */
export function loadWorkspaceAgentInstructions(workspaceRoot?: string | null): string {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return ''
  const candidates = [
    'AGENTS.md',
    'CLAUDE.md',
    '.cursorrules',
    '.github/copilot-instructions.md'
  ]
  const loaded: string[] = []

  for (const rel of candidates) {
    const full = path.join(workspaceRoot, rel)
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        const content = fs.readFileSync(full, 'utf-8').trim()
        if (content) {
          loaded.push(`### 项目规范文件 (${rel})\n${content.slice(0, 6000)}`)
        }
      }
    } catch {
      // ignore unreadable file
    }
    if (loaded.length >= 2) break
  }

  return loaded.join('\n\n')
}

function loadBasicGitignorePrefixes(workspaceRoot: string): string[] {
  const giPath = path.join(workspaceRoot, '.gitignore')
  if (!fs.existsSync(giPath)) return []
  try {
    return fs
      .readFileSync(giPath, 'utf-8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
      .map((l) => l.replace(/^\/+|\/+$/g, ''))
      .filter((l) => l.length > 0 && !l.includes('*'))
      .slice(0, 40)
  } catch {
    return []
  }
}

function walkWorkspaceFiles(
  workspaceRoot: string,
  maxFiles = 2500
): string[] {
  const results: string[] = []
  const extraIgnored = new Set(loadBasicGitignorePrefixes(workspaceRoot))

  const visit = (dir: string, depth: number): void => {
    if (results.length >= maxFiles || depth > 12) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) break
      const name = entry.name
      if (name === '.' || name === '..') continue

      const full = path.join(dir, name)
      const rel = toPosixRel(workspaceRoot, full)

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(name) || extraIgnored.has(name) || extraIgnored.has(rel)) {
          continue
        }
        visit(full, depth + 1)
      } else if (entry.isFile()) {
        const ext = path.extname(name).toLowerCase()
        if (BINARY_EXTENSIONS.has(ext)) continue
        results.push(rel)
      }
    }
  }

  visit(workspaceRoot, 0)
  return results
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLE_STAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/___DOUBLE_STAR___/g, '.*')
  return new RegExp(escaped, 'i')
}

function buildCompactUnifiedDiff(
  relPath: string,
  oldSlice: string,
  newSlice: string,
  approxStartLine: number
): { summary: string; diffText: string } {
  const oldLines = oldSlice.split('\n')
  const newLines = newSlice.split('\n')
  const diffHeader = `--- a/${relPath}\n+++ b/${relPath}\n@@ -${approxStartLine},${oldLines.length} +${approxStartLine},${newLines.length} @@`
  const bodyLines = [
    ...oldLines.slice(0, 28).map((l) => `- ${l}`),
    ...(oldLines.length > 28 ? [`- ... (${oldLines.length - 28} more removed lines)`] : []),
    ...newLines.slice(0, 28).map((l) => `+ ${l}`),
    ...(newLines.length > 28 ? [`+ ... (${newLines.length - 28} more added lines)`] : [])
  ]
  return {
    summary: `+${newLines.length} / -${oldLines.length} 行`,
    diffText: `${diffHeader}\n${bodyLines.join('\n')}`
  }
}

/**
 * Multi-tier fuzzy replacement (Exact -> CRLF/LF normalized -> Line-trimmed whitespace tolerant).
 * Preserves Windows CRLF or Unix LF line endings automatically!
 */
function applySurgicalEdit(
  fileContent: string,
  oldText: string,
  newText: string,
  replaceAll = false
):
  | {
      ok: true
      updatedContent: string
      matchLine: number
      replacedCount: number
    }
  | { ok: false; error: string } {
  if (!oldText) {
    return { ok: false, error: 'oldText 不能为空（若需创建全新文件请使用 write_code_file）' }
  }

  const usesCrLf = fileContent.includes('\r\n')
  const normFile = fileContent.replace(/\r\n/g, '\n')
  const normOld = oldText.replace(/\r\n/g, '\n')
  const normNew = newText.replace(/\r\n/g, '\n')

  // Tier 1 & 2: Exact / CRLF-normalized match
  const firstIdx = normFile.indexOf(normOld)
  if (firstIdx !== -1) {
    const secondIdx = normFile.indexOf(normOld, firstIdx + normOld.length)
    if (secondIdx !== -1 && !replaceAll) {
      const line1 = normFile.slice(0, firstIdx).split('\n').length
      const line2 = normFile.slice(0, secondIdx).split('\n').length
      return {
        ok: false,
        error: `目标片段在文件中出现了多次（例如第 ${line1} 行与第 ${line2} 行）。请在 oldText 中多包含上下 2~3 行上下文以确保唯一匹配，或传 replaceAll: true。`
      }
    }

    const matchLine = normFile.slice(0, firstIdx).split('\n').length
    let replacedCount = 1
    let nextNorm: string
    if (replaceAll) {
      const parts = normFile.split(normOld)
      replacedCount = parts.length - 1
      nextNorm = parts.join(normNew)
    } else {
      nextNorm =
        normFile.slice(0, firstIdx) + normNew + normFile.slice(firstIdx + normOld.length)
    }

    return {
      ok: true,
      updatedContent: usesCrLf ? nextNorm.replace(/\n/g, '\r\n') : nextNorm,
      matchLine,
      replacedCount
    }
  }

  // Tier 3: Line-by-line right-trimmed fuzzy match
  const fileLines = normFile.split('\n')
  const oldLines = normOld.split('\n')
  while (oldLines.length > 0 && oldLines[oldLines.length - 1].trim() === '') {
    oldLines.pop()
  }

  if (oldLines.length > 0 && oldLines.length <= fileLines.length) {
    const candidateStarts: number[] = []
    for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
      let allMatch = true
      for (let j = 0; j < oldLines.length; j++) {
        if (fileLines[i + j].trimEnd() !== oldLines[j].trimEnd()) {
          allMatch = false
          break
        }
      }
      if (allMatch) candidateStarts.push(i)
    }

    if (candidateStarts.length === 1) {
      const startIdx = candidateStarts[0]
      const updatedLines = [
        ...fileLines.slice(0, startIdx),
        ...normNew.split('\n'),
        ...fileLines.slice(startIdx + oldLines.length)
      ]
      const joined = updatedLines.join('\n')
      return {
        ok: true,
        updatedContent: usesCrLf ? joined.replace(/\n/g, '\r\n') : joined,
        matchLine: startIdx + 1,
        replacedCount: 1
      }
    } else if (candidateStarts.length > 1) {
      return {
        ok: false,
        error: `缩进容错匹配命中了 ${candidateStarts.length} 处相似代码块（第 ${candidateStarts.map((n) => n + 1).join(', ')} 行），请增加更多上下文行以精确定位。`
      }
    }
  }

  return {
    ok: false,
    error:
      '未能在文件中匹配到 oldText。请先调用 read_code_file 确认最新文件内容与准确上下文后再编辑。'
  }
}

/**
 * Cross-platform Shell Executor (Windows PowerShell UTF-8 & macOS/Linux Login Shell)
 * Zero external CLI dependencies — works out-of-the-box inside Electron on Windows & macOS!
 */
export async function runCrossPlatformCommand(params: {
  command: string
  cwd: string
  timeoutMs?: number
}): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const { command, cwd, timeoutMs = 45000 } = params
  const isWin = process.platform === 'win32'

  // Enrich PATH for macOS/Linux GUI apps launched from Finder/Dock
  const env = { ...process.env }
  if (!isWin) {
    const extraPaths = [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      path.join(os.homedir(), '.cargo/bin'),
      path.join(os.homedir(), '.local/bin')
    ]
    // Also discover latest nvm node bin if user has nvm
    const nvmVersionsDir = path.join(os.homedir(), '.nvm/versions/node')
    try {
      if (fs.existsSync(nvmVersionsDir)) {
        const vers = fs.readdirSync(nvmVersionsDir).sort()
        if (vers.length > 0) {
          extraPaths.unshift(path.join(nvmVersionsDir, vers[vers.length - 1], 'bin'))
        }
      }
    } catch {
      // ignore
    }
    const curPath = env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'
    env.PATH = Array.from(new Set([...extraPaths, ...curPath.split(':')])).join(':')
  }

  return await new Promise((resolve) => {
    let shellCmd: string
    let shellArgs: string[]

    if (isWin) {
      shellCmd = 'powershell.exe'
      shellArgs = [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`
      ]
    } else {
      shellCmd = fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash'
      shellArgs = ['-lc', command]
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const child = spawn(shellCmd, shellArgs, {
      cwd,
      env,
      windowsHide: true
    })

    let killTimer: NodeJS.Timeout | null = null
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGTERM')
        killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {}
        }, 1500)
      } catch {}
    }, Math.min(120000, Math.max(3000, timeoutMs)))

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 180_000) {
        stdout += chunk.toString('utf-8')
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 120_000) {
        stderr += chunk.toString('utf-8')
      }
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${err.message}`.trim(), timedOut })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      resolve({ exitCode: code, stdout, stderr, timedOut })
    })
  })
}

function smartTruncateOutput(raw: string, maxChars = 10000): string {
  const cleaned = raw.trim()
  if (cleaned.length <= maxChars) return cleaned
  const head = Math.floor(maxChars * 0.38)
  const tail = maxChars - head
  const omitted = cleaned.length - maxChars
  return `${cleaned.slice(0, head)}\n\n... [已智能折叠中间 ${omitted.toLocaleString()} 字符输出，保留尾部最新日志] ...\n\n${cleaned.slice(cleaned.length - tail)}`
}

/**
 * Pi / Claude Code / Codex style Coding Tool Suite
 */
export const DIA_CODING_HARNESS_TOOLS: HarnessToolDefinition[] = [
  {
    name: 'workspace_overview',
    description:
      '查看当前绑定的本地代码工作区目录结构、package.json 脚本信息与 Git 状态概览。开始编码或探索陌生仓库时优先调用。',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'find_files',
    description:
      '在代码工作区中高速搜索文件路径（自动忽略 node_modules / .git / 构建产物，兼容 Windows 与 macOS）。支持关键词或通配符如 "*.tsx"、"auth"、"src/components/*"。',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: '文件名关键词或 glob 模式（留空则返回前 120 个源码文件列表）'
        }
      }
    }
  },
  {
    name: 'grep_code',
    description:
      '在代码工作区的所有源码文件中搜索正则表达式或精确关键字，返回匹配的文件路径、行号与代码片段。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '要检索的代码标识符、字符串或正则表达式'
        },
        filePattern: {
          type: 'string',
          description: '可选文件过滤模式，如 "*.ts" 或 "src/renderer/*"'
        },
        caseSensitive: {
          type: 'boolean',
          description: '是否区分大小写，默认 false'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'read_code_file',
    description:
      '按行号读取工作区内的源码文件。编辑任何文件前请先调用此工具查看准确上下文！支持通过 startLine / endLine 分段阅读大文件。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对于工作区根目录的文件路径（如 "src/App.tsx"）'
        },
        startLine: {
          type: 'number',
          description: '起始行号（从 1 开始，默认 1）'
        },
        endLine: {
          type: 'number',
          description: '结束行号（包含，默认读取 350 行）'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'edit_code_file',
    description:
      '对现有源码文件执行精准局部替换补丁（自动兼容 Windows CRLF 与 macOS LF 换行符，并返回 Unified Diff）。请在 oldText 中包含足够的唯一上下文。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对于工作区根目录的文件路径'
        },
        oldText: {
          type: 'string',
          description: '要被替换的原文件中的精确代码片段（含缩进）'
        },
        newText: {
          type: 'string',
          description: '替换后的新代码片段'
        },
        replaceAll: {
          type: 'boolean',
          description: '是否替换文件中所有相同匹配项，默认 false'
        }
      },
      required: ['path', 'oldText', 'newText']
    }
  },
  {
    name: 'write_code_file',
    description:
      '在工作区内创建新源码文件或完整覆写文件（自动递归创建父级文件夹）。若修改已有大文件请优先使用 edit_code_file。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对于工作区根目录的文件路径'
        },
        content: {
          type: 'string',
          description: '完整文件内容'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'run_terminal_command',
    description:
      '在代码工作区根目录下执行终端命令（Windows 自动使用 UTF-8 PowerShell，macOS/Linux 自动使用 zsh/bash）。用于运行构建、typecheck、单元测试、git diff/status 或包管理命令。请勿运行阻塞不退出的守护进程。',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的命令行字符串'
        },
        timeoutSeconds: {
          type: 'number',
          description: '超时秒数，默认 45 秒（最大 120 秒）'
        }
      },
      required: ['command']
    }
  }
]

export async function executeCodingHarnessTool(
  workspaceRoot: string,
  toolName: string,
  args: Record<string, any>
): Promise<HarnessExecutionResult & { detailPreview?: string }> {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
    return {
      ok: false,
      summary: '工作区不存在',
      output: `绑定的本地代码目录不存在或无法访问: ${workspaceRoot}`
    }
  }

  if (toolName === 'workspace_overview') {
    const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true })
    const topItems = entries
      .filter((e) => e.name !== '.git')
      .slice(0, 60)
      .map((e) => (e.isDirectory() ? `📁 ${e.name}/` : `📄 ${e.name}`))

    const sections: string[] = [
      `工作区路径: ${workspaceRoot}`,
      `操作系统: ${process.platform} (${os.arch()})`,
      `顶层目录结构 (${topItems.length} 项):\n${topItems.join('\n')}`
    ]

    const pkgPath = path.join(workspaceRoot, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        const scripts = pkg.scripts ? Object.entries(pkg.scripts).map(([k, v]) => `  ${k}: ${v}`).join('\n') : '  (无)'
        sections.push(`package.json (${pkg.name || 'unnamed'}):\nScripts:\n${scripts}`)
      } catch {
        // ignore
      }
    }

    const gitRes = await runCrossPlatformCommand({
      command: 'git status --short --branch',
      cwd: workspaceRoot,
      timeoutMs: 5000
    })
    if (gitRes.exitCode === 0 && gitRes.stdout.trim()) {
      sections.push(`Git 状态:\n${gitRes.stdout.trim().slice(0, 1500)}`)
    }

    return {
      ok: true,
      summary: `${path.basename(workspaceRoot)} (${topItems.length} 项)`,
      output: sections.join('\n\n')
    }
  }

  if (toolName === 'find_files') {
    const allFiles = walkWorkspaceFiles(workspaceRoot, 3000)
    const rawPattern = String(args?.pattern || '').trim()
    let matched = allFiles

    if (rawPattern) {
      if (rawPattern.includes('*') || rawPattern.includes('?')) {
        const re = globToRegExp(rawPattern)
        matched = allFiles.filter((f) => re.test(f) || re.test(path.posix.basename(f)))
      } else {
        const lower = rawPattern.toLowerCase().replace(/\\/g, '/')
        matched = allFiles.filter((f) => f.toLowerCase().includes(lower))
      }
    }

    const capped = matched.slice(0, 140)
    return {
      ok: true,
      summary: `找到 ${matched.length} 个文件`,
      output:
        capped.length > 0
          ? `共匹配 ${matched.length} 个文件${matched.length > 140 ? '（展示前 140 个）' : ''}:\n${capped.join('\n')}`
          : `未找到匹配 "${rawPattern}" 的文件。`
    }
  }

  if (toolName === 'grep_code') {
    const query = String(args?.query || '').trim()
    if (!query) {
      return { ok: false, summary: '缺少关键词', output: 'query 不能为空' }
    }
    const filePattern = String(args?.filePattern || '').trim()
    const caseSensitive = Boolean(args?.caseSensitive)

    let regex: RegExp
    try {
      regex = new RegExp(query, caseSensitive ? '' : 'i')
    } catch {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      regex = new RegExp(escaped, caseSensitive ? '' : 'i')
    }

    let files = walkWorkspaceFiles(workspaceRoot, 2500)
    if (filePattern) {
      const fileRe = globToRegExp(filePattern)
      files = files.filter((f) => fileRe.test(f) || fileRe.test(path.posix.basename(f)))
    }

    const hits: string[] = []
    for (const rel of files) {
      if (hits.length >= 85) break
      const full = path.join(workspaceRoot, rel)
      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
        if (stat.size > 1_200_000) continue
        const content = fs.readFileSync(full, 'utf-8')
        if (content.includes('\0')) continue
        const lines = content.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 220)}`)
            if (hits.length >= 85) break
          }
        }
      } catch {
        continue
      }
    }

    return {
      ok: true,
      summary: `命中 ${hits.length}${hits.length >= 85 ? '+' : ''} 处代码`,
      output:
        hits.length > 0
          ? hits.join('\n')
          : `在工作区中未检索到 "${query}"。`
    }
  }

  if (toolName === 'read_code_file') {
    const check = resolveSafeWorkspacePath(workspaceRoot, String(args?.path || ''))
    if (!check.ok) {
      return { ok: false, summary: '路径越界拦截', output: check.error }
    }
    if (!fs.existsSync(check.absPath) || !fs.statSync(check.absPath).isFile()) {
      return { ok: false, summary: '文件不存在', output: `文件不存在: ${check.relPath}` }
    }

    try {
      const raw = fs.readFileSync(check.absPath, 'utf-8')
      if (raw.includes('\0')) {
        return { ok: false, summary: '二进制文件', output: `${check.relPath} 是二进制文件，无法作为文本读取。` }
      }
      const lines = raw.split(/\r?\n/)
      const total = lines.length
      const start = Math.max(1, Number(args?.startLine) || 1)
      const end = Math.min(total, Number(args?.endLine) || start + 349)
      const numbered = lines
        .slice(start - 1, end)
        .map((line, idx) => `${String(start + idx).padStart(4, ' ')} | ${line}`)
        .join('\n')

      return {
        ok: true,
        summary: `${check.relPath} (L${start}-${end}/${total})`,
        output: `文件: ${check.relPath} (显示第 ${start}~${end} 行，共 ${total} 行)\n${numbered}`
      }
    } catch (err: any) {
      return { ok: false, summary: '读取失败', output: err?.message || '读取文件失败' }
    }
  }

  if (toolName === 'edit_code_file') {
    const check = resolveSafeWorkspacePath(workspaceRoot, String(args?.path || ''))
    if (!check.ok) {
      return { ok: false, summary: '路径越界拦截', output: check.error }
    }
    if (!fs.existsSync(check.absPath) || !fs.statSync(check.absPath).isFile()) {
      return {
        ok: false,
        summary: '文件不存在',
        output: `文件不存在: ${check.relPath}（新建文件请调用 write_code_file）`
      }
    }

    try {
      const current = fs.readFileSync(check.absPath, 'utf-8')
      const editRes = applySurgicalEdit(
        current,
        String(args?.oldText ?? ''),
        String(args?.newText ?? ''),
        Boolean(args?.replaceAll)
      )
      if (!editRes.ok) {
        return { ok: false, summary: '补丁未命中', output: editRes.error }
      }

      await fs.promises.writeFile(check.absPath, editRes.updatedContent, 'utf-8')
      const diff = buildCompactUnifiedDiff(
        check.relPath,
        String(args?.oldText ?? '').replace(/\r\n/g, '\n'),
        String(args?.newText ?? '').replace(/\r\n/g, '\n'),
        editRes.matchLine
      )

      return {
        ok: true,
        summary: `${check.relPath} (${diff.summary})`,
        output: `已成功更新 ${check.relPath}（第 ${editRes.matchLine} 行起，共替换 ${editRes.replacedCount} 处）：\n${diff.diffText}`,
        detailPreview: diff.diffText
      }
    } catch (err: any) {
      return { ok: false, summary: '写入失败', output: err?.message || '编辑文件失败' }
    }
  }

  if (toolName === 'write_code_file') {
    const check = resolveSafeWorkspacePath(workspaceRoot, String(args?.path || ''))
    if (!check.ok) {
      return { ok: false, summary: '路径越界拦截', output: check.error }
    }

    try {
      const existed = fs.existsSync(check.absPath)
      const content = String(args?.content ?? '')
      await fs.promises.mkdir(path.dirname(check.absPath), { recursive: true })
      await fs.promises.writeFile(check.absPath, content, 'utf-8')
      const lineCount = content.split(/\r?\n/).length
      return {
        ok: true,
        summary: `${existed ? '覆写' : '新建'} ${check.relPath} (${lineCount} 行)`,
        output: `已成功${existed ? '覆写' : '创建'}文件 ${check.relPath}（共 ${lineCount} 行，${content.length} 字符）。`,
        detailPreview: content.split(/\r?\n/).slice(0, 24).map((l) => `+ ${l}`).join('\n')
      }
    } catch (err: any) {
      return { ok: false, summary: '写入失败', output: err?.message || '写入文件失败' }
    }
  }

  if (toolName === 'run_terminal_command') {
    const cmd = String(args?.command || '').trim()
    if (!cmd) {
      return { ok: false, summary: '命令为空', output: 'command 不能为空' }
    }
    if (DANGEROUS_COMMAND_PATTERNS.some((re) => re.test(cmd))) {
      return {
        ok: false,
        summary: '高危命令已拦截',
        output: `安全护栏已阻止执行高危系统破坏性命令: ${cmd}`
      }
    }

    const timeoutSec = Math.min(120, Math.max(5, Number(args?.timeoutSeconds) || 45))
    const res = await runCrossPlatformCommand({
      command: cmd,
      cwd: workspaceRoot,
      timeoutMs: timeoutSec * 1000
    })

    const combined = [
      res.stdout ? `[STDOUT]\n${res.stdout.trim()}` : '',
      res.stderr ? `[STDERR]\n${res.stderr.trim()}` : ''
    ]
      .filter(Boolean)
      .join('\n\n')

    const truncated = smartTruncateOutput(combined || '（命令无输出）', 10000)
    const ok = !res.timedOut && res.exitCode === 0

    return {
      ok,
      summary: res.timedOut
        ? `超时 (${timeoutSec}s)`
        : `exit ${res.exitCode ?? 0}`,
      output: `工作目录: ${workspaceRoot}\n命令: ${cmd}\n退出码: ${res.exitCode}${res.timedOut ? ' (执行超时已终止)' : ''}\n\n${truncated}`,
      detailPreview: `$ ${cmd}\n${truncated.slice(0, 1200)}`
    }
  }

  return { ok: false, summary: '未知编码工具', output: `未知工具: ${toolName}` }
}
