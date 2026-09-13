import express from 'express'
import path from 'node:path'
import { ZodError } from 'zod'
import { generateRequestSchema } from './contracts.js'
import { databaseHealth } from './db.js'
import { generateWithZhihu, searchZhihu } from './zhihu.js'
import { beginZhihuOAuth, completeZhihuOAuth, currentOAuthUser, logoutOAuth, oauthConfigured } from './oauth.js'

const app = express()
const port = Number(process.env.PORT || 8787)
const webDirectory = path.resolve(process.cwd(), 'dist')

app.disable('x-powered-by')
app.use(express.json({ limit: '256kb' }))

app.get('/api/health', async (_request, response) => {
  response.json({ ok: true, database: await databaseHealth(), zhihu: process.env.ZHIHU_ACCESS_SECRET ? 'http' : 'cli', oauth: oauthConfigured() ? 'configured' : 'not_configured' })
})

app.get('/api/auth/zhihu', async (_request, response, next) => { try { await beginZhihuOAuth(response) } catch (error) { next(error) } })
app.get('/api/auth/zhihu/callback', async (request, response, next) => { try { await completeZhihuOAuth(request, response) } catch (error) { next(error) } })
app.get('/api/auth/me', async (request, response, next) => { try { response.json({ user: await currentOAuthUser(request) }) } catch (error) { next(error) } })
app.post('/api/auth/logout', async (request, response, next) => { try { await logoutOAuth(request, response) } catch (error) { next(error) } })

// Business data is intentionally local-only. Keep these legacy routes closed
// so no client or stale deployment can write notebooks, notes, or papers.
app.use('/api/state', (_request, response) => response.status(410).json({ error: { code: 'LOCAL_ONLY', message: '业务数据仅保存在浏览器本地缓存' } }))
app.use('/api/notebooks', (_request, response) => response.status(410).json({ error: { code: 'LOCAL_ONLY', message: '业务数据仅保存在浏览器本地缓存' } }))
app.use('/api/notes', (_request, response) => response.status(410).json({ error: { code: 'LOCAL_ONLY', message: '业务数据仅保存在浏览器本地缓存' } }))
app.use('/api/papers', (request, response, next) => {
  // Keep Zhihu Zhida generation available; only persistence endpoints are
  // local-only because papers themselves are stored in localStorage.
  if (request.path === '/generate' && request.method === 'POST') return next()
  return response.status(410).json({ error: { code: 'LOCAL_ONLY', message: '业务数据仅保存在浏览器本地缓存' } })
})
app.use('/api/tasks', (_request, response) => response.status(410).json({ error: { code: 'LOCAL_ONLY', message: '业务数据仅保存在浏览器本地缓存' } }))

app.get('/api/zhihu/search', async (request, response, next) => {
  try {
    const query = String(request.query.q ?? '').trim()
    const count = Math.min(10, Math.max(1, Number(request.query.count ?? 6)))
    if (!query) return response.status(400).json({ error: { code: 'INVALID_QUERY', message: '请输入搜索关键词' } })
    const refresh = String(request.query.refresh ?? '') === '1'
    const items = await searchZhihu(query, count, refresh)
    response.json({ items })
  } catch (error) { next(error) }
})

app.post('/api/papers/generate', async (request, response, next) => {
  try {
    const input = generateRequestSchema.parse(request.body)
    const paper = await generateWithZhihu(input)
    response.json({ paper, provider: 'zhihu-zhida' })
  } catch (error) { next(error) }
})

// Production uses one origin for the browser app and API. This prevents a
// static SPA fallback from accidentally returning index.html for /api calls.
app.use(express.static(webDirectory))
app.use((request, response, next) => {
  if (request.method !== 'GET' || request.path.startsWith('/api/')) return next()
  response.sendFile(path.join(webDirectory, 'index.html'))
})

app.use('/api', (_request, response) => {
  response.status(404).json({ error: { code: 'API_NOT_FOUND', message: 'API 地址不存在' } })
})

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) return response.status(422).json({ error: { code: 'INVALID_RESPONSE', message: '数据结构校验失败', details: error.issues } })
  const message = error instanceof Error ? error.message : '服务暂时不可用'
  const quota = /额度|频率|rate limit/i.test(message)
  const auth = /鉴权|登录|secret|auth|credential/i.test(message)
  response.status(auth ? 401 : quota ? 429 : 502).json({ error: { code: auth ? 'AUTH_REQUIRED' : quota ? 'RATE_LIMITED' : 'UPSTREAM_ERROR', message } })
})

export default app

// Vercel imports the Express app as a serverless function. Local production
// keeps the standalone listener for `pnpm start`.
if (process.env.VERCEL !== '1') app.listen(port, '127.0.0.1', () => console.log(`Zhixing API listening on http://127.0.0.1:${port}`))
