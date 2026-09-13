import crypto from 'node:crypto'
import type { Request, Response } from 'express'
import { pool } from './db.js'

const AUTHORIZE_URL = 'https://openapi.zhihu.com/authorize'
const TOKEN_URL = 'https://openapi.zhihu.com/access_token'
const SESSION_COOKIE = 'zhixing_session'
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
function getCookie(request: Request) { return request.headers.cookie?.match(/(?:^|; )zhixing_session=([^;]+)/)?.[1] }

export function oauthConfigured() { return Boolean(process.env.ZHIHU_APP_ID && process.env.ZHIHU_APP_KEY && process.env.ZHIHU_OAUTH_REDIRECT_URI && process.env.ZHIHU_OAUTH_SESSION_SECRET) }

export async function beginZhihuOAuth(response: Response) {
  const { appId, redirectUri } = config()
  if (!pool) throw new Error('DATABASE_URL 未配置，无法保存 OAuth 授权状态')
  const state = randomToken()
  await pool.query('delete from oauth_state where expires_at < now()')
  await pool.query("insert into oauth_state (state_hash, redirect_uri, expires_at) values ($1,$2,now() + interval '10 minutes')", [digest(state), redirectUri])
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('redirect_uri', redirectUri); url.searchParams.set('app_id', appId); url.searchParams.set('response_type', 'code'); url.searchParams.set('state', state)
  response.redirect(url.toString())
}

export async function completeZhihuOAuth(request: Request, response: Response) {
  const { appId, appKey, redirectUri, sessionSecret } = config()
  if (!pool) throw new Error('DATABASE_URL 未配置，无法完成 OAuth 授权')
  const state = String(request.query.state ?? '')
  const code = String(request.query.authorization_code ?? request.query.code ?? '')
  if (!state || !code) throw new Error('知乎 OAuth 回调缺少授权参数')
  const stateResult = await pool.query('delete from oauth_state where state_hash=$1 and redirect_uri=$2 and expires_at > now() returning id', [digest(state), redirectUri])
  if (!stateResult.rows[0]) throw new Error('知乎 OAuth state 无效或已过期')
  const body = new URLSearchParams({ app_id: appId, app_key: appKey, grant_type: 'authorization_code', redirect_uri: redirectUri, code })
  const tokenResponse = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  const tokenPayload = await tokenResponse.json() as { access_token?: string; token_type?: string; expires_in?: number; message?: string }
  if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.message || '知乎 OAuth Token 获取失败')
  const client = await pool.connect()
  try {
    await client.query('begin')
    const user = await client.query("insert into app_user (display_name) values ('知乎用户') returning id")
    const userId = user.rows[0].id as string
    await client.query("insert into zhihu_oauth_account (user_id, access_token_ciphertext, token_type, expires_at) values ($1,$2,$3,case when $4::bigint > 0 then now() + ($4::bigint * interval '1 second') else null end)", [userId, encrypt(tokenPayload.access_token, sessionSecret), tokenPayload.token_type ?? 'Bearer', tokenPayload.expires_in ?? 0])
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
