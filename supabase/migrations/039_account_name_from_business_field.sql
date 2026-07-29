-- ============================================================
-- 039_account_name_from_business_field.sql
--
-- Fase 3.3 Bloque 2 (2a): el signup ahora pide un nombre de
-- negocio y lo manda en `raw_user_meta_data->>'business_name'`.
-- `accounts.name` debe salir de ahi en vez del nombre personal
-- del usuario — nadie quiere ver "Jack Rivera" donde deberia
-- decir el nombre de su empresa.
--
-- Problema: esa resolucion de nombre ya estaba duplicada en DOS
-- funciones SECURITY DEFINER:
--   - handle_new_user (017_account_sharing.sql:659-689)
--   - recover_orphaned_profile (037_recover_orphaned_profile.sql)
--     que replica a proposito el bootstrap de handle_new_user para
--     el caso en que este ultimo fallo a mitad de camino.
-- Ambas hacian el mismo
--   COALESCE(NULLIF(full_name, ''), email, 'My account')
-- de forma independiente. Agregar business_name en una sola
-- hubiera dejado un usuario recuperado por recover_orphaned_profile
-- con el nombre personal como cuenta, mientras que un usuario
-- bootstrapeado normalmente por handle_new_user tendria el nombre
-- de negocio — inconsistente segun por cual camino haya pasado.
--
-- Solucion: extraer la resolucion a una funcion SQL pura,
-- resolve_account_name(raw_user_meta_data, email), y que ambas
-- funciones la llamen. Un solo lugar para volver a tocar si el
-- criterio de nombre cambia de nuevo.
--
-- Prioridad del nombre de cuenta (nueva):
--   1. raw_user_meta_data->>'business_name'  (nuevo)
--   2. raw_user_meta_data->>'full_name'       (comportamiento previo)
--   3. email
--   4. 'My account'
--
-- Nota: esto NO toca profiles.full_name. El nombre personal del
-- usuario se sigue guardando tal cual en ambas funciones — solo
-- cambia de donde sale accounts.name.
--
-- Idempotente: CREATE OR REPLACE en las tres funciones.
--
-- ROLLBACK
--   -- Revertir handle_new_user y recover_orphaned_profile a la
--   -- version de 017 / 037 (CREATE OR REPLACE con el COALESCE
--   -- inline original), despues:
--   DROP FUNCTION IF EXISTS public.resolve_account_name(JSONB, TEXT);
-- ============================================================

-- ------------------------------------------------------------
-- Helper compartido
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_account_name(
  p_raw_user_meta_data JSONB,
  p_email TEXT
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(p_raw_user_meta_data->>'business_name', ''),
    NULLIF(p_raw_user_meta_data->>'full_name', ''),
    p_email,
    'My account'
  );
$$;

ALTER FUNCTION public.resolve_account_name(JSONB, TEXT) OWNER TO postgres;

-- ------------------------------------------------------------
-- handle_new_user (017): mismo cuerpo, el INSERT INTO accounts
-- ahora usa el helper en vez del COALESCE inline. v_full_name se
-- sigue calculando y usando igual para profiles.full_name.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (public.resolve_account_name(NEW.raw_user_meta_data, NEW.email), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- ------------------------------------------------------------
-- recover_orphaned_profile (037): mismo cuerpo, agrega
-- raw_user_meta_data al SELECT existente y usa el helper para el
-- INSERT INTO accounts.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recover_orphaned_profile()
RETURNS UUID  -- the caller's account_id (existing or freshly created)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_email TEXT;
  v_full_name TEXT;
  v_raw_user_meta_data JSONB;
  v_account_id UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

  SELECT account_id INTO v_account_id
  FROM public.profiles
  WHERE user_id = v_caller_id;

  IF FOUND THEN
    RETURN v_account_id;
  END IF;

  SELECT email, COALESCE(raw_user_meta_data->>'full_name', ''), raw_user_meta_data
  INTO v_email, v_full_name, v_raw_user_meta_data
  FROM auth.users
  WHERE id = v_caller_id;

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (public.resolve_account_name(v_raw_user_meta_data, v_email), v_caller_id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (v_caller_id, v_full_name, v_email, v_account_id, 'owner');

  RETURN v_account_id;
END;
$$;

ALTER FUNCTION public.recover_orphaned_profile() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.recover_orphaned_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recover_orphaned_profile() TO authenticated;
