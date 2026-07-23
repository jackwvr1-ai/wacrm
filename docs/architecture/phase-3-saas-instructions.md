# Fase 3 — Instrucciones de transformación en SaaS

> **Estado:** documento operativo de la etapa vigente. Creado en Fase 3.0A.
> **Relación con la arquitectura:** este documento define **prioridad y plan de ejecución**, no principios. Los principios permanentes viven en `core-architecture.md`, que sigue siendo la ley del proyecto. **Durante la Fase 3.0A la referencia operativa obligatoria es `core-architecture.md`; a partir de la aprobación de la Fase 3.0B también será obligatoria `current-state.md`.** Toda propuesta de código de la Fase 3 debe justificar explícitamente cómo la respeta.
> **Qué NO es esta fase:** no es la migración omnicanal (regla 1.10 de `core-architecture.md` sigue vigente). No se agregan canales nuevos. No se reconstruye el núcleo. No se resuelven silenciosamente las decisiones abiertas §5.2, el modelo comercial §5.4 ni las preguntas §5.5 de la arquitectura.

---

## 1. Objetivo de la fase

Convertir el sistema operativo actual en un **SaaS autoservicio, seguro, multiempresa, facturable y listo para clientes piloto**, construyendo sobre la arquitectura existente sin reconstruir el núcleo ni agregar canales innecesarios.

El criterio de éxito no es "tiene más funciones", sino: **una empresa real puede registrarse, configurar su negocio, conectar WhatsApp, invitar a su equipo y operar sin ayuda del desarrollador**, sobre datos reales, con aislamiento garantizado entre organizaciones.

---

## 2. Principios de la fase (subordinados a `core-architecture.md`)

1. **La arquitectura es la ley.** No se proponen cambios arquitectónicos grandes salvo que exista un problema técnico importante y demostrado. Toda funcionalidad nueva se construye sobre las entidades y reglas ya definidas.
2. **"Operativo" no es "terminado".** Un flujo se considera terminado solo cuando maneja permisos, aislamiento multiempresa, errores, y no requiere intervención manual del desarrollador. El Inbox está **operativo en sus flujos esenciales**; eso no equivale a terminado hasta validar esas dimensiones.
3. **Experiencia de cliente sobre cantidad de funciones.** Se prioriza reducir pasos, clics y complejidad. Se prefieren asistentes (wizard) sobre pantallas de configuración enormes. Prueba de cada pantalla: *"¿un cliente nuevo lo entendería sin explicación?"* Si no, se simplifica.
4. **Cada función debe aportar valor comercial.** Antes de construir algo: ¿ayuda a vender el producto? ¿ayuda al cliente? ¿reduce soporte? ¿mejora el onboarding? Si no responde ninguna, no es de esta fase.
5. **Todo debe ser real.** Nada de datos falsos, dashboards decorativos ni métricas inventadas. Un dato que aún no puede calcularse correctamente se muestra como "Próximamente" o no se muestra. Esta regla aplica también a la documentación: `current-state.md` no se llena de memoria (ver §5).
6. **Multiempresa sin sobreingeniería.** Ninguna funcionalidad nueva debe asumir una sola organización ni romper el aislamiento entre organizaciones. Pero **no se exige optimizar para miles de organizaciones en cada cambio**: se respeta el aislamiento y se evitan decisiones que bloqueen el crecimiento, sin introducir infraestructura prematura.
7. **Separación estricta cliente / plataforma.** El panel del cliente (Owner) y el panel interno (Super Admin) son productos distintos. Un cliente nunca ve herramientas internas. Sus funciones nunca se mezclan.
8. **Definición de terminado.** Antes de dar una tarea por finalizada: ¿se ve profesional? ¿es intuitiva? ¿puede usarla un cliente sin capacitación? ¿transmite confianza para cobrar una suscripción mensual? Si alguna respuesta es "no", la funcionalidad aún no está terminada.

---

## 3. Panel del Owner (cliente)

El Owner de una organización debe poder administrar, cada módulo gestionando **únicamente sus propias opciones**, sin mezclar configuraciones de módulos distintos ni esconder las importantes:

- Organización y configuración del negocio
- Usuarios, roles y permisos
- Integraciones (WhatsApp y las que se habiliten)
- IA
- Automatizaciones
- Branding
- API Keys
- Facturación y límites del plan

La configuración se organiza por módulo. No se ocultan opciones importantes. Cada módulo administra solo lo suyo.

---

## 4. Super Admin (plataforma) — capacidades auditadas, no acceso irrestricto

El panel interno es un producto completamente distinto del panel del cliente. El Super Admin tiene **capacidades administrativas globales claramente autorizadas y auditadas**.

**Corrección explícita respecto a formulaciones previas:** "control absoluto" no significa acceso indiscriminado a secretos o a conversaciones de clientes sin trazabilidad. El acceso a datos sensibles de una organización debe ser **excepcional, justificado y registrado**, consistente con la arquitectura de auditoría (`core-architecture.md`, entidad Audit Event y regla 9 de idempotencia/auditoría). Los clientes nunca ven herramientas internas.

