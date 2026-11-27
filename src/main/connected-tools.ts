import { BrowserWindow, session, type Cookie } from 'electron'
import path from 'path'
import type {
  AppSettings,
  ConnectedToolId,
  ConnectedToolItem,
  ConnectedToolStatus,
  HistoryItem,
  TabState
} from '@shared/types'
import { extractTabContent } from './dom-extractor'
import { waitForWebContentsSettle } from './browser-harness'

export interface ConnectedToolSpec {
  id: ConnectedToolId
  name: string
  description: string
  descriptionZh: string
  homeUrl: string
  loginUrl: string
  hostPatterns: RegExp[]
  buildQueryUrl?: (query: string, dynamicBaseUrl?: string) => string
}

export const CONNECTED_TOOL_SPECS: ConnectedToolSpec[] = [
  {
    id: 'amplitude',
    name: 'Amplitude',
    description: 'Product analytics dashboards, charts, cohorts, and experiment metrics',
    descriptionZh: '产品数据分析看板、图表指标、留存漏斗与实验数据',
    homeUrl: 'https://app.amplitude.com',
    loginUrl: 'https://app.amplitude.com/login',
    hostPatterns: [/(^|\.)amplitude\.com$/i],
    buildQueryUrl: (q) =>
      q
        ? `https://app.amplitude.com/analytics/search?query=${encodeURIComponent(q)}`
        : 'https://app.amplitude.com'
  },
  {
    id: 'atlassian',
    name: 'Atlassian',
    description: 'Jira issues, sprints, and Confluence workspace pages',
    descriptionZh: 'Jira 任务单、迭代看板与 Confluence 团队知识库文档',
    homeUrl: 'https://start.atlassian.com',
    loginUrl: 'https://id.atlassian.com/login',
    hostPatterns: [/(^|\.)atlassian\.(net|com)$/i],
    buildQueryUrl: (q, dynamicBase) => {
      if (dynamicBase && q) {
        return `${dynamicBase.replace(/\/+$/, '')}/wiki/search?text=${encodeURIComponent(q)}`
      }
      return dynamicBase || 'https://start.atlassian.com'
    }
  },
  {
    id: 'figma',
    name: 'Figma — Advanced Tools',
    description: 'Recent design files, FigJam boards, comments, and component specs',
    descriptionZh: '最近浏览的设计稿、FigJam 白板、评论与组件规范',
    homeUrl: 'https://www.figma.com/files/recent',
    loginUrl: 'https://www.figma.com/login',
    hostPatterns: [/(^|\.)figma\.com$/i],
    buildQueryUrl: (q) =>
      q
        ? `https://www.figma.com/files/search?model_type=files&q=${encodeURIComponent(q)}`
        : 'https://www.figma.com/files/recent'
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Pull requests, issues, notifications, code search, and repositories',
    descriptionZh: 'Pull Requests、Issues、通知动态与代码仓库上下文',
    homeUrl: 'https://github.com/pulls',
    loginUrl: 'https://github.com/login',
    hostPatterns: [/(^|\.)github\.com$/i],
    buildQueryUrl: (q) => {
      const lower = q.toLowerCase()
      if (!q) return 'https://github.com/pulls'
      if (lower.includes('notif') || q.includes('通知')) return 'https://github.com/notifications'
      if (lower.includes('issue') || q.includes('问题') || q.includes('工单')) {
        return 'https://github.com/issues'
      }
      if (lower.includes('pr') || lower.includes('pull') || q.includes('合并')) {
        return 'https://github.com/pulls'
      }
      return `https://github.com/search?q=${encodeURIComponent(q)}&type=pullrequests`
    }
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Unread inbox threads, email search, senders, and message summaries',
    descriptionZh: '收件箱未读邮件、条件检索、发件人摘要与往来记录',
    homeUrl: 'https://mail.google.com/mail/u/0/#inbox',
    loginUrl: 'https://accounts.google.com/ServiceLogin?service=mail&continue=https://mail.google.com/mail/',
    hostPatterns: [/^mail\.google\.com$/i],
    buildQueryUrl: (q) =>
      q
        ? `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}`
        : 'https://mail.google.com/mail/u/0/#inbox'
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Upcoming schedule, today’s agenda, meeting links, and attendees',
    descriptionZh: '今日议程、近期会议安排、参会人与会议链接',
    homeUrl: 'https://calendar.google.com/calendar/u/0/r/agenda',
    loginUrl:
      'https://accounts.google.com/ServiceLogin?service=cl&continue=https://calendar.google.com/calendar/r',
    hostPatterns: [/^calendar\.google\.com$/i],
    buildQueryUrl: (q) =>
      q
        ? `https://calendar.google.com/calendar/u/0/r/search?q=${encodeURIComponent(q)}`
        : 'https://calendar.google.com/calendar/u/0/r/agenda'
  },
  {
    id: 'google-chat',
    name: 'Google Chat',
    description: 'Direct messages, team spaces, and recent conversation threads',
    descriptionZh: '团队聊天空间、私信与近期讨论串',
    homeUrl: 'https://mail.google.com/chat/u/0/#chat/home',
    loginUrl: 'https://chat.google.com',
    hostPatterns: [/^chat\.google\.com$/i, /^mail\.google\.com$/i],
    buildQueryUrl: (q) =>
      q
        ? `https://mail.google.com/chat/u/0/#chat/search/${encodeURIComponent(q)}`
        : 'https://mail.google.com/chat/u/0/#chat/home'
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Google Docs, Sheets, Slides, shared files, and Drive search',
    descriptionZh: 'Google Docs、Sheets、Slides 云端文档与全盘检索',
    homeUrl: 'https://drive.google.com/drive/u/0/my-drive',
    loginUrl:
      'https://accounts.google.com/ServiceLogin?service=wise&continue=https://drive.google.com/drive/my-drive',
    hostPatterns: [/^(drive|docs)\.google\.com$/i],
    buildQueryUrl: (q) =>
      q
        ? `https://drive.google.com/drive/u/0/search?q=${encodeURIComponent(q)}`
        : 'https://drive.google.com/drive/u/0/my-drive'
  },
  {
    id: 'granola',
    name: 'Granola',
    description: 'AI meeting notes, action items, and shared transcripts',
    descriptionZh: 'AI 会议纪要、待办事项与访谈记录',
    homeUrl: 'https://app.granola.ai',
    loginUrl: 'https://app.granola.ai',
    hostPatterns: [/(^|\.)granola\.(ai|so)$/i],
    buildQueryUrl: () => 'https://app.granola.ai'
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Assigned issues, active cycles, triage queue, and project roadmaps',
    descriptionZh: '指派给我的 Issue、当前迭代 Cycle 与项目路线图',
    homeUrl: 'https://linear.app',
    loginUrl: 'https://linear.app/login',
    hostPatterns: [/(^|\.)linear\.app$/i],
    buildQueryUrl: () => 'https://linear.app'
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Workspace wikis, docs, databases, and meeting notes',
    descriptionZh: '个人与团队知识库、文档、数据库与笔记页面',
    homeUrl: 'https://www.notion.so',
    loginUrl: 'https://www.notion.so/login',
    hostPatterns: [/(^|\.)notion\.so$/i],
    buildQueryUrl: () => 'https://www.notion.so'
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Workspace channels, threads, and saved messages in browser',
    descriptionZh: '工作区频道消息、讨论串与收藏内容',
    homeUrl: 'https://app.slack.com/client',
    loginUrl: 'https://slack.com/signin',
    hostPatterns: [/(^|\.)slack\.com$/i],
    buildQueryUrl: () => 'https://app.slack.com/client'
  }
]

