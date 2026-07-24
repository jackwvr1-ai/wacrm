-- ============================================================
-- staging-036-queries.sql — las 5 validaciones manuales del
--                            comentario final de
--                            supabase/migrations/036_conversations_update_with_check.sql
--                            (líneas 128-148), con los UUIDs
--                            fijos que crea staging-036-validation.sql.
--
-- Correr DESPUÉS de staging-036-validation.sql, contra
-- wacrm-staging (ref zkrjdsqkfokzoifslfve). Producción no se toca.
--
-- Cómo simular auth.uid() sin un JWT real (patrón estándar de
-- Supabase para probar RLS a mano desde el SQL Editor / psql):
--   SELECT set_config('request.jwt.claim.sub', '<uuid-del-usuario>', true);
--   SET LOCAL ROLE authenticated;
-- IMPORTANTE: el rol tiene que ser `authenticated`, no `postgres`.
-- `postgres` es superusuario y tiene BYPASSRLS, así que corriendo
-- como postgres las 4 queries "tendrían éxito" pase lo que pase y
-- el query 2 (que DEBE fallar con 42501) daría un falso verde.
--
-- Cada escenario va en su propio BEGIN/ROLLBACK: confirma el
-- resultado (éxito o el código de error) y deshace el cambio, así
-- el archivo se puede correr entero de nuevo sin re-sembrar datos.
-- Excepción: el query 3 (unassign) se deja con COMMIT explicado
-- abajo porque si no, el query 4 quedaría corriendo sobre un
-- conv_1 ya modificado por un ROLLBACK — en la práctica no importa
-- porque el query 4 usa conv_2, pero se documenta la elección.
--
-- UUIDs (de staging-036-validation.sql):
--   account_a            00000000-0000-0000-0000-00000000a001
--   user_1 (owner A)     00000000-0000-0000-0000-000000000101
--   user_2 (agent A)     00000000-0000-0000-0000-000000000102
--   user_3 (owner B, outsider) 00000000-0000-0000-0000-000000000103
--   user_4 (huérfano, ex-miembro de A) 00000000-0000-0000-0000-000000000104
--   conv_1 (sin asignar) 00000000-0000-0000-0000-000000000301
--   conv_2 (huérfana, assigned_agent_id = user_4) 00000000-0000-0000-0000-000000000302
-- ============================================================


-- ============================================================
-- Query 1 — Asignar a un compañero de cuenta -> DEBE tener éxito.
--   Actor: user_1 (owner de A). Target: user_2 (agent de A, mismo
--   account_id). El WITH CHECK de 036 pasa por la rama
--     EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = assigned_agent_id
--             AND p.account_id = conversations.account_id)
--   porque user_2 sigue siendo miembro de account_a.
-- Resultado esperado: UPDATE 1 (éxito), sin error.
-- ============================================================
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
SET LOCAL ROLE authenticated;

UPDATE conversations
SET assigned_agent_id = '00000000-0000-0000-0000-000000000102'
WHERE id = '00000000-0000-0000-0000-000000000301';
-- Esperado: UPDATE 1

RESET ROLE;
ROLLBACK; -- deja conv_1 sin asignar para el resto de las corridas


-- ============================================================
-- Query 2 — Asignar a alguien fuera de la cuenta -> DEBE fallar.
--   Actor: user_1 (owner de A). Target: user_3 (owner de B, NO es
--   miembro de account_a). Ninguna rama del WITH CHECK se cumple:
--   no es NULL, no es igual al assigned_agent_id anterior (NULL),
--   y no hay profile de user_3 en account_a.
-- Resultado esperado: ERROR 42501 "new row violates row-level
-- security policy for table conversations" (o mensaje equivalente
-- de Postgres para WITH CHECK).
-- ============================================================
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
SET LOCAL ROLE authenticated;

UPDATE conversations
SET assigned_agent_id = '00000000-0000-0000-0000-000000000103'
WHERE id = '00000000-0000-0000-0000-000000000301';
-- Esperado: ERROR 42501

RESET ROLE;
ROLLBACK;


-- ============================================================
-- Query 3 — Desasignar (assigned_agent_id = NULL) -> DEBE tener éxito.
--   Actor: user_1. La rama `assigned_agent_id IS NULL` del WITH
--   CHECK cubre este caso directamente.
-- Resultado esperado: UPDATE 1 (éxito), sin error.
-- ============================================================
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
SET LOCAL ROLE authenticated;

UPDATE conversations
SET assigned_agent_id = NULL
WHERE id = '00000000-0000-0000-0000-000000000301';
-- Esperado: UPDATE 1

RESET ROLE;
ROLLBACK; -- ver nota de cabecera: no afecta al query 4, que usa conv_2


-- ============================================================
-- Query 4 — Update no relacionado sobre una conversación YA
-- huérfana (conv_2: assigned_agent_id = user_4, que
-- remove_account_member() sacó de account_a en el seed) sin tocar
-- assigned_agent_id -> DEBE tener éxito.
--   La rama
--     assigned_agent_id IS NOT DISTINCT FROM (SELECT c.assigned_agent_id
--       FROM conversations c WHERE c.id = conversations.id)
--   cubre este caso: como el UPDATE no cambia assigned_agent_id, el
--   valor nuevo siempre coincide con el viejo (huérfano o no), y el
--   WITH CHECK no vuelve a validar membership.
-- Resultado esperado: UPDATE 1 (éxito), sin error.
-- ============================================================
BEGIN;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
SET LOCAL ROLE authenticated;

UPDATE conversations
SET unread_count = 0
WHERE id = '00000000-0000-0000-0000-000000000302';
-- Esperado: UPDATE 1

RESET ROLE;
ROLLBACK;


-- ============================================================
-- Query 5 — Escrituras vía service_role (webhook, automations,
-- flows, ai/auto-reply) -> no se ven afectadas, siguen bypaseando
-- RLS por completo.
--
-- Esto NO es verificable con una query SQL corrida como postgres:
-- postgres ya bypasea RLS igual que service_role, así que un
-- UPDATE acá "funcionaría" sin decir nada sobre si la policy en sí
-- está bien. La verificación real de este punto es de código, no
-- de datos — confirmar que las llamadas listadas en el comentario
-- de 036 (automations/engine.ts, flows/engine.ts, ai/auto-reply.ts,
-- automations/meta-send.ts, flows/meta-send.ts,
-- whatsapp/send-message.ts, whatsapp/webhook/route.ts) usan el
-- cliente con la service role key, no el cliente RLS-scoped del
-- browser. No hay query para correr acá.
-- ============================================================
