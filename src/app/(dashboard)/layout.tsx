import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { shouldRedirectToSetup } from "@/components/setup/wizard-plan";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "./dashboard-shell";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Fase 3.4b — redirect automático al wizard de /setup mientras el
  // negocio no esté configurado (Paso 1 únicamente — ver wizard-plan.ts).
  // Este layout corre en cada página del dashboard, así que la lectura
  // se mantiene a propósito lo más barata posible: una sola consulta,
  // solo la columna `name`, sin joins. No se usa `getCurrentAccount()`
  // (src/lib/auth/account.ts) para esto: esa función hace un round trip
  // extra a `profiles` y trae 8 columnas de negocio que este redirect no
  // necesita. En su lugar se apoya en la policy `accounts_select`
  // (`USING (is_account_member(id))`, 017_account_sharing.sql) para que
  // Postgres devuelva directamente la única cuenta del usuario logueado
  // sin tener que resolver antes su `account_id` — ver src/lib/supabase/server.ts.
  //
  // Si no hay fila (cuenta null / usuario sin perfil todavía),
  // `shouldRedirectToSetup(null)` es `true`: redirige a /setup en vez de
  // romper. `/setup` vive fuera de este route group (src/app/setup), así
  // que este layout no se le vuelve a aplicar — no hay loop (cubierto en
  // layout.test.ts).
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("accounts")
    .select("name")
    .maybeSingle();

  if (shouldRedirectToSetup(account)) {
    redirect("/setup");
  }

  return <DashboardShell>{children}</DashboardShell>;
}