function cleanXmlText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseGmailAtomFeed(xml: string): {
  accountEmail?: string
  fullCount: number
  entries: Array<{
    title: string
    summary: string
    authorName: string
    authorEmail: string
    issued: string
    link: string
  }>
} | null {
  if (!xml || !xml.includes('<feed')) return null
  const titleMatch = xml.match(/<feed[\s\S]*?<title>([\s\S]*?)<\/title>/i)
  const feedTitle = titleMatch ? cleanXmlText(titleMatch[1]) : ''
  const emailMatch = feedTitle.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
  const countMatch = xml.match(/<fullcount>(\d+)<\/fullcount>/i)
  const fullCount = countMatch ? Number(countMatch[1]) || 0 : 0

  const entries: Array<{
    title: string
    summary: string
    authorName: string
    authorEmail: string
    issued: string
    link: string
  }> = []

  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi
  let m: RegExpExecArray | null
  while ((m = entryRegex.exec(xml)) !== null && entries.length < 20) {
    const block = m[1]
    const t = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '(No subject)'
    const s = block.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1] || ''
    const issued = block.match(/<issued>([\s\S]*?)<\/issued>/i)?.[1] || ''
    const link = block.match(/<link[^>]+href="([^"]+)"/i)?.[1] || 'https://mail.google.com/mail/u/0/#inbox'
    const authorBlock = block.match(/<author>([\s\S]*?)<\/author>/i)?.[1] || ''
    const authorName = authorBlock.match(/<name>([\s\S]*?)<\/name>/i)?.[1] || ''
    const authorEmail = authorBlock.match(/<email>([\s\S]*?)<\/email>/i)?.[1] || ''
    entries.push({
      title: cleanXmlText(t),
      summary: cleanXmlText(s),
      authorName: cleanXmlText(authorName),
      authorEmail: cleanXmlText(authorEmail),
      issued: cleanXmlText(issued),
      link: cleanXmlText(link)
    })
  }

  return {
    accountEmail: emailMatch?.[1],
    fullCount,
    entries
  }
}

