> **Registro de auditoría — Fase 3.0B.** Este documento registra el estado **verificado por evidencia de código** en el commit indicado. La existencia de un componente o una tabla **no prueba** que el flujo completo funcione. No es una descripción narrativa: cada afirmación cita archivo, función, líneas, migración o prueba concreta. Donde no hay evidencia, el estado se marca `DESCONOCIDO — REQUIERE PRUEBA`.
>
> Este documento **no propone correcciones** fuera de la sección final "Recomendaciones para Fase 3.1". Durante la auditoría, cada hallazgo se registra y el barrido continúa — ningún problema encontrado detiene ni desvía la cobertura.

```
Repositorio:          github.com/jackwvr1-ai/wacrm
Commit inspeccionado: 984f1cbe2bdb4e0c35c17002f5d95c43aa994bb6
Fecha:                2026-07-23
Gestor de paquetes:   npm (package-lock.json)
Tests ejecutados:     sí — `npm test` (vitest run): 63 archivos, 628 tests, 628 passed, 0 failed
Tiempo de auditoría:  ~1 sesión de lectura de código intensiva (una pasada; ver Limitaciones §5 sobre profundidad desigual entre piezas)
```

---

## Índice

1. Auditoría de capacidades (fichas por sección)
2. Rutas y librerías service-role (ficha por ruta, sin excepción)
3. Deuda técnica encontrada
4. Recomendaciones para Fase 3.1
5. Limitaciones de la auditoría

---

## 1. Auditoría de capacidades

### 1.1 Autenticación (registro, login, sesión)

**Estado:** VERIFICADO Y OPERATIVO
**Confianza:** Media

**Evidencia:**
- `src/app/(auth)/signup/page.tsx` (líneas 71-90) — `supabase.auth.signUp()` client-side, con `emailRedirectTo` condicional a `/join/<token>` cuando hay invitación. **Actualización (2026-07-29, Fase 3.3).** Campo "nombre de negocio" obligatorio, enviado en `raw_user_meta_data.business_name` (línea 81: `...(inviteToken ? {} : { business_name: businessName })`) — pasa a ser el `accounts.name` vía `resolve_account_name` (039, ver ficha 1.2). El campo se **oculta** cuando hay `invite` token (línea 178, `!inviteToken &&`): un usuario invitado se suma a una cuenta existente vía `redeem_invitation`, que descarta cualquier dato de negocio del invitado — pedírselo sería confuso.
  **Actualización (2026-08-05, Fase 3.4c) — reversión deliberada de la decisión de arriba, confirmada por Jack.** El campo "Business name" agregado en Fase 3.3 (commit `5006250`, "campo de nombre de negocio en el registro") se **quita** del signup: el formulario ya no declara `businessName` ni lo envía en la metadata (`src/app/(auth)/signup/page.tsx`, ver `page.test.ts` — verifica por lectura de fuente, sin jsdom, que el campo no está). `full_name` **no se toca**, se sigue enviando igual que siempre. Nuevo modelo: signup mínimo (solo nombre personal + credenciales) → la cuenta nace con nombre provisional `'My account'` vía `resolve_account_name` (ver actualización en ficha 1.2, migración `040_signup_minimo_resolve_account_name.sql`) → el Paso 1 del wizard de `/setup` (Fase 3.4a/3.4b) la completa con el nombre real, escribiendo por el mismo `PATCH /api/account` de siempre. El estado "configurado" se sigue derivando de `isBusinessConfigured` (`wizard-plan.ts`) sin cambios — no se agregó columna ni flag nuevo. La razón del cambio: pedir el nombre de negocio en el signup era fricción antes de que el usuario viera valor alguno del producto; el wizard ya resuelve ese dato con mejor contexto.
- `src/app/(auth)/login/page.tsx` — `supabase.auth.signInWithPassword()`.
- `src/middleware.ts` (líneas 26, 51-86) — `supabase.auth.getUser()` en cada request; redirige `/login|/signup|/forgot-password` → `/dashboard` si ya hay sesión; redirige rutas protegidas (`/dashboard`, `/inbox`, `/contacts`, `/pipelines`, `/broadcasts`, `/automations`, `/settings`) → `/login` si no hay sesión; 401 explícito solo para `/api/whatsapp/*` (excepto `/webhook`).
- `supabase/migrations/001_initial_schema.sql` (líneas 375-402) y `017_account_sharing.sql` (líneas 656-689) — trigger `on_auth_user_created` → `handle_new_user()`, crea `profiles` (001) y luego `accounts` + `profiles` con rol `owner` (017, reemplaza la función de 001).
- `src/lib/auth/account.ts` (`getCurrentAccount`, líneas 106-173) — resuelve usuario → perfil → cuenta en cada llamada server-side; usado por casi todas las rutas no-service-role.

**Verificaciones realizadas:**
✓ Lectura de código de signup/login/logout — el flujo delega en Supabase Auth, no hay lógica de contraseña propia.
✓ El trigger `handle_new_user` crea cuenta+perfil atómicamente en la misma función (líneas 668-677 de 017).
✓ `npm test` — `src/middleware.test.ts` (63 archivos totales, todos en verde) ejercita las redirecciones de middleware con mocks de Supabase SSR.
✓ `is_account_member` y RLS de `profiles` revisadas — coherentes con el modelo de sesión.
✓ **RESUELTO (2026-07-25).** El hallazgo de usuario huérfano (ver Pendientes original abajo) tiene ahora recuperación: RPC `recover_orphaned_profile()` (`037_recover_orphaned_profile.sql`), `SECURITY DEFINER`, sin parámetros (opera solo sobre `auth.uid()`, no puede reparar a un tercero), `SET search_path = public`, `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated`, con `pg_advisory_xact_lock(hashtext(auth.uid()::text))` para serializar llamadas concurrentes del mismo usuario e idempotente (si al tomar el lock ya existe un profile, devuelve su `account_id` sin crear nada). Replica exactamente el bootstrap de `handle_new_user` (mismo `COALESCE(NULLIF(full_name,''), email, 'My account')`, mismo `account_role = 'owner'`). Invocada por `getCurrentAccount` (`src/lib/auth/account.ts`, líneas 133-148) en la rama donde no encuentra fila de `profiles`, antes de tirar `ForbiddenError` — único chokepoint, se invoca una sola vez y se reintenta el `SELECT`. Verificado con `tests/integration/auth/account-recovery.test.ts` contra `wacrm-staging`: reproduce el estado huérfano, se vio FALLAR (ForbiddenError) antes del fix y PASAR después. Aplicada en `wacrm-staging` y en producción (ref `cgwrlkrkesjzrxtuvcfh`), 2026-07-25, verificada con `SELECT proname, prosecdef FROM pg_proc WHERE proname = 'recover_orphaned_profile'` → `recover_orphaned_profile | true`.

**Pendientes:**
- ~~El `EXCEPTION WHEN OTHERS ... RAISE WARNING; RETURN NEW` del trigger (017, líneas 679-682) **traga cualquier error** al crear cuenta/perfil: si el `INSERT INTO accounts` o `profiles` falla, `auth.users` igual se crea, dejando un usuario autenticado **sin perfil ni cuenta**. `getCurrentAccount()` lo detecta después (`ForbiddenError("Profile is not linked to an account")`, línea 131) pero no hay evidencia de una ruta de recuperación automática para ese usuario huérfano — no se encontró código ni test que ejercite este camino de fallo.~~ — **RESUELTO (2026-07-25)** vía recuperación del lado de la aplicación (ver arriba). Decisión de diseño explícita: el trigger **no fue modificado** — `handle_new_user` y su `EXCEPTION WHEN OTHERS` siguen tragando el error exactamente igual que antes, porque es el piso de comportamiento sobre el que se construye la Fase 3.3; lo que cambió es que ahora existe una reparación posterior. **Fuera de alcance de este fix:** el caso distinto de un perfil existente con `account_id`/`account_role` nulos (escenario pre-migración) no fue tocado.
- No hay test de integración end-to-end (signup real → trigger → sesión); la cobertura de `npm test` es unitaria/mockeada. La recuperación del usuario huérfano sí tiene prueba de integración (ver arriba), pero ejercita el camino de reparación, no el signup original que produce el estado huérfano.
- 2FA / SSO no existen (consistente con lo previsto como "futuro" en `core-architecture.md` §2.2).

---

### 1.2 Organizaciones (crear, leer, actualizar, borrado restringido)

**Estado:** PARCIAL
**Confianza:** Media

**Evidencia:**
- Creación: no hay endpoint de creación directa — se crea implícitamente vía trigger `handle_new_user` (017, líneas 668-677) en cada signup, o vía `remove_account_member` (018, líneas 185-197) cuando un miembro es expulsado y recibe una cuenta personal nueva. **Actualización (2026-07-29, Fase 3.3).** El nombre con el que se crea la cuenta ya no sale de un `COALESCE` inline: `resolve_account_name(raw_user_meta_data, email)` (`039_account_name_from_business_field.sql`, líneas 51-64), `IMMUTABLE`, prioridad `business_name` → `full_name` → `email` → `'My account'`. Tanto `handle_new_user` (017, ahora `CREATE OR REPLACE`d por 039) como `recover_orphaned_profile` (037) llaman al mismo helper — antes cada una repetía su propio `COALESCE(NULLIF(full_name,''), email, 'My account')`, lo que hubiera dejado inconsistente el nombre de cuenta de un usuario recuperado por 037 frente a uno bootstrapeado normalmente el día que se agregara `business_name`. `profiles.full_name` no se toca — sigue siendo el nombre personal.
  **Actualización (2026-08-05, Fase 3.4c) — reversión deliberada, confirmada por Jack (ver también ficha 1.1).** Con "Business name" fuera del signup, dejar que `resolve_account_name` cayera en `full_name`/`email` como fallback habría significado que el nombre de cuenta *casi siempre* terminara siendo el nombre personal del usuario o su email — exactamente el problema que 039 había resuelto, solo que ahora por el camino inverso. `040_signup_minimo_resolve_account_name.sql` acorta la cadena: prioridad nueva `business_name` (si viene — p. ej. de una invitación futura, o compatibilidad) → `'My account'`, **sin** pasar por `full_name` ni `email`. La firma `resolve_account_name(JSONB, TEXT)` y el `OWNER TO postgres` quedan intactos a propósito (no se toca `handle_new_user` ni `recover_orphaned_profile`, que la invocan sin cambios); `p_email` queda como parámetro sin usar, documentado en la cabecera de la 040. `profiles.full_name` sigue sin tocarse.
