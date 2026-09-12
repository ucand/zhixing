import pg from 'pg'

const { Pool } = pg
export const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: process.env.VERCEL === '1' ? 1 : 10, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 }) : null

export async function databaseHealth(): Promise<'connected' | 'not_configured' | 'unavailable'> {
  if (!pool) return 'not_configured'
  try {
    await pool.query('select 1')
    return 'connected'
  } catch {
    return 'unavailable'
  }
}
