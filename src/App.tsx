import { useEffect, useMemo, useState } from 'react'
import { generatePaper, NOTE_COLORS, TAGS } from './data'
import { createNotebookRemote, createNoteRemote, createPaperRemote, deleteNotebookRemote, deleteNoteRemote, deletePaperRemote, generatePaperWithAi, getApiHealth, hydratePaper, loadRemoteState, migrateLocalState, searchZhihu, updateNotebookRemote, updateNoteRemote, updateTaskRemote } from './api'
import { loadState, saveState } from './storage'
import type { AppState, Note, NoteTag, Paper, Source, ZhihuSearchItem } from './types'

type Page = 'notes' | 'papers'
type EditorState = { id?: string; tag: Exclude<NoteTag, 'quote'>; color: string; body: string } | null

const Icon = ({ name }: { name: 'note' | 'paper' | 'plus' | 'search' | 'edit' | 'trash' | 'arrow' | 'print' | 'back' }) => {
  const paths = {
    note: <><path d="M5 3h11l3 3v15H5z"/><path d="M15 3v4h4M8 11h8M8 15h8"/></>,
    paper: <><path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5M9 12h7M9 16h7"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
    edit: <><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10z"/><path d="m13.5 6.5 3.5 3.5"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    print: <><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></>,
    back: <><path d="m15 18-6-6 6-6"/></>,
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

const formatDate = (timestamp: number) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(timestamp)
const id = () => crypto.randomUUID()
const chineseNumber = (value: number) => {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (value < 10) return digits[value]
  if (value < 20) return `十${value % 10 ? digits[value % 10] : ''}`
  if (value < 100) return `${digits[Math.floor(value / 10)]}十${value % 10 ? digits[value % 10] : ''}`
  return String(value)
}

const paperProgress = (paper: Paper) => paper.stages.reduce(
  (sum, stage) => sum + (stage.tasks.every((task) => task.done) ? stage.score : 0),
  0,
)

const uniqueSearchItems = (items: ZhihuSearchItem[]) => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.id || item.url || `${item.title}:${item.authorName}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function App() {
  const [state, setState] = useState<AppState>(loadState)
  const [page, setPage] = useState<Page>('notes')
  const [notebookId, setNotebookId] = useState(state.notebooks[0]?.id ?? '')
  const [paperId, setPaperId] = useState<string | null>(state.papers[0]?.id ?? null)
  const [editor, setEditor] = useState<EditorState>(null)
  const [excerptOpen, setExcerptOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generationNotice, setGenerationNotice] = useState<string | null>(null)
  const [confirmingSubmit, setConfirmingSubmit] = useState(false)
  const [databaseReady, setDatabaseReady] = useState(false)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)

  useEffect(() => saveState(state), [state])

  useEffect(() => {
    let mounted = true
    const syncDatabase = async () => {
      try {
        const health = await getApiHealth()
        if (health.database !== 'connected') return
        if (mounted) setDatabaseReady(true)
        const localState = loadState()
        const remoteState = await loadRemoteState()
        if (remoteState.notebooks.length || remoteState.notes.length || remoteState.papers.length) {
          if (mounted) {
            setState(remoteState)
            setNotebookId(remoteState.notebooks[0]?.id ?? '')
            setPaperId(remoteState.papers[0]?.id ?? null)
          }
        } else if (localState.notebooks.length || localState.notes.length || localState.papers.length) {
          await migrateLocalState(localState)
          const migrated = await loadRemoteState()
          if (mounted) {
            setState(migrated)
            setNotebookId(migrated.notebooks[0]?.id ?? '')
            setPaperId(migrated.papers[0]?.id ?? null)
          }
        }
      } catch (error) {
        if (mounted) setDatabaseReady(false)
        if (mounted && error instanceof Error && !error.message.includes('DATABASE_URL')) setSyncNotice(`数据库同步暂不可用：${error.message}`)
      }
    }
    void syncDatabase()
    return () => { mounted = false }
  }, [])

  const notes = useMemo(() => state.notes.filter((note) => note.notebookId === notebookId), [state.notes, notebookId])
  const selected = notes.filter((note) => note.selected)
  const paper = state.papers.find((item) => item.id === paperId) ?? state.papers.filter((item) => item.notebookId === notebookId).at(-1)

  const update = (fn: (current: AppState) => AppState) => setState((current) => fn(current))

  const reportSyncFailure = (error: unknown) => setSyncNotice(`数据库同步失败，本地数据已保留：${error instanceof Error ? error.message : '未知错误'}`)

  const createNotebook = async (book: { id: string; name: string; color: string }) => {
    if (!databaseReady) return
    try {
      const remote = await createNotebookRemote({ name: book.name, color: book.color })
      update((current) => ({
        ...current,
        notebooks: current.notebooks.map((item) => item.id === book.id ? remote : item),
        notes: current.notes.map((note) => note.notebookId === book.id ? { ...note, notebookId: remote.id } : note),
        papers: current.papers.map((paper) => paper.notebookId === book.id ? { ...paper, notebookId: remote.id } : paper),
      }))
      setNotebookId(remote.id)
    } catch (error) { reportSyncFailure(error) }
  }

  const saveNote = () => {
    if (!editor?.body.trim()) return
    const body = editor.body.trim()
    const existing = editor.id ? state.notes.find((note) => note.id === editor.id) : undefined
    const next = existing ? { ...existing, tag: editor.tag, color: editor.color, body } : { id: id(), notebookId, tag: editor.tag, color: editor.color, body, createdAt: Date.now(), selected: false }
    update((current) => ({
      ...current,
      notes: editor.id ? current.notes.map((note) => note.id === editor.id ? next : note) : [next, ...current.notes],
    }))
    if (databaseReady) {
      if (existing) void updateNoteRemote(next.id, { tag: next.tag, color: next.color, body: next.body, selected: next.selected }).catch(reportSyncFailure)
      else void createNoteRemote(next).then((remote) => update((current) => ({ ...current, notes: current.notes.map((note) => note.id === next.id ? { ...remote, source: next.source } : note) }))).catch(reportSyncFailure)
    }
    setEditor(null)
  }

  const addExcerpt = (body: string, source: Source) => {
    const next = { id: id(), notebookId, tag: 'quote' as const, color: NOTE_COLORS[1], body, source, createdAt: Date.now(), selected: false }
    update((current) => ({ ...current, notes: [next, ...current.notes] }))
    if (databaseReady) void createNoteRemote(next).then((remote) => update((current) => ({ ...current, notes: current.notes.map((note) => note.id === next.id ? { ...remote, source } : note) }))).catch(reportSyncFailure)
    setExcerptOpen(false)
  }

  const toggleNote = (note: Note) => {
    const selected = !note.selected
    update((current) => ({ ...current, notes: current.notes.map((item) => item.id === note.id ? { ...item, selected } : item) }))
    if (databaseReady) void updateNoteRemote(note.id, { tag: note.tag, color: note.color, body: note.body, selected }).catch(reportSyncFailure)
  }

  const removeNote = (note: Note) => {
    update((current) => ({ ...current, notes: current.notes.filter((item) => item.id !== note.id) }))
    if (databaseReady) void deleteNoteRemote(note.id).catch(reportSyncFailure)
  }

  const submit = async () => {
    if (!selected.length || generating) return
    setConfirmingSubmit(false)
    setGenerating(true)
    setGenerationNotice(null)
    try {
      const version = state.papers.filter((item) => item.notebookId === notebookId).length + 1
      let next: Paper
      try {
        const generated = await generatePaperWithAi(selected, notebookId, version)
        next = hydratePaper(generated, notebookId, version, selected.map((note) => note.id))
      } catch (error) {
        next = generatePaper(state, notebookId, selected.map((note) => note.id))
        setGenerationNotice(`知乎直答暂不可用，已使用本地方案生成：${error instanceof Error ? error.message : '未知错误'}`)
      }
      update((current) => ({ ...current, papers: [...current.papers, next] }))
      if (databaseReady) {
        try { await createPaperRemote(next) } catch (error) { reportSyncFailure(error) }
      }
      setPaperId(next.id)
      setPage('papers')
      window.scrollTo({ top: 0 })
    } finally {
      setGenerating(false)
    }
  }

  return <div className="app-shell">
    <Header page={page} onPage={setPage} />
    {syncNotice && <div className="generation-notice sync-notice">{syncNotice}<button onClick={() => setSyncNotice(null)}>×</button></div>}
    {page === 'notes'
      ? <NotesPage state={state} notes={notes} notebookId={notebookId} editor={editor} selectedCount={selected.length} generating={generating} databaseReady={databaseReady}
          onNotebook={setNotebookId} onState={update} onEditor={setEditor} onSave={saveNote} onExcerpt={() => setExcerptOpen(true)} onSubmit={() => setConfirmingSubmit(true)} onCreateNotebook={createNotebook} onDeleteNotebook={(id) => { if (databaseReady) void deleteNotebookRemote(id).catch(reportSyncFailure) }} onToggleNote={toggleNote} onDeleteNote={removeNote} />
      : <PapersPage state={state} paper={paper} notebookId={notebookId} notice={generationNotice} onPaper={setPaperId} onState={update} onNotes={() => setPage('notes')} onRegenerate={() => setConfirmingSubmit(true)} onDeletePaper={(id) => { if (databaseReady) void deletePaperRemote(id).catch(reportSyncFailure) }} onToggleTask={(id, done) => { if (databaseReady) void updateTaskRemote(id, done).catch(reportSyncFailure) }} />}
    {excerptOpen && <ExcerptModal onClose={() => setExcerptOpen(false)} onAdd={addExcerpt} />}
    {confirmingSubmit && <SubmitConfirm count={selected.length} onCancel={() => setConfirmingSubmit(false)} onConfirm={() => void submit()} />}
    {generating && <div className="generating-overlay" role="status" aria-live="assertive"><div className="generating-card"><span className="large-spinner"/><h2>正在整理你的人生答卷</h2><p>知乎直答正在阅读所选材料并生成行动方案，通常需要 10–30 秒。</p><small>请保持页面开启，完成后会自动进入答卷页。</small></div></div>}
  </div>
}

function SubmitConfirm({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: () => void }) {
  return <div className="overlay confirm-overlay" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}><section className="submit-confirm" role="dialog" aria-modal="true" aria-labelledby="submit-title">
    <span className="confirm-seal">卷</span><h2 id="submit-title">提交这 {count} 条材料？</h2>
    <p>所选笔记正文及其摘录来源将发送给知乎直答，用于生成结构化行动答卷。请确认其中不包含你不希望传输的隐私信息。</p>
    <div><button onClick={onCancel}>返回检查</button><button className="confirm-primary" onClick={onConfirm}>确认并生成</button></div>
  </section></div>
}

function Header({ page, onPage }: { page: Page; onPage: (page: Page) => void }) {
  return <header className="appbar">
    <button className="brand" onClick={() => onPage('notes')}><span className="seal">知</span><span>平时做笔记，关键时提交答卷</span></button>
    <nav className="switcher" aria-label="主导航">
      <button className={page === 'notes' ? 'active' : ''} onClick={() => onPage('notes')}><Icon name="note"/>笔记</button>
      <button className={page === 'papers' ? 'active' : ''} onClick={() => onPage('papers')}><Icon name="paper"/>答卷</button>
    </nav>
  </header>
}

interface NotesProps {
  state: AppState; notes: Note[]; notebookId: string; editor: EditorState; selectedCount: number; generating: boolean; databaseReady: boolean
  onNotebook: (id: string) => void; onState: (fn: (state: AppState) => AppState) => void
  onEditor: (editor: EditorState) => void; onSave: () => void; onExcerpt: () => void; onSubmit: () => void
  onCreateNotebook: (book: { id: string; name: string; color: string }) => void; onDeleteNotebook: (id: string) => void; onToggleNote: (note: Note) => void; onDeleteNote: (note: Note) => void
}

function NotesPage(props: NotesProps) {
  const { state, notes, notebookId, editor, selectedCount, generating, onNotebook, onState, onEditor, onSave, onExcerpt, onSubmit, onCreateNotebook, onDeleteNotebook, onToggleNote, onDeleteNote } = props
  const [addingBook, setAddingBook] = useState(false)
  const [bookName, setBookName] = useState('')
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null)

  const addBook = () => {
    if (!bookName.trim()) return setAddingBook(false)
    const next = { id: id(), name: bookName.trim(), color: ['#c8d3e0', '#dec8d3', '#c4d4bf', '#e5d1ac'][state.notebooks.length % 4] }
    onState((current) => ({ ...current, notebooks: [...current.notebooks, next] }))
    onCreateNotebook(next)
    onNotebook(next.id); setBookName(''); setAddingBook(false)
  }
  const deletingBook = state.notebooks.find((book) => book.id === deletingBookId)
  const deletingNoteCount = state.notes.filter((note) => note.notebookId === deletingBookId).length
  const deletingPaperCount = state.papers.filter((paper) => paper.notebookId === deletingBookId).length
  const deleteBook = () => {
    if (!deletingBookId || state.notebooks.length <= 1) return
    const remaining = state.notebooks.filter((book) => book.id !== deletingBookId)
    onState((current) => ({
      ...current,
      notebooks: current.notebooks.filter((book) => book.id !== deletingBookId),
      notes: current.notes.filter((note) => note.notebookId !== deletingBookId),
      papers: current.papers.filter((paper) => paper.notebookId !== deletingBookId),
    }))
    onDeleteNotebook(deletingBookId)
    if (notebookId === deletingBookId) onNotebook(remaining[0].id)
    setDeletingBookId(null)
  }

  return <main className="notes-page">
    <section className="shelf" aria-label="笔记本">
      {state.notebooks.map((book) => <div key={book.id} className={`book ${book.id === notebookId ? 'active' : ''}`}>
        <button className="book-select" onClick={() => onNotebook(book.id)}><i style={{ background: book.color }}/><span>{book.name}</span><small>{state.notes.filter((note) => note.notebookId === book.id).length}</small></button>
        {state.notebooks.length > 1 && <button className="book-delete" aria-label={`删除笔记本 ${book.name}`} onClick={() => setDeletingBookId(book.id)}>×</button>}
      </div>)}
      {addingBook ? <form className="book-form" onSubmit={(event) => { event.preventDefault(); addBook() }}><input autoFocus value={bookName} onChange={(event) => setBookName(event.target.value)} onBlur={addBook} placeholder="本子名称" /></form>
        : <button className="book add" aria-label="添加笔记本" onClick={() => setAddingBook(true)}><Icon name="plus"/></button>}
    </section>
    <div className="notes-scroll"><div className="notes-inner">
      <div className="quick-actions">
        <button className="tool primary" onClick={() => onEditor({ tag: 'idea', color: NOTE_COLORS[0], body: '' })}><Icon name="plus"/>新建笔记</button>
        <button className="tool" onClick={onExcerpt}><span className="red-dot"/>知乎摘录</button>
      </div>
      {editor && <NoteEditor editor={editor} onChange={onEditor} onSave={onSave} onCancel={() => onEditor(null)} />}
      {!notes.length && !editor ? <div className="empty"><span className="empty-seal">空</span><h1>这一册还没有笔记</h1><p>写下一个困扰、一项限制，或摘录一句让你停下来的话。</p></div>
        : notes.map((note) => <NoteCard key={note.id} note={note}
          onToggle={() => onToggleNote(note)}
          onEdit={() => note.tag !== 'quote' && onEditor({ id: note.id, tag: note.tag, color: note.color ?? NOTE_COLORS[0], body: note.body })}
          onDelete={() => onDeleteNote(note)} />)}
    </div></div>
    <footer className="dock"><div className="dock-inner"><div><span className={`count ${selectedCount ? 'hot' : ''}`}>{generating ? '正在作答' : `已选 ${selectedCount}`}</span><p aria-live="polite">{generating ? '正在调用知乎直答整理材料，通常需要 10–30 秒，请不要关闭页面。' : selectedCount ? '这些材料已装订，可以提交一份新答卷。' : '勾选笔记，把它们投进答卷。'}</p></div>
      <div className={`submit-wrap ${selectedCount ? 'armed' : ''}`}><span className="seal-ring"/><button aria-label={generating ? '正在生成答卷' : `提交 ${selectedCount} 条笔记`} className={`submit-seal ${selectedCount ? 'ready' : ''} ${generating ? 'busy' : ''}`} disabled={!selectedCount || generating} onClick={onSubmit}>{generating ? <span className="spinner"/> : '提交'}</button></div>
    </div></footer>
    {deletingBook && <div className="overlay confirm-overlay" onMouseDown={(event) => event.target === event.currentTarget && setDeletingBookId(null)}><section className="submit-confirm" role="dialog" aria-modal="true" aria-labelledby="delete-book-title">
      <span className="confirm-seal">删</span><h2 id="delete-book-title">删除“{deletingBook.name}”笔记本？</h2>
      <p>此操作会同时删除其中的 {deletingNoteCount} 条笔记和 {deletingPaperCount} 份答卷，且无法恢复。</p>
      <div><button onClick={() => setDeletingBookId(null)}>取消</button><button className="danger-primary" onClick={deleteBook}>确认删除</button></div>
    </section></div>}
  </main>
}

function NoteEditor({ editor, onChange, onSave, onCancel }: { editor: NonNullable<EditorState>; onChange: (editor: EditorState) => void; onSave: () => void; onCancel: () => void }) {
  return <section className="note-editor">
    <span className="eyebrow">笔记类型</span>
    <div className="tag-options">{(['idea', 'limit', 'try'] as const).map((tag) => <button key={tag} className={editor.tag === tag ? 'active' : ''} onClick={() => onChange({ ...editor, tag })}><i style={{ background: TAGS[tag].color }}/>{TAGS[tag].label}</button>)}</div>
    <span className="eyebrow color-label">标签颜色</span><div className="color-options" role="radiogroup" aria-label="标签颜色">{NOTE_COLORS.map((color) => <button key={color} type="button" role="radio" aria-label={`选择颜色 ${color}`} aria-checked={editor.color === color} className={editor.color === color ? 'active' : ''} style={{ background: color }} onClick={() => onChange({ ...editor, color })}/>)}</div>
    <textarea autoFocus value={editor.body} onChange={(event) => onChange({ ...editor, body: event.target.value })} onKeyDown={(event) => { if (event.ctrlKey && event.key === 'Enter') onSave() }} placeholder="把此刻真实的想法写下来……" />
    <div className="editor-foot"><small>Ctrl + Enter 保存</small><span><button onClick={onCancel}>取消</button><button className="accent" disabled={!editor.body.trim()} onClick={onSave}>保存</button></span></div>
  </section>
}

function NoteCard({ note, onToggle, onEdit, onDelete }: { note: Note; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const [deleting, setDeleting] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const tag = TAGS[note.tag]
  return <article className={`note-card ${note.selected ? 'selected' : ''}`}>
    <label className="check"><input type="checkbox" checked={note.selected} onChange={onToggle}/><span/></label>
    <div className="note-main"><div className="note-meta"><span className="tag" style={{ background: note.color ?? tag.color }}><i/>{tag.label}</span><time>{formatDate(note.createdAt)}</time><div className="card-actions">
      {note.tag !== 'quote' && <button aria-label="编辑" onClick={onEdit}><Icon name="edit"/></button>}<button aria-label="删除" onClick={() => setDeleting(true)}><Icon name="trash"/></button></div></div>
      <button className={`note-body ${expanded ? 'expanded' : ''}`} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{note.body}</button>
      {note.body.length > 72 && <button className="expand-hint" onClick={() => setExpanded((value) => !value)}>{expanded ? '收起' : '展开全文'}</button>}
      {note.source && <a className="source" href={note.source.url} target="_blank" rel="noreferrer"><span>知乎摘录</span>{note.source.author}：《{note.source.title}》 <Icon name="arrow"/></a>}
      {deleting && <div className="delete-confirm"><span>确认移除这条笔记？</span><div><button onClick={() => setDeleting(false)}>保留</button><button className="danger" onClick={onDelete}>删除</button></div></div>}
    </div>
  </article>
}

function ExcerptModal({ onClose, onAdd }: { onClose: () => void; onAdd: (body: string, source: Source) => void }) {
  const [query, setQuery] = useState('转行')
  const [items, setItems] = useState<ZhihuSearchItem[]>([])
  const [chosen, setChosen] = useState<ZhihuSearchItem | null>(null)
  const [sentence, setSentence] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const runSearch = async (refresh = false) => {
    if (!query.trim() || loading) return
    setLoading(true); setError('')
    try { setItems(uniqueSearchItems(await searchZhihu(query.trim(), refresh))) }
    catch (reason) { setItems([]); setError(reason instanceof Error ? reason.message : '搜索失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void runSearch() }, [])
  const sentences = chosen?.contentText.match(/[^。！？]+[。！？]?/gu) ?? []
  const chooseSelection = () => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) return
    const range = selection.getRangeAt(0)
    const selectedSentences = Array.from(document.querySelectorAll<HTMLElement>('[data-quote-sentence]'))
      .filter((element) => { try { return range.intersectsNode(element) } catch { return false } })
      .map((element) => element.textContent ?? '').filter(Boolean)
    if (selectedSentences.length) setSentence(selectedSentences.join(''))
    selection.removeAllRanges()
  }
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal">
    <header><div><span className="eyebrow">知乎经验摘录</span><h2>{chosen ? '划出最想留下的一句' : '找一条真实经验'}</h2></div><button onClick={onClose}>×</button></header>
    {!chosen ? <><form className="search" onSubmit={(event) => { event.preventDefault(); void runSearch(true) }}><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词" /><button type="submit">搜索</button></form><p className="demo-hint"><i/>{loading ? '正在检索知乎真实经验…' : '点击“搜索”可刷新当前关键词的知乎结果'}</p>
      {error && <p className="api-error">搜索失败：{error}</p>}
      {!loading && !error && !items.length && <p className="api-empty">没有找到相关内容，请换个关键词。</p>}
      <div className="results">{items.map((item) => <button key={item.id} onClick={() => setChosen(item)}><strong>{item.title}</strong><p>{item.contentText.length > 150 ? `${item.contentText.slice(0, 150)}…` : item.contentText}</p><small>知乎{item.contentType} · {item.authorName} · {item.voteUpCount} 赞同 <b>查看全文摘要 →</b></small></button>)}</div></>
      : <><button className="chosen" onClick={() => { setChosen(null); setSentence('') }}><Icon name="back"/><span><strong>{chosen.title}</strong><small>{chosen.authorName}</small></span></button>
        <div className="quote-paper"><span className="eyebrow">完整摘要 · 鼠标拖动划线，自动按整句选择</span><p className="sentence-selection" onMouseUp={chooseSelection}>{sentences.map((item, index) => <span data-quote-sentence key={`${index}-${item}`} className={sentence.includes(item) ? 'selected' : ''} onClick={() => setSentence(item)}>{item}</span>)}</p></div>
        {sentence && <div className="selected-quote"><span>已划线</span>“{sentence}”</div>}
        <button className="modal-submit" disabled={!sentence} onClick={() => onAdd(sentence, { title: chosen.title, author: chosen.authorName, url: chosen.url, contentId: chosen.id, voteUpCount: chosen.voteUpCount })}>确认入库</button></>}
  </section></div>
}

interface PapersProps { state: AppState; paper?: Paper; notebookId: string; notice: string | null; onPaper: (id: string | null) => void; onState: (fn: (state: AppState) => AppState) => void; onNotes: () => void; onRegenerate: () => void; onDeletePaper: (id: string) => void; onToggleTask: (id: string, done: boolean) => void }

function PapersPage({ state, paper, notebookId, notice, onPaper, onState, onNotes, onRegenerate, onDeletePaper, onToggleTask }: PapersProps) {
  const papers = state.papers.filter((item) => item.notebookId === notebookId)
  const [deletingPaperId, setDeletingPaperId] = useState<string | null>(null)
  const deletingPaper = papers.find((item) => item.id === deletingPaperId)
  const deletePaper = () => {
    if (!deletingPaperId) return
    const remaining = papers.filter((item) => item.id !== deletingPaperId)
    onState((current) => ({ ...current, papers: current.papers.filter((item) => item.id !== deletingPaperId) }))
    onDeletePaper(deletingPaperId)
    if (paper?.id === deletingPaperId) onPaper(remaining.at(-1)?.id ?? null)
    setDeletingPaperId(null)
  }
  if (!paper) return <main className="no-paper"><span className="empty-seal">卷</span><h1>还没有人生答卷</h1><p>回到笔记页，选中几条材料后提交。</p><button className="tool primary" onClick={onNotes}><Icon name="back"/>去准备材料</button></main>
  const finishedScore = paperProgress(paper)
  const toggleTask = (stageId: string, taskId: string) => {
    const task = paper.stages.find((stage) => stage.id === stageId)?.tasks.find((item) => item.id === taskId)
    const done = !task?.done
    onState((current) => ({ ...current, papers: current.papers.map((item) => item.id !== paper.id ? item : { ...item, stages: item.stages.map((stage) => stage.id !== stageId ? stage : { ...stage, tasks: stage.tasks.map((task) => task.id === taskId ? { ...task, done } : task) }) }) }))
    if (task) onToggleTask(taskId, done)
  }

  return <main className="papers-page">
    <aside className="paper-sidebar"><div><span className="eyebrow">答卷档案</span><h2>{state.notebooks.find((item) => item.id === notebookId)?.name}</h2></div>
      <div className="paper-list">{papers.map((item) => {
        const score = paperProgress(item)
        const finished = score === 100
        const paperName = `${chineseNumber(item.version)}卷`
        return <div key={item.id} className={`paper-entry ${item.id === paper.id ? 'active' : ''}`}>
          <button className="paper-select" onClick={() => onPaper(item.id)}>
            <span>{paperName}</span>
            <small className={finished ? 'finished' : 'unfinished'}><b>{score}</b>{finished ? '已答完' : '未答完'}</small>
          </button>
          <button className="paper-delete" aria-label={`删除答卷 ${paperName}`} onClick={() => setDeletingPaperId(item.id)}><Icon name="trash"/></button>
        </div>
      })}</div>
      <button className="side-back" onClick={onNotes}><Icon name="back"/>继续补充笔记</button>
    </aside>
    <div className="paper-workspace">{notice && <div className="generation-notice">{notice}</div>}<div className="paper-toolbar"><span>完成得分 <b>{finishedScore}</b> / 100</span><div><button onClick={() => window.print()}><Icon name="print"/>打印</button><button onClick={onRegenerate}>重新作答</button></div></div>
      <article className="exam-paper">
        <div className="secret-line"><span>密</span><i/><b>封 线 内 不 要 答 题</b><i/><span>封</span></div>
        <header className="exam-head"><div><span className="paper-kicker">ZHIXING · LIFE PAPER</span><h1>人生答卷</h1></div><div className="paper-number">NO. {new Date(paper.createdAt).toISOString().slice(0, 10).replaceAll('-', '')}-{String(paper.version).padStart(2, '0')}</div></header>
        <div className="candidate"><span>姓名：<i>未来的我</i></span><span>科目：<i>{state.notebooks.find((item) => item.id === notebookId)?.name}</i></span><span>日期：<i>{new Date(paper.createdAt).toLocaleDateString('zh-CN')}</i></span><span>卷次：<i>{chineseNumber(paper.version)}卷</i></span></div>
        <PaperSection number="一" title="题目" meta={`来源笔记 ${paper.noteIds.length} 条`}><p className="question">{paper.question}</p></PaperSection>
        <PaperSection number="二" title="已知条件" meta="你的现实边界"><ul>{paper.conditions.map((item) => <li key={item}>{item}</li>)}</ul></PaperSection>
        <PaperSection number="三" title="参考依据" meta="摘录与经验"><ul className="references">{paper.references.map((item) => <li key={item}>{item}</li>)}</ul></PaperSection>
        <PaperSection number="四" title="解题步骤" meta="本题 100 分"><div className="stages">{paper.stages.map((stage, index) => <section className="stage" key={stage.id}>
          <div className="stage-score">{stage.score}<small>分</small></div><div className="stage-content"><header><span>第 {index + 1} 阶段 · {stage.period}</span><h3>{stage.title}</h3><p>{stage.goal}</p></header>
          <div className="task-list">{stage.tasks.map((task) => <label key={task.id}><input type="checkbox" checked={task.done} onChange={() => toggleTask(stage.id, task.id)}/><span>{task.text}</span></label>)}</div><p className="criterion"><b>检验标准</b>{stage.criterion}</p></div>
        </section>)}</div></PaperSection>
        <PaperSection number="五" title="得分点" meta="阶段检查"><ol className="checkpoints">{paper.checkpoints.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, '0')}</span>{item}</li>)}</ol></PaperSection>
        <PaperSection number="六" title="阅卷评语" meta="额外提醒"><blockquote>“{paper.comment}”</blockquote></PaperSection>
        <footer className="exam-foot"><span>知行 · 第 {paper.version} 次作答</span><span className="final-seal">知行</span><span>完成比完美更重要</span></footer>
      </article>
    </div>
    {deletingPaper && <div className="overlay confirm-overlay" onMouseDown={(event) => event.target === event.currentTarget && setDeletingPaperId(null)}><section className="submit-confirm" role="dialog" aria-modal="true" aria-labelledby="delete-paper-title">
      <span className="confirm-seal">删</span><h2 id="delete-paper-title">删除“{chineseNumber(deletingPaper.version)}卷”？</h2>
      <p>这份答卷及其中记录的任务完成进度将被永久删除，且无法恢复；原始笔记不会受到影响。</p>
      <div><button onClick={() => setDeletingPaperId(null)}>取消</button><button className="danger-primary" onClick={deletePaper}>确认删除</button></div>
    </section></div>}
  </main>
}

function PaperSection({ number, title, meta, children }: { number: string; title: string; meta: string; children: React.ReactNode }) {
  return <section className="paper-section"><header><h2><span>{number}</span>{title}</h2><small>【{meta}】</small></header><div className="answer-area">{children}</div></section>
}
