-- ============================================================
-- staging-036-validation.sql — datos mínimos para validar
--                               manualmente la migración 036
--                               (conversations_update WITH CHECK)
--
-- NO es una migración del producto. No se aplica con
-- `supabase migration up` ni entra en el historial de
-- `supabase_migrations`. Es un script de una sola vez para
-- correr a mano contra wacrm-staging (ref zkrjdsqkfokzoifslfve)
-- vía el SQL Editor / `psql`, DESPUÉS de que las 36 migraciones
-- ya estén aplicadas y ANTES de correr staging-036-queries.sql.
--
-- Producción es otro proyecto y este script nunca la toca.
--
-- Idempotente: el bloque de limpieza al inicio borra cualquier
-- rastro de una corrida anterior (identificado por los UUIDs
-- fijos de abajo) antes de volver a crear todo. Se puede correr
-- las veces que haga falta.
--
-- Esquema verificado contra:
--   - supabase/migrations/001_initial_schema.sql
--       (profiles, contacts, conversations, trigger handle_new_user)
--   - supabase/migrations/017_account_sharing.sql
--       (accounts, profiles.account_id/account_role, account_id en
--        contacts/conversations, is_account_member, handle_new_user
--        v2, ON DELETE CASCADE accounts -> {contacts, conversations,
--        profiles})
--   - supabase/migrations/018_account_member_rpcs.sql
--       (remove_account_member — se invoca de verdad más abajo,
--        no se reimplementa su lógica a mano)
--
-- SUPUESTO A VALIDAR (no verificable sin acceso a la base):
--   El INSERT en auth.users usa el set de columnas que Supabase
--   documenta como patrón estándar para seeds locales (instance_id,
--   aud, role, encrypted_password, *_token en '' en vez de NULL,
--   etc.). Es el mismo patrón que usan los seed.sql de ejemplo de
--   Supabase. No pude confirmar contra el auth.users real de
--   wacrm-staging (no se ejecutó nada). Si tu proyecto corre una
--   versión de GoTrue con columnas NOT NULL adicionales sin default,
--   este INSERT fallará y hay que ajustarlo — avisame si pasa eso.
--   No se crean filas en auth.identities: estos usuarios seed no
--   necesitan poder loguearse, solo existir para las FKs y para que
--   dispare el trigger on_auth_user_created.
--
-- Qué crea (ver INSTRUCCIONES-seed-staging.md):
--   1. Cuenta A                              -> account_a
--   2. Cuenta B (ajena)                      -> account_b
--   3. Usuario 1, owner de A                 -> user_1
--   4. Usuario 2, agent de A ("compañero")   -> user_2
--   5. Usuario 3, member de B ("outsider")   -> user_3
--   6. Usuario 4: primero agent de A, luego  -> user_4
--      movido a una cuenta personal nueva vía
--      remove_account_member() de verdad (018) — simula el caso
--      real que deja assigned_agent_id huérfano.
--   7. Un contacto en A                      -> contact_1
--   8. Conversación 1 en A, sin asignar       -> conv_1
--   9. Conversación 2 en A, asignada a user_4 -> conv_2
--      (queda HUÉRFANA en el paso 10, después de remove_account_member)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- UUIDs fijos (para poder copiarlos en staging-036-queries.sql)
-- ------------------------------------------------------------
--   account_a  00000000-0000-0000-0000-00000000a001
--   account_b  00000000-0000-0000-0000-00000000b001
--   user_1     00000000-0000-0000-0000-000000000101  (owner de A)
--   user_2     00000000-0000-0000-0000-000000000102  (agent de A)
--   user_3     00000000-0000-0000-0000-000000000103  (owner de B, outsider)
--   user_4     00000000-0000-0000-0000-000000000104  (huérfano tras el paso 10)
--   contact_1  00000000-0000-0000-0000-000000000201
--   conv_1     00000000-0000-0000-0000-000000000301  (sin asignar)
--   conv_2     00000000-0000-0000-0000-000000000302  (huérfana tras el paso 10)
--
-- La cuenta personal nueva que remove_account_member() crea para
-- user_4 tiene id aleatorio (extensions.uuid_generate_v4() dentro
-- de la función) — se captura e imprime al final, no hace falta
-- fijarla porque las queries de validación no la referencian.

-- ------------------------------------------------------------
-- 0. LIMPIEZA — borra cualquier corrida anterior de este seed.
--    Borrar accounts (por id fijo o por owner_user_id de estos 4
--    usuarios) alcanza: contacts/conversations/profiles tienen
--    account_id REFERENCES accounts(id) ON DELETE CASCADE
--    (017_account_sharing.sql:176-190,120-122). El DELETE de
--    accounts también atrapa la cuenta personal aleatoria que
--    remove_account_member() haya creado para user_4 en una
--    corrida previa, porque solo puede existir una cuenta con
--    owner_user_id = user_4 a la vez (idx_accounts_one_per_owner).
-- ------------------------------------------------------------
DELETE FROM public.accounts
WHERE id IN (
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-00000000b001'
)
OR owner_user_id IN (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000104'
);

