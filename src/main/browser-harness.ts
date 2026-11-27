import type { WebContents } from 'electron'
import { isSensitiveUrl } from '@shared/constants'

const ISOLATED_WORLD_ID = 999

export interface HarnessToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface HarnessExecutionResult {
  ok: boolean
  output: string
  summary: string
  detailPreview?: string
  imageDataUrl?: string
  newReferencedUrl?: { title: string; url: string }
}

export type HarnessToolExecutor = (
  toolName: string,
  args: Record<string, any>
) => Promise<HarnessExecutionResult>

/**
 * Standard JSON-Schema Tool Specifications (compatible with OpenAI Function Calling,
 * Anthropic Tool Use, Vercel AI SDK, and MCP Tool definitions).
 */
export const DIA_BROWSER_HARNESS_TOOLS: HarnessToolDefinition[] = [
  {
    name: 'list_open_tabs',
    description:
      '列出当前浏览器工作空间中已打开的所有标签页（含 tabId、标题、URL、激活状态、固定/常驻状态、所属分组及左右分屏位置）。在切换、关闭、分组或跨标签读取前可先调用。',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'read_tab_content',
    description:
      '按 tabId 深度提取指定浏览器标签页的结构化 Markdown 正文、标题大纲与当前高亮选区文本。',
    parameters: {
      type: 'object',
      properties: {
        tabId: {
          type: 'string',
          description: '目标标签页 ID（可通过 list_open_tabs 获取，留空则自动读取当前网页或并排网页）'
        }
      }
    }
  },
  {
    name: 'inspect_page_elements',
    description:
      '扫描网页上的可交互元素快照（输入框、搜索框、按钮、下拉菜单、复选框、Tab、链接，穿透开放 Shadow DOM），返回确定性编号如 [e1]..[e95] 与滚动位置。在点击、悬停、填表或选择下拉项前请先调用此工具获取最新 ref 编号。支持通过 filter 关键词精准筛选密集页面中的目标元素。',
    parameters: {
      type: 'object',
      properties: {
        tabId: {
          type: 'string',
          description: '可选目标标签页 ID，留空则默认针对当前正在操作的网页标签'
        },
        filter: {
          type: 'string',
          description: '可选过滤关键词（匹配按钮文字、placeholder、aria-label、href 或标签名，适合元素极多的复杂页面）'
        },
        scope: {
          type: 'string',
          enum: ['viewport', 'full'],
          description: '扫描范围：viewport（默认，当前视口及下方近邻区）或 full（整页扫描）'
        }
      }
    }
  },
  {
    name: 'interact_with_page',
    description:
      '在网页上执行高可靠交互动作：点击 (click)、双击 (double_click)、悬停展开菜单 (hover)、填入文本 (fill)、选择下拉框选项 (select)、勾选/取消复选框或开关 (check)、发送真实键盘按键 (press_key，如 Enter/Escape/Tab/ArrowDown)、滚动页面或元素 (scroll)、或等待动态内容加载 (wait)。敏感金融/密码页面会被自动拦截。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'click',
            'double_click',
            'hover',
            'fill',
            'select',
            'check',
            'press_key',
            'scroll',
            'wait'
          ],
          description:
            '动作类型：click(点击)、double_click(双击)、hover(鼠标悬停)、fill(输入文字)、select(下拉选择)、check(勾选/切换开关)、press_key(按键)、scroll(滚动)、wait(等待元素/文本/耗时)'
        },
        ref: {
          type: 'string',
          description:
            'inspect_page_elements 返回的元素编号，如 "e1" 或 "e12"（click/double_click/hover/fill/select/check 必填；scroll/press_key 可选聚焦目标）'
        },
        value: {
          type: 'string',
          description:
            'action="fill" 时要填入的文本；action="select" 时要选中的选项值或显示文字；action="wait" 时要等待出现的文本或 CSS 选择器'
        },
        pressEnter: {
          type: 'boolean',
          description: 'action="fill" 时填入文本后是否自动按下原生 Enter 键提交（例如搜索框/聊天框）'
        },
        clearFirst: {
          type: 'boolean',
          description: 'action="fill" 时是否先清空原内容，默认 true；设为 false 则在末尾追加'
        },
        checked: {
          type: 'boolean',
          description: 'action="check" 时的目标勾选状态（留空则自动翻转当前状态）'
        },
        key: {
          type: 'string',
          description:
            'action="press_key" 时发送的按键名，如 "Enter"、"Escape"、"Tab"、"ArrowDown"、"ArrowUp"、"Backspace"、"Space"、"PageDown"'
        },
        scrollDirection: {
          type: 'string',
          enum: ['down', 'up', 'top', 'bottom'],
          description: 'action="scroll" 时的滚动方向，默认 "down"'
        },
        waitMs: {
          type: 'number',
          description: 'action="wait" 时的最长等待毫秒数（默认 1500，范围 200~8000）'
        },
        tabId: {
          type: 'string',
          description: '可选目标标签页 ID'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'extract_page_data',
    description:
      '从网页中批量提取结构化数据：全部链接列表 (links)、所有数据表格 (tables)、表单控件详情 (forms) 或按 CSS 选择器提取节点内容 (selector)。适合抓取搜索结果列表、榜单、价格表或文档导航。',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['links', 'tables', 'forms', 'selector'],
          description: '提取模式：links(页面链接)、tables(Markdown表格)、forms(表单字段)、selector(自定义CSS选择器)'
        },
        selector: {
          type: 'string',
          description: 'mode="selector" 时的 CSS 选择器，例如 "article h2, .repo-list-item"'
        },
        filter: {
          type: 'string',
          description: '可选关键词过滤（筛选包含特定文字或域名的链接/条目）'
        },
        tabId: {
          type: 'string',
          description: '可选目标标签页 ID'
        }
      },
      required: ['mode']
    }
  },
  {
    name: 'capture_page_screenshot',
    description:
      '主动截取目标网页标签页的实时高清视觉画面（多模态视觉感知）。当网页包含图表、Canvas、复杂弹窗、图片内容，或 DOM 文本不足以判断页面当前视觉状态时调用。',
    parameters: {
      type: 'object',
      properties: {
        tabId: {
          type: 'string',
          description: '可选目标标签页 ID，留空则截取当前活动网页或分屏并排网页'
        }
      }
    }
  },
  {
    name: 'open_or_navigate_tab',
    description:
      '在浏览器中打开网址或执行搜索引擎查询，支持在当前页跳转、新建前台/后台标签页，或在右侧开启并排分屏 (split-right) 供用户一边对话一边观看操作。',
    parameters: {
      type: 'object',
      properties: {
        urlOrQuery: {
          type: 'string',
          description: '完整网址（如 https://github.com/trending）或搜索关键词'
        },
        target: {
          type: 'string',
          enum: ['new-tab', 'current-tab', 'split-right', 'background-tab'],
          description:
            '打开方式：new-tab（新建标签，若当前在对话标签页会自动智能分屏展示）、current-tab（当前网页跳转）、split-right（右侧并排分屏打开）、background-tab（后台静默打开）'
        },
        tabId: {
          type: 'string',
          description: 'target="current-tab" 时可选指定要跳转的既有网页 tabId'
        }
      },
      required: ['urlOrQuery']
    }
  },
  {
    name: 'manage_tabs',
    description:
      '操控浏览器标签页与分组管理：切换到指定标签 (switch)、关闭单个/批量标签 (close)、关闭其他标签 (close_others)、清理未固定临时标签 (clear_unpinned)、恢复刚关闭标签 (reopen_closed)、复制标签 (duplicate)、固定/取消固定/设为常驻图标 (pin/unpin/favorite)、静音切换 (mute)、创建彩色标签组 (group) 或 AI 自动按主题整理分组 (organize_ai)。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'switch',
            'close',
            'close_others',
            'clear_unpinned',
            'reopen_closed',
            'duplicate',
            'pin',
            'unpin',
            'favorite',
            'mute',
            'group',
            'organize_ai'
          ],
          description: '标签管理动作'
        },
        tabId: {
          type: 'string',
          description: '单个目标标签页 ID'
        },
        tabIds: {
          type: 'array',
          items: { type: 'string' },
          description: '多个目标标签页 ID 列表（适用于批量 close 或创建 group）'
        },
        matchQuery: {
          type: 'string',
          description: '按标题或域名关键词匹配标签页（例如批量关闭包含 "bilibili" 或 "知乎" 的标签）'
        },
        groupTitle: {
          type: 'string',
          description: 'action="group" 时的分组名称（如 "🔬 论文精读"）'
        },
        groupColor: {
          type: 'string',
          enum: ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet'],
          description: 'action="group" 时的分组主题色'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'control_browser_view',
    description:
      '控制浏览器视图与导航状态：网页后退 (go_back)、前进 (go_forward)、刷新 (reload)、开启/关闭/交换左右并排分屏 (open_split/close_split/swap_split)、网页缩放 (zoom_in/zoom_out/zoom_reset) 以及页内关键词高亮查找 (find_in_page/clear_find)。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'go_back',
            'go_forward',
            'reload',
            'open_split',
            'close_split',
            'swap_split',
            'zoom_in',
            'zoom_out',
            'zoom_reset',
            'find_in_page',
            'clear_find'
          ],
          description: '浏览器视图控制动作'
        },
        tabId: {
          type: 'string',
          description: '可选目标标签页 ID（例如 open_split 时指定放到右侧并排的标签页）'
        },
        keepSide: {
          type: 'string',
          enum: ['left', 'right'],
          description: 'action="close_split" 时保留哪一侧页面'
        },
        findText: {
          type: 'string',
          description: 'action="find_in_page" 时要在页面内高亮查找的文本'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'manage_bookmarks',
    description: '查询、添加或移除用户的浏览器收藏夹书签 (Bookmarks)。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'add', 'remove'],
          description: 'list(列出/搜索书签)、add(收藏网页)、remove(移除书签)'
        },
        query: {
          type: 'string',
          description: 'action="list" 时的搜索关键词'
        },
        tabId: {
          type: 'string',
          description: 'action="add" 时可选指定要收藏的标签页 ID（留空且未填 url 则默认收藏当前网页）'
        },
        url: {
          type: 'string',
          description: 'action="add" 或 "remove" 时的目标网址'
        },
        title: {
          type: 'string',
          description: 'action="add" 时的可选书签标题'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'read_browser_console',
    description:
      '读取目标网页标签页的 DevTools 控制台报错/警告 (console.error / warn) 以及 HTTP 4xx/5xx 失败请求日志。调试本地开发服 (localhost) 或排查前端页面白屏/异常时优先调用！',
    parameters: {
      type: 'object',
      properties: {
        tabId: {
          type: 'string',
          description: '可选目标标签页 ID，留空则自动读取当前网页或并排分屏网页'
        }
      }
    }
  },
  {
    name: 'search_browsing_history',
    description: '按关键词在用户的本地浏览历史 (@History) 中进行语义与时间衰减重排检索。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '检索关键词（支持中英文）'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'save_user_memory',
    description:
      'Persistently save a user preference, background fact, active project, or writing tone into Arko Long-Term Memory (@Memory) when the user asks to remember something.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '简明扼要的记忆条目内容'
        },
        category: {
          type: 'string',
          enum: ['preference', 'project', 'tone', 'fact'],
          description: '记忆分类'
        }
      },
      required: ['content']
    }
  },
  {
    name: 'read_connected_tool',
    description:
      '读取用户在「Connect your Tools」中已连接（Connected / Auto-Connected）的常用应用实时上下文（复用当前浏览器登录会话，零配置读取收件箱未读邮件、今日日程、云端文档、PR/Issues、看板或设计稿）。仅对已连接的工具调用；若需要执行交互式写操作（如发信、建日程、评论），请配合 open_or_navigate_tab(target="split-right") 在右侧分屏中打开让用户可见确认。',
    parameters: {
      type: 'object',
      properties: {
        toolId: {
          type: 'string',
          enum: [
            'amplitude',
            'atlassian',
            'figma',
            'github',
            'gmail',
            'google-calendar',
            'google-chat',
            'google-drive',
            'granola',
            'linear',
            'notion',
            'slack'
          ],
          description: '目标已连接工具 ID（如 gmail、google-calendar、google-drive、github、atlassian、figma、linear、notion 等）'
        },
        query: {
          type: 'string',
          description: '可选搜索词或过滤条件（如邮件主题关键词、PR/文档关键词；留空则读取默认收件箱/今日议程/最近动态）'
        }
      },
      required: ['toolId']
    }
  }
]

