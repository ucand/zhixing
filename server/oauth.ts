import crypto from 'node:crypto'
import type { Request, Response } from 'express'
import { pool } from './db.js'

const AUTHORIZE_URL = 'https://openapi.zhihu.com/authorize'
const TOKEN_URL = 'https://openapi.zhihu.com/access_token'
const API_ROOT = 'https://developer.zhihu.com'
const SESSION_COOKIE = 'zhixing_session'
const STATE_COOKIE = 'zhixing_oauth_state'
const DAY = 24 * 60 * 60 * 1000

function config() {
  const appId = process.env.ZHIHU_APP_ID
  const appKey = process.env.ZHIHU_APP_KEY
  const redirectUri = process.env.ZHIHU_OAUTH_REDIRECT_URI
  const sessionSecret = process.env.ZHIHU_OAUTH_SESSION_SECRET
  if (!appId || !appKey || !redirectUri || !sessionSecret) throw new Error('知乎 OAuth 环境变量未完整配置')
  return { appId, appKey, redirectUri, sessionSecret }
}
function digest(value: string) { return crypto.createHash('sha256').update(value).digest('hex') }
function randomToken() { return crypto.randomBytes(32).toString('base64url') }
function encryptionKey(secret: string) { return crypto.createHash('sha256').update(secret).digest() }
function encrypt(value: string, secret: string) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}
function setSession(response: Response, token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Max-Age=${30 * DAY / 1000}; Path=/; HttpOnly; SameSite=Lax${secure}`)
}
function setStateCookie(response: Response, token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.append('Set-Cookie', `${STATE_COOKIE}=${token}; Max-Age=600; Path=/; HttpOnly; SameSite=Lax${secure}`)
}
function clearStateCookie(response: Response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.append('Set-Cookie', `${STATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`)
}
function getCookie(request: Request) { return request.headers.cookie?.match(/(?:^|; )zhixing_session=([^;]+)/)?.[1] }
function getStateCookie(request: Request) { return request.headers.cookie?.match(/(?:^|; )zhixing_oauth_state=([^;]+)/)?.[1] }
function queryValue(request: Request, ...names: string[]) {
  for (const name of names) {
    const value = request.query[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) return value[0].trim()
  }
  return ''
}
function profileFromToken(payload: Record<string, unknown>) {
  const names = new Set(['name', 'Name', 'fullname', 'Fullname', 'full_name', 'FullName', 'nickname', 'Nickname', 'user_name', 'UserName', 'display_name', 'DisplayName'])
  const ids = new Set(['id', 'Id', 'user_id', 'UserId', 'url_token', 'UrlToken', 'urlToken'])
  let foundName: string | undefined
  let foundId: string | number | undefined
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || foundName && foundId !== undefined) return
    if (Array.isArray(value)) { for (const item of value) visit(item); return }
    for (const [key, child] of Object.entries(value)) {
      if (!foundName && names.has(key) && typeof child === 'string' && child.trim()) foundName = child.trim()
      if (foundId === undefined && ids.has(key) && ((typeof child === 'string' && child.trim()) || typeof child === 'number')) foundId = child
      visit(child)
    }
  }
  visit(payload)
  return { name: foundName || '知乎用户', providerUserId: foundId === undefined ? null : String(foundId) }
}
async function fetchZhihuProfile(accessToken: string): Promise<{ name?: string; providerUserId?: string | null }> {
  const accessSecret = process.env.ZHIHU_ACCESS_SECRET
  if (!accessSecret) return {}
  try {
    const result = await fetch(`${API_ROOT}/api/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessSecret}`,
        'X-OAuth-Token': accessToken,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        'Content-Type': 'application/json',
      },
    })
    if (!result.ok) return {}
    const payload = await result.json() as Record<string, unknown>
    const nested = (payload.data ?? payload.Data ?? payload.user ?? payload.User) as Record<string, unknown> | undefined
    return profileFromToken(nested ? { user: nested } : payload)
  } catch {
    return {}
  }
}

export function oauthConfigured() { return Boolean(process.env.ZHIHU_APP_ID && process.env.ZHIHU_APP_KEY && process.env.ZHIHU_OAUTH_REDIRECT_URI && process.env.ZHIHU_OAUTH_SESSION_SECRET) }

export async function beginZhihuOAuth(response: Response) {
  const { appId, redirectUri } = config()
  if (!pool) throw new Error('DATABASE_URL 未配置，无法保存 OAuth 授权状态')
  const state = randomToken()
  await pool.query('delete from oauth_state where expires_at < now()')
  await pool.query("insert into oauth_state (state_hash, redirect_uri, expires_at) values ($1,$2,now() + interval '10 minutes')", [digest(state), redirectUri])
  setStateCookie(response, state)
  const url = new URL(AUTHORIZE_URL)
  // Zhihu's current authorize endpoint rejects/omits state. Keep the
  // correlation value in a short-lived HttpOnly cookie instead.
  url.searchParams.set('redirect_uri', redirectUri); url.searchParams.set('app_id', appId); url.searchParams.set('response_type', 'code')
  response.redirect(url.toString())
}

export async function completeZhihuOAuth(request: Request, response: Response) {
  const { appId, appKey, redirectUri, sessionSecret } = config()
  if (!pool) throw new Error('DATABASE_URL 未配置，无法完成 OAuth 授权')
  const providerError = queryValue(request, 'error', 'error_code')
  if (providerError) throw new Error(`知乎 OAuth 授权未完成：${queryValue(request, 'error_description', 'message') || providerError}`)
  const state = queryValue(request, 'state') || getStateCookie(request) || ''
  const code = queryValue(request, 'authorization_code', 'authorizationCode', 'auth_code', 'code')
  if (!code) throw new Error('知乎 OAuth 回调未返回 authorization_code/code，请确认已点击“确认授权”且知乎应用配置正确')
  if (!state) throw new Error('知乎 OAuth 回调缺少 state Cookie，请从知行页面重新发起授权，不要直接打开回调地址')
  const stateResult = await pool.query('delete from oauth_state where state_hash=$1 and redirect_uri=$2 and expires_at > now() returning id', [digest(state), redirectUri])
  if (!stateResult.rows[0]) throw new Error('知乎 OAuth state 无效或已过期')
  clearStateCookie(response)
  const body = new URLSearchParams({ app_id: appId, app_key: appKey, grant_type: 'authorization_code', redirect_uri: redirectUri, code })
  const tokenResponse = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  const tokenPayload = await tokenResponse.json() as Record<string, unknown> & { access_token?: string; token_type?: string; expires_in?: number; message?: string }
  if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.message || '知乎 OAuth Token 获取失败')
  const client = await pool.connect()
  try {
    await client.query('begin')
    const profile = { ...profileFromToken(tokenPayload), ...(await fetchZhihuProfile(tokenPayload.access_token)) }
    const user = await client.query('insert into app_user (display_name) values ($1) returning id', [profile.name])
    const userId = user.rows[0].id as string
    await client.query("insert into zhihu_oauth_account (user_id, provider_user_id, access_token_ciphertext, token_type, expires_at) values ($1,$2,$3,$4,case when $5::bigint > 0 then now() + ($5::bigint * interval '1 second') else null end)", [userId, profile.providerUserId, encrypt(tokenPayload.access_token, sessionSecret), tokenPayload.token_type ?? 'Bearer', tokenPayload.expires_in ?? 0])
    const session = randomToken()
    await client.query("insert into oauth_session (user_id, token_hash, expires_at) values ($1,$2,now() + interval '30 days')", [userId, digest(session)])
    await client.query('commit'); setSession(response, session); response.redirect('/?oauth=success')
  } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
}

export async function currentOAuthUser(request: Request) {
  if (!pool) return null
  const token = getCookie(request); if (!token) return null
  const result = await pool.query("select u.id, u.display_name, a.provider, a.expires_at from oauth_session s join app_user u on u.id=s.user_id left join zhihu_oauth_account a on a.user_id=u.id and a.provider='zhihu' where s.token_hash=$1 and s.expires_at > now()", [digest(token)])
  return result.rows[0] ?? null
}
export async function logoutOAuth(request: Request, response: Response) {
  if (pool) { const token = getCookie(request); if (token) await pool.query('delete from oauth_session where token_hash=$1', [digest(token)]) }
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); response.status(204).end()
}