DELETE FROM auth.users
WHERE id IN (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000104'
);

DROP TABLE IF EXISTS seed_ids;
CREATE TEMP TABLE seed_ids (label TEXT PRIMARY KEY, id UUID NOT NULL);

-- ------------------------------------------------------------
-- 1. auth.users — dispara handle_new_user (017_account_sharing.sql:659-689),
--    que crea automáticamente UNA cuenta personal + un profile
--    'owner' por cada usuario. Esas cuentas personales se
--    reemplazan en los pasos 2-4 de abajo por Cuenta A / Cuenta B.
-- ------------------------------------------------------------
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000101',
   'authenticated', 'authenticated',
   'owner.a@seed.wacrm.test', crypt('seed-staging-036', gen_salt('bf')),
   NOW(), '{"provider":"email","providers":["email"]}',
   '{"full_name":"Owner Cuenta A (seed 036)"}', NOW(), NOW(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000102',
   'authenticated', 'authenticated',
   'agent.a@seed.wacrm.test', crypt('seed-staging-036', gen_salt('bf')),
   NOW(), '{"provider":"email","providers":["email"]}',
   '{"full_name":"Agent Cuenta A (seed 036)"}', NOW(), NOW(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000103',
   'authenticated', 'authenticated',
   'outsider.b@seed.wacrm.test', crypt('seed-staging-036', gen_salt('bf')),
   NOW(), '{"provider":"email","providers":["email"]}',
   '{"full_name":"Owner Cuenta B / Outsider (seed 036)"}', NOW(), NOW(),
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000104',
   'authenticated', 'authenticated',
   'orphan.a@seed.wacrm.test', crypt('seed-staging-036', gen_salt('bf')),
   NOW(), '{"provider":"email","providers":["email"]}',
   '{"full_name":"Orphan Ex-Miembro A (seed 036)"}', NOW(), NOW(),
   '', '', '', '');

-- ------------------------------------------------------------
-- 2. Cuenta A, owner = user_1.
--    El trigger del paso 1 ya le creó a user_1 una cuenta personal
--    propia (idx_accounts_one_per_owner es UNIQUE(owner_user_id), así
--    que no se puede insertar una segunda cuenta con owner_user_id =
--    user_1 mientras esa siga viva). Se borra esa cuenta trigger-made
--    primero — el CASCADE de accounts->profiles se lleva puesto el
--    profile que el trigger le creó — y se inserta Cuenta A + su
--    profile a mano con los ids fijos.
-- ------------------------------------------------------------
DELETE FROM public.accounts WHERE owner_user_id = '00000000-0000-0000-0000-000000000101';

INSERT INTO public.accounts (id, name, owner_user_id)
VALUES ('00000000-0000-0000-0000-00000000a001', 'Cuenta A (seed 036)', '00000000-0000-0000-0000-000000000101');

INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  'Owner Cuenta A (seed 036)', 'owner.a@seed.wacrm.test',
  '00000000-0000-0000-0000-00000000a001', 'owner'
);

INSERT INTO seed_ids VALUES ('account_a', '00000000-0000-0000-0000-00000000a001');
INSERT INTO seed_ids VALUES ('user_1_owner_a', '00000000-0000-0000-0000-000000000101');

-- ------------------------------------------------------------
-- 3. Cuenta B, owner = user_3 (mismo patrón que el paso 2).
-- ------------------------------------------------------------
DELETE FROM public.accounts WHERE owner_user_id = '00000000-0000-0000-0000-000000000103';

INSERT INTO public.accounts (id, name, owner_user_id)
VALUES ('00000000-0000-0000-0000-00000000b001', 'Cuenta B (seed 036)', '00000000-0000-0000-0000-000000000103');

INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
VALUES (
  '00000000-0000-0000-0000-000000000103',
  'Owner Cuenta B / Outsider (seed 036)', 'outsider.b@seed.wacrm.test',
  '00000000-0000-0000-0000-00000000b001', 'owner'
);

INSERT INTO seed_ids VALUES ('account_b', '00000000-0000-0000-0000-00000000b001');
INSERT INTO seed_ids VALUES ('user_3_owner_b_outsider', '00000000-0000-0000-0000-000000000103');