function matchesDomain(cookieDomain: string, suffix: string): boolean {
  const normalized = cookieDomain.replace(/^\.+/, '').toLowerCase()
  return normalized === suffix || normalized.endsWith(`.${suffix}`)
}

function detectToolAuthFromCookies(
  toolId: ConnectedToolId,
  cookies: Cookie[],
  history: HistoryItem[]
): { isLoggedIn: boolean; accountHint?: string; dynamicBaseUrl?: string } {
  const nowSec = Date.now() / 1000
  const validCookies = cookies.filter(
    (c) => Boolean(c.value) && (!c.expirationDate || c.expirationDate > nowSec)
  )

  const findCookie = (domainSuffix: string, names: string[]): Cookie | undefined =>
    validCookies.find(
      (c) => matchesDomain(c.domain || '', domainSuffix) && names.includes(c.name)
    )

  const findCookieMatching = (domainSuffix: string, nameRe: RegExp): Cookie | undefined =>
    validCookies.find(
      (c) => matchesDomain(c.domain || '', domainSuffix) && nameRe.test(c.name)
    )

  if (
    toolId === 'gmail' ||
    toolId === 'google-calendar' ||
    toolId === 'google-chat' ||
    toolId === 'google-drive'
  ) {
    const hasPrimary = Boolean(
      findCookie('google.com', ['SAPISID', '__Secure-1PSID', '__Secure-3PSID'])
    )
    const hasSecondary = Boolean(
      findCookie('google.com', ['SID', 'HSID', 'SSID', '__Secure-1PAPISID'])
    )
    return {
      isLoggedIn: hasPrimary && hasSecondary
    }
  }

  if (toolId === 'github') {
    const loggedInCookie = findCookie('github.com', ['logged_in'])
    const userSession = findCookie('github.com', ['user_session', '__Host-user_session_same_site'])
    const dotcomUser = findCookie('github.com', ['dotcom_user'])
    const isLoggedIn = Boolean(userSession || loggedInCookie?.value === 'yes')
    return {
      isLoggedIn,
      accountHint:
        isLoggedIn && dotcomUser?.value ? `@${decodeURIComponent(dotcomUser.value)}` : undefined
    }
  }

  if (toolId === 'figma') {
    const auth = findCookieMatching('figma.com', /^(__Host-)?figma\.(authn|session|mst)/i)
    const uid = findCookie('figma.com', ['figma.uid'])
    return { isLoggedIn: Boolean(auth || uid) }
  }

  if (toolId === 'atlassian') {
    const cloudToken =
      findCookie('atlassian.com', ['cloud.session.token']) ||
      findCookie('atlassian.net', ['cloud.session.token', 'tenant.session.token'])
    const atlassianNetHist = history.find((h) => {
      try {
        const u = new URL(h.url)
        return u.hostname.endsWith('.atlassian.net')
      } catch {
        return false
      }
    })
    let dynamicBaseUrl: string | undefined
    let accountHint: string | undefined
    if (atlassianNetHist) {
      try {
        const u = new URL(atlassianNetHist.url)
        dynamicBaseUrl = `${u.protocol}//${u.hostname}`
        accountHint = u.hostname
      } catch {
        // ignore
      }
    } else {
      const tenantCookie = validCookies.find((c) =>
        (c.domain || '').toLowerCase().endsWith('.atlassian.net')
      )
      if (tenantCookie?.domain) {
        const host = tenantCookie.domain.replace(/^\.+/, '')
        dynamicBaseUrl = `https://${host}`
        accountHint = host
      }
    }
    return {
      isLoggedIn: Boolean(cloudToken),
      accountHint,
      dynamicBaseUrl
    }
  }

  if (toolId === 'amplitude') {
    const ampAuth = findCookieMatching(
      'amplitude.com',
      /(org_login|access_token|amp_session|amplitude_session|authn)/i
    )
    return { isLoggedIn: Boolean(ampAuth) }
  }

  if (toolId === 'granola') {
    const granAuth =
      findCookieMatching('granola.ai', /(session|token|auth|wos|sb-)/i) ||
      findCookieMatching('granola.so', /(session|token|auth|wos|sb-)/i)
    return { isLoggedIn: Boolean(granAuth) }
  }

  if (toolId === 'linear') {
    const linAuth = findCookieMatching('linear.app', /^(lnr_|session|actor|auth)/i)
    return { isLoggedIn: Boolean(linAuth) }
  }

  if (toolId === 'notion') {
    const notionToken = findCookie('notion.so', ['token_v2'])
    return { isLoggedIn: Boolean(notionToken) }
  }

  if (toolId === 'slack') {
    const slackD = findCookie('slack.com', ['d'])
    return { isLoggedIn: Boolean(slackD) }
  }

  return { isLoggedIn: false }
}

