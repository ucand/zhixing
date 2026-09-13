import type { AppState, GeneratedPaperData, Note, Notebook, Paper, PaperTask, ZhihuSearchItem } from './types'

interface ApiErrorBody { error?: { code?: string; message?: string } }

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message) }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  } catch {
    throw new ApiError('API_OFFLINE', '后端服务未启动，请使用 pnpm dev 启动完整应用', 0)
  }
  if (response.status === 204) return undefined as T
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new ApiError('API_MISROUTED', '当前页面没有连接到知行 API，请使用 pnpm dev 或 pnpm start 启动完整应用', response.status)
  }
  const body = await response.json() as T & ApiErrorBody
  if (!response.ok) throw new ApiError(body.error?.code ?? 'API_ERROR', body.error?.message ?? '服务请求失败', response.status)
  return body
}

export async function searchZhihu(query: string, refresh = false): Promise<ZhihuSearchItem[]> {
  const refreshParam = refresh ? '&refresh=1' : ''
  const body = await request<{ items: ZhihuSearchItem[] }>(`/api/zhihu/search?q=${encodeURIComponent(query)}&count=6${refreshParam}`)
  return body.items
}

export async function migrateLocalState(state: { notebooks: unknown[]; notes: unknown[]; papers: unknown[] }): Promise<{ imported: { notebooks: number; notes: number; papers: number } }> {
  return request('/api/state/migrate', { method: 'POST', body: JSON.stringify(state) })
}

export async function getApiHealth(): Promise<{ database: string }> {
  return request('/api/health')
}

export async function loadRemoteState(): Promise<AppState> {
  return request<AppState>('/api/state')
}

export const createNotebookRemote = (input: Pick<Notebook, 'name' | 'color'>) => request<Notebook>('/api/notebooks', { method: 'POST', body: JSON.stringify(input) })
export const updateNotebookRemote = (id: string, input: Pick<Notebook, 'name' | 'color'>) => request<Notebook>(`/api/notebooks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
export const deleteNotebookRemote = (id: string) => request<void>(`/api/notebooks/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const createNoteRemote = (input: Omit<Note, 'id' | 'createdAt'>) => request<Note>('/api/notes', { method: 'POST', body: JSON.stringify(input) })
export const updateNoteRemote = (id: string, input: Pick<Note, 'tag' | 'color' | 'body' | 'selected'>) => request<Note>(`/api/notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) })
export const deleteNoteRemote = (id: string) => request<void>(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const deletePaperRemote = (id: string) => request<void>(`/api/papers/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const createPaperRemote = (paper: Paper) => request<Paper>('/api/papers', { method: 'POST', body: JSON.stringify(paper) })
export const updateTaskRemote = (id: string, completed: PaperTask['done']) => request<{ id: string; completed: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ completed }) })

export async function generatePaperWithAi(notes: Note[], notebookId: string, version: number): Promise<GeneratedPaperData> {
  const body = await request<{ paper: GeneratedPaperData }>('/api/papers/generate', {
    method: 'POST',
    body: JSON.stringify({
      notebookId,
      version,
      notes: notes.map(({ id, tag, body, source }) => ({ id, tag, body, source })),
    }),
  })
  return body.paper
}

export function hydratePaper(data: GeneratedPaperData, notebookId: string, version: number, noteIds: string[]): Paper {
  return {
    ...data,
    id: crypto.randomUUID(),
    notebookId,
    version,
    noteIds,
    createdAt: Date.now(),
    stages: data.stages.map((stage) => ({
      ...stage,
      id: crypto.randomUUID(),
      tasks: stage.tasks.map((text) => ({ id: crypto.randomUUID(), text, done: false })),
    })),
  }
}
