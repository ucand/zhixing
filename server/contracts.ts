import { z } from 'zod'

export const noteInputSchema = z.object({
  id: z.string().min(1),
  tag: z.enum(['idea', 'quote', 'limit', 'try']),
  body: z.string().trim().min(1).max(5000),
  source: z.object({
    title: z.string(),
    author: z.string(),
    url: z.string().url(),
  }).optional(),
})

export const notebookMutationSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().trim().min(1).max(20),
})

export const noteMutationSchema = z.object({
  notebookId: z.string().min(1).optional(),
  tag: z.enum(['idea', 'quote', 'limit', 'try']),
  body: z.string().trim().min(1).max(5000),
  selected: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  source: z.object({
    title: z.string(),
    author: z.string(),
    url: z.string().url(),
    contentId: z.string().optional(),
    voteUpCount: z.number().int().nonnegative().optional(),
  }).optional(),
})

export const taskMutationSchema = z.object({ completed: z.boolean() })

export const appStateSchema = z.object({
  notebooks: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), color: z.string().min(1) })),
  notes: z.array(z.object({
    id: z.string().min(1), notebookId: z.string().min(1), tag: z.enum(['idea', 'quote', 'limit', 'try']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), body: z.string().min(1), createdAt: z.number(), selected: z.boolean(),
    source: z.object({ title: z.string(), author: z.string(), url: z.string().url(), contentId: z.string().optional(), voteUpCount: z.number().optional() }).optional(),
  })),
  papers: z.array(z.object({
    id: z.string().min(1), version: z.number().int().positive(), createdAt: z.number(), notebookId: z.string().min(1), noteIds: z.array(z.string()), question: z.string(), conditions: z.array(z.string()), references: z.array(z.string()),
    stages: z.array(z.object({ id: z.string().min(1), title: z.string(), period: z.string(), goal: z.string(), score: z.number(), tasks: z.array(z.object({ id: z.string().min(1), text: z.string(), done: z.boolean() })), criterion: z.string() })), checkpoints: z.array(z.string()), comment: z.string(),
  })),
})

export const generateRequestSchema = z.object({
  notebookId: z.string().min(1),
  version: z.number().int().positive(),
  notes: z.array(noteInputSchema).min(1).max(30),
})

export const paperPersistenceSchema = z.object({
  id: z.string().min(1), version: z.number().int().positive(), createdAt: z.number(), notebookId: z.string().min(1), noteIds: z.array(z.string()),
  question: z.string(), conditions: z.array(z.string()), references: z.array(z.string()),
  stages: z.array(z.object({ id: z.string().min(1), title: z.string(), period: z.string(), goal: z.string(), score: z.number().int().min(1).max(100), tasks: z.array(z.object({ id: z.string().min(1), text: z.string(), done: z.boolean() })), criterion: z.string() })),
  checkpoints: z.array(z.string()), comment: z.string(),
}).superRefine((value, context) => {
  const total = value.stages.reduce((sum, stage) => sum + stage.score, 0)
  if (total !== 100) context.addIssue({ code: 'custom', message: `阶段总分必须为 100，当前为 ${total}` })
})

export const generatedPaperSchema = z.object({
  question: z.string().min(10).max(500),
  conditions: z.array(z.string().min(1)).min(1).max(12),
  references: z.array(z.string().min(1)).min(1).max(12),
  stages: z.array(z.object({
    title: z.string().min(1).max(30),
    period: z.string().min(1).max(30),
    goal: z.string().min(1).max(200),
    score: z.number().int().min(1).max(100),
    tasks: z.array(z.string().min(1).max(200)).min(1).max(8),
    criterion: z.string().min(1).max(300),
  })).min(2).max(6),
  checkpoints: z.array(z.string().min(1).max(200)).min(2).max(10),
  comment: z.string().min(1).max(500),
}).superRefine((value, context) => {
  const total = value.stages.reduce((sum, stage) => sum + stage.score, 0)
  if (total !== 100) context.addIssue({ code: 'custom', message: `阶段总分必须为 100，当前为 ${total}` })
})

export type GenerateRequest = z.infer<typeof generateRequestSchema>
export type GeneratedPaper = z.infer<typeof generatedPaperSchema>

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
