/// <reference types="vite/client" />
import type { ApiWithEvents } from '@shared/types'

declare global {
  interface Window {
    api: ApiWithEvents
  }
}

export {}