-- ------------------------------------------------------------
-- 4. user_2 -> agent de Cuenta A.
--    Acá el profile ya existe (lo creó el trigger del paso 1)
--    así que se reubica con UPDATE y recién después se borra la
--    cuenta personal que le quedó huérfana — en ese orden, para
--    que el CASCADE de accounts->profiles no se lleve puesto el
--    profile que acabamos de reubicar.
-- ------------------------------------------------------------
UPDATE public.profiles
SET account_id = '00000000-0000-0000-0000-00000000a001', account_role = 'agent'
WHERE user_id = '00000000-0000-0000-0000-000000000102';

DELETE FROM public.accounts WHERE owner_user_id = '00000000-0000-0000-0000-000000000102';

INSERT INTO seed_ids VALUES ('user_2_agent_a', '00000000-0000-0000-0000-000000000102');

-- ------------------------------------------------------------
-- 5. user_4 -> agent de Cuenta A (todavía miembro legítimo en
--    este punto; se lo saca de la cuenta en el paso 8).
-- ------------------------------------------------------------
UPDATE public.profiles
SET account_id = '00000000-0000-0000-0000-00000000a001', account_role = 'agent'
WHERE user_id = '00000000-0000-0000-0000-000000000104';

DELETE FROM public.accounts WHERE owner_user_id = '00000000-0000-0000-0000-000000000104';

INSERT INTO seed_ids VALUES ('user_4_ex_member_a', '00000000-0000-0000-0000-000000000104');

-- ------------------------------------------------------------
-- 6. Contacto en Cuenta A (contacts: user_id, phone NOT NULL;
--    account_id NOT NULL desde 017_account_sharing.sql:176,276).
-- ------------------------------------------------------------
INSERT INTO public.contacts (id, user_id, account_id, phone, name)
VALUES (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-00000000a001',
  '+10000000001', 'Contacto Seed A'
);

INSERT INTO seed_ids VALUES ('contact_1', '00000000-0000-0000-0000-000000000201');

-- ------------------------------------------------------------
-- 7. Conversación 1 en Cuenta A, SIN asignar
--    (conversations: user_id, contact_id NOT NULL; account_id
--    NOT NULL desde 017; assigned_agent_id nullable — 001_initial_schema.sql:140-151).
-- ------------------------------------------------------------
INSERT INTO public.conversations (id, user_id, contact_id, account_id, status, assigned_agent_id)
VALUES (
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-00000000a001',
  'open', NULL
);

INSERT INTO seed_ids VALUES ('conv_1_unassigned', '00000000-0000-0000-0000-000000000301');

-- ------------------------------------------------------------
-- 8. Conversación 2 en Cuenta A, asignada a user_4 MIENTRAS
--    todavía es miembro legítimo de A (paso 5). Se vuelve
--    huérfana recién en el paso 10.
-- ------------------------------------------------------------
INSERT INTO public.conversations (id, user_id, contact_id, account_id, status, assigned_agent_id)
VALUES (
  '00000000-0000-0000-0000-000000000302',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-00000000a001',
  'open', '00000000-0000-0000-0000-000000000104'
);

INSERT INTO seed_ids VALUES ('conv_2_orphan_target', '00000000-0000-0000-0000-000000000302');

-- ------------------------------------------------------------
-- 9. Impersonar a user_1 (owner de A, admin+) para invocar la
--    remove_account_member() REAL de 018_account_member_rpcs.sql
--    en vez de reimplementar su lógica a mano. request.jwt.claim.sub
--    es lo que auth.uid() lee (Supabase estándar); SET LOCAL ROLE
--    authenticated no es estrictamente necesario para esta función
--    puntual (es SECURITY DEFINER y no depende de RLS, solo de
--    auth.uid()) pero se deja para que la sesión quede en un estado
--    representativo de "logueado como user_1" mientras dura este
--    bloque.
--
--    remove_account_member(user_4) hace, tal cual 018:
--      - crea una cuenta personal nueva para user_4
--      - profiles.account_id / account_role de user_4 -> esa cuenta, 'owner'
--      - NO toca conversations.assigned_agent_id
--    -> conv_2 queda con assigned_agent_id = user_4 apuntando a
--       alguien que ya no es miembro de Cuenta A: la conversación
--       HUÉRFANA que pide el punto 9 de las instrucciones.
-- ------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
SET LOCAL ROLE authenticated;

INSERT INTO seed_ids (label, id)
SELECT 'user_4_new_personal_account_after_removal',
       public.remove_account_member('00000000-0000-0000-0000-000000000104');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

-- ------------------------------------------------------------
-- 10. Resumen — copiar estos UUIDs en staging-036-queries.sql
-- ------------------------------------------------------------
SELECT label, id FROM seed_ids ORDER BY label;

COMMIT;
