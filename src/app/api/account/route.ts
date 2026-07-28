// ============================================================
// /api/account
//
//   GET   — current caller's account + role. Any member.
//   PATCH — update account name + business profile fields. Admin+.
//
// Why both verbs share a route file
//   They speak about the same singular resource (the caller's
//   account) and reuse the same `requireRole` plumbing. Splitting
//   them across files would duplicate the `account_id` lookup
//   without buying anything.
// ============================================================

import { NextResponse } from "next/server";

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// IANA zone names Node's ICU build knows about — the same source
// Postgres uses internally, but unlike a DB CHECK constraint this can
// actually call it. Built once at module load, not per request.
const SUPPORTED_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      account: ctx.account,
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 80;

interface PatchAccountBody {
  name?: unknown;
  business_type?: unknown;
  country_code?: unknown;
  timezone?: unknown;
  language_code?: unknown;
  logo_url?: unknown;
  business_email?: unknown;
  business_phone?: unknown;
  address?: unknown;
}

// Optional free-text business fields (038_account_business_fields.sql).
// `validate` mirrors the DB's own CHECK constraint so a malformed value
// comes back as a clean 400 instead of a raw Postgres error — except
// `timezone`, which has no DB CHECK at all (Postgres can't call
// `pg_timezone_names()` from one) and is validated here only.
const OPTIONAL_TEXT_FIELDS: Array<{
  key: keyof Omit<PatchAccountBody, "name">;
  validate?: (trimmed: string) => string | null;
}> = [
  { key: "business_type" },
  {
    key: "country_code",
    validate: (v) =>
      /^[A-Z]{2}$/.test(v)
        ? null
        : "'country_code' must be a 2-letter uppercase ISO 3166-1 code (e.g. 'AR')",
  },
  {
    key: "timezone",
    validate: (v) =>
      SUPPORTED_TIMEZONES.has(v)
        ? null
        : "'timezone' is not a recognized IANA timezone",
  },
  {
    key: "language_code",
    validate: (v) =>
      /^[a-z]{2}(-[A-Z]{2})?$/.test(v)
        ? null
        : "'language_code' must be an ISO 639-1 code, optionally with a region (e.g. 'es' or 'es-AR')",
  },
  { key: "logo_url" },
  {
    key: "business_email",
    validate: (v) =>
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
        ? null
        : "'business_email' is not a valid email address",
  },
  { key: "business_phone" },
  { key: "address" },
];

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    // Per-user limit on admin-class mutations. Bounds accidental
    // abuse (script run in a loop) and a compromised admin session
    // spamming renames. Each admin endpoint keys its own bucket so
    // one route doesn't starve another.
    const limit = checkRateLimit(
      `admin:rename:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | PatchAccountBody
      | null;

    const updatePayload: Record<string, string | null> = {};

    if (body?.name !== undefined) {
      const rawName = body.name;
      if (typeof rawName !== "string") {
        return NextResponse.json(
          { error: "'name' must be a string" },
          { status: 400 },
        );
      }
      const name = rawName.trim();
      if (name.length === 0) {
        return NextResponse.json(
          { error: "Account name cannot be empty" },
          { status: 400 },
        );
      }
      if (name.length > MAX_NAME_LEN) {
        return NextResponse.json(
          {
            error: `Account name must be ${MAX_NAME_LEN} characters or fewer`,
          },
          { status: 400 },
        );
      }
      updatePayload.name = name;
    }

    for (const field of OPTIONAL_TEXT_FIELDS) {
      const raw = body?.[field.key];
      if (raw === undefined) continue;

      if (raw !== null && typeof raw !== "string") {
        return NextResponse.json(
          { error: `'${field.key}' must be a string or null` },
          { status: 400 },
        );
      }

      const trimmed = raw === null ? null : raw.trim();
      const value = trimmed === "" ? null : trimmed;

      if (value !== null && field.validate) {
        const validationError = field.validate(value);
        if (validationError) {
          return NextResponse.json(
            { error: validationError },
            { status: 400 },
          );
        }
      }

      updatePayload[field.key] = value;
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }

    // RLS allows this UPDATE because accounts_update requires
    // `is_account_member(id, 'admin')`, and requireRole already
    // guaranteed the caller is admin+.
    const { data, error } = await ctx.supabase
      .from("accounts")
      .update(updatePayload)
      .eq("id", ctx.accountId)
      .select(
        "id, name, business_type, country_code, timezone, language_code, logo_url, business_email, business_phone, address",
      )
      .single();

    if (error) {
      console.error("[PATCH /api/account] update error:", error);
      return NextResponse.json(
        { error: "Failed to update account" },
        { status: 500 },
      );
    }

    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