export function computeEffectiveToolStatus(
  toolId: ConnectedToolId,
  isLoggedIn: boolean,
  settings: AppSettings
): ConnectedToolStatus {
  const disconnected = new Set(settings.manuallyDisconnectedTools || [])
  const manualConnected = new Set(settings.manuallyConnectedTools || [])
  const autoConnect = settings.autoConnectLoggedInApps !== false

  if (disconnected.has(toolId)) {
    return 'disconnected'
  }
  if (manualConnected.has(toolId) && isLoggedIn) {
    return 'connected'
  }
  if (autoConnect && isLoggedIn) {
    return 'auto-connected'
  }
  if (manualConnected.has(toolId)) {
    return 'connected'
  }
  return 'disconnected'
}

export async function inspectConnectedToolsForPartition(params: {
  partition: string
  settings: AppSettings
  profileHistory: HistoryItem[]
}): Promise<ConnectedToolItem[]> {
  const { partition, settings, profileHistory } = params
  let cookies: Cookie[] = []
  try {
    const ses = session.fromPartition(partition)
    cookies = await ses.cookies.get({})
  } catch {
    cookies = []
  }

  return CONNECTED_TOOL_SPECS.map((spec) => {
    const auth = detectToolAuthFromCookies(spec.id, cookies, profileHistory)
    const status = computeEffectiveToolStatus(spec.id, auth.isLoggedIn, settings)
    return {
      id: spec.id,
      name: spec.name,
      description: spec.description,
      descriptionZh: spec.descriptionZh,
      homeUrl: auth.dynamicBaseUrl || spec.homeUrl,
      loginUrl: spec.loginUrl,
      isLoggedIn: auth.isLoggedIn,
      status,
      accountHint: auth.accountHint
    }
  })
}

