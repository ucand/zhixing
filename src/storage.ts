import { initialState } from './data'
import type { AppState } from './types'

const KEY = 'zhixing-app-v1'

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as AppState : initialState
  } catch {
    return initialState
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(KEY, JSON.stringify(state))
}