export function formatHarnessToolLabel(
  name: string,
  args: Record<string, any>
): { label: string; argsSummary?: string } {
  switch (name) {
    case 'list_open_tabs':
      return { label: '感知已打开标签页列表' }
    case 'read_tab_content':
      return {
        label: '读取标签页深度正文',
        argsSummary: args?.tabId ? String(args.tabId) : '当前页'
      }
    case 'inspect_page_elements':
      return {
        label: '扫描网页可交互元素树',
        argsSummary: args?.filter ? `筛选 “${String(args.filter).slice(0, 20)}”` : undefined
      }
    case 'extract_page_data': {
      const modeMap: Record<string, string> = {
        links: '提取页面链接列表',
        tables: '提取网页数据表格',
        forms: '提取网页表单结构',
        selector: '按选择器提取节点'
      }
      return {
        label: modeMap[String(args?.mode)] || '提取网页结构化数据',
        argsSummary: args?.selector || args?.filter || undefined
      }
    }
    case 'capture_page_screenshot':
      return {
        label: '截取网页实时视觉画面',
        argsSummary: args?.tabId ? String(args.tabId) : '当前视口'
      }
    case 'read_browser_console':
      return { label: '检查网页 Console 与网络报错' }
    case 'read_connected_tool':
      return {
        label: `读取已连接应用 (${String(args?.toolId || 'app')})`,
        argsSummary: args?.query ? `“${String(args.query).slice(0, 24)}”` : '实时会话上下文'
      }
    case 'workspace_overview':
      return { label: '扫描本地代码仓库概览' }
    case 'find_files':
      return {
        label: '搜索工作区文件',
        argsSummary: args?.pattern ? String(args.pattern).slice(0, 32) : '全部源码'
      }
    case 'grep_code':
      return {
        label: '全局检索代码',
        argsSummary: args?.query ? `“${String(args.query).slice(0, 28)}”` : undefined
      }
    case 'read_code_file':
      return {
        label: '读取源码文件',
        argsSummary: args?.path ? String(args.path).slice(0, 40) : undefined
      }
    case 'edit_code_file':
      return {
        label: '精准修改源码 (Patch)',
        argsSummary: args?.path ? String(args.path).slice(0, 40) : undefined
      }
    case 'write_code_file':
      return {
        label: '写入源码文件',
        argsSummary: args?.path ? String(args.path).slice(0, 40) : undefined
      }
    case 'run_terminal_command':
      return {
        label: '执行终端命令',
        argsSummary: args?.command ? String(args.command).slice(0, 38) : undefined
      }
    case 'interact_with_page': {
      const act = String(args?.action || 'click')
      if (act === 'scroll') {
        const dir =
          args?.scrollDirection === 'up'
            ? '向上'
            : args?.scrollDirection === 'top'
              ? '回到顶部'
              : args?.scrollDirection === 'bottom'
                ? '直达底部'
                : '向下'
        return { label: '滚动浏览网页', argsSummary: args?.ref ? `[${args.ref}] ${dir}` : dir }
      }
      if (act === 'fill') {
        return {
          label: `填写网页输入框 [${args?.ref || '?'}]`,
          argsSummary: args?.value ? `“${String(args.value).slice(0, 24)}”` : undefined
        }
      }
      if (act === 'select') {
        return {
          label: `选择下拉选项 [${args?.ref || '?'}]`,
          argsSummary: args?.value ? `“${String(args.value).slice(0, 24)}”` : undefined
        }
      }
      if (act === 'check') {
        return {
          label: `切换勾选状态`,
          argsSummary: args?.ref ? `[${args.ref}]` : undefined
        }
      }
      if (act === 'hover') {
        return {
          label: '悬停触发网页元素',
          argsSummary: args?.ref ? `[${args.ref}]` : undefined
        }
      }
      if (act === 'double_click') {
        return {
          label: '双击网页元素',
          argsSummary: args?.ref ? `[${args.ref}]` : undefined
        }
      }
      if (act === 'press_key') {
        return {
          label: '发送键盘按键',
          argsSummary: args?.key ? String(args.key) : 'Enter'
        }
      }
      if (act === 'wait') {
        return {
          label: '等待网页内容就绪',
          argsSummary: args?.value ? String(args.value).slice(0, 24) : `${args?.waitMs || 1500}ms`
        }
      }
      return {
        label: '点击网页元素',
        argsSummary: args?.ref ? `[${args.ref}]` : undefined
      }
    }
    case 'open_or_navigate_tab': {
      const modeLabel =
        args?.target === 'split-right'
          ? '右侧分屏打开'
          : args?.target === 'current-tab'
            ? '跳转页面'
            : args?.target === 'background-tab'
              ? '后台新建标签'
              : '打开网页标签'
      return {
        label: modeLabel,
        argsSummary: args?.urlOrQuery ? String(args.urlOrQuery).slice(0, 36) : undefined
      }
    }
    case 'manage_tabs': {
      const actMap: Record<string, string> = {
        switch: '切换活动标签页',
        close: '关闭标签页',
        close_others: '关闭其他未固定标签',
        clear_unpinned: '清理临时标签页',
        reopen_closed: '恢复刚关闭的标签页',
        duplicate: '复制标签页',
        pin: '固定标签页',
        unpin: '取消固定标签页',
        favorite: '设为顶部常驻图标',
        mute: '切换标签静音',
        group: '创建彩色标签分组',
        organize_ai: 'AI 智能聚类标签分组'
      }
      return {
        label: actMap[String(args?.action)] || '管理浏览器标签',
        argsSummary:
          args?.groupTitle || args?.matchQuery || args?.tabId || undefined
      }
    }
    case 'control_browser_view': {
      const viewMap: Record<string, string> = {
        go_back: '网页后退',
        go_forward: '网页前进',
        reload: '刷新网页',
        open_split: '开启左右并排分屏',
        close_split: '退出并排分屏',
        swap_split: '交换左右分屏位置',
        zoom_in: '放大网页视图',
        zoom_out: '缩小网页视图',
        zoom_reset: '重置 100% 缩放',
        find_in_page: '页内高亮查找',
        clear_find: '清除页内查找高亮'
      }
      return {
        label: viewMap[String(args?.action)] || '控制浏览器视图',
        argsSummary: args?.findText ? `“${String(args.findText).slice(0, 22)}”` : undefined
      }
    }
    case 'manage_bookmarks': {
      const bmMap: Record<string, string> = {
        list: '检索收藏夹书签',
        add: '加入浏览器收藏夹',
        remove: '移除收藏夹书签'
      }
      return {
        label: bmMap[String(args?.action)] || '管理书签',
        argsSummary: args?.query || args?.title || args?.url?.slice(0, 30) || undefined
      }
    }
    case 'search_browsing_history':
      return {
        label: '检索浏览历史',
        argsSummary: args?.query ? `“${String(args.query).slice(0, 24)}”` : undefined
      }
    case 'save_user_memory':
      return {
        label: 'Save to Arko Memory',
        argsSummary: args?.content ? String(args.content).slice(0, 26) : undefined
      }
    default:
      return { label: `调用工具 ${name}` }
  }
}

