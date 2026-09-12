import type { AppState, NoteTag, Paper } from './types'

export const TAGS: Record<NoteTag, { label: string; color: string; role: string }> = {
  idea: { label: '我的想法', color: 'var(--tag-idea)', role: '题目来源' },
  quote: { label: '摘录', color: 'var(--tag-quote)', role: '参考解法' },
  limit: { label: '限制条件', color: 'var(--tag-limit)', role: '已知条件' },
  try: { label: '我的尝试', color: 'var(--tag-try)', role: '历史信息' },
}

export const NOTE_COLORS = ['#f0e2bd', '#d9e7d1', '#d9e0e8', '#e9dde4', '#f3c7b7', '#d9c8ee', '#c6e3e7', '#f1d6a8']

export const initialState: AppState = {
  notebooks: [
    { id: 'career', name: '职业', color: '#dec8d3' },
    { id: 'study', name: '学习', color: '#c8d3e0' },
    { id: 'life', name: '生活', color: '#c4d4bf' },
    { id: 'health', name: '健康', color: '#e5d1ac' },
  ],
  notes: [
    {
      id: 'n1', notebookId: 'career', tag: 'idea', selected: true,
      body: '工作三年了，感觉自己没有成长。每天做的事都一样，想转行但不知道从哪开始。',
      createdAt: Date.now() - 86_400_000 * 2,
    },
    {
      id: 'n2', notebookId: 'career', tag: 'quote', selected: true,
      body: '转行第一步不是学技能，是先搞清楚你要去的岗位到底在做什么。',
      createdAt: Date.now() - 86_400_000,
      source: { title: '零经验转行，第一步应该做什么？', author: '远山职业笔记', url: 'https://www.zhihu.com/search?q=%E8%BD%AC%E8%A1%8C' },
    },
    {
      id: 'n3', notebookId: 'career', tag: 'limit', selected: true,
      body: '每天只有晚上九点后的一小时，不能辞职，预算有限。',
      createdAt: Date.now() - 43_200_000,
    },
    {
      id: 'n4', notebookId: 'career', tag: 'try', selected: false,
      body: '学过一阵 Python，但目标太模糊，两周后就没有坚持。',
      createdAt: Date.now() - 3_600_000,
    },
  ],
  papers: [],
}

const sentence = (value: string, max = 44) => value.length > max ? `${value.slice(0, max)}……` : value

export function generatePaper(state: AppState, notebookId: string, selectedIds: string[]): Paper {
  const selected = state.notes.filter((note) => selectedIds.includes(note.id))
  const ideas = selected.filter((note) => note.tag === 'idea')
  const limits = selected.filter((note) => note.tag === 'limit')
  const tries = selected.filter((note) => note.tag === 'try')
  const quotes = selected.filter((note) => note.tag === 'quote')
  const versions = state.papers.filter((paper) => paper.notebookId === notebookId).length
  const core = ideas[0]?.body ?? selected[0]?.body ?? '把眼前模糊的问题，变成一项可以开始的行动'
  const question = `${sentence(core.replace(/[。！？]+$/u, ''), 52)}——如何在现有条件下找到一条可验证、可持续的行动路径？`
  const conditions = [
    ...limits.map((note) => note.body),
    ...tries.map((note) => `过往尝试：${note.body}`),
  ]
  if (!conditions.length) conditions.push('尚未记录明确限制；第一阶段先识别时间、预算与能力边界。')
  const references = quotes.length
    ? quotes.map((note) => `“${note.body}”${note.source ? ` — ${note.source.author}《${note.source.title}》` : ''}`)
    : ['目前没有摘录材料；执行时优先寻找真实从业者经验，并交叉验证。']

  return {
    id: crypto.randomUUID(),
    version: versions + 1,
    createdAt: Date.now(),
    notebookId,
    noteIds: selectedIds,
    question,
    conditions,
    references,
    stages: [
      {
        id: crypto.randomUUID(), title: '信息收集期', period: '第 1–2 周', score: 20,
        goal: '把模糊焦虑变成三个可以比较的方向。',
        tasks: ['每天读一份真实岗位描述', '整理两个从业者的一手经验', '记录每个方向让你好奇和抗拒的地方'].map((text) => ({ id: crypto.randomUUID(), text, done: false })),
        criterion: '能用 200 字说清三个方向的日常工作与进入门槛。',
      },
      {
        id: crypto.randomUUID(), title: '小步验证期', period: '第 3–4 周', score: 25,
        goal: '用最低成本验证最感兴趣的方向。',
        tasks: ['选择一个两小时内能完成的微型任务', '每周完成一个可展示的小成果', '向一位从业者请教并记录反馈'].map((text) => ({ id: crypto.randomUUID(), text, done: false })),
        criterion: '完成两个微型成果，并获得至少一次外部反馈。',
      },
      {
        id: crypto.randomUUID(), title: '深入学习期', period: '第 5–8 周', score: 30,
        goal: '围绕真实产出建立最小技能组合。',
        tasks: ['把大目标拆成每晚一小时的学习单元', '每周固定一次复盘并调整难度', '完成一个端到端作品'].map((text) => ({ id: crypto.randomUUID(), text, done: false })),
        criterion: '有一个可讲述过程、可展示结果的完整作品。',
      },
      {
        id: crypto.randomUUID(), title: '真实验证期', period: '第 9–10 周', score: 25,
        goal: '把准备放进真实环境，获得市场信号。',
        tasks: ['更新个人介绍与作品材料', '进行三次信息访谈或模拟沟通', '投递或申请十个真实机会'].map((text) => ({ id: crypto.randomUUID(), text, done: false })),
        criterion: '获得至少三个明确反馈，并决定继续、调整或停止。',
      },
    ],
    checkpoints: ['第 2 周写出方向比较', '第 4 周完成两个微型成果', '第 8 周完成一个完整作品', '第 10 周获得三份真实反馈'],
    comment: tries.length
      ? '过去没有坚持，不等于能力不足。旧计划的问题更可能是目标抽象、反馈太慢；这份答卷刻意缩短了反馈周期。'
      : '先执行前两周，不必现在就承诺最终方向。行动的任务是获得证据，而不是一次做出完美决定。',
  }
}