export function getConnectedToolSpec(toolId: string): ConnectedToolSpec | undefined {
  return CONNECTED_TOOL_SPECS.find((s) => s.id === toolId)
}

/**
 * Zero-OAuth Connected Tool Context Reader:
 * Uses the user's existing Chromium partition session to read live context from connected apps
 * without requiring third-party OAuth Client IDs or developer API keys.
 */
export async function fetchConnectedToolContext(params: {
  toolId: ConnectedToolId
  query?: string
  partition: string
  userAgent?: string
  settings: AppSettings
  openTabs: TabState[]
  profileHistory: HistoryItem[]
  extractOpenTab: (tabId: string) => Promise<{ title: string; url: string; content: string } | null>
}): Promise<{
  ok: boolean
  title: string
  url: string
  content: string
  summary: string
}> {
  const {
    toolId,
    query = '',
    partition,
    userAgent,
    settings,
    openTabs,
    profileHistory,
    extractOpenTab
  } = params

  const spec = getConnectedToolSpec(toolId)
  if (!spec) {
    return {
      ok: false,
      title: toolId,
      url: '',
      content: `Unknown tool ID: ${toolId}`,
      summary: 'Unknown tool'
    }
  }

  const tools = await inspectConnectedToolsForPartition({
    partition,
    settings,
    profileHistory
  })
  const current = tools.find((t) => t.id === toolId)
  if (!current || current.status === 'disconnected') {
    return {
      ok: false,
      title: spec.name,
      url: spec.homeUrl,
      content: `Tool "${spec.name}" is currently disconnected. Please ask the user to connect or enable "${spec.name}" in "Connect your Tools" first.`,
      summary: `${spec.name} 未连接`
    }
  }

  const trimmedQuery = query.trim()

  // 1) Fast path for Gmail inbox summary: read Gmail Atom Feed directly via partition session cookies (~200ms!)
  if (toolId === 'gmail' && !trimmedQuery) {
    try {
      const ses = session.fromPartition(partition)
      const resp = await ses.fetch('https://mail.google.com/mail/feed/atom', {
        method: 'GET',
        credentials: 'include',
        headers: userAgent ? { 'User-Agent': userAgent } : undefined
      })
      if (resp.ok) {
        const xml = await resp.text()
        const parsed = parseGmailAtomFeed(xml)
        if (parsed) {
          const lines: string[] = [
            `# Gmail Inbox${parsed.accountEmail ? ` (${parsed.accountEmail})` : ''}`,
            `Unread count: ${parsed.fullCount}`,
            ''
          ]
          if (parsed.entries.length === 0) {
            lines.push('No unread messages in primary inbox.')
          } else {
            parsed.entries.forEach((entry, idx) => {
              const from = entry.authorEmail
                ? `${entry.authorName || entry.authorEmail} <${entry.authorEmail}>`
                : entry.authorName || 'Unknown sender'
              lines.push(
                `### ${idx + 1}. ${entry.title}`,
                `- **From**: ${from}`,
                `- **Time**: ${entry.issued}`,
                `- **Link**: ${entry.link}`,
                entry.summary ? `- **Snippet**: ${entry.summary}` : '',
                ''
              )
            })
          }
          return {
            ok: true,
            title: `Gmail${parsed.accountEmail ? ` (${parsed.accountEmail})` : ''}`,
            url: 'https://mail.google.com/mail/u/0/#inbox',
            content: lines.filter(Boolean).join('\n'),
            summary: `Gmail 未读 ${parsed.fullCount} 封（提取 ${parsed.entries.length} 封摘要）`
          }
        }
      }
    } catch {
      // Fallback to open tab or headless reader below
    }
  }

  // 2) Check if there is already an open tab matching this tool in the active Space!
  if (!trimmedQuery) {
    const matchingOpenTabs = openTabs.filter((t) => {
      try {
        const u = new URL(t.url)
        if (toolId === 'google-chat') {
          return (
            u.hostname === 'chat.google.com' ||
            (u.hostname === 'mail.google.com' && u.pathname.startsWith('/chat'))
          )
        }
        return spec.hostPatterns.some((re) => re.test(u.hostname))
      } catch {
        return false
      }
    })
    if (matchingOpenTabs.length > 0) {
      const extractedList = await Promise.all(
        matchingOpenTabs.slice(0, 3).map((t) => extractOpenTab(t.id))
      )
      const valid = extractedList.filter((item): item is NonNullable<typeof item> =>
        Boolean(item && item.content.trim())
      )
      if (valid.length > 0) {
        const combined = valid
          .map((v, i) => `## Open Tab ${i + 1}: ${v.title}\nURL: ${v.url}\n\n${v.content}`)
          .join('\n\n---\n\n')
        return {
          ok: true,
          title: `${spec.name} (${valid[0].title})`,
          url: valid[0].url,
          content: combined,
          summary: `已读取打开的 ${spec.name} 标签页 (${valid.length})`
        }
      }
    }
  }

  // 3) Silent Headless Chromium Session Reader (shares exact partition cookies, zero popup!)
  const targetUrl = spec.buildQueryUrl
    ? spec.buildQueryUrl(trimmedQuery, current.homeUrl)
    : current.homeUrl

  if (!current.isLoggedIn) {
    return {
      ok: false,
      title: spec.name,
      url: spec.loginUrl,
      content: `No active browser login session detected for ${spec.name} in the current Space. Ask the user to click "Connect" on ${spec.name} (or sign in at ${spec.loginUrl}) first.`,
      summary: `${spec.name} 尚未登录网页会话`
    }
  }

  let hiddenWin: BrowserWindow | null = null
  try {
    hiddenWin = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition,
        preload: path.join(__dirname, '../preload/web-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    hiddenWin.webContents.setAudioMuted(true)
    if (userAgent) {
      hiddenWin.webContents.setUserAgent(userAgent)
    }

    let loadTimer: NodeJS.Timeout | null = null
    try {
      await Promise.race([
        hiddenWin.loadURL(targetUrl).catch(() => {}),
        new Promise<void>((resolve) => {
          loadTimer = setTimeout(resolve, 9500)
        })
      ])
    } finally {
      if (loadTimer) clearTimeout(loadTimer)
    }

    await waitForWebContentsSettle(hiddenWin.webContents, 4200, 650)

    const finalUrl = hiddenWin.webContents.getURL() || targetUrl
    const finalTitle = hiddenWin.webContents.getTitle() || spec.name
    const extracted = await extractTabContent(
      `tool-${toolId}`,
      finalUrl,
      finalTitle,
      hiddenWin.webContents,
      settings.sensitiveSiteGuard
    )

    if (!extracted.content.trim()) {
      return {
        ok: false,
        title: finalTitle,
        url: finalUrl,
        content: `Loaded ${finalUrl} (${finalTitle}), but no readable text was extracted yet (the SPA may require interactive view or login refresh). You may call open_or_navigate_tab with target="split-right" and urlOrQuery="${targetUrl}" to view and interact with ${spec.name} directly.`,
        summary: `${spec.name} 后台读取为空（可改用分屏打开）`
      }
    }

    return {
      ok: true,
      title: `${spec.name} · ${extracted.title}`,
      url: finalUrl,
      content: extracted.content,
      summary: `已读取 ${spec.name} 上下文 (${extracted.wordCount} 字)`
    }
  } catch (err: any) {
    return {
      ok: false,
      title: spec.name,
      url: targetUrl,
      content: `Failed reading ${spec.name} (${targetUrl}): ${err?.message || 'unknown error'}`,
      summary: `读取 ${spec.name} 失败`
    }
  } finally {
    if (hiddenWin && !hiddenWin.isDestroyed()) {
      try {
        hiddenWin.destroy()
      } catch {
        // ignore
      }
    }
  }
}
