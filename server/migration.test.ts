import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMigrationPlan } from './migration.js'

test('maps localStorage IDs to UUIDs while preserving relationships', () => {
  const initialState = {
    notebooks: [{ id: 'career', name: '职业', color: '#dec8d3' }],
    notes: [{ id: 'note-1', notebookId: 'career', tag: 'idea' as const, body: '测试笔记', createdAt: 1, selected: false }],
    papers: [{ id: 'paper-1', version: 1, createdAt: 1, notebookId: 'career', noteIds: ['note-1'], question: '问题', conditions: [], references: [], stages: [{ id: 'stage-1', title: '阶段', period: '第1周', goal: '目标', score: 100, tasks: [{ id: 'task-1', text: '任务', done: false }], criterion: '标准' }], checkpoints: [], comment: '评语' }],
  }
  const plan = buildMigrationPlan(initialState, '00000000-0000-0000-0000-000000000001')
  assert.equal(plan.userId, '00000000-0000-0000-0000-000000000001')
  assert.equal(plan.notebooks.length, initialState.notebooks.length)
  assert.equal(plan.notes.length, initialState.notes.length)
  assert.equal(plan.papers.length, initialState.papers.length)
  assert.equal(new Set(plan.notebooks.map((item) => item.id)).size, plan.notebooks.length)
  assert.ok(plan.notes.every((item) => plan.notebooks.some((book) => book.id === item.notebookId)))
})
