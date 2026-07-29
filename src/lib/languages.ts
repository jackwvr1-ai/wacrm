/**
 * Languages — picker options for `accounts.language_code`
 * (038_account_business_fields.sql). Codes are ISO 639-1, optionally
 * with a BCP-47 region (e.g. "es-AR"), matching the DB's
 * `accounts_language_code_format` CHECK. Same curation approach as
 * CURRENCIES in ./currency.ts — extend this list to offer more.
 */

export interface LanguageOption {
  /** ISO 639-1, optionally with a region, e.g. "es-AR". */
  code: string;
  label: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: "es", label: "Spanish" },
  { code: "es-AR", label: "Spanish (Argentina)" },
  { code: "es-MX", label: "Spanish (Mexico)" },
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "en", label: "English" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "pt", label: "Portuguese" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
];
