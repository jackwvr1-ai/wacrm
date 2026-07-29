'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { COUNTRIES } from '@/lib/countries';
import { LANGUAGES } from '@/lib/languages';
import type { Account } from '@/types';

// Rough shape check, mirroring the server's own laxa validation
// (business_email CHECK in 038_account_business_fields.sql /
// PATCH /api/account) — just catches obvious typos before the round trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_NAME_LEN = 80;

// Radix Select can't use an empty-string item value, so "no selection"
// gets a sentinel that maps to null in the payload.
const UNSET = '__unset__';

type OrgFields = Pick<
  Account,
  | 'name'
  | 'business_type'
  | 'country_code'
  | 'timezone'
  | 'language_code'
  | 'business_email'
  | 'business_phone'
  | 'address'
>;

const EMPTY_FIELDS: OrgFields = {
  name: '',
  business_type: '',
  country_code: '',
  timezone: '',
  language_code: '',
  business_email: '',
  business_phone: '',
  address: '',
};

function toFields(account: Account): OrgFields {
  return {
    name: account.name ?? '',
    business_type: account.business_type ?? '',
    country_code: account.country_code ?? '',
    timezone: account.timezone ?? '',
    language_code: account.language_code ?? '',
    business_email: account.business_email ?? '',
    business_phone: account.business_phone ?? '',
    address: account.address ?? '',
  };
}

// Same IANA source Node's ICU build exposes to the server
// (Intl.supportedValuesOf('timeZone') in PATCH /api/account) — picking
// from this list guarantees the value passes that check.
const TIMEZONES =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : [];

export function OrganizationSettings() {
  const t = useTranslations('Settings.organization');
  const { accountId, canEditSettings, profileLoading, refreshProfile } =
    useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<OrgFields>(EMPTY_FIELDS);
  const [saved, setSaved] = useState<OrgFields>(EMPTY_FIELDS);
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchAccount = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/account', { method: 'GET' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('loadFailed'));
        return;
      }
      const next = toFields(data.account as Account);
      setFields(next);
      setSaved(next);
    } catch (err) {
      console.error('[OrganizationSettings] fetchAccount error:', err);
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (profileLoading) return;
    if (!accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchAccount();
  }, [profileLoading, accountId, fetchAccount]);

  function setField<K extends keyof OrgFields>(key: K, value: OrgFields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  const dirty = (Object.keys(EMPTY_FIELDS) as (keyof OrgFields)[]).some(
    (key) => (fields[key] ?? '') !== (saved[key] ?? ''),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;

    const trimmedName = (fields.name ?? '').trim();
    if (!trimmedName) {
      toast.error(t('nameRequired'));
      return;
    }
    if (trimmedName.length > MAX_NAME_LEN) {
      toast.error(t('nameTooLong', { max: MAX_NAME_LEN }));
      return;
    }
    const trimmedEmail = (fields.business_email ?? '').trim();
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      toast.error(t('invalidEmail'));
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, string | null> = {
        name: trimmedName,
        business_type: (fields.business_type ?? '').trim() || null,
        country_code: (fields.country_code ?? '').trim() || null,
        timezone: (fields.timezone ?? '').trim() || null,
        language_code: (fields.language_code ?? '').trim() || null,
        business_email: trimmedEmail || null,
        business_phone: (fields.business_phone ?? '').trim() || null,
        address: (fields.address ?? '').trim() || null,
      };

      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || t('saveFailed'));
        return;
      }

      const next = toFields(data.account as Account);
      setFields(next);
      setSaved(next);
      // Account name feeds the sidebar/header — refresh the shared
      // context so it updates without a full reload.
      await refreshProfile();
      toast.success(t('saveSuccess'));
    } catch (err) {
      console.error('[OrganizationSettings] save error:', err);
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const readOnly = !canEditSettings;

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <CardContent className="space-y-6">
            {readOnly && (
              <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                {t('adminOnlyHint')}
              </p>
            )}

            {/* Business name */}
            <div className="space-y-2">
              <Label htmlFor="org-name" className="text-foreground">
                {t('businessName')}
              </Label>
              <Input
                id="org-name"
                value={fields.name ?? ''}
                onChange={(e) => setField('name', e.target.value)}
                maxLength={MAX_NAME_LEN}
                disabled={readOnly || saving}
                required
              />
            </div>

            {/* Business type */}
            <div className="space-y-2">
              <Label htmlFor="org-business-type" className="text-foreground">
                {t('businessType')}
              </Label>
              <Input
                id="org-business-type"
                value={fields.business_type ?? ''}
                onChange={(e) => setField('business_type', e.target.value)}
                placeholder={t('businessTypePlaceholder')}
                disabled={readOnly || saving}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Country */}
              <div className="space-y-2">
                <Label className="text-foreground">{t('country')}</Label>
                <Select
                  value={fields.country_code || UNSET}
                  onValueChange={(v) =>
                    setField('country_code', v === UNSET ? '' : v)
                  }
                  disabled={readOnly || saving}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('selectPlaceholder')}>
                      {(value: string) =>
                        value === UNSET
                          ? t('selectPlaceholder')
                          : (COUNTRIES.find((c) => c.code === value)?.label ??
                            value)
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>
                      {t('selectPlaceholder')}
                    </SelectItem>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Language */}
              <div className="space-y-2">
                <Label className="text-foreground">{t('language')}</Label>
                <Select
                  value={fields.language_code || UNSET}
                  onValueChange={(v) =>
                    setField('language_code', v === UNSET ? '' : v)
                  }
                  disabled={readOnly || saving}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('selectPlaceholder')}>
                      {(value: string) =>
                        value === UNSET
                          ? t('selectPlaceholder')
                          : (LANGUAGES.find((l) => l.code === value)?.label ??
                            value)
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>
                      {t('selectPlaceholder')}
                    </SelectItem>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Timezone */}
            <div className="space-y-2">
              <Label className="text-foreground">{t('timezone')}</Label>
              <Select
                value={fields.timezone || UNSET}
                onValueChange={(v) =>
                  setField('timezone', v === UNSET ? '' : v)
                }
                disabled={readOnly || saving}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('selectPlaceholder')}>
                    {(value: string) =>
                      value === UNSET ? t('selectPlaceholder') : value
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={UNSET}>{t('selectPlaceholder')}</SelectItem>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Business email */}
            <div className="space-y-2">
              <Label htmlFor="org-email" className="text-foreground">
                {t('businessEmail')}
              </Label>
              <Input
                id="org-email"
                type="email"
                value={fields.business_email ?? ''}
                onChange={(e) => setField('business_email', e.target.value)}
                disabled={readOnly || saving}
              />
            </div>

            {/* Business phone */}
            <div className="space-y-2">
              <Label htmlFor="org-phone" className="text-foreground">
                {t('businessPhone')}
              </Label>
              <Input
                id="org-phone"
                type="tel"
                value={fields.business_phone ?? ''}
                onChange={(e) => setField('business_phone', e.target.value)}
                disabled={readOnly || saving}
              />
            </div>

            {/* Address */}
            <div className="space-y-2">
              <Label htmlFor="org-address" className="text-foreground">
                {t('address')}
              </Label>
              <Textarea
                id="org-address"
                value={fields.address ?? ''}
                onChange={(e) => setField('address', e.target.value)}
                rows={3}
                disabled={readOnly || saving}
              />
            </div>
          </CardContent>
        </Card>

        {!readOnly && (
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !dirty}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('saveChanges')
              )}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}
