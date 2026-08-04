import { describe, it, expect } from 'vitest'

import { getWizardSteps, isBusinessConfigured, getNextStepIndex } from './wizard-plan'

// Fase 3.4a — wizard de configuración inicial en /setup.
//
// El componente no tiene test de DOM (el repo no tiene jsdom/testing-library
// instalados; el único precedente de test de componente usa
// renderToStaticMarkup sin interacción — ver dropdown-menu-group-label.test.tsx).
// Se cubre en cambio la lógica pura que decide QUÉ pasos se muestran, CUÁNDO
// el negocio cuenta como "configurado" y CÓMO se avanza/omite — la misma
// lógica que el componente consume tal cual, sin duplicarla.

describe('getWizardSteps', () => {
  it('siempre incluye negocio y whatsapp', () => {
    expect(getWizardSteps({ canManageMembers: false })).toEqual(['business', 'whatsapp'])
  })

  it('agrega el paso de equipo solo si canManageMembers es true', () => {
    expect(getWizardSteps({ canManageMembers: true })).toEqual([
      'business',
      'whatsapp',
      'team',
    ])
  })

  it('omite el paso de equipo cuando canManageMembers es false', () => {
    const steps = getWizardSteps({ canManageMembers: false })
    expect(steps).not.toContain('team')
  })
})

describe('isBusinessConfigured', () => {
  it('es false sin cuenta', () => {
    expect(isBusinessConfigured(null)).toBe(false)
    expect(isBusinessConfigured(undefined)).toBe(false)
  })

  it('es false cuando el nombre está vacío o es solo espacios', () => {
    expect(isBusinessConfigured({ name: '' })).toBe(false)
    expect(isBusinessConfigured({ name: '   ' })).toBe(false)
    expect(isBusinessConfigured({ name: null })).toBe(false)
  })

  it('es false cuando el nombre es el fallback genérico de resolve_account_name (039)', () => {
    expect(isBusinessConfigured({ name: 'My account' })).toBe(false)
  })

  it('es true con un nombre de negocio real', () => {
    expect(isBusinessConfigured({ name: 'Acme Restaurantes' })).toBe(true)
  })
})

describe('getNextStepIndex', () => {
  it('avanza al siguiente índice mientras queden pasos', () => {
    const steps = getWizardSteps({ canManageMembers: false })
    expect(getNextStepIndex(0, steps)).toBe(1)
  })

  it('devuelve null (fin del wizard → /dashboard) tras el último paso', () => {
    const steps = getWizardSteps({ canManageMembers: false })
    expect(getNextStepIndex(steps.length - 1, steps)).toBeNull()
  })

  it('omitir un paso opcional también llega al final sin bloquear', () => {
    const steps = getWizardSteps({ canManageMembers: true })
    // Paso 2 (whatsapp, índice 1) omitido → Paso 3 (team, índice 2) omitido → fin.
    const afterSkipWhatsapp = getNextStepIndex(1, steps)
    expect(afterSkipWhatsapp).toBe(2)
    const afterSkipTeam = getNextStepIndex(afterSkipWhatsapp as number, steps)
    expect(afterSkipTeam).toBeNull()
  })
})
