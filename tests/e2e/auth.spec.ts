import { test, expect } from "@playwright/test";
import { demoState } from "../../src/lib/demo";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page
      .getByRole("button", { name: "Entrar a mi espacio", exact: true })
      .or(page.getByRole("button", { name: "Registrar gasto", exact: true }))
      .first(),
  ).toBeVisible();
  test.skip(
    !(await page
      .getByRole("button", { name: "Entrar a mi espacio", exact: true })
      .isVisible()),
    "El recorrido de acceso requiere las variables de Supabase configuradas.",
  );
});

test("la protección de Vercel muestra una explicación y permite autorizar", async ({
  page,
}) => {
  await page.route("**/api/auth", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "401", message: "Protected deployment" },
        protection: { vercel_auth_enabled: true },
      }),
    }),
  );
  await page
    .getByRole("button", { name: "Crear mi acceso", exact: true })
    .click();
  await page.getByLabel("Correo electrónico").fill("auth-test@example.com");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("test-only-password");
  await page.getByRole("button", { name: "Crear acceso", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "Vercel necesita autorizar",
  );
  await expect(page.locator("form").getByRole("alert")).not.toContainText(
    "[object Object]",
  );
  await expect(
    page.getByRole("button", { name: "Autorizar acceso", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `artifacts/auth-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Ya tengo una cuenta", exact: true })
    .click();
  await expect(page.locator("form").getByRole("alert")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Autorizar acceso", exact: true }),
  ).not.toBeVisible();
});

test("el registro con confirmación pendiente conserva un mensaje claro", async ({
  page,
}) => {
  await page.route("**/api/auth", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ confirmation: true }),
    }),
  );
  await page
    .getByRole("button", { name: "Crear mi acceso", exact: true })
    .click();
  await page.getByLabel("Correo electrónico").fill("auth-test@example.com");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("test-only-password");
  await page.getByRole("button", { name: "Crear acceso", exact: true }).click();
  await expect(
    page.getByText(
      "Revisa tu correo para confirmar el acceso antes de iniciar sesión.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator("form").getByRole("alert")).not.toBeVisible();
});

test("salir de la demo vuelve al login y conserva la salida al recargar", async ({
  page,
}) => {
  if (test.info().project.name === "mobile")
    await page.setViewportSize({ width: 360, height: 780 });
  await page
    .getByRole("button", { name: "Probar la demostración", exact: true })
    .click();
  const exit = page.getByRole("button", {
    name: "Salir de la demo",
    exact: true,
  });
  await expect(exit).toBeVisible();
  await page.screenshot({
    path: `artifacts/demo-exit-${test.info().project.name}.png`,
    fullPage: true,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await exit.click();
  await expect(
    page.getByRole("button", { name: "Entrar a mi espacio", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("saldo-mode")))
    .toBe("cloud");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Entrar a mi espacio", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Probar la demostración", exact: true })
    .click();
  await expect(exit).toBeVisible();
  await exit.click();
  await expect(
    page.getByRole("button", { name: "Entrar a mi espacio", exact: true }),
  ).toBeVisible();
});

test("cerrar sesión limpia el espacio privado almacenado y mantiene el login sin conexión", async ({
  page,
  context,
}) => {
  const user = "22222222-2222-4222-8222-222222222222";
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
          const transaction = db.transaction("workspaces", "readwrite");
          transaction
            .objectStore("workspaces")
            .put({ state, pending: [] }, user);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    { user, state: demoState() },
  );
  await context.setOffline(true);
  await page.reload();
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Entrar a mi espacio", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("saldo-last-user")))
    .toBeNull();
  await expect
    .poll(() =>
      page.evaluate(
        async (user) =>
          new Promise<boolean>((resolve, reject) => {
            const request = indexedDB.open("saldo-v1", 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const read = db
                .transaction("workspaces")
                .objectStore("workspaces")
                .get(user);
              read.onsuccess = () => {
                db.close();
                resolve(read.result === undefined);
              };
              read.onerror = () => reject(read.error);
            };
          }),
        user,
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Entrar a mi espacio", exact: true }),
  ).toBeVisible();
});
