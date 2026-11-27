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

function mixRgbaCss(
  base: [number, number, number],
  tint: [number, number, number],
  weight: number,
  alpha: number
): string {
  const w = Math.max(0, Math.min(1, weight))
  const r = Math.round(base[0] * (1 - w) + tint[0] * w)
  const g = Math.round(base[1] * (1 - w) + tint[1] * w)
  const b = Math.round(base[2] * (1 - w) + tint[2] * w)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
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
  const vibrantPresets = PROFILE_ACCENT_PRESETS.filter((p) => {
    const hex = normalizeSpaceHex(p.hex)
    return hex !== '#64748B' && hex !== '#52525B'
  })
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
    // Calm Dia-inspired translucent obsidian glass base with subtle profile atmosphere
    const isNeutral = Math.max(r, g, b) - Math.min(r, g, b) < 24
    const topWeight = isNeutral ? 0.08 : 0.17
    const midWeight = isNeutral ? 0.04 : 0.10
    const botWeight = isNeutral ? 0.02 : 0.05

    const topMix = mixRgbaCss([20, 20, 23], rgb, topWeight, 0.78)
    const midMix = mixRgbaCss([19, 19, 22], rgb, midWeight, 0.82)
    const botMix = mixRgbaCss([18, 18, 20], rgb, botWeight, 0.86)

    const barLeft = mixRgbaCss([20, 20, 23], rgb, isNeutral ? 0.06 : 0.14, 0.78)
    const barMid = mixRgbaCss([20, 20, 23], rgb, isNeutral ? 0.04 : 0.08, 0.82)
    const barRight = mixRgbaCss([20, 20, 22], rgb, isNeutral ? 0.02 : 0.04, 0.85)

    const horizTop = mixRgbaCss([19, 19, 22], rgb, isNeutral ? 0.08 : 0.16, 0.80)
    const horizBot = mixRgbaCss([20, 20, 24], rgb, isNeutral ? 0.04 : 0.09, 0.85)

    return {
      accentHex: norm,
      rgb,
      rgbString,
      sidebarBackground: `radial-gradient(135% 52% at 16% 0%, rgba(${rgbString}, ${isNeutral ? 0.10 : 0.20}) 0%, rgba(${rgbString}, 0) 72%), linear-gradient(175deg, ${topMix} 0%, ${midMix} 54%, ${botMix} 100%)`,
      sidebarBorderColor: isNeutral ? 'rgba(255, 255, 255, 0.09)' : `rgba(${rgbString}, 0.20)`,
      topBarBackground: `linear-gradient(90deg, ${barLeft} 0%, ${barMid} 52%, ${barRight} 100%)`,
      topBarBorderColor: isNeutral ? 'rgba(255, 255, 255, 0.07)' : `rgba(${rgbString}, 0.14)`,
      horizontalHeaderBackground: `linear-gradient(180deg, ${horizTop} 0%, ${horizBot} 100%)`,
      dividerColor: isNeutral ? 'rgba(255, 255, 255, 0.075)' : `rgba(${rgbString}, 0.17)`,
      spaceBadgeBg: isNeutral ? 'rgba(255, 255, 255, 0.10)' : `rgba(${rgbString}, 0.20)`,
      spaceBadgeBorder: isNeutral ? 'rgba(255, 255, 255, 0.16)' : `rgba(${rgbString}, 0.38)`,
      hudBackground: mixRgbaCss([26, 26, 30], rgb, isNeutral ? 0.10 : 0.20, 0.92),
      hudBorderColor: isNeutral ? 'rgba(255, 255, 255, 0.16)' : `rgba(${rgbString}, 0.36)`,
      activeTabBg: `rgba(255, 255, 255, 0.11)`,
      activeTabShadow: isNeutral
        ? `inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 0 0 1px rgba(255, 255, 255, 0.08), 0 2px 8px rgba(0, 0, 0, 0.24)`
        : `inset 0 1px 0 rgba(255, 255, 255, 0.16), inset 0 0 0 1px rgba(${rgbString}, 0.26), 0 2px 8px rgba(0, 0, 0, 0.24)`,
      favIdleBg: `radial-gradient(120% 95% at 50% 0%, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0) 70%), linear-gradient(180deg, rgba(255, 255, 255, 0.095) 0%, rgba(255, 255, 255, 0.038) 100%)`,
      favIdleShadow: `0 4px 12px -2px rgba(0, 0, 0, 0.32), 0 1px 2px rgba(0, 0, 0, 0.20), inset 0 1px 0.5px rgba(255, 255, 255, 0.18)`,
      favActiveBg: `radial-gradient(125% 100% at 50% 0%, rgba(255, 255, 255, 0.24) 0%, rgba(255, 255, 255, 0.06) 76%), linear-gradient(180deg, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0.09) 100%)`,
      favActiveShadow: isNeutral
        ? `0 6px 16px -3px rgba(0, 0, 0, 0.42), 0 2px 5px rgba(0, 0, 0, 0.26), inset 0 1px 0.5px rgba(255, 255, 255, 0.32)`
        : `0 6px 16px -3px rgba(0, 0, 0, 0.42), 0 2px 6px rgba(${rgbString}, 0.20), inset 0 1px 0.5px rgba(255, 255, 255, 0.34)`
    }
  }

  const isLightNeutral = Math.max(r, g, b) - Math.min(r, g, b) < 24
  const topMix = mixRgbaCss([242, 243, 247], rgb, isLightNeutral ? 0.11 : 0.155, 0.76)
  const midMix = mixRgbaCss([244, 245, 248], rgb, isLightNeutral ? 0.075 : 0.105, 0.80)
  const botMix = mixRgbaCss([245, 246, 249], rgb, isLightNeutral ? 0.055 : 0.075, 0.84)

  const barLeft = mixRgbaCss([243, 244, 248], rgb, isLightNeutral ? 0.095 : 0.135, 0.76)
  const barMid = mixRgbaCss([246, 247, 250], rgb, isLightNeutral ? 0.06 : 0.08, 0.80)
  const barRight = mixRgbaCss([249, 249, 251], rgb, isLightNeutral ? 0.035 : 0.045, 0.84)

  const horizTop = mixRgbaCss([243, 244, 248], rgb, isLightNeutral ? 0.105 : 0.15, 0.78)
  const horizBot = mixRgbaCss([247, 247, 250], rgb, isLightNeutral ? 0.065 : 0.09, 0.84)

  return {
    accentHex: norm,
    rgb,
    rgbString,
    sidebarBackground: `radial-gradient(130% 56% at 16% 0%, rgba(${rgbString}, ${isLightNeutral ? 0.10 : 0.16}) 0%, rgba(${rgbString}, 0) 72%), linear-gradient(170deg, ${topMix} 0%, ${midMix} 54%, ${botMix} 100%)`,
    sidebarBorderColor: `rgba(${rgbString}, 0.16)`,
    topBarBackground: `linear-gradient(90deg, ${barLeft} 0%, ${barMid} 52%, ${barRight} 100%)`,
    topBarBorderColor: `rgba(${rgbString}, 0.14)`,
    horizontalHeaderBackground: `linear-gradient(180deg, ${horizTop} 0%, ${horizBot} 100%)`,
    dividerColor: isLightNeutral ? 'rgba(15, 23, 42, 0.075)' : `rgba(${rgbString}, 0.16)`,
    spaceBadgeBg: `rgba(${rgbString}, 0.13)`,
    spaceBadgeBorder: `rgba(${rgbString}, 0.28)`,
    hudBackground: mixRgbaCss([255, 255, 255], rgb, 0.12, 0.92),
    hudBorderColor: `rgba(${rgbString}, 0.28)`,
    activeTabBg: `rgba(255, 255, 255, 0.82)`,
    activeTabShadow: isLightNeutral
      ? `inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 0 0 1px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.06)`
      : `inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 0 0 1px rgba(${rgbString}, 0.18), 0 2px 7px -1px rgba(${rgbString}, 0.10)`,
    favIdleBg: `radial-gradient(125% 95% at 50% 0%, rgba(255, 255, 255, 0.74) 0%, rgba(255, 255, 255, 0) 70%), linear-gradient(180deg, rgba(255, 255, 255, 0.56) 0%, rgba(255, 255, 255, 0.24) 100%)`,
    favIdleShadow: `0 3px 10px -2px rgba(15, 23, 42, 0.055), 0 1px 2px rgba(15, 23, 42, 0.03), 0 0 0 0.5px rgba(15, 23, 42, 0.05), inset 0 1px 0.5px rgba(255, 255, 255, 0.92)`,
    favActiveBg: `radial-gradient(130% 100% at 50% 0%, rgba(255, 255, 255, 0.96) 0%, rgba(255, 255, 255, 0.58) 78%), linear-gradient(180deg, rgba(255, 255, 255, 0.90) 0%, rgba(255, 255, 255, 0.68) 100%)`,
    favActiveShadow: isLightNeutral
      ? `0 6px 16px -4px rgba(15, 23, 42, 0.11), 0 2px 5px -1px rgba(15, 23, 42, 0.05), 0 0 0 0.5px rgba(15, 23, 42, 0.07), inset 0 1px 0.5px #FFFFFF`
      : `0 6px 16px -4px rgba(${rgbString}, 0.18), 0 2px 5px -1px rgba(15, 23, 42, 0.05), 0 0 0 0.5px rgba(${rgbString}, 0.20), inset 0 1px 0.5px #FFFFFF`
  }
}
