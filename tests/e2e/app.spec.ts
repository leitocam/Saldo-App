import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("saldo-mode"))
      localStorage.setItem("saldo-mode", "demo");
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Tu dinero, con perspectiva." }),
  ).toBeVisible();
});
const navigate = async (
  page: import("@playwright/test").Page,
  label: string,
) => {
  const nav = page.getByRole("navigation", { name: "Navegación principal" }),
    mobile = page.getByRole("navigation", { name: "Navegación móvil" });
  await ((await nav.isVisible()) ? nav : mobile)
    .getByRole("button", { name: label, exact: true })
    .click();
};
test("cinco pantallas y diseño adaptable sin desbordes", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.screenshot({
    path: `artifacts/${info.project.name}-inicio.png`,
    fullPage: true,
  });
  for (const [nav, title] of [
    ["Movimientos", "Cada movimiento cuenta."],
    ["Cuentas", "Todo en su lugar."],
    ["Binance", "Tu ahorro, más claro."],
    ["Reportes", "Entiende tus números."],
  ]) {
    await navigate(page, nav);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: `artifacts/${info.project.name}-${nav.toLowerCase()}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
test("registra un gasto con coma, persiste y permite corregirlo", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Registrar gasto", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Importe en bolivianos").fill("23,50");
  await dialog.getByRole("button", { name: "Gym", exact: true }).click();
  await dialog
    .getByLabel("Descripción (opcional)")
    .fill("Prueba de gasto persistente");
  await dialog.getByRole("button", { name: "Guardar movimiento" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: /Prueba de gasto persistente/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Prueba de gasto persistente/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Prueba de gasto persistente/ })
    .click();
  await dialog.getByLabel("Importe en bolivianos").fill("25");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await page
    .getByRole("button", { name: /Prueba de gasto persistente/ })
    .click();
  await dialog.getByRole("button", { name: "Anular movimiento" }).click();
  await expect(
    page.getByRole("button", { name: /Prueba de gasto persistente/ }),
  ).toHaveCount(0);
});
test("configura espacio propio, conserva USDT sin costo y separa demo", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Configurar mis cuentas/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("¿Cómo te llamas?").fill("Mi prueba");
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await dialog.getByLabel("Saldo inicial (BOB)").first().fill("1500,50");
  await dialog.getByRole("button", { name: "Continuar" }).click();
  await dialog.getByLabel("Tu saldo actual en Binance (USDT)").fill("100");
  await dialog.getByRole("button", { name: "Crear mi espacio" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("HOLA, MI PRUEBA")).toBeVisible();
  await navigate(page, "Binance");
  await expect(page.getByText("100 USDT sin costo · parcial")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Saldo inicial Binance/ }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("HOLA, MI PRUEBA")).toBeVisible();
});
test("exporta CSV real y usa filtros de movimientos", async ({ page }) => {
  await navigate(page, "Movimientos");
  await page
    .getByRole("textbox", { name: "Buscar movimientos" })
    .fill("Sueldo");
  const rows = page.locator(".all-movements .movement-row");
  await expect(rows).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar", exact: true }).click();
  expect((await download).suggestedFilename()).toContain("saldo-movimientos-");
});
test("conserva período y cuenta al abrir movimientos desde reportes", async ({
  page,
}) => {
  await navigate(page, "Reportes");
  await page.getByLabel("Reporte desde").fill("2026-08-01");
  await page.getByLabel("Reporte hasta").fill("2026-08-31");
  await page
    .getByRole("button", {
      name: "Ver movimientos Banco Nacional de Bolivia",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Desde", { exact: true })).toHaveValue(
    "2026-08-01",
  );
  await expect(page.getByLabel("Hasta", { exact: true })).toHaveValue(
    "2026-08-31",
  );
  await expect(
    page.getByLabel("Filtrar por cuenta").locator("option:checked"),
  ).toHaveText("Banco Nacional de Bolivia");
  await navigate(page, "Reportes");
  await page.getByLabel("Reporte desde").fill("2026-08-01");
  await page.getByLabel("Reporte hasta").fill("2026-08-31");
  await page
    .getByLabel("Cuenta del reporte")
    .selectOption({ label: "Banco Nacional de Bolivia" });
  await page.locator(".reports-grid .chart-legend button").first().click();
  await expect(page.getByLabel("Desde", { exact: true })).toHaveValue(
    "2026-08-01",
  );
  await expect(page.getByLabel("Filtrar por categoría")).not.toHaveValue("");
  await expect(
    page.getByLabel("Filtrar por cuenta").locator("option:checked"),
  ).toHaveText("Banco Nacional de Bolivia");
});
test("edita categorías y crea una meta sin duplicar patrimonio", async ({
  page,
}) => {
  await navigate(page, "Binance");
  await page
    .locator(".underline-tabs")
    .getByRole("button", { name: /^Ahorro/ })
    .click();
  await page.getByRole("button", { name: "Nueva meta" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre", { exact: true }).fill("Meta de prueba");
  await dialog.getByLabel("Objetivo", { exact: true }).fill("200");
  await dialog.getByLabel("USDT reservados en esta meta").fill("20");
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Meta de prueba/ }),
  ).toBeVisible();
  await expect(page.locator(".binance-hero .wealth-value")).toContainText(
    "950",
  );
});
test("permite registrar y recargar sin conexión", async ({ page, context }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Tu dinero, con perspectiva." }),
  ).toBeVisible();
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Registrar gasto", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Importe en bolivianos").fill("15");
  await dialog.getByRole("button", { name: "Gym", exact: true }).click();
  await dialog.getByLabel("Descripción (opcional)").fill("Sin conexión");
  await dialog.getByRole("button", { name: "Guardar movimiento" }).click();
  await expect(
    page.getByRole("button", { name: /Sin conexión Banco/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Sin conexión Banco/ }),
  ).toBeVisible();
  await context.setOffline(false);
});
test("accesibilidad del inicio y registro rápido", async ({ page }) => {
  for (const open of [false, true]) {
    if (open)
      await page
        .getByRole("button", { name: "Registrar gasto", exact: true })
        .click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([]);
  }
});
