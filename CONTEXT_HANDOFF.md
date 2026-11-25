# Arko Browser (`MistBreak/arko`) — Context Handoff & Architecture Summary

> 本文件供后续开发会话快速接手使用，包含品牌定位、双语国际化、一键更新管线、核心文件索引与运行约束。

## 1. 项目概览与品牌契约
- **产品名称**：**Arko** (`Arko Browser`) — *"The open-source, Chromium-based Arc alternative — supercharged with native AI."*
- **目标仓库与组织**：`https://github.com/MistBreak/arko`（应用主体：**MistBreak**，应用 ID：`com.mistbreak.arko`）
- **开源协议**：`Apache-2.0 + Commons Clause v1.0`（见 `LICENSE`，允许免费个人/学术/内部使用与源码共建，严禁未经授权商业售卖或付费托管服务）。
- **内置协议路由**：`arko://newtab`、`arko://chat/<threadId>`（`src/shared/constants.ts` 内置 `normalizeLegacyInternalUrl()` 向下兼容旧版 `dia://` 标签记录）。
- **本地存储目录**：`app.getPath('userData')/arko-browser-store`（`src/main/store.ts` 支持从旧目录 `dia-browser-store` 自动静默迁移一次）。
- **技术栈**：Electron `35.7.5` (`WebContentsView`) + `electron-vite 3` + React `19` + TypeScript + Tailwind CSS `v4` + `electron-builder` + `marked` + `lucide-react`。
- **常用命令**：
  - `pnpm run dev`：启动桌面端开发热更新
  - `pnpm run typecheck && pnpm run build`：全量类型检查与生产构建
  - `pnpm run dist:mac` / `dist:win` / `dist:linux`：打包对应平台安装包与自动更新产物

---

## 2. 核心架构与代码地图

### 共享契约与双语层 (`src/shared/`)
- `src/shared/types.ts`：定义 `AppLanguage` (`'en' | 'zh-CN'`)、`AppUpdateState`、`ArkoAPI`（保留 `DiaAPI` 类型别名兼容）、`AppSettings`（默认 `language: 'en'`, `autoCheckUpdates: true`）等全量 IPC 契约。
- `src/shared/i18n.ts`：轻量零依赖双语工具（`tr(lang, en, zh)`、`resolveLang()`、`getTimeGreeting()`、`getMemoryCategoryLabel()`）。
- `src/shared/constants.ts`：
  - 内置官方 `Arko Cloud` 云端引擎（默认激活，配合邮箱账号体系免密钥即开即用），并保留中立 BYOK 渠道（`OpenAI`、`Anthropic Claude`、`Google Gemini`、`Local Ollama`）。
  - 双语内置斜杠技能：`getBuiltinSlashSkills(lang)`（`/summarize`、`/compare`、`/translate`、`/extract`、`/fact-check`、`/organize`、`/markdown`、`/screenshot`）。

### Electron 主进程、一键更新与双 Preload (`src/main/` & `src/preload/`)
- `src/main/updater.ts`：**跨平台一键更新管理器 (`UpdateManager`)**：
  - 对接 `https://api.github.com/repos/MistBreak/arko/releases/latest`（首个 Release 发布前返回 `404` 时优雅识别为已是最新）。
  - 支持后台定时检查、流式下载进度广播（`arko:update-state`），以及一键替换重启：macOS 自动下载对应架构 `.zip`、用 `ditto` 解压并执行 `xattr -cr` 剥离隔离属性后通过独立后台脚本原子替换 `.app` 重启（无论是否购买 Apple Developer 签名均可丝滑更新）；Windows 支持 `NSIS /S` 静默升级重启；Linux 支持 `AppImage` 原地原子替换重启。
- `src/main/index.ts`：`app.setName('Arko')`、根据 `settings.language` 实时重建中英双语原生菜单（含 `Check for Updates…`）及全量 `arko:*` IPC 注册。
- `src/preload/index.ts` & `src/preload/web-preload.ts`：暴露 `window.arko`（及兼容别名 `window.dia`）；网页内 Isolated World + Closed Shadow DOM `<arko-browser-layer>` 划词工具条与 `⌘J` 微标支持中英双语动态渲染。
- `src/main/browser-manager.ts`、`src/main/ai-service.ts`、`src/main/inline-write.ts`、`src/main/browser-harness.ts`、`src/main/coding-harness.ts`：多标签 `WebContentsView` 管理、Arc 分屏/分组、阅读器、Agent 工具流式闭环（`<arko-followups>` 延伸追问解析）及双语提示词适配。

### React 渲染层 (`src/renderer/src/`)
- 默认英文（`en`），支持在 `SettingsModal.tsx` 顶栏一键切换 `EN / 中文`，并包含独立的 **Updates & License（更新与协议）** 面板与 `VerticalSidebar.tsx` 底部 Arc 风格一键更新胶囊提示。
- 发布流水线：`electron-builder.yml` + `.github/workflows/release.yml`（推送 `v*` tag 自动构建 macOS/Windows/Linux Release 资产）。
