import type { ProtApi } from '../shared/ipc'

declare global {
  interface Window {
    prot: ProtApi
  }
}

export {}
