import type { AppState, Note, Paper, PaperStage, PaperTask } from '../src/types.js'
import { pool } from './db.js'
import { buildMigrationPlan } from './migration.js'

const requirePool = () => {
  if (!pool) throw new Error('DATABASE_URL 未配置')
  return pool
}

async function userId(client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> }) {
  const found = await client.query('select id from app_user order by created_at asc limit 1')
  if (found.rows[0]) return found.rows[0].id
  const created = await client.query("insert into app_user (display_name) values ('未来的我') returning id")
  return created.rows[0].id
}

export async function readState(uid: string): Promise<AppState> {
  const db = requirePool()
  const client = await db.connect()
  try {
    const notebooks = await client.query('select id, name, color from notebook where user_id = $1 order by position asc, created_at asc', [uid])
    const notes = await client.query(`select n.id, n.notebook_id, n.tag, n.color, n.body, n.selected, n.created_at, n.source_title, n.source_author, n.source_url, n.source_content_id, n.source_vote_count from note n join notebook b on b.id=n.notebook_id where b.user_id=$1 order by n.created_at desc`, [uid])
    const papers = await client.query(`select p.id, p.notebook_id, p.version, p.created_at, p.question, p.conditions, p.reference_materials, p.checkpoints, p.marker_comment from paper p join notebook b on b.id=p.notebook_id where b.user_id=$1 order by p.created_at asc`, [uid])
    const stages = await client.query('select s.id, s.paper_id, s.position, s.title, s.period, s.goal, s.score, s.criterion from paper_stage s join paper p on p.id=s.paper_id join notebook b on b.id=p.notebook_id where b.user_id=$1 order by s.paper_id, s.position', [uid])
    const tasks = await client.query('select t.id, t.stage_id, t.position, t.body, t.completed from paper_task t join paper_stage s on s.id=t.stage_id join paper p on p.id=s.paper_id join notebook b on b.id=p.notebook_id where b.user_id=$1 order by t.stage_id, t.position', [uid])
    const paperNotes = await client.query('select pn.paper_id, pn.note_id from paper_note pn join paper p on p.id=pn.paper_id join notebook b on b.id=p.notebook_id where b.user_id=$1', [uid])
    const stageMap = new Map<string, PaperStage[]>()
    for (const row of stages.rows) stageMap.set(row.paper_id, [...(stageMap.get(row.paper_id) ?? []), { id: row.id, title: row.title, period: row.period, goal: row.goal, score: row.score, criterion: row.criterion, tasks: [] }])
    for (const row of tasks.rows) {
      const stage = [...stageMap.values()].flat().find((item) => item.id === row.stage_id)
      if (stage) stage.tasks.push({ id: row.id, text: row.body, done: row.completed })
    }
    return {
      notebooks: notebooks.rows.map((row) => ({ id: row.id, name: row.name, color: row.color })),
      notes: notes.rows.map((row) => ({ id: row.id, notebookId: row.notebook_id, tag: row.tag, ...(row.color ? { color: row.color } : {}), body: row.body, selected: row.selected, createdAt: new Date(row.created_at).getTime(), ...(row.source_title ? { source: { title: row.source_title, author: row.source_author, url: row.source_url, contentId: row.source_content_id ?? undefined, voteUpCount: row.source_vote_count ?? undefined } } : {}) })),
      papers: papers.rows.map((row) => ({ id: row.id, version: row.version, createdAt: new Date(row.created_at).getTime(), notebookId: row.notebook_id, noteIds: paperNotes.rows.filter((link) => link.paper_id === row.id).map((link) => link.note_id), question: row.question, conditions: row.conditions, references: row.reference_materials, stages: stageMap.get(row.id) ?? [], checkpoints: row.checkpoints, comment: row.marker_comment })),
    }
  } finally { client.release() }
}

