import type { AppLanguage, MemoryItem } from './types'

export function resolveLang(lang?: AppLanguage | null): AppLanguage {
  return lang === 'zh-CN' ? 'zh-CN' : 'en'
}

export function tr(lang: AppLanguage | undefined | null, en: string, zh: string): string {
  return lang === 'zh-CN' ? zh : en
}

export function getTimeGreeting(lang?: AppLanguage): string {
  const hour = new Date().getHours()
  if (lang === 'zh-CN') {
    if (hour < 6) return '夜深了，想查点什么或聊聊思路？'
    if (hour < 12) return '早上好，今天想探索或推进什么？'
    if (hour < 18) return '下午好，接下来处理哪件事？'
    return '晚上好，想复盘、检索还是随便聊聊？'
  }
  if (hour < 6) return 'Late night — what would you like to explore or think through?'
  if (hour < 12) return 'Good morning — what are we building or researching today?'
  if (hour < 18) return 'Good afternoon — where should we focus next?'
  return 'Good evening — ready to review, search, or think together?'
}

export function getMemoryCategoryLabel(
  category: MemoryItem['category'],
  lang?: AppLanguage
): string {
  if (lang === 'zh-CN') {
    switch (category) {
      case 'preference':
        return '偏好习惯'
      case 'project':
        return '当前项目'
      case 'tone':
        return '沟通口吻'
      case 'fact':
        return '个人背景'
    }
  }
  switch (category) {
    case 'preference':
      return 'Preference'
    case 'project':
      return 'Project'
    case 'tone':
      return 'Writing Tone'
    case 'fact':
      return 'Background'
  }
}
