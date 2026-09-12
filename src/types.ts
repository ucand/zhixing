export type NoteTag = 'idea' | 'quote' | 'limit' | 'try'

export interface Source {
  title: string
  author: string
  url: string
  contentId?: string
  voteUpCount?: number
}

export interface Note {
  id: string
  notebookId: string
  tag: NoteTag
  color?: string
  body: string
  createdAt: number
  selected: boolean
  source?: Source
}

export interface Notebook {
  id: string
  name: string
  color: string
}

export interface PaperTask {
  id: string
  text: string
  done: boolean
}

export interface PaperStage {
  id: string
  title: string
  period: string
  goal: string
  score: number
  tasks: PaperTask[]
  criterion: string
}

export interface Paper {
  id: string
  version: number
  createdAt: number
  notebookId: string
  noteIds: string[]
  question: string
  conditions: string[]
  references: string[]
  stages: PaperStage[]
  checkpoints: string[]
  comment: string
}

export interface AppState {
  notebooks: Notebook[]
  notes: Note[]
  papers: Paper[]
}

export interface ZhihuSearchItem {
  id: string
  title: string
  contentType: string
  contentText: string
  url: string
  authorName: string
  voteUpCount: number
  commentCount: number
  authorityLevel: string
}

export interface GeneratedPaperData {
  question: string
  conditions: string[]
  references: string[]
  stages: Array<Omit<PaperStage, 'id' | 'tasks'> & { tasks: string[] }>
  checkpoints: string[]
  comment: string
}
