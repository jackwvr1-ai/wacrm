'use client'

import { useCallback, useEffect, useState, type ComponentType } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Building2, CheckCircle2, Circle, MessageSquare, UsersRound, X } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { Skeleton } from '@/components/dashboard/skeleton'
import { InviteMemberDialog } from '@/components/settings/invite-member-dialog'

// Dismissal is a browser-local UI preference, not account data — it
// lives in localStorage rather than a DB column. Keyed by account AND
// user so a freshly invited teammate on a fully-set-up account still
// sees their own copy of the checklist once.
const DISMISS_KEY_PREFIX = 'wacrm:onboarding-dismissed'

function dismissKey(accountId: string, userId: string): string {
  return `${DISMISS_KEY_PREFIX}:${accountId}:${userId}`
}

interface Item {
  key: string
  icon: ComponentType<{ className?: string }>
  title: string
  subtitle: string
  complete: boolean
  action?: { label: string; href?: string; onClick?: () => void }
}

export function OnboardingChecklist() {
  const t = useTranslations('Dashboard.onboarding')
  const { user, accountId, account, profileLoading, canEditSettings, canManageMembers } =
    useAuth()

  const [whatsappConfigured, setWhatsappConfigured] = useState<boolean | null>(null)
  const [membersCount, setMembersCount] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)

  // Read the dismissed flag once we know who's looking. Runs client-side
  // only (localStorage), so the widget stays hidden until this settles —
  // avoids a flash of the full checklist for someone who already closed it.
  useEffect(() => {
    if (!accountId || !user) return
    void (async () => {
      const isDismissed = localStorage.getItem(dismissKey(accountId, user.id)) === '1'
      setDismissed(isDismissed)
      setHydrated(true)
    })()
  }, [accountId, user])

  const loadStatus = useCallback(async () => {
    if (!accountId) return
    const db = createClient()

    const whatsappPromise = db
      .from('whatsapp_config')
      .select('phone_number_id')
      .eq('account_id', accountId)
      .maybeSingle()

    // Members count only matters for roles that can see/act on that item —
    // skip the round trip otherwise.
    const membersPromise = canManageMembers
      ? fetch('/api/account/members', { cache: 'no-store' }).then((r) => r.json())
      : Promise.resolve(null)

    const [whatsappRes, membersRes] = await Promise.allSettled([
      whatsappPromise,
      membersPromise,
    ])

    setWhatsappConfigured(
      whatsappRes.status === 'fulfilled' && !!whatsappRes.value.data?.phone_number_id,
    )

    if (canManageMembers) {
      setMembersCount(
        membersRes.status === 'fulfilled' && Array.isArray(membersRes.value?.members)
          ? membersRes.value.members.length
          : null,
      )
    }
  }, [accountId, canManageMembers])

  useEffect(() => {
    void (async () => {
      await loadStatus()
    })()
  }, [loadStatus])

  function dismiss() {
    if (!accountId || !user) return
    localStorage.setItem(dismissKey(accountId, user.id), '1')
    setDismissed(true)
  }

  const dataLoading =
    profileLoading ||
    whatsappConfigured === null ||
    (canManageMembers && membersCount === null)

  if (!hydrated || dismissed) return null

  if (dataLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-3 h-3 w-full max-w-md" />
      </div>
    )
  }

  const items: Item[] = [
    {
      key: 'organization',
      icon: Building2,
      title: t('organizationTitle'),
      subtitle: account?.name || t('organizationFallback'),
      complete: true,
      action: { label: t('organizationAction'), href: '/settings?tab=organization' },
    },
    {
      key: 'whatsapp',
      icon: MessageSquare,
      title: t('whatsappTitle'),
      subtitle: whatsappConfigured
        ? t('whatsappConnectedSubtitle')
        : canEditSettings
          ? t('whatsappPendingSubtitle')
          : t('whatsappPendingAgentSubtitle'),
      complete: !!whatsappConfigured,
      action:
        !whatsappConfigured && canEditSettings
          ? { label: t('whatsappAction'), href: '/settings?tab=whatsapp' }
          : undefined,
    },
  ]

  if (canManageMembers) {
    const teamComplete = (membersCount ?? 0) > 1
    items.push({
      key: 'members',
      icon: UsersRound,
      title: `${t('membersTitle')} (${t('membersOptional')})`,
      subtitle: teamComplete
        ? t('teamInvitedSubtitle', { count: membersCount ?? 0 })
        : t('teamPendingSubtitle'),
      complete: teamComplete,
      action: teamComplete
        ? { label: t('viewTeamAction'), href: '/settings?tab=members' }
        : { label: t('inviteAction'), onClick: () => setInviteOpen(true) },
    })
  }

  const allDone = items.every((i) => i.complete)
  const doneCount = items.filter((i) => i.complete).length

  if (allDone) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="size-5 text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">{t('allDoneTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('allDoneSubtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('dismiss')}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('subtitle', { done: doneCount, total: items.length })}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('dismiss')}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <ul className="mt-3 divide-y divide-border">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <li key={item.key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                {item.complete ? (
                  <CheckCircle2 className="size-5 shrink-0 text-primary" />
                ) : (
                  <Circle className="size-5 shrink-0 text-muted-foreground" />
                )}
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
                </div>
                {item.action &&
                  (item.action.href ? (
                    <Link
                      href={item.action.href}
                      className="shrink-0 whitespace-nowrap rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
                    >
                      {item.action.label}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={item.action.onClick}
                      className="shrink-0 whitespace-nowrap rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
                    >
                      {item.action.label}
                    </button>
                  ))}
              </li>
            )
          })}
        </ul>
      </div>

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onCreated={loadStatus}
      />
    </>
  )
}
