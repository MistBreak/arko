import React, { useId } from 'react'

interface Props {
  size?: number
  isDark?: boolean
  monochrome?: boolean
  className?: string
}

export const AppIcon: React.FC<Props> = ({
  size = 84,
  isDark = false,
  monochrome = false,
  className = ''
}) => {
  const uid = useId().replace(/:/g, '')
  const arcGradId = `arko-arc-${uid}`
  const liftId = `arko-lift-${uid}`
  const tileClipId = `arko-tile-${uid}`

  const tileFill = monochrome
    ? isDark
      ? '#232327'
      : '#FFFFFF'
    : '#F6F3EC'

  return (
    <svg
      width={size}
      height={size}
      viewBox="84 84 856 856"
      fill="none"
      aria-hidden
      className={className}
    >
      <defs>
        {monochrome ? (
          <linearGradient
            id={arcGradId}
            x1="321"
            y1="730"
            x2="730"
            y2="311"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor={isDark ? '#A1A1AA' : '#52525B'} />
            <stop offset="50%" stopColor={isDark ? '#E4E4E7' : '#27272A'} />
            <stop offset="100%" stopColor={isDark ? '#FAFAFA' : '#18181B'} />
          </linearGradient>
        ) : (
          <linearGradient
            id={arcGradId}
            x1="321"
            y1="730"
            x2="730"
            y2="311"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#4338CA" />
            <stop offset="46%" stopColor="#6366F1" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
        )}
        <filter id={liftId} x="-120%" y="-120%" width="340%" height="340%">
          <feDropShadow
            dx="0"
            dy="10.5"
            stdDeviation="8.4"
            floodColor={monochrome && isDark ? '#000000' : '#5C564C'}
            floodOpacity={monochrome && isDark ? '0.35' : '0.16'}
          />
        </filter>
        <clipPath id={tileClipId}>
          <rect x="84" y="84" width="856" height="856" rx="196" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${tileClipId})`}>
        <rect x="84" y="84" width="856" height="856" rx="196" fill={tileFill} />
        <g filter={`url(#${liftId})`}>
          <path
            d="M297.3 651.9 A222.3 222.3 0 1 1 726.7 651.9"
            stroke={`url(#${arcGradId})`}
            strokeWidth="184.6"
            strokeLinecap="round"
          />
        </g>
        <path
          d="M393.1 339.4 A281.3 281.3 0 0 1 630.9 339.4"
          stroke="#FFFFFF"
          strokeOpacity={monochrome ? (isDark ? '0.32' : '0.24') : '0.42'}
          strokeWidth="14.7"
          strokeLinecap="round"
        />
        {monochrome && (
          <rect
            x="90"
            y="90"
            width="844"
            height="844"
            rx="190"
            stroke={isDark ? '#FFFFFF' : '#000000'}
            strokeOpacity={isDark ? '0.09' : '0.07'}
            strokeWidth="12"
          />
        )}
      </g>
    </svg>
  )
}