---

## 5. Preparación para Stripe (sin construir billing prematuro)

La arquitectura debe quedar preparada para Stripe —suscripciones, trial y límites—, pero **Stripe no es el primer paso**. El mecanismo de control de capacidades por plan ya está previsto en la arquitectura como **Entitlement** (`core-architecture.md` §2.4), distinto de Role y Permission. Se implementa solo lo necesario para la etapa: primero se define el modelo de planes y entitlements y se mide uso real; la integración de Stripe llega después, cuando hay uso que facturar.

El modelo comercial de mensajes (§5.4 de la arquitectura) permanece **abierto**: esta fase no lo decide.

---

## 6. Orden de ejecución (por riesgo técnico, no por visibilidad)

El orden se define por el riesgo técnico real, no por lo que el usuario ve primero. Ningún bloque comienza hasta aprobar el anterior.

### Fase 3.0 — Congelar la documentación
Dividida en dos subfases que no mezclan documentación confirmada con información sin verificar:

- **3.0A — Documentación de dirección (ejecutable de inmediato):** nota histórica en `current-state-audit.md`; actualización solo de la cabecera de estado en `core-architecture.md`; creación de este documento. No se resuelven decisiones abiertas ni se convierten asuntos abiertos en definitivos.
- **3.0B — Verificación del estado real:** auditar el repositorio y construir `current-state.md` **con evidencia del código**, no de memoria. Cada capacidad se clasifica como `VERIFICADO Y OPERATIVO` / `PARCIAL` / `IMPLEMENTADO SIN VALIDACIÓN SUFICIENTE` / `NO IMPLEMENTADO` / `DESCONOCIDO — REQUIERE PRUEBA`, y cada afirmación cita evidencia concreta (archivos, rutas, migraciones, funciones, pruebas). **La existencia de un componente o una tabla no prueba que el flujo completo funcione.** No se inicia la Fase 3.1 hasta revisar y aprobar 3.0A y 3.0B.

### Fase 3.1 — Validación y fortalecimiento del aislamiento multiempresa
**Es el primer bloque técnico, antes que onboarding y antes que Stripe.** Motivo: es el riesgo #1 de la auditoría (§5.4 del audit; §5.3 de la arquitectura). Hoy el aislamiento depende de aplicar `account_id` a mano en rutas `service-role`; una sola ruta que lo olvide reabre el patrón del CVE GHSA-63cv-2c49-m5v3.

Regla obligatoria: **antes de abrir registro público o admitir múltiples clientes reales, revisar todas las rutas que usan `service-role` y confirmar que validan las cuatro capas — identidad, membresía, organización activa y propiedad del recurso** (audit §5.3). Ningún flujo SaaS se considera listo si depende únicamente de filtros manuales dispersos.

> **Nota de nombre:** este bloque se llama deliberadamente *validación y fortalecimiento*, no "guardián central". La **forma** de resolverlo (capa obligatoria única, verificación por ruta, u otro mecanismo) es una **decisión abierta** de la arquitectura (§5.2 y pregunta §5.5.4). El nombre no debe prejuzgar la solución antes del diseño.

### Fase 3.2 — Organización y membresías
Confirmar que organización, membresías y roles funcionan como base multiempresa sólida sobre la que se apoya todo lo demás.

### Fase 3.3 — Onboarding
Registro autoservicio y creación automática de organización. El usuario se registra y configura su cuenta sin ayuda. Wizard, no pantallas gigantes.

### Fase 3.4 — Configuración inicial del negocio (wizard)
Guiar al cliente a dejar su negocio operativo (datos, WhatsApp, primeros ajustes) con mínima fricción.

### Fase 3.5 — Invitaciones y roles
Equipos: invitar usuarios, asignar roles y permisos.

### Fase 3.6 — Planes y entitlements
Definir planes y el mecanismo de entitlements por plan (§2.4 de la arquitectura). Sin Stripe todavía.

### Fase 3.7 — Medición de uso real
Medir consumo/uso real por organización. Insumo necesario antes de facturar.

### Fase 3.8 — Stripe
Integración de suscripciones sobre el modelo de planes/entitlements ya definido y medido.

### Fase 3.9 — Trial, suspensión y cancelación
Ciclo de vida comercial de la cuenta.

### Fase 3.10 — Cliente piloto
Validación con 1–2 clientes reales antes de abrir registro masivo.

---

## 7. Riesgo bloqueante recordado

El mayor riesgo para abrir el SaaS **no es Stripe ni el onboarding: es el aislamiento multiempresa** (Fase 3.1). Abrir registro público sobre rutas `service-role` no blindadas equivale a arriesgar que una organización vea datos de otra. Por eso 3.1 antecede a todo lo visible para el usuario.