- Lectura/actualización: `src/app/api/account/route.ts` — `GET` (líneas 32-42, cualquier miembro vía `getCurrentAccount`) y `PATCH` (líneas 101-205, admin+ vía `requireRole("admin")`). **Actualización (2026-07-29, Fase 3.3).** El PATCH ya no se limita a `name`: acepta también los 8 campos de negocio agregados por `038_account_business_fields.sql` (`business_type`, `country_code`, `timezone`, `language_code`, `logo_url`, `business_email`, `business_phone`, `address`), todos opcionales e independientes (líneas 46-56, 63-99, 147-172) — un PATCH puede tocar un solo campo. `name` pasó de obligatorio a opcional (línea 121: `if (body?.name !== undefined)`) para permitir estos updates parciales; sigue habiendo 400 si el body no trae ningún campo reconocido (línea 174-179). La validación TS espeja los 3 `CHECK` de la 038 (`country_code` línea 70-74, `language_code` línea 82-88, `business_email` línea 90-96) más `timezone` contra `Intl.supportedValuesOf('timeZone')` (línea 30, 76-81) — la única de las 8 columnas sin `CHECK` en la DB porque Postgres no puede invocar `pg_timezone_names()` desde una expresión de constraint. `requireRole("admin")` (línea 103) y el rate limit por admin (línea 109-113) quedaron intactos.
- Borrado: **no existe endpoint ni RPC de eliminación de cuenta.** `accounts.owner_user_id` tiene `ON DELETE RESTRICT` (017, línea 66) — a nivel de base de datos, un usuario dueño no puede borrarse de `auth.users` mientras su cuenta exista, pero eso no es lo mismo que un flujo de borrado de organización.
- `src/lib/auth/roles.ts` (líneas 100-102) define `canDeleteAccount` (solo owner) pero `grep` sobre `src/hooks/use-can.ts` y el resto del árbol confirma que **ningún componente lo invoca** (`useCan("delete-account")` no aparece en ningún `.tsx`).
- **Consumo de datos de cuenta en el dashboard (nuevo, 2026-07-29, Fase 3.3).** `src/components/dashboard/onboarding-checklist.tsx` — checklist descartable de hasta 3 ítems (preferencia de descarte en `localStorage`, clave por `accountId` + `userId`, líneas 17-21, 95-99). Dos de los tres ítems derivan su estado de datos reales: WhatsApp (existe fila en `whatsapp_config` para el `account_id`, líneas 59-63, 76-78) e Invitar equipo (`members.length > 1` vía `GET /api/account/members`, líneas 67-86, 143-156 — solo se agrega al array si `canManageMembers`). El ítem "Organización" (líneas 118-125) muestra `account?.name` en el subtítulo pero su `complete` está codificado a `true` (no condicionado a que el nombre exista o sea distinto del fallback `'My account'`) — en la práctica siempre se ve resuelto porque el signup ahora exige nombre de negocio, pero no es una derivación de datos en el mismo sentido que los otros dos ítems; se registra la distinción exacta en vez de asumir que los tres se comportan igual. Para no-admins, el ítem de WhatsApp se muestra sin CTA (subtítulo distinto vía `canEditSettings`, líneas 130-139) y el de invitar se oculta directamente (línea 143); `allDone` (línea 159, `items.every`) se calcula solo sobre los ítems presentes en el array, es decir, solo sobre los visibles para ese rol.
- **Decisión de producto registrada (2026-07-29, Fase 3.3).** No se construyó un wizard de onboarding de 4 pasos. El nombre de negocio ya se pide en el signup (ficha 1.1) y el resto de los campos vive en Settings (ficha 1.12) — un wizard sería un envoltorio lineal sobre piezas ya existentes; el checklist de arriba resuelve el mismo problema de descubribilidad sin bloquear al usuario. Se registra aquí por instrucción explícita de esta fase, no porque el código documente la decisión.
- **Actualización (2026-08-04, Fase 3.4a) — reversión deliberada de la decisión de arriba.** El wizard descartado en la línea anterior (Fase 3.3) se construyó en esta fase: ruta `/setup` (`src/app/setup/layout.tsx`, `setup-shell.tsx`, `page.tsx`) fuera del route group `(dashboard)` — deliberado, para no crear un bucle de redirect cuando Fase 3.4b agregue el redirect automático desde el layout del dashboard —, más `src/components/setup/setup-wizard.tsx` y `src/components/setup/wizard-plan.ts`. La reversión es intencional y confirmada por Jack; se deja trazada hasta esta nota exacta para que no se lea como una contradicción no registrada del documento.
  El wizard **no sustituye** al checklist de arriba: lo **complementa**. Reutiliza sin reescribir los mismos tres componentes que esta sección y la ficha 1.12 ya documentan — `organization-settings.tsx` (Paso 1), `whatsapp-config.tsx` (Paso 2), `invite-member-dialog.tsx` (Paso 3, condicional) — y lee las mismas fuentes de verdad que el checklist: `useAuth().account` (el mismo campo que `onboarding-checklist.tsx` línea 122 usa para el subtítulo), `whatsapp_config` por `account_id`, `GET /api/account/members` y los mismos permisos (`canManageMembers`, `canEditSettings`). No se agregó columna, tabla, endpoint ni estado de cuenta nuevo — el Paso 1 sigue escribiendo vía el mismo `PATCH /api/account` de esta ficha.
  Checklist y wizard quedan como **dos interfaces del mismo flujo de onboarding, no dos flujos separados**: el checklist informa qué falta (sin cambios en esta fase — incluida la inconsistencia de `complete: true` codificado que señala la Pendiente más abajo) y el wizard guía a completarlo paso a paso. Ambos deben mantenerse sincronizados y no duplicar reglas de gating. La única lógica nueva de "negocio configurado" vive en `wizard-plan.ts` (`isBusinessConfigured`, testeada en `wizard-plan.test.ts`) — es, de hecho, la derivación real que la Pendiente de esta ficha señala como ausente en el checklist (nombre presente y distinto del fallback genérico `'My account'` de `resolve_account_name`, 039). El checklist en sí no se tocó en 3.4a (fuera de alcance), así que esa Pendiente sigue abierta puntualmente para `onboarding-checklist.tsx`; el wizard no la hereda porque no reutiliza el `complete: true` del checklist, deriva el estado de forma independiente de la misma fuente de datos.

**Verificaciones realizadas:**
✓ Crear organización (indirecta, vía trigger) — código leído, lógica coherente. `resolve_account_name` verificado por lectura (039).
✓ Leer organización — `GET /api/account`, código leído.
✓ Actualizar organización — `PATCH /api/account`, código leído, RLS (`accounts_update`, requiere `is_account_member(id, 'admin')`) + chequeo de rol en TS coinciden.
✓ **Nuevo (2026-07-29).** El PATCH extendido tiene 9 tests unitarios (`src/app/api/account/route.test.ts`, vistos fallar 4/9 antes del fix y pasar después) más 7 tests de integración contra `wacrm-staging` (`tests/integration/accounts/business-fields.test.ts`) que confirman, contra Postgres real, que los 3 `CHECK` de la 038 rechazan valores mal formados, que las 8 columnas aceptan `NULL` (nullable, sin `DEFAULT`) y que `accounts_update` (017) sigue bloqueando a un agente no-admin. Ningún test reveló un bug.
✗ Eliminación — no implementada. La predicate `canDeleteAccount` es infraestructura muerta (definida y testeada en `roles.test.ts` línea 117-121, pero sin consumidor).
✗ **Checklist de onboarding — sin test automatizado.** Solo probado manualmente en local (ver también ficha 1.12). `find src -iname "*onboarding-checklist*test*"` no devuelve nada.

**Pendientes:**
- No hay prueba de extremo a extremo del trigger de creación contra una base real (solo lectura estática del SQL).
- La ausencia de borrado de cuenta puede ser una decisión de producto deliberada (evita huérfanos) o un hueco pendiente — el código no lo aclara; se registra como hallazgo, no se interpreta la intención.
- El ítem "Organización" usa `complete: true` codificado en vez de derivarse de `account.name`. No es un bug —el nombre siempre existe por diseño desde la 039— sino una inconsistencia frente a la premisa "los ítems derivan de datos reales". Severidad: baja.

---

### 1.3 Membresías (relación user↔organización, roles)

**Estado:** VERIFICADO Y OPERATIVO
**Confianza:** Alta — verificado por código Y prueba contra base real (antes: solo lectura estática).

**Evidencia:**
- Modelo: una fila `profiles` por usuario, con `account_id` + `account_role` (no hay tabla `memberships` separada — diseño "un usuario, una cuenta a la vez", documentado en `017_account_sharing.sql` línea 71-74).
- Listado: `src/app/api/account/members/route.ts` (`GET`, líneas 30-73) — cualquier miembro puede leer el roster; el email solo se expone si `canManageMembers(ctx.role)` (admin+).
- Cambio de rol: `src/app/api/account/members/[userId]/route.ts` `PATCH` (líneas 45-95) → RPC `set_member_role` (`018_account_member_rpcs.sql`, líneas 37-108): valida caller admin+, rechaza auto-cambio, rechaza que el objetivo no pertenezca a la misma cuenta (línea 89), rechaza asignar/quitar `owner` por esta vía.
- Expulsión: `DELETE` en el mismo archivo (líneas 97-122) → RPC `remove_account_member` (018, líneas 127-201): mismas validaciones + crea cuenta personal nueva para el expulsado (nunca se borra el usuario de `auth.users`).
- Transferencia de ownership: `src/app/api/account/transfer-ownership/route.ts` → RPC `transfer_account_ownership` (018, líneas 217-283): valida caller `owner`, objetivo en la misma cuenta, demota+promueve en una sola transacción.

**Verificaciones realizadas:**
✓ Lectura completa de las tres RPCs — las cuatro validaciones (identidad vía `auth.uid()`, membresía, "misma cuenta que el caller", rol suficiente) están presentes en las tres funciones.
✓ `npm test` pasa; `src/lib/auth/roles.test.ts` cubre las funciones puras de jerarquía de roles (unitario, sin tocar la DB).
✓ **RESUELTO (2026-07-25).** `tests/integration/rpc/account-member-rpcs.test.ts` (15 tests, contra `wacrm-staging`, ref `zkrjdsqkfokzoifslfve`) invoca las tres RPCs por ejecución real: caminos felices de `set_member_role`/`remove_account_member`/`transfer_account_ownership` para owner y admin, y todas las ramas de rechazo del SQL (caller no-admin, self-target, cross-account, promoción a owner, degradación de owner). Ningún test reveló un bug en las RPCs. Ver `npm run test:integration` (`vitest.config.integration.ts`), suite separada de los 634 tests unitarios.

**Pendientes:**
- El comportamiento concurrente (dos admins expulsando/transfiriendo al mismo tiempo) no está ejercitado por ningún test.
- No se verificó qué ocurre si `remove_account_member` se llama sobre un `userId` que no es UUID válido (el chequeo de forma vive en `transfer-ownership/route.ts` vía `looksLikeUuid`, pero `members/[userId]/route.ts` no aplica ese mismo guard antes de llamar al RPC — queda para que Postgres rechace el tipo).

---

### 1.4 Roles y permisos

**Estado:** VERIFICADO Y OPERATIVO
**Confianza:** Alta

**Evidencia:**
- `src/lib/auth/roles.ts` — jerarquía `owner(4) > admin(3) > agent(2) > viewer(1)`, siete predicados (`canManageMembers`, `canEditSettings`, `canSendMessages`, `canViewOnly`, `canDeleteAccount`, `canTransferOwnership`) todos derivados de `hasMinRole`.
- Mismo ranking replicado en SQL: `is_account_member(target_account_id, min_role)` (`017_account_sharing.sql`, líneas 136-164) usa el mismo `CASE` de pesos — el comentario en el código (línea 8-10 de `roles.ts`) documenta la intención de mantenerlos sincronizados a mano.
- Consumo en frontend: `src/hooks/use-can.ts` — hook con `switch` exhaustivo (chequeo de tipos en compilación vía `never`).
- Consumo en backend: cada ruta admin-only llama a `requireRole("admin")` u `("owner")` (verificado en `/api/account`, `/api/account/members*`, `/api/account/invitations*`, `/api/account/transfer-ownership`).

**Verificaciones realizadas:**
✓ `npm test` — `src/lib/auth/roles.test.ts` (130 líneas) cubre los seis predicados exhaustivamente para los cuatro roles.
✓ Confirmado que el ranking TS y el `CASE` SQL usan los mismos pesos (lectura cruzada de ambos archivos).
✓ Ningún caso encontrado donde una ruta admin-only omita `requireRole`.

**Pendientes:**
- La sincronización TS↔SQL de la jerarquía es **manual** (dos fuentes de verdad copiadas a mano) — no hay test que falle si divergen; un cambio en un archivo sin el otro no se detectaría hasta producción.
- No existe un rol adicional a los cuatro (no hay "super admin de plataforma" en este enum — ese concepto, según `phase-3-saas-instructions.md` §4, vive fuera del modelo `account_role_enum`, y no se encontró tabla o mecanismo de "Super Admin" implementado en este commit).

---

### 1.5 Invitaciones

**Estado:** VERIFICADO Y OPERATIVO
**Confianza:** Alta — verificado por código Y prueba contra base real (antes: solo lectura estática).

**Evidencia:**
- Creación/listado: `src/app/api/account/invitations/route.ts` — `POST` (admin+, rate-limited, token de 256 bits generado y solo el hash `SHA-256` persistido — `src/lib/auth/invitations.ts::generateInviteToken`) y `GET` (lista no expiradas/no aceptadas).
- Revocación: `src/app/api/account/invitations/[id]/route.ts` `DELETE` — se apoya en RLS (`account_invitations_modify`, admin+) en vez de filtrar `account_id` a mano; un intento cross-cuenta borra 0 filas → 404 (comentario explícito líneas 42-46 justificando por qué no se filtra a mano).
- Vista previa pública: `src/app/api/invitations/[token]/peek/route.ts` → RPC `peek_invitation` (`019_invitation_rpcs.sql`, líneas 43-89), anónima, rate-limited por IP.
- Canje: `src/app/api/invitations/[token]/redeem/route.ts` → RPC `redeem_invitation` (019, líneas 125-237): candado `FOR UPDATE` sobre la fila de invitación (evita doble canje concurrente), exige que el caller sea dueño único de su cuenta actual y que esa cuenta no tenga datos de dominio (11 tablas chequeadas explícitamente, líneas 194-207) antes de migrar el perfil y borrar la cuenta personal huérfana.

