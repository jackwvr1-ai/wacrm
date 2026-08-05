// Fase 3.4a — lógica pura del wizard de /setup: qué pasos se muestran,
// cuándo el negocio cuenta como "configurado" y cómo se avanza/omite.
// Extraída del componente para poder testearla sin DOM (ver wizard-plan.test.ts).

export type WizardStepKey = 'business' | 'whatsapp' | 'team'

export function getWizardSteps({
  canManageMembers,
}: {
  canManageMembers: boolean
}): WizardStepKey[] {
  const steps: WizardStepKey[] = ['business', 'whatsapp']
  if (canManageMembers) steps.push('team')
  return steps
}

// Mismo fallback que resolve_account_name (039_account_name_from_business_field.sql,
// línea 62) usa cuando no hay business_name/full_name/email — no cuenta como
// "el negocio ya está configurado" aunque accounts.name esté NOT NULL.
const GENERIC_ACCOUNT_NAME = 'My account'

export function isBusinessConfigured(
  account: { name: string | null } | null | undefined,
): boolean {
  const name = account?.name?.trim()
  return !!name && name !== GENERIC_ACCOUNT_NAME
}

// Fase 3.4b — misma decisión que `isBusinessConfigured`, leída al revés,
// para que el layout del dashboard exprese la intención directamente
// (`if (shouldRedirectToSetup(account)) redirect('/setup')`) sin negar la
// condición inline. Ni el wizard ni el checklist deben duplicar esta regla:
// todos comparten esta única fuente de verdad.
export function shouldRedirectToSetup(
  account: { name: string | null } | null | undefined,
): boolean {
  return !isBusinessConfigured(account)
}

// Los pasos opcionales (whatsapp, team) no tienen condición de avance: "Omitir"
// y "Continuar" llaman a esta misma función, así que nunca pueden trabarse.
export function getNextStepIndex(currentIndex: number, steps: WizardStepKey[]): number | null {
  const next = currentIndex + 1
  return next < steps.length ? next : null
}
