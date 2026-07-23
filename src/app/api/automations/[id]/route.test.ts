import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hallazgo Alta #1 (current-state.md, fichas 2.3/2.4): estas rutas filtran
// por `user_id` en vez de `account_id`. Un compañero de la misma cuenta que
// no creó la automatización debería poder verla / editarla / borrarla —tal
// como lo permite la política RLS subyacente (automations_select/update/
// delete = is_account_member(account_id))— pero hoy es rechazado.
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
let deletedIds: string[]
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
  deletedIds = []
}

function matchesFilters(row: AutomationRow, filters: Record<string, unknown>) {
  return Object.entries(filters).every(
    ([k, v]) => (row as unknown as Record<string, unknown>)[k] === v,
  )
}

// Chainable Supabase-like query builder shared by both clients below.
// `scopeToAccount` models the RLS boundary: the real automations_select /
// _update / _delete policies are `is_account_member(account_id)` — they
// scope by the caller's account regardless of what the query's own .eq()
// filters ask for. The service-role admin client bypasses RLS entirely,
// so it only ever applies the explicit .eq() filters the route code adds.
function makeQueryBuilder(table: string, scopeToAccount: boolean) {
  const filters: Record<string, unknown> = {}
  let didDelete = false
  let updatePatch: Record<string, unknown> | null = null

  const b: Record<string, unknown> = {}
  b.select = vi.fn(() => b)
  b.eq = vi.fn((k: string, v: unknown) => {
    filters[k] = v
    return b
  })
  b.order = vi.fn(() => b)
  b.update = vi.fn((patch: Record<string, unknown>) => {
    updatePatch = patch
    return b
  })
  b.delete = vi.fn(() => {
    didDelete = true
    return b
  })

  const resolve = () => {
    if (table === 'profiles') {
      return { data: { account_id: ACCOUNT_ID, account_role: callerRole }, error: null }
    }
    if (table === 'accounts') {
      return { data: { id: ACCOUNT_ID, name: 'Acme' }, error: null }
    }
    if (table === 'automations') {
      const pool = scopeToAccount
        ? automationsDb.filter((r) => r.account_id === ACCOUNT_ID)
        : automationsDb
      const row = pool.find((r) => matchesFilters(r, filters))
      if (didDelete) {
        if (row) {
          deletedIds.push(row.id)
          automationsDb = automationsDb.filter((r) => r.id !== row.id)
        }
        return { data: null, error: null }
      }
      if (updatePatch && row) Object.assign(row, updatePatch)
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

vi.mock('@/lib/automations/steps-tree', () => ({
  loadStepsTree: vi.fn(async () => []),
  replaceSteps: vi.fn(async () => null),
}))

vi.mock('@/lib/automations/validate', () => ({
  validateStepsForActivation: vi.fn(() => []),
  validateTriggerForActivation: vi.fn(() => []),
}))

import { GET, PATCH, DELETE } from './route'

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('automations/[id] — acceso a nivel de cuenta, no solo el creador', () => {
  beforeEach(() => {
    resetDb()
    callerId = MEMBER_ID // miembro de la misma cuenta, NO el creador
    callerRole = 'agent'
    rlsClient = makeRlsClient()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('GET: un miembro de la misma cuenta que no creó la automatización puede verla', async () => {
    const res = await GET(
      new Request('http://localhost/api/automations/auto-1'),
      params('auto-1'),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.automation?.id).toBe('auto-1')
  })

  it('PATCH: un miembro de la misma cuenta que no creó la automatización puede editarla', async () => {
    const res = await PATCH(
      new Request('http://localhost/api/automations/auto-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renombrada' }),
      }),
      params('auto-1'),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(automationsDb.find((r) => r.id === 'auto-1')?.name).toBe('Renombrada')
  })

  it('DELETE: un miembro de la misma cuenta que no creó la automatización puede borrarla', async () => {
    const res = await DELETE(
      new Request('http://localhost/api/automations/auto-1', { method: 'DELETE' }),
      params('auto-1'),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(deletedIds).toContain('auto-1')
  })
})