**Verificaciones realizadas:**
✓ Lectura completa de las dos RPCs — el candado de concurrencia y el chequeo "sin datos" están presentes y correctos por inspección.
✓ `npm test` — `src/lib/auth/invitations.test.ts` (144 líneas) cubre `generateInviteToken`, `hashInviteToken`, `clampExpiryDays`, `inviteExpiresAt`, `inviteUrl` (funciones puras).
✓ **RESUELTO (2026-07-25).** `tests/integration/rpc/invitation-rpcs.test.ts` (11 tests, contra `wacrm-staging`) invoca ambas RPCs por ejecución real: `peek_invitation` (ok / not_found / expired / used) y `redeem_invitation` (camino feliz con borrado de la cuenta personal vieja, token desconocido/expirado/reusado, caller ya en cuenta compartida, caller owner de su cuenta). Ningún test reveló un bug. Ver `npm run test:integration`.

**Pendientes:**
- Sin prueba automática del camino completo signup-con-invite → verificación de email → `/join/<token>` → redeem: la cobertura nueva ejercita las dos RPCs directamente, no el flujo de UI/email que las precede.
- La resolución de `getBaseUrl()` en `account/invitations/route.ts` (líneas 79-135) confía en cabeceras `X-Forwarded-Host`/`Host` cuando `NEXT_PUBLIC_SITE_URL` no está seteado; el propio comentario del código documenta el riesgo de spoofing de `Host` en despliegues sin proxy y ofrece `ALLOWED_INVITE_HOSTS` como mitigación opcional — **no se verificó si esa variable está configurada en el entorno de producción real** (fuera del alcance de esta auditoría de código).

---

### 1.6 Recepción de mensajes (webhook entrante WhatsApp)

**Estado:** VERIFICADO Y OPERATIVO
**Confianza:** Media

