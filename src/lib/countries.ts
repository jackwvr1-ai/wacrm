/**
 * Countries — picker options for `accounts.country_code`
 * (038_account_business_fields.sql). Not an exhaustive ISO 3166-1
 * catalog (the DB doesn't have one either — the CHECK constraint only
 * validates the 2-letter uppercase *shape*, not membership in a real
 * list). Same curation approach as CURRENCIES in ./currency.ts: extend
 * this list to offer more, nothing else needs to change.
 */

export interface CountryOption {
  /** ISO 3166-1 alpha-2, uppercase — stored verbatim in the DB. */
  code: string;
  label: string;
}

export const COUNTRIES: CountryOption[] = [
  { code: "AR", label: "Argentina" },
  { code: "BO", label: "Bolivia" },
  { code: "BR", label: "Brazil" },
  { code: "CA", label: "Canada" },
  { code: "CL", label: "Chile" },
  { code: "CO", label: "Colombia" },
  { code: "CR", label: "Costa Rica" },
  { code: "DO", label: "Dominican Republic" },
  { code: "EC", label: "Ecuador" },
  { code: "SV", label: "El Salvador" },
  { code: "ES", label: "Spain" },
  { code: "GT", label: "Guatemala" },
  { code: "HN", label: "Honduras" },
  { code: "MX", label: "Mexico" },
  { code: "NI", label: "Nicaragua" },
  { code: "PA", label: "Panama" },
  { code: "PY", label: "Paraguay" },
  { code: "PE", label: "Peru" },
  { code: "PR", label: "Puerto Rico" },
  { code: "UY", label: "Uruguay" },
  { code: "US", label: "United States" },
  { code: "VE", label: "Venezuela" },
  { code: "GB", label: "United Kingdom" },
  { code: "PT", label: "Portugal" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "IT", label: "Italy" },
  { code: "IN", label: "India" },
  { code: "AU", label: "Australia" },
  { code: "ZA", label: "South Africa" },
];
