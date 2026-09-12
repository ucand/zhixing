import crypto from 'node:crypto'
import type { AppState, Note, Paper, PaperStage, PaperTask } from '../src/types.js'

export interface MigrationPlan {
  userId: string
  notebooks: Array<{ id: string; legacyId: string; name: string; color: string; position: number }>
  notes: Array<{ id: string; legacyId: string; notebookId: string; note: Note }>
  papers: Array<{ id: string; legacyId: string; notebookId: string; paper: Paper }>
  stages: Array<{ id: string; paperId: string; position: number; stage: PaperStage }>
  tasks: Array<{ id: string; stageId: string; position: number; task: PaperTask }>
  paperNotes: Array<{ paperId: string; noteId: string }>
}

const uuid = () => crypto.randomUUID()

/** Convert localStorage IDs into database UUIDs without mutating the browser state. */
export function buildMigrationPlan(state: AppState, userId = uuid()): MigrationPlan {
  const notebookIds = new Map(state.notebooks.map((notebook) => [notebook.id, uuid()]))
  const noteIds = new Map(state.notes.map((note) => [note.id, uuid()]))
  const paperIds = new Map(state.papers.map((paper) => [paper.id, uuid()]))
  const stageIds = new Map(state.papers.flatMap((paper) => paper.stages.map((stage) => [stage.id, uuid()] as const)))
  const taskIds = new Map(state.papers.flatMap((paper) => paper.stages.flatMap((stage) => stage.tasks.map((task) => [task.id, uuid()] as const))))

  return {
    userId,
    notebooks: state.notebooks.map((notebook, position) => ({ id: notebookIds.get(notebook.id)!, legacyId: notebook.id, name: notebook.name, color: notebook.color, position })),
    notes: state.notes.map((note) => ({ id: noteIds.get(note.id)!, legacyId: note.id, notebookId: notebookIds.get(note.notebookId)!, note })),
    papers: state.papers.map((paper) => ({ id: paperIds.get(paper.id)!, legacyId: paper.id, notebookId: notebookIds.get(paper.notebookId)!, paper })),
    stages: state.papers.flatMap((paper) => paper.stages.map((stage, position) => ({ id: stageIds.get(stage.id)!, paperId: paperIds.get(paper.id)!, position, stage }))),
    tasks: state.papers.flatMap((paper) => paper.stages.flatMap((stage) => stage.tasks.map((task, position) => ({ id: taskIds.get(task.id)!, stageId: stageIds.get(stage.id)!, position, task })))),
    paperNotes: state.papers.flatMap((paper) => paper.noteIds.flatMap((noteId) => {
      const paperId = paperIds.get(paper.id)
      const mappedNoteId = noteIds.get(noteId)
      return paperId && mappedNoteId ? [{ paperId, noteId: mappedNoteId }] : []
    })),
  }
}