**Evidencia:**
- `src/app/api/whatsapp/webhook/route.ts` — ficha completa en la sección 2.12. Firma HMAC-SHA256 fail-closed (`verifyMetaWebhookSignature`), resolución de tenencia por `phone_number_id`, `after()` para procesar tras el ACK a Meta (evita timeout/duplicados, issue #301 documentado en el código), dedupe de contacto por teléfono (`findExistingContact`), fan-out a automations/flows/IA/webhooks salientes.
- Máquina de estados de `broadcast_recipients` (líneas 319-350) — transición forward-only, `failed` solo terminal desde pre-entregado.

**Verificaciones realizadas:**
✓ `npm test` — `src/lib/whatsapp/webhook-signature.test.ts` (7 casos, verificación HMAC).
✓ Lectura completa del handler `processWebhook`/`processMessage` (más de 900 líneas) — el flujo de find-or-create de contacto/conversación, inserción de mensaje y fan-out está íntegro y maneja condiciones de carrera (`isUniqueViolation`, línea 1033).

**Pendientes:**
- Sin prueba de integración end-to-end (payload real de Meta → inserciones en base) — la verificación de firma está probada; el resto del pipeline se verifica solo por lectura estática.
- La detección de `configRows.length > 1` (línea 274-283) descarta el mensaje entrante sin reintentos ni alerta activa — solo un `console.error`; no se verificó si existe monitoreo externo de esos logs.

---

### 1.7 Envío de mensajes (composer, API pública, y los meta-send de ai/flows/automations)

**Estado:** PARCIAL
**Confianza:** Media

**Evidencia:**
- Composer del dashboard: `src/app/api/whatsapp/send/route.ts` → core compartido `sendMessageToConversation` (`src/lib/whatsapp/send-message.ts`) — ficha 2.14.
- API pública: `src/app/api/v1/messages/route.ts` → mismo core compartido — ficha 2.13.7.
- Automations: `src/lib/automations/meta-send.ts` (ficha 2.15) — **NO** pasa por el core compartido, llama directo a `@/lib/whatsapp/meta-api`.
- Flows: `src/lib/flows/meta-send.ts` (ficha 2.15) — mismo patrón, propio punto de contacto con Meta.
- AI: `src/lib/ai/auto-reply.ts` — mismo patrón (confirmado como hallazgo ya en el audit histórico §7, aún vigente en este commit).

**Verificaciones realizadas:**
✓ El composer y la API pública **sí** convergen en un único core (`sendMessageToConversation`) — confirmado leyendo ambas rutas.
✓ `npm test` pasa para el composer (`whatsapp/send/route.test.ts`) y para el motor de automations (`automations/engine.test.ts`).
✗ Confirmado que `automations` y `flows` **mantienen** su propio `meta-send.ts` en este commit — el hallazgo del audit histórico §7 (acoplamiento directo a Meta, deuda a congelar) **sigue vigente**, no fue resuelto entre la Etapa 0 y la Fase 3.0B.

**Pendientes:**
- No se leyó `automations/meta-send.ts` y `flows/meta-send.ts` línea por línea con el mismo detalle que `send-message.ts` (ver nota de confianza en la ficha 2.15) — se confirmó el patrón de import pero no cada rama de código.
- Esta fragmentación es la razón por la que un cambio futuro en la lógica de envío (p.ej. un nuevo tipo de mensaje, o un cambio en el reintento de variantes de teléfono) debe replicarse en tres lugares en vez de uno — registrado también como deuda técnica en la sección 3.

---

### 1.8 Inbox / conversaciones / contactos

**Estado:** VERIFICADO Y OPERATIVO
**Confianza:** Media

**Evidencia:**
- `src/lib/contacts/dedupe.ts` (105 líneas) — `findExistingContact`/`findOrCreateContact`, dedupe por teléfono normalizado, compartido por webhook, formulario manual e import CSV (issue #212 referenciado en comentarios).
- `src/lib/inbox/conversations.ts` (71 líneas) — `CONVERSATION_SELECT`, `normalizeConversation`, usado tanto por el inbox del dashboard como por `/api/v1/conversations`.
- RLS de `conversations`/`contacts`/`messages` (migración 017) — políticas `is_account_member` para select, `is_account_member(..., 'agent')` para insert/update/delete.

**Verificaciones realizadas:**
✓ `npm test` — `src/lib/inbox/conversations.test.ts` cubre `normalizeConversation`.
✓ Confirmado que el modelo "una conversación por (account, contact)" (nota histórica del audit §1.1) sigue vigente — no se encontró columna de canal ni soporte para múltiples hilos por contacto.

**Pendientes:**
- No se verificó el comportamiento de la UI del inbox bajo carga concurrente (dos agentes editando la misma conversación a la vez) — fuera del alcance de una auditoría de código estático.
- El supuesto "identidad = teléfono" (audit histórico §4.1) sigue vigente: un contacto sin teléfono no puede existir hoy.

---

### 1.9 Conexión de WhatsApp (config, phone_number_id, verificación)

**Estado:** VERIFICADO Y OPERATIVO
**Confianza:** Media

**Evidencia:** ficha 2.11 (`app/api/whatsapp/config`) — GET/POST/DELETE, verificación contra Meta antes de guardar, cifrado GCM de tokens con auto-upgrade desde formato legacy CBC, detección de `phone_number_id` reclamado por otra cuenta.
También `src/app/api/whatsapp/config/verify-registration/route.ts` (no leído línea por línea en esta pasada — **DESCONOCIDO, no auditado en detalle**; no aparece en el grep de service-role, así que no forma parte de la sección 2, pero queda pendiente de una revisión funcional futura).

**Verificaciones realizadas:**
✓ Lectura completa de GET/POST/DELETE en `whatsapp/config/route.ts`.
✗ `verify-registration/route.ts` no fue leído en esta auditoría — se registra como pendiente en vez de asumir que sigue el mismo patrón.

**Pendientes:**
- Como se documentó en la ficha 2.11: el control de rol (`admin+`) para POST/DELETE vive únicamente en RLS, sin `requireRole` explícito en el código TypeScript de la ruta — una sola capa, no dos.
- `src/app/api/whatsapp/config/verify-registration/route.ts` queda **sin auditar** en este documento — no se incluyó en el barrido detallado por límite de tiempo de esta pasada. Se registra explícitamente el vacío en vez de omitirlo en silencio.

---

### 1.10 Asignación de agentes

**Estado:** RESUELTA (2026-07-23)
**Confianza:** Alta — validación empírica contra base real, no solo lectura estática.

**Evidencia:**
- No existe una ruta `/api/*` para asignar agentes. La asignación ocurre enteramente client-side: `src/components/inbox/message-thread.tsx` líneas 822-836 — `supabase.from('conversations').update({ assigned_agent_id: agentId }).eq('id', conversation.id)` usando el cliente RLS del navegador directamente.
- RLS: la política `conversations_update` **ahora tiene `WITH CHECK`** (migración `036_conversations_update_with_check.sql`) que exige que `assigned_agent_id` sea `NULL`, no haya cambiado respecto al valor previo de la fila, o pertenezca a la misma cuenta (`EXISTS` contra `profiles`) — cierra el hueco descrito originalmente en esta ficha.
- `src/lib/automations/engine.ts` (paso `assign_conversation`, líneas 450-472) sí acota `agentId` a un perfil de la propia cuenta cuando usa `mode: 'round_robin'` (`.eq('account_id', ...)`), pero si el step usa `cfg.agent_id` fijo (modo manual), ese valor no se revalida contra la membresía de la cuenta en el momento de ejecutar el step — sin cambios por esta migración (el motor corre como `service_role`, que bypassea RLS).

**Verificaciones realizadas:**
✓ Confirmado por lectura que ninguna ruta server-side interviene en la asignación manual desde el inbox — es una escritura directa de cliente contra Supabase.
✓ Migración 036 validada empíricamente en `wacrm-staging` (ref `zkrjdsqkfokzoifslfve`), las 36 migraciones aplicadas desde cero, seed `supabase/seed/staging-036-validation.sql` (2 cuentas, 4 usuarios, 1 contacto, 2 conversaciones — una huérfana vía la RPC real `remove_account_member`). Las 4 validaciones SQL ejecutables corrieron como ROLE `authenticated` (no `postgres`, para no bypassear RLS):
  1. Asignar a un compañero de la misma cuenta → ÉXITO (`UPDATE 1`).
  2. Asignar a un usuario de otra cuenta → FALLO con `ERROR 42501` "new row violates row-level security policy for table conversations".
  3. Desasignar (`assigned_agent_id = NULL`) → ÉXITO.
  4. Update no relacionado (`unread_count = 0`) sobre una conversación YA huérfana, sin tocar `assigned_agent_id` → ÉXITO — confirma que la subquery auto-referencial funciona y que no se congelan las conversaciones de un agente removido.
  5. (`service_role`) no es verificable por SQL — es verificación de código, ya cubierta en la auditoría original.
✓ Aplicada en producción (ref `cgwrlkrkesjzrxtuvcfh`), 2026-07-23, dentro de una transacción `BEGIN`/`COMMIT`, verificada con `SELECT policyname, cmd, qual IS NOT NULL, with_check IS NOT NULL FROM pg_policies WHERE tablename='conversations' AND policyname='conversations_update'` → `conversations_update | UPDATE | true | true`.

**Pendientes:**
- Ninguno sobre el hueco original. El modo `round_robin`/`cfg.agent_id` fijo de `assign_conversation` sigue sin revalidación de membresía en el momento de ejecutar el step (corre como `service_role`), pero es un caso distinto al cubierto por esta ficha.

---

### 1.11 Automatizaciones, flows e IA

**Estado:** VERIFICADO Y OPERATIVO (motor) / PARCIAL (gestión de recursos vía API — ver 2.3/2.4)
**Confianza:** Media

**Evidencia:**
- Motor de automations: `src/lib/automations/engine.ts` — fichas 2.10 y 2.15. El fix del CVE GHSA-63cv-2c49-m5v3 (verificación de propiedad del `contactId` antes de despachar) **sigue presente y correcto** en las líneas 75-90 — el punto de partida conocido de las instrucciones de esta auditoría se confirma vigente.
- Motor de flows: `src/lib/flows/engine.ts` — invocado desde el webhook con `accountId` resuelto server-side (ficha 2.15, confianza Media por no haber sido leído con el mismo detalle).
- IA: `src/lib/ai/auto-reply.ts`, `src/app/api/ai/draft/route.ts` (ficha 2.1), `src/app/api/ai/config/route.ts` (usa `getCurrentAccount`/`requireRole('admin')`, cliente RLS — no service-role).
- Gestión de recursos vía API: automations (fichas 2.2-2.4, **con el hallazgo de filtro por `user_id` en vez de `account_id`** en `[id]` y `[id]/duplicate`) y flows (fichas 2.6-2.8, patrón correcto).

**Verificaciones realizadas:**
✓ `npm test` — `src/lib/automations/engine.test.ts`, `src/lib/ai/auto-reply.test.ts` pasan.
✓ Confirmado que el fix del CVE histórico sigue presente y sin regresión.

**Pendientes:**
- El hallazgo de la ficha 2.3/2.4 (`user_id` en vez de `account_id`) es un defecto de **funcionalidad multi-usuario** (un compañero de cuenta no puede gestionar automatizaciones creadas por otro), no de fuga entre cuentas distintas — pero corrompe la premisa de "cuenta compartida" que el resto del sistema respeta. Se prioriza en las recomendaciones (sección 4).
- No se auditó `flows/engine.ts` con el mismo nivel de detalle que `automations/engine.ts` (ver ficha 2.15) — queda como confianza Media, no Alta.

---

### 1.12 Configuración del negocio

**Estado:** PARCIAL
**Confianza:** Media

**Evidencia:**
- El panel de Settings (`src/app/(dashboard)/settings/page.tsx`) organiza por módulo: perfil, seguridad, apariencia, WhatsApp, plantillas, respuestas rápidas, campos/tags, deals (con `defaultCurrency`), miembros, API keys — coherente con `phase-3-saas-instructions.md` §3 ("cada módulo administra solo lo suyo").
- **Actualización (2026-07-29, Fase 3.3) — resuelto el hallazgo de esta ficha.** `PATCH /api/account` ahora **sí tiene consumidor**: `src/components/settings/organization-settings.tsx`, montado como el tab `organization` de `settings/page.tsx` (línea 14 import, línea 62 `organization: <OrganizationSettings />`). El componente expone 8 campos editables — nombre, tipo de negocio, país, zona horaria, idioma, correo de negocio, teléfono de negocio, dirección — sobre los 9 posibles de la 038 (`logo_url` queda fuera, ver deuda técnica nueva más abajo). Lee con `GET /api/account` (línea 95) y guarda con `PATCH /api/account` (línea 164), sin escritura directa a Supabase. País e idioma se eligen de catálogos curados nuevos (`src/lib/countries.ts`, 47 líneas; `src/lib/languages.ts`, 28 líneas) — no exhaustivos, mismo criterio que el `CHECK` de la 038 (valida forma, no pertenencia a una tabla de países real). Zona horaria se elige de `Intl.supportedValuesOf('timeZone')` (línea 74-77), la misma fuente que valida el servidor, así que el valor elegido siempre pasa el chequeo del PATCH. Permisos: `readOnly = !canEditSettings` (línea 191, de `useAuth()`) — los 8 inputs quedan `disabled` para no-admins (líneas 226-379) con un hint visible (`adminOnlyHint`, línea 209-213) explicando por qué.
- No existe un concepto de "horario de negocio" (business hours) distinto de la zona horaria — sigue sin cambios en este commit, `grep` sobre migraciones no encuentra `business_hours`. Tampoco hay un `business_name` como columna separada: el nombre de negocio capturado en el signup (ficha 1.1) se vuelve directamente `accounts.name` vía `resolve_account_name` (039) — no hay dos nombres (comercial vs. de cuenta) que reconciliar.

**Verificaciones realizadas:**
✓ Lectura de `settings/page.tsx` y del árbol de componentes de `src/components/settings/`.
✓ **RESUELTO (2026-07-29).** `PATCH /api/account` tiene consumidor real en la UI — ver evidencia arriba.
✓ El backend detrás de este panel (`PATCH /api/account`) tiene cobertura automática: 9 tests unitarios + 7 de integración contra Postgres real (ver ficha 1.2). El **panel en sí** (`organization-settings.tsx`) se probó **manualmente en local contra la base de producción**: carga los valores existentes, guarda cambios y persisten tras recargar — no hay test automatizado (unitario, de integración ni end-to-end) de este componente. Se registra explícitamente la distinción entre "el backend que consume" (probado por código) y "la pantalla en sí" (probada a mano) en vez de dejarlo implícito.

**Pendientes:**
- No se revisaron en detalle `template-manager.tsx`, `fields-and-tags-panel.tsx` ni `deals-settings.tsx` línea por línea — se confirmó su existencia y su rol en la navegación, no el detalle de cada uno.
- Sin test automatizado de `organization-settings.tsx` — solo verificación manual (ver arriba). Un cambio futuro en el componente no tiene red de seguridad automática que lo detecte.
- `business_type` es texto libre sin catálogo curado (el input es un `Input` simple, no un `Select` como país/idioma) — registrado como deuda técnica nueva en la sección 3.
- `logo_url` existe en la columna pero no tiene UI de carga — registrado como deuda técnica nueva en la sección 3.
- "Horario de negocio" (business hours) sigue sin existir como concepto — limitación conocida, no abordada por esta fase.

---

### 1.13 RLS y validación por account_id (dónde hay RLS real vs filtro manual)

**Estado:** PARCIAL
**Confianza:** Media

Esta sección resume, a través de las fichas 1.1-1.12 y 2.1-2.15, el mapa real de qué protege cada capa:

**Rutas donde RLS es la barrera efectiva (cliente RLS del caller, no service-role):**
`/api/account*`, `/api/quick-replies` (GET), `/api/automations` (GET), `/api/flows` (GET), `/api/flows/[id]*` (guardián previo al bypass), `/api/ai/draft` (lectura de conversation), `/api/ai/config`, la escritura real de `/api/whatsapp/config` (ficha 2.11).

**Rutas donde el filtro manual por `account_id` en TypeScript es la única barrera (service-role, sin RLS):** las 26 rutas de la sección 2 en conjunto — cada una fue verificada individualmente. De ellas, **23 filtran correctamente por `account_id`** (o delegan en una comprobación RLS previa) y **2 filtran incorrectamente por `user_id`** (`automations/[id]`, `automations/[id]/duplicate` — fichas 2.3 y 2.4). Los 2 endpoints de cron (`automations/cron`, `flows/cron`) no tienen "cuenta" propia — procesan filas cross-cuenta por diseño, cada una escopeada por su propio `account_id` de fila.

**Sin ninguna de las dos capas (hueco de diseño, no de código):** la asignación manual de agente (ficha 1.10) — escritura de cliente directa contra Supabase sin una segunda validación de que el `assigned_agent_id` pertenezca a la cuenta.

**Verificaciones realizadas:**
✓ Las 26 fichas de la sección 2 se produjeron específicamente para alimentar esta sección — este resumen no es una afirmación nueva, es la consolidación de hallazgos ya evidenciados arriba.

**Pendientes:**
- No existe un mecanismo estructural (guardián central, tipo de dato que fuerce el filtro, o test que falle automáticamente) que impida que una ruta nueva repita el patrón de 2.3/2.4. La disciplina sigue siendo manual, ruta por ruta — exactamente el riesgo que el audit histórico §5.4 describió como "sólido por disciplina repetida, no por diseño", y que sigue sin resolverse en este commit.
- No se verificaron las políticas RLS de las tablas no mencionadas explícitamente en las fichas anteriores (p. ej. `message_templates`, `pipelines`, `deals`, `tags`, `custom_fields` en sus rutas de lectura/escritura vía cliente RLS directo) con el mismo detalle — se confirmó su existencia en la migración 017 pero no se auditó cada ruta que las consume.

---

### Actualización a un hallazgo del audit histórico: storage de `flow-media`

El audit histórico (`current-state-audit.md` §6) marcó el bucket `flow-media` como user-scoped y como riesgo pendiente de evaluar. **Verificado en este commit: ya no es así.** La migración `020_account_sharing_followups.sql` (líneas 53-119) reescribió las políticas de `storage.objects` para `flow-media` a rutas `account-<account_id>/...`, preservando las rutas legadas `<user_id>/...` solo para que el uploader original conserve acceso de escritura a lo que ya subió (aditivo, no un hueco nuevo). **`avatars` sigue siendo user-scoped por diseño** (migración 008) — es correcto, un avatar es inherentemente personal, no un dato de cuenta. Se registra esta actualización explícitamente porque `current-state-audit.md` no debe reescribirse (nota histórica de Fase 3.0A) y este documento es el lugar correcto para asentar que ese riesgo específico ya fue cerrado.

---

## 2. Rutas y librerías service-role (ficha por ruta, sin excepción)

**Alcance real, verificado en este commit — más amplio que el inventario histórico.** `grep -rln "SERVICE_ROLE_KEY\|supabaseAdmin" src/app/api --include="*.ts"` da **13 rutas** con importación directa. Pero además:
- `src/app/api/automations/engine/route.ts` no importa `supabaseAdmin` directamente, pero llama a `runAutomationsForTrigger` (`@/lib/automations/engine`), que sí lo hace — es una ruta service-role **indirecta**.
- **Las 11 rutas bajo `src/app/api/v1/*`** no importan `supabaseAdmin` tampoco, pero todas llaman a `requireApiKey()` (`@/lib/auth/api-context.ts`), que devuelve `ctx.supabase = supabaseAdmin()` — el cliente que la API pública usa para **toda** query es de service-role. Confirmado por `grep -rl "from '@/lib/auth/api-context'" src/app/api` (11 archivos).
- `src/app/api/whatsapp/send/route.ts` no usa service-role para sus propias queries (usa el cliente RLS del caller), pero delega en `sendMessageToConversation` (`@/lib/whatsapp/send-message.ts`), que hace una única llamada `supabaseAdmin()` para pausar flows.

Total auditado en esta sección: **26 rutas** (13 directas + 1 indirecta vía automations/engine + 11 vía v1 API + 1 híbrida) más las librerías de soporte.

### 2.1 `app/api/ai/draft`
**Propósito:** genera una respuesta sugerida (IA) para que el agente la edite/envíe.
Identidad (auth.getUser): ✅ (vía `requireRole('agent')`)
Membresía (is_account_member): ✅ (vía `requireRole`, que llama a `getCurrentAccount`)
Organización activa: ✅ (una cuenta por perfil)
Propiedad del recurso (account_id): ✅ para `conversations` (leída con el cliente RLS del caller, no admin); ⚠️ el único uso de `supabaseAdmin()` es `logAiUsage` (fire-and-forget, solo escribe un log de uso con `accountId` correcto, sin lectura cross-tenant)
RLS involucrado: Sí (conversations, vía cliente RLS)
Riesgo: Bajo
Confianza: Alta
Evidencia:
- `src/app/api/ai/draft/route.ts` líneas 25, 48-52, 116-124
Observaciones: patrón limpio — el service-role se usa solo para lo que la política RLS de `ai_usage_log` no permite a un cliente autenticado (líneas 109-111 lo documentan explícitamente).

---

### 2.2 `app/api/automations` (POST; GET no usa service-role)
**Propósito:** listar (GET, cliente RLS) y crear (POST, admin) automatizaciones.
Identidad: ✅ | Membresía: ✅ (perfil→account_id) | Organización activa: ✅ | Propiedad: ✅ (`account_id` del perfil se inyecta explícitamente en el INSERT)
RLS involucrado: Sí para GET (RLS pura); No para POST (bypass deliberado + `requireRole('agent')` manual, líneas 28-35)
Riesgo: Bajo
Confianza: Alta
Evidencia: `src/app/api/automations/route.ts` líneas 12-25 (GET), 27-135 (POST)
Observaciones: el comentario del código (línea 28-30) documenta correctamente por qué se necesita el chequeo de rol manual cuando se usa el cliente admin.

---

### 2.3 `app/api/automations/[id]` (GET/PATCH/DELETE)
**Propósito:** leer, editar y borrar una automatización puntual.
Identidad: ✅ | Membresía: ✅ (`requireRole('agent')` en PATCH/DELETE; GET solo exige sesión) | Organización activa: ✅ | **Propiedad del recurso (account_id): ❌**
RLS involucrado: No (todo vía `supabaseAdmin()`)
Riesgo: **Medio**
Confianza: Alta
Evidencia:
- `src/app/api/automations/[id]/route.ts` línea 36 (`GET`: `.eq('user_id', user.id)`), línea 76 (`PATCH`: `existing.user_id !== user.id`), línea 155 (`DELETE`: `.eq('user_id', user.id)`)
Observaciones: **Filtra por `user_id`, no por `account_id`.** Es exactamente el patrón de riesgo señalado en la nota de contexto de este documento y en el audit histórico §5.3: `user_id` no equivale a `account_id`. No es una fuga entre cuentas distintas (cada `user_id` pertenece hoy a una sola cuenta), pero **contradice el modelo de cuenta compartida multi-usuario**: la política RLS `automations_select`/`update`/`delete` (migración 017) permite a **cualquier miembro** de la cuenta (`is_account_member(account_id, 'agent')`) operar sobre la automatización, pero esta ruta se lo niega a un compañero de equipo que no sea el creador original — un admin o agente que no creó la automatización recibe 404 al intentar verla, editarla o borrarla. Contrastar con `app/api/flows/[id]/route.ts` (ficha 2.7), que resuelve el mismo problema correctamente delegando la comprobación de pertenencia en el cliente RLS antes de mutar con el admin.

---

### 2.4 `app/api/automations/[id]/duplicate`
**Propósito:** clonar una automatización (incluyendo sus pasos) dentro de la misma cuenta.
Identidad: ✅ | Membresía: ✅ (`requireRole('agent')`) | Organización activa: ✅ | **Propiedad del recurso (account_id): ❌** (misma causa que 2.3)
RLS involucrado: No
Riesgo: **Medio**
Confianza: Alta
Evidencia: `src/app/api/automations/[id]/duplicate/route.ts` línea 32 (`.eq('user_id', user.id)` para localizar el original)
Observaciones: el `INSERT` de la copia sí estampa `account_id: original.account_id` correctamente (línea 42) — el problema es únicamente en la lectura/localización del original, mismo patrón que 2.3.

---

### 2.5 `app/api/automations/cron`
**Propósito:** drenar `automation_pending_executions` vencidas (worker programado, sin sesión de usuario).
Identidad: N/A — autenticación por secreto compartido (`x-cron-secret` vs `AUTOMATION_CRON_SECRET`)
Membresía: N/A (proceso batch cross-cuenta por diseño)
Organización activa: N/A
Propiedad del recurso (account_id): ✅ (cada fila trae su propio `account_id`, que `resumePendingExecution` usa para todo lookup posterior — ver ficha 2.13, `automations/engine.ts`)
RLS involucrado: No
Riesgo: Medio
Confianza: Media
Evidencia: `src/app/api/automations/cron/route.ts` líneas 17-25 (comparación de secreto), 27-65
Observaciones: la comparación del secreto usa `!==` (línea 23), **no** `crypto.timingSafeEqual`. Contrasta con `flows/cron/route.ts` (ficha 2.9), que sí usa comparación de tiempo constante para el mismo propósito — inconsistencia menor entre los dos crons gemelos.

---

### 2.6 `app/api/flows` (POST; GET no usa service-role)
**Propósito:** listar (GET, RLS) y crear (POST, admin) flows, incluyendo clonado desde plantilla.
Identidad: ✅ | Membresía: ✅ | Organización activa: ✅ | Propiedad: ✅ (`accountId` del perfil inyectado en el INSERT, línea 113-114/163)
RLS involucrado: Sí (GET); No (POST, bypass + `requireRole('agent')` manual)
Riesgo: Bajo
Confianza: Alta
Evidencia: `src/app/api/flows/route.ts` líneas 31-46 (GET), 48-179 (POST)

---

### 2.7 `app/api/flows/[id]` (GET/PUT/DELETE)
**Propósito:** leer, reemplazar el grafo de nodos y borrar un flow.
Identidad: ✅ | Membresía: ✅ | Organización activa: ✅ | **Propiedad del recurso (account_id): ✅ — patrón correcto**
RLS involucrado: Sí, como *guardián previo* al bypass — `requireOwnership()` (líneas 21-49) consulta `flows` con el cliente RLS del caller (`is_account_member` decide visibilidad); solo si esa consulta encuentra la fila se procede a mutarla con `supabaseAdmin()` filtrando por el mismo `id` ya validado.
Riesgo: Bajo
Confianza: Alta
Evidencia: `src/app/api/flows/[id]/route.ts` líneas 21-49 (`requireOwnership`), 96-103, 192-198 (comentarios que documentan el bypass + el porqué del `requireRole` manual)
Observaciones: **este es el patrón de referencia** — el nombre de la función (`requireOwnership`) es ligeramente engañoso (es en realidad "pertenencia a la cuenta", no "creado por este usuario"), pero el comportamiento es el correcto: cualquier miembro de la cuenta puede operar el flow, igual que dicta la política RLS. Comparar con la ficha 2.3 (`automations/[id]`), que filtra por `user_id` en vez de delegar en RLS y por eso rompe el modelo de cuenta compartida.

---

### 2.8 `app/api/flows/[id]/activate`
**Propósito:** cambiar el estado de un flow (`draft`/`active`/`archived`), validando antes de activar.
Identidad: ✅ | Membresía: ✅ (`requireRole('agent')` + chequeo RLS de pertenencia línea 57-64) | Organización activa: ✅ | Propiedad: ✅ (mismo patrón que 2.7 — RLS valida visibilidad antes de mutar con admin)
RLS involucrado: Sí (guardián previo)
Riesgo: Bajo
Confianza: Alta
Evidencia: `src/app/api/flows/[id]/activate/route.ts` líneas 31-35, 56-64

---

### 2.9 `app/api/flows/cron`
**Propósito:** barrer `flow_runs` activos abandonados y marcarlos `timed_out` (worker programado).
Identidad: N/A — secreto compartido (`x-cron-secret`), comparado con `crypto.timingSafeEqual` (línea 41-44) — correcto.
Membresía: N/A | Organización activa: N/A
Propiedad del recurso (account_id): ✅ (cada `flow_run` trae su propio contexto; el barrido opera fila por fila con `.eq('id', r.id).eq('status','active')` como precondición de concurrencia)
RLS involucrado: No
Riesgo: Bajo
Confianza: Alta
Evidencia: `src/app/api/flows/cron/route.ts` líneas 29-46, 84-96

---

### 2.10 `app/api/automations/engine` (indirecta)
**Propósito:** disparo manual de automatizaciones (testing / integraciones).
Identidad: ✅ (`requireRole('agent')`) | Membresía: ✅ | Organización activa: ✅ | Propiedad del recurso: ✅ **por diseño en la capa inferior** — `accountId` viene del contexto de sesión del servidor (`ctx.accountId`), nunca del body; solo `contact_id` es dato del llamador, y `runAutomationsForTrigger` (ficha 2.13, más abajo) lo valida contra `account_id` antes de usarlo (el fix del CVE GHSA-63cv-2c49-m5v3).
RLS involucrado: No (delega en el engine, que usa `supabaseAdmin()`)
Riesgo: Bajo
Confianza: Alta
Evidencia: `src/app/api/automations/engine/route.ts` completo (35 líneas); `src/lib/automations/engine.ts` líneas 75-90
Observaciones: no aparece en el `grep` de importación directa de `supabaseAdmin` — se detectó rastreando qué rutas importan `@/lib/automations/engine`. Registrado explícitamente para no dejarlo fuera del inventario.

---

### 2.11 `app/api/whatsapp/config` (GET/POST/DELETE)
**Propósito:** guardar, verificar y borrar la configuración de WhatsApp de la cuenta.
Identidad: ✅ | Membresía: ⚠️ implícita (`resolveAccountId` solo exige que el perfil tenga `account_id`; **no hay `requireRole('admin')` explícito en el código TS** pese a que la política RLS `whatsapp_config_insert/update/delete` exige `admin+`) | Organización activa: ✅ | Propiedad: ✅
RLS involucrado: **Sí para las escrituras reales** — el INSERT/UPDATE/DELETE de `whatsapp_config` (líneas 370-401, 462-465) usan el cliente RLS del caller (`supabase`, no `supabaseAdmin()`), así que la política `admin+` de RLS es la que efectivamente bloquea a un agente/viewer, no el código de la ruta. `supabaseAdmin()` se usa **solo** para una comprobación de conflicto cross-cuenta (línea 213-219: ¿otra cuenta ya reclamó este `phone_number_id`?) — lectura acotada a `account_id`, sin fuga de PII.
Riesgo: Bajo (mitigado por RLS) — pero **el control de rol vive únicamente en la base de datos, no hay defensa en profundidad en la ruta**, a diferencia de `/api/account` o `/api/quick-replies`, que sí llaman `requireRole('admin'|'agent')` explícitamente.
Confianza: Media
Evidencia: `src/app/api/whatsapp/config/route.ts` líneas 21-32 (`resolveAccountId`), 213-236 (chequeo cross-cuenta con admin), 370-401 (POST, cliente RLS), 462-465 (DELETE, cliente RLS)
Observaciones: si una futura migración cambiara `whatsapp_config_update`/`insert`/`delete` de RLS a algo más laxo sin el mínimo de rol (p.ej. por error al copiar una política), esta ruta no tiene una segunda barrera en TypeScript que lo detenga — hoy funciona porque RLS es estricta, pero es una única capa, no las dos que exige la regla 8 de `core-architecture.md`.

---

### 2.12 `app/api/whatsapp/webhook` (GET/POST)
**Propósito:** verificación del webhook de Meta (GET) y recepción de mensajes/estados entrantes (POST).
Identidad: N/A — no hay usuario; la autenticación es la firma HMAC-SHA256 (`verifyMetaWebhookSignature`, fail-closed si falta `META_APP_SECRET`)
Membresía: N/A
Organización activa: N/A — la tenencia se resuelve por `phone_number_id → whatsapp_config.account_id` (líneas 248-285), con manejo explícito de 0 y ≥2 filas coincidentes
Propiedad del recurso (account_id): ✅ — cada inserción posterior (`contacts`, `conversations`, `messages`) estampa el `account_id` resuelto
RLS involucrado: No (todo el flujo usa `supabaseAdmin()`, correcto para un webhook sin sesión)
Riesgo: Bajo (la superficie de riesgo es la firma HMAC, no el account scoping)
Confianza: Alta
Evidencia: `src/app/api/whatsapp/webhook/route.ts` líneas 172-184 (verificación de firma), 248-285 (resolución de tenancy), 1017-1041 (creación de contacto con `account_id`)
Verificaciones realizadas: ✓ `npm test` — `src/lib/whatsapp/webhook-signature.test.ts` (7 casos) cubre la verificación HMAC de forma unitaria.
Pendientes: sin prueba de integración que ejercite `processWebhook` completo contra una base real; la lógica de fan-out (automations/flows/IA/webhooks salientes) se verifica solo por lectura.

---

### 2.13 Las 11 rutas `/api/v1/*` — patrón común

Las once rutas de la API pública comparten un único punto de entrada, `requireApiKey()` (`src/lib/auth/api-context.ts`, líneas 80-118), que:
1. Extrae y valida el formato del bearer token (`extractKey`, líneas 59-66).
2. Resuelve la clave activa por su hash (`findActiveKeyByHash`, en `src/lib/api-keys/store.ts` líneas 34-57) — service-role, porque no existe sesión de Supabase para que RLS compare contra `auth.uid()`.
3. Aplica rate-limit por clave, exige el scope pedido, y devuelve `ctx.accountId` fijado por la clave — **nunca** por un parámetro del caller.

Es decir: **Identidad = posesión de la clave** (no `auth.getUser()`), **Membresía = la clave está activa y pertenece a una cuenta** (columna `account_id` de `api_keys`), **Organización activa = la cuenta de la clave** (fija, no seleccionable por el caller), **Propiedad del recurso = cada ruta filtra manualmente por `ctx.accountId`** (no hay RLS real, porque el cliente es de service-role). Confirmado por lectura de las 11 rutas — todas incluyen `.eq('account_id', ctx.accountId)` (o su equivalente vía una tabla padre ya validada) en cada query.

| # | Ruta | Scope requerido | Propiedad (account_id) | Riesgo | Confianza |
|---|------|------------------|--------------------------|--------|-----------|
| 2.13.1 | `GET /api/v1/me` | ninguno | N/A (solo devuelve datos de la propia clave) | Bajo | Alta |
| 2.13.2 | `GET/POST /api/v1/contacts` | contacts:read / contacts:write | ✅ `.eq('account_id', ctx.accountId)` en list e insert | Bajo | Alta |
| 2.13.3 | `GET/PATCH /api/v1/contacts/[id]` | contacts:read / contacts:write | ✅ `getContactById` + `.eq('account_id',...)` antes de mutar | Bajo | Alta |
| 2.13.4 | `GET /api/v1/conversations` | conversations:read | ✅ `.eq('account_id', ctx.accountId)` | Bajo | Alta |
| 2.13.5 | `GET /api/v1/conversations/[id]` | conversations:read | ✅ `.eq('id',id).eq('account_id',...)` | Bajo | Alta |
| 2.13.6 | `GET /api/v1/conversations/[id]/messages` | messages:read | ✅ verifica la conversación por `account_id` antes de leer `messages` (línea 29-35) | Bajo | Alta |
| 2.13.7 | `POST /api/v1/messages` | messages:send | ✅ `sendMessageToConversation(ctx.supabase, ctx.accountId, ...)` — mismo core que la ruta del dashboard (ficha 2.14) | Bajo | Alta |
| 2.13.8 | `POST /api/v1/broadcasts` | broadcasts:send | ✅ `createBroadcast(ctx.supabase, ctx.accountId, ...)` | Bajo | Media (fan-out en `after()`, sin prueba automática) |
| 2.13.9 | `GET /api/v1/broadcasts/[id]` | broadcasts:send | ✅ `.eq('id',id).eq('account_id',...)` | Bajo | Alta |
| 2.13.10 | `GET/POST /api/v1/webhooks` | webhooks:manage | ✅ list y create ambos estampan/filtran `account_id` | Bajo | Alta |
| 2.13.11 | `GET/PATCH/DELETE /api/v1/webhooks/[id]` | webhooks:manage | ✅ las tres operaciones incluyen `.eq('account_id', ctx.accountId)` | Bajo | Alta |

**Identidad:** ✅ (posesión de clave válida) | **Membresía:** ✅ (clave activa, no revocada/expirada) | **Organización activa:** ✅ (fija por la clave) | **Propiedad del recurso:** ✅ en las 11 rutas
RLS involucrado: **No en ninguna** — el cliente es `supabaseAdmin()` end-to-end; la disciplina de filtrar por `ctx.accountId` en TypeScript es la **única** barrera de aislamiento.
Riesgo consolidado: Bajo (por disciplina consistente), pero estructuralmente fresco a la clase de bug que el CVE explota: si una futura ruta v1 olvida el `.eq('account_id', ...)`, no hay una segunda capa (RLS) que lo detenga, porque el service-role la bypassea por diseño.
Confianza: Alta (lectura completa de las 11 rutas; y desde 2026-07-25, `requireApiKey` — el punto de entrada común a las 11 — verificado por ejecución contra base real, no solo lectura). Media para las 11 rutas en sí (su lógica propia de negocio por-ruta sigue sin prueba HTTP — ver Pendientes).

Evidencia: `src/lib/auth/api-context.ts` completo; `src/app/api/v1/{me,contacts,contacts/[id],conversations,conversations/[id],conversations/[id]/messages,messages,broadcasts,broadcasts/[id],webhooks,webhooks/[id]}/route.ts` (11 archivos, leídos íntegramente).

**Verificaciones realizadas:**
✓ Lectura completa de las 11 rutas — todas filtran `account_id` explícitamente, ninguna confía en un valor de `account_id` provisto por el body/query del caller.
✓ `npm test` — `src/lib/api/v1/pagination.test.ts`, `contacts.test.ts`, `conversations.test.ts` cubren la lógica de paginación/serialización de forma unitaria.
✓ **RESUELTO parcialmente (2026-07-25).** `tests/integration/auth/api-context.test.ts` (8 tests, contra `wacrm-staging`) ejercita `requireApiKey` end-to-end por ejecución real: camino feliz (`accountId`/`keyId`/`scopes`/`createdBy` correctos, `last_used_at` se actualiza), sin prefijo Bearer, token malformado, key bien formada sin fila, key revocada, key expirada, scope insuficiente, y rate limit real (agota `RATE_LIMITS.publicApi.limit` y la llamada 121 da 429). Ningún test reveló un bug en `requireApiKey`.
✗ **Sigue sin cobertura**: ningún test ejercita los handlers `GET/POST/PATCH/DELETE` de las 11 rutas en sí (`find src/app/api/v1 -iname "*.test.ts"` no devuelve nada) — la cobertura nueva llama a `requireApiKey` directamente como función, no manda requests HTTP reales contra los archivos de ruta. El punto de autenticación común ya está verificado contra base real; la lógica de negocio propia de cada ruta (filtros, serialización, side effects) no.

**Pendientes:**
- Sin prueba de integración HTTP de los 11 handlers de ruta en sí (más allá de `requireApiKey`, que ya está cubierto — ver arriba).
- El fan-out de `POST /api/v1/broadcasts` corre en `after()` (línea 80) — mismo patrón de riesgo de ejecución en background que el webhook entrante (ficha 2.12); sin prueba que confirme que sobrevive a un cold-start/terminación del runtime serverless.

---

### 2.14 `app/api/whatsapp/send` (híbrido)
**Propósito:** endpoint de envío del dashboard (composer / Contact detail).
Identidad: ✅ (`auth.getUser()`) | Membresía: ✅ (perfil→account_id) | Organización activa: ✅ | Propiedad: ✅
RLS involucrado: **Sí para casi todo** — la ruta usa el cliente RLS del caller (`createClient()`) para resolver `conversation_id`/`contact_id` y para el `INSERT`/`UPDATE` en `sendMessageToConversation` (`@/lib/whatsapp/send-message.ts`). El **único** uso de `supabaseAdmin()` en toda la ruta+librería es una actualización de `flow_runs` (pausar el flow activo cuando un agente humano responde manualmente) — líneas 495-507 de `send-message.ts` — filtrada por `account_id` **y** `contact_id`.
Riesgo: Bajo
Confianza: Alta
Evidencia: `src/app/api/whatsapp/send/route.ts` completo (no importa `supabaseAdmin`); `src/lib/whatsapp/send-message.ts` líneas 38 (import), 495-507 (único uso admin)
Observaciones: no aparece en el `grep` original de rutas service-role (correcto: la ruta en sí no importa `supabaseAdmin`) — se incluye aquí porque su librería central sí hace una llamada puntual, y la Regla 1 exige no omitir nada "por parecer de bajo riesgo".
Verificaciones realizadas: ✓ `npm test` — `src/app/api/whatsapp/send/route.test.ts` existe y pasa (incluido en los 628 tests verdes).

---

### 2.15 Librerías de soporte service-role

**`admin-client.ts` (tres archivos casi idénticos: `src/lib/ai/admin-client.ts`, `src/lib/automations/admin-client.ts`, `src/lib/flows/admin-client.ts`)**
Propósito: factory perezoso de `createClient(url, SERVICE_ROLE_KEY)`. No ejecutan queries propias — son el punto de construcción del cliente que todas las demás piezas de esta sección importan.
Identidad/Membresía/Organización activa/Propiedad: N/A — no son rutas, son infraestructura.
Riesgo: Bajo (asumiendo que `SUPABASE_SERVICE_ROLE_KEY` esté protegida como secreto de servidor — no verificado en esta auditoría de código, es una variable de entorno).
Confianza: Alta
Evidencia: los tres archivos exportan una función `supabaseAdmin()` que memoiza la instancia; verificado que **no** hay lógica de negocio ni filtros dentro de ellos — toda la responsabilidad de scoping recae en el llamador.
Observación: tener tres copias casi idénticas de la misma factory (una por módulo) es deuda técnica menor (ver sección 3) — no es un riesgo de seguridad, es duplicación evitable.

**`src/lib/automations/steps-tree.ts`**
Propósito: leer/insertar/reemplazar el árbol de `automation_steps` de una automatización.
Evidencia: `insertSteps`, `replaceSteps`, `loadStepsTree` — todas reciben `automationId` como parámetro y no filtran por `account_id` internamente porque confían en que el caller (rutas `automations/route.ts`, `[id]/route.ts`) ya validó la pertenencia del `automationId`. **Dado el hallazgo de la ficha 2.3** (esa validación real es por `user_id`, no `account_id`), esta librería hereda la misma limitación de forma transitiva, aunque en sí misma no contiene el error.
Riesgo: Bajo (la librería es correcta dado su contrato; el problema está en el llamador).
Confianza: Media

**`src/lib/automations/meta-send.ts` y `src/lib/flows/meta-send.ts`**
Propósito: los puntos de contacto directo con Meta que usan `automations/engine.ts` y `flows/engine.ts` respectivamente para pasos `send_message`/`send_template`/`send_buttons`/`send_list`. Confirma el hallazgo ya registrado en el audit histórico §7: **cada módulo de alto nivel tiene su propio `meta-send`**, en vez de pasar por el core compartido `sendMessageToConversation` (`lib/whatsapp/send-message.ts`) que usan el dashboard y la API pública.
Evidencia: `grep -rl "meta-api" src/lib/automations src/lib/flows` confirma que ambos importan directamente de `@/lib/whatsapp/meta-api`, no del core de envío.
Riesgo: Bajo en aislamiento multiempresa (reciben `accountId` explícito de sus llamadores, que ya lo validaron) — el riesgo real es de **deuda de arquitectura** (acoplamiento a Meta), no de seguridad. Se registra también en la sección 3.
Confianza: Media (no se leyó el archivo línea por línea en esta pasada; se confirmó el patrón de import).

**`src/lib/flows/engine.ts`**
Propósito: motor determinista de Flows — avanza runs activos según el mensaje/tap entrante.
Evidencia: llamado desde el webhook (`dispatchInboundToFlows`, ficha 2.12) con `accountId` resuelto server-side (nunca del body de un tercero) — mismo patrón de confianza que `automations/engine.ts`.
Riesgo: Bajo
Confianza: Alta — ítem #11 verificado línea por línea (2026-07-23).
Hallazgo (resuelve el DESCONOCIDO de la recomendación #11): `flows/engine.ts` **no** tiene, dentro de sí mismo, un guard de propiedad de contacto equivalente al de `automations/engine.ts` líneas 75-90. Ninguna de sus operaciones internas que usan `contactId`/`conversationId` filtra por `account_id`: `evaluateConditionNode` (líneas 495-499, lee `contacts` solo por `id`), `contact_tags` (líneas 479-483 y 707-723, tabla sin columna `account_id`), `conversations.update` en `executeHandoff` (líneas 445-449) y en el fallback "handoff" (líneas 1035-1038) — todas solo `.eq('id', ...)`. Esto no es explotable hoy porque su único caller, `src/app/api/whatsapp/webhook/route.ts` (líneas 729-748), pasa un `contactId` ya resuelto contra `accountId` (`findOrCreateContact`/`findExistingContact`, líneas 578 y 1034 del mismo archivo) — a diferencia de `automations/engine.ts`, no existe un endpoint público (tipo `POST /api/automations/engine`) que le entregue un `contactId` de un tercero. Además, el envío real a Meta pasa por `src/lib/flows/meta-send.ts`, que sí re-verifica `.eq('account_id', accountId)` sobre `contacts` antes de mandar cualquier mensaje (`engineSendText` líneas 70-75, `engineSendMedia` líneas 180-185, `sendInteractiveViaMeta` líneas 332-337).
Matiz: la protección hoy **depende de que no exista un entrypoint no confiable** para Flows, no de un guard estructural equivalente al de `automations/engine.ts` dentro del motor mismo. Si en el futuro se agrega una vía que dispare un flow con un `contactId` de origen externo, este módulo quedaría expuesto al mismo patrón que corrigió el CVE GHSA-63cv-2c49-m5v3.
Veredicto: NO VULNERABLE HOY (sin ruta de ataque conocida) — riesgo latente, no un guard estructural.

**`src/lib/ai/auto-reply.ts`**
Propósito: `dispatchInboundToAiReply` — genera y envía una respuesta de IA automática cuando el flujo determinista no consumió el mensaje.
Evidencia: invocado desde el webhook con `accountId` server-resuelto (ficha 2.12, línea 804-811).
Riesgo: Bajo
Confianza: Alta — ítem #11 verificado línea por línea (2026-07-23).
Hallazgo (resuelve el DESCONOCIDO de la recomendación #11): mismo patrón que `flows/engine.ts`. `dispatchInboundToAiReply` no filtra por `account_id` en sus operaciones internas sobre `conversationId` — el `select` de `conversations` (líneas 70-74) y el `update` en la rama de handoff (línea 156) son ambos solo `.eq('id', conversationId)`. Su único caller, el mismo webhook (`src/app/api/whatsapp/webhook/route.ts`, líneas 805-810), pasa `contactId`/`conversationId` ya resueltos contra `accountId` en ese mismo request — no existe un endpoint público que invoque este módulo con datos de un tercero. El envío final usa `engineSendText`, importado de `src/lib/flows/meta-send.ts` (línea 10; llamada en líneas 182-189), que sí re-verifica `.eq('account_id', accountId)` antes de mandar el mensaje.
Matiz: igual que `flows/engine.ts`, la protección depende de la ausencia de un caller no confiable, no de un guard estructural dentro del módulo.
Veredicto: NO VULNERABLE HOY (sin ruta de ataque conocida) — riesgo latente, no un guard estructural.

**Verificaciones realizadas (2.15 en conjunto):**
✓ `npm test` — `src/lib/ai/auto-reply.test.ts` y `src/lib/automations/engine.test.ts` existen y pasan (incluidos en los 628 tests verdes); no se confirmó si cubren específicamente las rutas de fuga de tenencia.

**Pendientes (2.15 en conjunto):**
- `flows/engine.ts`, `ai/auto-reply.ts` y ambos `meta-send.ts` no recibieron la misma lectura línea-por-línea que `automations/engine.ts`, `send-message.ts` y las 26 rutas — quedan marcados con confianza Media/Desconocida donde corresponde en vez de asumir que replican el mismo cuidado.

---

## 3. Deuda técnica encontrada

*(registro, no corrección — ver Regla 2. Clasificado por severidad.)*

**Alta:**
- **Usuarios huérfanos por fallo silencioso de `handle_new_user`, sin ruta de recuperación (hallazgo nuevo, RESUELTO 2026-07-25).** El `EXCEPTION WHEN OTHERS` del trigger (017, líneas 679-682) traga cualquier error al crear cuenta/perfil: si el `INSERT INTO profiles` fallaba, PL/pgSQL revertía también el `INSERT INTO accounts` precedente (savepoint implícito del bloque `EXCEPTION`), dejando al usuario en `auth.users` sin perfil ni cuenta — podía loguearse pero `getCurrentAccount` tiraba `ForbiddenError` sin ninguna salida. Este hallazgo no había quedado registrado en este documento como deuda (solo mencionado como Pendiente en la ficha 1.1); se registra aquí junto con su resolución. **Resolución:** no se modificó `handle_new_user` (decisión de diseño explícita — es el piso de comportamiento de la Fase 3.3) — se agregó recuperación del lado de la aplicación: RPC `recover_orphaned_profile()` (`037_recover_orphaned_profile.sql`, `SECURITY DEFINER`, opera solo sobre `auth.uid()`, `pg_advisory_xact_lock` para serializar llamadas concurrentes, idempotente, replica el bootstrap exacto de `handle_new_user`), invocada una sola vez por `getCurrentAccount` (`src/lib/auth/account.ts`) antes de tirar `ForbiddenError`. Verificado con `tests/integration/auth/account-recovery.test.ts` contra `wacrm-staging` (visto FALLAR antes del fix, PASAR después; suite completa 35/35 integración, 636/636 unitaria). Aplicada en `wacrm-staging` y en producción (ref `cgwrlkrkesjzrxtuvcfh`, 2026-07-25), verificada con `SELECT proname, prosecdef FROM pg_proc WHERE proname = 'recover_orphaned_profile'` → `recover_orphaned_profile | true`. Ver ficha 1.1.
- **`app/api/automations/[id]` y `app/api/automations/[id]/duplicate` filtran por `user_id` en vez de `account_id`** (fichas 2.3, 2.4). Rompe el modelo de cuenta compartida multi-usuario para automatizaciones: un compañero de cuenta que no creó la automatización no puede verla, editarla, duplicarla ni borrarla vía estas rutas, pese a que la política RLS subyacente (que estas rutas bypassean con `supabaseAdmin()`) sí lo permitiría. No es una fuga entre cuentas distintas hoy (cada `user_id` pertenece a una sola cuenta), pero es el mismo patrón de confusión `user_id` ≠ `account_id` que el audit histórico §5.3 señaló como el riesgo estructural del sistema, y es exactamente el tipo de bug que reabriría una fuga real el día que un usuario pueda pertenecer a varias cuentas o que otra ruta copie este patrón sin la advertencia.
- ~~**Ninguna de las RPCs SQL críticas de aislamiento tiene test automático que las ejecute**~~ — **RESUELTO (2026-07-25).** `set_member_role`, `remove_account_member`, `transfer_account_ownership` (018) y `peek_invitation`, `redeem_invitation` (019) tienen ahora 26 tests de integración contra `wacrm-staging` (`tests/integration/rpc/account-member-rpcs.test.ts`, `invitation-rpcs.test.ts`) que las ejecutan por código real, no solo lectura estática. Ver fichas 1.3 y 1.5.
- **Ninguna de las 11 rutas `/api/v1/*` tiene test de integración HTTP a nivel de handler** — la cobertura existente es de funciones auxiliares (paginación, serialización) más, desde 2026-07-25, del punto de entrada común `requireApiKey` (8 tests de integración contra `wacrm-staging`, `tests/integration/auth/api-context.test.ts` — ver ficha 2.13). La autenticación de la API pública ya no carece de red de seguridad automatizada, pero los 11 handlers `GET/POST/PATCH/DELETE` en sí (su lógica de negocio propia, más allá de la autenticación) siguen sin ejecutarse en ningún test.
- **El guard anti-producción de la suite de integración no cubre el cliente interno que usa `requireApiKey`** (hallazgo nuevo, 2026-07-25). `findActiveKeyByHash` (`src/lib/api-keys/store.ts`) llama a `supabaseAdmin()` de `@/lib/flows/admin-client`, que lee `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` — **no** las variables `SUPABASE_TEST_URL`/`SUPABASE_TEST_SERVICE_ROLE_KEY` que `tests/integration/setup/guard-staging.ts` valida antes de dejar correr cualquier test. En este repo, `.env.local` apunta esas dos variables a **producción**. Si llegaran seteadas al entorno donde corre `npm run test:integration` (una shell que ya hizo `source` de `.env.local`, un CI mal configurado), el código bajo test escribiría y leería contra producción sin que la guarda lo detecte: la guarda protege el cliente de los fixtures (`testSupabase()`), no el cliente interno que usa `requireApiKey`. El workaround aplicado es local al test — `tests/integration/auth/api-context.test.ts` mockea `@/lib/flows/admin-client` para que `supabaseAdmin()` devuelva el cliente de staging — pero la brecha real (el path de autenticación de la API pública no está cubierto por el mismo guard anti-producción que protege al resto de la suite) sigue sin resolver. Severidad: **Alta** — no es un bug de lógica de negocio, es un hueco en la red de seguridad que evita que un test de integración escriba contra datos reales de clientes; el propio repo ya tiene las variables de producción cargadas en `.env.local`, así que la precondición para el escenario de riesgo (esas variables llegando al proceso que corre los tests) no es hipotética, es la configuración local actual — solo falta que alguien corra `npm run test:integration` en una shell que las haya heredado.

**Media:**
- **Meta-send fragmentado**: `automations/meta-send.ts`, `flows/meta-send.ts` y `ai/auto-reply.ts` cada uno tiene su propio punto de contacto directo con Meta, en vez de pasar por el core compartido `sendMessageToConversation` que usan el composer del dashboard y la API pública v1. Confirmado que este hallazgo del audit histórico §7 sigue vigente sin cambios en este commit.
- ~~**Asignación de agentes sin segunda validación**~~ (ficha 1.10) — **RESUELTO (2026-07-23).** La política RLS `conversations_update` ahora tiene `WITH CHECK` (migración 036), validada empíricamente en `wacrm-staging` y aplicada en producción. Ver ficha 1.10 para el detalle.
- **`remove_account_member` no limpia `conversations.assigned_agent_id`** (`018_account_member_rpcs.sql`, líneas 127-201). La RPC reubica al usuario removido en una cuenta personal nueva (líneas 185-197: `INSERT INTO accounts` + `UPDATE profiles SET account_id = v_new_account_id`), pero nunca toca las conversaciones que tenía asignadas — quedan con un `assigned_agent_id` que ya no es miembro de la cuenta (una asignación huérfana). `assigned_agent_id` es un `UUID` sin foreign key (`001_initial_schema.sql:145`), así que no hay ningún error ni constraint que lo señale. No es una fuga entre cuentas hoy: `conversations_select` filtra por `is_account_member(account_id)` contra el `account_id` *de la conversación*, y el usuario removido pasó a otra cuenta, así que no puede volver a leerla. El impacto concreto es de correctness/UX (la conversación queda con un asignado fantasma hasta que alguien la reasigna o desasigna a mano) y se vuelve relevante para la migración 036 (Fase 3.1-C2): el diseño de esa migración solo revalida membresía de `assigned_agent_id` cuando el valor cambia, precisamente para que estas conversaciones huérfanas no queden bloqueadas para updates no relacionados (marcar leído, cambiar status) una vez que exista un `WITH CHECK`.
- **Comparación de secreto no constante-time en `automations/cron`** (`!==` en vez de `crypto.timingSafeEqual`), inconsistente con el mismo mecanismo en `flows/cron` (que sí usa comparación segura). Riesgo teórico (timing attack sobre HTTP es difícil), pero es una inconsistencia entre dos rutas gemelas que deberían compartir el mismo estándar.
- **Tres copias casi idénticas de la factory `supabaseAdmin()`** (`src/lib/ai/admin-client.ts`, `src/lib/automations/admin-client.ts`, `src/lib/flows/admin-client.ts`) en vez de una sola compartida.
- ~~**`PATCH /api/account` (renombrar la organización) no tiene consumidor en la UI actual**~~ — **RESUELTO (2026-07-29, Fase 3.3).** `src/components/settings/organization-settings.tsx` consume `GET`/`PATCH /api/account`, con 8 campos editables (incluyendo el nombre) y permisos vía `canEditSettings`. Ver ficha 1.12.
- **`canDeleteAccount` (predicate de rol) y el `CanAction` `"delete-account"` no tienen ningún call site** en `src/app/` — infraestructura muerta; no existe ruta ni RPC de borrado de cuenta en absoluto.
- **`business_type` es texto libre, sin catálogo curado** (`accounts.business_type`, columna `TEXT` de `038_account_business_fields.sql`, campo `Input` simple en `organization-settings.tsx` — a diferencia de país/idioma, que sí usan `Select` sobre un catálogo). Un cliente escribe "Restaurante", otro "restaurant", otro "Comida rápida" — sin normalización, imposible de agrupar o segmentar por tipo de negocio con una simple consulta SQL (`GROUP BY business_type` da tantos grupos como variantes de tipeo existan). Severidad: **Baja**. Justificación: no es un defecto de seguridad ni de correctness — es una limitación de modelado de datos, deliberada según el propio comentario de la migración 038 (líneas 13-17: "no hay un enum universal razonable... wacrm es self-hostable y cada fork puede necesitar categorías distintas", mismo criterio que `default_currency` en la 021). Se vuelve relevante solo si el producto necesita segmentar por tipo de negocio (mencionado como caso futuro: integración opcional con ATIENDEPRO para restaurantes) — hasta entonces no bloquea nada. No requiere migración para arreglarse: la columna sigue siendo `TEXT`, alcanza con un catálogo curado (mismo patrón que `src/lib/countries.ts`/`languages.ts`) y cambiar el `Input` por un `Select`.
- **`accounts.logo_url` existe pero no tiene UI de carga** (columna agregada por la 038, sin bucket ni componente de subida — `organization-settings.tsx` no la incluye entre sus 8 campos editables). Severidad: **Baja**. Justificación: es una funcionalidad ausente, no un defecto de lo que sí existe — no hay bucket ni policy que audite, por lo tanto no hay superficie insegura, solo una característica no construida. La razón documentada de por qué se dejó fuera es arquitectónica y vale la pena registrarla para la próxima fase que lo aborde: `profiles.avatar_url` usa el bucket `avatars` (migración 008) con policies por `auth.uid()` — solo quien subió el archivo puede reemplazarlo, correcto para un dato personal. Un logo de organización necesita policies por `account_id` + rol admin (`is_account_member(account_id, 'admin')`), que hoy no existe para ningún bucket — es el mismo patrón `user_id` ≠ `account_id` de la Fase 3.1 (fichas 2.3/2.4), esta vez en Storage en vez de en una tabla. Se eleva a Media el día que se implemente sin ese cuidado (un bucket nuevo con policies por `user_id` en vez de `account_id` repetiría el bug real, no solo el ausente).

**Baja:**
- **Identidad por teléfono** sigue bloqueando cualquier canal sin número de teléfono (confirmado vigente, audit histórico §4.1) — es una limitación conocida y explícitamente pospuesta hasta la fase omnicanal (regla 10 de `core-architecture.md`), no un bug de esta fase.
- **`messages.template_name`** sigue modelado según Meta (audit histórico §4.3) — sin cambios en este commit.
- **`src/app/api/whatsapp/config/verify-registration/route.ts` no fue auditado** en esta pasada (no aparece en el grep de service-role, pero no se leyó su contenido). Se registra el vacío para que una futura auditoría lo cubra explícitamente, en vez de asumir que es equivalente a `whatsapp/config`.
- **El paso `assign_conversation` en modo `round_robin`** (`automations/engine.ts` líneas 454-464) siempre selecciona el primer perfil de la cuenta (`limit(1)`, sin orden ni rotación real) — el propio comentario del código admite que es un placeholder ("preserving that shape until a real round-robin algorithm replaces it").

**Deuda operativa (alta prioridad, no bloqueante del commit):**
- **El desarrollo local apunta a la base de producción.** `.env.local` (fuera del repo) fija las variables que `@/lib/flows/admin-client` y el resto del código de aplicación leen (`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`) contra el proyecto de producción (ref `cgwrlkrkesjzrxtuvcfh`) — no contra `wacrm-staging`. En consecuencia, correr la app en local lee y escribe sobre datos reales de clientes. La validación manual de la sección Organización y del checklist de onboarding (Fase 3.2/3.3, fichas 1.2/1.12) se hizo precisamente contra esa base de producción, no contra staging. `wacrm-staging` (ref `zkrjdsqkfokzoifslfve`) existe desde 2026-07-23 y sí se usó para validar las migraciones 038/039 antes de aplicarlas a producción (ver fichas 1.2/1.12) y para toda la suite `npm run test:integration`, pero no funciona como entorno de desarrollo del día a día — solo como entorno de prueba puntual. **Acción requerida antes de continuar con la Fase 3.4/3.5:** repuntar `.env.local` a staging.
- **Cierre de Fase 3.4c (signup mínimo) — completa en código y validada en staging; migración 040 pendiente en producción (2026-08-06).** El código de 3.4c está terminado (signup sin campo "Business name", ver fichas 1.1 y 1.2) y la migración `040_signup_minimo_resolve_account_name.sql` fue aplicada y verificada en `wacrm-staging`: se ejercitó el flujo completo ahí — signup mínimo → cuenta nace con nombre provisional "My account" → Paso 1 del wizard de `/setup` completa el nombre real (probado con la cuenta "Acme"). **La migración 040 NO está aplicada en producción** (ref `cgwrlkrkesjzrxtuvcfh`) — queda como paso manual pendiente antes o durante el próximo deploy a prod. Mientras esa migración no se aplique ahí, **producción y staging difieren**: producción sigue corriendo con la 039 (sin la 040) y por lo tanto el signup en producción **sigue exigiendo `business_name`**, el comportamiento de Fase 3.3, no el de 3.4c. No se debe leer esta fase como "cerrada" sin más — el código y la validación en staging están completos, pero producción todavía no refleja el cambio hasta que la 040 se aplique ahí.

---

## 4. Recomendaciones para Fase 3.1

*(Solo aquí se proponen acciones — ninguna se ejecutó en este commit. Ordenadas por riesgo, cada una referencia la ficha que la justifica.)*

1. **Corregir `app/api/automations/[id]` y `app/api/automations/[id]/duplicate` para filtrar por `account_id`** (o replicar el patrón de `flows/[id]/route.ts`: verificar pertenencia con el cliente RLS antes de mutar con `supabaseAdmin()`). Justificado por las fichas 2.3 y 2.4 — es la única casilla ❌ confirmada en las 26 rutas auditadas, y el propio documento de instrucciones de esta fase la señala como el patrón de riesgo #1 a cerrar antes de admitir clientes reales.
2. ~~Escribir al menos un test de integración por RPC crítica (`set_member_role`, `remove_account_member`, `transfer_account_ownership`, `peek_invitation`, `redeem_invitation`) contra una base de datos real (o un entorno Supabase local), y para el flujo `requireApiKey` de la API pública~~ — **RESUELTO (2026-07-25).** Las 5 RPCs y `requireApiKey` tienen ahora 34 tests de integración contra `wacrm-staging` (`tests/integration/rpc/*.test.ts`, `tests/integration/auth/api-context.test.ts`, `npm run test:integration`). Ver fichas 1.3, 1.5 y 2.13 para el detalle por pieza, y la sección 3 para un hallazgo nuevo descubierto en el proceso (el guard anti-producción de la suite no cubre el cliente interno de `requireApiKey`). Queda pendiente, sin cubrir por esta recomendación: test de integración HTTP de los 11 handlers `/api/v1/*` en sí, más allá de `requireApiKey` (ver ficha 2.13).
3. **Añadir defensa en profundidad explícita (`requireRole('admin')`) a `app/api/whatsapp/config`** para que el control de rol no dependa únicamente de RLS. Justificado por la ficha 2.11.
4. ~~Añadir un `WITH CHECK` a la política RLS `conversations_update` que valide que `assigned_agent_id` (cuando no es NULL) sea miembro de la misma cuenta~~ — **RESUELTO (2026-07-23).** Migración 036, validada empíricamente en `wacrm-staging` y aplicada en producción. Justificado por la ficha 1.10.
5. **Decidir explícitamente si existirá un flujo de borrado de organización** y, si sí, implementarlo (hoy `canDeleteAccount` es un predicate sin consumidor); si no, retirar el predicate muerto. Justificado por la ficha 1.2.
6. ~~Conectar `PATCH /api/account` a la UI de Settings~~ — **RESUELTO (2026-07-29), Fase 3.3.** `src/components/settings/organization-settings.tsx` consume `GET`/`PATCH /api/account` con 8 campos editables. Justificado por la ficha 1.12.
7. **Unificar el envío de mensajes** de `automations`/`flows`/`ai` sobre el core compartido `sendMessageToConversation`, tal como recomienda la regla 3 de `core-architecture.md` ("todo envío futuro debe pasar por una única capa neutral de mensajería"). Justificado por la ficha 1.7 y el hallazgo histórico §7, aún vigente.
8. **Unificar las tres factories `supabaseAdmin()`** en un único módulo compartido. Justificado por la ficha 2.15.
9. **Alinear `automations/cron` a `crypto.timingSafeEqual`** para la comparación del secreto, igual que `flows/cron`. Justificado por las fichas 2.5 y 2.9.
10. **Auditar `whatsapp/config/verify-registration/route.ts`** en una próxima pasada — quedó fuera del alcance detallado de este documento. Justificado por la ficha 1.9.
11. ~~Revisar `flows/engine.ts` y `ai/auto-reply.ts` con el mismo nivel de detalle que `automations/engine.ts`~~ — **RESUELTO (2026-07-23), Fase 3.1-verificación.** Ninguno de los dos tiene, dentro de sí mismo, un guard de propiedad de contacto equivalente al de `automations/engine.ts` líneas 75-90. No es explotable hoy porque ambos solo tienen un caller (el webhook), que ya les entrega `contactId`/`conversationId` resueltos contra `accountId`, y porque la capa de envío (`flows/meta-send.ts`) re-verifica `account_id` antes de mandar cualquier mensaje. La protección depende de que no exista un entrypoint no confiable para Flows o AI auto-reply — no de un guard estructural en esos módulos. Ver ficha 2.15 para el detalle línea por línea. Queda pendiente, si se agrega en el futuro un entrypoint público análogo al `POST /api/automations/engine` para Flows o AI, replicar el guard de `automations/engine.ts` líneas 75-90.

---

## 5. Limitaciones de la auditoría

- No se probaron integraciones externas reales (Meta/WhatsApp en vivo) — esa verificación sigue siendo lectura de código + `npm test` (mocks/unitarios). Para RLS/SQL, esto ya no es enteramente cierto: desde el 2026-07-23 existe un entorno de staging real, `wacrm-staging` (ref `zkrjdsqkfokzoifslfve`), con las 36 migraciones aplicadas desde cero (39 a la fecha de este párrafo — ver 038/039, fichas 1.2/1.12). La migración 036 (`WITH CHECK` en `conversations_update`, ficha 1.10) fue validada ahí contra una base real como ROLE `authenticated`. Desde el 2026-07-25, `wacrm-staging` también respalda una suite de integración separada (`npm run test:integration`): las cinco RPCs de aislamiento — `set_member_role`, `remove_account_member`, `transfer_account_ownership` (018), `peek_invitation`, `redeem_invitation` (019) —, `requireApiKey`, el punto de autenticación común de toda la API pública `/api/v1/*`, la RPC `recover_orphaned_profile()` (037) que repara usuarios huérfanos de `handle_new_user`, y — desde el 2026-07-29, Fase 3.3 — los 3 `CHECK` de la 038 sobre `accounts` (`business-fields.test.ts`, 7 tests: ver fichas 1.2/1.12). La suite de integración pasó de 35 a **42 tests** con esta adición. Aun así, el alcance sigue siendo acotado: esas ocho piezas y la migración 036 son, a la fecha de este documento, todo lo que `wacrm-staging` ha validado empíricamente. El resto de las fichas — incluyendo los 11 handlers HTTP de `/api/v1/*` en sí, `flows/engine.ts`, `ai/auto-reply.ts`, el webhook entrante, la pantalla de Organización en Settings, el checklist de onboarding, y todo lo demás — sigue sin validación empírica automatizada, solo lectura estática + `npm test` unitario/mockeado (o, para las dos pantallas nuevas de esta fase, verificación manual — ver el punto dedicado más abajo).
- No se simuló carga concurrente ni acceso simultáneo de varias organizaciones sobre una base de datos real.
- No se verificó el comportamiento en el entorno de producción (Vercel/Hostinger), incluyendo si `ALLOWED_INVITE_HOSTS`, `META_APP_SECRET`, `AUTOMATION_CRON_SECRET` y `SUPABASE_SERVICE_ROLE_KEY` están configuradas y protegidas correctamente ahí — son variables de entorno fuera del alcance de una auditoría de código estático.
- La confianza "Alta" depende de las pruebas disponibles en el repo: 628 tests unitarios/mockeados en el commit auditado (**645** a la fecha de este párrafo — `npm test`, 67 archivos, 0 fallas —, sin tocar código de producción), más, desde el 2026-07-25, una suite de integración contra `wacrm-staging` que creció de 35 a **42 tests**: las cinco RPCs de aislamiento, `requireApiKey`, la recuperación de usuarios huérfanos vía `recover_orphaned_profile`, y — desde el 2026-07-29 — los 3 `CHECK` de la migración 038 sobre `accounts` (ver fichas 1.2, 1.3, 1.5, 1.12, 2.13). Fuera de esas piezas, la ausencia de prueba contra base real (ninguno de los 11 handlers HTTP de `/api/v1/*`, ninguna del resto de rutas y libraries de la sección 2) sigue limitando la certeza a lectura estática, marcada explícitamente como confianza Media/Baja en esas fichas. La suite de integración reveló además un hallazgo propio (sección 3): el guard anti-producción de `tests/integration/setup/guard-staging.ts` no cubre el cliente interno que usa `requireApiKey` (`supabaseAdmin()` de `@/lib/flows/admin-client`), que en este repo lee variables de entorno apuntadas a producción.
- **Verificación manual, no automatizada, de dos pantallas nuevas (2026-07-29, Fase 3.3).** La sección Organización de Settings (`organization-settings.tsx`, ficha 1.12) y el checklist de onboarding del dashboard (`onboarding-checklist.tsx`, ficha 1.2) se probaron **manualmente en local contra la base de datos de producción** — carga, guarda/descarta y persiste — pero ninguna de las dos tiene test unitario, de integración ni end-to-end (`find src -iname "*organization-settings*test*"` y `*onboarding-checklist*test*` no devuelven nada). Esto es distinto de sus respectivos backends (`PATCH /api/account`, `GET /api/account/members`, lectura de `whatsapp_config`), que sí tienen cobertura automática documentada en sus fichas. Se registra la distinción explícitamente en vez de dejar que la cobertura del backend se lea como cobertura de la pantalla.
- No todas las librerías de soporte recibieron el mismo nivel de detalle: `flows/engine.ts`, `ai/auto-reply.ts`, `automations/meta-send.ts` y `flows/meta-send.ts` se verificaron por patrón de invocación e import, no línea por línea como `automations/engine.ts`, `send-message.ts` y las 26 rutas de la sección 2 — marcado explícitamente como confianza Media/Desconocida en cada caso, en vez de extrapolar el mismo nivel de confianza a ciegas.
- `src/app/api/whatsapp/config/verify-registration/route.ts` no fue auditado en esta pasada — omisión reconocida explícitamente, no silenciosa.
- No se auditaron las políticas RLS de todas las tablas del sistema una por una (p. ej. `message_templates`, `pipelines`, `deals`, `tags`, `custom_fields`) — se verificó su existencia y su patrón general en la migración 017, no cada ruta que las consume.
- Este documento refleja únicamente el commit **984f1cbe2bdb4e0c35c17002f5d95c43aa994bb6** en la fecha indicada (2026-07-23). Cualquier commit posterior puede invalidar total o parcialmente sus hallazgos — en particular, si se aplica alguna de las recomendaciones de la sección 4, las fichas correspondientes de las secciones 1 y 2 deben re-verificarse, no darse por corregidas automáticamente.
