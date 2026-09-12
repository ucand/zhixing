import assert from 'node:assert/strict'
import test from 'node:test'
import { generatedPaperSchema, generateRequestSchema } from './contracts.js'

test('accepts a valid generation request', () => {
  const value = generateRequestSchema.parse({
    notebookId: 'career', version: 1,
    notes: [{ id: 'n1', tag: 'idea', body: '我想找到一个可验证的职业方向。' }],
  })
  assert.equal(value.notes.length, 1)
})

test('requires stage scores to total 100', () => {
  const result = generatedPaperSchema.safeParse({
    question: '如何找到一个可验证、可持续的职业方向？',
    conditions: ['每天只有一小时'], references: ['用户提供的经验摘录'],
    stages: [
      { title: '调研', period: '第一周', goal: '明确方向', score: 20, tasks: ['读岗位描述'], criterion: '写出说明' },
      { title: '验证', period: '第二周', goal: '获得反馈', score: 20, tasks: ['完成小项目'], criterion: '收到反馈' },
    ],
    checkpoints: ['第一周完成调研', '第二周完成验证'], comment: '先行动再判断。',
  })
  assert.equal(result.success, false)
})