/**
 * Waits briefly to detect if a click/enter triggered page navigation, and if loading,
 * waits up to `timeoutMs` for `did-stop-loading` so follow-up steps inspect the settled page.
 */
export async function waitForWebContentsSettle(
  webContents: WebContents | undefined,
  timeoutMs = 4200,
  initialSettleMs = 260
): Promise<void> {
  if (!webContents || webContents.isDestroyed()) return
  await new Promise((r) => setTimeout(r, initialSettleMs))
  if (webContents.isDestroyed() || !webContents.isLoading()) return

  await new Promise<void>((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        webContents.removeListener('did-stop-loading', finish)
        webContents.removeListener('did-fail-load', finish)
      } catch {
        // ignore
      }
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    webContents.once('did-stop-loading', finish)
    webContents.once('did-fail-load', finish)
  })
  // Extra micro-settle for client-side hydration
  await new Promise((r) => setTimeout(r, 180))
}

function normalizeElectronKeyCode(rawKey: string): { keyCode: string; charText?: string } {
  const trimmed = rawKey.trim()
  const lower = trimmed.toLowerCase()
  const map: Record<string, string> = {
    enter: 'Enter',
    return: 'Enter',
    esc: 'Escape',
    escape: 'Escape',
    tab: 'Tab',
    space: 'Space',
    ' ': 'Space',
    backspace: 'Backspace',
    delete: 'Delete',
    arrowdown: 'Down',
    down: 'Down',
    arrowup: 'Up',
    up: 'Up',
    arrowleft: 'Left',
    left: 'Left',
    arrowright: 'Right',
    right: 'Right',
    pagedown: 'PageDown',
    pageup: 'PageUp',
    home: 'Home',
    end: 'End'
  }
  if (map[lower]) {
    return {
      keyCode: map[lower],
      charText: map[lower] === 'Space' ? ' ' : map[lower] === 'Enter' ? '\r' : undefined
    }
  }
  if (trimmed.length === 1) {
    return { keyCode: trimmed, charText: trimmed }
  }
  return { keyCode: trimmed }
}

