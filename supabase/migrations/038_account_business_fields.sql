-- ============================================================
-- 038_account_business_fields.sql
--
-- Fase 3.3 necesita guardar mas datos del negocio en `accounts`
-- (hoy solo tiene id, name, owner_user_id, default_currency — ver
-- 017_account_sharing.sql y 021_account_default_currency.sql).
-- Este bloque SOLO agrega columnas; no toca RLS ni codigo de
-- aplicacion (PATCH /api/account queda sin cambios a proposito).
--
-- Columnas agregadas (todas NULLABLE, sin DEFAULT — hay cuentas
-- existentes en produccion y esta migracion no puede romperlas):
--
--   business_type   TEXT  — tipo de negocio, texto libre. No hay un
--                    enum universal razonable (a diferencia de
--                    moneda/pais/idioma); wacrm es self-hostable y
--                    cada fork puede necesitar categorias distintas.
--                    Mismo criterio que 021 aplico a default_currency.
--   country_code    CHAR(2) — ISO 3166-1 alpha-2. CHECK solo valida
--                    la FORMA (2 letras mayusculas), no pertenencia
--                    a un catalogo (no existe una tabla de paises en
--                    el schema).
--   timezone        TEXT — sin CHECK. Postgres no tiene forma de
--                    validar esto en un CHECK constraint
--                    (pg_timezone_names() es una funcion de catalogo,
--                    no una tabla; los CHECK no admiten subqueries).
--                    Se valida en la capa de aplicacion contra
--                    Intl.supportedValuesOf('timeZone'), que es la
--                    misma fuente IANA que Postgres usa internamente.
--   language_code   TEXT — ISO 639-1 (2 letras) + region BCP-47
--                    opcional (ej. "es-AR"), formato consumido por
--                    Intl/next-intl. CHECK de forma via regex.
--   logo_url        TEXT — sin CHECK. Mismo patron exacto que
--                    profiles.avatar_url (001_initial_schema.sql):
--                    URL publica de Storage, sin validacion de
--                    formato a nivel DB. No se crea bucket nuevo en
--                    este bloque (fuera de alcance).
--   business_email  TEXT — CHECK laxo de forma (no RFC 5322
--                    completo), solo para atrapar errores de tipeo
--                    obvios. Distinto de profiles.email: este es el
--                    email del negocio, no el de ningun usuario.
--   business_phone  TEXT — sin CHECK. Los telefonos de negocio
--                    vienen en formatos muy variados por pais; el
--                    numero operacional de WhatsApp ya vive en
--                    whatsapp_config, este es solo dato de
--                    contacto/display.
--   address         TEXT — direccion libre (una o varias lineas).
--                    No se normaliza en columnas separadas
--                    (calle/ciudad/CP): seria sobre-ingenieria para
--                    lo que pide este bloque.
--
-- Nota sobre CHECK + NULL: en Postgres un CHECK se satisface si la
-- expresion evalua a TRUE o a NULL, asi que las columnas nullable
-- con CHECK de regex no requieren un "IS NULL OR ..." explicito —
-- una columna NULL siempre pasa el CHECK. Mismo estilo que
-- accounts_default_currency_format (021).
--
-- RLS: no hace falta ningun cambio. accounts_update (017) ya
-- restringe la escritura a admins+, que es exactamente quien deberia
-- poder cambiar estos datos del negocio.
--
-- NO aplicada a ninguna base por esta migracion — se valida en
-- staging (wacrm-staging, ref zkrjdsqkfokzoifslfve) primero.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + DROP CONSTRAINT IF EXISTS
-- antes de cada ADD CONSTRAINT.
--
-- ROLLBACK
--   ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_country_code_format;
--   ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_language_code_format;
--   ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_business_email_format;
--   ALTER TABLE accounts
--     DROP COLUMN IF EXISTS business_type,
--     DROP COLUMN IF EXISTS country_code,
--     DROP COLUMN IF EXISTS timezone,
--     DROP COLUMN IF EXISTS language_code,
--     DROP COLUMN IF EXISTS logo_url,
--     DROP COLUMN IF EXISTS business_email,
--     DROP COLUMN IF EXISTS business_phone,
--     DROP COLUMN IF EXISTS address;
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS business_type   TEXT,
  ADD COLUMN IF NOT EXISTS country_code    CHAR(2),
  ADD COLUMN IF NOT EXISTS timezone        TEXT,
  ADD COLUMN IF NOT EXISTS language_code   TEXT,
  ADD COLUMN IF NOT EXISTS logo_url        TEXT,
  ADD COLUMN IF NOT EXISTS business_email  TEXT,
  ADD COLUMN IF NOT EXISTS business_phone  TEXT,
  ADD COLUMN IF NOT EXISTS address         TEXT;

-- country_code: ISO 3166-1 alpha-2, forma solamente (2 letras
-- mayusculas). No valida contra un catalogo de paises real.
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_country_code_format;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_country_code_format
  CHECK (country_code ~ '^[A-Z]{2}$');

-- language_code: ISO 639-1 con region BCP-47 opcional ("es", "es-AR").
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_language_code_format;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_language_code_format
  CHECK (language_code ~ '^[a-z]{2}(-[A-Z]{2})?$');

-- business_email: validacion laxa de forma, no RFC 5322 completo.
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_business_email_format;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_business_email_format
  CHECK (business_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
