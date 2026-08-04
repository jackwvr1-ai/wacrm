'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { OrganizationSettings } from '@/components/settings/organization-settings';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { InviteMemberDialog } from '@/components/settings/invite-member-dialog';
import { getWizardSteps, getNextStepIndex, isBusinessConfigured } from './wizard-plan';

// Fase 3.4a — wizard de configuración inicial. Envuelve pantallas ya
// existentes (Organización / WhatsApp / Invitar), no las reimplementa.
// El redirect automático hacia esta ruta (Fase 3.4b) NO se implementa acá:
// por ahora solo se llega vía los links del OnboardingChecklist.
export function SetupWizard() {
  const t = useTranslations('Setup');
  const router = useRouter();
  const { account, canManageMembers, profileLoading } = useAuth();

  const steps = useMemo(() => getWizardSteps({ canManageMembers }), [canManageMembers]);
  const [stepIndex, setStepIndex] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);

  // Si el rol cambia bajo el wizard y el índice actual queda fuera de
  // rango (p. ej. el paso "team" desaparece), no renderizar en blanco.
  useEffect(() => {
    setStepIndex((i) => Math.min(i, steps.length - 1));
  }, [steps]);

  function goNext() {
    const next = getNextStepIndex(stepIndex, steps);
    if (next === null) {
      router.replace('/dashboard');
      return;
    }
    setStepIndex(next);
  }

  // El Paso 1 no tiene botón de avance propio: en cuanto el negocio queda
  // configurado (misma fuente que lee el checklist — useAuth().account,
  // ver wizard-plan.ts) el wizard avanza solo al Paso 2. Si el usuario
  // llega acá con el negocio ya configurado, salta el paso de inmediato.
  useEffect(() => {
    if (profileLoading) return;
    if (steps[stepIndex] === 'business' && isBusinessConfigured(account)) {
      goNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, profileLoading, stepIndex, steps]);

  if (profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const currentStep = steps[stepIndex];

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10">
      <div className="mb-6">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('stepProgress', { current: stepIndex + 1, total: steps.length })}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {currentStep === 'business' && <OrganizationSettings />}

      {currentStep === 'whatsapp' && (
        <div>
          <WhatsAppConfig />
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={goNext}>
              {t('skip')}
            </Button>
            <Button type="button" onClick={goNext}>
              {t('continue')}
            </Button>
          </div>
        </div>
      )}

      {currentStep === 'team' && (
        <div>
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-base font-semibold text-foreground">
              {t('teamTitle')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('teamSubtitle')}</p>
            <Button type="button" className="mt-4" onClick={() => setInviteOpen(true)}>
              {t('inviteAction')}
            </Button>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={goNext}>
              {t('skip')}
            </Button>
            <Button type="button" onClick={goNext}>
              {t('finish')}
            </Button>
          </div>
          <InviteMemberDialog
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            onCreated={() => {}}
          />
        </div>
      )}
    </div>
  );
}