function sendTrustedKeyPress(webContents: WebContents, rawKey: string): void {
  if (webContents.isDestroyed()) return
  const { keyCode, charText } = normalizeElectronKeyCode(rawKey)
  try {
    webContents.focus()
    webContents.sendInputEvent({ type: 'keyDown', keyCode })
    if (charText) {
      webContents.sendInputEvent({ type: 'char', keyCode: charText })
    }
    webContents.sendInputEvent({ type: 'keyUp', keyCode })
  } catch {
    // fallback handled in DOM layer
  }
}

/**
 * Builds a Stagehand / Playwright-MCP style deterministic element snapshot
 * with `[e1]..[e95]` references stored inside Isolated World 999.
 * Prioritizes primary controls & main content so heavy top navbars never starve main elements.
 */
export async function inspectPageInteractiveElements(params: {
  url: string
  webContents: WebContents | undefined
  sensitiveGuardEnabled: boolean
  filter?: string
  scope?: 'viewport' | 'full'
}): Promise<{ ok: boolean; snapshot: string; count: number }> {
  const { url, webContents, sensitiveGuardEnabled, filter, scope = 'viewport' } = params
  if (!url || url.startsWith('arko://') || url.startsWith('dia://') || !webContents || webContents.isDestroyed()) {
    return { ok: false, snapshot: '当前标签页不是可交互的外部网页。', count: 0 }
  }
  if (sensitiveGuardEnabled && isSensitiveUrl(url)) {
    return {
      ok: false,
      snapshot: '隐私护栏保护中：敏感金融或密码站点已禁止 AI 扫描交互节点。',
      count: 0
    }
  }

  const optsJson = JSON.stringify({
    filter: (filter || '').trim().toLowerCase(),
    fullScope: scope === 'full'
  })

  const script = `
  (() => {
    try {
      const opts = ${optsJson};
      const SENSITIVE_RE = /(password|passwd|passcode|cvv|cvc|cc-number|card[-_]?number|ssn|totp|otp)/i;
      const selectorList = [
        'input:not([type="hidden"])',
        'textarea',
        'select',
        'button',
        'summary',
        '[role="button"]',
        '[role="searchbox"]',
        '[role="combobox"]',
        '[role="checkbox"]',
        '[role="switch"]',
        '[role="radio"]',
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[contenteditable="true"]',
        'a[href]'
      ].join(',');

      // Collect elements across document + open Shadow Roots
      const rawSet = new Set();
      const collectFromRoot = (root) => {
        if (!root || !root.querySelectorAll) return;
        for (const el of root.querySelectorAll(selectorList)) {
          rawSet.add(el);
        }
        for (const host of root.querySelectorAll('*')) {
          if (host.shadowRoot) {
            collectFromRoot(host.shadowRoot);
          }
        }
      };
      collectFromRoot(document);

      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;
      const maxBottom = opts.fullScope ? 999999 : vh * 2.5;
      const minTop = opts.fullScope ? -999999 : -160;

      const scoredItems = [];
      let domOrder = 0;

      for (const el of rawSet) {
        domOrder++;
        if (el.disabled) continue;

        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;
        if (rect.bottom < minTop || rect.top > maxBottom || rect.right < 0 || rect.left > vw + 40) continue;

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;

        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const attrMeta = [
          el.getAttribute('name') || '',
          el.getAttribute('id') || '',
          el.getAttribute('autocomplete') || '',
          type
        ].join(' ');
        if (SENSITIVE_RE.test(attrMeta)) continue;

        let label = (
          el.getAttribute('aria-label') ||
          el.innerText ||
          el.textContent ||
          el.getAttribute('placeholder') ||
          el.getAttribute('title') ||
          el.getAttribute('value') ||
          ''
        ).replace(/\\s+/g, ' ').trim();

        if (!label && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
          const id = el.getAttribute('id');
          if (id) {
            try {
              const lblEl = document.querySelector('label[for="' + CSS.escape(id) + '"]');
              if (lblEl) label = (lblEl.textContent || '').replace(/\\s+/g, ' ').trim();
            } catch {}
          }
        }
        label = label.slice(0, 80);

        const isFormControl =
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select' ||
          role === 'searchbox' ||
          role === 'combobox' ||
          role === 'checkbox' ||
          role === 'switch' ||
          Boolean(el.isContentEditable);

        if (!label && !isFormControl) continue;

        const href = tag === 'a' ? (el.getAttribute('href') || '').trim() : '';
        const ph = (el.getAttribute('placeholder') || '').trim();

        if (opts.filter) {
          const haystack = [tag, type, role, label, ph, href].join(' ').toLowerCase();
          if (!haystack.includes(opts.filter)) continue;
        }

        // Priority scoring so dialogs, form inputs, buttons & <main> content are never starved by giant top navbars
        let priority = 1;
        if (el.closest('dialog, [role="dialog"], [aria-modal="true"]')) priority += 6;
        if (isFormControl) priority += 5;
        else if (tag === 'button' || role === 'button' || role === 'tab' || role === 'menuitem' || role === 'option') priority += 3;
        if (el.closest('main, article, [role="main"], form')) priority += 2;
        if (rect.top >= 0 && rect.top <= vh) priority += 2;

        scoredItems.push({
          el,
          domOrder,
          priority,
          rect,
          tag,
          type,
          role,
          label,
          href,
          ph
        });
      }

      const MAX_REFS = 95;
      let chosen = scoredItems;
      if (scoredItems.length > MAX_REFS) {
        chosen = [...scoredItems]
          .sort((a, b) => b.priority - a.priority || a.domOrder - b.domOrder)
          .slice(0, MAX_REFS)
          .sort((a, b) => a.domOrder - b.domOrder);
      }

      const refMap = {};
      const lines = [];

      for (const item of chosen) {
        const { el, rect, tag, type, role, label, href, ph } = item;
        const refId = 'e' + (lines.length + 1);
        refMap[refId] = typeof WeakRef === 'function' ? new WeakRef(el) : el;

        const typeSuffix = type ? ':' + type : role && role !== tag ? ':' + role : '';
        let desc = '[' + refId + '] <' + tag + typeSuffix + '>';
        if (label) desc += ' "' + label + '"';

        if (tag === 'a' && href && !href.startsWith('javascript:')) {
          desc += ' -> ' + href.slice(0, 72);
        } else if (tag === 'input' || tag === 'textarea') {
          if (type === 'checkbox' || type === 'radio') {
            desc += el.checked ? ' [已勾选]' : ' [未勾选]';
          } else {
            if (ph && ph !== label) desc += ' placeholder="' + ph.slice(0, 40) + '"';
            const val = String(el.value || '').trim();
            if (val) desc += ' value="' + val.slice(0, 36) + '"';
          }
        } else if (tag === 'select') {
          const optsList = Array.from(el.options || [])
            .slice(0, 6)
            .map(o => (o.selected ? '*' : '') + (o.text || o.value || '').trim().slice(0, 18));
          if (optsList.length) desc += ' options=[' + optsList.join(', ') + ']';
        } else if (role === 'checkbox' || role === 'switch' || role === 'option' || role === 'tab') {
          const ariaChecked = el.getAttribute('aria-checked') || el.getAttribute('aria-selected');
          if (ariaChecked === 'true') desc += ' [已选中]';
        }

        const ariaExpanded = el.getAttribute('aria-expanded');
        if (ariaExpanded === 'true') desc += ' [已展开]';

        if (rect.bottom < 0) desc += ' (视口上方)';
        else if (rect.top > vh) desc += ' (视口下方)';

        lines.push(desc);
      }

      window.__diaHarnessElements = refMap;

      const docH = Math.max(
        document.documentElement.scrollHeight || 0,
        document.body ? document.body.scrollHeight : 0,
        vh
      );
      const scrollY = Math.round(window.scrollY || 0);
      const pct = Math.min(100, Math.round(((scrollY + vh) / docH) * 100));

      const header = [
        '页面标题: ' + (document.title || ''),
        '当前地址: ' + (location.href || ''),
        '滚动位置: Y=' + scrollY + 'px / 总高=' + docH + 'px (可视进度 ' + pct + '%，候选总数 ' + scoredItems.length + ')',
        '可交互元素快照 (' + lines.length + ' 个):'
      ].join('\\n');

      return {
        ok: true,
        count: lines.length,
        snapshot:
          header +
          '\\n' +
          (lines.length
            ? lines.join('\\n')
            : opts.filter
              ? '（未找到匹配过滤词 "' + opts.filter + '" 的可交互元素，可尝试清空 filter 或切换 scope="full"）'
              : '（当前范围未检测到明显交互控件，可尝试 scroll 滚动页面或调用 capture_page_screenshot 查看画面）')
      };
    } catch (err) {
      return {
        ok: false,
        count: 0,
        snapshot: '扫描页面元素失败: ' + (err && err.message ? err.message : String(err))
      };
    }
  })();
  `

  try {
    const res = await webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
      { code: script }
    ])
    return {
      ok: Boolean(res?.ok),
      count: Number(res?.count) || 0,
      snapshot: String(res?.snapshot || '')
    }
  } catch (err: any) {
    return { ok: false, count: 0, snapshot: err?.message || '扫描网页节点失败' }
  }
}

