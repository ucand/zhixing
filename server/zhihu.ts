import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { generatedPaperSchema, type GenerateRequest, type GeneratedPaper, type ZhihuSearchItem } from './contracts.js'

const execFileAsync = promisify(execFile)
const API_ROOT = 'https://developer.zhihu.com'
const DEFAULT_CLI = 'C:\\Users\\31796\\AppData\\Local\\ZhihuCLI\\current\\zhihu-cli.exe'
const cache = new Map<string, { expiresAt: number; value: ZhihuSearchItem[] }>()

interface PlatformItem {
  ContentID: string; Title: string; ContentType: string; ContentText: string; Url: string
  AuthorName: string; VoteUpCount: number; CommentCount: number; AuthorityLevel: string
}

interface PlatformEnvelope<T> { Code: number; Message: string; Data: T }
interface SearchData { Items: PlatformItem[] }

const cleanText = (value: string) => value
  .replace(/<em>/gi, '').replace(/<\/em>/gi, '')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

function mapSearchItems(items: PlatformItem[]): ZhihuSearchItem[] {
  const mapped = items.map((item) => ({
    id: item.ContentID,
    title: cleanText(item.Title),
    contentType: item.ContentType,
    contentText: cleanText(item.ContentText),
    url: item.Url,
    authorName: item.AuthorName || '知乎用户',
    voteUpCount: item.VoteUpCount ?? 0,
    commentCount: item.CommentCount ?? 0,
    authorityLevel: item.AuthorityLevel ?? '1',
  }))
  const seen = new Set<string>()
  return mapped.filter((item) => {
    const key = item.id || item.url || `${item.title}:${item.authorName}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function platformFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const secret = process.env.ZHIHU_ACCESS_SECRET
  if (!secret) throw new Error('ZHIHU_ACCESS_SECRET 未配置')
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    signal: AbortSignal.timeout(60_000),
  })
  const payload = await response.json() as T & { Code?: number; Message?: string; error?: { message?: string } }
  if (!response.ok || (payload.Code !== undefined && payload.Code !== 0)) {
    throw new Error(payload.Message || payload.error?.message || `知乎接口请求失败 (${response.status})`)
  }
  return payload
}

async function cliJson(args: string[], timeout = 60_000): Promise<unknown> {
  const cli = process.env.ZHIHU_CLI_PATH || DEFAULT_CLI
  try {
    const { stdout } = await execFileAsync(cli, [...args, '--timeout', `${Math.ceil(timeout / 1000)}s`], {
      timeout: timeout + 5_000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    })
    return JSON.parse(stdout)
  } catch (error) {
    const processError = error as Error & { stdout?: string; stderr?: string }
    const output = processError.stdout || processError.stderr || ''
    try {
      const payload = JSON.parse(output) as { Code?: number; Message?: string; error?: { message?: string } }
      throw new Error(payload.Message || payload.error?.message || processError.message)
    } catch (parseError) {
      if (parseError instanceof SyntaxError) throw new Error(processError.message)
      throw parseError
    }
  }
}

export async function searchZhihu(query: string, count: number, refresh = false): Promise<ZhihuSearchItem[]> {
  const key = `${query.toLowerCase()}:${count}`
  const cached = cache.get(key)
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value

  let envelope: PlatformEnvelope<SearchData>
  if (process.env.ZHIHU_ACCESS_SECRET) {
    const params = new URLSearchParams({ Query: query, Count: String(count) })
    envelope = await platformFetch(`/api/v1/content/zhihu_search?${params}`)
  } else {
    envelope = await cliJson(['search', 'zhihu', '--query', query, '--count', String(count)]) as PlatformEnvelope<SearchData>
  }
  if (envelope.Code !== 0) throw new Error(envelope.Message || '知乎搜索失败')
  const value = mapSearchItems(envelope.Data.Items ?? [])
  cache.set(key, { expiresAt: Date.now() + 5 * 60_000, value })
  return value
}

function paperPrompt(input: GenerateRequest): string {
  const notes = input.notes.map((note, index) => {
    const source = note.source ? `；来源：${note.source.author}《${note.source.title}》${note.source.url}` : ''
    return `${index + 1}. [${note.tag}] ${note.body}${source}`
  }).join('\n')
  return `你是“知行”人生答卷规划师。根据用户笔记生成一份务实、温和、可执行的人生答卷。不要诊断心理疾病，不要编造用户事实。引用材料必须保留来源；建议应明确是建议。\n\n笔记：\n${notes}\n\n只输出一个 JSON 对象，不能使用 Markdown 代码块或附加解释。结构必须严格为：\n{"question":"清晰的问题","conditions":["现实限制或过往尝试"],"references":["带来源的参考依据"],"stages":[{"title":"阶段名","period":"时间范围","goal":"目标","score":整数,"tasks":["具体行动"],"criterion":"可验收标准"}],"checkpoints":["时间点与成果"],"comment":"阅卷评语"}\n要求：2到4个阶段，每阶段2到5项行动；阶段分数之和必须等于100；行动适配用户限制；中文输出。`
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  return JSON.parse(candidate)
}

export async function generateWithZhihu(input: GenerateRequest): Promise<GeneratedPaper> {
  const prompt = paperPrompt(input)
  let content: string
  if (process.env.ZHIHU_ACCESS_SECRET) {
    const response = await platformFetch<{ choices: Array<{ message: { content: string } }> }>('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'zhida-thinking-1p5', messages: [{ role: 'user', content: prompt }], stream: false }),
    })
    content = response.choices?.[0]?.message?.content ?? ''
  } else {
    const response = await cliJson(['answer', '--query', prompt, '--model', 'zhida-thinking-1p5', '--output', 'json'], 120_000) as { choices?: Array<{ message?: { content?: string } }> }
    content = response.choices?.[0]?.message?.content ?? ''
  }
  if (!content) throw new Error('知乎直答没有返回有效内容')
  return generatedPaperSchema.parse(extractJson(content))
}
