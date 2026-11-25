import { PROFILE_ACCENT_PRESETS } from './constants'

export interface ArcSpaceTheme {
  accentHex: string
  rgb: [number, number, number]
  rgbString: string
  sidebarBackground: string
  sidebarBorderColor: string
  topBarBackground: string
  topBarBorderColor: string
  horizontalHeaderBackground: string
  dividerColor: string
  spaceBadgeBg: string
  spaceBadgeBorder: string
  hudBackground: string
  hudBorderColor: string
  activeTabBg: string
  activeTabShadow: string
  favIdleBg: string
  favIdleShadow: string
  favActiveBg: string
  favActiveShadow: string
}

const FALLBACK_HEX = '#4F46E5'

export function normalizeSpaceHex(hex?: string | null, fallback = FALLBACK_HEX): string {
  if (!hex || typeof hex !== 'string') return fallback
  const trimmed = hex.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase()
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1]
    const g = trimmed[2]
    const b = trimmed[3]
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  return fallback
}

export function parseHexRgb(hex?: string | null): [number, number, number] {
  const norm = normalizeSpaceHex(hex)
  const n = parseInt(norm.slice(1), 16)
  if (Number.isNaN(n)) return [79, 70, 229]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))
  const to2 = (v: number): string => clamp(v).toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(b)}`.toUpperCase()
}

function mixRgbCss(
  base: [number, number, number],
  tint: [number, number, number],
  weight: number
): string {
  const w = Math.max(0, Math.min(1, weight))
  const r = Math.round(base[0] * (1 - w) + tint[0] * w)
  const g = Math.round(base[1] * (1 - w) + tint[1] * w)
  const b = Math.round(base[2] * (1 - w) + tint[2] * w)
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * Smoothly interpolates between two Space accent colors during two-finger swipe gestures.
 */
export function interpolateSpaceHex(hexA: string, hexB: string, progress: number): string {
  const t = Math.max(0, Math.min(1, progress))
  if (t <= 0.001) return normalizeSpaceHex(hexA)
  if (t >= 0.999) return normalizeSpaceHex(hexB)
  const [r1, g1, b1] = parseHexRgb(hexA)
  const [r2, g2, b2] = parseHexRgb(hexB)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

/**
 * Picks the next unused vibrant preset color when creating a new Space, just like Arc.
 */
export function pickNextDistinctSpaceColor(existingColors: string[]): string {
  const used = new Set(existingColors.map((c) => normalizeSpaceHex(c)))
  const vibrantPresets = PROFILE_ACCENT_PRESETS.filter(
    (p) => normalizeSpaceHex(p.hex) !== '#64748B'
  )
  const unused = vibrantPresets.find((p) => !used.has(normalizeSpaceHex(p.hex)))
  if (unused) return unused.hex
  return vibrantPresets[existingColors.length % vibrantPresets.length]?.hex || FALLBACK_HEX
}

/**
 * Generates Arc Browser-inspired atmospheric glass & frame tokens from a Space's accent color.
 */
export function getArcSpaceTheme(accentHex?: string | null, isDark = false): ArcSpaceTheme {
  const norm = normalizeSpaceHex(accentHex)
  const rgb = parseHexRgb(norm)
  const [r, g, b] = rgb
  const rgbString = `${r}, ${g}, ${b}`

  if (isDark) {
    const topMix = mixRgbCss([23, 23, 28], rgb, 0.27)
    const midMix = mixRgbCss([24, 24, 29], rgb, 0.17)
    const botMix = mixRgbCss([23, 23, 27], rgb, 0.12)

    const barLeft = mixRgbCss([23, 23, 28], rgb, 0.22)
    const barMid = mixRgbCss([25, 25, 29], rgb, 0.13)
    const barRight = mixRgbCss([25, 25, 28], rgb, 0.08)

    const horizTop = mixRgbCss([23, 23, 28], rgb, 0.25)
    const horizBot = mixRgbCss([25, 25, 30], rgb, 0.14)

    return {
      accentHex: norm,
      rgb,
      rgbString,
      sidebarBackground: `radial-gradient(125% 52% at 12% 0%, rgba(${rgbString}, 0.22) 0%, rgba(${rgbString}, 0) 72%), linear-gradient(170deg, ${topMix} 0%, ${midMix} 54%, ${botMix} 100%)`,
      sidebarBorderColor: `rgba(${rgbString}, 0.22)`,
      topBarBackground: `linear-gradient(90deg, ${barLeft} 0%, ${barMid} 52%, ${barRight} 100%)`,
      topBarBorderColor: `rgba(${rgbString}, 0.18)`,
      horizontalHeaderBackground: `linear-gradient(180deg, ${horizTop} 0%, ${horizBot} 100%)`,
      dividerColor: `rgba(${rgbString}, 0.24)`,
      spaceBadgeBg: `rgba(${rgbString}, 0.24)`,
      spaceBadgeBorder: `rgba(${rgbString}, 0.45)`,
      hudBackground: mixRgbCss([28, 28, 35], rgb, 0.26),
      hudBorderColor: `rgba(${rgbString}, 0.44)`,
      activeTabBg: `rgba(255, 255, 255, 0.125)`,
      activeTabShadow: `inset 0 0 0 1px rgba(${rgbString}, 0.36), 0 2px 8px rgba(0, 0, 0, 0.22)`,
      favIdleBg: `rgba(255, 255, 255, 0.065)`,
      favIdleShadow: `inset 0 0 0 1px rgba(255, 255, 255, 0.06)`,
      favActiveBg: `rgba(255, 255, 255, 0.16)`,
      favActiveShadow: `inset 0 0 0 1px rgba(${rgbString}, 0.48), 0 3px 10px rgba(0, 0, 0, 0.24)`
    }
  }

  const topMix = mixRgbCss([246, 246, 249], rgb, 0.175)
  const midMix = mixRgbCss([246, 246, 249], rgb, 0.115)
  const botMix = mixRgbCss([245, 245, 248], rgb, 0.085)

  const barLeft = mixRgbCss([246, 246, 249], rgb, 0.145)
  const barMid = mixRgbCss([248, 248, 250], rgb, 0.085)
  const barRight = mixRgbCss([250, 250, 251], rgb, 0.045)

  const horizTop = mixRgbCss([246, 246, 249], rgb, 0.165)
  const horizBot = mixRgbCss([248, 248, 250], rgb, 0.095)

  return {
    accentHex: norm,
    rgb,
    rgbString,
    sidebarBackground: `radial-gradient(125% 52% at 12% 0%, rgba(${rgbString}, 0.15) 0%, rgba(${rgbString}, 0) 72%), linear-gradient(170deg, ${topMix} 0%, ${midMix} 54%, ${botMix} 100%)`,
    sidebarBorderColor: `rgba(${rgbString}, 0.18)`,
    topBarBackground: `linear-gradient(90deg, ${barLeft} 0%, ${barMid} 52%, ${barRight} 100%)`,
    topBarBorderColor: `rgba(${rgbString}, 0.15)`,
    horizontalHeaderBackground: `linear-gradient(180deg, ${horizTop} 0%, ${horizBot} 100%)`,
    dividerColor: `rgba(${rgbString}, 0.20)`,
    spaceBadgeBg: `rgba(${rgbString}, 0.14)`,
    spaceBadgeBorder: `rgba(${rgbString}, 0.30)`,
    hudBackground: mixRgbCss([255, 255, 255], rgb, 0.14),
    hudBorderColor: `rgba(${rgbString}, 0.32)`,
    activeTabBg: `rgba(255, 255, 255, 0.88)`,
    activeTabShadow: `inset 0 0 0 1px rgba(${rgbString}, 0.22), 0 1px 5px rgba(${rgbString}, 0.11), 0 1px 2px rgba(0, 0, 0, 0.04)`,
    favIdleBg: `rgba(255, 255, 255, 0.52)`,
    favIdleShadow: `inset 0 0 0 1px rgba(${rgbString}, 0.10)`,
    favActiveBg: `#FFFFFF`,
    favActiveShadow: `inset 0 0 0 1px rgba(${rgbString}, 0.30), 0 2px 8px rgba(${rgbString}, 0.14)`
  }
}