/**
 * Extracts structured links, tables, forms, or custom CSS selector matches from the page.
 */
export async function extractStructuredPageData(params: {
  url: string
  webContents: WebContents | undefined
  sensitiveGuardEnabled: boolean
  mode: 'links' | 'tables' | 'forms' | 'selector'
  selector?: string
  filter?: string
}): Promise<{ ok: boolean; summary: string; output: string }> {
  const { url, webContents, sensitiveGuardEnabled, mode, selector, filter } = params
  if (!url || url.startsWith('arko://') || url.startsWith('dia://') || !webContents || webContents.isDestroyed()) {
    return { ok: false, summary: '非外部网页', output: '当前标签页不是可提取结构化数据的网页。' }
  }
  if (sensitiveGuardEnabled && isSensitiveUrl(url)) {
    return {
      ok: false,
      summary: '隐私护栏已拦截',
      output: '隐私护栏保护中：禁止从敏感金融或密码站点提取页面数据。'
    }
  }

  const reqJson = JSON.stringify({
    mode,
    selector: (selector || '').trim(),
    filter: (filter || '').trim().toLowerCase()
  })

  const script = `
  (() => {
    try {
      const req = ${reqJson};
      const SENSITIVE_RE = /(password|passwd|passcode|cvv|cvc|cc-number|card[-_]?number|ssn|totp|otp)/i;

      if (req.mode === 'links') {
        const seen = new Set();
        const items = [];
        for (const a of document.querySelectorAll('a[href]')) {
          const text = (a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || '')
            .replace(/\\s+/g, ' ')
            .trim()
            .slice(0, 90);
          let href = '';
          try {
            href = new URL(a.getAttribute('href') || '', location.href).href;
          } catch {
            continue;
          }
          if (!href || href.startsWith('javascript:') || seen.has(href)) continue;
          if (req.filter && !(text.toLowerCase().includes(req.filter) || href.toLowerCase().includes(req.filter))) {
            continue;
          }
          seen.add(href);
          items.push((items.length + 1) + '. [' + (text || '无标题链接') + '](' + href + ')');
          if (items.length >= 80) break;
        }
        return {
          ok: true,
          summary: '提取 ' + items.length + ' 条链接',
          output: items.length ? items.join('\\n') : '未匹配到符合条件的链接。'
        };
      }

      if (req.mode === 'tables') {
        const tables = Array.from(document.querySelectorAll('table'));
        const rendered = [];
        for (let tIdx = 0; tIdx < Math.min(tables.length, 10); tIdx++) {
          const rows = Array.from(tables[tIdx].querySelectorAll('tr'))
            .slice(0, 45)
            .map(tr =>
              Array.from(tr.querySelectorAll('th, td')).map(c =>
                (c.innerText || c.textContent || '').replace(/\\s+/g, ' ').replace(/\\|/g, '\\\\|').trim().slice(0, 80)
              )
            )
            .filter(r => r.length > 0 && r.some(Boolean));
          if (!rows.length) continue;
          const cols = Math.max(...rows.map(r => r.length));
          const pad = r => '| ' + [...r, ...Array(Math.max(0, cols - r.length)).fill('')].join(' | ') + ' |';
          const md = [
            '### 表格 #' + (tIdx + 1),
            pad(rows[0]),
            '| ' + Array(cols).fill('---').join(' | ') + ' |',
            ...rows.slice(1).map(pad)
          ].join('\\n');
          if (!req.filter || md.toLowerCase().includes(req.filter)) {
            rendered.push(md);
          }
        }
        return {
          ok: true,
          summary: '提取 ' + rendered.length + ' 张表格',
          output: rendered.length ? rendered.join('\\n\\n') : '页面中未检测到有效 <table> 数据表格。'
        };
      }

      if (req.mode === 'forms') {
        const fields = [];
        for (const el of document.querySelectorAll('input, textarea, select')) {
          if (el.disabled) continue;
          const tag = el.tagName.toLowerCase();
          const type = (el.getAttribute('type') || 'text').toLowerCase();
          if (type === 'hidden' || type === 'password') continue;
          const meta = [el.getAttribute('name') || '', el.getAttribute('id') || ''].join(' ');
          if (SENSITIVE_RE.test(meta)) continue;
          const label = (
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            el.getAttribute('name') ||
            el.getAttribute('id') ||
            tag
          ).trim();
          const entry = {
            tag,
            type,
            label: label.slice(0, 60),
            required: Boolean(el.required),
            value: type === 'checkbox' || type === 'radio' ? Boolean(el.checked) : String(el.value || '').slice(0, 120),
            options: tag === 'select'
              ? Array.from(el.options || []).slice(0, 20).map(o => ({ value: o.value, text: o.text.trim() }))
              : undefined
          };
          fields.push(entry);
          if (fields.length >= 40) break;
        }
        return {
          ok: true,
          summary: '发现 ' + fields.length + ' 个表单控件',
          output: fields.length ? JSON.stringify(fields, null, 2) : '页面中未检测到可见表单字段。'
        };
      }

      if (req.mode === 'selector') {
        if (!req.selector) {
          return { ok: false, summary: '缺少选择器', output: 'mode="selector" 时必须提供 selector 参数。' };
        }
        const nodes = Array.from(document.querySelectorAll(req.selector)).slice(0, 60);
        const lines = nodes
          .map((n, idx) => {
            const text = (n.innerText || n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 260);
            const href = n.tagName.toLowerCase() === 'a' ? n.getAttribute('href') : (n.querySelector('a[href]') ? n.querySelector('a[href]').getAttribute('href') : '');
            return (idx + 1) + '. <' + n.tagName.toLowerCase() + '> ' + text + (href ? ' (' + href + ')' : '');
          })
          .filter(l => !req.filter || l.toLowerCase().includes(req.filter));
        return {
          ok: true,
          summary: '命中 ' + lines.length + ' 个节点',
          output: lines.length ? lines.join('\\n') : '选择器 "' + req.selector + '" 未匹配到任何节点。'
        };
      }

      return { ok: false, summary: '未知提取模式', output: '不支持的 mode: ' + req.mode };
    } catch (e) {
      return { ok: false, summary: '提取失败', output: e && e.message ? e.message : String(e) };
    }
  })();
  `

  try {
    const res = await webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
      { code: script }
    ])
    return {
      ok: Boolean(res?.ok),
      summary: String(res?.summary || '提取完成'),
      output: String(res?.output || '')
    }
  } catch (err: any) {
    return {
      ok: false,
      summary: '提取异常',
      output: err?.message || '提取页面数据失败'
    }
  }
}

