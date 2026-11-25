import type { ArkoAPI } from '@shared/types'

declare global {
  interface Window {
    arko: ArkoAPI
    dia: ArkoAPI
  }
}
