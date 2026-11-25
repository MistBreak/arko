import React, { useState } from 'react'
import { Globe, MessageSquare } from 'lucide-react'
import { isChatTabUrl, NEW_TAB_URL } from '@shared/constants'

interface Props {
  url?: string
  favicon?: string
  size?: number
  className?: string
}

export const FaviconIcon: React.FC<Props> = ({ url, favicon, size = 14, className = '' }) => {
  const [failed, setFailed] = useState(false)

  if (!url || url === NEW_TAB_URL) {
    return (
      <span
        style={{ width: size, height: size }}
        className={`inline-flex items-center justify-center shrink-0 opacity-65 ${className}`}
      >
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.3" />
          <path
            d="M3.2 10.2C4.3 8.1 6.1 7 8 7C9.9 7 11.7 8.1 12.8 10.2"
            stroke="currentColor"
            strokeOpacity="0.75"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </span>
    )
  }

  if (isChatTabUrl(url)) {
    return <MessageSquare size={size} className={`opacity-65 shrink-0 ${className}`} />
  }

  if (favicon && !failed) {
    return (
      <img
        src={favicon}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className={`rounded-[3.5px] object-contain shrink-0 ${className}`}
      />
    )
  }

  return <Globe size={size} className={`opacity-55 shrink-0 ${className}`} />
}
