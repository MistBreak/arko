# Arko

**无地区限制的开源 Chromium 桌面浏览器 —— 延续 Arc 经典空间工作流，融合 Dia 式原生 AI 体验。**

[English](./README.md) | 简体中文

[![Release](https://img.shields.io/github/v/release/MistBreak/arko?style=flat-square&label=Release)](https://github.com/MistBreak/arko/releases)
[![License](https://img.shields.io/badge/License-Apache--2.0%20%2B%20Commons%20Clause%20(%E7%A6%81%E6%AD%A2%E5%95%86%E7%94%A8)-4f46e5?style=flat-square)](./LICENSE)
[![Engine](https://img.shields.io/badge/Engine-Chromium%20(Electron%2035)-0ea5e9?style=flat-square)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-64748b?style=flat-square)](https://github.com/MistBreak/arko/releases)

---

## 为什么做 Arko？

**Arc 浏览器**曾重新定义了现代桌面浏览器的空间秩序 —— 左侧垂直侧边栏、多空间隔离（`Spaces`）、`Favorites / Pinned / Today` 三层标签体系、丝滑分屏（`Split View`）以及克制沉静的无边框视觉。

然而随着官方重心全面转向继任者 **Dia**，**Arc 浏览器已准备下架退场**；但令人遗憾的是，**Dia 在部分国家和地区受到区域与账号限制而无法正常使用**，而市面上现有的开源平替又大多基于 Firefox 内核构建。这让无数习惯了 Chromium 生态的 Arc 用户陷入「老浏览器即将停摆、新浏览器无法使用」的尴尬境地。

**正因如此，才有了 Arko**（世界语中意为 *"Arc / 弧"*）。我们希望打造一款 **不受地区限制、开源透明、本地优先** 的 Chromium 桌面浏览器 —— 既完整留住 **Arc 标志性的空间交互体验**，又原生融合 **Dia 式的跨标签 AI 生产力**：

- **零地区限制 · 自带 Key（BYOK）自由接入**：无需强制绑定受地区限制的云端账号，数据保存在本地；原生支持 **OpenAI**、**Anthropic Claude**、**Google Gemini**、**本地 Ollama** 及任意兼容 API 中转网关，在任何地区都能开箱即用。
- **赶在 Arc 下架前，一键无损迁移**：首次启动即可直接解析 **Arc (`StorableSidebar.json`)** 空间结构、顶部常驻网格、固定标签文件夹，以及 **Dia / Chrome** 多配置书签树与历史记录（原浏览器运行占锁状态下同样支持安全读取）。
- **纯正 Chromium 内核**：基于 Electron `WebContentsView` 构建，拥有完整的 Chromium 渲染性能、开发者工具（DevTools）与现代 Web 生态兼容性。
- **Arc 空间工作流 × Dia 原生 AI 二合一**：完整复刻自适应常驻图标网格（`Favorites`）、空间固定标签（`Pinned`）、今日临时标签（`Today`）、触控板双指滑切空间与拖拽分屏；同时内建 `@` 多标签联合上下文、独立对话页（`arko://chat/`）、`⌘J` 网页内联帮写与浏览器自动化 Agent。
- **应用内一键更新（One-Click Update）**：后台自动检测 `MistBreak/arko` GitHub Releases，支持一键下载、自动替换安装并重启（macOS 未付费签名构建同样支持自动免检更新）。
- **默认英文 · 中英双语实时切换**：默认提供纯净英文界面，可在 `Settings → EN / 中文` 一键实时切换为简体中文（同步覆盖主界面、系统原生菜单与网页划词工具条）。

---

## 核心特性一览

### 1. Arc 空间垂直侧边栏、多空间隔离与 Calm UI
- **经典三层垂直侧边栏**：
  - **顶部常驻网格 (`Favorites`)**：1～4 列自适应大图标网格，高频站点触手可及。
  - **空间固定标签 (`Pinned`)**：位于分割线上方，与当前空间绑定；点击图钉微标即可一键还原至初始固定网址。
  - **今日临时标签 (`Today`)**：位于分割线下方，支持一键 **清理**，并支持彩色可折叠标签组与 `/organize` AI 自动语义分组。
- **多空间丝滑流转 (`Spaces / Profiles`)**：为工作、个人、研究配置独立空间与氛围主题色，支持侧边栏触控板双指左右滑动或 `⌃⌥←` / `⌃⌥→` 瞬时切换。
- **并排分屏 (`⇧⌘\`) 与无感沉浸模式 (`⇧⌘S`)**：将任意标签拖向右侧网页热区即可开启左右分屏；按 `⇧⌘S` 一键收起侧栏获得 100% 沉浸画布，或按 `⌘\` 随时切换「左侧垂直栏 / 顶部水平标签栏」。
- **标题优先智能地址栏**：日常沉静显示 `域名 · 页面标题` 降低视觉干扰，悬停平滑展开完整 URL 与阅读模式、缩放、内联帮写、收藏等快捷入口。

### 2. 一等公民对话标签页 (`arko://chat/`) + AI 侧边栏 (`⌘E`)
- **跨标签联合上下文 (`Reads Between the Tabs`)**：在 `arko://newtab`、`⌘K` 智能命令栏或 `⌘E` 侧边栏输入 `@`，即可同时引用多个已打开标签页、`@History` 本地语义历史或 `@Memory` 个人记忆库。
- **侧栏与全宽标签自由收放**：右侧 `⌘E` 对话可一键 **「↗ 在独立标签页中展开」**，独立对话页也可随时收起回右侧栏，或拖入 **左右分屏** 一边读论文 / 看 PR 一边深度提问。
- **内置浏览器与代码双引擎 Agent (`⚡ Agent`)**：支持 `[e1]..[e95]` 确定性页面元素快照、多模态自动截屏感知、自动填表点击、多标签编排以及本地代码仓检索编辑。

### 3. 60fps 网页内生灵动交互（Isolated World + Closed Shadow DOM）
- **网页划词毛玻璃悬浮条**：在任意非敏感网页选中文字，选区上方即刻浮现 `✨ Ask Arko` · `🌐 翻译` · `📝 提炼` · `💬 引用追问` · `复制`，60fps 零遮挡、零网页全局变量污染。
- **`⌘J` 网页内联帮写 (`Write in Your Voice`)**：聚焦网页 `<textarea>` 或富文本编辑器自动浮现微标，结合你的个人记忆口吻流式续写、润色或智能预览填充表单（网银与密码页面自动物理阻断）。
- **沉浸阅读视图 (`⇧⌘R`)**：一键剥离网页广告杂讯，支持无衬线/衬线排版切换、预计阅读时长、AI 总结与干净 Markdown 导出。

### 4. 应用内一键更新（One-Click Update）
- Arko 会在后台静默检查 [GitHub Releases](https://github.com/MistBreak/arko/releases) 新版本（可在 `设置 → 更新与协议` 中开关）。
- 发现新版本时，左侧边栏底部会自动浮现 Arc 风格更新胶囊，点击即可完成后台流式下载、解压校验与一键重启更新（完整支持 macOS `arm64/x64`、Windows `NSIS` 与 Linux `AppImage`）。

---

## 下载安装

前往 [**GitHub Releases**](https://github.com/MistBreak/arko/releases) 下载对应系统的安装包：

- **macOS（Apple Silicon & Intel）**：`Arko-<version>-arm64.dmg` / `Arko-<version>-x64.dmg`
- **Windows**：`Arko-Setup-<version>.exe`
- **Linux**：`Arko-<version>.AppImage`

> **macOS 首次打开提示（社区未签名构建）**：若首次启动遇到 macOS Gatekeeper 提示无法验证开发者，在终端执行一次 `xattr -cr /Applications/Arko.app` 即可打开；后续通过应用内 **一键更新** 升级时会自动清除隔离属性，无需再次手动操作。

---

## 本地开发与构建

### 环境要求
- **Node.js** `>= 20`
- **pnpm** `>= 9`

```bash
# 克隆仓库
git clone https://github.com/MistBreak/arko.git
cd arko

# 安装依赖
pnpm install

# 启动开发模式（支持热更新）
pnpm run dev

# 类型检查与生产构建
pnpm run typecheck
pnpm run build
```

### 打包各平台安装包

```bash
pnpm run dist:mac     # 打包 macOS .dmg + 一键更新所需 .zip (arm64 & x64)
pnpm run dist:win     # 打包 Windows NSIS 安装程序
pnpm run dist:linux   # 打包 Linux AppImage
```

---

## 常用全局快捷键

*（焦点在网页内部时同样生效）*

| 快捷键 | 功能说明 |
| :--- | :--- |
| `⌘L` / `⌘K` | 唤起统一智能命令栏（按 `Tab` 切换网页搜索 / AI 提问） |
| `⌘E` | 展开 / 收起右侧 **Arko AI 侧边栏** |
| `⌘J` | 网页输入框 **内联帮写 (`Write in Your Voice`)** / 表单智能填充 |
| `⇧⌘R` | 开启 / 关闭当前网页 **Arko 沉浸阅读视图** |
| `⇧⌘\` | 开启 / 关闭 **左右并排分屏视图 (Split View)** |
| `⌘\` | 切换「左侧 Arc 垂直侧边栏 / 顶部水平标签栏」 |
| `⌃⌥←` / `⌃⌥→` | 左右切换上一个 / 下一个 **空间 (`Profile`)**（侧边栏支持双指左右滑动） |
| `⇧⌘S` | 切换 **无感沉浸模式 (`Focus Mode`)**（收起侧栏 / 单行紧凑顶栏） |
| `⌘T` / `⌘W` / `⇧⌘T` | 新建标签页 / 关闭当前标签页 / **恢复刚关闭的标签页** |
| `⌘1` ~ `⌘9` | 快速切换到第 `1`~`8` 个标签页（`⌘9` 切至最后一个） |
| `⇧⌘[` / `⇧⌘]` / `⌃Tab` | 切换上一个 / 下一个标签页 |
| `⌘+` / `⌘-` / `⌘0` | 放大 / 缩小网页 / 恢复 `100%` 缩放 |
| `⌘[` / `⌘]` / `⌘R` | 后退 / 前进 / 重新加载网页 |
| `⌘F` / `⌘D` / `⌘,` | 页内查找 / 收藏当前网页 / 打开设置与个人记忆库 |

---

## 自动发版与一键更新工作流

推送 `v*` 版本标签即可自动触发 [`.github/workflows/release.yml`](./.github/workflows/release.yml)，在 GitHub Actions 中完成类型检查、三端编译打包并发布至 `MistBreak/arko` Releases：

```bash
git tag v0.1.0
git push origin v0.1.0
```

Release 发布后，所有已安装 Arko 的客户端即可自动收到新版本提示并一键完成升级。

---

## 开源许可协议（禁止商用）

Copyright © 2026 **MistBreak** ([github.com/MistBreak](https://github.com/MistBreak)).

本项目采用 **Apache License 2.0 + Commons Clause v1.0（非商业开源协议）** 授权，完整条款请参阅 [LICENSE](./LICENSE)。

- **允许**：免费用于个人日常浏览、学术研究、非售卖性质的团队内部日常使用，以及查看、Fork、修改源码与提交社区贡献。
- **禁止（未经书面授权）**：严禁未经 **MistBreak** 书面商业授权出售本软件或衍生版本、提供基于本软件的付费托管/商业中转套件服务、或将其打包进商业 OEM / 付费企业发行版。
