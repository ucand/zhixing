import { initialState } from './data'
import type { AppState } from './types'

const KEY_PREFIX = 'zhixing-app-v1'
const LEGACY_KEY = 'zhixing-app-v1'

function key(scope = 'anonymous') { return `${KEY_PREFIX}:${scope}` }

export function loadState(scope = 'anonymous'): AppState {
  try {
    const raw = localStorage.getItem(key(scope)) ?? (scope === 'anonymous' ? localStorage.getItem(LEGACY_KEY) : null)
    return raw ? JSON.parse(raw) as AppState : initialState
  } catch {
    return initialState
  }
}

export function saveState(state: AppState, scope = 'anonymous'): void {
  localStorage.setItem(key(scope), JSON.stringify(state))
}
