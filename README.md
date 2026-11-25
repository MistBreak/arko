# Arko

**The open-source, Chromium-based Arc alternative — supercharged with native AI.**

English | [简体中文](./README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/MistBreak/arko?style=flat-square&label=Release)](https://github.com/MistBreak/arko/releases)
[![License](https://img.shields.io/badge/License-Apache--2.0%20%2B%20Commons%20Clause%20(Non--Commercial)-4f46e5?style=flat-square)](./LICENSE)
[![Engine](https://img.shields.io/badge/Engine-Chromium%20(Electron%2035)-0ea5e9?style=flat-square)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-64748b?style=flat-square)](https://github.com/MistBreak/arko/releases)

---

## Why Arko?

**Arc** changed how we live on the web — introducing Spaces, a 3-tier vertical sidebar (`Favorites`, `Pinned`, `Today`), effortless Split View, and a calm, distraction-free frame. Yet Arc moved into maintenance mode as a closed-source product, while most open-source alternatives rely on Firefox engines rather than Chromium.

**Arko** (*"Arc"* in Esperanto) brings that beloved **spatial Chromium browsing experience** into the open, enhanced with a **local-first, Bring-Your-Own-Key (BYOK) AI workspace**:

- **True Chromium Engine**: Built on Electron `WebContentsView` for full Chromium rendering speed, DevTools parity, and modern web compatibility.
- **1-Click Migration from Arc, Dia & Chrome**: Losslessly import your **Arc Spaces (`StorableSidebar.json`)**, Favorites grid, Pinned tabs & folders, Chrome profiles, Bookmarks, and History on first launch — even while your source browser is actively running.
- **Arc Spatial Workflow**: Adaptive `Favorites` icon grid, per-Space `Pinned` tabs with origin restore, ephemeral `Today` tabs, two-finger trackpad Space swiping, and drag-to-Split-View.
- **Native BYOK AI (Zero Lock-In)**: Connect **OpenAI**, **Anthropic Claude**, **Google Gemini**, **Local Ollama**, or any compatible API gateway — no mandatory cloud account or subscription.
- **One-Click In-App Updates**: Background release checks against `MistBreak/arko` with single-click download, install, and restart across macOS, Windows, and Linux.
- **Bilingual Out of the Box**: Clean **English** UI by default with instant real-time switching to **Simplified Chinese (`简体中文`)**.

---

## Core Features

### 1. Arc-Inspired Spatial Sidebar, Spaces & Calm UI
- **3-Tier Vertical Sidebar**:
  - **Favorites Grid**: Top 1–4 column adaptive icon tiles that stay accessible across workflows.
  - **Pinned Tabs**: Space-specific permanent tabs above the divider — click the pin badge anytime to snap back to the original pinned URL.
  - **Today Tabs**: Ephemeral daily tabs below the divider with one-click **Clear** and color-coded collapsible tab groups (plus `/organize` AI auto-grouping).
- **Fluid Spaces (`Profiles`)**: Isolate Work, Personal, and Research contexts with custom ambient tint themes and smooth trackpad two-finger horizontal swiping (`⌃⌥←` / `⌃⌥→`).
- **Split View (`⇧⌘\`) & Focus Mode (`⇧⌘S`)**: Drag any tab onto the right-side viewport dropzone for side-by-side browsing, collapse the sidebar into a 100% borderless canvas, or switch to Classic Horizontal Tabs (`⌘\`).
- **Title-First Smart Bar**: Calmly displays `Domain · Page Title` during reading and expands to the full URL + quick actions (Reader View, Zoom, Inline Write, Bookmark) on hover.

### 2. Chat as a First-Class Tab (`arko://chat/`) & AI Sidebar (`⌘E`)
- **Reads Between the Tabs**: Type `@` in `arko://newtab`, the `⌘K` Command Bar, or the `⌘E` AI Sidebar to cite multiple open tabs, semantic `@History`, or `@Memory`.
- **Dock & Undock Freely**: Pop any `⌘E` sidebar conversation out into a full-width `arko://chat/` tab, collapse it back to the sidebar, or pair a Chat Tab alongside a PR or paper in Split View.
- **Autonomous Browser & Coding Agent (`⚡ Agent`)**: Optional multi-step agent loop capable of deterministic `[e1]..[e95]` DOM inspection, multimodal page screenshots, form interaction, multi-tab orchestration, and local workspace code navigation.

### 3. 60fps In-Page Magic (Isolated World + Closed Shadow DOM)
- **Selection Floating Bar**: Highlight text on any non-sensitive webpage to summon a frosted-glass pill (`✨ Ask Arko` · `🌐 Translate` · `📝 Summarize` · `💬 Quote` · `Copy`) with zero webpage CSS/JS pollution.
- **`⌘J` Write in Your Voice**: Focus any `<textarea>` or rich editor to draft, polish, translate, or smart-fill forms informed by your local `@Memory` vault (physically blocked on banking and password pages).
- **Distraction-Free Reader View (`⇧⌘R`)**: Strip page clutter in one shortcut with sans/serif typography toggles, reading time estimates, AI summaries, and clean Markdown export.

### 4. One-Click Auto-Update
- Arko automatically checks [GitHub Releases](https://github.com/MistBreak/arko/releases) in the background (configurable in `Settings → Updates & License`).
- When a new version drops, an Arc-style update pill appears right inside the sidebar — click **Download** and **Restart to Update** to upgrade seamlessly (supports both Apple-signed and ad-hoc/unsigned macOS bundles via automatic quarantine cleanup, plus Windows NSIS and Linux AppImage).

---

## Installation

Download the latest installer for your platform from [**GitHub Releases**](https://github.com/MistBreak/arko/releases):

- **macOS (Apple Silicon & Intel)**: `Arko-<version>-arm64.dmg` / `Arko-<version>-x64.dmg`
- **Windows**: `Arko-Setup-<version>.exe`
- **Linux**: `Arko-<version>.AppImage`

> **macOS First-Run Note (Unsigned Community Builds)**: If macOS Gatekeeper prompts that the app is unverified, run `xattr -cr /Applications/Arko.app` once in Terminal. Subsequent **One-Click Updates** inside Arko handle this automatically.

---

## Quick Start (Build from Source)

### Prerequisites
- **Node.js** `>= 20`
- **pnpm** `>= 9`

```bash
# Clone the repository
git clone https://github.com/MistBreak/arko.git
cd arko

# Install dependencies
pnpm install

# Start Arko in development mode with hot reload
pnpm run dev

# Run TypeScript checks & production bundle build
pnpm run typecheck
pnpm run build
```

### Packaging Desktop Installers

```bash
pnpm run dist:mac     # Build macOS .dmg + .zip (arm64 & x64)
pnpm run dist:win     # Build Windows NSIS installer
pnpm run dist:linux   # Build Linux AppImage
```

---

## Keyboard Shortcuts

*(All shortcuts work even when focus is inside a webpage.)*

| Shortcut | Action |
| :--- | :--- |
| `⌘L` / `⌘K` | Open unified Command Bar (press `Tab` to toggle Search / Ask Arko) |
| `⌘E` | Toggle right-hand **Arko AI Sidebar** |
| `⌘J` | **Inline Write (`Write in Your Voice`)** / Smart Form Fill on focused inputs |
| `⇧⌘R` | Toggle **Arko Reader View** on the active webpage |
| `⇧⌘\` | Toggle side-by-side **Split View** |
| `⌘\` | Switch between **Arc Vertical Sidebar** and **Horizontal Tabs** |
| `⌃⌥←` / `⌃⌥→` | Switch previous / next **Space (`Profile`)** (or two-finger swipe on sidebar) |
| `⇧⌘S` | Toggle **Focus Mode** (collapse sidebar / single-row compact bar) |
| `⌘T` / `⌘W` / `⇧⌘T` | New Tab / Close Tab / **Reopen Closed Tab** |
| `⌘1` – `⌘9` | Jump to tab `1`–`8` (`⌘9` jumps to last tab) |
| `⇧⌘[` / `⇧⌘]` / `⌃Tab` | Previous / Next tab |
| `⌘+` / `⌘-` / `⌘0` | Zoom In / Zoom Out / Reset Zoom (`100%`) |
| `⌘[` / `⌘]` / `⌘R` | Back / Forward / Reload |
| `⌘F` / `⌘D` / `⌘,` | Find in Page / Bookmark Page / Open Settings & Memory Vault |

---

## Automated Releases & One-Click Update Pipeline

Pushing a semantic version tag automatically triggers [`.github/workflows/release.yml`](./.github/workflows/release.yml) to typecheck, compile, and publish multi-platform installers to `MistBreak/arko` GitHub Releases:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Once published, all installed Arko clients detect the new release and offer **One-Click Download & Restart**.

---

## License (Non-Commercial)

Copyright © 2026 **MistBreak** ([github.com/MistBreak](https://github.com/MistBreak)).

Arko is licensed under the **Apache License 2.0 with Commons Clause v1.0** — see [LICENSE](./LICENSE) for the full text.

- **Permitted**: Free personal, academic, research, and everyday workplace browsing; viewing, forking, modifying, and contributing to the source code.
- **Prohibited (Without Written Permission)**: Selling Arko or derivative works, offering paid hosted/managed services built substantially on Arko, or bundling Arko into commercial OEM/enterprise distributions without commercial authorization from **MistBreak**.