/**
 * Executes a deterministic browser action (`click`, `double_click`, `hover`, `fill`,
 * `select`, `check`, `press_key`, `scroll`, or `wait`) on the target WebContents,
 * combining realistic Pointer/Mouse event sequences + Electron trusted input events.
 */
export async function executePageInteraction(params: {
  url: string
  webContents: WebContents | undefined
  sensitiveGuardEnabled: boolean
  action:
    | 'click'
    | 'double_click'
    | 'hover'
    | 'fill'
    | 'select'
    | 'check'
    | 'press_key'
    | 'scroll'
    | 'wait'
  ref?: string
  value?: string
  pressEnter?: boolean
  clearFirst?: boolean
  checked?: boolean
  key?: string
  scrollDirection?: 'down' | 'up' | 'top' | 'bottom'
  waitMs?: number
}): Promise<{ ok: boolean; detail: string; summary: string }> {
  const {
    url,
    webContents,
    sensitiveGuardEnabled,
    action,
    ref,
    value,
    pressEnter,
    clearFirst = true,
    checked,
    key,
    scrollDirection = 'down',
    waitMs = 1500
  } = params

  if (!url || url.startsWith('arko://') || url.startsWith('dia://') || !webContents || webContents.isDestroyed()) {
    return { ok: false, detail: '目标页面不可操作', summary: '非网页视图' }
  }
  if (sensitiveGuardEnabled && isSensitiveUrl(url)) {
    return {
      ok: false,
      detail: '隐私护栏保护中：已阻止 AI 在敏感金融或密码管理站点上执行自动操作。',
      summary: '隐私护栏已拦截'
    }
  }

  // Handle `wait` action (supports waiting for selector / visible text or timed settle)
  if (action === 'wait') {
    const boundedMs = Math.min(8000, Math.max(200, Number(waitMs) || 1500))
    const targetCondition = (value || '').trim()
    if (!targetCondition) {
      await waitForWebContentsSettle(webContents, boundedMs, boundedMs)
      return {
        ok: true,
        summary: `已等待 ${boundedMs}ms`,
        detail: `已完成等待 (${boundedMs}ms)，当前标题: "${webContents.getTitle()}"，URL: ${webContents.getURL()}`
      }
    }

    const start = Date.now()
    const checkScript = `
    (() => {
      const cond = ${JSON.stringify(targetCondition)};
      try {
        if (/^[.#\\[]|[a-z0-9]+\\s*[>+~.#\\[]/i.test(cond)) {
          const hit = document.querySelector(cond);
          if (hit) return { matched: true, kind: 'selector' };
        }
      } catch {}
      const bodyText = document.body ? document.body.innerText || '' : '';
      if (bodyText.toLowerCase().includes(cond.toLowerCase())) {
        return { matched: true, kind: 'text' };
      }
      return { matched: false };
    })();
    `
    while (Date.now() - start < boundedMs) {
      if (webContents.isDestroyed()) break
      try {
        const hit = await webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
          { code: checkScript }
        ])
        if (hit?.matched) {
          return {
            ok: true,
            summary: `已检测到 “${targetCondition.slice(0, 18)}”`,
            detail: `页面已出现目标内容 (${hit.kind}: "${targetCondition}")，耗时 ${Date.now() - start}ms。`
          }
        }
      } catch {
        // ignore transient navigation error
      }
      await new Promise((r) => setTimeout(r, 250))
    }

    return {
      ok: true,
      summary: `等待超时 (${boundedMs}ms)`,
      detail: `在 ${boundedMs}ms 内未明确匹配到 "${targetCondition}"，页面可能仍在渲染或选择器不同，建议重新调用 inspect_page_elements 查看最新快照。`
    }
  }

  const cleanRef = (ref || '').replace(/^[\[\]\s]+|[\[\]\s]+$/g, '').trim()

  // Handle `press_key` action using Electron's native trusted keyboard events + optional ref focus
  if (action === 'press_key') {
    const keyName = (key || value || 'Enter').trim()
    if (cleanRef) {
      const focusScript = `
      (() => {
        const rawEntry = (window.__diaHarnessElements || {})[${JSON.stringify(cleanRef)}];
        const el = rawEntry && typeof rawEntry.deref === 'function' ? rawEntry.deref() : rawEntry;
        if (el && document.contains(el)) {
          const meta = [el.getAttribute('name') || '', el.getAttribute('id') || '', el.getAttribute('type') || ''].join(' ');
          if (/(password|passwd|passcode|cvv|cvc|cc-number|totp|otp)/i.test(meta)) return { blocked: true };
          el.focus({ preventScroll: false });
          return { focused: true };
        }
        return { focused: false };
      })();
      `
      const focusRes = await webContents
        .executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code: focusScript }])
        .catch(() => null)
      if (focusRes?.blocked) {
        return {
          ok: false,
          summary: '敏感字段已拦截',
          detail: '安全护栏已阻止向密码或支付敏感字段发送按键。'
        }
      }
    }

    sendTrustedKeyPress(webContents, keyName)
    await waitForWebContentsSettle(webContents, 3800, 260)
    return {
      ok: true,
      summary: `已按键 ${keyName}`,
      detail: `已向页面发送原生按键 "${keyName}"，当前页面标题: "${webContents.getTitle()}"，URL: ${webContents.getURL()}`
    }
  }

  const payloadJson = JSON.stringify({
    action,
    ref: cleanRef,
    value: value ?? '',
    pressEnter: Boolean(pressEnter),
    clearFirst: Boolean(clearFirst),
    checked: typeof checked === 'boolean' ? checked : null,
    scrollDirection
  })

  const script = `
  (() => {
    try {
      const payload = ${payloadJson};
      const SENSITIVE_RE = /(password|passwd|passcode|cvv|cvc|cc-number|card[-_]?number|ssn|totp|otp)/i;

      const pulseHighlight = (el) => {
        try {
          const prevTransition = el.style.transition;
          const prevOutline = el.style.outline;
          const prevOffset = el.style.outlineOffset;
          el.style.transition = 'outline 0.2s ease';
          el.style.outline = '2.5px solid rgba(99, 102, 241, 0.85)';
          el.style.outlineOffset = '2px';
          setTimeout(() => {
            el.style.outline = prevOutline;
            el.style.outlineOffset = prevOffset;
            el.style.transition = prevTransition;
          }, 950);
        } catch {}
      };

      const dispatchPointerAndMouse = (el, kind) => {
        const rect = el.getBoundingClientRect();
        const cx = Math.round(rect.left + rect.width / 2);
        const cy = Math.round(rect.top + rect.height / 2);
        const common = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: cx,
          clientY: cy,
          button: 0,
          buttons: 1
        };
        el.dispatchEvent(new PointerEvent('pointerover', { ...common, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('mouseover', { ...common, buttons: 0 }));
        el.dispatchEvent(new PointerEvent('pointerenter', { ...common, bubbles: false, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('mouseenter', { ...common, bubbles: false, buttons: 0 }));
        if (kind === 'hover') {
          el.dispatchEvent(new PointerEvent('pointermove', { ...common, buttons: 0 }));
          el.dispatchEvent(new MouseEvent('mousemove', { ...common, buttons: 0 }));
          return { cx, cy };
        }
        el.dispatchEvent(new PointerEvent('pointerdown', common));
        el.dispatchEvent(new MouseEvent('mousedown', common));
        try { el.focus({ preventScroll: true }); } catch {}
        el.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('mouseup', { ...common, buttons: 0 }));
        el.click();
        if (kind === 'double_click') {
          el.dispatchEvent(new MouseEvent('dblclick', { ...common, buttons: 0, detail: 2 }));
        }
        return { cx, cy };
      };

      if (payload.action === 'scroll') {
        const map = window.__diaHarnessElements || {};
        const rawTarget = payload.ref ? map[payload.ref] : null;
        const targetEl = rawTarget && typeof rawTarget.deref === 'function' ? rawTarget.deref() : rawTarget;
        if (targetEl && document.contains(targetEl) && targetEl.scrollHeight > targetEl.clientHeight + 20) {
          const step = Math.round(targetEl.clientHeight * 0.78);
          if (payload.scrollDirection === 'top') targetEl.scrollTop = 0;
          else if (payload.scrollDirection === 'bottom') targetEl.scrollTop = targetEl.scrollHeight;
          else if (payload.scrollDirection === 'up') targetEl.scrollTop -= step;
          else targetEl.scrollTop += step;
          pulseHighlight(targetEl);
          return {
            ok: true,
            summary: '已滚动局部容器 [' + payload.ref + ']',
            detail: '已滚动局部容器 [' + payload.ref + '] (' + payload.scrollDirection + ')。'
          };
        }

        const vh = window.innerHeight || 800;
        const step = Math.round(vh * 0.8);
        if (payload.scrollDirection === 'top') {
          window.scrollTo({ top: 0, behavior: 'instant' });
        } else if (payload.scrollDirection === 'bottom') {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
        } else if (payload.scrollDirection === 'up') {
          window.scrollBy({ top: -step, behavior: 'instant' });
        } else {
          window.scrollBy({ top: step, behavior: 'instant' });
        }
        const docH = Math.max(document.documentElement.scrollHeight || 1, vh);
        const curY = Math.max(0, Math.round(window.scrollY || 0));
        const pct = Math.min(100, Math.round(((curY + vh) / docH) * 100));

        const visibleSnippet = (document.body ? document.body.innerText : '').slice(0, 3600);
        return {
          ok: true,
          summary: '已滚动至 ' + pct + '% 处',
          detail: '页面已滚动 (' + payload.scrollDirection + ')，当前位置 Y=' + curY + 'px / 总高=' + docH + 'px (' + pct + '%)。页面摘要片段:\\n' + visibleSnippet.slice(0, 1800)
        };
      }

      const map = window.__diaHarnessElements || {};
      const rawEntry = map[payload.ref];
      const el = rawEntry && typeof rawEntry.deref === 'function' ? rawEntry.deref() : rawEntry;
      if (!el || !document.contains(el)) {
        return {
          ok: false,
          summary: '未找到节点 [' + payload.ref + ']',
          detail: '未找到编号为 [' + payload.ref + '] 的元素或页面 DOM 已更新，请先重新调用 inspect_page_elements 获取最新编号。'
        };
      }

      const attrMeta = [
        el.getAttribute('name') || '',
        el.getAttribute('id') || '',
        el.getAttribute('autocomplete') || '',
        el.getAttribute('type') || ''
      ].join(' ');
      if (SENSITIVE_RE.test(attrMeta)) {
        return {
          ok: false,
          summary: '敏感字段已拦截',
          detail: '安全护栏已阻止操作密码或支付相关的敏感输入控件。'
        };
      }

      try {
        el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
      } catch {}
      pulseHighlight(el);

      const label = (
        el.getAttribute('aria-label') ||
        el.innerText ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        el.tagName
      ).replace(/\\s+/g, ' ').trim().slice(0, 38);

      if (payload.action === 'hover') {
        const pt = dispatchPointerAndMouse(el, 'hover');
        return {
          ok: true,
          coords: pt,
          summary: '已悬停 “' + label + '”',
          detail: '已将指针移至元素 [' + payload.ref + '] (“' + label + '”)，如需点击新展开的菜单项请调用 inspect_page_elements。'
        };
      }

      if (payload.action === 'click' || payload.action === 'double_click') {
        if (el.tagName.toLowerCase() === 'a' && el.getAttribute('target') === '_blank') {
          el.removeAttribute('target');
        }
        dispatchPointerAndMouse(el, payload.action);
        return {
          ok: true,
          summary: (payload.action === 'double_click' ? '已双击 “' : '已点击 “') + label + '”',
          detail: '已成功' + (payload.action === 'double_click' ? '双击' : '点击') + '元素 [' + payload.ref + '] (“' + label + '”)，当前 URL: ' + location.href
        };
      }

      if (payload.action === 'check') {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
          const desired = payload.checked !== null ? payload.checked : !el.checked;
          if (el.checked !== desired) {
            dispatchPointerAndMouse(el, 'click');
            if (el.checked !== desired) {
              el.checked = desired;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          return {
            ok: true,
            summary: (el.checked ? '已勾选 “' : '已取消勾选 “') + label + '”',
            detail: '控件 [' + payload.ref + '] (“' + label + '”) 当前状态: ' + (el.checked ? '已勾选' : '未勾选')
          };
        }
        dispatchPointerAndMouse(el, 'click');
        const ariaState = el.getAttribute('aria-checked') || el.getAttribute('aria-pressed') || 'toggled';
        return {
          ok: true,
          summary: '已切换 “' + label + '”',
          detail: '已点击切换控件 [' + payload.ref + '] (“' + label + '”)，状态: ' + ariaState
        };
      }

      if (payload.action === 'select') {
        const tag = el.tagName.toLowerCase();
        const targetVal = String(payload.value || '').trim();
        if (tag === 'select') {
          const opts = Array.from(el.options || []);
          const exact = opts.find(o => o.value === targetVal || (o.text || '').trim() === targetVal);
          const fuzzy = exact || opts.find(o => (o.text || '').toLowerCase().includes(targetVal.toLowerCase()) || o.value.toLowerCase().includes(targetVal.toLowerCase()));
          if (!fuzzy) {
            return {
              ok: false,
              summary: '未匹配下拉项',
              detail: '未在 <select> [' + payload.ref + '] 中找到 "' + targetVal + '"。可选值: ' + opts.slice(0, 15).map(o => o.text.trim() + '(' + o.value + ')').join(', ')
            };
          }
          const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
          if (desc && desc.set) desc.set.call(el, fuzzy.value);
          else el.value = fuzzy.value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return {
            ok: true,
            summary: '已选择 “' + (fuzzy.text || fuzzy.value).trim().slice(0, 20) + '”',
            detail: '已在下拉框 [' + payload.ref + '] 中选中 "' + (fuzzy.text || fuzzy.value).trim() + '"。'
          };
        }
        dispatchPointerAndMouse(el, 'click');
        return {
          ok: true,
          summary: '已展开下拉组件 [' + payload.ref + ']',
          detail: '目标并非原生 <select>，已点击展开自定义下拉菜单 [' + payload.ref + ']，请调用 inspect_page_elements 选择弹出的选项。'
        };
      }

      if (payload.action === 'fill') {
        const tag = el.tagName.toLowerCase();
        const text = String(payload.value || '');
        el.focus({ preventScroll: true });

        if (tag === 'input' || tag === 'textarea') {
          const nextVal = payload.clearFirst ? text : String(el.value || '') + text;
          const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && desc.set) {
            desc.set.call(el, nextVal);
          } else {
            el.value = nextVal;
          }
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (tag === 'select') {
          const opts = Array.from(el.options || []);
          const hit = opts.find(o => o.value === text || o.text.trim().toLowerCase().includes(text.toLowerCase()));
          if (hit) el.value = hit.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.isContentEditable || (el.getAttribute('role') || '').toLowerCase() === 'textbox') {
          if (payload.clearFirst) {
            document.execCommand('selectAll', false);
          }
          const inserted = document.execCommand('insertText', false, text);
          if (!inserted) {
            el.textContent = payload.clearFirst ? text : (el.textContent || '') + text;
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
          }
        }

        return {
          ok: true,
          summary: '已填入 “' + text.slice(0, 18) + '”' + (payload.pressEnter ? ' 并回车' : ''),
          detail: '已向 [' + payload.ref + '] (“' + label + '”) 填入 “' + text + '”'
        };
      }

      return { ok: false, summary: '未知操作', detail: '不支持的 action: ' + payload.action };
    } catch (e) {
      return { ok: false, summary: '操作异常', detail: e && e.message ? e.message : String(e) };
    }
  })();
  `

  try {
    const res = await webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
      { code: script }
    ])

    if (res?.ok && action === 'hover' && res.coords) {
      try {
        webContents.sendInputEvent({
          type: 'mouseMove',
          x: Number(res.coords.cx) || 0,
          y: Number(res.coords.cy) || 0
        })
      } catch {
        // ignore
      }
    }

    if (res?.ok && action === 'fill' && pressEnter) {
      sendTrustedKeyPress(webContents, 'Enter')
    }

    if (
      res?.ok &&
      (action === 'click' ||
        action === 'double_click' ||
        (action === 'fill' && pressEnter) ||
        action === 'scroll' ||
        action === 'hover')
    ) {
      await waitForWebContentsSettle(
        webContents,
        action === 'scroll' || action === 'hover' ? 800 : 4200,
        action === 'scroll' || action === 'hover' ? 220 : 320
      )
    }

    const postTitle = !webContents.isDestroyed() ? webContents.getTitle() : ''
    const postUrl = !webContents.isDestroyed() ? webContents.getURL() : url

    return {
      ok: Boolean(res?.ok),
      summary: String(res?.summary || '执行完成'),
      detail: `${String(res?.detail || '')}${res?.ok ? `\n当前页面状态: "${postTitle}" (${postUrl})` : ''}`
    }
  } catch (err: any) {
    return {
      ok: false,
      summary: '执行失败',
      detail: err?.message || '网页交互执行失败'
    }
  }
}
