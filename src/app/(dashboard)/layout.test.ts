import { existsSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import {
  isBusinessConfigured,
  shouldRedirectToSetup,
} from "@/components/setup/wizard-plan";

// Fase 3.4b — redirect automático a /setup desde el layout del dashboard.
//
// El layout es un Server Component async con `redirect()` (next/navigation);
// el repo no tiene jsdom/testing-library (misma restricción que 3.4a — ver
// wizard-plan.test.ts), así que la DECISIÓN de redirigir se prueba acá como
// lógica pura, reutilizando `isBusinessConfigured` (única fuente de verdad,
// compartida con el wizard y el checklist). El wiring del `redirect()` en sí
// (fetch de la cuenta, llamada a `redirect('/setup')`) queda a verificación
// manual en staging — documentado en el commit, igual que en 3.4a.

describe("shouldRedirectToSetup", () => {
  it("no redirige si el negocio ya está configurado", () => {
    expect(shouldRedirectToSetup({ name: "Acme Restaurantes" })).toBe(false);
  });

  it("redirige si el nombre es el fallback genérico de resolve_account_name (039)", () => {
    expect(shouldRedirectToSetup({ name: "My account" })).toBe(true);
  });

  it("redirige si no hay cuenta (fila null / usuario sin perfil aún), sin lanzar error", () => {
    expect(() => shouldRedirectToSetup(null)).not.toThrow();
    expect(shouldRedirectToSetup(null)).toBe(true);
    expect(shouldRedirectToSetup(undefined)).toBe(true);
  });

  it("es exactamente la negación de isBusinessConfigured — misma fuente de verdad que el wizard", () => {
    const cases = [
      null,
      undefined,
      { name: null },
      { name: "" },
      { name: "My account" },
      { name: "Acme Restaurantes" },
    ];
    for (const account of cases) {
      expect(shouldRedirectToSetup(account)).toBe(!isBusinessConfigured(account));
    }
  });
});

describe("anti-loop: /setup vive fuera de (dashboard)", () => {
  // Si /setup alguna vez se moviera dentro de (dashboard), este layout
  // volvería a aplicarse sobre /setup y el redirect entraría en loop.
  const appDir = path.join(process.cwd(), "src", "app");

  it("src/app/setup existe — el wizard, fuera del route group del dashboard", () => {
    expect(existsSync(path.join(appDir, "setup"))).toBe(true);
  });

  it("src/app/(dashboard)/setup NO existe — evita el bucle de redirect", () => {
    expect(existsSync(path.join(appDir, "(dashboard)", "setup"))).toBe(false);
  });
});
