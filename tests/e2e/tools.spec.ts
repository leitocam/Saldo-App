import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { demoState } from "../../src/lib/demo";
import type { SharedGroup } from "../../src/lib/shared";
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
async function navigate(page: Page, label: string) {
  const desktop = page.getByRole("navigation", {
    name: "Navegación principal",
  });
  const nav = (await desktop.isVisible())
    ? desktop
    : page.getByRole("navigation", { name: "Navegación móvil" });
  await nav.getByRole("button", { name: label, exact: true }).click();
}
async function settings(page: Page) {
  const desktop = page.getByRole("button", {
    name: "Ajustes y categorías",
    exact: true,
  });
  await (
    (await desktop.isVisible())
      ? desktop
      : page.getByRole("button", { name: "Ajustes", exact: true })
  ).click();
  await page
    .getByRole("dialog")
    .locator(".settings-tabs")
    .getByRole("button", { name: "Datos", exact: true })
    .click();
}
test("disponible del mes y deuda con cobro parcial conservan patrimonio", async ({
  page,
}, info) => {
  await expect(
    page.getByRole("heading", { name: "¿Cuánto puedes gastar?" }),
  ).toBeVisible();
  const before = await page
    .locator(".wealth-card .wealth-value")
    .first()
    .innerText();
  await navigate(page, "Cuentas");
  await page.getByRole("button", { name: "Nueva deuda", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Persona o concepto").fill("Préstamo de prueba");
  await dialog.getByLabel("Capital en BOB").fill("100");
  await dialog.getByRole("checkbox", { name: /Este dinero ya está/ }).uncheck();
  await dialog
    .getByRole("button", { name: "Guardar deuda", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const row = page
    .locator(".tool-row")
    .filter({ hasText: "Préstamo de prueba" });
  await row.getByRole("button", { name: "Registrar cobro" }).click();
  await dialog.getByLabel("Importe del pago BOB").fill("20");
  await dialog.getByRole("button", { name: "Confirmar pago" }).click();
  await expect(row).toContainText(/80[.,]00/);
  await page.screenshot({ path: `artifacts/${info.project.name}-deudas.png` });
  await navigate(page, "Inicio");
  await expect(page.locator(".wealth-card .wealth-value").first()).toHaveText(
    before,
  );
});
test("respaldo restaura en local y CSV omite duplicados con vista previa", async ({
  page,
}, info) => {
  await settings(page);
  const dialog = page.getByRole("dialog");
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Descargar respaldo JSON" }).click();
  const download = await downloadPromise;
  const buffer = readFileSync((await download.path())!);
  await dialog
    .getByRole("button", { name: "Ir a mi espacio local para restaurar" })
    .click();
  const input = dialog.getByLabel("Archivo de respaldo JSON");
  await expect(input).toBeEnabled();
  await input.setInputFiles({
    name: "respaldo.json",
    mimeType: "application/json",
    buffer,
  });
  await dialog
    .getByRole("button", { name: "Revisar respaldo", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Vista previa de restauración" }),
  ).toBeVisible();
  await dialog.getByRole("checkbox", { name: /Revisé los saldos/ }).check();
  await dialog.getByRole("button", { name: "Confirmar restauración" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Vista previa de restauración" }),
  ).not.toBeVisible();
  await input.setInputFiles({
    name: "respaldo.json",
    mimeType: "application/json",
    buffer,
  });
  await dialog
    .getByRole("button", { name: "Revisar respaldo", exact: true })
    .click();
  await expect(dialog.getByText(/0 registros nuevos/)).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Confirmar restauración" }),
  ).toBeDisabled();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/La_Paz",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const csv = `Fecha;BOB;Descripción\r\n${date};25;Importación CSV de prueba\r\n${date};25;Importación CSV de prueba`;
  await dialog.getByLabel("Archivo CSV", { exact: true }).setInputFiles({
    name: "movimientos.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await dialog
    .getByRole("combobox", { name: "Cuenta predeterminada", exact: true })
    .selectOption({ label: "Banco Nacional de Bolivia" });
  await dialog
    .getByRole("combobox", { name: "Categoría predeterminada", exact: true })
    .selectOption({ label: "Gym" });
  await dialog
    .getByRole("button", { name: "Revisar CSV", exact: true })
    .click();
  await expect(
    dialog.getByText(/1 movimientos nuevos · 1 posibles duplicados/),
  ).toBeVisible();
  await page.screenshot({
    path: `artifacts/${info.project.name}-respaldo-importacion.png`,
  });
  await dialog.getByRole("button", { name: "Confirmar importación" }).click();
  await page.keyboard.press("Escape");
  await navigate(page, "Movimientos");
  await page.getByLabel("Buscar movimientos").fill("Importación CSV de prueba");
  await expect(page.locator(".all-movements .movement-row")).toHaveCount(1);
});
test("pendiente confirmado y devolución USDC conservan inventarios separados", async ({
  page,
}, info) => {
  await navigate(page, "Binance");
  await page
    .getByRole("button", { name: "Cargos pendientes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Nuevo cargo pendiente", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Comercio del cargo pendiente")
    .fill("Compra pendiente de prueba");
  await dialog.getByLabel("Equivalente BOB del cargo").fill("80");
  await dialog.getByLabel("USDT del cargo pendiente").fill("10");
  await dialog.getByRole("button", { name: "Guardar cargo pendiente" }).click();
  await expect(page.locator(".binance-hero .wealth-value")).toContainText(
    "950",
  );
  await page
    .locator(".tool-row")
    .filter({ hasText: "Compra pendiente de prueba" })
    .getByRole("button", { name: "Confirmar cargo", exact: true })
    .click();
  await expect(page.locator(".binance-hero .wealth-value")).toContainText(
    "940",
  );
  await page
    .getByRole("button", { name: "Devoluciones y cashback", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Registrar devolución", exact: true })
    .click();
  const option = await dialog
    .getByLabel("Consumo original de la devolución")
    .locator("option")
    .filter({ hasText: "Compra pendiente de prueba" })
    .getAttribute("value");
  await dialog
    .getByLabel("Consumo original de la devolución")
    .selectOption(option!);
  await dialog
    .getByRole("combobox", { name: "Activo recibido", exact: true })
    .selectOption("USDC");
  await dialog.getByLabel("Cantidad de criptomoneda").fill("2");
  await dialog.getByLabel("Importe reembolsado equivalente BOB").fill("20");
  await dialog
    .getByLabel("Concepto del movimiento cripto")
    .fill("Devolución parcial de prueba");
  await dialog
    .getByRole("button", { name: "Guardar movimiento cripto" })
    .click();
  await expect(page.locator(".binance-hero .wealth-value")).toContainText(
    "940",
  );
  await expect(
    page
      .locator(".tool-row")
      .filter({ hasText: "Devolución parcial de prueba" }),
  ).toContainText("2 USDC");
  await page
    .getByRole("button", { name: "Conciliar saldo", exact: true })
    .click();
  await dialog
    .getByRole("combobox", { name: "Activo a conciliar", exact: true })
    .selectOption("USDC");
  await dialog.getByLabel("Saldo real observado").fill("3");
  await dialog
    .getByLabel("Motivo de la conciliación")
    .fill("Comprobación de prueba");
  await dialog.getByRole("checkbox", { name: /Crear un ajuste/ }).check();
  await dialog.getByRole("button", { name: "Guardar conciliación" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Saldos", exact: true }).click();
  await expect(page.locator(".tools-panel .forecast-grid")).toContainText("3");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: `artifacts/${info.project.name}-binance-conciliacion.png`,
  });
});
test("recuperación queda preparada sin afirmar que envió correo", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Salir de la demo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Olvidé mi contraseña", exact: true })
    .click();
  await expect(
    page.getByText(
      "El flujo está preparado. El envío se habilitará cuando se configure el proveedor de correo.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enviar enlace de recuperación" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Volver al inicio de sesión" })
    .click();
  await expect(
    page.getByRole("button", { name: "Entrar a mi espacio", exact: true }),
  ).toBeVisible();
});

test("grupo compartido muestra reparto e invitación sin cambiar cuentas privadas", async ({
  page,
  context,
}, info) => {
  const user = "22222222-2222-4222-8222-222222222222";
  const other = "33333333-3333-4333-8333-333333333333";
  const groups: SharedGroup[] = [];
  await page.route("**/api/state", (route) =>
    route.fulfill({ json: demoState() }),
  );
  await page.route("**/api/shared", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { user_id: user, groups } });
      return;
    }
    const c = route.request().postDataJSON();
    if (c.action === "create")
      groups.push({
        id: c.id,
        owner_id: user,
        name: c.payload.name,
        archived: false,
        members: [{ user_id: user, display_name: c.payload.display_name }],
        expenses: [],
        settlements: [],
      });
    if (c.action === "expense")
      groups[0].expenses.push({
        ...c.payload,
        id: c.id,
        paid_by: user,
        created_by: user,
        voided: false,
        version: 1,
      });
    if (c.action === "invite") {
      await route.fulfill({
        json: {
          ok: true,
          group_id: groups[0].id,
          code: "44444444-4444-4444-8444-444444444444",
          expires_at: "2099-01-01T00:00:00Z",
        },
      });
      return;
    }
    await route.fulfill({ json: { ok: true, group_id: groups[0]?.id } });
  });
  await page.evaluate(
    async ({ user, state }) => {
      await navigator.serviceWorker.ready;
      localStorage.setItem("saldo-mode", "cloud");
      localStorage.setItem("saldo-last-user", user);
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("saldo-v1", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("workspaces");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("workspaces", "readwrite");
          tx.objectStore("workspaces").put({ state, pending: [] }, user);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { user, state: demoState() },
  );
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Tu dinero, con perspectiva." }),
  ).toBeVisible();
  await context.setOffline(false);
  await navigate(page, "Cuentas");
  await page.getByRole("button", { name: "Crear grupo", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre del grupo").fill("Casa compartida");
  await dialog.getByLabel("Tu nombre visible en el grupo").fill("Leo");
  await dialog.getByRole("button", { name: "Guardar en el grupo" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Grupo compartido", exact: true }),
  ).toHaveValue(groups[0].id);
  await page.getByRole("button", { name: "Generar invitación" }).click();
  await expect(
    page.getByRole("textbox", { name: "Código de invitación", exact: true }),
  ).toHaveValue("44444444-4444-4444-8444-444444444444");
  groups[0].members.push({ user_id: other, display_name: "Pareja" });
  await page.getByRole("button", { name: "Actualizar grupos" }).click();
  await page.getByRole("button", { name: "Añadir gasto que pagué" }).click();
  await dialog.getByLabel("Importe compartido BOB").fill("100.01");
  await dialog.getByLabel("Concepto compartido").fill("Compra conjunta");
  await dialog.getByRole("button", { name: "Guardar en el grupo" }).click();
  await expect(dialog).not.toBeVisible();
  const panel = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Gastos compartidos",
      exact: true,
    }),
  });
  await expect(panel).toContainText("Por recibir");
  await expect(panel).toContainText("Por pagar");
  await expect(panel).toContainText("Compra conjunta");
  expect(groups[0].expenses[0].shares.map((s) => s.amount)).toEqual([
    "50.01",
    "50.00",
  ]);
  await page.screenshot({
    path: `artifacts/${info.project.name}-compartidos.png`,
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});
