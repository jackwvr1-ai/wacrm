import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetRateLimitForTests } from '@/lib/rate-limit'

// ---------------------------------------------------------------------------
// Fase 3.3 bloque 2 — PATCH /api/account debe aceptar los 8 campos de negocio
// de 038_account_business_fields.sql (todos NULLABLE, sin DEFAULT) ademas del
// `name` original. La DB solo valida FORMA via CHECK (country_code,
// language_code, business_email) o no valida nada (timezone, business_type,
// logo_url, business_phone, address) — la app debe validar antes de mandar,
// en particular `timezone` contra Intl.supportedValuesOf('timeZone'), que la
// DB no puede chequear.
//
// Supabase mockeado (sin RLS real), mismo patron que
// whatsapp/config/route.test.ts.
// ---------------------------------------------------------------------------

const ACCOUNT_ID = 'acct-1'
const ADMIN_USER_ID = 'user-admin'

const BASE_ACCOUNT_ROW = {
  id: ACCOUNT_ID,
  name: 'Existing Account',
  business_type: null,
  country_code: null,
  timezone: null,
  language_code: null,
  logo_url: null,
  business_email: null,
  business_phone: null,
  address: null,
}

let callerRole: 'owner' | 'admin' | 'agent' | 'viewer'
let updatePayload: Record<string, unknown> | null
let updateResult: { data: Record<string, unknown> | null; error: { message: string } | null }

function makeSupabaseMock() {
  function builder(table: string) {
    let didUpdate = false

    const b: Record<string, unknown> = {}
    const chain = () => b
    b.select = vi.fn(chain)
    b.eq = vi.fn(chain)
    b.update = vi.fn((payload: Record<string, unknown>) => {
      didUpdate = true
      if (table === 'accounts') updatePayload = payload
      return b
    })

    const terminal = async () => {
      if (didUpdate) return updateResult
      if (table === 'profiles') {
        return { data: { account_id: ACCOUNT_ID, account_role: callerRole }, error: null }
      }
      if (table === 'accounts') {
        return { data: BASE_ACCOUNT_ROW, error: null }
      }
      return { data: null, error: null }
    }
    b.single = vi.fn(terminal)
    b.maybeSingle = vi.fn(terminal)
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: ADMIN_USER_ID } }, error: null })),
    },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

import { PATCH } from './route'

function patchAccount(body: Record<string, unknown>) {
  return PATCH(
    new Request('http://localhost/api/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('PATCH /api/account — campos de negocio (038_account_business_fields.sql)', () => {
  beforeEach(() => {
    callerRole = 'admin'
    updatePayload = null
    updateResult = { data: { ...BASE_ACCOUNT_ROW }, error: null }
    supabaseMock = makeSupabaseMock()
    __resetRateLimitForTests()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('acepta y persiste los 8 campos de negocio nuevos junto con name', async () => {
    updateResult = {
      data: {
        id: ACCOUNT_ID,
        name: 'Acme SRL',
        business_type: 'retail',
        country_code: 'AR',
        timezone: 'America/Argentina/Salta',
        language_code: 'es-AR',
        logo_url: 'https://cdn.example.com/logo.png',
        business_email: 'hola@acme.com',
        business_phone: '+54 9 11 5555-5555',
        address: 'Av. Siempre Viva 742',
      },
      error: null,
    }

    const res = await patchAccount({
      name: 'Acme SRL',
      business_type: 'retail',
      country_code: 'AR',
      timezone: 'America/Argentina/Salta',
      language_code: 'es-AR',
      logo_url: 'https://cdn.example.com/logo.png',
      business_email: 'hola@acme.com',
      business_phone: '+54 9 11 5555-5555',
      address: 'Av. Siempre Viva 742',
    })

    expect(res.status).toBe(200)
    expect(updatePayload).toEqual({
      name: 'Acme SRL',
      business_type: 'retail',
      country_code: 'AR',
      timezone: 'America/Argentina/Salta',
      language_code: 'es-AR',
      logo_url: 'https://cdn.example.com/logo.png',
      business_email: 'hola@acme.com',
      business_phone: '+54 9 11 5555-5555',
      address: 'Av. Siempre Viva 742',
    })
    const json = await res.json()
    expect(json.account.business_type).toBe('retail')
    expect(json.account.timezone).toBe('America/Argentina/Salta')
  })

  it('permite un PATCH parcial de un solo campo de negocio, sin name', async () => {
    const res = await patchAccount({ business_type: 'services' })

    expect(res.status).toBe(200)
    expect(updatePayload).toEqual({ business_type: 'services' })
  })

  it('rechaza country_code mal formado (400) sin llegar a actualizar', async () => {
    const res = await patchAccount({ country_code: 'arg' })

    expect(res.status).toBe(400)
    expect(updatePayload).toBeNull()
  })

  it('rechaza language_code mal formado (400)', async () => {
    const res = await patchAccount({ language_code: 'spanish' })

    expect(res.status).toBe(400)
    expect(updatePayload).toBeNull()
  })

  it('rechaza business_email mal formado (400)', async () => {
    const res = await patchAccount({ business_email: 'not-an-email' })

    expect(res.status).toBe(400)
    expect(updatePayload).toBeNull()
  })

  it('rechaza timezone que no es un IANA valido (400) — la DB no lo valida', async () => {
    const res = await patchAccount({ timezone: 'Nowhere/Fake' })

    expect(res.status).toBe(400)
    expect(updatePayload).toBeNull()
  })

  it('acepta un timezone IANA valido', async () => {
    const res = await patchAccount({ timezone: 'America/New_York' })

    expect(res.status).toBe(200)
    expect(updatePayload).toEqual({ timezone: 'America/New_York' })
  })

  it('permite limpiar un campo opcional enviando null', async () => {
    const res = await patchAccount({ logo_url: null })

    expect(res.status).toBe(200)
    expect(updatePayload).toEqual({ logo_url: null })
  })

  it('400 si el body no tiene ningun campo reconocido para actualizar', async () => {
    const res = await patchAccount({})

    expect(res.status).toBe(400)
    expect(updatePayload).toBeNull()
  })
})
