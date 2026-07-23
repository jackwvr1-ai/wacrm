import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hallazgo Alta #1 (current-state.md, ficha 2.4): esta ruta filtra el
// original por `user_id` en vez de `account_id`. Un compañero de la misma
// cuenta que no creó la automatización debería poder duplicarla —tal como lo
// permite automations_select = is_account_member(account_id)— pero hoy es
// rechazado con 404.
// ---------------------------------------------------------------------------

const ACCOUNT_ID = 'acct-1'
const OWNER_ID = 'user-owner'
const MEMBER_ID = 'user-member'

interface AutomationRow {
  id: string
  account_id: string
  user_id: string
  name: string
  description: string | null
  trigger_type: string
  trigger_config: Record<string, unknown>
  is_active: boolean
}

let automationsDb: AutomationRow[]
let callerId: string
let callerRole: 'owner' | 'admin' | 'agent' | 'viewer'

function resetDb() {
  automationsDb = [
    {
      id: 'auto-1',
      account_id: ACCOUNT_ID,
      user_id: OWNER_ID,
      name: 'Welcome flow',
      description: null,
      trigger_type: 'manual',
      trigger_config: {},
      is_active: false,
    },
  ]
}

function matchesFilters(row: AutomationRow, filters: Record<string, unknown>) {
  return Object.entries(filters).every(
    ([k, v]) => (row as unknown as Record<string, unknown>)[k] === v,
  )
}

// See route.test.ts in the parent dir for the rationale: scopeToAccount
// models the RLS boundary (automations_select = is_account_member(account_id)),
// the admin client bypasses RLS and only applies explicit .eq() filters.
function makeQueryBuilder(table: string, scopeToAccount: boolean) {
  const filters: Record<string, unknown> = {}
  let insertPayload: Record<string, unknown> | null = null

  const b: Record<string, unknown> = {}
  b.select = vi.fn(() => b)
  b.eq = vi.fn((k: string, v: unknown) => {
    filters[k] = v
    return b
  })
  b.order = vi.fn(() => b)
  b.insert = vi.fn((payload: Record<string, unknown>) => {
    insertPayload = payload
    return b
  })

  const resolve = () => {
    if (table === 'profiles') {
      return { data: { account_id: ACCOUNT_ID, account_role: callerRole }, error: null }
    }
    if (table === 'accounts') {
      return { data: { id: ACCOUNT_ID, name: 'Acme' }, error: null }
    }
    if (table === 'automation_steps') {
      return { data: [], error: null }
    }
    if (table === 'automations') {
      if (insertPayload) {
        const row: AutomationRow = {
          id: 'auto-copy',
          account_id: insertPayload.account_id as string,
          user_id: insertPayload.user_id as string,
          name: insertPayload.name as string,
          description: (insertPayload.description as string | null) ?? null,
          trigger_type: insertPayload.trigger_type as string,
          trigger_config: insertPayload.trigger_config as Record<string, unknown>,
          is_active: Boolean(insertPayload.is_active),
        }
        automationsDb.push(row)
        return { data: row, error: null }
      }
      const pool = scopeToAccount
        ? automationsDb.filter((r) => r.account_id === ACCOUNT_ID)
        : automationsDb
      const row = pool.find((r) => matchesFilters(r, filters))
      return { data: row ?? null, error: null }
    }
    return { data: null, error: null }
  }

  b.maybeSingle = vi.fn(() => Promise.resolve(resolve()))
  b.single = vi.fn(() => Promise.resolve(resolve()))
  b.then = (res: (v: unknown) => unknown) => res(resolve())
  return b
}

function makeRlsClient() {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: callerId } }, error: null })),
    },
    from: vi.fn((table: string) => makeQueryBuilder(table, true)),
  }
}

function makeAdminClient() {
  return {
    from: vi.fn((table: string) => makeQueryBuilder(table, false)),
  }
}

let rlsClient = makeRlsClient()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => rlsClient),
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => makeAdminClient(),
}))

import { POST } from './route'

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('POST automations/[id]/duplicate — acceso a nivel de cuenta', () => {
  beforeEach(() => {
    resetDb()
    callerId = MEMBER_ID // miembro de la misma cuenta, NO el creador
    callerRole = 'agent'
    rlsClient = makeRlsClient()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('un miembro de la misma cuenta que no creó la automatización puede duplicarla', async () => {
    const res = await POST(
      new Request('http://localhost/api/automations/auto-1/duplicate', { method: 'POST' }),
      params('auto-1'),
    )
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.automation?.account_id).toBe(ACCOUNT_ID)
    expect(json.automation?.name).toBe('Welcome flow (Copy)')
  })
})
