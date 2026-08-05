-- ============================================================
-- 040_signup_minimo_resolve_account_name.sql
--
-- Fase 3.4c: el signup deja de pedir "Business name". La cuenta
-- nace con el nombre provisional 'My account' y el Paso 1 del
-- wizard (/setup, Fase 3.4a/3.4b) lo reemplaza por el real vía
-- PATCH /api/account. isBusinessConfigured ya trata 'My account'
-- como "no configurado" (wizard-plan.ts), así que no hace falta
-- tocar nada de ese lado.
--
-- Esto REVIERTE deliberadamente una parte de 039
-- (039_account_name_from_business_field.sql): con el campo de
-- negocio fuera del signup, dejar que el nombre de CUENTA caiga en
-- full_name o email volvería a mostrar el nombre personal del
-- usuario donde debería decir el nombre de su negocio (el problema
-- original que motivó la 039) — solo que ahora, sin business_name
-- en el signup, ESE sería el camino que se tomaría casi siempre.
-- Mejor no resolver nunca el nombre de cuenta contra datos
-- personales: cae directo al fallback provisional, que el wizard
-- se encarga de reemplazar.
--
-- Prioridad del nombre de cuenta (nueva, reemplaza a la de 039):
--   1. raw_user_meta_data->>'business_name'  (sigue existiendo por
--      si una invitación u otro camino futuro lo trae — el signup
--      mínimo ya no lo envía, pero la función no debe asumir quién
--      la llama)
--   2. 'My account'                           (fallback provisional)
--
-- NO se toca profiles.full_name / handle_new_user's v_full_name: el
-- nombre personal del perfil se sigue calculando y guardando exactamente
-- igual que antes. Esta migración solo cambia de dónde sale accounts.name.
--
-- La firma de resolve_account_name(JSONB, TEXT) y su OWNER se dejan
-- intactos a propósito, para no tocar el trigger handle_new_user ni
-- recover_orphaned_profile (037) que la invocan posicionalmente.
-- p_email queda sin usar en el cuerpo — se documenta acá en vez de
-- cambiar la firma, para minimizar el blast radius de este cambio.
--
-- Idempotente: CREATE OR REPLACE.
--
-- ROLLBACK
--   -- Revertir resolve_account_name a la versión de 039 (con
--   -- NULLIF(full_name,'') y p_email en la cadena de COALESCE):
--   CREATE OR REPLACE FUNCTION public.resolve_account_name(
--     p_raw_user_meta_data JSONB,
--     p_email TEXT
--   ) RETURNS TEXT
--   LANGUAGE sql
--   IMMUTABLE
--   AS $$
--     SELECT COALESCE(
--       NULLIF(p_raw_user_meta_data->>'business_name', ''),
--       NULLIF(p_raw_user_meta_data->>'full_name', ''),
--       p_email,
--       'My account'
--     );
--   $$;
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_account_name(
  p_raw_user_meta_data JSONB,
  p_email TEXT  -- unused: ver nota arriba, firma intacta a propósito
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(p_raw_user_meta_data->>'business_name', ''),
    'My account'
  );
$$;

ALTER FUNCTION public.resolve_account_name(JSONB, TEXT) OWNER TO postgres;