export async function migrateState(state: AppState, uid: string): Promise<{ imported: { notebooks: number; notes: number; papers: number } }> {
  const db = requirePool()
  const client = await db.connect()
  const plan = buildMigrationPlan(state)
  try {
    await client.query('begin')
    for (const book of plan.notebooks) await client.query('insert into notebook (id, user_id, name, color, position) values ($1, $2, $3, $4, $5) on conflict (id) do nothing', [book.id, uid, book.name, book.color, book.position])
    for (const item of plan.notes) await client.query('insert into note (id, notebook_id, tag, color, body, selected, source_title, source_author, source_url, source_content_id, source_vote_count, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,to_timestamp($12 / 1000.0)) on conflict (id) do nothing', [item.id, item.notebookId, item.note.tag, item.note.color ?? null, item.note.body, item.note.selected, item.note.source?.title ?? null, item.note.source?.author ?? null, item.note.source?.url ?? null, item.note.source?.contentId ?? null, item.note.source?.voteUpCount ?? null, item.note.createdAt])
    for (const item of plan.papers) {
      await client.query('insert into paper (id, notebook_id, version, question, conditions, reference_materials, checkpoints, marker_comment, generation_status, provider, source_snapshot, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,to_timestamp($12 / 1000.0)) on conflict (id) do nothing', [item.id, item.notebookId, item.paper.version, item.paper.question, JSON.stringify(item.paper.conditions), JSON.stringify(item.paper.references), JSON.stringify(item.paper.checkpoints), item.paper.comment, 'succeeded', 'local-migration', JSON.stringify(item.paper.noteIds), item.paper.createdAt])
      for (const [position, stage] of item.paper.stages.entries()) {
        const stageId = plan.stages.find((candidate) => candidate.stage.id === stage.id)?.id
        if (!stageId) continue
        await client.query('insert into paper_stage (id, paper_id, position, title, period, goal, score, criterion) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do nothing', [stageId, item.id, position, stage.title, stage.period, stage.goal, stage.score, stage.criterion])
        for (const [taskPosition, task] of stage.tasks.entries()) {
          const taskId = plan.tasks.find((candidate) => candidate.task.id === task.id)?.id
          if (taskId) await client.query('insert into paper_task (id, stage_id, position, body, completed) values ($1,$2,$3,$4,$5) on conflict (id) do nothing', [taskId, stageId, taskPosition, task.text, task.done])
        }
      }
    }
    for (const link of plan.paperNotes) await client.query('insert into paper_note (paper_id, note_id) values ($1,$2) on conflict do nothing', [link.paperId, link.noteId])
    await client.query('commit')
    return { imported: { notebooks: plan.notebooks.length, notes: plan.notes.length, papers: plan.papers.length } }
  } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
}

export async function deleteNotebook(id: string, uid: string): Promise<void> {
  const db = requirePool(); const client = await db.connect()
  try {
    await client.query('begin')
    await client.query('delete from paper_note where paper_id in (select id from paper where notebook_id = $1) and exists (select 1 from notebook where id=$1 and user_id=$2)', [id, uid])
    await client.query('delete from notebook where id = $1 and user_id=$2', [id, uid])
    await client.query('commit')
  } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
}
export async function deleteNote(id: string, uid: string): Promise<void> {
  const db = requirePool(); const client = await db.connect()
  try {
    await client.query('begin')
    // A note may be referenced by one or more answer papers. The FK is
    // intentionally RESTRICT, so remove only the join rows first and keep
    // the answer papers themselves intact.
    await client.query('delete from paper_note where note_id = $1 and exists (select 1 from note n join notebook b on b.id=n.notebook_id where n.id=$1 and b.user_id=$2)', [id, uid])
    await client.query('delete from note n using notebook b where n.id=$1 and n.notebook_id=b.id and b.user_id=$2', [id, uid])
    await client.query('commit')
  } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
}
export async function deletePaper(id: string, uid: string): Promise<void> { const db = requirePool(); await db.query('delete from paper p using notebook b where p.id=$1 and p.notebook_id=b.id and b.user_id=$2', [id, uid]) }

