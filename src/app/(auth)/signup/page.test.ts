import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

// Fase 3.4c — signup mínimo: se quita "Business name" del registro; la
// cuenta nace provisional ('My account', ver migración 040) y el Paso 1
// del wizard (/setup) la completa después.
//
// El repo no tiene jsdom/testing-library (misma restricción documentada
// en layout.test.ts), así que esto se prueba leyendo el código fuente
// directamente, igual que el test "anti-loop" de layout.test.ts hace con
// node:fs — no es una prueba de render, es una prueba de que el campo y
// su metadata fueron efectivamente removidos.

const source = readFileSync(
  path.join(process.cwd(), "src", "app", "(auth)", "signup", "page.tsx"),
  "utf-8",
);

describe("signup page — sin campo de nombre de negocio (Fase 3.4c)", () => {
  it("no declara estado businessName", () => {
    expect(source).not.toMatch(/businessName/);
  });

  it("no envía business_name en la metadata de signUp", () => {
    expect(source).not.toMatch(/business_name/);
  });

  it("conserva el campo full_name (NO se toca)", () => {
    expect(source).toMatch(/full_name:\s*fullName/);
  });
});
