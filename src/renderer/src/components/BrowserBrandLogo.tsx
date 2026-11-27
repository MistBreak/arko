import React from 'react'
import type { ImportBrowserId } from '@shared/types'

/**
 * Compact brand marks for the import picker.
 * Arc is the two-tone arch (blue leg, pink crown). Dia is the black tile with a white sunrise.
 * The other marks are simplified geometric versions of each browser's public icon.
 */
const BrowserBrandLogo: React.FC<{ id: ImportBrowserId; size?: number }> = ({ id, size = 36 }) => {
  switch (id) {
    case 'arc':
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="#F4F5F7" stroke="#000" strokeOpacity="0.08" />
          <path
            d="M12.2 33.6 A11.8 11.8 0 0 0 35.8 33.6"
            stroke="url(#imp-arc-arch)"
            strokeWidth="8.2"
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="imp-arc-arch" x1="11" y1="34" x2="37" y2="14" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#17017A" />
              <stop offset="22%" stopColor="#2441C5" />
              <stop offset="42%" stopColor="#ED6E7C" />
              <stop offset="100%" stopColor="#F3A3AC" />
            </linearGradient>
          </defs>
        </svg>
      )
    case 'dia':
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="#0A0A0A" stroke="#FFF" strokeOpacity="0.14" />
          <circle cx="24" cy="21.2" r="12.4" fill="#FFFFFF" />
          <ellipse cx="24" cy="35.4" rx="14.2" ry="8.4" fill="#0A0A0A" />
        </svg>
      )
    case 'chrome':
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="#FFFFFF" stroke="#000" strokeOpacity="0.08" />
          <g transform="translate(24 24)">
            <path d="M0 0 L-12.99 -7.5 A15 15 0 0 1 12.99 -7.5 Z" fill="#EA4335" />
            <path d="M0 0 L12.99 -7.5 A15 15 0 0 1 0 15 Z" fill="#34A853" />
            <path d="M0 0 L0 15 A15 15 0 0 1 -12.99 -7.5 Z" fill="#FBBC05" />
            <circle r="8.1" fill="#FFFFFF" />
            <circle r="6.15" fill="#4285F4" />
          </g>
        </svg>
      )
    case 'edge':
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="#FFFFFF" stroke="#000" strokeOpacity="0.08" />
          <path
            d="M16.2 33.8c1.4 4.6 8.8 7.2 15.6 4.1 8.2-3.7 10.4-13.2 5.2-19.6C33.2 13.2 25.2 10.2 18.4 14.6"
            stroke="url(#imp-edge-wave)"
            strokeWidth="5.4"
            strokeLinecap="round"
          />
          <path
            d="M14.6 26.2h15.8c.2 4.6-3.4 7.6-8.2 7.6-3.8 0-6.6-1.8-7.6-4.4"
            stroke="#0C59A4"
            strokeWidth="4.6"
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="imp-edge-wave" x1="14" y1="36" x2="38" y2="12" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#36C752" />
              <stop offset="42%" stopColor="#1B9DE2" />
              <stop offset="100%" stopColor="#0C59A4" />
            </linearGradient>
          </defs>
        </svg>
      )
    case 'safari':
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="#FFFFFF" stroke="#000" strokeOpacity="0.08" />
          <circle cx="24" cy="24" r="14.2" fill="#F7F8FA" stroke="#D7D9DE" />
          <circle cx="24" cy="24" r="12.4" stroke="#1C7CF6" strokeWidth="1.3" />
          <path d="M24 13.2v2.2M24 32.6v2.2M13.2 24h2.2M32.6 24h2.2" stroke="#8E939C" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M24 14.8 L26.1 24 L24 26.2 L21.9 24 Z" fill="#FF3B30" />
          <path d="M24 33.2 L21.9 24 L24 21.8 L26.1 24 Z" fill="#E4E5E8" />
          <circle cx="24" cy="24" r="1.7" fill="#1C1C1E" />
        </svg>
      )
    case 'firefox':
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="#FFFFFF" stroke="#000" strokeOpacity="0.08" />
          <circle cx="24" cy="24" r="15" fill="#FF7139" />
          <path
            d="M13.5 28.5c1.2-9.5 8.2-14.2 15.2-12.2 1.6 4.2-.6 7.6-4.8 9.2 5.4.6 9.6 3.4 11.2 8.2-6.4 5.4-16.6 5.2-21.6-5.2z"
            fill="#3A1D6E"
          />
          <path
            d="M18.2 27.2c1.4-6.4 6.4-9.4 11.2-7.6.4 3.2-1.6 5.4-4.6 6.4 3.8.6 6.6 2.6 7.8 5.6-4.2 2.8-10.2 3.2-14.4-4.4z"
            fill="#FFD43B"
          />
          <path
            d="M21.5 26.4c1.6-3.2 4.4-4.4 6.6-3.4-.2 1.8-1.4 2.8-3 3.2 1.8.4 3.2 1.4 3.6 2.8-2.2 1.2-5 1.2-7.2-2.6z"
            fill="#FF7139"
          />
        </svg>
      )
    case 'brave':
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="#FB542B" />
          <path d="M15.2 21.2 L18.4 12.4 L22.6 19.6 Z" fill="#FFFFFF" />
          <path d="M32.8 21.2 L29.6 12.4 L25.4 19.6 Z" fill="#FFFFFF" />
          <circle cx="24" cy="26.2" r="8.4" fill="#FFFFFF" />
          <circle cx="21.1" cy="25.2" r="1.15" fill="#FB542B" />
          <circle cx="26.9" cy="25.2" r="1.15" fill="#FB542B" />
          <path d="M24 26.6 L22.2 29.2 H25.8 Z" fill="#FB542B" />
          <path d="M20.2 31.2c1.1 1.3 2.4 1.9 3.8 1.9s2.7-.6 3.8-1.9" stroke="#FB542B" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      )
    case 'opera':
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="#FFFFFF" stroke="#000" strokeOpacity="0.08" />
          <circle cx="24" cy="24" r="15" fill="#FF1B2D" />
          <path
            d="M27.2 13.6c5.6 2.2 8.6 6.6 8.6 10.4 0 3.8-3 8.2-8.6 10.4-1.2-2.4-1.8-6-1.8-10.4s.6-8 1.8-10.4z"
            fill="#C40018"
          />
          <ellipse cx="22.2" cy="24" rx="6.3" ry="9.4" fill="#FFFFFF" />
        </svg>
      )
    case 'vivaldi':
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="#FFFFFF" stroke="#000" strokeOpacity="0.08" />
          <circle cx="24" cy="24" r="15" fill="#EF3939" />
          <path
            d="M15.6 16.2 L24 33.2 L32.4 16.2"
            stroke="#FFFFFF"
            strokeWidth="3.3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'chromium':
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <rect x="1.5" y="1.5" width="45" height="45" rx="12" fill="#FFFFFF" stroke="#000" strokeOpacity="0.08" />
          <g transform="translate(24 24)">
            <path d="M0 0 L-7.5 -12.99 A15 15 0 0 1 14.1 5.1 Z" fill="#4C8BF5" />
            <path d="M0 0 L14.1 5.1 A15 15 0 0 1 -4.6 14.3 Z" fill="#EA4335" />
            <path d="M0 0 L-4.6 14.3 A15 15 0 0 1 -7.5 -12.99 Z" fill="#34A853" />
            <circle r="8.1" fill="#FFFFFF" />
            <circle r="6.15" fill="#7BAAF7" />
          </g>
        </svg>
      )
  }
}

export { BrowserBrandLogo }