export async function createPaper(paper: Paper, uid: string): Promise<void> {
  const db = requirePool(); const client = await db.connect()
  try {
    await client.query('begin')
    await client.query('insert into paper (id, notebook_id, version, question, conditions, reference_materials, checkpoints, marker_comment, generation_status, provider, source_snapshot, created_at) select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,to_timestamp($12 / 1000.0) where exists (select 1 from notebook where id=$2 and user_id=$13)', [paper.id, paper.notebookId, paper.version, paper.question, JSON.stringify(paper.conditions), JSON.stringify(paper.references), JSON.stringify(paper.checkpoints), paper.comment, 'succeeded', 'zhida-frontend', JSON.stringify(paper.noteIds), paper.createdAt, uid])
    for (const [position, stage] of paper.stages.entries()) {
      await client.query('insert into paper_stage (id, paper_id, position, title, period, goal, score, criterion) values ($1,$2,$3,$4,$5,$6,$7,$8)', [stage.id, paper.id, position, stage.title, stage.period, stage.goal, stage.score, stage.criterion])
      for (const [taskPosition, task] of stage.tasks.entries()) await client.query('insert into paper_task (id, stage_id, position, body, completed, completed_at) values ($1,$2,$3,$4,$5,case when $5 then now() else null end)', [task.id, stage.id, taskPosition, task.text, task.done])
    }
    for (const noteId of paper.noteIds) await client.query('insert into paper_note (paper_id, note_id) values ($1,$2)', [paper.id, noteId])
    await client.query('commit')
  } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
}

export async function createNotebook(input: { name: string; color: string }, uid: string) {
  const db = requirePool(); const client = await db.connect()
  try { const result = await client.query('insert into notebook (user_id, name, color, position) values ($1,$2,$3,(select coalesce(max(position), -1) + 1 from notebook where user_id = $1)) returning id, name, color', [uid, input.name, input.color]); return result.rows[0] }
  finally { client.release() }
}

export async function updateNotebook(id: string, input: { name: string; color: string }, uid: string) {
  const db = requirePool(); const result = await db.query('update notebook set name=$2, color=$3, updated_at=now() where id=$1 and user_id=$4 returning id, name, color', [id, input.name, input.color, uid]); return result.rows[0]
}

export async function createNote(input: { notebookId: string; tag: Note['tag']; color?: string; body: string; selected?: boolean; source?: Note['source'] }, uid: string) {
  const db = requirePool(); const result = await db.query('insert into note (notebook_id, tag, color, body, selected, source_title, source_author, source_url, source_content_id, source_vote_count) select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 where exists (select 1 from notebook where id=$1 and user_id=$11) returning id, notebook_id as "notebookId", tag, color, body, selected, extract(epoch from created_at) * 1000 as "createdAt"', [input.notebookId, input.tag, input.color ?? null, input.body, input.selected ?? false, input.source?.title ?? null, input.source?.author ?? null, input.source?.url ?? null, input.source?.contentId ?? null, input.source?.voteUpCount ?? null, uid]); if (!result.rows[0]) throw new Error('笔记本不存在或不属于当前用户'); return { ...result.rows[0], createdAt: Number(result.rows[0].createdAt) }
}

export async function updateNote(id: string, input: { tag: Note['tag']; color?: string; body: string; selected?: boolean }, uid: string) {
  const db = requirePool(); const result = await db.query('update note n set tag=$2, color=coalesce($3, n.color), body=$4, selected=coalesce($5, n.selected), updated_at=now() from notebook b where n.id=$1 and n.notebook_id=b.id and b.user_id=$6 returning n.id, n.notebook_id as "notebookId", n.tag, n.color, n.body, n.selected, extract(epoch from n.created_at) * 1000 as "createdAt"', [id, input.tag, input.color ?? null, input.body, input.selected ?? null, uid]); return result.rows[0] ? { ...result.rows[0], createdAt: Number(result.rows[0].createdAt) } : result.rows[0]
}

export async function updateTask(id: string, completed: boolean, uid: string) {
  const db = requirePool(); const result = await db.query('update paper_task t set completed=$2, completed_at=case when $2 then now() else null end from paper_stage s join paper p on p.id=s.paper_id join notebook b on b.id=p.notebook_id where t.id=$1 and t.stage_id=s.id and b.user_id=$3 returning t.id, t.completed', [id, completed, uid]); return result.rows[0]
}
