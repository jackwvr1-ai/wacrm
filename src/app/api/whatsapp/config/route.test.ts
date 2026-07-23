import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// current-state.md ficha 2.11 / recomendación #3: el control de rol
// (admin+) para POST/DELETE de whatsapp_config vive únicamente en la
// política RLS `whatsapp_config_insert/update/delete`. La ruta en TS no
// llama `requireRole('admin')` — si la política cambia, si la ruta pasa a
// usar otro cliente, o si alguien copia el patrón sin la política, la
// barrera desaparece sin que nada lo advierta.
//
// Este test opera a nivel de la ruta (con el cliente Supabase mockeado, sin
// RLS real) para demostrar que HOY el código de la ruta no rechaza
// explícitamente a un miembro sin rol admin — deja pasar a un 'agent' hasta
// el final del handler.
// ---------------------------------------------------------------------------

const ACCOUNT_ID = 'acct-1'
const AGENT_USER_ID = 'user-agent'

let callerRole: 'owner' | 'admin' | 'agent' | 'viewer'
let insertedRows: Array<Record<string, unknown>>
let deletedCount: number

function makeSupabaseMock() {
  function builder(table: string) {
    let didInsert = false
    let didUpdate = false
    let didDelete = false

    const selectResult = () => {
      switch (table) {
        case 'profiles':
          return { data: { account_id: ACCOUNT_ID, account_role: callerRole }, error: null }
        case 'whatsapp_config':
          // No pre-existing config: forces the POST path to insert.
          return { data: null, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const terminal = () => {
      if (didInsert) {
        if (table === 'whatsapp_config') insertedRows.push(lastPayload!)
        return Promise.resolve({ data: null, error: null })
      }
      if (didUpdate) {
        return Promise.resolve({ data: null, error: null })
      }
      if (didDelete) {
        deletedCount += 1
        return Promise.resolve({ data: null, error: null })
      }
      return Promise.resolve(selectResult())
    }

    let lastPayload: Record<string, unknown> | null = null

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'order', 'limit']) b[m] = vi.fn(chain)
    b.insert = vi.fn((payload: Record<string, unknown>) => {
      didInsert = true
      lastPayload = payload
      return b
    })
    b.update = vi.fn((payload: Record<string, unknown>) => {
      didUpdate = true
      lastPayload = payload
      return b
    })
    b.delete = vi.fn(() => {
      didDelete = true
      return b
    })
    b.single = vi.fn(terminal)
    b.maybeSingle = vi.fn(terminal)
    b.then = (resolve: (v: unknown) => unknown) => resolve(terminal())
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: AGENT_USER_ID } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

// Admin client used only for the cross-account phone_number_id conflict
// check — no conflict for these tests.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => {
      const b: Record<string, unknown> = {}
      const chain = () => b
      for (const m of ['select', 'eq', 'neq']) b[m] = vi.fn(chain)
      b.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
      return b
    }),
  })),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace(/^enc:/, '')),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  verifyPhoneNumber: vi.fn(async () => ({ display_phone_number: '+1 555 123 4567' })),
  registerPhoneNumber: vi.fn(async () => ({})),
  subscribeWabaToApp: vi.fn(async () => ({})),
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

import { POST, DELETE } from './route'

function postConfig() {
  return POST(
    new Request('http://localhost/api/whatsapp/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone_number_id: 'PNID-1',
        waba_id: 'WABA-1',
        access_token: 'token-abc',
      }),
    }),
  )
}

describe('whatsapp/config — control de rol admin explícito (defensa en profundidad)', () => {
  beforeEach(() => {
    insertedRows = []
    deletedCount = 0
    callerRole = 'agent' // miembro de la cuenta, SIN rol admin
    supabaseMock = makeSupabaseMock()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('POST: rechaza explícitamente (403) a un miembro sin rol admin, sin llegar a escribir', async () => {
    const res = await postConfig()

    expect(res.status).toBe(403)
    expect(insertedRows).toHaveLength(0)
  })

  it('DELETE: rechaza explícitamente (403) a un miembro sin rol admin, sin llegar a borrar', async () => {
    const res = await DELETE()

    expect(res.status).toBe(403)
    expect(deletedCount).toBe(0)
  })
})
