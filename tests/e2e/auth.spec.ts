import { test, expect } from "@playwright/test";

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
